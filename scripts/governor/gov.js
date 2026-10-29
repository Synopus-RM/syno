#!/usr/bin/env node
'use strict';
// gov — the Syno Governor CLI, shared by every Claude session (and you) on this device.
const os = require('os');
const { spawn } = require('child_process');
const state = require('./lib/state');
const device = require('./lib/device');
const budgets = require('./lib/budget');
const { classify } = require('./lib/classify');
const sessions = require('./lib/sessions');
const c = require('./lib/common');

const HELP = `gov — Syno Governor

Look (read-only)
  gov status [--json]                live load, budget, queue, owner decisions waiting
  gov sessions [--json]              Claude sessions running on this device, with and without the governor
  gov profile [--json]               measure this device and compare budget presets
  gov advise [--json]                worker/shard sizes for this device + recent run times
  gov queue [--json]                 the cross-session queue
  gov history [--limit N] [--json]   finished runs
  gov decisions [--json]             decisions waiting for the owner
  gov priority [--json]              project priorities
  gov classify -- '<command>'        heavy / medium / light, and why

Run through the queue
  gov run [--label TEXT] [--class heavy|medium] [--max-wait MIN] -- '<command>'

Owner decisions (Claude Code asks the owner before any of these run)
  gov budget set [--preset conservative|balanced|performance] [key=value ...]
  gov budget reset
  gov policy set key=value ...       e.g. mode=queue qc.default=standard chunk.targetMinutes=8
                                     gateClasses='["heavy","medium"]' patterns.heavy='["^npm run storybook"]'
  gov priority set <project> <n>     higher number runs first;  gov priority clear <project>
  gov queue move <id> <position> | pause <id> | resume <id> | cancel <id> [--kill]
  gov decide <decision-id> <option> [--note TEXT]
`;

const argv = process.argv.slice(2);
const head = argv.indexOf('--') === -1 ? argv : argv.slice(0, argv.indexOf('--'));
const JSON_OUT = head.includes('--json');

const out = s => process.stdout.write(String(s).endsWith('\n') ? String(s) : `${s}\n`);
const asJSON = v => out(JSON.stringify(v, null, 2));
const fail = (msg, code = 1) => { process.stderr.write(`gov: ${msg}\n`); process.exit(code); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();

const VALUED = new Set(['label', 'class', 'max-wait', 'preset', 'limit', 'note']);

function parseArgs(args) {
  const o = { _: [], rest: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') { o.rest = args.slice(i + 1); break; }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const k = eq === -1 ? a.slice(2) : a.slice(2, eq);
      if (eq !== -1) o[k] = a.slice(eq + 1);
      else if (VALUED.has(k) && args[i + 1] !== undefined) o[k] = args[++i];
      else o[k] = true;
    } else o._.push(a);
  }
  return o;
}

function assignments(list) {
  return list.map(a => {
    const i = a.indexOf('=');
    if (i < 1) fail(`expected key=value, got "${a}"`, 2);
    let v = a.slice(i + 1);
    try { v = JSON.parse(v); } catch { /* plain string */ }
    return [a.slice(0, i), v];
  });
}

function setPath(obj, dotted, value) {
  const keys = dotted.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) {
    if (o[k] === null || typeof o[k] !== 'object' || Array.isArray(o[k])) o[k] = {};
    o = o[k];
  }
  o[keys[keys.length - 1]] = value;
}

// ---------- read-only ----------

async function status() {
  const dev = c.ensureDevice();
  const policy = state.loadPolicy();
  const b = c.effectiveBudget(dev);
  const load = await device.live(600);
  const q = c.cleanQueue();
  const pending = c.liveDecisions(q);
  const ov = sessions.overview();
  if (JSON_OUT) return asJSON({ profile: dev.profile, budget: b, confirmedAt: dev.confirmedAt || null, policy, load, sessions: ov, queue: q.tickets, pendingDecisions: pending });
  const qLines = c.queueLines(q);
  out([
    `Syno Governor · ${dev.profile.host} (${dev.profile.platform})`,
    `Device   ${c.deviceLine(dev.profile)}`,
    `Budget   ${c.budgetLine(b, dev)}`,
    `Policy   mode=${policy.mode} · gated: ${policy.gateClasses.join('+')} · QC ${policy.qc.default} · runs ≤ ${policy.chunk.targetMinutes} min · ≤ ${policy.chunk.maxFilesPerChunk} files/chunk${policy.confirmedAt ? '' : ' · (defaults, not confirmed)'}`,
    `Live     ${c.describeLoad(load)}`,
    `Sessions ${sessions.summary(ov)}${ov.ungoverned && ov.ungoverned.length ? ' — gov sessions' : ''}`,
    ...qLines.map((l, i) => (i ? '         ' : 'Queue    ') + l),
    pending.length ? `Owner    ${pending.length} decision(s) waiting — gov decisions` : 'Owner    no decisions waiting',
  ].join('\n'));
}

