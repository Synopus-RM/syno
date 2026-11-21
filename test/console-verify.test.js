// S-17 Syno Console: read-only verify before a merge (design 5.7 step 3, AC-CN.7).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { commit, initRepo } from "./fixtures.js";
import { gitRead, normaliseRepoUrl } from "../skills/console/scripts/gitread.mjs";
import { verifyChild } from "../skills/console/scripts/verify.mjs";

const PARENT = "claude/syno-pha-m1";
const CHILD = "claude/syno-pha-m1-t1";
const git = (repo, ...args) => execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { cwd: repo, encoding: "utf8" }).trim();

/** A repo on the parent branch, a child branch with `files`, and origin/<child> as if fetched. */
function tree(files, { parentMoves = false } = {}) {
  const repo = initRepo("console-verify");
  commit(repo, "init", undefined, { "README.md": "# r\n", "src/base.js": "b\n" });
  git(repo, "checkout", "-q", "-b", PARENT);
  git(repo, "checkout", "-q", "-b", CHILD);
  commit(repo, "child work", undefined, files);
  const head = git(repo, "rev-parse", "HEAD");
  git(repo, "update-ref", `refs/remotes/origin/${CHILD}`, head);
  git(repo, "checkout", "-q", PARENT);
  if (parentMoves) commit(repo, "parent moved", undefined, { "src/other.js": "o\n" });
  return { repo, head };
}
const lane = ["src/t1/**"];

test("AC-CN.7 green: synced and inside the lane", () => {
  const { repo, head } = tree({ "src/t1/a.js": "a\n" });
  const r = verifyChild(repo, { childId: "A.M1.T1", childBranch: CHILD, lane, reportedHead: head.slice(0, 7) });
  assert.equal(r.verdict, "green", r.reasons.join(" "));
  assert.deepEqual(r.files, ["src/t1/a.js"]);
  assert.equal(r.alreadyMerged, false);
  assert.equal(r.childHead, head);
});

test("AC-CN.7 amber: needs sync, outside the lane, head differs from the report", () => {
  const sync = verifyChild(tree({ "src/t1/a.js": "a\n" }, { parentMoves: true }).repo, { childId: "A.M1.T1", childBranch: CHILD, lane });
  assert.equal(sync.verdict, "amber");
  assert.match(sync.reasons.join(" "), /needs sync/i);
  const { repo } = tree({ "src/t1/a.js": "a\n", "README.md": "changed\n" });
  const out = verifyChild(repo, { childId: "A.M1.T1", childBranch: CHILD, lane });
  assert.equal(out.verdict, "amber");
  assert.match(out.reasons.join(" "), /outside the lane: README\.md/i);
  assert.equal(verifyChild(repo, { childId: "A.M1.T1", childBranch: CHILD, lane, shared: ["README.md"] }).verdict, "green");
  const mismatch = verifyChild(repo, { childId: "A.M1.T1", childBranch: CHILD, lane, shared: ["README.md"], reportedHead: "deadbee" });
  assert.equal(mismatch.verdict, "amber");
  assert.match(mismatch.reasons.join(" "), /differs from the report/);
});

test("AC-CN.7 red: Console records or records outside the child's subtree changed", () => {
  const prot = verifyChild(tree({ "src/t1/a.js": "a\n", ".syno/console/decisions/D-0001.json": "{}\n" }).repo, { childId: "A.M1.T1", childBranch: CHILD, lane });
  assert.equal(prot.verdict, "red");
  assert.match(prot.reasons.join(" "), /decisions\/D-0001\.json/);
  const foreign = tree({ ".syno/console/nodes/A.M2.json": "{}\n", ".syno/console/nodes/A.M1.T1.T.json": "{}\n" });
  const r = verifyChild(foreign.repo, { childId: "A.M1", childBranch: CHILD, lane: [] });
  assert.equal(r.verdict, "red");
  assert.match(r.reasons.join(" "), /A\.M2\.json/);
  const own = verifyChild(tree({ ".syno/console/nodes/A.M1.T1.json": "{}\n", ".syno/console/reports/A.M1.T1.md": "r\n" }).repo, { childId: "A.M1", childBranch: CHILD, lane: [] });
  assert.equal(own.verdict, "green", own.reasons.join(" "));
});

