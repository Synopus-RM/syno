// Chunk 4.2: Syno Sigma's gates and overrides (PRD §4.3, AC-TA.2, AC-SG.2, AC-CH-05.4 with an audit finding).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { handle } from "../scripts/lib/sigma/hooks.js";
import { commit, initRepo, tmp } from "./fixtures.js";

const CLI = fileURLToPath(new URL("../scripts/syno.js", import.meta.url));
const FAILING_RUN = "not ok 4 - invoice total adds GST once\n# pass 11\n# fail 1\n";

function project() {
  const root = initRepo("gates");
  commit(root, "chore: start", "2026-01-01T09:00:00Z", { "README.md": "# Demo\n", ".gitignore": ".syno/local/\n.syno/reports/\n" });
  const env = { ...process.env, SYNO_PULSE_HOME: tmp("pulse") };
  const syno = (...a) => spawnSync(process.execPath, [CLI, ...a, "--repo", root, "--now", "2026-10-30T10:00:00"], { encoding: "utf8", env });
  syno("init", "--name", "Demo", "--confirm");
  mkdirSync(join(root, ".syno/tasks"), { recursive: true });
  writeFileSync(join(root, ".syno/tasks/breakdown.json"), JSON.stringify({ project: { name: "Demo" }, tree: [{ id: "P1", title: "Build", children: [{ id: "P1.1", title: "Invoice totals", status: "in_progress", estimate: 2, acceptance: [{ text: "Totals add GST once", done: true }] }] }] }));
  const run = (output) => handle("PostToolUse", { tool_name: "Bash", tool_input: { command: "node --test" }, tool_response: { stdout: output } }, { cwd: root, now: "2026-10-30T09:00:00Z" });
  const critical = () => {
    mkdirSync(join(root, ".syno/local/audit"), { recursive: true });
    writeFileSync(join(root, ".syno/local/audit/2026-10-30.json"), JSON.stringify({ date: "2026-10-30", findings: [{ id: "LOG-001", category: "LOG", severity: "critical", title: "Invoice total adds GST twice", status: "open" }] }));
  };
  return { root, syno, run, critical };
}

test("AC-TA.2 marking a task done while its tests fail leaves it In progress, with the failing test named", () => {
  const { root, syno, run } = project();
  run(FAILING_RUN);
  const res = syno("tasks", "set", "P1.1", "done", "--confirm");
  assert.equal(res.status, 1);
  assert.match(res.stdout, /P1\.1 stays In progress/);
  assert.match(res.stdout, /invoice total adds GST once/);
  assert.equal(JSON.parse(readFileSync(join(root, ".syno/tasks/breakdown.json"), "utf8")).tree[0].children[0].status, "in_progress");
  run("# pass 12\n# fail 0\n");
  assert.equal(syno("tasks", "set", "P1.1", "done", "--confirm").status, 0);
});

test("AC-SG.2 an override without a reason of at least 10 characters is refused", () => {
  const { root, syno } = project();
  const res = syno("sigma", "override", "--gate", "done", "--task", "P1.1", "--items", "tests:last-run", "--reason", "because", "--confirm");
  assert.equal(res.status, 2);
  assert.match(res.stderr, /at least 10 characters/);
  assert.throws(() => readdirSync(join(root, ".syno/sigma/overrides")));
});

test("§4.3 a done-gate override lets that task's named items through, and the task records it", () => {
  const { root, syno, run } = project();
  run(FAILING_RUN);
  const ov = JSON.parse(syno("sigma", "override", "--gate", "done", "--task", "P1.1", "--items", "tests:last-run", "--reason", "Flaky on CI only; tracked in P1.4", "--confirm", "--json").stdout);
  assert.ok(ov.override.who && ov.override.at.startsWith("2026-10-30"), "who and when are stored");
  assert.equal(syno("tasks", "set", "P1.1", "done", "--confirm").status, 0);
  const task = JSON.parse(readFileSync(join(root, ".syno/tasks/breakdown.json"), "utf8")).tree[0].children[0];
  assert.deepEqual(task.overrides, [ov.override.id]);
});

test("AC-CH-05.4 with an open Critical finding the cut is refused; an override is stored in the release and used once", () => {
  const { root, syno, critical } = project();
  syno("change", "Round invoice totals", "--type", "Fixed", "--confirm");
  critical();
  const refused = syno("release", "cut", "--confirm");
  assert.equal(refused.status, 1);
  assert.match(refused.stdout, /Critical audit finding still open: Invoice total adds GST twice/);
  const gate = JSON.parse(syno("sigma", "gate", "--release", "--json").stdout);
  assert.deepEqual(gate.items.map((i) => i.id), ["audit:LOG-001"]);
  const ov = JSON.parse(syno("sigma", "override", "--gate", "release", "--items", "audit:LOG-001", "--reason", "Client signed off on the rounding rule", "--confirm", "--json").stdout).override;
  assert.equal(syno("release", "cut", "--confirm").status, 0);
  const release = JSON.parse(readFileSync(join(root, ".syno/releases", readdirSync(join(root, ".syno/releases"))[0]), "utf8"));
  assert.deepEqual(release.overrides, [ov.id]);
  syno("change", "Share invoices", "--type", "Added", "--confirm");
  assert.equal(syno("release", "cut", "--confirm").status, 1, "the next release needs its own override");
});

test("§4.3 the Sigma report shows the failing gate as Red and lists every override", () => {
  const { root, syno, critical } = project();
  critical();
  syno("sigma", "override", "--gate", "release", "--items", "audit:LOG-001", "--reason", "Client signed off on the rounding rule", "--confirm");
  syno("sigma", "measure", "--confirm");
  const md = readFileSync(join(root, ".syno/reports/sigma/latest.md"), "utf8");
  assert.match(md, /Done gate: Critical audit finding still open/);
  assert.match(md, /## Gate overrides[\s\S]*Client signed off on the rounding rule/);
});
