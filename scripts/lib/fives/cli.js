// Syno 5S's commands (PRD S-14). Works on the project folder only; every move
// or removal goes to the restorable trash, and only after the owner's yes.
//   syno 5s sort [--items <id,id>] [--confirm]     without --items: the picked findings
//   syno 5s set [--confirm]                        moves the standards ask for, with import changes
//   syno 5s trash                                  the trash folders, newest first
//   syno 5s restore <id> [--confirm]
import { WritePlan, usage } from "../fsutil.js";
import { describePlan, nowOf } from "../chronicle/docs.js";
import { stamp } from "../chronicle/records.js";
import { projectFiles, sortFindings } from "./scan.js";
import { STANDARDS, loadStandards, proposeMoves } from "./set.js";
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

export async function run(ctx) {
  const [sub, ...rest] = ctx.args;
  if (sub === "sort") return sort(ctx);
  if (sub === "set") return setInOrder(ctx);
  if (sub === "restore") return restore(ctx, rest);
  if (sub === "trash") {
    const list = trashList(ctx.repo);
    return { code: 0, text: list.length ? list.map((m) => `- ${m.id}: ${m.reason}, ${m.items.length} item(s)${m.restored ? ", restored" : ""}`).join("\n") : "The trash is empty.", data: { trash: list } };
  }
  throw usage("5s takes: sort, set, trash, restore.");
}
