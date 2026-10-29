// Syno Tasks (PRD S-04): the task-breakdown engine's model in Syno's shared
// report look. The engine (skills/tasks/scripts/engine.mjs) does the maths:
// roll-ups, forecast, critical path, ready queue, health. This only shapes it
// for readers. Pure.
import { readerDate } from "../report/render.js";

const LEVEL = { green: "green", amber: "amber", red: "red", done: "green", empty: "amber" };
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const leaves = (model) => model.nodes.filter((n) => n.leaf && n.status !== "cancelled");

function verdict(model) {
  const pct = model.totals.pct;
  const text = {
    done: "Every task is done.",
    empty: "There are no tasks in the breakdown yet.",
    green: `${pct}% done and on track${model.project.targetDate ? ` for ${readerDate(model.project.targetDate)}` : ""}.`,
    amber: `${pct}% done, but ${model.healthReasons[0]?.toLowerCase() ?? "something needs attention"}.`,
    red: `${pct}% done, and ${model.healthReasons[0]?.toLowerCase() ?? "the plan is at risk"}.`,
  }[model.health];
  return { level: LEVEL[model.health] ?? "amber", text };
}

function summary(model) {
  const c = leaves(model).reduce((a, l) => ({ ...a, [l.status]: (a[l.status] ?? 0) + 1 }), {});
  const f = model.forecast;
  const out = [
    `The work is ${model.totals.pct}% done: ${c.done ?? 0} done, ${c.in_progress ?? 0} in progress, ${c.blocked ?? 0} blocked and ${c.todo ?? 0} to do.`,
    f.planFinish ? `At this plan, the work finishes on ${readerDate(f.planFinish)}.` : "There isn't enough in the plan to forecast a finish date yet.",
  ];
  if (model.project.targetDate) out.push(`The target date is ${readerDate(model.project.targetDate)}.`);
  if (model.overdue.length) out.push(`${plural(model.overdue.length, "task is", "tasks are")} past its due date.`);
  if (model.ready.length) out.push(`${plural(model.ready.length, "task is", "tasks are")} ready to start now.`);
  return out.slice(0, 5);
}

const title = (model, id) => model.nodes.find((n) => n.id === id)?.title ?? id;

function sections(model) {
  const tasks = leaves(model);
  const table = (heading, rows, labels) => rows.length && { heading, table: { columns: labels.map((label) => ({ label, num: label === "Done" || label === "Left" })), rows } };
  return [
    { heading: "Progress by phase", intro: "Each bar shows how much of that phase is done.", bars: model.phases.map((p) => ({ label: p.title ?? p.id, value: p.pct, tone: p.pct === 100 ? "good" : (p.counts?.blocked ?? 0) ? "warn" : undefined })) },
    table("Up next", model.ready.slice(0, 10).map((id) => { const n = model.nodes.find((x) => x.id === id); return [id, n.title, n.owner ?? "Not assigned", n.critical ? "Yes" : "No"]; }), ["ID", "Task", "Owner", "On the critical path"]),
    table("In progress", tasks.filter((t) => t.status === "in_progress").map((t) => [t.id, t.title, `${t.pct}%`, t.next ?? ""]), ["ID", "Task", "Done", "Next step"]),
    table("Blocked", tasks.filter((t) => t.status === "blocked").map((t) => [t.id, t.title, t.blocker ?? "Waiting on someone"]), ["ID", "Task", "Waiting on"]),
    table("Past due", model.overdue.map((id) => { const n = model.nodes.find((x) => x.id === id); return [id, n.title, n.due ? readerDate(n.due) : ""]; }), ["ID", "Task", "Was due"]),
    model.criticalPath?.length && { heading: "Critical path", intro: "These tasks have no slack: a delay in any of them moves the finish date.", list: model.criticalPath.map((id) => `${id} ${title(model, id)}`) },
    table("Who is doing what", model.owners.map((o) => [o.name, String(o.open), String(o.remaining), o.finish ? readerDate(o.finish) : ""]), ["Person", "Open tasks", "Left", "Free from"]),
    model.risks?.length && { heading: "Risks", list: model.risks.map((r) => (typeof r === "string" ? r : `${r.text}${r.severity ? ` (${r.severity})` : ""}`)) },
  ].filter(Boolean);
}

/** The shared-look report (PRD §5.3). */
export function tasksReport(model, { project, date }) {
  return {
    title: "Task breakdown",
    project: project ?? model.project.name,
    date,
    eyebrow: "Syno Tasks",
    verdict: verdict(model),
    summary: summary(model),
    actions: model.manual.map((m) => ({ text: m.blocking ? `${m.action} (holds up: ${m.blocks ?? [].concat(m.relatesTo).join(", ")})` : m.action, who: m.owner ?? "Owner" })),
    sections: sections(model),
    glossary: [
      { term: "Phase", meaning: "A stage of the project, such as Build or Launch." },
      { term: "Critical path", meaning: "The chain of tasks with no spare time: if one is late, the whole project is late." },
      { term: "Acceptance criteria", meaning: "The checks that say a task is really finished." },
      { term: "Blocked", meaning: "A task that can't move until someone else does something." },
      { term: "Merge", meaning: "Joining finished work into the main copy of the code, after a review." },
    ],
  };
}

/** What Syno Pulse sends: titles and counts only (PRD §5.4). */
export function tasksPulse(model) {
  const tasks = leaves(model);
  const count = (s) => tasks.filter((t) => t.status === s).length;
  return {
    percent: model.totals.pct,
    counts: { done: count("done"), inProgress: count("in_progress"), blocked: count("blocked"), todo: count("todo") },
    criticalPathDays: model.forecast?.criticalDays ?? null,
    forecast: model.forecast?.planFinish ?? null,
    target: model.project.targetDate ?? null,
    overdue: model.overdue.map((id) => title(model, id)),
    blocked: tasks.filter((t) => t.status === "blocked").map((t) => t.title),
    ready: model.ready.length,
  };
}
