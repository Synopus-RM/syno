// Chunk 2.9: Chronicle's hook (PRD CH-12, AC-CH-12.1, AC-CH-12.2).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { handle } from "../scripts/lib/chronicle/hooks.js";
import { fixtureB, tag, tmp } from "./fixtures.js";

const CLI = fileURLToPath(new URL("../scripts/syno.js", import.meta.url));
const RUN = fileURLToPath(new URL("../scripts/hooks/run.js", import.meta.url));
const syno = (repo, ...args) => spawnSync(process.execPath, [CLI, ...args, "--repo", repo, "--now", "2026-10-30T10:15:00"], { encoding: "utf8" });
// Hooks run in a throwaway HOME and Governor state folder, never the owner's real ones.
const sandboxEnv = () => {
  const home = tmp("home");
  return { ...process.env, HOME: home, USERPROFILE: home, WG_HOME: tmp("wg"), CLAUDE_ENV_FILE: join(home, "env.sh") };
};
const bash = (command, stderr = "") => ({ tool_name: "Bash", tool_input: { command }, tool_response: { stdout: "", stderr } });

const repo = fixtureB();
syno(repo, "init", "--confirm");

test("AC-CH-12.1 in an uninitialised folder the hook says nothing", () => {
  const plain = tmp("plain");
  assert.equal(handle("SessionStart", {}, { cwd: plain }), null);
  assert.equal(handle("PostToolUse", bash("git tag v1.0.0"), { cwd: plain }), null);
  const res = spawnSync(process.execPath, [RUN, "SessionStart"], { input: JSON.stringify({ cwd: plain }), env: sandboxEnv(), encoding: "utf8" });
  assert.doesNotMatch(res.stdout, /Chronicle/);
});

test("CH-12.1 the session brief names the version, waiting changes and unrecorded tags", () => {
  tag(repo, "v1.0.1", "2026-04-01T09:00:00Z");
  const { lines } = handle("SessionStart", {}, { cwd: repo });
  assert.equal(lines[0], "Chronicle: version 1.0.0 · 0 changes waiting · 0 ideas in progress.");
  assert.match(lines[1], /1 version tag not recorded yet \(v1\.0\.1\)\. Offer \/syno:sync\./);
});

test("CH-12.2 a successful git tag gets a one-line nudge; listing, deleting and failures don't", () => {
  assert.match(handle("PostToolUse", bash("git tag -a v2.0.0 -m 'v2'"), { cwd: repo }).context, /\/syno:sync/);
  assert.match(handle("PostToolUse", bash("npm test && git tag v2.0.0"), { cwd: repo }).context, /git tag was just made/);
  for (const quiet of ["git tag --list", "git tag -l 'v*'", "git tag -d v2.0.0", "git status"]) assert.equal(handle("PostToolUse", bash(quiet), { cwd: repo }), null, quiet);
  assert.equal(handle("PostToolUse", bash("git tag v1.0.0", "fatal: tag 'v1.0.0' already exists"), { cwd: repo }), null);
  assert.equal(handle("PostToolUse", bash("git commit -m x"), { cwd: repo }), null, "commit nudges are off by default");
});

test("CH-12.2 nudges follow config: commits when asked, nothing when off", () => {
  const file = join(repo, ".syno/config.json");
  const config = JSON.parse(spawnSync("cat", [file], { encoding: "utf8" }).stdout);
  writeFileSync(file, JSON.stringify({ ...config, chronicle: { ...config.chronicle, nudges: "commits" } }));
  assert.match(handle("PostToolUse", bash("git commit -m 'fix: x'"), { cwd: repo }).context, /offer one change entry/);
  writeFileSync(file, JSON.stringify({ ...config, chronicle: { ...config.chronicle, nudges: "off" } }));
  assert.equal(handle("PostToolUse", bash("git tag v3.0.0"), { cwd: repo }), null);
  writeFileSync(file, JSON.stringify(config));
});

test("AC-CH-12.2 a forced internal error in a hook still exits 0", () => {
  const broken = tmp("broken");
  spawnSync("mkdir", ["-p", join(broken, ".syno")]);
  writeFileSync(join(broken, ".syno/config.json"), "{ this is not json");
  writeFileSync(join(broken, ".syno/ideas"), "a file where a folder should be");
  const res = spawnSync(process.execPath, [RUN, "SessionStart"], { input: JSON.stringify({ cwd: broken }), env: sandboxEnv(), encoding: "utf8" });
  assert.equal(res.status, 0);
});

test("CH-12 the hook stays well under its 1 s budget", () => {
  const started = process.hrtime.bigint();
  handle("SessionStart", {}, { cwd: repo });
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(ms < 1000, `${ms.toFixed(0)} ms`);
});
