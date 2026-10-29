// 5S's restorable trash (PRD S-14 rule 7). Each 5S change gets its own folder
// .syno/trash/<YYYYMMDD-HHMMSS>/ with a manifest of original paths and hashes:
// files moved out, empty folders removed, files moved to a new place, and the
// original text of files whose imports were changed. `restore` puts them back.
// Syno never empties the trash; the owner deletes a folder when they are sure.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { jsonText, readJson, sha256, usage } from "../fsutil.js";

export const TRASH = ".syno/trash";
const manifestPath = (id) => `${TRASH}/${id}/manifest.json`;
export const keptCopy = (id, path) => `${TRASH}/${id}/files/${path}`;

/** A trash id that isn't taken yet: the timestamp, then -2, -3 … */
export function freeId(root, base) {
  let id = base;
  for (let n = 2; existsSync(join(root, TRASH, id)); n++) id = `${base}-${n}`;
  return id;
}

/** Adds a manifest and the trash ops for `items` to `plan`. Items: { kind: "file"|"dir"|"move"|"edit", path, … }. */
export function planTrash(plan, root, id, { reason, at }, items) {
  const entries = [];
  for (const item of items) {
    if (item.kind === "dir") {
      plan.trash(item.path, id, { dir: true });
      entries.push({ kind: "dir", path: item.path });
      continue;
    }
    const bytes = readFileSync(join(root, item.path));
    if (item.kind === "edit") {
      plan.write(keptCopy(id, item.path), bytes);
      plan.write(item.path, item.content);
      entries.push({ kind: "edit", path: item.path, sha256: sha256(bytes), editedSha256: sha256(Buffer.from(item.content)) });
      continue;
    }
    plan.trash(item.path, id);
    if (item.kind === "move") plan.write(item.to, item.content ?? bytes);
    entries.push({ kind: item.kind, path: item.path, sha256: sha256(bytes), ...(item.kind === "move" ? { movedTo: item.to, movedSha256: sha256(item.content === undefined ? bytes : Buffer.from(item.content)) } : {}) });
  }
  plan.write(manifestPath(id), jsonText({ schemaVersion: 1, id, at, reason, items: entries, restored: null }));
  return entries;
}

export function trashList(root) {
  let ids = [];
  try {
    ids = readdirSync(join(root, TRASH)).sort().reverse();
  } catch {}
  return ids.map((id) => readJson(join(root, manifestPath(id)))).filter(Boolean);
}

const current = (root, path) => (existsSync(join(root, path)) ? sha256(readFileSync(join(root, path))) : null);

/**
 * Plans putting a trash folder's files back, byte-identical (AC-FS.1). A file
 * that has come back in the meantime, or a moved or edited copy changed since,
 * is left alone and named in `skipped`. Moved copies go to a new trash folder.
 */
export function planRestore(plan, root, id, { at, newId }) {
  const m = readJson(join(root, manifestPath(id)));
  if (!m) throw usage(`No trash folder ${id}. "syno 5s trash" lists them.`);
  if (m.restored) throw usage(`${id} was already restored on ${m.restored.slice(0, 10)}.`);
  const skipped = [];
  const moved = [];
  for (const item of m.items) {
    if (item.kind === "dir") {
      if (!existsSync(join(root, item.path))) plan.folder(item.path);
      continue;
    }
    if (item.kind === "edit") {
      if (current(root, item.path) === item.editedSha256) plan.write(item.path, readFileSync(join(root, keptCopy(id, item.path))));
      else skipped.push(`${item.path} changed after its imports were updated, so it was kept as it is now`);
      continue;
    }
    if (existsSync(join(root, item.path))) {
      skipped.push(`${item.path} exists again, so it was kept as it is now`);
      continue;
    }
    plan.write(item.path, readFileSync(join(root, keptCopy(id, item.path))));
    if (item.movedTo && current(root, item.movedTo) === item.movedSha256) moved.push({ kind: "file", path: item.movedTo });
    else if (item.movedTo && existsSync(join(root, item.movedTo))) skipped.push(`${item.movedTo} changed after the move, so both copies were kept`);
  }
  if (moved.length) planTrash(plan, root, newId, { reason: `Moved copies taken back by restoring ${id}`, at }, moved);
  plan.write(manifestPath(id), jsonText({ ...m, restored: at }));
  return { skipped, items: m.items.length };
}
