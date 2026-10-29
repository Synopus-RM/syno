'use strict';
// Logic shared by the gov CLI and the hooks: device bootstrap, the start gate, queue order, briefs.
const os = require('os');
const state = require('./state');
const device = require('./device');
const budgets = require('./budget');
const sessions = require('./sessions');

const hardwareSignature = () => `${os.hostname()}|${os.cpus().length}|${Math.round(os.totalmem() / 1073741824)}`;

// Measures the device once (or again when the hardware changes, or when forced). Never touches the confirmed budget.
function ensureDevice(force = false) {
  const dev = state.loadDevice();
  const sig = hardwareSignature();
  if (!force && dev.profile && dev.signature === sig) return dev;
  const profile = device.profile();
  return state.withLock(() => {
    const cur = state.loadDevice();
    const next = { ...cur, signature: sig, profile, proposal: budgets.propose(profile, 'balanced') };
    if (cur.budget && cur.signature && cur.signature !== sig) next.hardwareChangedAt = new Date().toISOString();
    state.saveDevice(next);
    return next;
  });
}

function effectiveBudget(dev) {
  if (dev.budget) return { ...dev.budget, confirmed: true };
  return { ...(dev.proposal || budgets.propose(dev.profile, 'balanced')), confirmed: false };
}

function cleanQueue() {
  return state.withLock(() => {
    const q = state.loadQueue();
    if (state.pruneDead(q)) state.saveQueue(q);
    return q;
  });
}

const running = q => q.tickets.filter(t => t.state === 'running');
const waiting = q => q.tickets.filter(t => t.state === 'waiting');

const fmtDur = ms => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
};
const gb = mb => `${(mb / 1024).toFixed(1)} GB`;
const shQuote = s => `'${String(s).replace(/'/g, `'\\''`)}'`;
const ticketName = t => `[${t.project}] ${t.label}`;

function describeLoad(l) {
  const parts = [];
  if (l.cpuPct != null) parts.push(`CPU ${l.cpuPct}%`);
  if (l.load1 != null) parts.push(`load ${l.load1}`);
  parts.push(`RAM free ${gb(l.memAvailMB)}`);
  if (l.tempC != null) parts.push(`CPU ${l.tempC}°C`);
  if (l.speedLimitPct != null && l.speedLimitPct < 100) parts.push(`throttled to ${l.speedLimitPct}%`);
  if (l.onBattery) parts.push('on battery');
  return parts.join(' · ');
}

// Why a job of class `cls` should not start right now. Each reason has a kind so the gate can relax CPU alone.
function busyReasons(load, budget, runningTickets, cls) {
  const r = [];
  const heavyRunning = runningTickets.filter(t => t.cls === 'heavy');
  if (cls === 'heavy' && heavyRunning.length >= budget.slots.heavy) {
    r.push({ kind: 'slots', text: `heavy slots full (${heavyRunning.length}/${budget.slots.heavy}: ${heavyRunning.map(ticketName).join(', ')})` });
  } else if (runningTickets.length >= budget.slots.total) {
    r.push({ kind: 'slots', text: `all job slots in use (${runningTickets.length}/${budget.slots.total}: ${runningTickets.map(ticketName).join(', ')})` });
  }
  const t = budget.thresholds;
  if (load.cpuPct != null && load.cpuPct >= t.cpuStartBelowPct) r.push({ kind: 'cpu', text: `CPU ${load.cpuPct}% (starts below ${t.cpuStartBelowPct}%)` });
  // A run queue 1.5× the thread count (Linux counts tasks stuck on disk/swap too) means the machine is struggling even if CPU % looks fine.
  const threads = os.cpus().length;
  if (load.load1 != null && t.cpuStartBelowPct <= 100 && load.load1 >= threads * 1.5) r.push({ kind: 'cpu', text: `load ${load.load1} on ${threads} threads` });
  if (load.tempC != null && t.tempPauseC && load.tempC >= t.tempPauseC) r.push({ kind: 'temp', text: `CPU ${load.tempC}°C (pauses at ${t.tempPauseC}°C)` });
  if (load.speedLimitPct != null && load.speedLimitPct < 80) r.push({ kind: 'temp', text: `CPU throttled to ${load.speedLimitPct}%` });
  if (load.memAvailMB < t.memMinFreeMB) r.push({ kind: 'mem', text: `RAM free ${gb(load.memAvailMB)} (needs ${gb(t.memMinFreeMB)})` });
  return r;
}

// The queue is strictly ordered: only the first non-paused waiting ticket may start, and only when the device has room.
// High CPU with no governed job running means load from outside the queue; after the owner's grace period it stops blocking.
function gate(me, q, budget, load, policy, cpuHighSince, now = Date.now()) {
  if (me.paused) return { go: false, cpuHigh: false, reasons: ['paused by the owner'] };
  const ready = waiting(q).filter(t => !t.paused);
  const pos = ready.findIndex(t => t.id === me.id);
  const reasons = [];
  if (pos > 0) reasons.push(`#${pos + 1} in line, behind ${ticketName(ready[0])}`);
  const run = running(q);
  const busy = busyReasons(load, budget, run, me.cls);
  const cpuHigh = busy.some(b => b.kind === 'cpu');
  const externalLoad = run.length === 0 && cpuHigh && cpuHighSince && now - cpuHighSince >= policy.queue.cpuWaitMaxSec * 1000;
  const blocking = externalLoad ? busy.filter(b => b.kind !== 'cpu') : busy;
  reasons.push(...blocking.map(b => b.text));
  return { go: pos === 0 && blocking.length === 0, cpuHigh, externalLoad, reasons };
}

