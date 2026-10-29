// Syno Audit's commands (PRD S-05). The audit itself is the skill's
// read-only method; it writes its findings as JSON. These commands keep each
// audit in .syno/local/audit/ (git-ignored), mark earlier findings fixed when
// they no longer show up, render the shared-look report, feed open Critical
// findings to the gates, and send audit.result to Pulse.
//   syno audit record --file <findings.json> [--confirm]
//   syno audit accept <id> --reason "..." [--confirm]
//   syno audit status | report [--confirm]
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { WritePlan, jsonText, readJson, usage } from "../fsutil.js";
import { describePlan, notifyPulse, nowOf } from "../chronicle/docs.js";
import { today } from "../chronicle/records.js";
import { planReport } from "../reports.js";
import { auditPulse, auditReport } from "./report.js";

export const DIR = ".syno/local/audit";
export const CATEGORIES = ["WFB", "WFE", "UX", "LOG", "SYN"];
export const SEVERITIES = ["critical", "major", "minor"];

// "2026-10-30.json" is run 1 of that day, "2026-10-30-2.json" run 2. Plain string
// order would put run 2 first ("-" sorts before "."), so sort by date, then run.
const runOf = (name) => {
  const m = /^(\d{4}-\d{2}-\d{2})(?:-(\d+))?\.json$/.exec(name);
  return [m[1], Number(m[2] ?? 1)];
};
const byRun = (a, b) => {
  const [da, na] = runOf(a);
  const [db, nb] = runOf(b);
  return da < db ? -1 : da > db ? 1 : na - nb;
};

function audits(root) {
  let names = [];
  try {
    names = readdirSync(join(root, DIR)).filter((n) => /^\d{4}-\d{2}-\d{2}(-\d+)?\.json$/.test(n)).sort(byRun);
  } catch {}
  return names.map((n) => ({ file: `${DIR}/${n}`, ...readJson(join(root, DIR, n), {}) }));
}

export const latestAudit = (root) => audits(root).at(-1) ?? null;

/** Every recorded audit, oldest first, for Syno Sigma. */
export const auditHistory = (root) => audits(root);

/** Open findings from the latest audit, optionally of one severity (the gates use critical). */
export function openFindings(root, severity) {
  return (latestAudit(root)?.findings ?? []).filter((f) => f.status === "open" && (!severity || f.severity === severity));
}

const key = (f) => `${f.category}|${String(f.title).toLowerCase().replace(/\W+/g, " ").trim()}|${f.evidence?.[0]?.file ?? ""}`;

/** Checks a findings file and returns problems in plain words ([] when it's fine). */
export function checkFindings(data) {
  const problems = [];
  if (!Array.isArray(data?.findings)) return ["The file needs a findings list."];
  data.findings.forEach((f, i) => {
    const at = `Finding ${i + 1}${f.id ? ` (${f.id})` : ""}`;
    if (!CATEGORIES.includes(f.category)) problems.push(`${at}: category must be one of ${CATEGORIES.join(", ")}.`);
    if (!SEVERITIES.includes(String(f.severity).toLowerCase())) problems.push(`${at}: severity must be critical, major or minor.`);
    if (!f.title) problems.push(`${at}: needs a one-line title.`);
    if (!f.evidence?.length || !f.evidence.every((e) => e.file && (e.line || e.command))) problems.push(`${at}: needs evidence (file and line, or the command that showed it). No evidence, no finding.`);
    if (!f.fix) problems.push(`${at}: needs a recommended fix.`);
  });
  return problems;
}

/** The new audit record: its findings open, plus earlier open findings it no longer found, marked fixed (AC-AU.2). */
function newRecord(data, previous, date) {
  const counters = {};
  const findings = data.findings.map((f) => {
    counters[f.category] = (counters[f.category] ?? 0) + 1;
    return { ...f, id: f.id ?? `${f.category}-${String(counters[f.category]).padStart(3, "0")}`, severity: String(f.severity).toLowerCase(), status: "open" };
  });
  const seen = new Set(findings.map(key));
  const accepted = new Map((previous?.findings ?? []).filter((f) => f.status === "accepted").map((f) => [key(f), f]));
  for (const f of findings) if (accepted.has(key(f))) Object.assign(f, { status: "accepted", acceptedReason: accepted.get(key(f)).acceptedReason });
  const fixed = (previous?.findings ?? []).filter((f) => f.status === "open" && !seen.has(key(f))).map((f) => ({ ...f, status: "fixed", fixedOn: date }));
  return { schemaVersion: 1, date, scope: data.scope ?? {}, checks: data.checks ?? [], findings: [...findings, ...fixed], unverified: data.unverified ?? [], coverage: data.coverage ?? [] };
}

