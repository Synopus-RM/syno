// Chunk 3.7: Syno Progress (PRD S-03, AC-PR.1).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { progressModel, progressPulse, progressReport } from "../scripts/lib/progress/report.js";
import { renderReport } from "../scripts/lib/report/render.js";
import { fixtureB, tmp } from "./fixtures.js";

const CLI = fileURLToPath(new URL("../scripts/syno.js", import.meta.url));
const COLLECT = fileURLToPath(new URL("../skills/progress/scripts/collect.mjs", import.meta.url));
const REPORT = {
  project: { name: "Demo" },
  targetDate: "2026-12-01",
  phases: ["Design", "Build", "Launch"],
  items: [
    { title: "Home page design", phase: "Design", status: "done", git: { state: "merged" } },
    { title: "Invoice list", phase: "Build", status: "done", git: { state: "pushed" } },
    { title: "Invoice export", phase: "Build", status: "in_progress", percent: 40, next: "Add the Excel button" },
    { title: "Payments", phase: "Build", status: "blocked", blocker: "Live payment keys from the owner" },
    { title: "Go live", phase: "Launch", status: "todo", priority: "high", dependsOn: "Payments" },
    { title: "Old idea", phase: "Build", status: "cancelled" },
  ],
  manual: [{ action: "Add the live payment keys to the host", blocking: true, blocks: "Payments", priority: "high" }, { action: "Approve the home page copy", priority: "low" }],
  risks: [{ text: "No tests for the payment flow yet", severity: "medium" }],
};

test("S-03 overall % is the weighted average of item progress, as in the source skill", () => {
  const m = progressModel(REPORT);
  assert.equal(m.overall.pct, 48); // (100 + 100 + 40 + 0 + 0) / 5 = 48
  assert.deepEqual(m.phases.map((p) => `${p.name} ${p.pct}`), ["Design 100", "Build 47", "Launch 0"]);
  assert.equal(m.notOnMain.length, 1);
  assert.equal(m.manual[0].blocking, true, "blocking actions come first");
});

test("AC-PR.1 the report opens with a verdict, 3 to 5 summary bullets and What you need to do, and reads plainly", () => {
  const report = progressReport(progressModel(REPORT, {}, { pct: 40 }), { project: "Demo", date: "2026-10-30" });
  const { markdown, problems } = renderReport(report, { css: "", version: "0.1.0" });
  assert.deepEqual(problems, []);
  assert.ok(report.summary.length >= 3 && report.summary.length <= 5);
  const at = ["> **Amber:**", "## Summary", "## What you need to do", "## Detail"].map((x) => markdown.indexOf(x));
  assert.deepEqual([...at].sort((a, b) => a - b), at);
  assert.match(markdown, /The project is 48% done\. That's 8 points up since the last report\./);
  assert.match(markdown, /1\. \*\*Add the live payment keys to the host \(holds up: Payments\)\*\*/);
  assert.match(markdown, /\| Invoice list \| Build \| Not yet: waiting to be merged \|/);
});

test("S-03 a passed target date with work left is Red; nothing waiting is Green", () => {
  assert.equal(progressReport(progressModel(REPORT), { project: "D", date: "2026-12-05" }).verdict.level, "red");
  const clean = { items: [{ title: "A", status: "done", git: { state: "merged" } }, { title: "B", status: "todo" }] };
  assert.equal(progressReport(progressModel(clean), { project: "D", date: "2026-10-30" }).verdict.level, "green");
});

test("S-03 Pulse gets titles and counts only", () => {
  assert.deepEqual(progressPulse(progressModel(REPORT)), {
    overall: 48, delta: null,
    phases: [{ name: "Design", percent: 100 }, { name: "Build", percent: 47 }, { name: "Launch", percent: 0 }],
    counts: { done: 2, inProgress: 1, todo: 1, blocked: 1 },
    ownerActions: ["Add the live payment keys to the host", "Approve the home page copy"],
  });
});

test("S-03 collect, write report.json, then render: saved only after --confirm, with the trend kept", () => {
  const repo = fixtureB();
  const work = join(repo, ".syno/local/progress");
  mkdirSync(work, { recursive: true });
  execFileSync(process.execPath, [COLLECT, "--root", repo, "--out-dir", ".syno/local/progress", "--out", join(work, "facts.json")], { encoding: "utf8" });
  assert.ok(JSON.parse(readFileSync(join(work, "facts.json"), "utf8")).git.isRepo);
  writeFileSync(join(work, "report.json"), JSON.stringify(REPORT));
  const env = { ...process.env, SYNO_PULSE_HOME: tmp("pulse") };
  const run = (...a) => spawnSync(process.execPath, [CLI, "progress", ...a, "--repo", repo, "--now", "2026-10-30T10:00:00"], { encoding: "utf8", env });
  assert.match(run("render").stdout, /would write these files/);
  assert.equal(existsSync(join(repo, ".syno/reports/progress/latest.html")), false);
  run("render", "--confirm");
  assert.ok(existsSync(join(repo, ".syno/reports/progress/2026-10-30.html")));
  assert.equal(JSON.parse(readFileSync(join(work, "history.json"), "utf8")).at(-1).pct, 48);
  assert.match(run("status").stdout, /^AMBER: 48% done/);
});
