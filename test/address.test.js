// The install address people copy (README, plugin.json, PRD, the CI example) and the
// marketplace Syno Pulse writes into a project's settings name the repository where
// Syno lives now: Synopus-RM/syno (moved from rishimurugan-synopus/syno, Nov 2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MARKETPLACE } from "../scripts/lib/pulse/cli.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const OLD = /rishimurugan-synopus\/syno\b/;

test("§15 the install address is Synopus-RM/syno wherever people copy it", () => {
  assert.match(read("README.md"), /claude plugin marketplace add Synopus-RM\/syno\n/);
  const manifest = JSON.parse(read(".claude-plugin/plugin.json"));
  assert.equal(manifest.homepage, "https://github.com/Synopus-RM/syno");
  assert.equal(manifest.repository, "https://github.com/Synopus-RM/syno");
  for (const file of ["README.md", ".claude-plugin/plugin.json", "examples/ci/github-actions.yml"]) assert.doesNotMatch(read(file), OLD, file);
  assert.match(read("PRD.md"), /claude plugin marketplace add Synopus-RM\/syno\n/);
});

test("S-02 Pulse writes the current marketplace address into project settings", () => {
  assert.deepEqual(MARKETPLACE, { source: { source: "github", repo: "Synopus-RM/syno" } });
});

test("§15 plugin.json and package.json carry the same Syno version", () => {
  const manifest = JSON.parse(read(".claude-plugin/plugin.json"));
  const pkg = JSON.parse(read("package.json"));
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(pkg.version, manifest.version);
});
