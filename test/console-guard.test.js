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
  denied(judge(cs({ title: "PhN·M1 · x", outcome_branch: "claude/syno-phn-m1" }), ctx(PH)), /next level/);
  allowed(judge({ tool_name: CREATE, tool_input: { ...good, title: "PhN · Phase N", outcome_branch: "claude/syno-phase-n" } }, ctx(CON)));
});

test("AC-CN.6 G-ARCHIVE only for a merged child of this session", () => {
  const nodes = [
    { id: "A.M100.T04", parentId: "A.M100", sessionId: "s-merged", status: "merged", mergeCommit: "abc" },
    { id: "A.M100.T05", parentId: "A.M100", sessionId: "s-run", status: "running" },
    { id: "A.M100.T06", parentId: "A.M100", sessionId: "s-stop", status: "stopped" },
    { id: "A.M101.T01", parentId: "A.M101", sessionId: "s-other", status: "merged", mergeCommit: "def" },
  ];
  const ar = (sid) => ({ tool_name: ARCHIVE, tool_input: { session_id: sid } });
  allowed(judge(ar("s-merged"), ctx(MS, { nodes, isPushed: () => true })));
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

// ---- Final review fixes (wrappers, GitHub tools, unjoined sessions, archive proof, ancestors) ----

test("review: pushes inside shell wrappers, subshells, -c strings and loops are judged", () => {
  const own = TASK.branch;
  const P = "claude/syno-pha-m100";
  const bad = [
    `for i in 1 2 3; do git push origin ${P}; done`,
    `timeout 60 git push origin ${P}`,
    `if git push origin ${P}; then echo ok; fi`,
    `! git push origin ${P}`,
    `cd x && (git push origin ${P})`,
    `{ git push origin ${P}; }`,
    `env A=1 git push origin ${P}`,
    `sudo -E git push origin ${P}`,
    `bash -c "git push origin ${P}"`,
    `sh -c 'cd x && git push origin ${P}'`,
    `echo $(git push origin ${P})`,
    "echo `git push origin main`",
    "(gh pr merge 3)",
    "gh api -X PUT repos/o/r/pulls/3/merge",
  ];
  for (const c of bad) denied(judge(bash(c), ctx(TASK)));
  const ok = [
    `for i in 1 2 3; do git push -u origin ${own} && break; sleep 2; done`,
    `(git push origin ${own})`,
    `cat > notes.md <<'EOF'\ngit push origin main\nEOF\ngit add notes.md`,
    `git commit -m "explain: git push origin main is the owner's step"`,
    `git log --grep push`,
  ];
  for (const c of ok) allowed(judge(bash(c), ctx(TASK)));
});

test("review: GitHub write tools follow the own-branch and owner-merges rules", () => {
  const gh = (tool, input) => ({ tool_name: `mcp__github__${tool}`, tool_input: { owner: "o", repo: "r", ...input } });
  allowed(judge(gh("push_files", { branch: TASK.branch, files: [] }), ctx(TASK)));
  denied(judge(gh("push_files", { branch: "main", files: [] }), ctx(TASK)), /own branch/);
  denied(judge(gh("push_files", { files: [] }), ctx(TASK)), /own branch/);
  denied(judge(gh("create_or_update_file", { branch: "claude/syno-pha-m100", path: "a" }), ctx(TASK)));
  denied(judge(gh("delete_file", { branch: "main", path: "a" }), ctx(CON)));
  allowed(judge(gh("create_branch", { branch: TASK.branch }), ctx(TASK)));
  denied(judge(gh("create_branch", { branch: "claude/other" }), ctx(TASK)));
  denied(judge(gh("enable_pr_auto_merge", { pullNumber: 1 }), ctx(CON)), /owner merges/);
  denied(judge(gh("update_pull_request_branch", { pullNumber: 1 }), ctx(MS)));
  allowed(judge(gh("update_pull_request_branch", { pullNumber: 1 }), ctx(CON)));
  const full = new RegExp(`^(${GUARD_MATCHER})$`);
  const plugin = new RegExp(`^(${PLUGIN_MATCHER})$`);
  for (const t of ["push_files", "create_or_update_file", "delete_file", "create_branch", "update_pull_request_branch", "enable_pr_auto_merge"]) {
    assert.ok(full.test(`mcp__github__${t}`) && plugin.test(`mcp__github__${t}`), t);
  }
});

test("review: a session whose role was only worked out from the branch is held until it joins", () => {
  const unjoined = { ...MS, inferred: true };
  denied(judge({ tool_name: "AskUserQuestion", tool_input: { questions: [] } }, ctx(unjoined)), /join/);
  denied(judge(bash(`git push -u origin ${MS.branch}`), ctx(unjoined)), /join/);
  denied(judge({ tool_name: CREATE, tool_input: { title: "PhA·M100·T05", outcome_branch: "claude/syno-pha-m100-t05", permission_mode: "auto", append_system_prompt: MARKER } }, ctx(unjoined)), /join/);
  denied(judge({ tool_name: ARCHIVE, tool_input: { session_id: "s" } }, ctx(unjoined)), /join/);
  allowed(judge(bash("ls -la && npm test"), ctx(unjoined)));
  allowed(judge({ tool_name: "Write", tool_input: { file_path: "/r/src/a.js" } }, ctx(unjoined)));
  denied(judge({ tool_name: "AskUserQuestion", tool_input: { questions: [] } }, ctx({ ...CON, inferred: true })), /start/);
});

test("review: archive needs a recorded merge that is pushed", () => {
  const node = (over) => ({ id: "A.M100.T04", parentId: "A.M100", sessionId: "s1", status: "merged", mergeCommit: "abc1234", ...over });
  const ar = { tool_name: ARCHIVE, tool_input: { session_id: "s1" } };
  allowed(judge(ar, ctx(MS, { nodes: [node()], isPushed: (sha) => sha === "abc1234" })));
  denied(judge(ar, ctx(MS, { nodes: [node()], isPushed: () => false })), /pushed/);
  denied(judge(ar, ctx(MS, { nodes: [node()] })), /pushed/);
  denied(judge(ar, ctx(MS, { nodes: [node({ mergeCommit: null })], isPushed: () => true })), /proven merged/);
  denied(judge(ar, ctx(MS, { nodes: [node({ status: "archived", mergeCommit: null })], isPushed: () => true })), /proven merged/);
  allowed(judge(ar, ctx(MS, { nodes: [node({ status: "stopped", mergeCommit: null })] })));
});

test("review: an ancestor may create and archive a descendant on its child's behalf", () => {
  const cs = (title, branch) => ({ tool_name: CREATE, tool_input: { title, outcome_branch: branch, permission_mode: "auto", append_system_prompt: MARKER } });
  allowed(judge(cs("PhA·M100·T05 · x", "claude/syno-pha-m100-t05"), ctx(PH)));
  denied(judge(cs("PhN·M1·T1 · x", "claude/syno-phn-m1-t1"), ctx(PH)), /own part of the tree/);
  const nodes = [{ id: "A.M100.T04", parentId: "A.M100", sessionId: "s1", status: "merged", mergeCommit: "abc" }];
  allowed(judge({ tool_name: ARCHIVE, tool_input: { session_id: "s1" } }, ctx(PH, { nodes, isPushed: () => true })));
});

test("review: the guard's own files and the role file are kept from Edit and Write below the Console", () => {
  const w = (file_path) => ({ tool_name: "Edit", tool_input: { file_path } });
  denied(judge(w("/r/.claude/skills/syno-console/scripts/guard.mjs"), ctx(TASK)));
  denied(judge(w(".syno/local/console/role.json"), ctx(MS)));
  allowed(judge(w("/r/.claude/skills/syno-console/scripts/guard.mjs"), ctx(CON)));
});
