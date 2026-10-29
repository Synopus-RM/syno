#!/usr/bin/env node
'use strict';
// PreToolUse(Bash): owner-only gov commands get a permission prompt; heavy commands are queued or put to the owner.
// Any error fails open: a governor bug must never stop the developer's work.
const path = require('path');
const state = require('../lib/state');
const device = require('../lib/device');
const { classify, isGovRun, govMutation } = require('../lib/classify');
const c = require('../lib/common');

const GOV_DIR = path.resolve(__dirname, '..'); // scripts/governor inside Syno
const respond = fields => fields;

async function run(input = {}) {
  if (input.tool_name && input.tool_name !== 'Bash') return;
  const cmd = String((input.tool_input && input.tool_input.command) || '');
  if (!cmd.trim()) return;

  const mutation = govMutation(cmd);
  if (mutation) {
    return respond({
      permissionDecision: 'ask',
      permissionDecisionReason: `Syno Governor — owner decision: ${mutation}. Allow only if this is what you chose.`,
    });
  }
  if (isGovRun(cmd)) return;

  const policy = state.loadPolicy();
  const cl = classify(cmd, policy);
  if (cl.cls === 'light') return;

  const dev = c.ensureDevice();
  const budget = c.effectiveBudget(dev);
  const q = state.loadQueue();
  q.tickets = q.tickets.filter(t => state.isAlive(t.pid));
  const running = c.running(q);
  const gated = policy.gateClasses.includes(cl.cls);

  if (policy.mode === 'advise' || !gated) {
    if (!q.tickets.length) return;
    const load = await device.live(250);
    return respond({ additionalContext: `Syno Governor: this was a ${cl.cls} command (${cl.reason}) while ${c.queueSummary(q)} · ${c.describeLoad(load)}.` });
  }

  const wrapped = `gov run --label ${c.shQuote(cl.reason)} --class ${cl.cls} -- ${c.shQuote(cmd)}`;
  const w = budget.workers;
  const sizing = `${budget.confirmed ? 'Owner-confirmed' : 'Proposed (not yet owner-confirmed)'} sizing: e2e workers ≤ ${w.e2e} · test workers ≤ ${w.tests} · build jobs ≤ ${w.build}`;

  if (policy.mode === 'queue') {
    const load = await device.live(250);
    return respond({
      permissionDecision: 'deny',
      permissionDecisionReason: [
        `Syno Governor (owner policy: queue) — "${cl.reason}" is a ${cl.cls.toUpperCase()} job. On this device, ${cl.cls} jobs from every session and project take turns.`,
        'Re-run it through the queue, with run_in_background: true (waiting plus running can outlast the Bash timeout; you are notified when it ends):',
        `  ${wrapped}`,
        `${sizing} — add a workers flag if the command has none (\`gov advise\`).`,
        `Queue now: ${c.queueSummary(q)} · ${c.describeLoad(load)}.`,
        'While it waits, do light work only; do not start another heavy command. Never change priorities or queue order yourself.',
        `If \`gov\` is not found, use: node "${path.join(GOV_DIR, 'gov.js')}" in its place.`,
      ].join('\n'),
    });
  }

  // mode "ask": run directly unless the device is busy, then the owner decides.
  const load = await device.live(300);
  const busy = c.busyReasons(load, budget, running, cl.cls);
  if (!busy.length) return;
  return respond({
    permissionDecision: 'ask',
    permissionDecisionReason: `Syno Governor: device busy — ${busy.map(b => b.text).join('; ')}. ` +
      'Allow = run it now alongside (slower, hotter, may time out). Deny = Claude queues it to run when the device is free.',
    additionalContext: `If the owner denied this because the device is busy, queue it instead with run_in_background: true:\n${wrapped}`,
  });
}

module.exports = { run };

// Run on its own (outside Syno's dispatcher): read the hook input, print the reply.
if (require.main === module) {
  c.readStdin()
    .then(raw => run(JSON.parse(raw || '{}')))
    .then(out => { if (out) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', ...out } })); })
    .catch(err => process.stderr.write(`syno-governor: check skipped (${err.message})\n`))
    .finally(() => process.exit(0));
}