function fileFor(root, date) {
  const taken = new Set(audits(root).map((a) => a.file));
  let name = `${DIR}/${date}.json`;
  for (let n = 2; taken.has(name); n++) name = `${DIR}/${date}-${n}.json`;
  return name;
}

async function record(ctx) {
  if (typeof ctx.flags.file !== "string") throw usage("Pass the findings with --file <findings.json>.");
  const data = readJson(ctx.flags.file);
  const problems = checkFindings(data);
  if (problems.length) return { code: 1, text: ["The findings file needs fixing first:", ...problems.map((p) => `  - ${p}`)].join("\n"), data: { problems } };
  const date = today(nowOf(ctx));
  const rec = newRecord(data, latestAudit(ctx.repo), date);
  const plan = new WritePlan(ctx.repo).write(fileFor(ctx.repo, date), jsonText(rec));
  const report = auditReport(rec, { project: readJson(join(ctx.repo, ".syno/config.json"))?.project?.name ?? "This project" });
  const out = planReport(plan, "audit", report);
  const applied = plan.apply({ confirm: ctx.confirm });
  if (applied.applied) await notifyPulse(ctx.repo, "audit.result", auditPulse(rec));
  return { code: 0, text: [`${report.verdict.level.toUpperCase()}: ${report.verdict.text}`, describePlan(plan, applied.applied)].join("\n"), data: { applied: applied.applied, verdict: report.verdict, paths: out.paths, fixed: rec.findings.filter((f) => f.status === "fixed").map((f) => f.id) } };
}

/** The owner accepts a finding's risk (with a reason); it stops counting against the gates. */
function accept(ctx, [id]) {
  const reason = typeof ctx.flags.reason === "string" ? ctx.flags.reason.trim() : "";
  if (reason.length < 10) throw usage('Say why the risk is accepted, in at least 10 characters, with --reason "...".');
  const latest = latestAudit(ctx.repo);
  const finding = latest?.findings.find((f) => f.id === id);
  if (!finding) throw usage(`No finding ${id} in the latest audit.`);
  const { file, ...rec } = latest;
  rec.findings = rec.findings.map((f) => (f.id === id ? { ...f, status: "accepted", acceptedReason: reason } : f));
  const plan = new WritePlan(ctx.repo).write(file, jsonText(rec));
  const applied = plan.apply({ confirm: ctx.confirm });
  return { code: 0, text: [`Accept the risk of ${id} (${finding.title}): ${reason}`, describePlan(plan, applied.applied)].join("\n"), data: { applied: applied.applied } };
}

async function report(ctx, sub) {
  const latest = latestAudit(ctx.repo);
  if (!latest) return { code: 0, text: "No audit has been recorded here yet. Run /syno:audit.", data: { audited: false } };
  const shaped = auditReport(latest, { project: readJson(join(ctx.repo, ".syno/config.json"))?.project?.name ?? "This project" });
  if (sub === "status") return { code: 0, text: [`${shaped.verdict.level.toUpperCase()}: ${shaped.verdict.text}`, ...shaped.summary.map((s) => `- ${s}`)].join("\n"), data: auditPulse(latest) };
  const plan = new WritePlan(ctx.repo);
  const out = planReport(plan, "audit", shaped);
  const applied = plan.apply({ confirm: ctx.confirm });
  return { code: 0, text: describePlan(plan, applied.applied), data: { applied: applied.applied, paths: out.paths } };
}

export async function run(ctx) {
  const [sub = "status", ...rest] = ctx.args;
  if (sub === "record") return record(ctx);
  if (sub === "accept") return accept(ctx, rest);
  if (sub === "status" || sub === "report") return report(ctx, sub);
  throw usage("audit takes: record, accept, status, report.");
}