async function profileCmd() {
  const dev = c.ensureDevice(true);
  const presets = Object.fromEntries(budgets.PRESETS.map(n => [n, budgets.propose(dev.profile, n)]));
  if (JSON_OUT) return asJSON({ profile: dev.profile, presets, confirmedBudget: dev.budget || null, confirmedAt: dev.confirmedAt || null });
  const p = dev.profile;
  const row = (name, f) => `${name.padEnd(22)}${budgets.PRESETS.map(n => String(f(presets[n]) ?? '—').padStart(14)).join('')}`;
  out([
    `Device      ${c.deviceLine(p)}`,
    `Platform    ${p.platform} ${p.release} (${p.arch})`,
    `Thermals    ${p.thermal.sensor ? `${p.thermal.sensor}${p.thermal.tempAtProfileC != null ? `, ${p.thermal.tempAtProfileC}°C now` : ''}` : 'no readable CPU temperature'}`,
    '',
    `${''.padEnd(22)}${budgets.PRESETS.map(n => n.padStart(14)).join('')}`,
    row('heavy jobs at once', b => b.slots.heavy),
    row('jobs in total', b => b.slots.total),
    row('e2e workers', b => b.workers.e2e),
    row('test workers', b => b.workers.tests),
    row('build jobs (-j)', b => b.workers.build),
    row('start below CPU %', b => b.thresholds.cpuStartBelowPct),
    row('pause at °C', b => b.thresholds.tempPauseC),
    row('min free RAM (MB)', b => b.thresholds.memMinFreeMB),
    '',
    ...presets.balanced.rationale.map(r => `• ${r}`),
    dev.budget ? `\nConfirmed now: ${c.budgetLine(c.effectiveBudget(dev), dev)}` : '\nNo budget confirmed yet. The owner chooses one with: gov budget set --preset <name> [key=value ...]',
  ].join('\n'));
}

function adviseCmd() {
  const dev = c.ensureDevice();
  const policy = state.loadPolicy();
  const b = c.effectiveBudget(dev);
  const hist = state.readJSONL(state.FILES.history, 300);
  const byKey = new Map();
  for (const h of hist) {
    const e = byKey.get(h.key) || { key: h.key, project: h.project, label: h.label, cls: h.cls, durations: [], failures: 0, stopped: 0 };
    if (h.exitCode === 0) e.durations.push(h.durationSec);
    else if (h.stopped) e.stopped++;
    else e.failures++;
    byKey.set(h.key, e);
  }
  const target = policy.chunk.targetMinutes * 60;
  const recent = [...byKey.values()].slice(-8).map(e => {
    const d = e.durations.slice(-5).sort((x, y) => x - y);
    const median = d.length ? d[Math.floor(d.length / 2)] : null;
    const shards = median && median > target ? Math.ceil(median / target) : (e.stopped ? 2 : 1);
    return { ...e, medianSec: median, suggestedParts: shards };
  });
  const w = b.workers;
  const advice = {
    budgetConfirmed: b.confirmed,
    targetMinutesPerRun: policy.chunk.targetMinutes,
    e2e: { workers: w.e2e, examples: [`npx playwright test --workers=${w.e2e}`, 'npx cypress run --spec "<one folder at a time>"'] },
    tests: { workers: w.tests, examples: [`npx jest --maxWorkers=${w.tests}`, `npx vitest run --maxWorkers=${w.tests}`, `pytest -n ${w.tests}`, `go test -p ${w.tests} ./...`] },
    build: { jobs: w.build, examples: [`make -j${w.build}`, `cargo build -j ${w.build}`, `./gradlew build --max-workers=${w.build}`, `turbo run build --concurrency=${w.build}`] },
    recent,
  };
  if (JSON_OUT) return asJSON(advice);
  out([
    `Sizing for this device (${b.confirmed ? 'owner-confirmed' : 'PROPOSAL, not yet confirmed by the owner'}):`,
    `  Browser e2e    workers ≤ ${w.e2e}     e.g. ${advice.e2e.examples[0]}`,
    `  Unit tests     workers ≤ ${w.tests}     e.g. ${advice.tests.examples.slice(0, 2).join(' · ')}`,
    `  Builds         jobs ≤ ${w.build}        e.g. ${advice.build.examples.slice(0, 3).join(' · ')}`,
    `Each run should finish within ${policy.chunk.targetMinutes} min. Slower suites: split with --shard=i/N (Playwright, Jest ≥ 28, Vitest)`,
    '  or by folder/file, one `gov run` per part, after the owner approves the split.',
    recent.length ? 'Recent runs:' : 'Recent runs: none recorded yet.',
    ...recent.map(e => `  [${e.project}] ${e.label} (${e.cls}) — ${e.medianSec ? `median ${c.fmtDur(e.medianSec * 1000)}` : 'no successful run'}` +
      `${e.failures ? `, ${e.failures} failed` : ''}${e.stopped ? `, ${e.stopped} stopped/timed out` : ''}` +
      `${e.suggestedParts > 1 ? ` → suggest ${e.suggestedParts} parts (owner to approve)` : ''}`),
  ].join('\n'));
}

