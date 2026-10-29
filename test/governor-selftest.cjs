#!/usr/bin/env node
'use strict';
// Self-test: classification, owner-only commands, and two queued jobs taking turns. Uses a throwaway state folder.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

process.env.WG_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'wg-selftest-'));
const { classify, isGovRun, govMutation } = require('../scripts/governor/lib/classify');
const GOV = path.join(__dirname, '..', 'scripts', 'governor', 'gov.js');
const HOOK = path.join(__dirname, '..', 'scripts', 'governor', 'hooks', 'pre-bash.js');
let passed = 0;
const ok = (name, fn) => { fn(); passed++; process.stdout.write(`  ✔ ${name}\n`); };

console.log('classification');
const cases = [
  ['npx playwright test', 'heavy'], ['npx playwright test --list', 'light'], ['cd app && pnpm run test:e2e', 'heavy'],
  ['npm run build', 'heavy'], ['NODE_ENV=production next build', 'heavy'], ['./node_modules/.bin/cypress run --spec x', 'heavy'],
  ['docker compose build web', 'heavy'], ['./gradlew assembleRelease', 'heavy'], ['bash -c "npx vite build"', 'heavy'],
  ['npm test', 'medium'], ['npx jest src/a.test.ts', 'medium'], ['npx vitest run', 'medium'], ['npx tsc --noEmit', 'medium'],
  ['npm ci', 'medium'], ['pytest -v tests/', 'medium'], ['npx vitest --watch', 'light'], ['npm run dev', 'light'],
  ['git commit -m "fix playwright test flake"', 'light'], ['grep -r "next build" .', 'light'], ['ls -la', 'light'],
];
for (const [cmd, want] of cases) ok(`${want.padEnd(6)} ${cmd}`, () => assert.strictEqual(classify(cmd).cls, want, cmd));
ok('owner pattern makes storybook heavy', () => assert.strictEqual(classify('npm run storybook', { patterns: { heavy: ['^npm run storybook'] } }).cls, 'heavy'));
ok('gov run is recognised', () => assert(isGovRun(`node "/x/scripts/gov.js" run --label e2e -- 'npx playwright test'`) && isGovRun("gov run -- 'npm test'")));
ok('owner-only gov commands are detected', () => {
  assert(govMutation('gov priority set akmo 10'));
  assert(govMutation('node "/p/scripts/gov.js" queue cancel t-1'));
  assert(!govMutation('gov status') && !govMutation('gov decisions'));
});

console.log('project names');
const { projectOf } = require('../scripts/governor/lib/state');
const repos = fs.mkdtempSync(path.join(process.env.WG_HOME, 'repos-'));
const main = path.join(repos, 'Akmo Invoice');
const linked = path.join(main, '.claude', 'worktrees', 'console-v2');
const sub = path.join(main, 'vendor', 'lib');
fs.mkdirSync(path.join(main, '.git', 'worktrees', 'console-v2'), { recursive: true });
fs.mkdirSync(path.join(linked, 'packages', 'db'), { recursive: true });
fs.writeFileSync(path.join(linked, '.git'), `gitdir: ${path.join(main, '.git', 'worktrees', 'console-v2')}\n`);
fs.mkdirSync(sub, { recursive: true });
fs.writeFileSync(path.join(sub, '.git'), 'gitdir: ../../.git/modules/lib\n');
ok('main checkout is named after its folder', () => assert.strictEqual(projectOf(main), 'Akmo Invoice'));
ok('worktree counts as its main repository', () => assert.strictEqual(projectOf(path.join(linked, 'packages', 'db')), 'Akmo Invoice'));
ok('relative gitdir in a worktree is resolved', () => {
  fs.writeFileSync(path.join(linked, '.git'), 'gitdir: ../../../.git/worktrees/console-v2\n');
  assert.strictEqual(projectOf(linked), 'Akmo Invoice');
});
ok('submodule keeps its own name', () => assert.strictEqual(projectOf(sub), 'lib'));

