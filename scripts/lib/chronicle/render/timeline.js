// Chronicle's STRUCTURE and TIMELINE pages (PRD CH-07, CH-08, §7). Pure.
// STRUCTURE: the current folder tree, then one change table per release.
// TIMELINE: a Mermaid timeline of the last 12 months of releases, then every
// event newest first, grouped by month. "Last 12 months" counts back from the
// newest event, not from today, so renders never depend on the clock.
import { readerDate, STRINGS } from "../../report/render.js";
import { isEmptyDiff } from "../diff.js";
import { GLOSSARY, STATUS_LABEL, page, plural, size } from "./pages.js";

const newestFirst = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.order - b.order || (a.text < b.text ? -1 : a.text > b.text ? 1 : 0));
const month = (iso) => `${STRINGS.months.at(Number(iso.slice(5, 7)) - 1)} ${iso.slice(0, 4)}`;

/** The current tree: the newest snapshot by date (a release's snapshot wins a tie with a dated one). */
export function currentSnapshot(snapshots) {
  return [...snapshots].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.source === b.source ? 0 : a.source === "git-tree" ? -1 : 1))[0] ?? null;
}

function diffRows(d) {
  return [
    ...d.added.map((p) => ["Added", p]),
    ...d.removed.map((p) => ["Removed", p]),
    ...d.renamed.map((r) => ["Renamed", `${r.from} → ${r.to}`]),
    ...d.topLevel.map((t) => ["Size change", `${t.path}: ${t.filesDelta >= 0 ? "+" : ""}${t.filesDelta} files, ${t.bytesDelta >= 0 ? "+" : ""}${size(t.bytesDelta)}`]),
    ...d.moves.map((m) => ["Moved", `${m.from} → ${m.to} (${size(m.bytes)})`]),
  ];
}

export function structurePage(data) {
  const current = currentSnapshot(data.snapshots);
  const releaseSnaps = data.releases.map((r) => data.snapshots.find((s) => s.id === r.version)).filter((s) => s?.diffFromPrevious);
  const lastDiff = releaseSnaps[0]?.diffFromPrevious;
  return page(data, "Project structure", {
    verdict: { level: "green", text: current ? `The project has ${plural(current.totals.files, "file")} in ${plural(current.folders.length, "folder")}.` : "No structure snapshot yet." },
    howToRead: "The first table shows the folders as they are now. Each table after it shows how the folders changed in one release.",
    summary: [
      current ? `Total size is ${size(current.totals.bytes)}.` : "Run a snapshot to see the folders.",
      current ? `This view was taken on ${readerDate(current.date)}.` : "Snapshots are taken at every release.",
      lastDiff ? `The last release changed ${plural(diffRows(lastDiff).length, "thing")} in the folders.` : "No release has changed the folders yet.",
    ],
    sections: [
      current && { heading: "Folders now", table: { columns: [{ label: "Folder" }, { label: "Files", num: true }, { label: "Size", num: true }], rows: current.folders.map((f) => [f.path, String(f.files), size(f.bytes)]) } },
      ...releaseSnaps.map((s) => (isEmptyDiff(s.diffFromPrevious) ? { heading: `Changes in ${s.id}`, text: "No structure changes." } : { heading: `Changes in ${s.id}`, table: { columns: [{ label: "Change" }, { label: "Folder or file" }], rows: diffRows(s.diffFromPrevious) } })),
    ].filter(Boolean),
    glossary: [GLOSSARY.folder, GLOSSARY.release],
  });
}

/** Every dated event: ideas (added and each status change), releases, withdrawals, publishes, structure changes. */
export function events(data) {
  const out = [];
  for (const i of data.ideas) {
    i.statusHistory.forEach((s, n) => out.push({ date: s.date, order: 3, text: n === 0 ? `Idea ${i.id} added: ${i.title}` : `Idea ${i.id} moved to ${STATUS_LABEL[s.status]}: ${i.title}` }));
  }
  for (const r of data.releases) {
    out.push({ date: r.date, order: 1, text: `Released ${r.version} with ${plural(r.changes.length, "change")}` });
    if (r.yanked) out.push({ date: r.yanked.date, order: 1, text: `Withdrew ${r.version}: ${r.yanked.reason}` });
    for (const c of r.channels.filter((c) => c.date)) out.push({ date: c.date, order: 2, text: `${r.version} ${c.status === "planned" ? "planned for" : c.status === "yanked" ? "withdrawn from" : "published to"} ${c.channel}` });
    const d = data.snapshots.find((s) => s.id === r.version)?.diffFromPrevious;
    if (d && !isEmptyDiff(d)) out.push({ date: r.date, order: 4, text: `Folders changed in ${r.version}: ${plural(d.added.length, "added", "added")}, ${plural(d.removed.length, "removed", "removed")}, ${plural(d.renamed.length, "renamed", "renamed")}` });
  }
  return out.sort(newestFirst);
}

function mermaidTimeline(data, newest) {
  if (!newest) return undefined;
  const cutoff = `${Number(newest.slice(0, 4)) - 1}${newest.slice(4, 7)}`;
  const byMonth = new Map();
  for (const r of [...data.releases].reverse()) {
    const key = r.date.slice(0, 7);
    if (key <= cutoff) continue;
    byMonth.set(key, [...(byMonth.get(key) ?? []), r.version]);
  }
  if (!byMonth.size) return undefined;
  return ["timeline", "  title Releases in the last 12 months", ...[...byMonth].map(([m, vs]) => `  ${m} : ${vs.join(" : ")}`)].join("\n");
}

export function timelinePage(data) {
  const all = events(data);
  const months = [];
  for (const e of all) {
    const key = month(e.date);
    if (months.at(-1)?.key !== key) months.push({ key, rows: [] });
    months.at(-1).rows.push([readerDate(e.date), e.text]);
  }
  const span = all.length ? `${readerDate(all.at(-1).date)} to ${readerDate(all[0].date)}` : "";
  return page(data, "Timeline", {
    verdict: { level: "green", text: all.length ? `${plural(all.length, "event")} recorded, from ${span}.` : "Nothing has happened yet." },
    howToRead: "Everything that happened, newest first, grouped by month. The chart at the top shows the releases of the last 12 months.",
    summary: [
      `${plural(data.releases.length, "release")} and ${plural(data.ideas.length, "idea")} are on the timeline.`,
      all.length ? `The newest event is from ${readerDate(all[0].date)}.` : "The first event will appear here.",
      `${plural(months.length, "month")} have something recorded.`,
    ],
    sections: [
      { heading: "Releases in the last 12 months", mermaid: mermaidTimeline(data, all[0]?.date), text: data.releases.length ? undefined : "No releases yet." },
      ...months.map((m) => ({ heading: m.key, table: { columns: [{ label: "Date" }, { label: "What happened" }], rows: m.rows } })),
    ],
    glossary: [GLOSSARY.release, GLOSSARY.idea, GLOSSARY.published],
  });
}
