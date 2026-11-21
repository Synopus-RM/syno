// S-17 Syno Console: the pocket CLI that cloud sessions run (AC-CN.8 and the write rules).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { commit, initRepo } from "./fixtures.js";
import { runConsole } from "../skills/console/scripts/console.mjs";

const now = new Date("2026-11-21T10:00:00Z");
const git = (repo, ...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });
const read = (repo, rel) => readFileSync(join(repo, rel), "utf8");
const json = (repo, rel) => JSON.parse(read(repo, rel));
const run = (repo, ...argv) => runConsole(argv, { cwd: repo, now });

function repoOn(branch, config) {
  const repo = initRepo("console-cli");
  commit(repo, "init", undefined, { "README.md": "r\n" });
  git(repo, "remote", "add", "origin", "https://github.com/o/r");
  git(repo, "checkout", "-q", "-b", branch);
  if (config) {
    mkdirSync(join(repo, ".syno"), { recursive: true });
    writeFileSync(join(repo, ".syno/config.json"), JSON.stringify({ console: config }));
  }
  return repo;
}

async function consoleRepo(config) {
  const repo = repoOn("claude/syno-console", config);
  const r = await run(repo, "start", "--branch", "claude/syno-console", "--session", "s-con", "--confirm");
  assert.equal(r.code, 0, r.text);
  return repo;
}

async function taskRepo() {
  const repo = repoOn("claude/syno-pha-m1-t1");
  const r = await run(repo, "join", "--id", "A.M1.T1", "--parent-session", "s-m1", "--console-session", "s-con", "--lane", "src/a/**", "--confirm");
  assert.equal(r.code, 0, r.text);
  return repo;
}

test("start writes R-0001…R-0012, the config group, the role and .gitignore once", async () => {
  const repo = repoOn("claude/syno-console");
  const preview = await run(repo, "start", "--branch", "claude/syno-console", "--session", "s-con");
  assert.equal(preview.code, 0);
  assert.equal(existsSync(join(repo, ".syno/console/rules/R-0001.json")), false);
  await run(repo, "start", "--branch", "claude/syno-console", "--session", "s-con", "--confirm");
  for (let i = 1; i <= 12; i++) assert.ok(existsSync(join(repo, `.syno/console/rules/R-${String(i).padStart(4, "0")}.json`)), `R-${i}`);
  assert.equal(json(repo, ".syno/config.json").console.syno.branch, "claude/syno-console");
  assert.match(read(repo, ".gitignore"), /^\.syno\/local\/$/m);
  assert.equal(json(repo, ".syno/local/console/role.json").level, "console");
  assert.match(read(repo, "docs/syno/sessions.md"), /R-0012/);
  const again = await run(repo, "start", "--branch", "claude/syno-console", "--session", "s-con", "--confirm");
  assert.match(again.text, /No files would change/);
});

test("writes need --confirm", async () => {
  const repo = await consoleRepo();
  writeFileSync(join(repo, "q.json"), JSON.stringify({ scope: "project", question: "Which colour?", options: ["Blue", "Green"], chosen: "Blue", reason: "Brand" }));
  const r = await run(repo, "decide", "--file", "q.json");
  assert.equal(r.code, 0);
  assert.equal(existsSync(join(repo, ".syno/console/decisions/D-0001.json")), false);
  assert.match(r.text, /--confirm/);
});

test("AC-CN.8 decide, rule, question and numbers are Console-only", async () => {
  const repo = await taskRepo();
  writeFileSync(join(repo, "q.json"), JSON.stringify({ question: "Q?", chosen: "A", from: "A.M1.T1", text: "Q?" }));
  for (const argv of [["decide", "--file", "q.json"], ["rule", "--text", "A new rule for everyone here"], ["question", "--file", "q.json"], ["numbers", "ADR", "--to", "A.M1", "--count", "2", "--start", "1"]]) {
    const r = await run(repo, ...argv, "--confirm");
    assert.equal(r.code, 3, argv[0]);
    assert.match(r.text, /Console/);
  }
});

