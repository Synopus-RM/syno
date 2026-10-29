// Chunk 3.10: Syno Test (PRD S-07, AC-TE.1).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { testRecord, testReport } from "../scripts/lib/testguide/cli.js";
import { renderReport } from "../scripts/lib/report/render.js";
import { tmp } from "./fixtures.js";

const CLI = fileURLToPath(new URL("../scripts/syno.js", import.meta.url));
const BUILD = fileURLToPath(new URL("../skills/test/scripts/build_guide.py", import.meta.url));
const GUIDE = {
  title: "Invoices can be sent on WhatsApp",
  summary: "Invoices now have a Share button that opens WhatsApp.",
  minutes: 6,
  devices: [{ name: "Android phone", how: "Settings › About shows 1.3.1 or later" }],
  scenarios: [
    { id: "s1", kind: "story", title: "Meena sends a bill", story: "A customer wants the bill on WhatsApp.", steps: [{ id: "s1-1", do: "Open the invoice and tap **Share**.", see: "A menu with WhatsApp opens." }, { id: "s1-2", do: "Tap **WhatsApp**.", see: "The PDF is attached." }] },
    { id: "s2", kind: "whatif", title: "No WhatsApp on the phone", story: "What if WhatsApp isn't installed?", steps: [{ id: "s2-1", do: "Tap **Share** on a phone without WhatsApp.", see: "A message says WhatsApp isn't installed." }] },
  ],
};

function project() {
  const root = tmp("testguide");
  mkdirSync(join(root, ".syno/tasks"), { recursive: true });
  writeFileSync(join(root, ".syno/tasks/breakdown.json"), JSON.stringify({ project: { name: "Demo" }, tree: [{ id: "P1", title: "Build", children: [{ id: "P1.1", title: "Share invoices on WhatsApp", status: "in_progress", estimate: 4, acceptance: [{ text: "PDF attaches", done: true }] }] }] }));
  const scratch = tmp("tg-scratch");
  writeFileSync(join(scratch, "guide.json"), JSON.stringify(GUIDE));
  const env = { ...process.env, SYNO_PULSE_HOME: tmp("pulse") };
  const syno = (...a) => spawnSync(process.execPath, [CLI, ...a, "--repo", root, "--now", "2026-10-30T10:00:00"], { encoding: "utf8", env });
  const answers = (rows, name) => {
    const f = join(scratch, name);
    writeFileSync(f, JSON.stringify(rows));
    return f;
  };
  return { root, scratch, syno, answers };
}

test("S-07 the checklist page is in Sky Glass and opens with a verdict line", () => {
  const out = tmp("tg-out");
  const guideFile = join(out, "guide.json");
  writeFileSync(guideFile, JSON.stringify(GUIDE));
  execFileSync("python3", ["-I", BUILD, guideFile, "--html", join(out, "page.html"), "--md", join(out, "page.md")], { encoding: "utf8" });
  const html = readFileSync(join(out, "page.html"), "utf8");
  assert.match(html, /--accent: #0369a1;/);
  assert.match(html, /<span class="verdict" id="verdict" aria-live="polite">Amber: not tested yet<\/span>/);
  assert.match(html, /Green: everything matched/);
});

test("AC-TE.1 a guide with one Fail adds a defect, and the task's done gate fails until a new guide passes", () => {
  const { root, scratch, syno, answers } = project();
  const first = answers([{ id: "s1-1", data: { status: "pass" } }, { id: "s1-2", data: { status: "fail", note: "No PDF was attached" } }, { id: "s2-1", data: { status: "pass" } }], "a1.json");
  syno("test", "record", "--guide", join(scratch, "guide.json"), "--answers", first, "--task", "P1.1", "--confirm");
  const blocked = syno("tasks", "set", "P1.1", "done", "--confirm");
  assert.equal(blocked.status, 1);
  assert.match(blocked.stdout, /Test guide "Invoices can be sent on WhatsApp" had 1 step\(s\) that didn't match/);
  const second = answers(["s1-1", "s1-2", "s2-1"].map((id) => ({ id, status: "pass" })), "a2.json");
  const again = JSON.parse(spawnSync(process.execPath, [CLI, "test", "record", "--guide", join(scratch, "guide.json"), "--answers", second, "--task", "P1.1", "--repo", root, "--now", "2026-10-31T10:00:00", "--confirm", "--json"], { encoding: "utf8", env: { ...process.env, SYNO_PULSE_HOME: tmp("pulse") } }).stdout);
  assert.deepEqual(again.totals, { pass: 3, fail: 0, unanswered: 0 });
  assert.equal(syno("tasks", "set", "P1.1", "done", "--confirm").status, 0);
});

test("S-07 the results report reads plainly: Red with a Fail, Amber with gaps, Green when all match", () => {
  const rec = (rows) => testRecord(GUIDE, new Map(Object.entries(rows)), { date: "2026-10-30" });
  const fail = testReport(rec({ "s1-1": { status: "pass" }, "s1-2": { status: "fail", note: "No PDF" }, "s2-1": { status: "pass" } }), { project: "Demo" });
  assert.equal(fail.verdict.level, "red");
  assert.deepEqual(fail.actions, [{ text: "Fix step 1.2: No PDF", who: "Developer" }]);
  assert.equal(testReport(rec({ "s1-1": { status: "pass" } }), { project: "Demo" }).verdict.level, "amber");
  const green = testReport(rec({ "s1-1": { status: "pass" }, "s1-2": { status: "pass" }, "s2-1": { status: "pass" } }), { project: "Demo" });
  assert.equal(green.verdict.level, "green");
  assert.deepEqual(renderReport(fail, { css: "", version: "0.1.0" }).problems, []);
});
