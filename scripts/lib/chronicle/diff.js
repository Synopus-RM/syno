// Structure diffs between two snapshots (PRD CH-07.3). Pure: file moves come in
// from the caller (git's rename detection), so rendering never needs git.
//   renamed = at least 60% of a removed folder's files reappear under one new folder
//   topLevel = file-count and size change per top-level folder ("." for root files)
//   moves = the 10 largest file moves

export const RENAME_SHARE = 0.6;
const TOP_MOVES = 10;

const byPath = (folders) => new Map(folders.map((f) => [f.path, f]));
const under = (path, folder) => path.startsWith(`${folder}/`);

/** Removed→added folder pairs where enough of the files moved together. */
function findRenames(removed, added, prevFolders, moves) {
  const renamed = [];
  for (const from of removed) {
    const total = prevFolders.get(from)?.files ?? 0;
    if (!total) continue;
    const counts = new Map();
    for (const m of moves) {
      if (!under(m.from, from)) continue;
      const to = added.find((a) => under(m.to, a) && m.to.slice(a.length + 1) === m.from.slice(from.length + 1));
      if (to) counts.set(to, (counts.get(to) ?? 0) + 1);
    }
    const [best, n] = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ?? [];
    if (best && n / total >= RENAME_SHARE) renamed.push({ from, to: best });
  }
  return renamed;
}

/** Without file moves (no git), a removed and an added folder with the same files and bytes count as a rename. */
function signatureRenames(removed, added, prev, cur) {
  const out = [];
  const free = new Set(added);
  for (const from of removed) {
    const p = prev.get(from);
    const match = [...free].find((a) => cur.get(a).files === p.files && cur.get(a).bytes === p.bytes && a.split("/").length === from.split("/").length);
    if (match) {
      out.push({ from, to: match });
      free.delete(match);
    }
  }
  return out;
}

/** Keeps only the top-most rename when a parent folder moved with its children. */
function topMost(renamed) {
  return renamed.filter((r) => !renamed.some((o) => o !== r && under(r.from, o.from) && under(r.to, o.to)));
}

function topLevelChanges(prev, cur) {
  const sum = (snap) => {
    const totals = new Map();
    for (const f of snap.folders.filter((f) => !f.path.includes("/"))) totals.set(f.path, { files: f.files, bytes: f.bytes });
    const inFolders = [...totals.values()].reduce((a, t) => ({ files: a.files + t.files, bytes: a.bytes + t.bytes }), { files: 0, bytes: 0 });
    totals.set(".", { files: snap.totals.files - inFolders.files, bytes: snap.totals.bytes - inFolders.bytes });
    return totals;
  };
  const a = sum(prev);
  const b = sum(cur);
  const paths = [...new Set([...a.keys(), ...b.keys()])].sort();
  return paths
    .map((path) => ({ path, filesDelta: (b.get(path)?.files ?? 0) - (a.get(path)?.files ?? 0), bytesDelta: (b.get(path)?.bytes ?? 0) - (a.get(path)?.bytes ?? 0) }))
    .filter((t) => t.filesDelta || t.bytesDelta);
}

/**
 * The diff stored in `cur.diffFromPrevious`. `moves` is [{ from, to, bytes }]
 * for files git saw renamed; pass null when there is no git.
 */
export function diffSnapshots(prev, cur, moves = null) {
  const p = byPath(prev.folders);
  const c = byPath(cur.folders);
  const removedAll = [...p.keys()].filter((k) => !c.has(k)).sort();
  const addedAll = [...c.keys()].filter((k) => !p.has(k)).sort();
  const renamed = topMost(moves ? findRenames(removedAll, addedAll, p, moves) : signatureRenames(removedAll, addedAll, p, c));
  const inRename = (path, side) => renamed.some((r) => r[side] === path || under(path, r[side]));
  return {
    previous: prev.id,
    added: addedAll.filter((a) => !inRename(a, "to")),
    removed: removedAll.filter((r) => !inRename(r, "from")),
    renamed,
    topLevel: topLevelChanges(prev, cur),
    moves: [...(moves ?? [])].sort((a, b) => b.bytes - a.bytes || a.from.localeCompare(b.from)).slice(0, TOP_MOVES),
  };
}

/** True when two snapshots show no structure change at all (AC-CH-07.3). */
export const isEmptyDiff = (d) => !d || (!d.added.length && !d.removed.length && !d.renamed.length && !d.topLevel.length && !d.moves.length);