console.log('sessions');
const sessions = require('../scripts/governor/lib/sessions');
ok('a session registers under its main project and is listed as running', () => {
  sessions.register({ sessionId: 'sess-a', cwd: path.join(linked, 'packages', 'db'), source: 'startup', pid: null });
  const g = sessions.governed();
  assert.deepStrictEqual(g.map(s => [s.sessionId, s.project]), [['sess-a', 'Akmo Invoice']]);
});
ok('priority list includes projects of running sessions', () => {
  const rows = JSON.parse(execFileSync('node', [path.join(__dirname, '..', 'scripts', 'governor', 'gov.js'), 'priority', '--json'], { encoding: 'utf8' })).projects;
  assert(rows.some(r => r.project === 'Akmo Invoice' && r.sessionsWithGovernor === 1));
});
ok('SessionEnd removes the session', () => {
  execFileSync('node', [path.join(__dirname, '..', 'scripts', 'governor', 'hooks', 'session-end.js')], { input: JSON.stringify({ session_id: 'sess-a' }) });
  assert.strictEqual(sessions.governed().length, 0);
});
ok('a session whose process is gone is dropped', () => {
  sessions.register({ sessionId: 'sess-dead', cwd: main, pid: 2 ** 22 + 12345 });
  assert.strictEqual(sessions.governed().length, 0);
});

const hook = (input, extraEnv = {}) => {
  const out = execFileSync('node', [HOOK], { input: JSON.stringify(input), env: { ...process.env, ...extraEnv }, encoding: 'utf8' });
  return out ? JSON.parse(out).hookSpecificOutput : null;
};
const gov = (...args) => execFileSync('node', [GOV, ...args], { encoding: 'utf8' });

console.log('hook');
ok('light command passes silently', () => assert.strictEqual(hook({ tool_name: 'Bash', tool_input: { command: 'ls' } }), null));
ok('owner-only command asks the owner', () => assert.strictEqual(hook({ tool_name: 'Bash', tool_input: { command: 'gov policy set mode=queue' } }).permissionDecision, 'ask'));
// Test budget: one job at a time; CPU/temperature thresholds out of reach so the host's real load cannot interfere.
gov('budget', 'set', '--preset', 'balanced', 'slots.heavy=1', 'slots.total=1', 'thresholds.cpuStartBelowPct=101', 'thresholds.tempPauseC=null', 'thresholds.memMinFreeMB=0');
gov('policy', 'set', 'mode=queue');
ok('queue mode denies a heavy command with the gov run line', () => {
  const r = hook({ tool_name: 'Bash', tool_input: { command: 'npx playwright test' } });
  assert.strictEqual(r.permissionDecision, 'deny');
  assert(r.permissionDecisionReason.includes("gov run --label 'playwright test' --class heavy -- 'npx playwright test'"));
});

console.log('queue');
const run = (label, secs) => new Promise(resolve => {
  const p = spawn('node', [GOV, 'run', '--label', label, '--class', 'heavy', '--', `node -e "setTimeout(()=>{},${secs * 1000})"`], { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  p.stderr.on('data', d => { err += d; });
  p.on('exit', code => resolve({ code, err, end: Date.now() }));
});
(async () => {
  const first = run('first', 3);
  await new Promise(r => setTimeout(r, 800));
  const second = run('second', 1);
  await new Promise(r => setTimeout(r, 1200));
  const mid = JSON.parse(gov('queue', '--json'));
  ok('second job waits while the first runs', () => {
    assert.deepStrictEqual(mid.map(t => [t.label, t.state]), [['first', 'running'], ['second', 'waiting']]);
  });
  const [a, b] = await Promise.all([first, second]);
  ok('both finish, one after the other', () => {
    assert.strictEqual(a.code, 0);
    assert.strictEqual(b.code, 0);
    assert(b.end > a.end, 'second ended after first');
    assert(/waiting .*heavy slots full/.test(b.err), 'second reported why it waited');
  });
  ok('history recorded both runs', () => assert.strictEqual(JSON.parse(gov('history', '--json')).length, 2));
  const failed = await new Promise(resolve => spawn('node', [GOV, 'run', '--', 'exit 3'], { stdio: 'ignore' }).on('exit', resolve));
  ok('failing command returns its own exit code', () => assert.strictEqual(failed, 3));
  fs.rmSync(process.env.WG_HOME, { recursive: true, force: true });
  console.log(`\n${passed} checks passed.`);
})().catch(e => { console.error(e); process.exit(1); });
