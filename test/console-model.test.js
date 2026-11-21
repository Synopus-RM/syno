// S-17 Syno Console: IDs, names, branches, lanes and spawn limits (AC-CN.1, AC-CN.3).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULTS,
  STANDING_RULES,
  branchIsUnambiguous,
  checkSpawn,
  idFromBranch,
  lanesOverlap,
  matchGlob,
  namesFor,
  parseId,
  withDefaults,
} from "../skills/console/scripts/model.mjs";

const cfg = withDefaults({ syno: { branch: "claude/syno-console" }, project: "Demo Books" });
const node = (id, status, lane = []) => ({ id, status, lane, level: parseId(id).level, parentId: parseId(id).parentId });

test("AC-CN.1 ids, titles, branches and tags", () => {
  const t = namesFor("A.M100.T04", "Totals row", cfg);
  assert.equal(t.level, "task");
  assert.equal(t.title, "PhA·M100·T04 · Totals row");
  assert.equal(t.titlePrefix, "PhA·M100·T04");
  assert.equal(t.branch, "claude/syno-pha-m100-t04");
  assert.equal(t.parentId, "A.M100");
  assert.equal(t.parentBranch, "claude/syno-pha-m100");
  for (const tag of ["syno", "syno-level:task", "syno-id:A.M100.T04", "syno-project:demo-books"]) assert.ok(t.tags.includes(tag), tag);
  const p = namesFor("A", "", cfg);
  assert.equal(p.title, "PhA · Phase A");
  assert.equal(p.branch, "claude/syno-phase-a");
  assert.equal(p.parentId, "console");
  assert.equal(p.parentBranch, "claude/syno-console");
  assert.equal(namesFor("A.M1", "Invoice editor", cfg).title, "PhA·M1 · Invoice editor");
  assert.equal(namesFor("console", "", cfg).title, "Syno Console");
  assert.equal(namesFor("console", "", withDefaults({ label: "Demo Books" })).title, "Syno Console · Demo Books");
  assert.equal(parseId("a.m1").id, "A.M1");
  assert.equal(parseId("console").level, "console");
  assert.equal(parseId("N").parentId, "console");
  for (const bad of ["A.M1-2", "A.X1", "A.M1.T1.T2", "", "1A", "ABCDEFG", "A..M1"]) assert.equal(parseId(bad), null, bad);
  assert.equal(idFromBranch("claude/syno-phase-n", cfg), "N");
  assert.equal(idFromBranch("claude/syno-pha-m100", cfg), "A.M100");
  assert.equal(idFromBranch("claude/syno-pha-m100-t04", cfg), "A.M100.T04");
  assert.equal(idFromBranch("claude/syno-console", cfg), "console");
  assert.equal(idFromBranch("main", cfg), null);
  assert.throws(() => namesFor("A.M1", "x".repeat(49), cfg), (e) => e.exit === 2);
  assert.throws(() => namesFor("A.Q1", "x", cfg), (e) => e.exit === 2);
});

test("AC-CN.1 ambiguous branch templates are refused", () => {
  // With the default templates, phase M1 and milestone ASE.M1 would both get claude/syno-phase-m1.
  assert.equal(branchIsUnambiguous("ASE.M1", cfg), false);
  assert.equal(branchIsUnambiguous("M1", cfg), false);
  assert.throws(() => namesFor("ASE.M1", "n", cfg), (e) => e.exit === 2 && /ambiguous/.test(e.message));
  assert.equal(branchIsUnambiguous("A.M100.T04", cfg), true);
  assert.equal(branchIsUnambiguous("N", cfg), true);
});

test("withDefaults keeps unknown keys and replaces arrays", () => {
  const c = withDefaults({ extra: 1, limits: { maxTasks: 2 }, sharedFiles: ["a"] });
  assert.equal(c.extra, 1);
  assert.equal(c.limits.maxTasks, 2);
  assert.equal(c.limits.maxMilestones, 2);
  assert.deepEqual(c.sharedFiles, ["a"]);
  assert.equal(c.askAt, "console");
  assert.equal(c.rolling, true);
  assert.equal(c.autoMode, true);
  assert.deepEqual(withDefaults(null).limits, DEFAULTS.limits);
  withDefaults({ limits: { maxTasks: 9 } });
  assert.equal(DEFAULTS.limits.maxTasks, 3);
});

