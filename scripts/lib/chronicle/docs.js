// Renders Chronicle's generated files into a write plan (PRD CH-09): the
// managed part of CHANGELOG.md, the five pages in docs/syno/ and their HTML
// copies in docs/syno/html/. A hash of every file Syno rendered is kept in
// .syno/local/state.json; a page edited by hand since then is not overwritten
// unless the owner says so (CH-09.3).
import { createHash } from "node:crypto";
import { join } from "node:path";
import { readText } from "../fsutil.js";
import { STYLES_PATH, renderReport } from "../report/render.js";
import { END, START, parseChangelog } from "./changelog-parse.js";
import { STATE_PATH } from "./config.js";
import { loadChanges, loadIdeas, loadReleases, loadSnapshots } from "./records.js";
import { renderChangelog } from "./render/changelog.js";
import { ideasPage, readmePage, releasesPage } from "./render/pages.js";
import { structurePage, timelinePage } from "./render/timeline.js";
import { jsonText } from "../fsutil.js";

const sha = (text) => createHash("sha256").update(text).digest("hex");
const PAGES = { README: readmePage, RELEASES: releasesPage, IDEAS: ideasPage, STRUCTURE: structurePage, TIMELINE: timelinePage };

/** Everything the pages are drawn from, read fresh from .syno/. */
export function loadData(root, config) {
  return { project: config.project.name, releases: loadReleases(root), pending: loadChanges(root), ideas: loadIdeas(root), snapshots: loadSnapshots(root) };
}

/** The managed block of a CHANGELOG (between the markers), for hand-edit hashing. */
const managed = (text) => {
  const s = text.indexOf(START);
  const e = text.indexOf(END);
  return s >= 0 && e > s ? text.slice(s, e + END.length) : null;
};

/**
 * Every generated file: { path: content }. `data` may be passed in to render
 * records that aren't on disk yet (a release being cut); `earlier` is the
 * verbatim "Earlier history" text, kept from the first adoption.
 */
export function renderDocs(root, config, { data = loadData(root, config), earlier = null, version = "0.1.0" } = {}) {
  const chron = config.chronicle;
  const css = readText(STYLES_PATH, "");
  const existing = readText(join(root, chron.changelogPath));
  const parsed = existing === null ? null : parseChangelog(existing);
  const keepEarlier = earlier ?? (parsed?.hasMarkers ? parsed.earlier : "");
  const files = {};
  files[chron.changelogPath] = renderChangelog({ releases: data.releases, pending: data.pending, earlier: keepEarlier, repoUrl: config.project.repoUrl, tagPrefix: chron.tagPrefix }, existing, parsed?.region ?? null);
  for (const [name, build] of Object.entries(PAGES)) {
    const out = renderReport(build(data), { css, version });
    files[`${chron.docsDir}/${name}.md`] = out.markdown;
    files[`${chron.docsDir}/html/${name}.html`] = out.html;
  }
  return files;
}

/** The hash Syno keeps for a file: the managed block for the CHANGELOG, the whole file otherwise. */
const hashOf = (path, text, changelogPath) => sha(path === changelogPath ? managed(text) ?? text : text);

/** Generated files someone changed by hand since Syno last rendered them. */
export function handEdited(root, config, state) {
  const out = [];
  for (const [path, hash] of Object.entries(state.renderHashes ?? {})) {
    const text = readText(join(root, path));
    if (text !== null && hashOf(path, text, config.chronicle.changelogPath) !== hash) out.push(path);
  }
  return out.sort();
}

/**
 * Adds the generated files and the updated state to `plan`. Returns
 * { edited, refused }: pages edited by hand are left alone (refused) unless
 * `overwriteEdits` is true.
 */
export function planDocs(plan, root, config, state, opts = {}) {
  const files = renderDocs(root, config, opts);
  const edited = handEdited(root, config, state);
  const refused = opts.overwriteEdits ? [] : edited.filter((p) => p in files);
  const hashes = { ...state.renderHashes };
  for (const [path, content] of Object.entries(files)) {
    if (refused.includes(path)) continue;
    plan.write(path, content);
    hashes[path] = hashOf(path, content, config.chronicle.changelogPath);
  }
  const next = { ...state, renderHashes: Object.fromEntries(Object.entries(hashes).sort(([a], [b]) => (a < b ? -1 : 1))) };
  if (opts.lastSyncedTag !== undefined) next.lastSyncedTag = opts.lastSyncedTag;
  plan.write(STATE_PATH, jsonText(next));
  return { edited, refused };
}

// ---- Finishing a Chronicle write: every write command ends the same way. ----

/** The clock for this run; tests pass --now for repeatable records. */
export const nowOf = (ctx) => (typeof ctx.flags.now === "string" ? new Date(ctx.flags.now) : new Date());

/** Lists of affected files, in plain words, for the preview and the result. */
export function describePlan(plan, applied) {
  if (plan.empty) return "No files would change.";
  const head = applied ? "Syno wrote these files:" : "Syno would write these files (nothing is written until you confirm):";
  return [head, ...plan.describe().map((l) => `  ${l}`), ...(applied ? [] : ["Run again with --confirm to write them."])].join("\n");
}

/** Tells Syno Pulse about a Chronicle event, when Pulse is built and enabled. Never fails the command. */
export async function notifyPulse(root, type, data) {
  try {
    const { emit } = await import("../pulse/emit.js");
    await emit(root, type, data);
  } catch {
    // Pulse not built yet, or not enabled here: nothing to send.
  }
}

/**
 * Re-renders the docs into `plan`, applies it if the owner confirmed, and
 * returns a CLI result. `events` are Pulse events to send after a real write.
 */
export async function finish(ctx, plan, config, state, { intro = [], events = [], data, earlier, lastSyncedTag, extra = {} } = {}) {
  const { refused } = planDocs(plan, ctx.repo, config, state, { data, earlier, lastSyncedTag, overwriteEdits: ctx.flags["overwrite-edits"] === true });
  const result = plan.apply({ confirm: ctx.confirm });
  if (result.applied) for (const e of events) await notifyPulse(ctx.repo, e.type, e.data);
  const notes = refused.length ? ["", "These pages were edited by hand, so Syno left them alone:", ...refused.map((p) => `  ${p}`), "Add --overwrite-edits to replace them after checking the edits."] : [];
  return { code: 0, text: [...intro, describePlan(plan, result.applied), ...notes].join("\n"), data: { applied: result.applied, ops: result.ops, handEdited: refused, ...extra } };
}

/** Generated files whose content no longer matches the records (render --check, CH-13.2). */
export function staleDocs(root, config) {
  const files = renderDocs(root, config);
  return Object.entries(files)
    .filter(([path, content]) => readText(join(root, path)) !== content)
    .map(([path]) => path)
    .sort();
}
