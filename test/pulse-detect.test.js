// Ported from Synopus Insider's detect.test.mjs (PRD S-02).
import assert from "node:assert/strict";
import { test } from "node:test";
import { detect, parseTestCounts } from "../scripts/lib/pulse/detect.js";

test("reads a commit's branch, SHA and subject", () => {
  const out = "[feat/pm-insider 1a2b3c4] feat(admin): hidden Google sign-in\n 3 files changed, 120 insertions(+)";
  assert.deepEqual(detect('git commit -m "feat(admin): hidden Google sign-in"', out), [
    { type: "commit", title: "feat(admin): hidden Google sign-in", data: { branch: "feat/pm-insider", sha: "1a2b3c4" } },
  ]);
  assert.equal(detect("git commit -m x", "[main (root-commit) abcdef0] init")[0].data.sha, "abcdef0");
  assert.deepEqual(detect("git commit --dry-run", "[main 1a2b3c4] x"), []);
});

test("parses counts from common test runners", () => {
  assert.deepEqual(parseTestCounts(" Test Files  4 passed (4)\n      Tests  23 passed (23)"), { passed: 23, failed: 0 });
  assert.deepEqual(parseTestCounts("Tests:       1 failed, 2 skipped, 15 passed, 18 total"), { passed: 15, failed: 1, skipped: 2 });
  assert.deepEqual(parseTestCounts("  2 failed\n  1 skipped\n  40 passed (31.2s)"), { passed: 40, failed: 2, skipped: 1 });
  assert.deepEqual(parseTestCounts("==== 3 failed, 15 passed, 1 skipped in 2.10s ===="), { passed: 15, failed: 3, skipped: 1 });
  assert.deepEqual(parseTestCounts("# tests 16\n# pass 16\n# fail 0"), { passed: 16, failed: 0 });
  assert.deepEqual(parseTestCounts("00:04 +18 -2: Some tests failed."), { passed: 18, failed: 2 });
  assert.equal(parseTestCounts("no numbers here"), null);
});

test("reports a test run, including inside a gov run wrapper", () => {
  const [run] = detect("gov run --label x -- 'npm run test:emulator'", "      Tests  18 passed (18)");
  assert.deepEqual(run, { type: "test_run", title: "Tests: 18 passed, 0 failed", data: { passed: 18, failed: 0, ok: true } });
  assert.equal(detect("npx vitest run", "Tests  1 failed | 17 passed (18)")[0].data.ok, false);
});

test("reports builds only when the outcome is clear", () => {
  assert.deepEqual(detect("npm run build", "✓ Compiled successfully in 12.3s"), [
    { type: "build", title: "Build succeeded", data: { ok: true } },
  ]);
  assert.equal(detect("next build", "Failed to compile.\n./src/x.ts")[0].data.ok, false);
  assert.deepEqual(detect("npm run build", "still building…"), []);
});

test("ignores unrelated commands and chained commands yield each fact", () => {
  assert.deepEqual(detect("ls -la", "total 8"), []);
  const facts = detect("npm test && git commit -m 'fix: x'", "Tests  5 passed (5)\n[main 9f8e7d6] fix: x");
  assert.deepEqual(facts.map((f) => f.type), ["test_run", "commit"]);
});
