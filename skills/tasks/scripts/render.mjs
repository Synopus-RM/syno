#!/usr/bin/env node
// Renders a structured task breakdown into:
//   BOARD.html     interactive dashboard (overview, breakdown tree, board, timeline, dependencies, owner actions, git)
//   BREAKDOWN.md   the full hierarchical work breakdown as a living checklist with IDs
//   PROGRESS.md    the at-a-glance progress report
//   model.json     the computed model (roll-ups, forecast, critical path …)
//   history.json   one snapshot per run → trend, burn-up, pace forecast
//
// Usage:
//   node render.mjs --breakdown <breakdown.json> [--facts <facts.json>] [--out-dir <dir>]
//                   [--check] [--no-history] [--plan-out <path/TASKS.md>]
//
//   --check     validate and print warnings + totals only; writes nothing
//   --plan-out  also write the breakdown checklist to a file in the project (only when the owner asks)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compute, cmpId } from "./engine.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith("--")) {
    const n = process.argv[i + 1];
    if (n === undefined || n.startsWith("--")) args[a.slice(2)] = true;
    else { args[a.slice(2)] = n; i++; }
  }
}
const bdPath = args.breakdown || args.report;
if (!bdPath) {
  console.error("Usage: node render.mjs --breakdown breakdown.json [--facts facts.json] [--out-dir dir] [--check] [--plan-out file]");
  process.exit(1);
}

let breakdown;
try { breakdown = JSON.parse(fs.readFileSync(bdPath, "utf8")); }
catch (e) { console.error(`Could not read ${bdPath}: ${e.message}`); process.exit(1); }
const facts = args.facts && fs.existsSync(args.facts) ? JSON.parse(fs.readFileSync(args.facts, "utf8")) : {};
const outDir = path.resolve(args["out-dir"] || path.dirname(path.resolve(bdPath)));
const histFile = path.join(outDir, "history.json");
let history = [];
try { history = JSON.parse(fs.readFileSync(histFile, "utf8")); } catch {}

const model = compute(breakdown, facts, history);
const prev = history.filter((h) => h.date?.slice(0, 16) !== model.snapshot.date.slice(0, 16)).at(-1) || null;
model.delta = prev ? model.totals.pct - prev.percent : null;
model.prevDate = prev?.date || null;
const U = model.totals.unit;

if (args.check) {
  printSummary(true);
  process.exit(model.warnings.some((w) => w.level === "error") ? 2 : 0);
}

fs.mkdirSync(outDir, { recursive: true });

// ---------- History ----------
if (!args["no-history"]) {
  const last = history.at(-1);
  if (last && last.date?.slice(0, 16) === model.snapshot.date.slice(0, 16)) history[history.length - 1] = model.snapshot;
  else history.push(model.snapshot);
  history = history.slice(-300);
  fs.writeFileSync(histFile, JSON.stringify(history, null, 2));
}
model.history = history.length ? history : [model.snapshot];

// ---------- Helpers ----------
const byId = new Map(model.nodes.map((n) => [n.id, n]));
const fmtU = (v) => `${Math.round(v * 10) / 10}${U === "pts" ? " pts" : U}`;
const bar = (pct, w = 24) => { const f = Math.round((Math.max(0, Math.min(100, pct)) / 100) * w); return "█".repeat(f) + "░".repeat(w - f); };
const mdEsc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
const date = (d) => {
  if (!d) return "—";
  const t = new Date(/^\d{4}-\d{2}-\d{2}$/.test(d) ? d + "T00:00:00" : d);
  return isNaN(t) ? d : t.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};
const mark = { done: "x", in_progress: "~", blocked: "!", todo: " ", cancelled: "-" };
const GIT = { merged: `merged to ${model.git.defaultBranch || "main"}`, pushed: "pushed, not merged", committed: "committed, not pushed", uncommitted: "uncommitted", not_started: "no code yet", unknown: "unverified" };
const STATUS_TEXT = { done: "Done", in_progress: "In progress", blocked: "Blocked", todo: "To do", cancelled: "Cancelled" };
const FORECAST_TEXT = { on_track: "On track", at_risk: "At risk", late: "Late", no_target: "No target date set", complete: "Complete", empty: "No tasks yet" };
const mdTable = (h, rows) => (rows.length ? `| ${h.join(" | ")} |\n|${h.map(() => "---").join("|")}|\n${rows.map((r) => `| ${r.map(mdEsc).join(" | ")} |`).join("\n")}\n` : "_None._\n");

