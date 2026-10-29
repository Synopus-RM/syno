#!/usr/bin/env node
'use strict';
// SessionStart: put `gov` on PATH for this session's Bash commands and brief Claude on the device.
const fs = require('fs');
const path = require('path');
const state = require('../lib/state');
const device = require('../lib/device');
const sessions = require('../lib/sessions');
const c = require('../lib/common');

const GOV_DIR = path.resolve(__dirname, '..'); // scripts/governor inside Syno

// Git Bash on Windows needs /c/Users/... in PATH; C:/... would split on the colon.
function shellPath(p) {
  const fwd = p.replace(/\\/g, '/');
  return process.platform === 'win32' ? fwd.replace(/^([A-Za-z]):\//, (_, d) => `/${d.toLowerCase()}/`) : fwd;
}

function exportPath() {
  const envFile = process.env.CLAUDE_ENV_FILE;
  if (!envFile) return;
  const line = `export PATH="$PATH:${shellPath(path.join(GOV_DIR, 'bin'))}"`;
  let current = '';
  try { current = fs.readFileSync(envFile, 'utf8'); } catch {}
  if (!current.includes(line)) fs.appendFileSync(envFile, `${line}\n`);
}

function pruneSeen() {
  const weekAgo = Date.now() - 7 * 864e5;
  let files = [];
  try { files = fs.readdirSync(state.FILES.seen); } catch {}
  for (const f of files) {
    const p = path.join(state.FILES.seen, f);
    try { if (fs.statSync(p).mtimeMs < weekAgo) fs.unlinkSync(p); } catch {}
  }
}

async function run(input = {}) {
  exportPath();
  pruneSeen();
  sessions.register({ sessionId: input.session_id, cwd: input.cwd, source: input.source });
  const dev = c.ensureDevice();
  const policy = state.loadPolicy();
  const load = await device.live(300);
  const q = c.cleanQueue();
  const pending = c.liveDecisions(q);
  if (input.session_id && pending.length) {
    state.writeJSON(path.join(state.FILES.seen, `${String(input.session_id).replace(/[^\w-]/g, '_')}.json`), pending.map(d => d.id));
  }
  const brief = c.sessionBrief({ dev, policy, load, q, pending, ov: sessions.overview(), cli: path.join(GOV_DIR, 'gov.js') });
  return { additionalContext: brief };
}

module.exports = { run };

// Run on its own (outside Syno's dispatcher): read the hook input, print the reply.
if (require.main === module) {
  c.readStdin()
    .then(raw => run(JSON.parse(raw || '{}')))
    .then(out => { if (out) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', ...out } })); })
    .catch(err => process.stderr.write(`syno-governor: session brief skipped (${err.message})\n`))
    .finally(() => process.exit(0));
}
