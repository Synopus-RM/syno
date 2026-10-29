#!/usr/bin/env node
'use strict';
// UserPromptSubmit: keep this session marked as running, and bring owner decisions raised elsewhere to it once.
const path = require('path');
const state = require('../lib/state');
const sessions = require('../lib/sessions');
const c = require('../lib/common');

async function run(input = {}) {
  sessions.touch(input.session_id, input.cwd);
  if (!state.loadDecisions().items.some(d => d.status === 'pending')) return;
  const pending = c.liveDecisions(state.loadQueue());
  if (!pending.length) return;
  const seenFile = path.join(state.FILES.seen, `${String(input.session_id || 'unknown').replace(/[^\w-]/g, '_')}.json`);
  const seen = new Set(state.readJSON(seenFile, []));
  const fresh = pending.filter(d => !seen.has(d.id));
  if (!fresh.length) return;
  state.writeJSON(seenFile, [...seen, ...fresh.map(d => d.id)]);
  return { additionalContext: c.decisionsBrief(fresh) };
}

module.exports = { run };

// Run on its own (outside Syno's dispatcher): read the hook input, print the reply.
if (require.main === module) {
  c.readStdin()
    .then(raw => run(JSON.parse(raw || '{}')))
    .then(out => { if (out) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', ...out } })); })
    .catch(err => process.stderr.write(`syno-governor: decision check skipped (${err.message})\n`))
    .finally(() => process.exit(0));
}