// ---------- BREAKDOWN.md ----------
function taskLine(n, indent) {
  const pad = "  ".repeat(indent);
  const bits = [];
  if (n.owner) bits.push(`@${n.owner}`);
  if (n.leaf) bits.push(`${fmtU(n.est)}${n.estimated === false ? " (assumed)" : ""}`);
  if (n.status === "in_progress" || (n.status === "blocked" && n.pct)) bits.push(`${n.pct}%`);
  if (n.priority) bits.push(`${n.priority} priority`);
  if (n.due) bits.push(`due ${n.due}${n.overdue ? " ⚠ overdue" : ""}`);
  else if (n.fEnd && n.status !== "done") bits.push(`forecast ${n.fEnd}`);
  if (n.critical && n.status !== "done") bits.push("critical path");
  if (n.dependsOn.length) bits.push(`after ${n.dependsOn.join(", ")}`);
  if (n.git?.state && GIT[n.git.state]) bits.push(`${GIT[n.git.state]}${n.git.branch ? ` (${n.git.branch})` : ""}`);
  let s = `${pad}- [${mark[n.status]}] **${n.id}** ${n.title}${bits.length ? ` — ${bits.join(", ")}` : ""}\n`;
  if (n.status === "blocked" && n.blocker) s += `${pad}  - ⛔ Blocked by: ${n.blocker}\n`;
  if (n.next && n.status !== "done") s += `${pad}  - Next: ${n.next}\n`;
  if (n.evidence && n.status === "done") s += `${pad}  - Evidence: ${n.evidence}${n.verified === false ? " (unverified)" : ""}\n`;
  for (const a of n.acceptance || []) s += `${pad}  - ${a.done ? "✓" : "○"} ${a.text}\n`;
  for (const c of n.children) s += taskLine(byId.get(c), indent + 1);
  return s;
}
function breakdownMd() {
  let s = `# ${model.project.name} — Task breakdown\n\n`;
  s += `As of ${date(model.asOf)}. Overall **${model.totals.pct}%** \`${bar(model.totals.pct)}\` — ${model.totals.leafCount} tasks, ${fmtU(model.totals.estimate)} estimated, ${fmtU(model.totals.remaining)} remaining.\n\n`;
  s += `Legend: \`[x]\` done, \`[~]\` in progress, \`[!]\` blocked, \`[ ]\` to do, \`[-]\` cancelled. IDs are stable — reference them in commits, PRs and \`dependsOn\`.\n\n`;
  for (const id of model.rootIds) {
    const p = byId.get(id);
    s += `## ${p.id} · ${p.title} — ${p.pct}%\n\n\`${bar(p.pct, 20)}\` ${p.counts.done}/${p.leafCount} tasks done${p.due ? `, due ${p.due}` : ""}${p.fEnd && p.status !== "done" ? `, forecast ${p.fEnd}` : ""}\n\n`;
    if (p.description) s += `${p.description}\n\n`;
    for (const c of p.children) {
      const e = byId.get(c);
      if (e.leaf) { s += taskLine(e, 0); continue; }
      s += `${s.endsWith("\n\n") ? "" : "\n"}### ${e.id} · ${e.title} — ${e.pct}%${e.owner ? ` (@${e.owner})` : ""}\n\n`;
      if (e.description) s += `${e.description}\n\n`;
      for (const t of e.children) s += taskLine(byId.get(t), 0);
      s += "\n";
    }
    s += "\n";
  }
  return s;
}

