// Syno Security's commands (PRD S-16). The abuse-case register is committed;
// findings stay on this machine in .syno/local/security/ and the report in
// .syno/reports/security/, both git-ignored. Open Critical or High findings
// and Failing abuse cases block the done and release gates.
//   syno security design --file <cases.json> [--confirm]     add or update abuse cases
//   syno security scan [--history] [--confirm]               routes without permission checks, and secrets
//   syno security deps [--confirm]                           the project's own audit tool, through the Governor
//   syno security record --file <review.json> [--confirm]    the code review's findings
//   syno security attack --plan <plan.json> [--confirm]      abuse-case tests on localhost only
//   syno security status | report [--confirm]
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { WritePlan, jsonText, readJson, refusal, usage } from "../fsutil.js";
import { describePlan, notifyPulse, nowOf } from "../chronicle/docs.js";
import { stamp, today } from "../chronicle/records.js";
import { planReport } from "../reports.js";
import { runApproved } from "../run.js";
import { auditCommand, parseAudit } from "./deps.js";
import { assertLocalPlan, planUrls } from "./local.js";
import { securityPulse, securityReport } from "./report.js";
import { scanRoutes, scanSecrets } from "./scan.js";

export const CASES = ".syno/security/abuse-cases.json";
export const DIR = ".syno/local/security";
const ATTACK = fileURLToPath(new URL("../../../skills/security/scripts/attack.mjs", import.meta.url));
const SEVERITIES = ["Critical", "High", "Medium", "Low"];
const CASE_STATUSES = ["Planned", "Enforced", "Tested", "Failing"];
const BLOCKING = new Set(["Critical", "High"]);

export const loadCases = (root) => readJson(join(root, CASES))?.cases ?? [];

function records(root) {
  let names = [];
  try {
    names = readdirSync(join(root, DIR)).filter((n) => n.endsWith(".json")).sort();
  } catch {}
  return names.map((n) => readJson(join(root, DIR, n))).filter(Boolean);
}

/** The latest record of each kind of check; their findings are the open ones. */
export function latestByKind(root) {
  const out = new Map();
  for (const r of records(root)) out.set(r.kind, r);
  return [...out.values()];
}

export const openFindings = (root) => latestByKind(root).flatMap((r) => r.findings);

const project = (root) => readJson(join(root, ".syno/config.json"))?.project?.name ?? "This project";

async function save(ctx, kind, findings, intro, extra = (plan) => plan) {
  const now = nowOf(ctx);
  const prefix = kind.toUpperCase();
  const rec = { schemaVersion: 1, date: today(now), kind, findings: findings.map((f, i) => ({ id: `${prefix}-${String(i + 1).padStart(3, "0")}`, status: "open", ...f })) };
  const plan = extra(new WritePlan(ctx.repo).write(`${DIR}/${stamp(now)}-${kind}.json`, jsonText(rec)));
  const others = latestByKind(ctx.repo).filter((r) => r.kind !== kind);
  const report = securityReport({ date: rec.date, cases: loadCases(ctx.repo), records: [...others, rec] }, { project: project(ctx.repo) });
  const out = planReport(plan, "security", report);
  const applied = plan.apply({ confirm: ctx.confirm });
  if (applied.applied) await notifyPulse(ctx.repo, "security.result", securityPulse({ cases: loadCases(ctx.repo), records: [...others, rec] }));
  return { code: 0, text: [...intro, `${report.verdict.level.toUpperCase()}: ${report.verdict.text}`, describePlan(plan, applied.applied)].join("\n"), data: { applied: applied.applied, findings: rec.findings, paths: out.paths } };
}