// New tickets go behind every waiting ticket of equal or higher project priority.
function insertByPriority(q, ticket, policy) {
  const prio = p => Number(policy.priorities[p] || 0);
  let idx = q.tickets.length;
  for (let i = 0; i < q.tickets.length; i++) {
    const t = q.tickets[i];
    if (t.state === 'waiting' && prio(t.project) < prio(ticket.project)) { idx = i; break; }
  }
  q.tickets.splice(idx, 0, ticket);
}

function sortWaitingByPriority(q, policy) {
  const prio = p => Number(policy.priorities[p] || 0);
  const w = waiting(q).map((t, i) => [t, i]).sort((a, b) => prio(b[0].project) - prio(a[0].project) || a[1] - b[1]).map(x => x[0]);
  q.tickets = [...running(q), ...w];
}

function estimateMs(key) {
  const d = state.readJSONL(state.FILES.history, 300)
    .filter(h => h.key === key && h.exitCode === 0 && h.durationSec > 0)
    .slice(-5).map(h => h.durationSec * 1000).sort((a, b) => a - b);
  return d.length ? d[Math.floor(d.length / 2)] : null;
}

// Long-wait questions about a ticket that already started or left the queue are moot.
function liveDecisions(q) {
  return state.loadDecisions().items.filter(d => d.status === 'pending' &&
    (d.kind !== 'long-wait' || q.tickets.some(t => t.id === d.ticketId && t.state === 'waiting')));
}

function expireDecisions(pred) {
  state.withLock(() => {
    const d = state.loadDecisions();
    let changed = false;
    for (const x of d.items) if (x.status === 'pending' && pred(x)) { x.status = 'expired'; x.resolvedAt = new Date().toISOString(); changed = true; }
    if (changed) state.saveDecisions(d);
  });
}

function deviceLine(p) {
  const cores = p.cpu.physical ? `${p.cpu.physical} cores/${p.cpu.logical} threads` : `${p.cpu.logical} threads`;
  return `${p.cpu.model} · ${cores} · ${gb(p.memory.totalMB)} RAM${p.power.onBattery ? ' · on battery' : ''}`;
}

function budgetLine(b, dev) {
  const status = b.confirmed ? `owner-confirmed ${String(dev.confirmedAt || '').slice(0, 10)}` : 'PROPOSAL — not confirmed by the owner';
  const t = b.thresholds;
  return `${status} · ${b.preset || 'custom'} · heavy jobs at once ${b.slots.heavy} · jobs total ${b.slots.total} · ` +
    `e2e workers ${b.workers.e2e} · test workers ${b.workers.tests} · build jobs ${b.workers.build} · ` +
    `start below CPU ${t.cpuStartBelowPct}%${t.tempPauseC ? ` · pause at ${t.tempPauseC}°C` : ''}`;
}

