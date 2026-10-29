'use strict';
// Shared state for every Claude Code session on this device: one budget, one policy, one queue.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const HOME = process.env.WG_HOME || path.join(os.homedir(), '.claude', 'workload-governor');
const FILES = {
  home: HOME,
  device: path.join(HOME, 'device.json'),
  policy: path.join(HOME, 'policy.json'),
  queue: path.join(HOME, 'queue.json'),
  decisions: path.join(HOME, 'decisions.json'),
  history: path.join(HOME, 'history.jsonl'),
  ownerLog: path.join(HOME, 'owner-log.jsonl'),
  seen: path.join(HOME, 'seen'),
  sessions: path.join(HOME, 'sessions'),
  lock: path.join(HOME, '.lock'),
};

// Used until the owner confirms a policy with `gov policy set`.
const DEFAULT_POLICY = {
  mode: 'ask',
  gateClasses: ['heavy'],
  priorities: {},
  patterns: { heavy: [], medium: [], light: [] },
  qc: { default: 'standard', milestoneEvery: 3 },
  chunk: { targetMinutes: 8, maxFilesPerChunk: 6 },
  queue: { escalateAfterMin: 15, maxWaitMin: 60, cpuWaitMaxSec: 180 },
  confirmedAt: null,
};

function ensureHome() {
  fs.mkdirSync(FILES.seen, { recursive: true });
  fs.mkdirSync(FILES.sessions, { recursive: true });
}

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJSON(file, data) {
  ensureHome();
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

function appendJSONL(file, obj) {
  ensureHome();
  fs.appendFileSync(file, JSON.stringify(obj) + '\n');
}

function readJSONL(file, limit) {
  let lines;
  try { lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean); } catch { return []; }
  if (limit) lines = lines.slice(-limit);
  return lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// mkdir is atomic on every OS, so it doubles as a cross-process mutex. Not re-entrant.
function withLock(fn) {
  ensureHome();
  const deadline = Date.now() + 10000;
  for (;;) {
    try { fs.mkdirSync(FILES.lock); break; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { if (Date.now() - fs.statSync(FILES.lock).mtimeMs > 15000) fs.rmdirSync(FILES.lock); } catch {}
      if (Date.now() > deadline) throw new Error('syno-governor: state lock is busy');
      sleepSync(25 + Math.random() * 50);
    }
  }
  try { return fn(); } finally { try { fs.rmdirSync(FILES.lock); } catch {} }
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(base, over) {
  if (!isPlainObject(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = isPlainObject(base && base[k]) && isPlainObject(v) ? deepMerge(base[k], v) : v;
  }
  return out;
}

const loadPolicy = () => deepMerge(DEFAULT_POLICY, readJSON(FILES.policy, {}));
const savePolicy = p => writeJSON(FILES.policy, p);
const loadDevice = () => readJSON(FILES.device, {});
const saveDevice = d => writeJSON(FILES.device, d);

function loadQueue() {
  const q = readJSON(FILES.queue, null);
  return q && Array.isArray(q.tickets) ? q : { tickets: [] };
}

function saveQueue(q) {
  q.updatedAt = new Date().toISOString();
  writeJSON(FILES.queue, q);
}

function loadDecisions() {
  const d = readJSON(FILES.decisions, null);
  return d && Array.isArray(d.items) ? d : { items: [] };
}

const saveDecisions = d => writeJSON(FILES.decisions, d);

function isAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

// Tickets whose `gov run` process died (killed, crashed, machine slept through a timeout) free their slot.
function pruneDead(q) {
  const before = q.tickets.length;
  q.tickets = q.tickets.filter(t => isAlive(t.pid));
  return before !== q.tickets.length;
}

const newId = prefix => prefix + crypto.randomBytes(3).toString('hex');

// A linked worktree's .git is a file ("gitdir: <main>/.git/worktrees/<name>"); count it as the main repository.
function repoName(d) {
  try {
    const m = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(path.join(d, '.git'), 'utf8'));
    const w = m && /^(.*)[\\/]worktrees[\\/][^\\/]+[\\/]?$/.exec(path.resolve(d, m[1].trim()));
    if (w) return path.basename(path.basename(w[1]) === '.git' ? path.dirname(w[1]) : w[1]).replace(/\.git$/, '');
  } catch {}
  return path.basename(d);
}

function projectOf(dir) {
  const start = path.resolve(dir || process.cwd());
  let d = start;
  for (;;) {
    if (fs.existsSync(path.join(d, '.git'))) return repoName(d);
    const up = path.dirname(d);
    if (up === d) return path.basename(start) || start;
    d = up;
  }
}

function logOwner(entry) {
  appendJSONL(FILES.ownerLog, { at: new Date().toISOString(), ...entry });
}

// Raised once per key while pending, so a long wait or a hot run asks the owner only once.
function raiseDecision(item) {
  return withLock(() => {
    const d = loadDecisions();
    if (d.items.some(x => x.status === 'pending' && x.key === item.key)) return null;
    const full = { id: newId('d-'), status: 'pending', createdAt: new Date().toISOString(), ...item };
    d.items = [...d.items, full].slice(-200);
    saveDecisions(d);
    return full;
  });
}

module.exports = {
  FILES, DEFAULT_POLICY,
  readJSON, writeJSON, appendJSONL, readJSONL,
  withLock, deepMerge,
  loadPolicy, savePolicy, loadDevice, saveDevice,
  loadQueue, saveQueue, loadDecisions, saveDecisions,
  isAlive, pruneDead, newId, projectOf, logOwner, raiseDecision,
};
