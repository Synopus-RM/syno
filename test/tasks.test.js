// Chunk 3.8: Syno Tasks (PRD S-04, AC-TA.1, AC-TA.2 for acceptance, AC-TA.3, AC-PR.2).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { modelFor, synoWarnings } from "../scripts/lib/tasks/cli.js";
import { tasksPulse, tasksReport } from "../scripts/lib/tasks/report.js";
import { renderReport } from "../scripts/lib/report/render.js";
import { tmp } from "./fixtures.js";

const CLI = fileURLToPath(new URL("../scripts/syno.js", import.meta.url));
const EXAMPLE = fileURLToPath(new URL("../skills/tasks/references/example-breakdown.json", import.meta.url));
const RENDER = fileURLToPath(new URL("../skills/tasks/scripts/render.mjs", import.meta.url));

function project() {
  const root = tmp("tasks");
  mkdirSync(join(root, ".syno/tasks"), { recursive: true });
  writeFileSync(join(root, ".syno/tasks/breakdown.json"), readFileSync(EXAMPLE, "utf8"));
  const env = { ...process.env, SYNO_PULSE_HOME: tmp("pulse") };
  const syno = (...a) => spawnSync(process.execPath, [CLI, "tasks", ...a, "--repo", root, "--now", "2026-10-30T10:00:00"], { encoding: "utf8", env });
  const task = (id) => {
    const find = (ns) => ns.flatMap((n) => [n, ...find(n.children ?? [])]);
    return find(JSON.parse(readFileSync(join(root, ".syno/tasks/breakdown.json"), "utf8")).tree).find((n) => n.id === id);
  };
  return { root, syno, task };
}

test("AC-TA.1 a task with no acceptance criterion can't move to In progress", () => {
  const { syno, task } = project();
  const res = syno("set", "P2.1.2", "in_progress", "--confirm");
  assert.equal(res.status, 3);
  assert.match(res.stderr, /no acceptance criterion/);
  assert.equal(task("P2.1.2").status, "todo");
});

test("AC-TA.1 check flags work under way without an acceptance criterion", () => {
  const breakdown = JSON.parse(readFileSync(EXAMPLE, "utf8"));
  const warnings = synoWarnings(breakdown);
  assert.ok(warnings.some((w) => w.startsWith("P1.1 ")), "done without criteria is flagged too");
  assert.ok(!warnings.some((w) => w.startsWith("P2.1.1 ")), "P2.1.1 has three criteria");
});

test("AC-TA.2 marking a task done with unmet acceptance leaves it In progress, with the reason", () => {
  const { syno, task } = project();
  const res = syno("set", "P2.1.1", "done", "--confirm");
  assert.equal(res.status, 1);
  assert.match(res.stdout, /P2\.1\.1 stays In progress\. The done gate didn't pass:\n  - Acceptance not met yet:/);
  assert.equal(task("P2.1.1").status, "in_progress");
  syno("tick", "P2.1.1", "all", "--confirm");
  assert.equal(syno("set", "P2.1.1", "done", "--confirm").status, 0);
  assert.equal(task("P2.1.1").status, "done");
  assert.equal(task("P2.1.1").firstPass, true);
});

test("AC-TA.3 reopening a done task counts as a defect", () => {
  const { syno, task } = project();
  const res = syno("set", "P1.2.1", "in_progress", "--confirm");
  assert.match(res.stdout, /reopened, which counts as a defect/);
  assert.equal(task("P1.2.1").reopenedCount, 1);
  assert.equal(task("P1.2.1").firstPass, false);
});

test("S-04 every status change previews first and writes only with --confirm", () => {
  const { syno, task } = project();
  assert.match(syno("set", "P2.2.1", "blocked", "--blocker", "Waiting on the client").stdout, /would write these files/);
  assert.equal(task("P2.2.1").status, "todo");
});

test("S-04 the report reads plainly, and Pulse gets titles and counts", async () => {
  const { root } = project();
  const model = await modelFor(root);
  const report = tasksReport(model, { project: "FieldPro", date: "2026-10-30" });
  const { markdown, problems } = renderReport(report, { css: "", version: "0.1.0" });
  assert.deepEqual(problems, []);
  assert.ok(report.summary.length >= 3 && report.summary.length <= 5);
  assert.match(markdown, /### Progress by phase/);
  const pulse = tasksPulse(model);
  assert.equal(pulse.counts.blocked, 1);
  assert.ok(pulse.blocked.every((t) => typeof t === "string" && t.length <= 120));
});

test("AC-PR.2 with a Tasks breakdown, Progress shows the same overall %", async () => {
  const { root, syno } = project();
  const tasksPct = (await modelFor(root)).totals.pct;
  mkdirSync(join(root, ".syno/local/progress"), { recursive: true });
  writeFileSync(join(root, ".syno/local/progress/report.json"), JSON.stringify({ items: [{ title: "Anything", status: "todo" }] }));
  const out = spawnSync(process.execPath, [CLI, "progress", "status", "--repo", root, "--json"], { encoding: "utf8" });
  assert.equal(JSON.parse(out.stdout).model.overall, tasksPct);
  assert.match(syno("status").stdout, new RegExp(`${tasksPct}% done`));
});

test("S-04 the board renders in Sky Glass with the Synopus credit", () => {
  const { root } = project();
  const out = join(root, ".syno/reports/tasks");
  execFileSync(process.execPath, [RENDER, "--breakdown", join(root, ".syno/tasks/breakdown.json"), "--out-dir", out], { encoding: "utf8" });
  const board = readFileSync(join(out, "BOARD.html"), "utf8");
  assert.match(board, /--accent:#0369a1/);
  assert.match(board, /Designed &amp; Developed by <a href="https:\/\/www\.synopus\.in"[^>]*>Synopus<\/a>/);
  assert.doesNotMatch(board, /akmo/i);
  assert.ok(existsSync(join(out, "PROGRESS.md")));
});
