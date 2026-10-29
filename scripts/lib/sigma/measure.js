// Syno Sigma's measurements (PRD §4.2, S-13). Collects units, opportunities
// and defects from what the other functions recorded, then works out DPMO,
// the sigma level and first-pass yield. Reads only; the same records always
// give the same numbers (AC-SG.3).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { readJson } from "../fsutil.js";
import { loadChanges, loadReleases } from "../chronicle/records.js";

export const RUNS = ".syno/local/runs.jsonl";
const AUDIT_CATEGORIES = 5;
const BLOCKING_AUDIT = new Set(["critical", "major"]);

// Acklam's rational approximation of the inverse normal CDF (error below 1.2e-9).
const A = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
const B = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
const C = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
const D = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];

export function normInv(p) {
  const low = 0.02425;
  const tail = (q) => (((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5]) / ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1);
  if (p < low) return tail(Math.sqrt(-2 * Math.log(p)));
  if (p > 1 - low) return -tail(Math.sqrt(-2 * Math.log(1 - p)));
  const q = p - 0.5;
  const r = q * q;
  return ((((((A[0] * r + A[1]) * r + A[2]) * r + A[3]) * r + A[4]) * r + A[5]) * q) / (((((B[0] * r + B[1]) * r + B[2]) * r + B[3]) * r + B[4]) * r + 1);
}

export const dpmoOf = (defects, opportunities) => (opportunities ? (defects / opportunities) * 1_000_000 : 0);

/** Short-term sigma with the usual 1.5σ shift, capped at 6 (no defects) and 0. */
export function sigmaLevel(dpmo) {
  if (dpmo <= 3.4) return 6;
  if (dpmo >= 1_000_000) return 0;
  return Math.min(6, Math.max(0, Math.round((normInv(1 - dpmo / 1_000_000) + 1.5) * 100) / 100));
}

const leavesOf = (nodes) => (nodes ?? []).flatMap((n) => (n.children?.length ? leavesOf(n.children) : [n]));

function fromTasks(root) {
  const breakdown = readJson(join(root, ".syno/tasks/breakdown.json"));
  if (!breakdown?.tree) return null;
  const units = leavesOf(breakdown.tree).filter((t) => t.status !== "cancelled");
  const defects = [];
  let opportunities = 0;
  for (const t of units) {
    const acceptance = (t.acceptance ?? []).map((a) => (typeof a === "string" ? { text: a } : a));
    opportunities += Math.max(1, acceptance.length);
    acceptance.filter((a) => a.failedFirst).forEach((a) => defects.push({ source: "acceptance", unit: t.id, title: `${t.id}: "${a.text}" failed its first check`, date: a.failedOn ?? null }));
    for (let i = 0; i < (t.reopenedCount ?? 0); i++) defects.push({ source: "reopened", unit: t.id, title: `${t.id} was reopened after done`, date: null });
  }
  return { kind: "task", units: units.map((t) => ({ id: t.id, done: t.status === "done", firstPass: t.firstPass !== false })), opportunities, defects };
}

/** Without a task breakdown, each Chronicle change is a unit (PRD §4.2). */
function fromChanges(root) {
  const n = loadChanges(root).length + loadReleases(root).reduce((sum, r) => sum + (r.changes?.length ?? 0), 0);
  return { kind: "change", units: Array.from({ length: n }, (_, i) => ({ id: `change-${i + 1}`, done: true, firstPass: true })), opportunities: n, defects: [] };
}

function fromRuns(root) {
  let lines = [];
  try {
    lines = readFileSync(join(root, RUNS), "utf8").split("\n").filter(Boolean);
  } catch {}
  const runs = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((r) => r && (r.kind === "test" || r.kind === "build"));
  return { opportunities: runs.length, defects: runs.filter((r) => r.ok === false).map((r) => ({ source: r.kind === "test" ? "test-run" : "build", unit: null, title: r.kind === "test" ? `A test run failed (${r.failed ?? "some"} failing)` : "A build failed", date: String(r.at ?? "").slice(0, 10) || null })) };
}