function queueList() {
  const q = c.cleanQueue();
  if (JSON_OUT) return asJSON(q.tickets);
  out(c.queueLines(q).join('\n'));
}

function historyCmd(args) {
  const o = parseArgs(args);
  const items = state.readJSONL(state.FILES.history, Number(o.limit) || 20);
  if (JSON_OUT) return asJSON(items);
  if (!items.length) return out('No runs recorded yet.');
  out(items.map(h => `${h.endedAt.slice(0, 16).replace('T', ' ')}  [${h.project}] ${h.label} (${h.cls}) ` +
    `${h.exitCode === 0 ? 'ok' : h.stopped ? 'STOPPED' : `exit ${h.exitCode}`} · ran ${c.fmtDur(h.durationSec * 1000)} · waited ${c.fmtDur(h.waitedSec * 1000)}` +
    `${h.peakCpuPct != null ? ` · peak CPU ${h.peakCpuPct}%` : ''}${h.peakTempC != null ? ` · peak ${h.peakTempC}°C` : ''}`).join('\n'));
}

function decisionsCmd() {
  const q = c.cleanQueue();
  const live = new Set(c.liveDecisions(q).map(d => d.id));
  c.expireDecisions(d => !live.has(d.id));
  const pending = c.liveDecisions(q);
  if (JSON_OUT) return asJSON(pending);
  if (!pending.length) return out('No decisions waiting for the owner.');
  out(pending.map(d => `[${d.id}] ${d.question}\n    options: ${d.options.map(o => `${o.key} (${o.label})`).join(' | ')}`).join('\n'));
}

function classifyCmd(args) {
  const o = parseArgs(args);
  const command = (o.rest || o._).join(' ');
  if (!command) fail("usage: gov classify -- '<command>'", 2);
  const r = classify(command, state.loadPolicy());
  if (JSON_OUT) return asJSON(r);
  out(r.cls === 'light' ? 'light — not gated' : `${r.cls} — ${r.reason} (${r.kind}) in: ${r.segment}`);
}

// ---------- owner decisions ----------

function budgetCmd(args) {
  const o = parseArgs(args);
  const sub = o._[0] || 'show';
  const dev = c.ensureDevice();
  if (sub === 'show') {
    const b = c.effectiveBudget(dev);
    return JSON_OUT ? asJSON({ ...b, confirmedAt: dev.confirmedAt || null }) : out(c.budgetLine(b, dev));
  }
  if (sub === 'reset') {
    state.withLock(() => { const d = state.loadDevice(); delete d.budget; delete d.confirmedAt; state.saveDevice(d); });
    state.logOwner({ action: 'budget reset' });
    return out('Confirmed budget withdrawn; the proposal applies until the owner confirms a new one.');
  }
  if (sub !== 'set') fail(`unknown: gov budget ${sub}`, 2);
  const preset = typeof o.preset === 'string' ? o.preset : (dev.budget ? null : 'balanced');
  if (preset && !budgets.PRESETS.includes(preset)) fail(`--preset must be one of ${budgets.PRESETS.join(', ')}`, 2);
  const next = preset ? budgets.propose(dev.profile, preset) : JSON.parse(JSON.stringify(dev.budget));
  const changes = assignments(o._.slice(1));
  for (const [k, v] of changes) setPath(next, k, v);
  if (changes.length) next.preset = `${preset || next.preset || 'custom'} (custom)`.replace(' (custom) (custom)', ' (custom)');
  delete next.confirmed;
  const errs = budgets.validate(next);
  if (errs.length) fail(errs.join('; '), 2);
  const at = nowIso();
  state.withLock(() => {
    const d = state.loadDevice();
    d.budget = next;
    d.confirmedAt = at;
    delete d.hardwareChangedAt;
    state.saveDevice(d);
  });
  state.logOwner({ action: 'budget set', preset, changes: Object.fromEntries(changes) });
  out(`Budget confirmed: ${c.budgetLine({ ...next, confirmed: true }, { confirmedAt: at })}`);
}

