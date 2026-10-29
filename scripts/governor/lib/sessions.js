'use strict';
// Which Claude Code sessions are running on this device, and which of them load the governor.
// Governed sessions register themselves from their hooks; every other `claude` process is found by a process scan.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const state = require('./state');

const IS_CLAUDE = /^claude(\.exe)?$/i;
const fileFor = id => path.join(state.FILES.sessions, `${String(id).replace(/[^\w-]/g, '_')}.json`);

function run(cmd, args) {
  try { return execFileSync(cmd, args, { encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }); } catch { return null; }
}

function procInfo(pid) {
  if (process.platform === 'linux') {
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      const close = stat.lastIndexOf(')');
      const rest = stat.slice(close + 2).split(' ');
      return { name: stat.slice(stat.indexOf('(') + 1, close), ppid: Number(rest[1]), startTicks: Number(rest[19]) };
    } catch { return null; }
  }
  if (process.platform === 'darwin') {
    const m = /^\s*(\d+)\s+(.+)$/.exec(run('ps', ['-o', 'ppid=,comm=', '-p', String(pid)]) || '');
    return m ? { name: path.basename(m[2].trim()), ppid: Number(m[1]) } : null;
  }
  return null;
}

// The Claude Code process that ran this hook: the nearest ancestor named `claude` (the desktop app's bundled CLI has the same name).
function claudeAncestor(startPid = process.ppid) {
  let pid = startPid;
  for (let i = 0; i < 8 && pid > 1; i++) {
    const info = procInfo(pid);
    if (!info) return null;
    if (IS_CLAUDE.test(info.name)) return pid;
    pid = info.ppid;
  }
  return null;
}

function isClaudeAlive(pid) {
  if (!state.isAlive(pid)) return false;
  const info = procInfo(pid);
  return !info || IS_CLAUDE.test(info.name);
}

function register({ sessionId, cwd, source, pid = claudeAncestor() }) {
  if (!sessionId) return null;
  const prev = state.readJSON(fileFor(sessionId), null);
  const now = new Date().toISOString();
  const entry = {
    sessionId, pid: pid || (prev && prev.pid) || null, cwd: cwd || (prev && prev.cwd) || null,
    project: state.projectOf(cwd || (prev && prev.cwd) || process.cwd()),
    startedAt: (prev && prev.startedAt) || now, lastSeen: now, source: source || null,
  };
  state.writeJSON(fileFor(sessionId), entry);
  // /clear starts a new session in the same process: the old entry for that process is finished.
  if (entry.pid) for (const s of readAll()) if (s.pid === entry.pid && s.sessionId !== sessionId) unregister(s.sessionId);
  return entry;
}

// Cheap heartbeat from UserPromptSubmit; also registers a session whose SessionStart ran before the plugin was enabled.
function touch(sessionId, cwd) {
  if (!sessionId) return;
  const s = state.readJSON(fileFor(sessionId), null);
  if (!s) return register({ sessionId, cwd, source: 'prompt' });
  if (Date.now() - Date.parse(s.lastSeen) < 60000) return;
  s.lastSeen = new Date().toISOString();
  state.writeJSON(fileFor(sessionId), s);
}

function unregister(sessionId) {
  try { fs.unlinkSync(fileFor(sessionId)); } catch {}
}

function readAll() {
  let names = [];
  try { names = fs.readdirSync(state.FILES.sessions).filter(n => n.endsWith('.json')); } catch {}
  return names.map(n => state.readJSON(path.join(state.FILES.sessions, n), null)).filter(Boolean);
}

// Registered sessions whose Claude process is still running (or, without a known pid, active in the last 6 hours).
function governed() {
  const out = [];
  for (const s of readAll()) {
    const alive = s.pid ? isClaudeAlive(s.pid) : Date.now() - Date.parse(s.lastSeen) < 6 * 3600e3;
    if (alive) out.push(s); else unregister(s.sessionId);
  }
  return out;
}

// Every Claude Code process on the device with its folder. null where the OS gives no cheap way to read it (Windows).
function claudeProcesses() {
  if (process.platform === 'linux') {
    const btime = Number((/^btime (\d+)/m.exec(fs.readFileSync('/proc/stat', 'utf8')) || [0, 0])[1]);
    const out = [];
    for (const d of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(d)) continue;
      const info = procInfo(d);
      if (!info || !IS_CLAUDE.test(info.name)) continue;
      let cwd = null, cmd = '';
      try { cwd = fs.readlinkSync(`/proc/${d}/cwd`); } catch {}
      try { cmd = fs.readFileSync(`/proc/${d}/cmdline`, 'utf8').replace(/\0/g, ' '); } catch {}
      out.push({
        pid: Number(d), cwd,
        startedAt: btime ? new Date((btime + info.startTicks / 100) * 1000).toISOString() : null,
        app: /--input-format stream-json/.test(cmd) ? 'desktop app' : 'terminal',
      });
    }
    return out;
  }
  if (process.platform === 'darwin') {
    const out = [];
    for (const line of (run('ps', ['-axo', 'pid=,lstart=,comm=']) || '').split('\n')) {
      const m = /^\s*(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+[\d:]+\s+\d{4})\s+(.+)$/.exec(line);
      if (!m || !IS_CLAUDE.test(path.basename(m[3].trim()))) continue;
      const cwdLine = (run('lsof', ['-a', '-p', m[1], '-d', 'cwd', '-Fn']) || '').split('\n').find(l => l.startsWith('n'));
      out.push({ pid: Number(m[1]), cwd: cwdLine ? cwdLine.slice(1) : null, startedAt: new Date(m[2]).toISOString(), app: 'claude' });
    }
    return out;
  }
  return null;
}

// Cowork runs its tasks inside a separate virtual machine, where this plugin does not reach.
function coworkRunning() {
  if (process.platform === 'linux') {
    for (const d of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(d)) continue;
      const info = procInfo(d);
      if (info && /^cowork/i.test(info.name)) return true;
    }
    return false;
  }
  if (process.platform === 'darwin') return /cowork/i.test(run('ps', ['-axo', 'comm=']) || '');
  return null;
}

function overview() {
  const gov = governed();
  const procs = claudeProcesses();
  const govPids = new Set(gov.map(s => s.pid).filter(Boolean));
  const byStart = (a, b) => String(a.startedAt).localeCompare(String(b.startedAt));
  gov.sort(byStart);
  const ungoverned = procs ? procs.filter(p => !govPids.has(p.pid)).map(p => ({ ...p, project: p.cwd ? state.projectOf(p.cwd) : 'unknown folder' })).sort(byStart) : null;
  return { governed: gov, ungoverned, scanSupported: procs !== null, cowork: coworkRunning(), host: os.hostname() };
}

// "2 with the governor (Claude) · 8 without it (Akmo Invoice ×8)"
function summary(ov) {
  const count = list => {
    const m = new Map();
    for (const x of list) m.set(x.project, (m.get(x.project) || 0) + 1);
    return [...m].map(([p, n]) => (n > 1 ? `${p} ×${n}` : p)).join(', ');
  };
  const parts = [`${ov.governed.length} with the governor${ov.governed.length ? ` (${count(ov.governed)})` : ''}`];
  if (ov.ungoverned) parts.push(`${ov.ungoverned.length} without it${ov.ungoverned.length ? ` (${count(ov.ungoverned)})` : ''}`);
  else parts.push('sessions without it cannot be listed on this OS');
  if (ov.cowork) parts.push('Cowork VM running (not governed)');
  return parts.join(' · ');
}

module.exports = { claudeAncestor, register, touch, unregister, governed, claudeProcesses, overview, summary };