test("decide numbers in order and never edits an old decision", async () => {
  const repo = await consoleRepo();
  writeFileSync(join(repo, "q1.json"), JSON.stringify({ scope: "A", question: "Round half up?", options: ["Yes", "No"], chosen: "Yes", reason: "Law" }));
  await run(repo, "decide", "--file", "q1.json", "--confirm");
  const first = read(repo, ".syno/console/decisions/D-0001.json");
  writeFileSync(join(repo, "q2.json"), JSON.stringify({ scope: "A", question: "Round half up?", options: ["Yes", "No"], chosen: "No", reason: "Owner changed it", supersedes: "D-0001" }));
  const r = await run(repo, "decide", "--file", "q2.json", "--confirm");
  assert.equal(r.code, 0, r.text);
  assert.equal(read(repo, ".syno/console/decisions/D-0001.json"), first);
  assert.equal(json(repo, ".syno/console/decisions/D-0002.json").supersedes, "D-0001");
  assert.match(read(repo, "docs/syno/decisions.md"), /replaced by D-0002/);
  writeFileSync(join(repo, "q3.json"), JSON.stringify({ question: "x?", chosen: "y", supersedes: "D-0009" }));
  assert.equal((await run(repo, "decide", "--file", "q3.json", "--confirm")).code, 2);
});

test("questions are numbered per origin and closed by their decision", async () => {
  const repo = await consoleRepo();
  writeFileSync(join(repo, "in.json"), JSON.stringify({ from: "A.M1.T1", path: ["A", "A.M1", "A.M1.T1"], text: "Which rounding?", options: ["Half up (Recommended)", "Banker's"], blocking: true }));
  await run(repo, "question", "--file", "in.json", "--confirm");
  await run(repo, "question", "--file", "in.json", "--confirm");
  assert.equal(json(repo, ".syno/console/questions/Q-A.M1.T1-02.json").status, "open");
  writeFileSync(join(repo, "d.json"), JSON.stringify({ scope: "A.M1", question: "Which rounding?", chosen: "Half up", questionId: "Q-A.M1.T1-01", askedBy: "A.M1.T1" }));
  await run(repo, "decide", "--file", "d.json", "--confirm");
  const q = json(repo, ".syno/console/questions/Q-A.M1.T1-01.json");
  assert.equal(q.status, "answered");
  assert.equal(q.decision, "D-0001");
});

test("numbers hands out blocks that never overlap", async () => {
  const repo = await consoleRepo({ numbers: ["ADR"] });
  const a = await run(repo, "numbers", "ADR", "--to", "A.M1", "--count", "3", "--start", "1", "--confirm");
  assert.equal(a.code, 0, a.text);
  await run(repo, "numbers", "ADR", "--to", "A.M2", "--count", "2", "--confirm");
  const rec = json(repo, ".syno/console/numbers/ADR.json");
  assert.deepEqual(rec.blocks.map((b) => [b.to, b.from, b.until]), [["A.M1", 1, 3], ["A.M2", 4, 5]]);
  assert.equal(rec.next, 6);
  assert.equal((await run(repo, "numbers", "SEC", "--to", "A.M1", "--count", "1", "--start", "1", "--confirm")).code, 2);
});

test("record is written only by the node's parent, or an ancestor on its behalf", async () => {
  const repo = await consoleRepo();
  const ok = await run(repo, "record", "A", "--status", "running", "--session", "s-a", "--name", "Foundations", "--confirm");
  assert.equal(ok.code, 0, ok.text);
  assert.equal(json(repo, ".syno/console/nodes/A.json").sessionId, "s-a");
  const task = await taskRepo();
  assert.equal((await run(task, "record", "A.M1.T2", "--status", "running", "--confirm")).code, 3);
  assert.equal((await run(task, "record", "A.M1", "--status", "running", "--confirm")).code, 3);
  const merged = await run(repo, "record", "A", "--status", "running", "--merge", "abc1234", "--confirm");
  assert.equal(merged.code, 0);
  assert.deepEqual(json(repo, ".syno/console/nodes/A.json").deliveries.map((d) => d.merge), ["abc1234"]);
  assert.equal((await run(repo, "record", "A", "--status", "done", "--confirm")).code, 2);
});