function validatePolicy(p) {
  const errs = [];
  if (!['queue', 'ask', 'advise'].includes(p.mode)) errs.push('mode must be queue, ask or advise');
  if (!['targeted', 'standard', 'strict', 'manual'].includes(p.qc.default)) errs.push('qc.default must be targeted, standard, strict or manual');
  if (!Array.isArray(p.gateClasses) || !p.gateClasses.length || p.gateClasses.some(x => !['heavy', 'medium'].includes(x))) errs.push('gateClasses must be a JSON array of "heavy" and/or "medium"');
  for (const k of ['heavy', 'medium', 'light']) {
    if (!Array.isArray(p.patterns[k])) { errs.push(`patterns.${k} must be a JSON array of regex strings`); continue; }
    for (const s of p.patterns[k]) { try { new RegExp(s); } catch { errs.push(`patterns.${k}: invalid regex ${s}`); } }
  }
  for (const k of ['targetMinutes', 'maxFilesPerChunk']) if (!(p.chunk[k] > 0)) errs.push(`chunk.${k} must be > 0`);
  for (const k of ['escalateAfterMin', 'maxWaitMin', 'cpuWaitMaxSec']) if (!(p.queue[k] > 0)) errs.push(`queue.${k} must be > 0`);
  if (!(p.qc.milestoneEvery >= 1)) errs.push('qc.milestoneEvery must be ≥ 1');
  for (const [proj, n] of Object.entries(p.priorities)) if (!Number.isFinite(Number(n))) errs.push(`priorities.${proj} must be a number`);
  return errs;
}

function policyCmd(args) {
  const o = parseArgs(args);
  const sub = o._[0] || 'show';
  const policy = state.loadPolicy();
  if (sub === 'show') return JSON_OUT ? asJSON(policy) : out(JSON.stringify(policy, null, 2));
  if (sub !== 'set') fail(`unknown: gov policy ${sub}`, 2);
  const changes = assignments(o._.slice(1));
  if (!changes.length) fail('nothing to set: gov policy set key=value ...', 2);
  for (const [k, v] of changes) setPath(policy, k, v);
  const errs = validatePolicy(policy);
  if (errs.length) fail(errs.join('; '), 2);
  policy.confirmedAt = nowIso();
  state.withLock(() => state.savePolicy(policy));
  state.logOwner({ action: 'policy set', changes: Object.fromEntries(changes) });
  out(`Policy saved: mode=${policy.mode} · gated ${policy.gateClasses.join('+')} · QC ${policy.qc.default} · runs ≤ ${policy.chunk.targetMinutes} min`);
}

const agoText = iso => (iso ? `${c.fmtDur(Date.now() - Date.parse(iso))} ago` : 'unknown');
const homeShort = p => (p ? p.replace(os.homedir(), '~') : 'unknown folder');

function sessionsCmd() {
  const ov = sessions.overview();
  if (JSON_OUT) return asJSON(ov);
  const lines = [`With the governor (${ov.governed.length}): heavy commands from these sessions go through the shared queue.`];
  for (const s of ov.governed) lines.push(`  ${s.project.padEnd(18)} pid ${s.pid || '?'} · started ${agoText(s.startedAt)} · last prompt ${agoText(s.lastSeen)} · ${homeShort(s.cwd)}`);
  if (!ov.ungoverned) {
    lines.push('Sessions without the governor cannot be listed on this OS; they only show up as CPU load.');
  } else {
    lines.push(`Without the governor (${ov.ungoverned.length}): started before the plugin was installed, or it is disabled there. Their commands are NOT queued.`);
    for (const p of ov.ungoverned) lines.push(`  ${p.project.padEnd(18)} pid ${p.pid} · ${p.app} · started ${agoText(p.startedAt)} · ${homeShort(p.cwd)}`);
    if (ov.ungoverned.length) lines.push('To bring them under the governor, restart them: quit and reopen the Claude app (desktop sessions resume where they were), or exit and restart `claude` in a terminal.');
  }
  if (ov.cowork) lines.push('Cowork: running in its own virtual machine, which this plugin does not reach; its work only shows up as CPU load and temperature.');
  out(lines.join('\n'));
}

