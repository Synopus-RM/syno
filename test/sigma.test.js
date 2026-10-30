// Chunk 4.1: Syno Sigma's measurements (PRD §4.2, S-13, AC-SG.1, AC-SG.3). Fixture F:
// a breakdown of 10 tasks with 5 acceptance criteria each and 3 defects.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { controlChart, measure, sigmaLevel } from "../scripts/lib/sigma/measure.js";
import { handle, runLines } from "../scripts/lib/sigma/hooks.js";
import { sigmaPulse, sigmaReport } from "../scripts/lib/sigma/report.js";
import { renderReport } from "../scripts/lib/report/render.js";
import { tmp } from "./fixtures.js";

const CLI = fileURLToPath(new URL("../scripts/syno.js", import.meta.url));

export function fixtureF() {
  const root = tmp("fixture-f");
  mkdirSync(join(root, ".syno/tasks"), { recursive: true });
  writeFileSync(join(root, ".syno/config.json"), JSON.stringify({ schemaVersion: 2, project: { name: "Demo" } }));
  const task = (i) => ({
    id: `T${i}`,
    title: `Task ${i}`,
    status: i <= 6 ? "done" : "todo",
    estimate: 2,
    acceptance: Array.from({ length: 5 }, (_, k) => ({ text: `Check ${k + 1}`, done: i <= 6, ...(i <= 2 && k === 0 ? { failedFirst: true, failedOn: "2026-10-20" } : {}) })),
    ...(i === 3 ? { reopenedCount: 1, firstPass: false } : {}),
  });
  writeFileSync(join(root, ".syno/tasks/breakdown.json"), JSON.stringify({ project: { name: "Demo" }, tree: [{ id: "P1", title: "Build", children: Array.from({ length: 10 }, (_, i) => task(i + 1)) }] }));
  const syno = (...a) => spawnSync(process.execPath, [CLI, ...a, "--repo", root, "--now", "2026-10-30T10:00:00"], { encoding: "utf8", env: { ...process.env, SYNO_PULSE_HOME: tmp("pulse") } });
  return { root, syno };
}

test("AC-SG.1 3 defects across 10 units of 5 opportunities give a DPMO of 60,000 and about 3.05σ", async () => {
  const { root } = fixtureF();
  const m = await measure(root, { date: "2026-10-30" });
  assert.equal(m.units, 10);
  assert.equal(m.opportunities, 50);
  assert.equal(m.defects, 3);
  assert.equal(m.dpmo, 60000);
  assert.equal(m.sigma, 3.05);
  assert.deepEqual(m.fpy, { passed: 3, checked: 6, pct: 50 });
  assert.deepEqual(m.bySource, { acceptance: 2, reopened: 1 });
});

test("§4.2 the sigma table: 3.4 is 6σ, 233 is 5σ, 6,210 is 4σ, 66,807 is 3σ, 308,538 is 2σ", () => {
  assert.deepEqual([3.4, 233, 6210, 66807, 308538].map(sigmaLevel), [6, 5, 4, 3, 2]);
  assert.equal(sigmaLevel(0), 6);
  assert.equal(sigmaLevel(1_000_000), 0);
});

test("AC-SG.3 two runs on the same records give the same numbers, and measure saves them only on --confirm", () => {
  const { root, syno } = fixtureF();
  const a = JSON.parse(syno("sigma", "measure", "--json").stdout);
  assert.equal(a.applied, false);
  const b = JSON.parse(syno("sigma", "measure", "--confirm", "--json").stdout);
  assert.deepEqual(a.measurement, b.measurement);
  assert.deepEqual(JSON.parse(readFileSync(join(root, ".syno/sigma/2026-10-30.json"), "utf8")), b.measurement);
  assert.match(readFileSync(join(root, ".syno/reports/sigma/latest.md"), "utf8"), /Where problems come from/);
});

