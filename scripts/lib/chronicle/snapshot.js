// Structure snapshots (PRD CH-07). A snapshot records each folder's file count
// and size to the configured depth, at a release or on demand. With git, only
// tracked files count (so .gitignore applies) and it reads `git ls-tree`, never
// checkout, stash or a worktree. Without git it walks the folder. The ignore
// list applies in both cases.
import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { git, tryGit } from "../git.js";
import { diffSnapshots } from "./diff.js";

const skip = (path, ignore) => path.split("/").some((seg) => ignore.includes(seg));

/** Tracked files at a git ref: [{ path, bytes }]. */
export function gitFiles(root, ref, ignore = []) {
  const out = git(["ls-tree", "-r", "-l", "--full-tree", ref], { cwd: root });
  const files = [];
  for (const line of out.split("\n").filter(Boolean)) {
    const tab = line.indexOf("\t");
    const [, type, , size] = line.slice(0, tab).split(/\s+/);
    const path = line.slice(tab + 1);
    if (type === "blob" && !skip(path, ignore)) files.push({ path, bytes: Number(size) || 0 });
  }
  return files;
}

/** Files on disk under root, skipping links and ignored folders: [{ path, bytes }]. */
export function fsFiles(root, ignore = []) {
  const files = [];
  const walk = (dir, rel) => {
    for (const name of readdirSync(dir).sort()) {
      if (ignore.includes(name)) continue;
      const full = join(dir, name);
      const path = rel ? `${rel}/${name}` : name;
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) walk(full, path);
      else if (stat.isFile()) files.push({ path, bytes: stat.size });
    }
  };
  walk(root, "");
  return files;
}

/** Folder totals to `depth` levels; each folder counts everything under it. */
export function foldersOf(files, depth) {
  const folders = new Map();
  let bytes = 0;
  for (const f of files) {
    bytes += f.bytes;
    const parts = f.path.split("/").slice(0, -1);
    for (let d = 1; d <= Math.min(depth, parts.length); d++) {
      const path = parts.slice(0, d).join("/");
      const entry = folders.get(path) ?? { path, files: 0, bytes: 0 };
      entry.files += 1;
      entry.bytes += f.bytes;
      folders.set(path, entry);
    }
  }
  const sorted = [...folders.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { folders: sorted, totals: { files: files.length, bytes } };
}

/** Files git saw move between two refs, with their size at the new ref. */
export function gitMoves(root, fromRef, toRef, sizes) {
  const out = tryGit(["diff", "--name-status", "-M", fromRef, toRef], { cwd: root }) ?? "";
  return out
    .split("\n")
    .filter((l) => /^R\d*\t/.test(l))
    .map((l) => {
      const [, from, to] = l.split("\t");
      return { from, to, bytes: sizes.get(to) ?? 0 };
    });
}

/**
 * A snapshot record. `ref` is a git ref (tag or commit) or null for the
 * working folder; `previous` is the snapshot to diff against, or null.
 */
export function takeSnapshot(root, chronicle, { id, date, ref = null, previous = null }) {
  const { depth, ignore } = chronicle.snapshot;
  const files = ref ? gitFiles(root, ref, ignore) : fsFiles(root, ignore);
  const { folders, totals } = foldersOf(files, depth);
  const snap = { schemaVersion: 1, id, date, source: ref ? "git-tree" : "filesystem", ref, depth, totals, folders, diffFromPrevious: null };
  if (previous) {
    const moves = ref && previous.ref ? gitMoves(root, previous.ref, ref, new Map(files.map((f) => [f.path, f.bytes]))) : null;
    snap.diffFromPrevious = diffSnapshots(previous, snap, moves);
  }
  return snap;
}