// Projects that can compete right now, plus any the owner already ranked.
function knownProjects(policy, q, ov) {
  return [...new Set([...Object.keys(policy.priorities), ...q.tickets.map(t => t.project), ...ov.governed.map(s => s.project), ...(ov.ungoverned || []).map(p => p.project)])];
}

function priorityCmd(args) {
  const o = parseArgs(args);
  const sub = o._[0] || 'list';
  if (sub === 'list') {
    const policy = state.loadPolicy();
    const ov = sessions.overview();
    const rows = knownProjects(policy, c.cleanQueue(), ov).map(p => ({
      project: p,
      priority: Number(policy.priorities[p] || 0),
      sessionsWithGovernor: ov.governed.filter(s => s.project === p).length,
      sessionsWithoutGovernor: ov.ungoverned ? ov.ungoverned.filter(s => s.project === p).length : null,
    })).sort((a, b) => b.priority - a.priority ||
      (b.sessionsWithGovernor + (b.sessionsWithoutGovernor || 0)) - (a.sessionsWithGovernor + (a.sessionsWithoutGovernor || 0)) ||
      a.project.localeCompare(b.project));
    if (JSON_OUT) return asJSON({ projects: rows, sessionsListed: ov.scanSupported, coworkRunning: ov.cowork });
    const without = rows.reduce((n, r) => n + (r.sessionsWithoutGovernor || 0), 0);
    return out([
      'Projects with Claude sessions running on this device now (any folder), plus any you already ranked. Higher number goes first; equal numbers are first come, first served.',
      `  ${'pri'.padStart(4)}  ${'project'.padEnd(22)}running Claude sessions`,
      ...rows.map(r => `  ${String(r.priority).padStart(4)}  ${r.project.padEnd(22)}${r.sessionsWithGovernor} with governor` +
        `${r.sessionsWithoutGovernor == null ? '' : `, ${r.sessionsWithoutGovernor} without`}`),
      without ? `Priorities only order jobs from sessions WITH the governor. The ${without} session(s) without it ignore the queue until restarted (gov sessions).` : '',
      ov.cowork ? 'Cowork runs in its own virtual machine and is not governed.' : '',
    ].filter(Boolean).join('\n'));
  }
  const project = o._[1];
  if (!project) fail(`usage: gov priority ${sub} <project>${sub === 'set' ? ' <n>' : ''}`, 2);
  let n = 0;
  if (sub === 'set') {
    n = Number(o._[2]);
    if (!Number.isFinite(n)) fail('priority must be a number', 2);
  } else if (sub !== 'clear') fail(`unknown: gov priority ${sub}`, 2);
  state.withLock(() => {
    const policy = state.loadPolicy();
    if (sub === 'set') policy.priorities[project] = n; else delete policy.priorities[project];
    state.savePolicy(policy);
    const q = state.loadQueue();
    state.pruneDead(q);
    c.sortWaitingByPriority(q, policy);
    state.saveQueue(q);
  });
  state.logOwner({ action: `priority ${sub}`, project, priority: n });
  out(sub === 'set' ? `Priority of ${project} set to ${n}; waiting jobs re-ordered.` : `Priority of ${project} cleared.`);
}

