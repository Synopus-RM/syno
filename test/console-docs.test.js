// S-17 Syno Console: the skill, the command, the record schemas and the PRD section.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { commit, initRepo } from "./fixtures.js";
import { validate, describeErrors } from "../scripts/lib/schema.js";
import { copyFiles } from "../scripts/lib/console/install.js";
import { runConsole } from "../skills/console/scripts/console.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (...p) => readFileSync(join(ROOT, ...p), "utf8");
const front = (text) => Object.fromEntries(/^---\n([\s\S]*?)\n---\n/.exec(text)[1].split("\n").map((l) => /^([\w-]+):\s*(.*)$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2]]));

test("S-17 the console skill names its DMAIC steps, every level and the askAt rule", () => {
  const text = read("skills/console/SKILL.md");
  const fm = front(text);
  assert.equal(fm.name, "console");
  assert.ok(fm.description.startsWith("Syno Console."), "description opens with the function name");
  assert.ok(fm.description.length >= 300 && fm.description.length <= 600, `description ${fm.description.length} characters`);
  assert.match(text, /\*\*DMAIC steps: Define and Control\.\*\*/);
  for (const heading of ["## If you are Syno Console", "## If you are a phase", "## If you are a milestone", "## If you are a task"]) assert.ok(text.includes(heading), heading);
  assert.match(text, /askAt/);
  assert.match(text, /never use plan mode/i);
  assert.match(text, /archive[^\n]*only after[^\n]*verif/i);
  assert.match(text, /references\/protocol\.md/);
  assert.match(text, /references\/console-duties\.md/);
  assert.doesNotMatch(text, /CLAUDE_PLUGIN_ROOT/, "the cloud copy has no plugin root");
  for (const f of readdirSync(join(ROOT, "skills/console"), { recursive: true })) {
    if (/\.(md|mjs)$/.test(String(f))) assert.doesNotMatch(read("skills/console", String(f)), /akmo/i, String(f));
  }
});

test("S-17 the cloud copy renames the skill and says where it came from", () => {
  const skill = copyFiles(ROOT, "1.2.3").find((f) => f.path.endsWith("/SKILL.md"));
  assert.equal(front(skill.text).name, "syno-console");
  assert.match(skill.text, /Copied from Syno 1\.2\.3 by \/syno:console install/);
});

test("S-17 /syno:console names its four uses and asks before writing", () => {
  const text = read("commands/console.md");
  for (const use of ["start", "phase", "status", "install"]) assert.match(text, new RegExp(`\\b${use}\\b`), use);
  assert.match(text, /AskUserQuestion/);
  assert.match(text, /--confirm` only (on|after) a yes/);
});

test("S-17 records written by the CLI validate against the schemas", async () => {
  const repo = initRepo("console-schemas");
  commit(repo, "init", undefined, { "README.md": "r\n", ".syno/config.json": JSON.stringify({ console: { numbers: ["ADR"] } }) });
  execFileSync("git", ["checkout", "-q", "-b", "claude/syno-console"], { cwd: repo });
  const run = (...argv) => runConsole([...argv, "--confirm"], { cwd: repo, now: new Date("2026-11-21T10:00:00Z") });
  await run("start", "--branch", "claude/syno-console", "--session", "s-con");
  writeFileSync(join(repo, "q.json"), JSON.stringify({ from: "A.M1.T1", path: ["A", "A.M1"], text: "Which?", options: ["X (Recommended)", "Y"], blocking: true }));
  await run("question", "--file", "q.json");
  writeFileSync(join(repo, "d.json"), JSON.stringify({ scope: "A", question: "Which?", options: ["X", "Y"], chosen: "X", reason: "Simpler", questionId: "Q-A.M1.T1-01", askedBy: "A.M1.T1" }));
  await run("decide", "--file", "d.json");
  await run("numbers", "ADR", "--to", "A.M1", "--count", "5", "--start", "436");
  await run("record", "A", "--status", "running", "--session", "s-a", "--name", "Foundations", "--merge", "abc1234");
  const kinds = { nodes: "node", decisions: "decision", rules: "rule", questions: "question", numbers: "numbers" };
  let checked = 0;
  for (const [dir, kind] of Object.entries(kinds)) {
    const schema = JSON.parse(read("schemas", `console-${kind}.schema.json`));
    for (const f of readdirSync(join(repo, ".syno/console", dir))) {
      const errors = validate(schema, JSON.parse(readFileSync(join(repo, ".syno/console", dir, f), "utf8")));
      assert.deepEqual(describeErrors(`${dir}/${f}`, errors), []);
      checked++;
    }
  }
  assert.ok(checked >= 16, `${checked} records checked`);
});

test("S-17 the PRD and README describe Syno Console", () => {
  const prd = read("PRD.md");
  assert.match(prd, /### 6\.18 S-17 Syno Console/);
  assert.match(prd, /\| S-17 \| Syno Console \|/);
  for (let i = 1; i <= 10; i++) assert.match(prd, new RegExp(`AC-CN\\.${i}:`), `AC-CN.${i}`);
  assert.match(prd, /`\.syno\/console\/`/);
  assert.match(prd, /\| `\/syno:console/);
  assert.match(read("README.md"), /\| Syno Console \|/);
});
