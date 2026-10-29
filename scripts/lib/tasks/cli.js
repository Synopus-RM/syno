// Syno Tasks' commands (PRD S-04). The breakdown in .syno/tasks/breakdown.json
// is the source of truth (committed). The skill writes and updates it; these
// commands enforce Syno's rules on top of the engine:
//   syno tasks check                  engine warnings, plus: no task starts without an acceptance criterion
//   syno tasks set <id> <status> [--percent N] [--next T] [--blocker T] [--confirm]
//   syno tasks tick <id> <criterion number | all> [--failed] [--confirm]   --failed: it failed its first check (a defect for Syno Sigma)
//   syno tasks status | report [--confirm]
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { WritePlan, jsonText, readJson, refusal, usage } from "../fsutil.js";
import { describePlan, notifyPulse, nowOf } from "../chronicle/docs.js";
import { today } from "../chronicle/records.js";
import { planReport } from "../reports.js";
import { tasksPulse, tasksReport } from "./report.js";

export const BREAKDOWN = ".syno/tasks/breakdown.json";
const ENGINE = fileURLToPath(new URL("../../../skills/tasks/scripts/engine.mjs", import.meta.url));
const STATUSES = ["todo", "in_progress", "blocked", "done", "cancelled"];

export const loadBreakdown = (root) => readJson(join(root, BREAKDOWN));

/** The engine's model for a breakdown (facts and history are optional). */
export async function modelFor(root, breakdown = loadBreakdown(root)) {
  const { compute } = await import(pathToFileURL(ENGINE).href);
  return compute(breakdown, readJson(join(root, ".syno/local/tasks/facts.json"), {}), readJson(join(root, ".syno/reports/tasks/history.json"), []));
}

/** Walks the tree; returns the node with `id`, or null. */
function findNode(nodes, id) {
  for (const n of nodes ?? []) {
    if (n.id === id) return n;
    const hit = findNode(n.children, id);
    if (hit) return hit;
  }
  return null;
}

const acceptanceOf = (task) => (task.acceptance ?? []).map((a) => (typeof a === "string" ? { text: a, done: false } : { ...a, text: a.text, done: Boolean(a.done) }));

/** Syno's rule (AC-TA.1): an in-progress task must say how we'll know it's done. */
export function synoWarnings(breakdown) {
  const out = [];
  const walk = (nodes) => {
    for (const n of nodes ?? []) {
      if (n.children?.length) walk(n.children);
      else if (["in_progress", "done"].includes(String(n.status)) && !acceptanceOf(n).length) out.push(`${n.id} ${n.title}: no acceptance criterion. Add at least one before it starts.`);
    }
  };
  walk(breakdown.tree);
  return out;
}

/** The done gate (PRD §4.3) is Syno Sigma's: acceptance, tests and test guides (AC-TE.1), audit and security. */
async function doneGate(root, task) {
  const { gate } = await import("../sigma/gate.js");
  return gate(root, readJson(join(root, ".syno/config.json"), {}), "done", { task });
}

async function save(ctx, breakdown, intro, events = []) {
  const plan = new WritePlan(ctx.repo).write(BREAKDOWN, jsonText(breakdown));
  const applied = plan.apply({ confirm: ctx.confirm });
  if (applied.applied) {
    const model = await modelFor(ctx.repo, breakdown);
    await notifyPulse(ctx.repo, "tasks.snapshot", tasksPulse(model));
    for (const e of events) await notifyPulse(ctx.repo, e.type, e.data);
  }
  return { code: 0, text: [...intro, describePlan(plan, applied.applied)].join("\n"), data: { applied: applied.applied } };
}

