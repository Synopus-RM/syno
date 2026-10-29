// Syno 5S's commands (PRD S-14). Works on the project folder only; every move
// or removal goes to the restorable trash, and only after the owner's yes.
//   syno 5s sort [--items <id,id>] [--confirm]     without --items: the picked findings
//   syno 5s set [--confirm]                        moves the standards ask for, with import changes
//   syno 5s trash                                  the trash folders, newest first
//   syno 5s restore <id> [--confirm]
//   syno 5s shine [--confirm]                      --confirm runs the project's own checks through the Governor
//   syno 5s standardize [--confirm]                proposes .syno/5s/standards.json, or checks against it
//   syno 5s [sustain] [--confirm]                  scores every S and saves the check
import { join } from "node:path";
import { WritePlan, jsonText, readJson, usage } from "../fsutil.js";
import { describePlan, notifyPulse, nowOf } from "../chronicle/docs.js";
import { stamp, today } from "../chronicle/records.js";
import { loadConfig } from "../chronicle/config.js";
import { planReport } from "../reports.js";
import { runApproved } from "../run.js";
import { projectFiles, sortFindings } from "./scan.js";
import { DIR, fivesPulse, fivesReport, history, scores } from "./score.js";
import { STANDARDS, globRe, loadStandards, proposeMoves } from "./set.js";
import { SHINE, errorCount, shineCommands } from "./shine.js";
import { checkStandards, proposeStandards } from "./standards.js";
import { freeId, planRestore, planTrash, trashList } from "./trash.js";

const picked = (ctx, findings) => {
  const ids = typeof ctx.flags.items === "string" ? new Set(ctx.flags.items.split(",").map((s) => s.trim())) : null;
  return findings.filter((f) => !f.listOnly && (ids ? ids.has(f.id) : f.pick));
};

function sort(ctx) {
  const now = nowOf(ctx);
  const { files, findings } = sortFindings(ctx.repo, now);
  const chosen = picked(ctx, findings);
  const plan = new WritePlan(ctx.repo);
  const id = freeId(ctx.repo, stamp(now));
  if (chosen.length) planTrash(plan, ctx.repo, id, { reason: "5S Sort", at: now.toISOString() }, chosen.map((f) => ({ kind: f.kind === "empty" ? "dir" : "file", path: f.path })));
  const lines = [
    findings.length ? `Sort looked at ${files} files and found ${findings.length} things to consider:` : `Sort looked at ${files} files. Everything here looks needed.`,
    ...findings.map((f) => `  ${f.listOnly ? "-  " : chosen.includes(f) ? "[x]" : "[ ]"} ${f.path}: ${f.why} [${f.id}]`),
    ...(findings.some((f) => f.listOnly) ? ["Branches are listed only. Syno never deletes a branch."] : []),
    ...(chosen.length ? [`The ${chosen.length} ticked item(s) go to .syno/trash/${id}/, and /syno:5s restore ${id} puts them back.`] : []),
  ];
  const applied = plan.apply({ confirm: ctx.confirm });
  return { code: 0, text: [...lines, describePlan(plan, applied.applied)].join("\n"), data: { applied: applied.applied, trashId: chosen.length ? id : null, findings } };
}

function setInOrder(ctx) {
  const standards = loadStandards(ctx.repo);
  if (!standards) return { code: 0, text: `There are no standards yet (${STANDARDS}). Run /syno:5s standardize first.`, data: { moves: [], edits: [] } };
  const now = nowOf(ctx);
  const { moves, edits } = proposeMoves(ctx.repo, projectFiles(ctx.repo), standards);
  const plan = new WritePlan(ctx.repo);
  const id = freeId(ctx.repo, stamp(now));
  const items = [...moves.map((m) => ({ kind: "move", path: m.from, to: m.to, content: m.content })), ...edits.map((e) => ({ kind: "edit", path: e.path, content: e.content }))];
  if (items.length) planTrash(plan, ctx.repo, id, { reason: "5S Set in Order", at: now.toISOString() }, items);
  const lines = moves.length
    ? [`${moves.length} file(s) are not where the standards say:`, ...moves.flatMap((m) => [`  - move ${m.from} → ${m.to} (${m.why})`, ...m.changes.map((c) => `      its own import ${c}`)]), ...(edits.length ? ["Import changes these moves need:", ...edits.flatMap((e) => e.changes.map((c) => `  - ${e.path}: ${c}`))] : []), `The old copies go to .syno/trash/${id}/, and /syno:5s restore ${id} undoes it.`]
    : ["Every file is where the standards say."];
  const applied = plan.apply({ confirm: ctx.confirm });
  return { code: 0, text: [...lines, describePlan(plan, applied.applied)].join("\n"), data: { applied: applied.applied, trashId: moves.length ? id : null, moves, edits } };
}

function restore(ctx, [id]) {
  if (!id) throw usage('Name the trash folder: syno 5s restore <id>. "syno 5s trash" lists them.');
  const now = nowOf(ctx);
  const plan = new WritePlan(ctx.repo);
  const r = planRestore(plan, ctx.repo, id, { at: now.toISOString(), newId: freeId(ctx.repo, stamp(now)) });
  const applied = plan.apply({ confirm: ctx.confirm });
  return { code: 0, text: [`Put back the ${r.items} item(s) from ${id}.`, ...r.skipped.map((s) => `  - ${s}`), describePlan(plan, applied.applied)].join("\n"), data: { applied: applied.applied, skipped: r.skipped } };
}