function queueCmd(args) {
  const o = parseArgs(args);
  const sub = o._[0] || 'list';
  if (sub === 'list') return queueList();
  const id = o._[1];
  if (!id) fail(`usage: gov queue ${sub} <id>`, 2);
  const result = state.withLock(() => {
    const q = state.loadQueue();
    state.pruneDead(q);
    const t = q.tickets.find(x => x.id === id);
    if (!t) return { err: `no job ${id} in the queue` };
    if (sub === 'move') {
      if (t.state !== 'waiting') return { err: 'only waiting jobs can be moved' };
      const w = c.waiting(q).filter(x => x.id !== id);
      const pos = Math.min(Math.max(1, Number(o._[2]) || 1), w.length + 1);
      w.splice(pos - 1, 0, t);
      q.tickets = [...c.running(q), ...w];
      state.saveQueue(q);
      return { msg: `${id} moved to position ${pos}.` };
    }
    if (sub === 'pause' || sub === 'resume') {
      if (t.state !== 'waiting') return { err: 'only waiting jobs can be paused or resumed (a running job keeps running)' };
      t.paused = sub === 'pause';
      state.saveQueue(q);
      return { msg: `${id} ${sub === 'pause' ? 'paused — it keeps its place but others may start' : 'resumed'}.` };
    }
    if (sub === 'cancel') {
      if (t.state === 'running') {
        if (!o.kill) return { err: `${id} is running. Re-run with --kill to stop it (its session will see the run end).` };
        try { process.kill(t.pid, 'SIGTERM'); } catch (e) { return { err: `could not stop pid ${t.pid}: ${e.message}` }; }
        return { msg: `Stop signal sent to ${id} (pid ${t.pid}).` };
      }
      q.tickets = q.tickets.filter(x => x.id !== id);
      state.saveQueue(q);
      return { msg: `${id} cancelled; its session is told it did not run.` };
    }
    return { err: `unknown: gov queue ${sub}` };
  });
  if (result.err) fail(result.err, 2);
  state.logOwner({ action: `queue ${sub}`, id, args: o._.slice(2), kill: !!o.kill });
  out(result.msg);
}

function decideCmd(args) {
  const o = parseArgs(args);
  const [id, choice] = o._;
  if (!id || !choice) fail('usage: gov decide <decision-id> <option> [--note TEXT]', 2);
  const result = state.withLock(() => {
    const d = state.loadDecisions();
    const item = d.items.find(x => x.id === id);
    if (!item) return { err: `no decision ${id}` };
    if (item.status !== 'pending') return { err: `${id} is already ${item.status}` };
    if (!item.options.some(x => x.key === choice)) return { err: `option must be one of: ${item.options.map(x => x.key).join(', ')}` };
    let effect = 'recorded';
    if (item.kind === 'long-wait') {
      const q = state.loadQueue();
      const t = q.tickets.find(x => x.id === item.ticketId && x.state === 'waiting');
      if (t && choice === 'front') {
        q.tickets = [...c.running(q), t, ...c.waiting(q).filter(x => x.id !== t.id)];
        state.saveQueue(q);
        effect = `${t.id} moved to the front`;
      } else if (t && choice === 'cancel') {
        q.tickets = q.tickets.filter(x => x.id !== t.id);
        state.saveQueue(q);
        effect = `${t.id} cancelled`;
      } else if (!t) effect = 'the job is no longer waiting; nothing to change';
    } else if (item.kind === 'hot' && choice === 'reduce') {
      // Changes only the worker count; an unconfirmed proposal stays unconfirmed until the owner runs setup.
      const dev = state.loadDevice();
      const target = dev.budget || dev.proposal;
      if (target && target.workers) {
        target.workers[item.context.workerKey] = item.context.to;
        state.saveDevice(dev);
        effect = `${item.context.workerKey} workers now ${item.context.to}${dev.budget ? '' : ' (in the proposal; the budget is still unconfirmed)'}`;
      }
    } else if (item.kind === 'split' && choice === 'split') {
      effect = `propose a split of "${item.context.label}" (${item.context.project}) and get the owner's approval before running it`;
    }
    Object.assign(item, { status: 'resolved', choice, note: o.note || null, resolvedAt: nowIso() });
    state.saveDecisions(d);
    return { item, effect };
  });
  if (result.err) fail(result.err, 2);
  state.logOwner({ action: 'decide', id, kind: result.item.kind, choice, note: o.note || null });
  out(`Recorded owner decision ${id}: ${choice} — ${result.effect}.`);
}

// ---------- run through the queue ----------

const WORKER_KEY = { e2e: 'e2e', tests: 'tests', build: 'build' };