function queueLines(q, now = Date.now()) {
  const rows = [
    ...running(q).map(t => `▶ ${t.id} ${ticketName(t)} (${t.cls}) running ${fmtDur(now - Date.parse(t.startedAt))}`),
    ...waiting(q).map((t, i) => `${t.paused ? '⏸' : '…'} ${t.id} #${i + 1} ${ticketName(t)} (${t.cls}) waiting ${fmtDur(now - Date.parse(t.enqueuedAt))}${t.paused ? ' · paused' : ''}`),
  ];
  return rows.length ? rows : ['empty'];
}

function queueSummary(q, now = Date.now()) {
  const r = running(q), w = waiting(q);
  const runText = r.length ? r.map(t => `${ticketName(t)} ${fmtDur(now - Date.parse(t.startedAt))}`).join(', ') : 'none';
  return `running: ${runText}; waiting: ${w.length}`;
}

function decisionsBrief(items) {
  return [
    'Syno Governor — decisions waiting for the device owner. Ask the owner with AskUserQuestion (one question per decision, ' +
      'its options as the choices, no option pre-chosen by you), then record each answer with `gov decide <id> <option>`. Never answer these yourself:',
    ...items.map(d => `- [${d.id}] ${d.question} Options: ${d.options.map(o => `${o.key} = ${o.label}`).join(' | ')}`),
  ].join('\n');
}

const MODE_TEXT = {
  queue: 'heavy commands from every session wait their turn; the Bash hook sends them through `gov run`',
  ask: 'heavy commands run directly, but the owner is asked first whenever the device is busy',
  advise: 'nothing is blocked; you only get load notes',
};

function sessionsNote(ov) {
  const lines = [`Claude sessions on this device: ${sessions.summary(ov)}.`];
  if (ov.ungoverned && ov.ungoverned.length) {
    lines.push('Sessions without the governor were started before it was installed, or have it disabled: their commands are not queued and only show up as CPU load. ' +
      'Restarting them (quit and reopen the Claude app, or restart the terminal session) brings them under the governor.');
  }
  if (ov.cowork) lines.push('Cowork tasks run in their own virtual machine, which this plugin does not reach; their work only shows up as CPU load and temperature.');
  return lines;
}

function sessionBrief({ dev, policy, load, q, pending, ov, cli }) {
  const b = effectiveBudget(dev);
  const lines = [
    'Syno Governor is active. It is shared by every Claude session and project on this device.',
    `Device: ${deviceLine(dev.profile)}`,
    `Budget: ${budgetLine(b, dev)}`,
    `Policy: mode=${policy.mode} (${MODE_TEXT[policy.mode]}) · QC ${policy.qc.default} · each verification run ≤ ${policy.chunk.targetMinutes} min · ≤ ${policy.chunk.maxFilesPerChunk} files per task chunk${policy.confirmedAt ? '' : ' (defaults; owner has not confirmed a policy)'}`,
    `Now: ${describeLoad(load)} · queue ${queueSummary(q)}`,
    ...(ov ? sessionsNote(ov) : []),
    `CLI: \`gov\` on PATH in Bash (fallback: node "${cli}").`,
    'Rules: run tests, e2e, builds and installs through `gov run --label "<what>" -- \'<command>\'` with run_in_background: true; ' +
      'keep worker counts within the budget (`gov advise`); one heavy job per session at a time; split big tasks into small chunks. ' +
      'Priorities, queue order, task breakdowns and quality-control gates are the owner\'s decisions — propose, then ask with AskUserQuestion. ' +
      'Load the device-aware-work skill before heavy work or a large multi-step task.',
  ];
  if (!b.confirmed) lines.push('The owner has not confirmed this device\'s budget yet: mention it once and suggest /syno:governor setup. Do not block light work on it.');
  if (dev.hardwareChangedAt) lines.push('Hardware changed since the owner confirmed the budget: suggest re-running /syno:governor setup.');
  if (pending.length) lines.push(decisionsBrief(pending));
  return lines.join('\n');
}

function readStdin() {
  return new Promise(resolve => {
    if (process.stdin.isTTY) return resolve('');
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', c => { data += c; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
  });
}

module.exports = {
  ensureDevice, effectiveBudget, cleanQueue, running, waiting,
  fmtDur, gb, shQuote, ticketName, describeLoad, busyReasons, gate,
  insertByPriority, sortWaitingByPriority, estimateMs, liveDecisions, expireDecisions,
  deviceLine, budgetLine, queueLines, queueSummary, decisionsBrief, sessionsNote, sessionBrief, readStdin,
};
