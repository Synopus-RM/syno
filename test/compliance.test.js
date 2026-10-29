// Chunk 4.6: Syno Compliance (PRD S-15, AC-CO.1 to AC-CO.4, AC-PL.2).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { catalogMarkdown, detectPlaces, screen } from "../scripts/lib/compliance/catalog.js";
import { checkItems, isStale } from "../scripts/lib/compliance/cli.js";
import { compliancePulse, complianceReport } from "../scripts/lib/compliance/report.js";
import { renderReport } from "../scripts/lib/report/render.js";
import { commit, initRepo, tmp } from "./fixtures.js";

const CLI = fileURLToPath(new URL("../scripts/syno.js", import.meta.url));
const IDEA = "An app for shop owners in Chennai. Customers sign up with their phone number and get an OTP by SMS.";
const DPDP = { law: "Digital Personal Data Protection Act, 2023", ref: "s. 5", place: "IN", why: "Phone numbers are personal data", requires: "Notice and consent", status: "Gap", severity: "Critical", action: "Add a consent screen before sign-up", feature: "Sign-up", source: "https://www.meity.gov.in", checked: "2026-10-30", verified: "web" };
const DLT = { law: "TRAI TCCCPR 2018", ref: "DLT", place: "IN", why: "OTP by SMS", requires: "DLT header and template", status: "Met", severity: "Critical", source: "https://www.trai.gov.in", checked: "2026-10-30", verified: "web" };

function project() {
  const root = initRepo("compliance");
  commit(root, "chore: start", "2026-01-01T09:00:00Z", { "PRD.md": `# Shop app\n\n${IDEA}\n`, ".gitignore": ".syno/local/\n.syno/reports/\n" });
  const env = { ...process.env, SYNO_PULSE_HOME: tmp("pulse") };
  const syno = (...a) => spawnSync(process.execPath, [CLI, ...a, "--repo", root, "--now", "2026-10-30T10:00:00"], { encoding: "utf8", env });
  syno("init", "--name", "Shop", "--confirm");
  const file = (items, name = "check.json") => {
    const f = join(tmp("co-scratch"), name);
    writeFileSync(f, JSON.stringify({ places: ["IN", "IN-TN"], items }));
    return f;
  };
  return { root, syno, file };
}

test("AC-CO.1 an idea that collects phone numbers in India and sends OTPs lists the DPDP Act and the TRAI DLT rules", () => {
  const places = detectPlaces(IDEA);
  assert.deepEqual(places, ["IN", "IN-TN"]);
  const { areas, laws } = screen(IDEA, places);
  assert.ok(areas.includes("personal-data") && areas.includes("sms-otp"));
  const names = laws.map((l) => l.law).join("\n");
  assert.match(names, /Digital Personal Data Protection Act, 2023/);
  assert.match(names, /TRAI Telecom Commercial Communications Customer Preference Regulations, 2018/);
  assert.match(names, /CERT-In Directions/, "India's IT security rules always apply");
});

test("S-15 India is always in scope, whatever the text says", () => {
  assert.deepEqual(detectPlaces("A shop in Berlin, Germany"), ["IN", "EU"]);
});

test("AC-CO.4 with no web access, no item is marked Met", () => {
  const { items } = checkItems({ items: [{ ...DLT, verified: undefined }, { ...DPDP, verified: "memory" }] });
  assert.equal(items[0].status, "Unclear");
  assert.equal(items[0].note, "From memory — verify");
  assert.equal(items[1].status, "Gap");
  assert.ok(items.every((i) => i.status !== "Met"));
  assert.match(checkItems({ items: [{ ...DPDP, action: undefined }] }).problems.join(), /a gap needs what to do/);
});

test("AC-CO.3 a release with an open Critical gap is blocked until fixed or overridden", () => {
  const { syno, file } = project();
  syno("compliance", "record", "--scope", "prd", "--file", file([DPDP, DLT]), "--confirm");
  syno("change", "Consent screen", "--type", "Added", "--confirm");
  const refused = syno("release", "cut", "--confirm");
  assert.equal(refused.status, 1);
  assert.match(refused.stdout, /Critical compliance gap open: Digital Personal Data Protection Act, 2023/);
  syno("compliance", "record", "--scope", "release", "--file", file([{ ...DPDP, status: "Met" }, DLT], "fixed.json"), "--now", "2026-10-30T11:00:00", "--confirm");
  assert.equal(syno("release", "cut", "--confirm").status, 0);
});

test("AC-CO.2 AC-PL.2 editing PRD.md after a check makes the check out of date, and the release gate waits", () => {
  const { root, syno, file } = project();
  syno("compliance", "record", "--scope", "prd", "--file", file([DLT]), "--confirm");
  assert.equal(isStale(root), false);
  writeFileSync(join(root, "PRD.md"), `# Shop app\n\n${IDEA}\nNow with UPI payments.\n`);
  assert.equal(isStale(root), true);
  assert.match(syno("compliance", "status").stdout, /Compliance check out of date/);
  assert.match(syno("sigma", "gate", "--release").stdout, /Compliance check out of date: PRD\.md changed after the last check/);
});

test("S-15 the report says it isn't legal advice, reads plainly, and Pulse gets counts and law names only", () => {
  const rec = { date: "2026-10-30", scope: "prd", places: ["IN", "IN-TN"], items: [{ id: "CO-001", ...DPDP }, { id: "CO-002", ...DLT }] };
  const report = complianceReport(rec, { project: "Shop" });
  assert.equal(report.verdict.level, "red");
  const { markdown, problems } = renderReport(report, { css: "", version: "0.1.0" });
  assert.match(markdown, /This is not legal advice\. Ask a qualified professional to confirm Critical items\./);
  assert.deepEqual(problems, []);
  assert.deepEqual(compliancePulse(rec), { scope: "prd", places: ["IN", "IN-TN"], met: 1, gaps: 1, unclear: 0, critical: [{ title: "Digital Personal Data Protection Act, 2023" }] });
});

test("S-15 places are saved in the config with India kept, only on --confirm", () => {
  const { root, syno } = project();
  syno("compliance", "places", "--set", "IN-TN,EU");
  assert.deepEqual(JSON.parse(readFileSync(join(root, ".syno/config.json"), "utf8")).compliance.jurisdictions, [{ country: "IN" }]);
  syno("compliance", "places", "--set", "IN-TN,EU", "--confirm");
  assert.deepEqual(JSON.parse(readFileSync(join(root, ".syno/config.json"), "utf8")).compliance.jurisdictions, [{ country: "IN" }, { country: "IN", state: "TN" }, { country: "EU" }]);
  assert.match(syno("compliance", "places").stdout, /- IN-TN: Tamil Nadu/);
});

test("S-15 references/catalog.md is the catalog as rendered from the code", () => {
  assert.equal(readFileSync(fileURLToPath(new URL("../skills/compliance/references/catalog.md", import.meta.url)), "utf8"), catalogMarkdown());
});
