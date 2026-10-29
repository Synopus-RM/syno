// Syno Progress's commands (PRD S-03). The skill collects facts with its
// collect.mjs and writes report.json (its judgement); this turns them into the
// shared-look report, keeps the trend, and sends progress.snapshot to Pulse.
//   syno progress render [--report F] [--facts F] [--confirm]
//   syno progress status [--report F] [--facts F]
import { join } from "node:path";
import { WritePlan, jsonText, readJson, usage } from "../fsutil.js";
import { describePlan, notifyPulse, nowOf } from "../chronicle/docs.js";
import { today } from "../chronicle/records.js";
import { planReport } from "../reports.js";
import { progressModel, progressPulse, progressReport } from "./report.js";

export const WORK_DIR = ".syno/local/progress";
const HISTORY = `${WORK_DIR}/history.json`;

function inputs(ctx) {
  const reportFile = typeof ctx.flags.report === "string" ? ctx.flags.report : join(ctx.repo, WORK_DIR, "report.json");
  const factsFile = typeof ctx.flags.facts === "string" ? ctx.flags.facts : join(ctx.repo, WORK_DIR, "facts.json");
  const report = readJson(reportFile);
  if (!report?.items) throw usage(`No report.json with items at ${reportFile}. Follow the progress skill: collect the facts, then write report.json.`);
  return { report, facts: readJson(factsFile, {}) };
}

export async function run(ctx) {
  const [sub = "status"] = ctx.args;
  if (!["status", "render"].includes(sub)) throw usage("progress takes: status, render.");
  const { report, facts } = inputs(ctx);
  const history = readJson(join(ctx.repo, HISTORY), []);
  const model = progressModel(report, facts, history.at(-1) ?? null);
  const date = today(nowOf(ctx));
  const project = report.project?.name ?? readJson(join(ctx.repo, ".syno/config.json"))?.project?.name ?? "This project";
  const shaped = progressReport(model, { project, date });
  if (sub === "status") return { code: 0, text: [`${shaped.verdict.level.toUpperCase()}: ${shaped.verdict.text}`, ...shaped.summary.map((s) => `- ${s}`)].join("\n"), data: { model: progressPulse(model), verdict: shaped.verdict } };
  const plan = new WritePlan(ctx.repo);
  const out = planReport(plan, "progress", shaped);
  const snapshot = { date, pct: model.overall.pct, counts: model.overall.counts };
  const next = history.at(-1)?.date === date ? [...history.slice(0, -1), snapshot] : [...history, snapshot];
  plan.write(HISTORY, jsonText(next.slice(-200)));
  const applied = plan.apply({ confirm: ctx.confirm });
  if (applied.applied) await notifyPulse(ctx.repo, "progress.snapshot", progressPulse(model));
  const notes = out.problems.length ? ["", "Wording to fix before sharing:", ...out.problems.map((p) => `  - ${p}`)] : [];
  return { code: 0, text: [`${shaped.verdict.level.toUpperCase()}: ${shaped.verdict.text}`, describePlan(plan, applied.applied), ...notes].join("\n"), data: { applied: applied.applied, verdict: shaped.verdict, overall: model.overall.pct, paths: out.paths, problems: out.problems } };
}
