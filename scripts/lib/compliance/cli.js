// Syno Compliance's commands (PRD S-15). The skill reads the idea or PRD,
// checks each law's current text and writes the requirements as JSON; these
// commands screen the topics, keep the places, record each check with a hash
// of the PRD (so a later PRD edit makes it stale), feed the release gate and
// Sigma, render the report and send compliance.result to Pulse.
//   syno compliance screen [--file <idea.md>]      default: the PRD
//   syno compliance places [--set IN,IN-TN,EU] [--confirm]
//   syno compliance record --scope idea|prd|release --file <check.json> [--confirm]
//   syno compliance status
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { WritePlan, jsonText, readJson, readText, sha256, usage } from "../fsutil.js";
import { describePlan, notifyPulse, nowOf } from "../chronicle/docs.js";
import { stamp, today } from "../chronicle/records.js";
import { planReport } from "../reports.js";
import { PLACES, detectPlaces, screen } from "./catalog.js";
import { compliancePulse, complianceReport } from "./report.js";

export const DIR = ".syno/compliance";
const SCOPES = ["idea", "prd", "release"];
const STATUSES = ["Met", "Gap", "Unclear"];
const SEVERITIES = ["Critical", "Major", "Minor"];

const config = (root) => readJson(join(root, ".syno/config.json"), {}) ?? {};
const prdPath = (root) => config(root).compliance?.prd ?? "PRD.md";
const prdHash = (root) => (existsSync(join(root, prdPath(root))) ? sha256(readFileSync(join(root, prdPath(root)))) : null);
// The config keeps places as { country, state? } (PRD §8); commands use codes like IN-TN.
const toCode = (j) => (typeof j === "string" ? j : j.state ? `${j.country}-${j.state}` : j.country);
const toPlace = (code) => {
  const [country, state] = code.split("-");
  return state ? { country, state } : { country };
};
export const places = (root) => [...new Set(["IN", ...(config(root).compliance?.jurisdictions ?? []).map(toCode)])];

export function checks(root) {
  let names = [];
  try {
    names = readdirSync(join(root, DIR)).filter((n) => n.endsWith(".json")).sort();
  } catch {}
  return names.map((n) => readJson(join(root, DIR, n))).filter(Boolean);
}

/** The latest check of the PRD or a release: the one the gate and staleness read. */
export const latestCheck = (root) => checks(root).filter((c) => c.scope !== "idea").at(-1) ?? null;

/** True when a PRD exists and changed after the latest check (or was never checked). AC-CO.2, AC-PL.2. */
export function isStale(root) {
  const hash = prdHash(root);
  if (!hash) return false;
  return latestCheck(root)?.prd?.sha256 !== hash;
}

/** Checks a check file; returns { problems, items } with memory-only Met items turned into Unclear (AC-CO.4). */
export function checkItems(data) {
  const problems = [];
  const items = (data?.items ?? []).map((it, i) => {
    const at = `Item ${i + 1}${it.law ? ` (${it.law})` : ""}`;
    if (!it.law || !it.requires || !it.why) problems.push(`${at}: needs the law, why it applies and what it requires.`);
    if (!STATUSES.includes(it.status)) problems.push(`${at}: status is Met, Gap or Unclear.`);
    if (!SEVERITIES.includes(it.severity)) problems.push(`${at}: severity is Critical, Major or Minor.`);
    if (it.status === "Gap" && !it.action) problems.push(`${at}: a gap needs what to do.`);
    const memory = it.verified !== "web";
    return { ...it, verified: memory ? "memory" : "web", ...(memory && it.status === "Met" ? { status: "Unclear", note: "From memory — verify" } : memory ? { note: it.note ?? "From memory — verify" } : {}) };
  });
  if (!items.length) problems.push("The file needs an items list.");
  return { problems, items };
}

function screenCmd(ctx) {
  const file = typeof ctx.flags.file === "string" ? ctx.flags.file : join(ctx.repo, prdPath(ctx.repo));
  const text = readText(file);
  if (text === null) throw usage(`Nothing to screen: ${file} doesn't exist. Pass the idea with --file <idea.md>.`);
  const found = [...new Set([...places(ctx.repo), ...detectPlaces(text)])];
  const r = screen(text, found);
  const lines = [`Places: ${found.map((p) => PLACES[p] ?? p).join(", ")} (India is always included; confirm or edit with syno compliance places).`, `Areas that apply: ${r.areas.join(", ")}.`, "Usual laws to check (verify each on its official site):", ...r.laws.map((l) => `  - [${l.place}] ${l.law}, ${l.ref}: ${l.requires}`)];
  return { code: 0, text: lines.join("\n"), data: { places: found, ...r } };
}

