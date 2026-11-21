// S-17 Syno Console guards (design 5.8): questions, pushes, sessions and records (AC-CN.4 to AC-CN.6).
import { test } from "node:test";
import assert from "node:assert/strict";
import { GUARD_MATCHER, MARKER, PLUGIN_MATCHER, judge, parsePushes } from "../skills/console/scripts/guard.mjs";
import { withDefaults } from "../skills/console/scripts/model.mjs";

const cfg = withDefaults({ syno: { branch: "claude/syno-console" } });
const role = (level, id, branch) => ({ level, id, branch });
const TASK = role("task", "A.M100.T04", "claude/syno-pha-m100-t04");
const MS = role("milestone", "A.M100", "claude/syno-pha-m100");
const PH = role("phase", "A", "claude/syno-phase-a");
const CON = role("console", "console", "claude/syno-console");
const ctx = (r, extra = {}) => ({ role: r, cfg, nodes: [], currentBranch: r?.branch ?? null, ...extra });
const bash = (command) => ({ tool_name: "Bash", tool_input: { command } });
const CREATE = "mcp__claude-code-remote__create_session";
const ARCHIVE = "mcp__claude-code-remote__archive_session";

function denied(out, re) {
  assert.equal(out?.permissionDecision, "deny", "expected a deny");
  assert.match(out.permissionDecisionReason, /^Syno Console: /);
  if (re) assert.match(out.permissionDecisionReason, re);
}
const allowed = (out) => assert.equal(out, null, out?.permissionDecisionReason);

test("AC-CN.4 G-ASK follows askAt", () => {
  const ask = { tool_name: "AskUserQuestion", tool_input: { questions: [] } };
  denied(judge(ask, ctx(TASK)), /\[SYNO question\]/);
  denied(judge(ask, ctx(MS)));
  denied(judge(ask, ctx(PH)));
  const phaseAsks = withDefaults({ askAt: "phase", syno: { branch: "claude/syno-console" } });
  allowed(judge(ask, { ...ctx(PH), cfg: phaseAsks }));
  denied(judge(ask, { ...ctx(MS), cfg: phaseAsks }));
  denied(judge({ tool_name: "EnterPlanMode", tool_input: {} }, ctx(PH)), /plan/);
  denied(judge({ tool_name: "ExitPlanMode", tool_input: { plan: "x" } }, ctx(TASK)), /plan/);
  allowed(judge(ask, ctx(CON)));
  allowed(judge({ tool_name: "EnterPlanMode", tool_input: {} }, ctx(CON)));
  allowed(judge(ask, ctx(null)));
});

test("AC-CN.5 G-PUSH allows only the session's own branch", () => {
  const own = TASK.branch;
  const ok = [`git push -u origin ${own}`, `git -C /x push origin HEAD:refs/heads/${own}`, `npm test && git push origin ${own}`, "git status", 'echo "git push origin main"', "git push"];
  for (const c of ok) allowed(judge(bash(c), ctx(TASK)));
  const bad = [
    ["git push origin claude/syno-pha-m100", /isn't this session's branch/],
    [`git push --force origin ${own}`, /force/],
    [`git push -fu origin ${own}`, /force/],
    [`git push origin +${own}`, /force/],
    [`git push --force-with-lease=${own} origin ${own}`, /force/],
    [`git push origin :${own}`, /delete/],
    [`git push --delete origin ${own}`, /delete/],
    [`git push --prune origin ${own}`, /delete/],
    ["git push --all", /every branch/],
    ["git push --mirror origin", /every branch/],
    ["git push --tags", /tags/],
    [`git push origin refs/tags/v1`, /tags/],
    ['git push origin "$B"', /literally/],
    ["npm test && git push origin main", /isn't this session's branch/],
    ["GIT_TRACE=1 git push origin main", /isn't this session's branch/],
    ["gh pr merge 5", /owner merges/],
  ];
  for (const [c, re] of bad) denied(judge(bash(c), ctx(TASK)), re);
  denied(judge(bash("git push"), ctx(TASK, { currentBranch: "claude/syno-pha-m100" })), /from claude\/syno-pha-m100/);
  allowed(judge(bash("git push -u origin claude/syno-console"), ctx(CON)));
  denied(judge(bash("git push origin main"), ctx(CON)));
});

test("parsePushes reads each push in a command line", () => {
  const [p] = parsePushes("git -C /x -c a=b push -u origin a b");
  assert.equal(p.remote, "origin");
  assert.deepEqual(p.refspecs, ["a", "b"]);
  assert.equal(p.force, false);
  assert.deepEqual(parsePushes("echo hi; ls | wc -l"), []);
  assert.equal(parsePushes("git push origin x && git push origin y").length, 2);
});

