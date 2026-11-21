// S-17 Syno Console: role card, brief, create_session parameters and the tree (AC-CN.2).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { briefText, fill, roleCard, spawnParams } from "../skills/console/scripts/cards.mjs";
import { renderTree } from "../skills/console/scripts/tree.mjs";
import { STANDING_RULES, namesFor, withDefaults } from "../skills/console/scripts/model.mjs";

const ref = (name) => readFileSync(fileURLToPath(new URL(`../skills/console/references/${name}`, import.meta.url)), "utf8");
const cfg = withDefaults({ syno: { branch: "claude/syno-console" } });
const task = namesFor("A.M100.T04", "x".repeat(48), cfg);
const parent = { id: "A.M100", session: "session_parent", branch: "claude/syno-pha-m100" };
const card = (over = {}) =>
  roleCard({ cfg, names: task, parent, consoleSession: "session_console", lane: Array.from({ length: 10 }, (_, i) => `src/area-${i}/**`), rules: STANDING_RULES, template: ref("role-card.md"), ...over });

test("AC-CN.2 role card: marker, authority, rules, parent and Console, at most 6 KB", () => {
  const text = card();
  assert.equal(text.split("\n")[0], "SYNO ROLE CARD");
  for (const r of STANDING_RULES) assert.ok(text.includes(r.id), r.id);
  assert.match(text, /Order of authority/);
  assert.match(text, /session_parent/);
  assert.match(text, /session_console/);
  assert.match(text, /claude\/syno-pha-m100-t04/);
  assert.match(text, /console\.mjs" join --id A\.M100\.T04 --parent-session session_parent --console-session session_console --lane /);
  assert.ok(Buffer.byteLength(text) <= 6144, `${Buffer.byteLength(text)} bytes`);
  assert.doesNotMatch(text, /\{\{/);
});

test("AC-CN.2 the question rule follows askAt and the level", () => {
  assert.match(card(), /Only Syno Console asks the owner/);
  const phaseCfg = withDefaults({ askAt: "phase", syno: { branch: "claude/syno-console" } });
  const phase = roleCard({ cfg: phaseCfg, names: namesFor("A", "", phaseCfg), parent: { id: "console", session: "session_console", branch: "claude/syno-console" }, consoleSession: "session_console", lane: [], rules: STANDING_RULES, template: ref("role-card.md") });
  assert.match(phase, /You ask the owner questions that concern only your phase/);
  assert.match(phase, /DECISION A/);
  assert.match(phase, /the whole repository/);
});

test("fill throws on a missing or an unused key", () => {
  assert.equal(fill("a {{X}} b", { X: "1" }), "a 1 b");
  assert.throws(() => fill("a {{X}} {{Y}}", { X: "1" }), (e) => e.exit === 2 && /Y/.test(e.message));
  assert.throws(() => fill("a {{X}}", { X: "1", Z: "2" }), (e) => e.exit === 2 && /Z/.test(e.message));
});

test("brief and create_session parameters", () => {
  const brief = briefText({ template: ref("brief.md"), names: task, parentId: "A.M100", brief: { goal: "Add the totals row", ref: "T-M100-04", lane: ["src/totals/**"], doneWhen: ["Totals add up"], decisions: [{ id: "D-0002", text: "Round half up" }], checks: ["pnpm test"] } });
  assert.match(brief, /^\[SYNO brief\] A\.M100 → A\.M100\.T04 · T-M100-04/);
  assert.match(brief, /- D-0002: Round half up/);
  assert.match(brief, /Out of scope:\n- none/);
  const p = spawnParams({ names: task, repoUrl: "https://github.com/o/r", card: card(), brief, cfg });
  assert.equal(p.permission_mode, "auto");
  assert.equal(p.source_revision, "claude/syno-pha-m100");
  assert.equal(p.outcome_branch, "claude/syno-pha-m100-t04");
  assert.equal(p.source_url, "https://github.com/o/r");
  assert.ok(p.append_system_prompt.startsWith("SYNO ROLE CARD"));
  assert.deepEqual(p.tags, task.tags);
  assert.equal(spawnParams({ names: task, repoUrl: "u", card: "c", brief: "b", cfg: withDefaults({ autoMode: false }) }).permission_mode, "default");
});

test("renderTree opens with a verdict and draws the tree", () => {
  const nodes = [
    { id: "A", name: "Foundations", status: "running", parentId: "console" },
    { id: "A.M1", name: "Invoice editor", status: "merged", parentId: "A" },
    { id: "N", name: "", status: "running", parentId: "console", sessionId: "s-n" },
    { id: "A.M2", name: "Old", status: "archived", parentId: "A" },
  ];
  const questions = [{ id: "Q-N.M1.T2-01", from: "N.M1.T2", status: "open" }];
  const { verdict, text } = renderTree({ nodes, questions, cfg, live: { "s-n": "blocked" } });
  assert.match(verdict, /^Amber: 1 question waits for you/);
  const lines = text.split("\n");
  assert.equal(lines[0], verdict);
  assert.equal(lines[1], "Syno Console");
  assert.ok(lines.some((l) => l.startsWith("├─ PhA · Phase A · Foundations — Running")), text);
  assert.ok(lines.some((l) => l.startsWith("│  └─ PhA·M1 · Invoice editor — Merged")), text);
  assert.ok(lines.some((l) => l.startsWith("└─ PhN · Phase N — Blocked") && l.includes("Q-N.M1.T2-01")), text);
  assert.match(text, /1 archived/);
  assert.match(renderTree({ nodes: [], questions: [], cfg }).verdict, /^Green: /);
  assert.match(renderTree({ nodes: [{ id: "A", status: "rework", parentId: "console" }], questions: [], cfg }).verdict, /^Red: /);
});