function shine(ctx) {
  const commands = shineCommands(ctx.repo);
  if (!commands.length) return { code: 0, text: "This project has no formatter, linter or type checker that Syno can find, so there is nothing for Shine to run.", data: { results: [] } };
  if (!ctx.confirm) return { code: 0, text: ["Shine would run the project's own checks, one at a time, through Syno Governor:", ...commands.map((c) => `  - ${c.kind}: ${c.command}`), "Add --confirm to run them. Nothing is changed; only errors are counted."].join("\n"), data: { applied: false, commands } };
  const results = commands.map((c) => {
    const r = runApproved(c.command, { approved: true, cwd: ctx.repo, label: `5S shine ${c.kind}` });
    return { ...c, code: r.code, errors: errorCount(r.code, `${r.stdout}\n${r.stderr}`) };
  });
  const plan = new WritePlan(ctx.repo).write(SHINE, jsonText({ schemaVersion: 1, date: today(nowOf(ctx)), results }));
  plan.apply({ confirm: true });
  return { code: 0, text: results.map((r) => `- ${r.kind}: ${r.errors} error(s) (${r.command})`).join("\n"), data: { applied: true, results } };
}

function standardize(ctx) {
  const files = projectFiles(ctx.repo);
  const current = loadStandards(ctx.repo);
  if (current) {
    const c = checkStandards(ctx.repo, files, current);
    const issues = [...c.naming, ...c.size, ...c.missing];
    return { code: 0, text: issues.length ? [`${issues.length} place(s) depart from the standards:`, ...issues.map((i) => `  - ${i.path}: ${i.why}`)].join("\n") : "Everything follows the standards.", data: { applied: false, ...c } };
  }
  const proposed = proposeStandards(ctx.repo, files);
  const plan = new WritePlan(ctx.repo).write(STANDARDS, jsonText(proposed));
  const applied = plan.apply({ confirm: ctx.confirm });
  const lines = ["Proposed standards for this project:", ...proposed.naming.map((n) => `  - ${n.match}: ${n.style}, because ${n.why}`), `  - files stay under ${proposed.maxLines} lines`, `  - required files: ${proposed.required.join(", ")}`, "  - layout rules: none yet; add them to the file when you want Set in Order to move files"];
  return { code: 0, text: [...lines, describePlan(plan, applied.applied)].join("\n"), data: { applied: applied.applied, standards: proposed } };
}

/** One 5S check: every score, what was found, and what to do next. */
function check(ctx) {
  const date = today(nowOf(ctx));
  const files = projectFiles(ctx.repo);
  const sort = sortFindings(ctx.repo, nowOf(ctx)).findings;
  const standards = loadStandards(ctx.repo);
  const moves = standards ? proposeMoves(ctx.repo, files, standards).moves : [];
  const rules = (standards?.layout ?? []).map((r) => globRe(r.match));
  const std = standards ? checkStandards(ctx.repo, files, standards) : null;
  const issues = std ? [...std.naming, ...std.size, ...std.missing] : [];
  const shineRec = readJson(join(ctx.repo, SHINE));
  const sc = scores({ sort, moves: moves.length, filesInRules: files.filter((f) => rules.some((re) => re.test(f))).length, shine: shineRec, standards: std && { issues: issues.length, checked: std.checked }, past: history(ctx.repo), date });
  const next = [
    ...(sort.some((f) => f.pick) ? [`Run /syno:5s sort to move ${sort.filter((f) => f.pick).length} unneeded file(s) to the trash.`] : []),
    ...(!standards ? ["Run /syno:5s standardize to agree the project's standards."] : []),
    ...(moves.length ? [`Run /syno:5s set to put ${moves.length} file(s) where the standards say.`] : []),
    ...(sc.shine === null ? ["Run /syno:5s shine to count lint, format and type errors."] : []),
    ...issues.slice(0, 5).map((i) => `Fix ${i.path}: ${i.why}.`),
  ];
  const details = [...sort.map((f) => `${f.path}: ${f.why}`), ...issues.map((i) => `${i.path}: ${i.why}`)].slice(0, 30);
  return { schemaVersion: 1, date, scores: sc, counts: { sort: sort.length, moves: standards ? moves.length : null, shine: shineRec?.results?.reduce((n, r) => n + r.errors, 0) ?? null, standards: std ? issues.length : null }, next, details };
}

async function sustain(ctx) {
  const rec = check(ctx);
  const report = fivesReport(rec, { project: loadConfig(ctx.repo)?.project?.name ?? "This project", past: history(ctx.repo).filter((p) => p.date !== rec.date) });
  const plan = new WritePlan(ctx.repo).write(`${DIR}/${rec.date}.json`, jsonText(rec));
  const out = planReport(plan, "5s", report);
  const applied = plan.apply({ confirm: ctx.confirm });
  if (applied.applied) await notifyPulse(ctx.repo, "fives.score", fivesPulse(rec));
  return { code: 0, text: [`${report.verdict.level.toUpperCase()}: ${report.verdict.text}`, ...report.summary.map((x) => `- ${x}`), describePlan(plan, applied.applied)].join("\n"), data: { applied: applied.applied, check: rec, paths: out.paths, problems: out.problems } };
}

export async function run(ctx) {
  const [sub = "sustain", ...rest] = ctx.args;
  if (sub === "sustain" || sub === "all") return sustain(ctx);
  if (sub === "shine") return shine(ctx);
  if (sub === "standardize") return standardize(ctx);
  if (sub === "sort") return sort(ctx);
  if (sub === "set") return setInOrder(ctx);
  if (sub === "restore") return restore(ctx, rest);
  if (sub === "trash") {
    const list = trashList(ctx.repo);
    return { code: 0, text: list.length ? list.map((m) => `- ${m.id}: ${m.reason}, ${m.items.length} item(s)${m.restored ? ", restored" : ""}`).join("\n") : "The trash is empty.", data: { trash: list } };
  }
  throw usage("5s takes: sort, set, shine, standardize, sustain, trash, restore.");
}
