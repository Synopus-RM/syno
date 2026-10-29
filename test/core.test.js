// Chunk 1.2: the CLI and the safe-write core (PRD §5.1, §10, X-04).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { WritePlan, insideRoot, jsonText } from "../scripts/lib/fsutil.js";
import { checkGitArgs, git, isRepo } from "../scripts/lib/git.js";
import { runApproved } from "../scripts/lib/run.js";
import { parseArgs } from "../scripts/syno.js";

const CLI = fileURLToPath(new URL("../scripts/syno.js", import.meta.url));
const tmp = (name) => mkdtempSync(join(tmpdir(), `syno-${name}-`));
const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });

test("§5.1 a plan writes nothing without --confirm, and everything with it", () => {
  const root = tmp("plan");
  const plan = new WritePlan(root).write(".syno/config.json", jsonText({ a: 1 }));
  assert.deepEqual(plan.describe(), ["create  .syno/config.json"]);
  assert.equal(plan.apply({ confirm: false }).applied, false);
  assert.equal(existsSync(join(root, ".syno/config.json")), false);
  assert.equal(plan.apply({ confirm: true }).applied, true);
  assert.equal(readFileSync(join(root, ".syno/config.json"), "utf8"), '{\n  "a": 1\n}\n');
});

test("§5.1 a second identical plan changes nothing (idempotent)", () => {
  const root = tmp("idem");
  new WritePlan(root).write("CHANGELOG.md", "# Changelog\n").apply({ confirm: true });
  const again = new WritePlan(root).write("CHANGELOG.md", "# Changelog\n");
  assert.equal(again.empty, true);
  assert.deepEqual(again.describe(), ["No files would change."]);
});

test("§12 writes are atomic and leave no temp files behind", () => {
  const root = tmp("atomic");
  new WritePlan(root).write("docs/syno/README.md", "x\n").apply({ confirm: true });
  assert.deepEqual(readdirSync(join(root, "docs/syno")), ["README.md"]);
});

test("§10 writes outside the project are refused, including through a link", () => {
  const root = tmp("root");
  const outside = tmp("outside");
  assert.throws(() => insideRoot(root, "../evil.txt"), { exit: 3 });
  assert.throws(() => insideRoot(root, join(outside, "x")), { exit: 3 });
  symlinkSync(outside, join(root, "link"));
  assert.throws(() => new WritePlan(root).write("link/escape.txt", "x"), /through a link/);
});

test("§10 Syno removes only its own records, never project files or the trash", () => {
  const root = tmp("remove");
  mkdirSync(join(root, ".syno/changes"), { recursive: true });
  writeFileSync(join(root, ".syno/changes/a.json"), "{}");
  writeFileSync(join(root, "app.js"), "x");
  assert.throws(() => new WritePlan(root).remove("app.js"), { exit: 3 });
  assert.throws(() => new WritePlan(root).remove(".syno/trash/1/app.js"), { exit: 3 });
  new WritePlan(root).remove(".syno/changes/a.json").apply({ confirm: true });
  assert.equal(existsSync(join(root, ".syno/changes/a.json")), false);
});

test("§10 the git allowlist lets reads through and refuses every write", () => {
  for (const ok of [["log", "--oneline"], ["tag", "--list"], ["status", "--porcelain"], ["config", "--get", "user.name"], ["remote", "get-url", "origin"], ["diff", "--name-status", "-M", "a", "b"], ["ls-tree", "-r", "-l", "HEAD"]]) {
    assert.doesNotThrow(() => checkGitArgs(ok), ok.join(" "));
  }
  for (const bad of [["push"], ["fetch"], ["pull"], ["checkout", "main"], ["stash"], ["reset", "--hard"], ["commit", "-m", "x"], ["merge", "x"], ["rebase", "x"], ["tag", "v1.0.0"], ["tag", "-d", "v1"], ["tag", "-a", "v1", "-m", "x"], ["diff", "--output=x"], ["log", "--output=x"], ["config", "user.name", "Evil"], ["remote", "add", "x", "y"], ["-c", "core.pager=sh", "log"], ["status"]]) {
    assert.throws(() => checkGitArgs(bad), { exit: 3 }, bad.join(" "));
  }
  assert.doesNotThrow(() => checkGitArgs(["tag", "-a", "v1.0.0", "-m", "v1.0.0"], { allowTag: true }));
});

test("§10 git really runs read-only commands in a repository", () => {
  const repo = tmp("git");
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
  assert.equal(isRepo(repo), true);
  assert.equal(isRepo(tmp("plain")), false);
  assert.equal(git(["status", "--porcelain"], { cwd: repo }), "");
});

test("§5.2 a project command needs the owner's yes", () => {
  assert.throws(() => runApproved("echo hi", { cwd: tmp("run") }), { exit: 3 });
});

test("X-04 parseArgs reads flags in all three forms", () => {
  const { positional, flags } = parseArgs(["release", "plan", "--pre", "rc", "--json", "--repo=/x", "--confirm"]);
  assert.deepEqual(positional, ["release", "plan"]);
  assert.deepEqual(flags, { pre: "rc", json: true, repo: "/x", confirm: true });
});

test("X-04 the CLI prints its version and uses the documented exit codes", () => {
  const v = cli("version");
  assert.equal(v.status, 0);
  assert.equal(v.stdout.trim(), "0.1.0");
  assert.deepEqual(JSON.parse(cli("version", "--json").stdout), { version: "0.1.0" });
  assert.equal(cli("no-such-function").status, 2);
  assert.match(cli("help").stdout, /--confirm/);
});