// ---------- PROGRESS.md ----------
function progressMd() {
  const t = model.totals, f = model.forecast;
  const lines = [];
  lines.push(`# ${model.project.name} — Progress report`, "");
  lines.push(`As of ${date(model.asOf)}${model.git.isRepo ? `, branch \`${model.git.currentBranch}\`` : ""}${model.delta != null ? `, ${model.delta >= 0 ? "▲" : "▼"} ${Math.abs(model.delta)} pts since ${date(model.prevDate)}` : ""}.`, "");
  if (model.headline) lines.push(`> ${model.headline}`, "");
  lines.push(`**Overall ${t.pct}%** \`${bar(t.pct, 30)}\``, "");
  lines.push(`✅ ${t.counts.done} done · 🔄 ${t.counts.in_progress} in progress · ⛔ ${t.counts.blocked} blocked · ⏳ ${t.counts.todo} to do · ✋ ${model.manual.length} owner actions${model.git.isRepo ? ` · 🌿 ${model.git.unmerged.length} unmerged branches` : ""}`, "");
  lines.push(`**Health:** ${model.health.toUpperCase()}${model.healthReasons.length ? ` — ${model.healthReasons.join("; ")}` : ""}`, "");
  lines.push(`**Forecast:** ${FORECAST_TEXT[f.status]}${f.planFinish ? ` — plan finishes ${date(f.planFinish)}` : ""}${f.target ? `, target ${date(f.target)}` : ""}${f.slackDays != null ? ` (${f.slackDays >= 0 ? `${f.slackDays} working days spare` : `${-f.slackDays} working days late`})` : ""}${f.paceFinish ? `; at current pace ${date(f.paceFinish)}` : ""}.`, "");
  if (model.phases.length > 1) {
    lines.push("## Phases", "");
    lines.push(mdTable(["Phase", "Progress", "%", "Tasks done", "Due", "Forecast", "Health"], model.phases.map((p) => [`${p.id} ${p.title}`, bar(p.pct, 16), `${p.pct}%`, `${p.counts.done}/${p.leafCount}`, p.due || "—", p.status === "done" ? "done" : p.fEnd || "—", p.health])));
  }
  lines.push("## ✋ Needs the process owner", "");
  lines.push(mdTable(["Priority", "Action", "Why", "How", "Blocks"], model.manual.map((m) => [m.priority || "medium", m.action, m.why || "", m.how || "—", m.blocking ? `Yes${m.blocks ? ` — ${m.blocks}` : ""}` : "No"])));
  lines.push("## ▶ Up next (ready to start)", "");
  lines.push(mdTable(["ID", "Task", "Owner", "Estimate", "Priority", "Why now"], model.ready.slice(0, 12).map((id) => { const n = byId.get(id); return [n.id, n.title, n.owner || "—", fmtU(n.est), n.priority || "medium", n.critical ? "On critical path" : n.unblocks.length ? `Unblocks ${n.unblocks.length}` : "Dependencies met"]; })));
  const active = model.nodes.filter((n) => n.leaf && ["in_progress", "blocked"].includes(n.status)).sort((a, b) => (a.status === "blocked" ? -1 : 1) - (b.status === "blocked" ? -1 : 1) || b.pct - a.pct);
  lines.push("## 🔄 In progress & blocked", "");
  lines.push(mdTable(["ID", "Task", "%", "Owner", "Next step / blocker", "Forecast", "Git"], active.map((n) => [n.id, `${n.status === "blocked" ? "⛔ " : ""}${n.title}`, `${n.pct}%`, n.owner || "—", n.status === "blocked" ? n.blocker || "—" : n.next || "—", n.fEnd || "—", n.git?.state ? GIT[n.git.state] || n.git.state : "—"])));
  if (model.overdue.length || model.dueSoon.length) {
    lines.push("## ⏰ Dates", "");
    lines.push(mdTable(["ID", "Task", "Due", "State"], [...model.overdue, ...model.dueSoon].map((id) => { const n = byId.get(id); return [n.id, n.title, n.due, n.overdue ? "Overdue" : `Due in ${n.dueIn} working day(s)`]; })));
  }
  if (model.criticalPath.length) {
    lines.push("## Critical path", "");
    lines.push(model.criticalPath.map((id) => `\`${id}\` ${byId.get(id).title}`).join(" → "), "");
  }
  const done = model.nodes.filter((n) => n.leaf && n.status === "done");
  lines.push("## ✅ Completed", "");
  if (model.git.doneNotShipped?.length) lines.push(`⚠ ${model.git.doneNotShipped.length} completed task(s) are not on \`${model.git.defaultBranch}\` yet — not shipped until merged.`, "");
  lines.push(mdTable(["ID", "Task", "Evidence", "Git"], done.map((n) => [n.id, n.title + (n.verified === false ? " (unverified)" : ""), n.evidence || "—", n.git?.state ? GIT[n.git.state] || n.git.state : "—"])));
  if (model.owners.length) {
    lines.push("## People", "");
    lines.push(mdTable(["Owner", "Open", "In progress", "Blocked", "Remaining", "Clear by"], model.owners.map((o) => [o.name, o.open, o.inProgress, o.blocked, fmtU(o.remaining), o.finish || "—"])));
  }
  if (model.git.isRepo) {
    const g = model.git;
    lines.push("## 🌿 Git", "");
    lines.push(`- Working tree: ${g.working?.clean ? "clean" : "**uncommitted changes**"}`, `- Unmerged branches: ${g.unmerged.length ? g.unmerged.map((b) => `\`${b}\``).join(", ") : "none"}`, `- Unpushed: ${g.unpushed.length ? g.unpushed.map((b) => `\`${b}\``).join(", ") : "none"}`, "");
  }
  if (model.risks.length) {
    lines.push("## Risks", "");
    for (const r of model.risks) lines.push(`- ${typeof r === "string" ? r : `**${r.severity || "medium"}** ${r.text}${r.mitigation ? ` — mitigation: ${r.mitigation}` : ""}`}`);
    lines.push("");
  }
  lines.push("---", "Designed & Developed by [Synopus](https://www.synopus.in)", "");
  return lines.join("\n");
}

// ---------- HTML ----------
const template = fs.readFileSync(path.join(here, "..", "assets", "board.html"), "utf8");
const payload = JSON.stringify(model).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
const safeTitle = String(model.project.name).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const html = template.replace("__TITLE__", safeTitle).replace("/*__BOARD_DATA__*/null", () => payload);

// ---------- Write ----------
const out = {
  html: path.join(outDir, "BOARD.html"),
  breakdown: path.join(outDir, "BREAKDOWN.md"),
  progress: path.join(outDir, "PROGRESS.md"),
  model: path.join(outDir, "model.json"),
};
fs.writeFileSync(out.html, html);
fs.writeFileSync(out.breakdown, breakdownMd());
fs.writeFileSync(out.progress, progressMd());
const { history: _h, ...modelNoHist } = model;
fs.writeFileSync(out.model, JSON.stringify(modelNoHist, null, 2));
if (args["plan-out"] && args["plan-out"] !== true) {
  const p = path.resolve(args["plan-out"]);
  fs.writeFileSync(p, breakdownMd());
  out.plan = p;
}
printSummary(false);

function printSummary(checkOnly) {
  const t = model.totals, f = model.forecast;
  const result = {
    mode: checkOnly ? "check" : "rendered",
    files: checkOnly ? undefined : out,
    overallPercent: t.pct, delta: model.delta, counts: t.counts, tasks: t.leafCount,
    estimate: `${t.estimate}${U}`, remaining: `${t.remaining}${U}`,
    health: model.health, forecast: { status: f.status, planFinish: f.planFinish, paceFinish: f.paceFinish, target: f.target, slackDays: f.slackDays },
    readyNow: model.ready.slice(0, 8), criticalPath: model.criticalPath, overdue: model.overdue,
    manualOpen: model.manual.length, unmergedBranches: model.git.unmerged?.length ?? null, doneNotShipped: model.git.doneNotShipped,
    warnings: model.warnings.sort((a, b) => ({ error: 0, warn: 1, info: 2 }[a.level] - { error: 0, warn: 1, info: 2 }[b.level]) || cmpId(a.id || "", b.id || "")),
  };
  console.log(JSON.stringify(result, null, 2));
}