async function setStatus(ctx, breakdown, [id, raw]) {
  const status = String(raw ?? "").toLowerCase().replace(/[\s-]+/g, "_");
  if (!STATUSES.includes(status)) throw usage(`Status is one of: ${STATUSES.join(", ")}.`);
  const task = findNode(breakdown.tree, id);
  if (!task || task.children?.length) throw usage(`${id} isn't a task in the breakdown.`);
  if (status === "in_progress" && !acceptanceOf(task).length) throw refusal(`${id} has no acceptance criterion. Add at least one (how will we know it's done?) before it starts.`);
  if (status === "done") {
    const gate = await doneGate(ctx.repo, task);
    if (gate.status === "fail") return { code: 1, text: [`${id} stays In progress. The done gate didn't pass:`, ...gate.reasons.map((r) => `  - ${r}`), "Fix these first, or record an override with a reason (/syno:sigma)."].join("\n"), data: { gate } };
    if (gate.overridden.length) task.overrides = [...new Set([...(task.overrides ?? []), ...gate.overridden])];
  }
  const reopened = task.status === "done" && status !== "done";
  Object.assign(task, { status, ...(reopened ? { reopenedCount: (task.reopenedCount ?? 0) + 1, firstPass: false } : {}), ...(status === "done" ? { completed: today(nowOf(ctx)), firstPass: task.firstPass ?? (task.reopenedCount ?? 0) === 0 } : {}) });
  for (const key of ["percent", "next", "blocker"]) if (ctx.flags[key] !== undefined) task[key] = key === "percent" ? Number(ctx.flags[key]) : ctx.flags[key];
  const intro = [`${id} ${task.title}: ${status.replace("_", " ")}${reopened ? " (reopened, which counts as a defect for Syno Sigma)" : ""}.`, ""];
  return save(ctx, breakdown, intro);
}

async function tick(ctx, breakdown, [id, which]) {
  const task = findNode(breakdown.tree, id);
  if (!task) throw usage(`${id} isn't in the breakdown.`);
  const list = acceptanceOf(task);
  const picks = which === "all" ? list.map((_, i) => i) : [Number(which) - 1];
  if (picks.some((i) => !(i >= 0 && i < list.length))) throw usage(`${id} has ${list.length} acceptance criteria; pick a number from 1 to ${list.length}, or all.`);
  const names = picks.map((i) => `"${list[i].text}"`).join(", ");
  if (ctx.flags.failed === true) {
    // Only a criterion's first check counts: a later failure is the same defect.
    task.acceptance = list.map((a, i) => (picks.includes(i) && !a.done && !a.failedFirst ? { ...a, failedFirst: true, failedOn: today(nowOf(ctx)) } : a));
    return save(ctx, breakdown, [`${id}: ${names} didn't pass ${picks.length === 1 ? "its" : "their"} first check (counted as a defect for Syno Sigma).`, ""]);
  }
  task.acceptance = list.map((a, i) => (picks.includes(i) ? { ...a, done: true } : a));
  return save(ctx, breakdown, [`${id}: ${names} met.`, ""]);
}

async function report(ctx, sub) {
  const model = await modelFor(ctx.repo);
  const shaped = tasksReport(model, { project: readJson(join(ctx.repo, ".syno/config.json"))?.project?.name, date: today(nowOf(ctx)) });
  const head = `${shaped.verdict.level.toUpperCase()}: ${shaped.verdict.text}`;
  if (sub === "status") return { code: 0, text: [head, ...shaped.summary.map((s) => `- ${s}`)].join("\n"), data: tasksPulse(model) };
  const plan = new WritePlan(ctx.repo);
  const out = planReport(plan, "tasks", shaped);
  const applied = plan.apply({ confirm: ctx.confirm });
  if (applied.applied) await notifyPulse(ctx.repo, "tasks.snapshot", tasksPulse(model));
  return { code: 0, text: [head, describePlan(plan, applied.applied), ...out.problems.map((p) => `  - wording: ${p}`)].join("\n"), data: { applied: applied.applied, paths: out.paths, problems: out.problems } };
}

export async function run(ctx) {
  const [sub = "status", ...rest] = ctx.args;
  const breakdown = loadBreakdown(ctx.repo);
  if (!breakdown?.tree) throw usage(`No breakdown at ${BREAKDOWN}. Follow the tasks skill (/syno:tasks) to build one.`);
  if (sub === "check") {
    const model = await modelFor(ctx.repo, breakdown);
    const warnings = [...synoWarnings(breakdown), ...(model.warnings ?? []).map((w) => (typeof w === "string" ? w : w.text ?? JSON.stringify(w)))];
    return { code: synoWarnings(breakdown).length ? 1 : 0, text: warnings.length ? warnings.map((w) => `- ${w}`).join("\n") : "The breakdown is consistent.", data: { warnings } };
  }
  if (sub === "set") return setStatus(ctx, breakdown, rest);
  if (sub === "tick") return tick(ctx, breakdown, rest);
  if (sub === "status" || sub === "report") return report(ctx, sub);
  throw usage("tasks takes: check, set, tick, status, report.");
}