test("spawn prints create_session parameters, and refuses the wrong level", async () => {
  const repo = await consoleRepo();
  const r = await run(repo, "spawn", "N", "--name", "Notifications", "--json");
  assert.equal(r.code, 0, r.text);
  const p = r.data.params;
  assert.equal(p.title, "PhN · Phase N · Notifications");
  assert.equal(p.outcome_branch, "claude/syno-phase-n");
  assert.equal(p.source_revision, "claude/syno-console");
  assert.equal(p.source_url, "https://github.com/o/r");
  assert.equal(p.permission_mode, "auto");
  assert.ok(p.append_system_prompt.startsWith("SYNO ROLE CARD"));
  assert.match(p.append_system_prompt, /s-con/);
  assert.match(p.prompt, /^\[SYNO brief\] console → N/);
  assert.equal((await run(repo, "spawn", "A.M1", "--name", "x")).code, 3);
});

test("guard prints a deny for a task's question dialog and nothing for bad input", async () => {
  const repo = await taskRepo();
  const ask = await runConsole(["guard"], { cwd: repo, stdin: JSON.stringify({ tool_name: "AskUserQuestion", tool_input: { questions: [] }, cwd: repo }) });
  assert.equal(ask.code, 0);
  assert.equal(JSON.parse(ask.text).hookSpecificOutput.permissionDecision, "deny");
  const push = await runConsole(["guard"], { cwd: repo, stdin: JSON.stringify({ tool_name: "Bash", tool_input: { command: "git push origin main" }, cwd: repo }) });
  assert.match(JSON.parse(push.text).hookSpecificOutput.permissionDecisionReason, /own branch/);
  for (const stdin of ["garbage", "", "{}"]) assert.deepEqual(await runConsole(["guard"], { cwd: repo, stdin }), { code: 0, text: "", data: null });
});

test("whoami and the session-start brief", async () => {
  const bare = repoOn("feature/x");
  const none = await run(bare, "whoami");
  assert.match(none.text, /No role/);
  assert.match(none.text, /join/);
  assert.equal((await runConsole(["brief-hook"], { cwd: bare, stdin: "{}" })).text, "");
  const repo = await taskRepo();
  const me = await run(repo, "whoami");
  assert.match(me.text, /PhA·M1·T1/);
  const brief = JSON.parse((await runConsole(["brief-hook"], { cwd: repo, stdin: JSON.stringify({ cwd: repo }) })).text);
  assert.match(brief.hookSpecificOutput.additionalContext, /\[SYNO question\]/);
  const again = await run(repo, "join", "--id", "A.M1.T1", "--parent-session", "s-m1", "--console-session", "s-con", "--lane", "src/a/**", "--confirm");
  assert.match(again.text, /No files would change/);
});

test("tree draws the recorded nodes", async () => {
  const repo = await consoleRepo();
  await run(repo, "record", "A", "--status", "running", "--session", "s-a", "--name", "Foundations", "--confirm");
  const t = await run(repo, "tree");
  assert.match(t.text, /^Green: 1 session running/);
  assert.match(t.text, /└─ PhA · Phase A · Foundations — Running/);
});