test("AC-CN.7 an already merged child is green and says so", () => {
  const { repo } = tree({ "src/t1/a.js": "a\n" });
  git(repo, "merge", "-q", "--no-ff", "-m", "merge", `origin/${CHILD}`);
  const r = verifyChild(repo, { childId: "A.M1.T1", childBranch: CHILD, lane });
  assert.equal(r.alreadyMerged, true);
  assert.equal(r.verdict, "green");
  assert.match(r.reasons.join(" "), /already merged/i);
});

test("verify says how to fetch a branch it can't find, without throwing", () => {
  const { repo } = tree({ "src/t1/a.js": "a\n" });
  const r = verifyChild(repo, { childId: "A.M1.T9", childBranch: "claude/syno-pha-m1-t9", lane });
  assert.equal(r.verdict, "red");
  assert.match(r.reasons.join(" "), /git fetch origin claude\/syno-pha-m1-t9/);
});

test("gitRead refuses push, fetch and diff without --name-status", () => {
  const { repo } = tree({ "src/t1/a.js": "a\n" });
  for (const args of [["push"], ["fetch", "origin"], ["diff", "HEAD"], ["log", "--output=x"], ["checkout", "main"]]) {
    assert.throws(() => gitRead(args, { cwd: repo }), (e) => e.exit === 3, args.join(" "));
  }
  assert.match(gitRead(["rev-parse", "HEAD"], { cwd: repo }), /^[0-9a-f]{40}$/);
});

test("repository URLs are normalised for create_session", () => {
  assert.equal(normaliseRepoUrl("http://local_proxy@127.0.0.1:41234/git/Synopus-RM/Akmo-Books"), "https://github.com/Synopus-RM/Akmo-Books");
  assert.equal(normaliseRepoUrl("git@github.com:o/r.git"), "https://github.com/o/r");
  assert.equal(normaliseRepoUrl("https://user:tok@github.com/o/r.git"), "https://github.com/o/r");
  assert.equal(normaliseRepoUrl("https://gitlab.example.com/g/r.git"), "https://gitlab.example.com/g/r");
  assert.equal(normaliseRepoUrl(null), null);
});

test("review: a branch with no shared history is red, not a crash", () => {
  const { repo } = tree({ "src/t1/a.js": "a\n" });
  git(repo, "checkout", "-q", "--orphan", "lonely");
  commit(repo, "orphan", undefined, { "x.txt": "x\n" });
  git(repo, "update-ref", "refs/remotes/origin/claude/syno-pha-m1-t2", git(repo, "rev-parse", "HEAD"));
  git(repo, "checkout", "-q", PARENT);
  const r = verifyChild(repo, { childId: "A.M1.T2", childBranch: "claude/syno-pha-m1-t2", lane });
  assert.equal(r.verdict, "red");
  assert.match(r.reasons.join(" "), /no history in common/);
});

test("review: verify is red when a child switches the guard off or changes the console config", () => {
  const settings = (hook) => JSON.stringify({ hooks: { PreToolUse: hook ? [{ matcher: "Bash", hooks: [{ type: "command", command: 'node "$CLAUDE_PROJECT_DIR/.claude/skills/syno-console/scripts/console.mjs" guard' }] }] : [] } });
  const base = (repo) => {
    commit(repo, "settings", undefined, { ".claude/settings.json": settings(true), ".syno/config.json": JSON.stringify({ console: { askAt: "console" } }) });
  };
  const build = (files) => {
    const repo = initRepo("console-verify-guard");
    base(repo);
    git(repo, "checkout", "-q", "-b", PARENT);
    git(repo, "checkout", "-q", "-b", CHILD);
    commit(repo, "child", undefined, files);
    git(repo, "update-ref", `refs/remotes/origin/${CHILD}`, git(repo, "rev-parse", "HEAD"));
    git(repo, "checkout", "-q", PARENT);
    return repo;
  };
  const check = (files) => verifyChild(build(files), { childId: "A.M1.T1", childBranch: CHILD, lane: [] });
  assert.match(check({ ".claude/settings.json": settings(false) }).reasons.join(" "), /removes the Syno Console guard/i);
  assert.equal(check({ ".claude/settings.json": settings(false) }).verdict, "red");
  assert.equal(check({ ".syno/config.json": JSON.stringify({ console: { askAt: "phase" } }) }).verdict, "red");
  assert.equal(check({ ".claude/skills/syno-console/scripts/guard.mjs": "// off\n" }).verdict, "red");
  const keep = JSON.stringify({ ...JSON.parse(settings(true)), env: { A: "1" } });
  assert.equal(check({ ".claude/settings.json": keep, ".syno/config.json": JSON.stringify({ console: { askAt: "console" }, compliance: {} }) }).verdict, "green");
});
