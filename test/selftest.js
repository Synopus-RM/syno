#!/usr/bin/env node
// Syno's self-test (PRD §16): runs every test file, then `claude plugin
// validate` when the Claude CLI is installed, and prints one line per area.
//   node test/selftest.js          all tests
//   node test/selftest.js --perf   also the scale fixture (Chronicle fixture E)
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TEST_DIR = join(ROOT, "test");
const perf = process.argv.includes("--perf");

function runTests() {
  const testFiles = readdirSync(TEST_DIR)
    .filter((f) => f.endsWith(".test.js") && (perf || !f.endsWith(".perf.test.js")))
    .sort()
    .map((f) => join(TEST_DIR, f));
  const started = Date.now();
  const env = { ...process.env, ...(perf ? { SYNO_PERF: "1" } : {}) };
  const res = spawnSync(process.execPath, ["--test", "--test-reporter=tap", ...testFiles], { cwd: ROOT, encoding: "utf8", env });
  const count = (key) => Number((res.stdout.match(new RegExp(`^# ${key} (\\d+)`, "m")) ?? [])[1] ?? 0);
  const failed = res.stdout
    .split("\n")
    .filter((l) => /^\s*not ok \d+ - /.test(l))
    .map((l) => l.replace(/^\s*not ok \d+ - /, ""));
  return { files: testFiles.length, pass: count("pass"), fail: count("fail"), failed, ms: Date.now() - started, code: res.status };
}

function validatePlugin() {
  const res = spawnSync("claude", ["plugin", "validate", ROOT], { encoding: "utf8" });
  if (res.error) return { skipped: true };
  return { ok: res.status === 0 && /Validation passed/.test(res.stdout + res.stderr), output: (res.stdout + res.stderr).trim() };
}

const tests = runTests();
const mark = (ok) => (ok ? "✅" : "❌");
console.log(`${mark(tests.fail === 0 && tests.code === 0)} Tests — ${tests.pass} passed, ${tests.fail} failed, ${tests.files} files, ${(tests.ms / 1000).toFixed(1)} s`);
for (const name of tests.failed) console.log(`   ❌ ${name}`);

const plugin = validatePlugin();
if (plugin.skipped) console.log("⏭️  claude plugin validate — skipped (Claude CLI not found)");
else console.log(`${mark(plugin.ok)} claude plugin validate`);
if (plugin.ok === false) console.log(plugin.output);

process.exit(tests.fail === 0 && tests.code === 0 && plugin.ok !== false ? 0 : 1);
