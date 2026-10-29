// Syno Pulse: facts from Bash commands (ported from Synopus Insider, F-04): commits, test runs and builds. Reads the
// command and its output only to pull out a SHA, a subject and counts; the
// output itself never leaves the machine.

const RUNNER_TEST =
  /\b(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test(?::[\w-]+)?|vitest|jest|playwright\s+test|pytest|flutter\s+test|node\s+--test|go\s+test|cargo\s+test)\b/;
const RUNNER_BUILD =
  /\b(?:(?:next|vite|nuxt|astro)\s+build|(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?build(?::[\w-]+)?|flutter\s+build|cargo\s+build|gradlew?\s+\S*(?:assemble|build))\b/;
const GIT_COMMIT = /\bgit\s+(?:-[^\s]+\s+)*commit\b(?!.*--dry-run)/;

// "[main 1a2b3c4] feat: subject" or "[main (root-commit) 1a2b3c4] init".
const COMMIT_LINE = /^\[([^\s\]]+)(?: \([^)]+\))? ([0-9a-f]{7,40})\] (.+)$/m;

function lastCount(output, words) {
  let value;
  const re = new RegExp(`(\\d+)\\s+(?:tests?\\s+)?(?:${words})\\b|#\\s*(?:${words})\\s+(\\d+)`, "gi");
  for (const m of output.matchAll(re)) value = Number(m[1] ?? m[2]);
  return value;
}

/** Pass/fail/skip counts from vitest, jest, playwright, pytest, node:test and flutter output. */
export function parseTestCounts(output) {
  let passed = lastCount(output, "passed|pass");
  let failed = lastCount(output, "failed|fail");
  const skipped = lastCount(output, "skipped|skip|todo");
  const flutter = /\+(\d+)(?: ~(\d+))?(?: -(\d+))?: (?:All tests passed|Some tests failed)/.exec(output);
  if (flutter) {
    passed = Number(flutter[1]);
    failed = Number(flutter[3] ?? 0);
  }
  if (passed === undefined && failed === undefined) return null;
  return { passed: passed ?? 0, failed: failed ?? 0, ...(skipped !== undefined ? { skipped } : {}) };
}

function buildOutcome(output) {
  if (/Failed to compile|Build failed|BUILD FAILED|error TS\d+|Build error occurred|ELIFECYCLE/i.test(output)) return false;
  if (/Compiled successfully|✓ Compiled|Build complete|BUILD SUCCESSFUL|Finished `?release|Built .+ in \d/i.test(output)) return true;
  return undefined;
}

/**
 * Returns zero or more { type, title, data } for one Bash call. A chained
 * command (`npm test && git commit …`) can yield both a test run and a commit.
 */
export function detect(command, output = "") {
  if (typeof command !== "string") return [];
  const found = [];

  if (RUNNER_TEST.test(command)) {
    const counts = parseTestCounts(output);
    if (counts) {
      const ok = counts.failed === 0 && counts.passed > 0;
      const parts = [`${counts.passed} passed`, `${counts.failed} failed`];
      if (counts.skipped) parts.push(`${counts.skipped} skipped`);
      found.push({ type: "test_run", title: `Tests: ${parts.join(", ")}`, data: { ...counts, ok } });
    }
  }

  if (RUNNER_BUILD.test(command)) {
    const ok = buildOutcome(output);
    if (ok !== undefined) found.push({ type: "build", title: ok ? "Build succeeded" : "Build failed", data: { ok } });
  }

  if (GIT_COMMIT.test(command)) {
    const m = COMMIT_LINE.exec(output);
    if (m) found.push({ type: "commit", title: m[3], data: { branch: m[1], sha: m[2] } });
  }

  return found;
}