test("lanes: globs and overlap", () => {
  assert.ok(matchGlob("src/a/x.js", "src/**"));
  assert.ok(matchGlob("src/x.js", "src/*.js"));
  assert.ok(!matchGlob("src/a/x.js", "src/*.js"));
  assert.ok(matchGlob("docs/PRD.md", "docs/PRD.md"));
  assert.ok(matchGlob("a/b/c.md", "**/*.md"));
  assert.ok(matchGlob("c.md", "**/*.md"));
  assert.equal(lanesOverlap(["src/a/**"], ["src/**"], []).length, 1);
  assert.deepEqual(lanesOverlap(["src/a/**"], ["src/b/**"], []), []);
  assert.deepEqual(lanesOverlap(["src/*.js"], ["src/*.ts"], []), []);
  assert.deepEqual(lanesOverlap(["src/a/**", "docs/PRD.md"], ["src/b/**", "docs/PRD.md"], ["docs/PRD.md"]), []);
  assert.equal(lanesOverlap(["docs/PRD.md"], ["docs/**"], []).length, 1);
});

test("AC-CN.3 spawn limits and lanes", () => {
  const ms = { level: "milestone", id: "A.M100" };
  const fails = (r, re) => {
    assert.equal(r.ok, false);
    assert.match(r.reasons.join(" "), re);
  };
  fails(checkSpawn({ role: ms, childId: "B", lane: [], nodes: [], cfg }), /next level/);
  fails(checkSpawn({ role: ms, childId: "A.M2.T1", lane: [], nodes: [], cfg }), /next level/);
  const three = ["T1", "T2", "T3"].map((t, i) => node(`A.M100.${t}`, ["running", "handed-off", "rework"][i], [`src/${t}/**`]));
  fails(checkSpawn({ role: ms, childId: "A.M100.T4", lane: ["src/t4/**"], nodes: three, cfg }), /3 tasks/);
  fails(checkSpawn({ role: ms, childId: "A.M100.T5", lane: ["src/a/**"], nodes: [node("A.M100.T1", "running", ["src/**"])], cfg }), /overlap/);
  const shared = withDefaults({ sharedFiles: ["docs/PRD.md"] });
  const okShared = checkSpawn({ role: ms, childId: "A.M100.T5", lane: ["src/b/**", "docs/PRD.md"], nodes: [node("A.M100.T1", "running", ["src/a/**", "docs/PRD.md"])], cfg: shared });
  assert.equal(okShared.ok, true, okShared.reasons.join(" "));
  const merged = three.map((n) => ({ ...n, status: "merged" }));
  assert.equal(checkSpawn({ role: ms, childId: "A.M100.T4", lane: ["src/t4/**"], nodes: merged, cfg }).ok, true);
  fails(checkSpawn({ role: { level: "phase", id: "A" }, childId: "A.M3", lane: [], nodes: [node("A.M1", "running"), node("A.M2", "running")], cfg }), /2 milestones/);
  fails(checkSpawn({ role: { level: "task", id: "A.M100.T1" }, childId: "A.M100.T2", lane: [], nodes: [], cfg }), /next level/);
  fails(checkSpawn({ role: ms, childId: "A.M100.T1", lane: [], nodes: [node("A.M100.T1", "merged")], cfg }), /already/);
  assert.equal(checkSpawn({ role: ms, childId: "A.M100.T1", lane: [], nodes: [node("A.M100.T1", "planned")], cfg }).ok, true);
  assert.equal(checkSpawn({ role: { level: "console", id: "console" }, childId: "N", lane: [], nodes: [], cfg }).ok, true);
});

test("S-17 twelve standing rules, numbered R-0001 to R-0012", () => {
  assert.deepEqual(STANDING_RULES.map((r) => r.id), Array.from({ length: 12 }, (_, i) => `R-${String(i + 1).padStart(4, "0")}`));
  for (const r of STANDING_RULES) assert.ok(r.text.length > 20, r.id);
});

test("review: an ancestor may create a descendant on its child's behalf, counted under that child", () => {
  const ph = { level: "phase", id: "A" };
  const nodes = [node("A.M1", "running"), ...["T1", "T2", "T3"].map((t) => node(`A.M1.${t}`, "running", [`src/${t}/**`]))];
  const full = checkSpawn({ role: ph, childId: "A.M1.T4", lane: ["src/t4/**"], nodes, cfg });
  assert.equal(full.ok, false);
  assert.match(full.reasons.join(" "), /3 tasks/);
  assert.equal(checkSpawn({ role: ph, childId: "A.M1.T4", lane: ["src/t4/**"], nodes: nodes.slice(0, 2), cfg }).ok, true);
  const noParent = checkSpawn({ role: ph, childId: "A.M2.T1", lane: [], nodes: [], cfg });
  assert.equal(noParent.ok, false);
  assert.match(noParent.reasons.join(" "), /A\.M2 isn't running/);
  assert.equal(checkSpawn({ role: { level: "console", id: "console" }, childId: "A.M1.T9", lane: ["x/**"], nodes: nodes.slice(0, 2), cfg }).ok, true);
  assert.equal(checkSpawn({ role: { level: "milestone", id: "A.M1" }, childId: "A.M2.T1", lane: [], nodes, cfg }).ok, false);
});