async function runCmd(args) {
  const o = parseArgs(args);
  const parts = o.rest || o._;
  if (!parts.length) fail("usage: gov run [--label TEXT] [--class heavy|medium] [--max-wait MIN] -- '<command>'", 2);
  const command = parts.length === 1 ? parts[0] : parts.join(' ');
  const policy = state.loadPolicy();
  const cl = classify(command, policy);
  const cls = ['heavy', 'medium'].includes(o.class) ? o.class : (cl.cls === 'light' ? 'medium' : cl.cls);
  const dev = c.ensureDevice();
  const budget = c.effectiveBudget(dev);
  const project = state.projectOf(process.cwd());
  const label = typeof o.label === 'string' && o.label.trim() ? o.label.trim() : (cl.reason || command.slice(0, 40));
  const key = `${project}::${cl.reason || label}`;
  const maxWaitMin = Number(o['max-wait']) > 0 ? Number(o['max-wait']) : policy.queue.maxWaitMin;
  const ticket = {
    id: state.newId('t-'), label, cls, kind: cl.kind, key, project,
    command: command.slice(0, 500), cwd: process.cwd(), pid: process.pid,
    state: 'waiting', enqueuedAt: nowIso(),
  };

  let child = null, stopSignal = null;
  const dequeue = () => {
    try { state.withLock(() => { const q = state.loadQueue(); q.tickets = q.tickets.filter(t => t.id !== ticket.id); state.saveQueue(q); }); } catch {}
  };
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => {
      stopSignal = sig;
      if (child && child.exitCode === null && child.signalCode === null) { try { child.kill(sig); } catch {} return; }
      dequeue();
      process.exit(128 + (os.constants.signals[sig] || 1));
    });
  }

  state.withLock(() => {
    const q = state.loadQueue();
    state.pruneDead(q);
    c.insertByPriority(q, ticket, policy);
    state.saveQueue(q);
  });
  const est = c.estimateMs(key);
  const log = s => process.stderr.write(`[gov] ${s}\n`);
  log(`queued ${ticket.id} · [${project}] ${label} (${cls})${est ? ` · similar runs took ~${c.fmtDur(est)}` : ''}${budget.confirmed ? '' : ' · budget not yet confirmed by the owner'}`);

  const t0 = Date.now();
  let cpuHighSince = null, lastMsg = '', lastPrint = 0, escalated = false;
  for (;;) {
    const load = await device.live(400);
    const verdict = state.withLock(() => {
      const q = state.loadQueue();
      const pruned = state.pruneDead(q);
      const me = q.tickets.find(t => t.id === ticket.id);
      if (!me) return { cancelled: true };
      const g = c.gate(me, q, budget, load, policy, cpuHighSince);
      if (g.go) { me.state = 'running'; me.startedAt = nowIso(); }
      if (g.go || pruned) state.saveQueue(q);
      return g;
    });
    if (verdict.cancelled) { log('cancelled by the owner — the command was NOT run.'); process.exit(130); }
    if (verdict.go) {
      if (verdict.externalLoad) log(`CPU stayed busy for ${policy.queue.cpuWaitMaxSec}s with no queued job running (load from outside the queue) — starting per the owner's grace period.`);
      break;
    }
    cpuHighSince = verdict.cpuHigh ? (cpuHighSince || Date.now()) : null;
    const waitedMs = Date.now() - t0;
    const msg = verdict.reasons.join(' · ');
    if (msg !== lastMsg || Date.now() - lastPrint > 60000) {
      log(`waiting ${c.fmtDur(waitedMs)} — ${msg}`);
      lastMsg = msg;
      lastPrint = Date.now();
    }
    if (!escalated && waitedMs >= policy.queue.escalateAfterMin * 60000) {
      escalated = true;
      const d = state.raiseDecision({
        kind: 'long-wait', key: `long-wait::${ticket.id}`, ticketId: ticket.id,
        question: `"[${project}] ${label}" has waited ${c.fmtDur(waitedMs)} (${msg}). What should happen?`,
        options: [
          { key: 'wait', label: 'Keep waiting its turn' },
          { key: 'front', label: 'Move it to the front of the queue' },
          { key: 'cancel', label: 'Cancel it' },
        ],
      });
      if (d) log(`asked the owner what to do (decision ${d.id}); still waiting meanwhile.`);
    }
    if (waitedMs >= maxWaitMin * 60000) {
      dequeue();
      log(`gave up after ${maxWaitMin} min in the queue (owner's limit) — the command was NOT run. Ask the owner before retrying.`);
      process.exit(75);
    }
    await sleep(4000);
  }
  c.expireDecisions(d => d.ticketId === ticket.id);

  const waitedSec = Math.round((Date.now() - t0) / 1000);
  log(`▶ starting [${project}] ${label} after ${c.fmtDur(waitedSec * 1000)} in the queue (lower OS priority, nice ${budget.nice})`);
  const started = Date.now();
  let peakCpu = null, peakTemp = null, cpuSum = 0, samples = 0;
  child = spawn(command, { shell: true, stdio: 'inherit', env: { ...process.env, WG_TICKET: ticket.id, WG_CLASS: cls } });
  try { os.setPriority(child.pid, budget.nice ?? 10); } catch {}
  const sampler = setInterval(() => {
    device.live(300).then(l => {
      if (l.cpuPct != null) { peakCpu = Math.max(peakCpu ?? 0, l.cpuPct); cpuSum += l.cpuPct; samples++; }
      if (l.tempC != null) peakTemp = Math.max(peakTemp ?? 0, l.tempC);
    }).catch(() => {});
  }, 15000);
  const { code, signal } = await new Promise(resolve => {
    child.on('exit', (code, signal) => resolve({ code, signal }));
    child.on('error', err => { log(`could not start: ${err.message}`); resolve({ code: 127, signal: null }); });
  });
  clearInterval(sampler);
  dequeue();

  const durationSec = Math.round((Date.now() - started) / 1000);
  const exitCode = code ?? 128 + (os.constants.signals[signal] || 1);
  const stopped = Boolean(stopSignal || signal || [124, 137, 143].includes(exitCode));
  const avgCpu = samples ? Math.round(cpuSum / samples) : null;
  state.appendJSONL(state.FILES.history, {
    id: ticket.id, project, label, cls, kind: cl.kind, key, command: command.slice(0, 200), cwd: process.cwd(),
    enqueuedAt: ticket.enqueuedAt, startedAt: new Date(started).toISOString(), endedAt: nowIso(),
    waitedSec, durationSec, exitCode, signal: signal || stopSignal, stopped, peakCpuPct: peakCpu, avgCpuPct: avgCpu, peakTempC: peakTemp,
  });
  log(`${exitCode === 0 ? '✔ finished' : stopped ? '■ stopped' : `✖ exited ${exitCode}`} after ${c.fmtDur(durationSec * 1000)} (waited ${c.fmtDur(waitedSec * 1000)})` +
    `${peakCpu != null ? ` · peak CPU ${peakCpu}%` : ''}${peakTemp != null ? ` · peak ${peakTemp}°C` : ''}`);

  // Observations go to the owner as questions; nothing is changed here.
  if (stopped) {
    const d = state.raiseDecision({
      kind: 'split', key: `split::${key}`, context: { project, label, command: command.slice(0, 200) },
      question: `"[${project}] ${label}" was stopped or timed out after ${c.fmtDur(durationSec * 1000)}. Break it into smaller runs (shards, folders or files) before the next attempt?`,
      options: [
        { key: 'split', label: 'Yes — Claude proposes a split for my approval' },
        { key: 'keep', label: 'No — keep running it whole' },
      ],
    });
    if (d) log(`asked the owner whether to split this run (decision ${d.id}).`);
  }
  const workerKey = WORKER_KEY[cl.kind];
  const tooHot = (budget.thresholds.tempPauseC && peakTemp != null && peakTemp >= budget.thresholds.tempPauseC + 5) ||
    (avgCpu != null && avgCpu >= 95 && durationSec >= 120);
  const workers = workerKey && budget.workers[workerKey];
  if (tooHot && workers > 1) {
    const d = state.raiseDecision({
      kind: 'hot', key: `hot::${workerKey}`, context: { workerKey, from: workers, to: workers - 1 },
      question: `"[${project}] ${label}" ran the device hard (${peakTemp != null ? `peak ${peakTemp}°C, ` : ''}average CPU ${avgCpu ?? '?'}%). Lower ${workerKey} workers from ${workers} to ${workers - 1}?`,
      options: [
        { key: 'reduce', label: `Yes — use ${workers - 1} ${workerKey} workers` },
        { key: 'keep', label: `No — keep ${workers}` },
      ],
    });
    if (d) log(`asked the owner whether to lower ${workerKey} workers (decision ${d.id}).`);
  }
  process.exit(exitCode);
}

async function main() {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case 'status': return status();
    case 'sessions': return sessionsCmd();
    case 'profile': return profileCmd();
    case 'advise': return adviseCmd();
    case 'queue': return queueCmd(rest);
    case 'history': return historyCmd(rest);
    case 'decisions': return decisionsCmd();
    case 'classify': return classifyCmd(rest);
    case 'budget': return budgetCmd(rest);
    case 'policy': return policyCmd(rest);
    case 'priority': case 'priorities': return priorityCmd(rest);
    case 'decide': return decideCmd(rest);
    case 'run': return runCmd(rest);
    case undefined: case 'help': case '--help': case '-h': return out(HELP);
    default: return fail(`unknown command "${cmd}"\n\n${HELP}`, 2);
  }
}

main().catch(err => fail(err.message));