function design(ctx) {
  const data = typeof ctx.flags.file === "string" ? readJson(ctx.flags.file) : null;
  if (!Array.isArray(data?.cases)) throw usage("Pass the abuse cases with --file <cases.json> ({ cases: [...] }).");
  const cases = [...loadCases(ctx.repo)];
  let next = cases.reduce((n, c) => Math.max(n, Number(c.id.slice(4))), 0);
  const problems = [];
  for (const [i, c] of data.cases.entries()) {
    if (!c.role || !c.rule || !c.why || !c.control) problems.push(`Case ${i + 1}: needs the role, the rule (what must never happen), why it matters and the control.`);
    if (c.status && !CASE_STATUSES.includes(c.status)) problems.push(`Case ${i + 1}: status is ${CASE_STATUSES.join(", ")}.`);
    const id = c.id ?? `SEC-${String(++next).padStart(4, "0")}`;
    const at = cases.findIndex((x) => x.id === id);
    const merged = { id, role: c.role, rule: c.rule, why: c.why, control: c.control, test: c.test ?? null, feature: c.feature ?? null, status: c.status ?? (at >= 0 ? cases[at].status : "Planned") };
    if (at >= 0) cases[at] = merged;
    else cases.push(merged);
  }
  if (problems.length) return { code: 1, text: ["The abuse cases need fixing first:", ...problems.map((p) => `  - ${p}`)].join("\n"), data: { problems } };
  const plan = new WritePlan(ctx.repo).write(CASES, jsonText({ schemaVersion: 1, cases }));
  const applied = plan.apply({ confirm: ctx.confirm });
  return { code: 0, text: [`${cases.length} abuse case(s): ${cases.map((c) => `${c.id} ${c.role} must never ${c.rule.replace(/^must never /i, "")}`).join("; ")}.`, describePlan(plan, applied.applied)].join("\n"), data: { applied: applied.applied, cases } };
}

function checkReview(data) {
  const problems = [];
  (data?.findings ?? []).forEach((f, i) => {
    if (!SEVERITIES.includes(f.severity)) problems.push(`Finding ${i + 1}: severity is Critical, High, Medium or Low.`);
    if (!f.title || !f.reason || !f.fix) problems.push(`Finding ${i + 1}: needs a title, a one-line reason and a fix.`);
    if (!f.evidence?.length || !f.evidence.every((e) => e.file && e.line)) problems.push(`Finding ${i + 1}: needs file-and-line evidence. No evidence, no finding.`);
  });
  if (!Array.isArray(data?.findings)) problems.push("The file needs a findings list.");
  return problems;
}

function deps(ctx) {
  const tool = auditCommand(ctx.repo);
  if (!tool) return { code: 0, text: "No lockfile or audit tool found, so there is nothing to scan.", data: { findings: [] } };
  if (!ctx.confirm) return { code: 0, text: `Would run the project's own audit tool through Syno Governor: ${tool.command}\nAdd --confirm to run it. Syno only reads its output.`, data: { applied: false, command: tool.command } };
  const r = runApproved(tool.command, { approved: true, cwd: ctx.repo, label: "security deps" });
  return save(ctx, "deps", parseAudit(tool.tool, r.stdout), [`Ran ${tool.command}.`]);
}

