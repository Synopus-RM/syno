// Chunk 3.11: Syno Parallel, Plan and Prompt (PRD S-08, S-09, S-10).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (...p) => readFileSync(join(ROOT, ...p), "utf8");
const walk = (dir) => readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));

test("§1 the ported skills carry the Synopus name, never the old maker's", () => {
  for (const dir of ["skills/parallel", "skills/plan", "skills/prompt"]) {
    for (const f of walk(dir)) assert.doesNotMatch(readFileSync(join(ROOT, f), "utf8"), /akmo/i, f);
  }
  const rules = read("skills/parallel/references/house-rules.md");
  assert.match(rules, /Designed & Developed by Synopus/);
  assert.match(rules, /https:\/\/www\.synopus\.in/);
});

test("§3 each ported skill names its DMAIC step", () => {
  assert.match(read("skills/parallel/SKILL.md"), /\*\*DMAIC step: Improve\.\*\*/);
  assert.match(read("skills/plan/SKILL.md"), /\*\*DMAIC step: Define\.\*\*/);
  assert.match(read("skills/prompt/SKILL.md"), /\*\*DMAIC steps: Define and Control\.\*\*/);
});

test("AC-PA.1 Parallel sizes its launch with gov advise and runs heavy commands through gov run", () => {
  const text = read("skills/parallel/SKILL.md");
  assert.match(text, /`gov advise`/);
  assert.match(text, /`gov run`/);
  assert.match(text, /\.syno\/tasks\/breakdown\.json/);
});

test("AC-PA.2 Parallel calls a result done only when the done gate passes", () => {
  assert.match(read("skills/parallel/SKILL.md"), /syno tasks set <id> done`; if the gate refuses[^\n]*isn't done/);
  assert.match(read("commands/parallel.md"), /If the done gate refuses, report the piece as not done/);
});

test("AC-PL.1 the PRD template has At a glance, Quality, Compliance and Security sections", () => {
  const template = read("skills/plan/references/prd-template.md");
  for (const heading of ["## At a glance", "## Quality (critical to quality)", "## 9. Security & Auth", "## 10. Compliance"]) assert.ok(template.includes(heading), heading);
  assert.match(template, /abuse-case register from Syno Security/);
  assert.match(template, /requirements from Syno Compliance/);
  const skill = read("skills/plan/SKILL.md");
  assert.match(skill, /\/syno:compliance idea/);
  assert.match(skill, /\/syno:compliance prd/);
});

test("AC-PT.1 THIRD_PARTY_NOTICES.md contains prompt-master's licence text", () => {
  const notices = read("THIRD_PARTY_NOTICES.md");
  const licence = read("skills/prompt/LICENSE");
  assert.match(notices, /Nidhin Joseph Nelson/);
  assert.ok(notices.includes(licence.match(/Permission is hereby granted[^\n]*/)[0]), "the MIT grant");
  assert.match(read("skills/prompt/SKILL.md"), /what success looks like, in a way that can be measured/);
});