test("AC-CN.6 G-SPAWN creates only the next level, named, in auto mode, with a role card", () => {
  const good = { title: "PhA·M100·T05 · Totals", outcome_branch: "claude/syno-pha-m100-t05", permission_mode: "auto", append_system_prompt: `${MARKER}\nYou are a task.` };
  const cs = (over) => ({ tool_name: CREATE, tool_input: { ...good, ...over } });
  denied(judge(cs({}), ctx(TASK)), /task can't create sessions/);
  allowed(judge(cs({}), ctx(MS)));
  allowed(judge(cs({ permission_mode: "default" }), ctx(MS)));
  denied(judge(cs({ title: "Task T05" }), ctx(MS)), /title/);
  denied(judge(cs({ title: "PhA·M100·T051 · x" }), ctx(MS)), /title/);
  denied(judge(cs({ outcome_branch: "claude/syno-pha-m101-t05" }), ctx(MS)), /next level/);
  denied(judge(cs({ permission_mode: "bypassPermissions" }), ctx(MS)), /auto/);
  denied(judge(cs({ permission_mode: undefined }), ctx(MS)), /auto/);
  denied(judge(cs({ append_system_prompt: "hello" }), ctx(MS)), /role card/);
  denied(judge(cs({}), ctx(PH)), /next level/);
  allowed(judge({ tool_name: CREATE, tool_input: { ...good, title: "PhN · Phase N", outcome_branch: "claude/syno-phase-n" } }, ctx(CON)));
});

test("AC-CN.6 G-ARCHIVE only for a merged child of this session", () => {
  const nodes = [
    { id: "A.M100.T04", parentId: "A.M100", sessionId: "s-merged", status: "merged" },
    { id: "A.M100.T05", parentId: "A.M100", sessionId: "s-run", status: "running" },
    { id: "A.M100.T06", parentId: "A.M100", sessionId: "s-stop", status: "stopped" },
    { id: "A.M101.T01", parentId: "A.M101", sessionId: "s-other", status: "merged" },
  ];
  const ar = (sid) => ({ tool_name: ARCHIVE, tool_input: { session_id: sid } });
  allowed(judge(ar("s-merged"), ctx(MS, { nodes })));
  allowed(judge(ar("s-stop"), ctx(MS, { nodes })));
  for (const sid of ["s-run", "s-unknown", "s-other"]) denied(judge(ar(sid), ctx(MS, { nodes })), /proven merged/);
  denied(judge({ tool_name: "mcp__github__merge_pull_request", tool_input: { pullNumber: 1 } }, ctx(CON)), /owner merges/);
});

test("G-RECORDS keeps the register, rules, questions and numbers to the Console", () => {
  const w = (file_path) => ({ tool_name: "Write", tool_input: { file_path, content: "{}" } });
  denied(judge(w("/repo/.syno/console/decisions/D-0001.json"), ctx(TASK)), /Console/);
  denied(judge({ tool_name: "Edit", tool_input: { file_path: ".syno/console/numbers/ADR.json" } }, ctx(MS)));
  allowed(judge(w("/repo/.syno/console/decisions/D-0001.json"), ctx(CON)));
  allowed(judge(w("/repo/.syno/console/nodes/A.M100.T04.json"), ctx(MS)));
  allowed(judge(w("/repo/src/a.js"), ctx(TASK)));
});

test("judge fails open on input it can't read", () => {
  for (const input of [null, {}, { tool_name: "Bash", tool_input: "x" }, { tool_name: "Bash", tool_input: { command: 5 } }, { tool_name: CREATE, tool_input: {} }]) {
    const out = judge(input, ctx(TASK));
    assert.ok(out === null || out.permissionDecision === "deny");
  }
  assert.equal(judge({}, ctx(TASK)), null);
  assert.equal(judge(null, ctx(TASK)), null);
});

test("matchers cover the guarded tools", () => {
  const full = new RegExp(`^(${GUARD_MATCHER})$`);
  const plugin = new RegExp(`^(${PLUGIN_MATCHER})$`);
  for (const t of ["Bash", "Write", "AskUserQuestion", CREATE, ARCHIVE, "mcp__github__merge_pull_request"]) assert.ok(full.test(t), t);
  assert.ok(!full.test("Read"));
  assert.ok(plugin.test(CREATE) && plugin.test("AskUserQuestion") && !plugin.test("Bash") && !plugin.test("Write"));
});
