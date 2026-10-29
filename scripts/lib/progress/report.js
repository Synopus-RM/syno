// Syno Progress (PRD S-03): the progress-report skill's numbers, in Syno's
// shared report look. Overall % is the weighted average of item progress
// (done = 100, in progress = its percent, to do = 0), as in the source skill,
// so it moves smoothly instead of jumping only when items close. Pure.
import { readerDate } from "../report/render.js";

export const STATUSES = ["done", "in_progress", "blocked", "todo"];
const clamp = (n) => Math.max(0, Math.min(100, Number(n) || 0));
const weight = (it) => Number(it.weight) || 1;
const prio = (p) => ({ high: 0, medium: 1, low: 2 })[String(p || "medium").toLowerCase()] ?? 1;

export function normStatus(s) {
  const v = String(s || "todo").toLowerCase().replace(/[\s-]+/g, "_");
  if (["done", "complete", "completed", "finished", "shipped"].includes(v)) return "done";
  if (["in_progress", "wip", "doing", "started", "ongoing", "partial"].includes(v)) return "in_progress";
  if (["blocked", "on_hold", "waiting"].includes(v)) return "blocked";
  if (["cancelled", "canceled", "dropped", "wont_do"].includes(v)) return "cancelled";
  return "todo";
}

function itemPct(it) {
  if (it.status === "done") return 100;
  if (it.status === "in_progress") return clamp(it.percent ?? 50);
  if (it.status === "blocked") return clamp(it.percent ?? 0);
  return 0;
}

export function rollup(list) {
  const w = list.reduce((s, it) => s + weight(it), 0);
  const pct = w ? list.reduce((s, it) => s + itemPct(it) * weight(it), 0) / w : 0;
  return { pct: Math.round(pct), counts: Object.fromEntries(STATUSES.map((s) => [s, list.filter((it) => it.status === s).length])), total: list.length };
}

/** Everything the report shows, from report.json, facts.json and the previous snapshot. */
export function progressModel(report, facts = {}, previous = null) {
  const items = (report.items ?? []).map((it) => ({ ...it, status: normStatus(it.status) })).filter((it) => it.status !== "cancelled");
  const overall = rollup(items);
  if (report.overallPercent != null) overall.pct = Math.round(clamp(report.overallPercent));
  const order = [];
  for (const it of items) if (!order.includes(it.phase || "General")) order.push(it.phase || "General");
  const names = report.phases?.length ? report.phases.map((p) => (typeof p === "string" ? p : p.name)) : order;
  const phases = names.map((name) => ({ name, ...rollup(items.filter((it) => (it.phase || "General") === name)) })).filter((p) => p.total > 0);
  const notOnMain = items.filter((i) => i.status === "done" && ["pushed", "committed", "uncommitted"].includes(i.git?.state));
  const manual = [...(report.manual ?? [])].sort((a, b) => (b.blocking === true) - (a.blocking === true) || prio(a.priority) - prio(b.priority));
  const branches = (facts.git?.branches ?? []).filter((b) => !b.isDefault && !b.mergedIntoDefault);
  return { items, overall, phases, notOnMain, manual, branches, defaultBranch: facts.git?.defaultBranch ?? "main", delta: previous ? overall.pct - previous.pct : null, previous, risks: report.risks ?? [], targetDate: report.targetDate ?? null, headline: report.headline ?? null, sources: report.sources ?? [] };
}

const GIT = { merged: "Yes", pushed: "Not yet: waiting to be merged", committed: "Not yet: not pushed", uncommitted: "Not yet: not saved", not_started: "Not started", "n/a": "Not code", unknown: "Unknown" };
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function verdict(m, date) {
  const blockers = m.items.filter((i) => i.status === "blocked").length + m.manual.filter((a) => a.blocking).length;
  if (m.targetDate && m.targetDate < date && m.overall.pct < 100) return { level: "red", text: `The target date of ${readerDate(m.targetDate)} has passed with ${m.overall.pct}% done.` };
  if (blockers || m.notOnMain.length) return { level: "amber", text: `${m.overall.pct}% done, but ${plural(blockers + (m.notOnMain.length ? 1 : 0), "thing needs", "things need")} attention.` };
  return { level: "green", text: `${m.overall.pct}% done and on track.` };
}