function placesCmd(ctx) {
  if (typeof ctx.flags.set !== "string") return { code: 0, text: places(ctx.repo).map((p) => `- ${p}: ${PLACES[p] ?? "custom"}`).join("\n"), data: { places: places(ctx.repo) } };
  const list = [...new Set(["IN", ...ctx.flags.set.split(",").map((s) => s.trim()).filter(Boolean)])];
  const raw = config(ctx.repo);
  const plan = new WritePlan(ctx.repo).write(".syno/config.json", jsonText({ ...raw, compliance: { ...raw.compliance, jurisdictions: list.map(toPlace) } }));
  const applied = plan.apply({ confirm: ctx.confirm });
  return { code: 0, text: [`Check against: ${list.map((p) => PLACES[p] ?? p).join(", ")}.`, describePlan(plan, applied.applied)].join("\n"), data: { applied: applied.applied, places: list } };
}

async function record(ctx) {
  const scope = ctx.flags.scope;
  if (!SCOPES.includes(scope)) throw usage("--scope takes idea, prd or release.");
  const data = typeof ctx.flags.file === "string" ? readJson(ctx.flags.file) : null;
  const { problems, items } = checkItems(data);
  if (problems.length) return { code: 1, text: ["The check file needs fixing first:", ...problems.map((p) => `  - ${p}`)].join("\n"), data: { problems } };
  const now = nowOf(ctx);
  const hash = scope === "idea" ? null : prdHash(ctx.repo);
  const rec = { schemaVersion: 1, id: stamp(now), date: today(now), scope, places: data.places ?? places(ctx.repo), prd: hash ? { path: prdPath(ctx.repo), sha256: hash } : null, items: items.map((it, i) => ({ id: `CO-${String(i + 1).padStart(3, "0")}`, ...it })) };
  const plan = new WritePlan(ctx.repo).write(`${DIR}/${rec.id}-${scope}.json`, jsonText(rec));
  const report = complianceReport(rec, { project: config(ctx.repo).project?.name ?? "This project" });
  const out = planReport(plan, "compliance", report);
  const applied = plan.apply({ confirm: ctx.confirm });
  if (applied.applied) await notifyPulse(ctx.repo, "compliance.result", compliancePulse(rec));
  const downgraded = items.filter((it) => it.note === "From memory — verify" && data.items.find((d) => d.law === it.law)?.status === "Met").length;
  return { code: 0, text: [`${report.verdict.level.toUpperCase()}: ${report.verdict.text}`, ...(downgraded ? [`${downgraded} item(s) checked from memory only were marked Unclear, not Met.`] : []), describePlan(plan, applied.applied)].join("\n"), data: { applied: applied.applied, verdict: report.verdict, record: rec, paths: out.paths } };
}

/** Release-gate items (PRD §4.3): open Critical gaps, a stale check, or a PRD never checked. */
export function gateItems(root, kind) {
  if (kind !== "release") return [];
  const last = latestCheck(root);
  const out = (last?.items ?? []).filter((it) => it.status === "Gap" && it.severity === "Critical").map((it) => ({ id: `compliance:${it.id}`, text: `Critical compliance gap open: ${it.law}, ${it.ref ?? ""} (${it.action}).` }));
  if (prdHash(root) && !last) out.push({ id: "compliance:none", text: `${prdPath(root)} has never had a compliance check. Run /syno:compliance prd.` });
  else if (isStale(root)) out.push({ id: "compliance:stale", text: `Compliance check out of date: ${prdPath(root)} changed after the last check. Run /syno:compliance prd.` });
  return out;
}

/** Sigma's view: every requirement checked is one check; a Critical or Major gap is a defect. */
export function sigmaInput(root) {
  const last = latestCheck(root);
  const items = last?.items ?? [];
  return { opportunities: items.length, defects: items.filter((it) => it.status === "Gap" && it.severity !== "Minor").map((it) => ({ source: "compliance", unit: null, title: `${it.severity} compliance gap: ${it.law}`, date: last.date })) };
}

export async function run(ctx) {
  const [sub = "status"] = ctx.args;
  if (sub === "screen") return screenCmd(ctx);
  if (sub === "places") return placesCmd(ctx);
  if (sub === "record") return record(ctx);
  if (sub === "status") {
    const last = checks(ctx.repo).at(-1);
    if (!last) return { code: 0, text: "No compliance check has been recorded here yet. Run /syno:compliance.", data: { checked: false, stale: isStale(ctx.repo) } };
    const r = complianceReport(last, { project: "" });
    return { code: 0, text: [`${r.verdict.level.toUpperCase()}: ${r.verdict.text}`, ...(isStale(ctx.repo) ? ["Compliance check out of date: the PRD changed after the last check."] : [])].join("\n"), data: { checked: true, stale: isStale(ctx.repo), verdict: r.verdict } };
  }
  throw usage("compliance takes: screen, places, record, status.");
}
