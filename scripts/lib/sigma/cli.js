// Syno Sigma's commands (PRD S-13). Measuring is a write: the numbers are saved
// in .syno/sigma/<date>.json (committed, so trends survive across machines) and
// the report under .syno/reports/sigma/.
//   syno sigma measure [--confirm]
//   syno sigma status
import { join } from "node:path";
import { WritePlan, jsonText, readJson, usage } from "../fsutil.js";
import { loadConfig } from "../chronicle/config.js";
import { describePlan, notifyPulse, nowOf } from "../chronicle/docs.js";
import { today } from "../chronicle/records.js";
import { planReport } from "../reports.js";
import { measure } from "./measure.js";
import { sigmaPulse, sigmaReport } from "./report.js";

export const DIR = ".syno/sigma";

async function gatesAndOverrides(root, config) {
  try {
    const { gate, loadOverrides } = await import("./gate.js");
    const done = await gate(root, config, "done");
    const release = await gate(root, config, "release");
    return { gates: [{ name: "Done", ...done }, { name: "Release", ...release }], overrides: loadOverrides(root) };
  } catch {
    return { gates: [], overrides: [] };
  }
}

async function shaped(ctx) {
  const config = loadConfig(ctx.repo);
  const m = await measure(ctx.repo, { date: today(nowOf(ctx)), target: Number(config.sigma?.target ?? 4) });
  const extra = await gatesAndOverrides(ctx.repo, config);
  return { m, report: sigmaReport(m, { project: config.project?.name ?? readJson(join(ctx.repo, ".syno/config.json"))?.project?.name ?? "This project", ...extra }) };
}

export async function run(ctx) {
  const [sub = "status"] = ctx.args;
  if (sub === "status") {
    const { m, report } = await shaped(ctx);
    return { code: 0, text: [`${report.verdict.level.toUpperCase()}: ${report.verdict.text}`, ...report.summary.map((s) => `- ${s}`)].join("\n"), data: m };
  }
  if (sub === "measure") {
    const { m, report } = await shaped(ctx);
    const plan = new WritePlan(ctx.repo).write(`${DIR}/${m.date}.json`, jsonText(m));
    const out = planReport(plan, "sigma", report);
    const applied = plan.apply({ confirm: ctx.confirm });
    if (applied.applied) await notifyPulse(ctx.repo, "sigma.snapshot", sigmaPulse(m));
    return { code: 0, text: [`${report.verdict.level.toUpperCase()}: ${report.verdict.text}`, describePlan(plan, applied.applied), ...out.problems.map((p) => `  - wording: ${p}`)].join("\n"), data: { applied: applied.applied, measurement: m, paths: out.paths, problems: out.problems } };
  }
  throw usage("sigma takes: measure, status.");
}