async function attack(ctx) {
  const file = typeof ctx.flags.plan === "string" ? ctx.flags.plan : null;
  const plan = file ? readJson(file) : null;
  if (!plan) throw usage("Pass the attack plan with --plan <plan.json>.");
  assertLocalPlan(plan);
  const cases = loadCases(ctx.repo);
  const unknown = plan.cases.filter((c) => !cases.some((x) => x.id === c.id)).map((c) => c.id);
  if (unknown.length) throw usage(`Not in the abuse-case register: ${unknown.join(", ")}. Add them with syno security design first.`);
  if (!ctx.confirm) return { code: 0, text: [`Would send ${planUrls(plan).length} request(s) to this machine only, through Syno Governor:`, ...planUrls(plan).map((u) => `  - ${u}`), "Add --confirm to run them."].join("\n"), data: { applied: false } };
  const r = runApproved(`"${process.execPath}" "${ATTACK}" "${file}"`, { approved: true, cwd: ctx.repo, label: "security attack tests" });
  if (r.code === 3) throw refusal(r.stderr.trim());
  const results = JSON.parse(r.stdout.trim().split("\n").at(-1) ?? "{}").results ?? [];
  const updated = cases.map((c) => ({ ...c, status: results.find((x) => x.id === c.id)?.status ?? c.status }));
  const findings = results.filter((x) => x.status === "Failing").map((x) => ({ category: "abuse", severity: "High", title: `${x.id} failed: ${cases.find((c) => c.id === x.id).rule}`, reason: x.checks.filter((c) => !c.ok).map((c) => `${c.request}: ${c.problem}`).join("; "), evidence: [{ file: CASES, line: 1 }], fix: cases.find((c) => c.id === x.id).control }));
  return save(ctx, "attack", findings, results.map((x) => `- ${x.id}: ${x.status}`), (p) => p.write(CASES, jsonText({ schemaVersion: 1, cases: updated })));
}

/** Gate items for done and release (PRD §4.3, S-16 rule 8). */
export function gateItems(root) {
  const findings = openFindings(root).filter((f) => f.status === "open" && BLOCKING.has(f.severity)).map((f) => ({ id: `security:${f.id}`, text: `${f.severity} security finding still open: ${f.title}.` }));
  const failing = loadCases(root).filter((c) => c.status === "Failing").map((c) => ({ id: `security:${c.id}`, text: `Abuse case ${c.id} is failing: ${c.role} must never ${c.rule.replace(/^must never /i, "")}.` }));
  return [...findings, ...failing];
}

export function sigmaInput(root) {
  const cases = loadCases(root);
  const latest = latestByKind(root);
  const defects = [
    ...latest.flatMap((r) => r.findings.filter((f) => f.status === "open" && BLOCKING.has(f.severity)).map((f) => ({ source: "security", unit: null, title: `${f.severity} security finding: ${f.title}`, date: r.date }))),
    ...cases.filter((c) => c.status === "Failing").map((c) => ({ source: "security", unit: null, title: `Abuse case ${c.id} failing`, date: null })),
  ];
  return { opportunities: cases.length + latest.length, defects };
}

async function report(ctx, sub) {
  const data = { date: today(nowOf(ctx)), cases: loadCases(ctx.repo), records: latestByKind(ctx.repo) };
  const shaped = securityReport(data, { project: project(ctx.repo) });
  if (sub === "status") return { code: 0, text: [`${shaped.verdict.level.toUpperCase()}: ${shaped.verdict.text}`, ...shaped.summary.map((s) => `- ${s}`)].join("\n"), data: securityPulse(data) };
  const plan = new WritePlan(ctx.repo);
  const out = planReport(plan, "security", shaped);
  const applied = plan.apply({ confirm: ctx.confirm });
  return { code: 0, text: describePlan(plan, applied.applied), data: { applied: applied.applied, paths: out.paths } };
}

export async function run(ctx) {
  const [sub = "status"] = ctx.args;
  if (sub === "design") return design(ctx);
  if (sub === "scan") return save(ctx, "scan", [...scanRoutes(ctx.repo), ...scanSecrets(ctx.repo, { history: ctx.flags.history === true })], ["Scanned routes and tracked files (read-only)."]);
  if (sub === "deps") return deps(ctx);
  if (sub === "record") {
    const data = typeof ctx.flags.file === "string" ? readJson(ctx.flags.file) : null;
    const problems = checkReview(data);
    if (problems.length) return { code: 1, text: ["The review file needs fixing first:", ...problems.map((p) => `  - ${p}`)].join("\n"), data: { problems } };
    return save(ctx, "review", data.findings, ["Recorded the code review."]);
  }
  if (sub === "attack") return attack(ctx);
  if (sub === "status" || sub === "report") return report(ctx, sub);
  throw usage("security takes: design, scan, deps, record, attack, status, report.");
}
