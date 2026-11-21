// S-17 Syno Console: root, branch, role, config, records and the write plan (AC-CN.8).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { commit, initRepo, tmp } from "./fixtures.js";
import {
  Plan,
  ROLE_PATH,
  currentBranch,
  findRoot,
  listRecords,
  loadConfig,
  mergeConsoleConfig,
  nextNumber,
  resolveRole,
} from "../skills/console/scripts/store.mjs";

const git = (repo, ...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });

test("findRoot and currentBranch read git through the file system", () => {
  const repo = initRepo("console-root");
  commit(repo, "init", undefined, { "src/a.js": "a\n" });
  git(repo, "checkout", "-q", "-b", "claude/syno-pha-m100");
  assert.equal(findRoot(join(repo, "src")), repo);
  assert.equal(currentBranch(repo), "claude/syno-pha-m100");
  assert.equal(findRoot(tmp("no-git")), null);
});

test("Plan writes only with confirm and skips unchanged files", () => {
  const root = tmp("console-plan");
  const plan = new Plan(root).write("a/b.json", "x\n");
  assert.deepEqual(plan.describe(), ["create  a/b.json"]);
  assert.equal(plan.apply({ confirm: false }).applied, false);
  assert.equal(existsSync(join(root, "a/b.json")), false);
  assert.equal(plan.apply({ confirm: true }).applied, true);
  assert.equal(readFileSync(join(root, "a/b.json"), "utf8"), "x\n");
  assert.equal(new Plan(root).write("a/b.json", "x\n").empty, true);
});

test("Plan refuses ../ and symlinks out of the root", () => {
  const root = tmp("console-plan-root");
  const outside = tmp("console-outside");
  assert.throws(() => new Plan(root).write("../x.json", "x"), (e) => e.exit === 3);
  symlinkSync(outside, join(root, "link"));
  assert.throws(() => new Plan(root).write("link/x.json", "x"), (e) => e.exit === 3);
});

test("listRecords skips bad JSON and reports it", () => {
  const root = tmp("console-records");
  mkdirSync(join(root, ".syno/console/nodes"), { recursive: true });
  writeFileSync(join(root, ".syno/console/nodes/A.json"), JSON.stringify({ id: "A", status: "running" }));
  writeFileSync(join(root, ".syno/console/nodes/N.json"), "{ not json");
  const { records, skipped } = listRecords(root, "nodes");
  assert.deepEqual(records.map((r) => r.id), ["A"]);
  assert.deepEqual(skipped, [".syno/console/nodes/N.json"]);
  assert.deepEqual(listRecords(root, "decisions"), { records: [], skipped: [] });
});

test("resolveRole infers from the branch when the role file is missing", () => {
  const repo = initRepo("console-role");
  commit(repo, "init");
  git(repo, "checkout", "-q", "-b", "claude/syno-pha-m100");
  const cfg = loadConfig(repo);
  const role = resolveRole(repo, cfg);
  assert.equal(role.level, "milestone");
  assert.equal(role.id, "A.M100");
  assert.equal(role.branch, "claude/syno-pha-m100");
  assert.equal(role.parentBranch, "claude/syno-phase-a");
  assert.equal(role.inferred, true);
  mkdirSync(join(repo, ".syno/local/console"), { recursive: true });
  writeFileSync(join(repo, ROLE_PATH), JSON.stringify({ level: "task", id: "A.M100.T04", branch: "claude/syno-pha-m100-t04" }));
  assert.equal(resolveRole(repo, cfg).id, "A.M100.T04");
  assert.equal(resolveRole(repo, cfg).inferred, false);
  git(repo, "checkout", "-q", "-b", "main-like");
  writeFileSync(join(repo, ROLE_PATH), "{}");
  assert.equal(resolveRole(repo, cfg), null);
});

test("loadConfig fills defaults and the project name", () => {
  const root = tmp("console-config");
  mkdirSync(join(root, ".syno"), { recursive: true });
  writeFileSync(join(root, ".syno/config.json"), JSON.stringify({ project: { name: "Demo" }, console: { askAt: "phase" } }));
  const cfg = loadConfig(root);
  assert.equal(cfg.askAt, "phase");
  assert.equal(cfg.limits.maxTasks, 3);
  assert.equal(cfg.project, "Demo");
});

test("mergeConsoleConfig keeps the compliance group", () => {
  const before = JSON.stringify({ compliance: { jurisdictions: [{ country: "IN" }] }, console: { label: "x" } });
  const after = JSON.parse(mergeConsoleConfig(before, { askAt: "phase" }));
  assert.deepEqual(after.compliance, { jurisdictions: [{ country: "IN" }] });
  assert.deepEqual(after.console, { label: "x", askAt: "phase" });
  assert.deepEqual(JSON.parse(mergeConsoleConfig(null, { askAt: "console" })), { console: { askAt: "console" } });
});

test("AC-CN.8 nextNumber never reuses a number", () => {
  assert.equal(nextNumber([{ id: "D-0001" }, { id: "D-0003" }], "D"), "D-0004");
  assert.equal(nextNumber([], "R"), "R-0001");
  assert.equal(nextNumber([{ id: "x" }], "D"), "D-0001");
});