async function fromModules(root) {
  const out = { opportunities: 0, defects: [] };
  const { failedSteps, stepCount } = await import("../testguide/cli.js");
  out.opportunities += stepCount(root);
  out.defects.push(...failedSteps(root).map((s) => ({ source: "test-guide", unit: s.task, title: `Test guide "${s.guide}", step ${s.step}, didn't match`, date: s.date ?? null })));
  const { auditHistory } = await import("../audit/cli.js");
  const seen = new Set();
  for (const a of auditHistory(root)) {
    out.opportunities += AUDIT_CATEGORIES;
    for (const f of a.findings ?? []) {
      const key = `${f.category}|${String(f.title).toLowerCase()}`;
      if (seen.has(key) || f.status === "fixed" || !BLOCKING_AUDIT.has(f.severity)) continue;
      seen.add(key);
      out.defects.push({ source: "audit", unit: null, title: `${f.severity === "critical" ? "Critical" : "Major"} audit finding: ${f.title}`, date: a.date ?? null });
    }
  }
  // Syno Security and Compliance add theirs when they are installed (S-15, S-16).
  for (const name of ["security", "compliance"]) {
    const path = fileURLToPath(new URL(`../${name}/cli.js`, import.meta.url));
    if (!existsSync(path)) continue;
    const mod = await import(pathToFileURL(path).href);
    if (typeof mod.sigmaInput !== "function") continue;
    const got = mod.sigmaInput(root);
    out.opportunities += got.opportunities;
    out.defects.push(...got.defects);
  }
  return out;
}

/** Monday of the ISO week for a YYYY-MM-DD date. */
function weekOf(date) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** A u-chart of defects per unit by week; points above the upper control limit are flagged. */
export function controlChart(defects, units) {
  const byWeek = new Map();
  for (const d of defects) if (d.date) byWeek.set(weekOf(d.date), (byWeek.get(weekOf(d.date)) ?? 0) + 1);
  const weeks = [...byWeek.keys()].sort();
  if (!weeks.length || !units) return { weeks: [], centre: 0, ucl: 0 };
  const centre = [...byWeek.values()].reduce((a, b) => a + b, 0) / (weeks.length * units);
  const ucl = centre + 3 * Math.sqrt(centre / units);
  const round = (x) => Math.round(x * 1000) / 1000;
  return { weeks: weeks.map((w) => ({ week: w, defects: byWeek.get(w), perUnit: round(byWeek.get(w) / units), out: byWeek.get(w) / units > ucl })), centre: round(centre), ucl: round(ucl) };
}

/** The full measurement for a project, as saved in .syno/sigma/<date>.json. */
export async function measure(root, { date, target = 4 }) {
  const base = fromTasks(root) ?? fromChanges(root);
  const runs = fromRuns(root);
  const mods = await fromModules(root);
  const opportunities = base.opportunities + runs.opportunities + mods.opportunities;
  const defects = [...base.defects, ...runs.defects, ...mods.defects].sort((a, b) => (a.source + a.title < b.source + b.title ? -1 : 1));
  const dpmo = dpmoOf(defects.length, opportunities);
  const hit = new Set(defects.map((d) => d.unit).filter(Boolean));
  const checked = base.units.filter((u) => u.done || hit.has(u.id));
  const passed = checked.filter((u) => u.firstPass && !hit.has(u.id));
  const bySource = defects.reduce((a, d) => ({ ...a, [d.source]: (a[d.source] ?? 0) + 1 }), {});
  return {
    schemaVersion: 1,
    date,
    target,
    unit: base.kind,
    units: base.units.length,
    opportunities,
    defects: defects.length,
    dpmo: Math.round(dpmo),
    sigma: sigmaLevel(dpmo),
    fpy: { passed: passed.length, checked: checked.length, pct: checked.length ? Math.round((passed.length / checked.length) * 100) : null },
    bySource,
    defectList: defects,
    control: controlChart(defects, base.units.length),
  };
}

