// Chunk 3.9: Syno Audit (PRD S-05, AC-AU.1, AC-AU.2).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkFindings, openFindings } from "../scripts/lib/audit/cli.js";
import { auditPulse, auditReport } from "../scripts/lib/audit/report.js";
import { renderReport } from "../scripts/lib/report/render.js";
import { commit, initRepo, tmp } from "./fixtures.js";

const CLI = fileURLToPath(new URL("../scripts/syno.js", import.meta.url));
const CRITICAL = { category: "LOG", severity: "critical", title: "Invoice total adds GST twice", why: "Customers are overcharged", evidence: [{ file: "src/invoice.ts", line: 42 }], fix: "Apply GST once" };
const MAJOR = { category: "WFE", severity: "major", title: "Save fails silently when offline", evidence: [{ file: "src/save.ts", line: 9 }], fix: "Show an error and retry" };
const MINOR = { category: "UX", severity: "minor", title: "Button label is cut off at 375 px", evidence: [{ file: "src/Button.tsx", line: 3 }], fix: "Allow two lines" };

function project() {
  const repo = initRepo("audit");
  commit(repo, "chore: start", "2026-01-01T09:00:00Z", { "src/invoice.ts": "x\n", ".gitignore": ".syno/local/\n.syno/reports/\n" });
  const scratch = tmp("audit-scratch");
  const env = { ...process.env, SYNO_PULSE_HOME: tmp("pulse") };
  const syno = (...a) => spawnSync(process.execPath, [CLI, "audit", ...a, "--repo", repo, "--now", "2026-10-30T10:00:00"], { encoding: "utf8", env });
  const findings = (list, name = "f.json") => {
    const file = join(scratch, name);
    writeFileSync(file, JSON.stringify({ scope: { app: "Demo" }, checks: [{ command: "npx tsc --noEmit", result: "pass", errors: 0 }], findings: list, coverage: ["src/invoice.ts"] }));
    return file;
  };
  return { repo, syno, findings };
}

test("S-05 a finding without evidence or a fix is refused", () => {
  assert.match(checkFindings({ findings: [{ category: "LOG", severity: "critical", title: "Bad" }] }).join("\n"), /needs evidence[\s\S]*needs a recommended fix/);
  assert.match(checkFindings({ findings: [{ ...MINOR, category: "STYLE" }] }).join("\n"), /category must be one of/);
  assert.deepEqual(checkFindings({ findings: [CRITICAL, MAJOR, MINOR] }), []);
});

test("AC-AU.1 the audit changes no file outside .syno/", () => {
  const { repo, syno, findings } = project();
  syno("record", "--file", findings([CRITICAL, MINOR]), "--confirm");
  assert.equal(execFileSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" }), "");
  assert.ok(existsSync(join(repo, ".syno/reports/audit/latest.html")));
  assert.equal(readdirSync(join(repo, ".syno/local/audit")).length, 1);
});

test("AC-AU.2 a Critical finding fixed between two audits shows as fixed, and the gate passes", () => {
  const { repo, syno, findings } = project();
  syno("record", "--file", findings([CRITICAL, MAJOR]), "--confirm");
  assert.equal(openFindings(repo, "critical").length, 1);
  const second = JSON.parse(syno("record", "--file", findings([MAJOR], "g.json"), "--confirm", "--json").stdout);
  assert.deepEqual(second.fixed, ["LOG-001"]);
  assert.equal(openFindings(repo, "critical").length, 0);
  assert.match(readFileSync(join(repo, ".syno/reports/audit/latest.md"), "utf8"), /### Fixed since the last audit\n\n- LOG-001: Invoice total adds GST twice/);
});

test("S-05 Red with any Critical, Amber with any Major, Green otherwise; the report reads plainly", () => {
  const rec = (list) => ({ date: "2026-10-30", findings: list.map((f, i) => ({ ...f, id: `X-${i}`, status: "open" })), checks: [], coverage: [] });
  assert.equal(auditReport(rec([CRITICAL, MINOR]), { project: "D" }).verdict.level, "red");
  assert.equal(auditReport(rec([MAJOR]), { project: "D" }).verdict.level, "amber");
  assert.equal(auditReport(rec([MINOR]), { project: "D" }).verdict.level, "green");
  const { problems, markdown } = renderReport(auditReport(rec([CRITICAL, MAJOR, MINOR]), { project: "D" }), { css: "", version: "0.1.0" });
  assert.deepEqual(problems, []);
  assert.match(markdown, /\| Logic errors \| 1 \| 0 \| 0 \|/);
});

test("S-05 accepting a risk needs a reason, and it stops counting against the gate", () => {
  const { repo, syno, findings } = project();
  syno("record", "--file", findings([CRITICAL]), "--confirm");
  assert.equal(syno("accept", "LOG-001", "--reason", "short").status, 2);
  syno("accept", "LOG-001", "--reason", "Client signed off on rounding rules", "--confirm");
  assert.equal(openFindings(repo, "critical").length, 0);
});

test("AC-PU.5 Pulse gets counts and titles, never file paths", () => {
  const data = auditPulse({ findings: [{ ...CRITICAL, status: "open" }, { ...MAJOR, status: "open" }] });
  assert.equal(data.counts.LOG.critical, 1);
  assert.deepEqual(data.critical, [{ title: "Invoice total adds GST twice" }]);
  assert.doesNotMatch(JSON.stringify(data), /src\//);
});
