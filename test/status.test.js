// Chunk 4.8: /syno:status and syno doctor (PRD X-04, AC-XC.1, AC-CO.2, AC-CH-01.3).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { initRepo, commit, tmp } from "./fixtures.js";

const CLI = fileURLToPath(new URL("../scripts/syno.js", import.meta.url));

function project({ init = true } = {}) {
  const root = initRepo("status");
  commit(root, "chore: start", "2026-01-01T09:00:00Z", { "README.md": "# Demo\n", "PRD.md": "# Demo PRD\n" });
  const env = { ...process.env, SYNO_PULSE_HOME: tmp("pulse"), WG_HOME: tmp("wg") };
  const syno = (...a) => spawnSync(process.execPath, [CLI, ...a, "--repo", root, "--now", "2026-10-30T10:00:00"], { encoding: "utf8", env });
  if (init) syno("init", "--name", "Demo", "--confirm");
  return { root, syno };
}

test("AC-XC.1 /syno:status in a fresh project opens with a verdict and lists what to do next", () => {
  const { syno } = project({ init: false });
  const out = syno("status").stdout;
  assert.match(out, /^AMBER: Syno isn't set up in this project yet\./);
  assert.match(out, /What to do next:\n  1\. Run \/syno:init/);
  const set = project();
  const after = set.syno("status").stdout;
  assert.match(after, /^(GREEN|AMBER|RED): /);
  assert.match(after, /- Version: no release yet/);
  assert.match(after, /- Security: not checked yet\./);
  assert.match(after, /What to do next:\n  1\. /);
});

test("AC-CH-01.3 status warns while Syno's local folders aren't ignored, and stops once they are", () => {
  const { syno } = project();
  assert.match(syno("status").stdout, /Warning: Syno's local folders are not ignored by git/);
  syno("ignore", "--confirm");
  assert.doesNotMatch(syno("status").stdout, /not ignored by git/);
});

test("AC-CO.2 editing PRD.md after a check makes /syno:status show Compliance check out of date", () => {
  const { root, syno } = project();
  const check = join(tmp("st-scratch"), "c.json");
  writeFileSync(check, JSON.stringify({ items: [{ law: "DPDP Act, 2023", why: "Phone numbers", requires: "Consent", status: "Met", severity: "Critical", verified: "web" }] }));
  syno("compliance", "record", "--scope", "prd", "--file", check, "--confirm");
  assert.doesNotMatch(syno("status").stdout, /out of date/);
  writeFileSync(join(root, "PRD.md"), "# Demo PRD\n\nNow with payments.\n");
  const out = syno("status").stdout;
  assert.match(out, /^RED: Something blocks the next release\./);
  assert.match(out, /- Compliance: Compliance check out of date\./);
});

test("X-04 doctor finds missing .gitignore lines and duplicate ids, and fixes them only with --confirm", () => {
  const { root, syno } = project();
  mkdirSync(join(root, ".syno/security"), { recursive: true });
  writeFileSync(join(root, ".syno/security/abuse-cases.json"), JSON.stringify({ schemaVersion: 1, cases: [{ id: "SEC-0007", role: "Student", rule: "see others' marks", why: "w", control: "c", status: "Planned" }, { id: "SEC-0007", role: "Teacher", rule: "change marks after lock", why: "w", control: "c", status: "Planned" }] }));
  const preview = syno("doctor");
  assert.match(preview.stdout, /Abuse case SEC-0007 appears twice; renumber the second "change marks after lock" SEC-0008/);
  assert.match(preview.stdout, /\.gitignore lines missing/);
  assert.ok(!existsSync(join(root, ".gitignore")));
  syno("doctor", "--confirm");
  assert.deepEqual(JSON.parse(readFileSync(join(root, ".syno/security/abuse-cases.json"), "utf8")).cases.map((c) => c.id), ["SEC-0007", "SEC-0008"]);
  assert.match(readFileSync(join(root, ".gitignore"), "utf8"), /\.syno\/trash\//);
  const after = syno("doctor").stdout;
  assert.doesNotMatch(after, /Duplicate|gitignore/);
  assert.match(after, /The PRD has never had a compliance check/, "a stale check is reported, not fixed");
});

test("X-04 doctor renumbers an idea that two branches both created", () => {
  const { root, syno } = project();
  syno("idea", "CSV export", "--confirm");
  const first = JSON.parse(readFileSync(join(root, ".syno/ideas/IDEA-0001.json"), "utf8"));
  writeFileSync(join(root, ".syno/ideas/IDEA-0001-other.json"), JSON.stringify({ ...first, title: "PDF export" }, null, 2));
  syno("doctor", "--confirm");
  assert.equal(JSON.parse(readFileSync(join(root, ".syno/ideas/IDEA-0002.json"), "utf8")).title, "PDF export");
  assert.ok(!existsSync(join(root, ".syno/ideas/IDEA-0001-other.json")));
});