test("S-13 test and build runs are logged without the command or its output, and count as checks", async () => {
  const { root } = fixtureF();
  assert.deepEqual(runLines("npm test", "Tests  3 failed | 40 passed", "2026-10-29T09:00:00Z"), [{ at: "2026-10-29T09:00:00Z", kind: "test", ok: false, passed: 40, failed: 3, failing: [] }]);
  assert.deepEqual(runLines("ls -la", "total 3", "x"), []);
  handle("PostToolUse", { tool_name: "Bash", tool_input: { command: "SECRET=abc npm test" }, tool_response: { stdout: "# pass 12\n# fail 1" } }, { cwd: join(root, ".syno/tasks"), now: "2026-10-29T09:00:00Z" });
  const log = readFileSync(join(root, ".syno/local/runs.jsonl"), "utf8");
  assert.doesNotMatch(log, /SECRET|npm/);
  const m = await measure(root, { date: "2026-10-30" });
  assert.equal(m.opportunities, 51);
  assert.equal(m.bySource["test-run"], 1);
});

test("S-13 a test guide's Fail and a Critical audit finding count as defects; a Minor one doesn't", async () => {
  const { root } = fixtureF();
  mkdirSync(join(root, ".syno/local/tests"), { recursive: true });
  writeFileSync(join(root, ".syno/local/tests/2026-10-28-share.json"), JSON.stringify({ title: "Share", date: "2026-10-28", task: "T7", scenarios: [{ steps: [{ step: "1.1", status: "pass" }, { step: "1.2", status: "fail" }] }], totals: { pass: 1, fail: 1, unanswered: 0 } }));
  mkdirSync(join(root, ".syno/local/audit"), { recursive: true });
  writeFileSync(join(root, ".syno/local/audit/2026-10-29.json"), JSON.stringify({ date: "2026-10-29", findings: [{ category: "LOG", severity: "critical", title: "GST added twice", status: "open" }, { category: "UX", severity: "minor", title: "Label cut off", status: "open" }] }));
  const m = await measure(root, { date: "2026-10-30" });
  assert.equal(m.opportunities, 50 + 2 + 5);
  assert.equal(m.bySource["test-guide"], 1);
  assert.equal(m.bySource.audit, 1);
  assert.equal(m.fpy.checked, 7, "the task with a failed guide step counts as checked");
});

test("§4.2 the control chart flags a week above the upper control limit", () => {
  const defects = [...Array(12)].map(() => ({ date: "2026-10-26" })).concat([{ date: "2026-10-05" }, { date: "2026-10-12" }, { date: "2026-10-19" }]);
  const chart = controlChart(defects, 10);
  assert.deepEqual(chart.weeks.map((w) => [w.week, w.out]), [["2026-10-05", false], ["2026-10-12", false], ["2026-10-19", false], ["2026-10-26", true]]);
});

test("§5.3 the report reads plainly, and Pulse gets numbers only", async () => {
  const { root } = fixtureF();
  const m = await measure(root, { date: "2026-10-30" });
  const report = sigmaReport(m, { project: "Demo" });
  assert.equal(report.verdict.level, "amber");
  assert.deepEqual(renderReport(report, { css: "", version: "0.1.0" }).problems, []);
  assert.equal(sigmaReport(m, { project: "Demo", gates: [{ name: "Done", status: "fail", reasons: ["T7: a test failed"] }] }).verdict.level, "red");
  assert.doesNotMatch(JSON.stringify(sigmaPulse(m)), /Task|Check/);
  assert.deepEqual(sigmaPulse(m, [{ name: "Done", status: "pass" }, { name: "Release", status: "fail" }]).gates, { done: "pass", release: "fail" }, "the panel's Sigma column reads the gates");
});

test("S-13 tasks tick --failed records a criterion's first failed check once", () => {
  const { root, syno } = fixtureF();
  syno("tasks", "tick", "T7", "2", "--failed", "--confirm");
  syno("tasks", "tick", "T7", "2", "--failed", "--now", "2026-10-31T10:00:00", "--confirm");
  const t7 = JSON.parse(readFileSync(join(root, ".syno/tasks/breakdown.json"), "utf8")).tree[0].children[6];
  assert.deepEqual(t7.acceptance[1], { text: "Check 2", done: false, failedFirst: true, failedOn: "2026-10-30" });
});