test("review: an unjoined session is told to join, not who it is", async () => {
  const repo = repoOn("claude/syno-pha-m1");
  const me = await run(repo, "whoami");
  assert.match(me.text, /hasn't joined/);
  assert.doesNotMatch(me.text, /^You are/);
  const brief = JSON.parse((await runConsole(["brief-hook"], { cwd: repo, stdin: JSON.stringify({ cwd: repo }) })).text);
  assert.match(brief.hookSpecificOutput.additionalContext, /hasn't joined/);
  assert.equal((await run(repo, "start", "--branch", "claude/syno-pha-m1", "--confirm")).code, 3);
});

test("review: merged and archived records need the merge commit", async () => {
  const repo = await consoleRepo();
  assert.equal((await run(repo, "record", "A", "--status", "merged", "--confirm")).code, 2);
  assert.equal((await run(repo, "record", "A", "--status", "merged", "--merge", "abc1234", "--confirm")).code, 0);
  assert.equal((await run(repo, "record", "A", "--status", "archived", "--confirm")).code, 0);
});

test("review: a corrupt record never lets a number be reused", async () => {
  const repo = await consoleRepo({ numbers: ["ADR"] });
  mkdirSync(join(repo, ".syno/console/decisions"), { recursive: true });
  writeFileSync(join(repo, ".syno/console/decisions/D-0002.json"), "{ broken");
  writeFileSync(join(repo, "q.json"), JSON.stringify({ question: "Q?", chosen: "A" }));
  const r = await run(repo, "decide", "--file", "q.json", "--confirm");
  assert.equal(r.code, 0, r.text);
  assert.equal(read(repo, ".syno/console/decisions/D-0002.json"), "{ broken");
  assert.ok(existsSync(join(repo, ".syno/console/decisions/D-0003.json")));
  mkdirSync(join(repo, ".syno/console/numbers"), { recursive: true });
  writeFileSync(join(repo, ".syno/console/numbers/ADR.json"), "{ broken");
  const n = await run(repo, "numbers", "ADR", "--to", "A", "--count", "2", "--start", "1", "--confirm");
  assert.equal(n.code, 2);
  assert.match(n.text, /can't read/);
});

test("review: a phase spawns a task on its milestone's behalf with the milestone as parent", async () => {
  const repo = repoOn("claude/syno-phase-a");
  await run(repo, "join", "--id", "A", "--parent-session", "s-con", "--console-session", "s-con", "--session", "s-a", "--confirm");
  await run(repo, "record", "A.M1", "--status", "running", "--session", "s-m1", "--confirm");
  assert.equal((await run(repo, "spawn", "A.M1.T1", "--name", "x", "--lane", "src/**")).code, 2);
  const r = await run(repo, "spawn", "A.M1.T1", "--name", "x", "--lane", "src/**", "--parent-session", "s-m1", "--json");
  assert.equal(r.code, 0, r.text);
  assert.match(r.data.params.prompt, /^\[SYNO brief\] A\.M1 → A\.M1\.T1/);
  assert.match(r.data.params.append_system_prompt, /Your parent: A\.M1, session s-m1/);
});

test("review: tree survives hand-written records and lists the unreadable ones", async () => {
  const repo = await consoleRepo();
  mkdirSync(join(repo, ".syno/console/nodes"), { recursive: true });
  writeFileSync(join(repo, ".syno/console/nodes/x.json"), JSON.stringify({ status: "running" }));
  writeFileSync(join(repo, ".syno/console/nodes/console.json"), JSON.stringify({ id: "console", parentId: "console", status: "running" }));
  writeFileSync(join(repo, ".syno/console/nodes/bad.json"), "{");
  const t = await run(repo, "tree");
  assert.equal(t.code, 0, t.text);
  assert.doesNotMatch(t.text, /undefined/);
  assert.match(t.text, /Skipped unreadable records: .*bad\.json/);
});

test("review: the guard hook proves an archive's merge is pushed", async () => {
  const repo = repoOn("claude/syno-pha-m1");
  await run(repo, "join", "--id", "A.M1", "--parent-session", "s-a", "--console-session", "s-con", "--confirm");
  const sha = git(repo, "rev-parse", "HEAD").trim();
  await run(repo, "record", "A.M1.T1", "--status", "merged", "--session", "s-t1", "--merge", sha, "--confirm");
  const archive = JSON.stringify({ tool_name: "mcp__claude-code-remote__archive_session", tool_input: { session_id: "s-t1" }, cwd: repo });
  const before = await runConsole(["guard"], { cwd: repo, stdin: archive });
  assert.match(JSON.parse(before.text).hookSpecificOutput.permissionDecisionReason, /pushed/);
  git(repo, "update-ref", "refs/remotes/origin/claude/syno-pha-m1", sha);
  assert.deepEqual(await runConsole(["guard"], { cwd: repo, stdin: archive }), { code: 0, text: "", data: null });
});