function summary(m) {
  const c = m.overall.counts;
  const trend = m.delta === null ? "" : m.delta === 0 ? " That's the same as the last report." : ` That's ${Math.abs(m.delta)} points ${m.delta > 0 ? "up" : "down"} since the last report.`;
  const out = [
    `The project is ${m.overall.pct}% done.${trend}`,
    `${c.done} done, ${c.in_progress} in progress and ${c.todo} not started yet.`,
  ];
  if (c.blocked) out.push(`${plural(c.blocked, "item is", "items are")} blocked and waiting on someone.`);
  if (m.notOnMain.length) out.push(`${plural(m.notOnMain.length, "finished item hasn't", "finished items haven't")} reached the main branch yet.`);
  if (m.targetDate) out.push(`The target date is ${readerDate(m.targetDate)}.`);
  if (out.length < 3) out.push(m.manual.length ? `${plural(m.manual.length, "action needs", "actions need")} the owner.` : "Nothing is waiting on the owner.");
  return out.slice(0, 5);
}

function sections(m) {
  const byStatus = (s) => m.items.filter((i) => i.status === s);
  const out = [{ heading: "Progress by phase", intro: "Each bar shows how much of that phase is done.", bars: m.phases.map((p) => ({ label: p.name, value: p.pct, note: `${p.counts.done} of ${p.total} done`, tone: p.pct === 100 ? "good" : p.counts.blocked ? "warn" : undefined })) }];
  const add = (heading, rows, columns) => rows.length && out.push({ heading, table: { columns: columns.map((label) => ({ label, num: label === "Done" })), rows } });
  add("In progress", byStatus("in_progress").map((i) => [i.title, i.phase ?? "General", `${clamp(i.percent ?? 50)}%`, i.next ?? ""]), ["Item", "Phase", "Done", "Next step"]);
  add("Blocked", byStatus("blocked").map((i) => [i.title, i.blocker ?? "Waiting on someone"]), ["Item", "Waiting on"]);
  add("Yet to start", byStatus("todo").sort((a, b) => prio(a.priority) - prio(b.priority)).map((i) => [i.title, i.phase ?? "General", i.priority ?? "medium", i.dependsOn ?? ""]), ["Item", "Phase", "Priority", "Needs first"]);
  add("Completed", byStatus("done").map((i) => [i.title, i.phase ?? "General", GIT[i.git?.state] ?? "Not code", i.verified === false ? "Not checked yet" : "Checked"]), ["Item", "Phase", "On the main branch", "Evidence"]);
  add("Work not on the main branch", m.branches.map((b) => [b.name, b.upstream && !b.upstreamGone ? "Pushed, not merged" : "Only on this computer", `${b.aheadOfDefault ?? b.ahead ?? 0} changes ahead`]), ["Branch", "Where it is", "Size"]);
  if (m.risks.length) out.push({ heading: "Risks", list: m.risks.map((r) => `${r.text}${r.severity ? ` (${r.severity})` : ""}`) });
  if (m.sources.length) out.at(-1).note = `Based on: ${m.sources.join(", ")}.`;
  return out;
}

/** The shared-look report (PRD §5.3) for one run. */
export function progressReport(m, { project, date }) {
  return {
    title: "Project progress",
    project,
    date,
    eyebrow: "Syno Progress",
    verdict: verdict(m, date),
    summary: summary(m),
    actions: m.manual.map((a) => ({ text: a.blocking ? `${a.action} (holds up: ${a.blocks ?? "other work"})` : a.action, who: a.owner ?? "Owner" })),
    sections: sections(m),
    glossary: [
      { term: "Phase", meaning: "A stage of the project, such as Design, Build or Launch." },
      { term: "Main branch", meaning: "The copy of the code that is shipped. Work counts as delivered once it is there." },
      { term: "Blocked", meaning: "Work that can't move until someone else does something." },
      { term: "Branch", meaning: "A separate copy of the code where a piece of work is built before it joins the main branch." },
    ],
  };
}

/** What Syno Pulse sends: titles and counts only (PRD §5.4). */
export const progressPulse = (m) => ({
  overall: m.overall.pct,
  delta: m.delta,
  phases: m.phases.map((p) => ({ name: p.name, percent: p.pct })),
  counts: { done: m.overall.counts.done, inProgress: m.overall.counts.in_progress, todo: m.overall.counts.todo, blocked: m.overall.counts.blocked },
  ownerActions: m.manual.map((a) => a.action),
});
