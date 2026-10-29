// Syno Sigma's commands (PRD S-13). Measuring is a write: the numbers are saved
// in .syno/sigma/<date>.json (committed, so trends survive across machines) and
// the report under .syno/reports/sigma/.
//   syno sigma measure [--confirm]
//   syno sigma status
//   syno sigma gate (--task <id> | --release)
//   syno sigma override --gate done|release [--task <id>] --items <id,id> --reason "..." [--confirm]
import { join } from "node:path";
import { WritePlan, jsonText, readJson, usage } from "../fsutil.js";
import { userName } from "../git.js";
import { loadConfig } from "../chronicle/config.js";
import { describePlan, notifyPulse, nowOf } from "../chronicle/docs.js";
import { stamp, today } from "../chronicle/records.js";
import { planReport } from "../reports.js";
import { OVERRIDES, loadOverrides, gate as runGate } from "./gate.js";
import { measure } from "./measure.js";
import { sigmaPulse, sigmaReport } from "./report.js";

export const DIR = ".syno/sigma";

async function gatesAndOverrides(root, config) {
  const done = await runGate(root, config, "done");
  const release = await runGate(root, config, "release");
  return { gates: [{ name: "Done", ...done }, { name: "Release", ...release }], overrides: loadOverrides(root) };
}

async function shaped(ctx) {
  const config = loadConfig(ctx.repo) ?? {};
  const m = await measure(ctx.repo, { date: today(nowOf(ctx)), target: Number(config.sigma?.target ?? 4) });
  const extra = await gatesAndOverrides(ctx.repo, config);
  return { m, report: sigmaReport(m, { project: config.project?.name ?? readJson(join(ctx.repo, ".syno/config.json"))?.project?.name ?? "This project", ...extra }) };
}

const findTask = (nodes, id) => (nodes ?? []).reduce((hit, n) => hit ?? (n.id === id ? n : findTask(n.children, id)), null);

async function gateCmd(ctx) {
  const kind = ctx.flags.release === true ? "release" : "done";
  let task = null;
  if (kind === "done") {
    if (typeof ctx.flags.task !== "string") throw usage("Pass --task <id> for the done gate, or --release for the release gate.");
    task = findTask(readJson(join(ctx.repo, ".syno/tasks/breakdown.json"))?.tree, ctx.flags.task);
    if (!task) throw usage(`${ctx.flags.task} isn't a task in the breakdown.`);
  }
  const g = await runGate(ctx.repo, loadConfig(ctx.repo) ?? {}, kind, { task });
  return { code: g.status === "fail" ? 1 : 0, text: [g.text, ...g.items.map((i) => `  - ${i.text} [${i.id}]`)].join("\n"), data: g };
}

/** Records an override (PRD §4.3): who, when, which gate, which items and why. */
async function override(ctx) {
  const reason = typeof ctx.flags.reason === "string" ? ctx.flags.reason.trim() : "";
  if (reason.length < 10) throw usage('Say why the gate is overridden, in at least 10 characters, with --reason "...".');
  const kind = ctx.flags.gate;
  if (kind !== "done" && kind !== "release") throw usage("--gate takes done or release.");
  const task = typeof ctx.flags.task === "string" ? ctx.flags.task : null;
  if (kind === "done" && !task) throw usage("A done-gate override names its task with --task <id>.");
  const items = typeof ctx.flags.items === "string" ? ctx.flags.items.split(",").map((s) => s.trim()).filter(Boolean) : [];
  if (!items.length) throw usage("Name the items to let through with --items <id,id> (syno sigma gate shows them).");
  const now = nowOf(ctx);
  const record = { schemaVersion: 1, id: stamp(now), at: now.toISOString(), who: userName(ctx.repo) ?? "unknown", gate: kind, task, items, reason };
  const plan = new WritePlan(ctx.repo).write(`${OVERRIDES}/${record.id}.json`, jsonText(record));
  const applied = plan.apply({ confirm: ctx.confirm });
  if (applied.applied) await notifyPulse(ctx.repo, "gate.override", { gate: kind, task, items: items.length, reason });
  const intro = `Override the ${kind} gate${task ? ` for ${task}` : ""} on ${items.length} item(s): ${reason}`;
  return { code: 0, text: [intro, describePlan(plan, applied.applied)].join("\n"), data: { applied: applied.applied, override: record } };
}

export async function run(ctx) {
  const [sub = "status"] = ctx.args;
  if (sub === "gate") return gateCmd(ctx);
  if (sub === "override") return override(ctx);
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
  throw usage("sigma takes: measure, status, gate, override.");
}
