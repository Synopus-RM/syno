// Setting Chronicle up in a project (PRD CH-01, CH-02, CH-11): init for a new
// codebase, adoption for one with history, sync for tags made outside Syno,
// and the .gitignore lines for Syno's local folders. Every write goes through a
// plan the owner sees first.
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { WritePlan, readJson, readText } from "../fsutil.js";
import { isRepo, tryGit } from "../git.js";
import { adoptHistory } from "./adopt.js";
import { CONFIG_PATH, configText, loadConfig, loadState, newConfig, newState } from "./config.js";
import { describePlan, finish, nowOf } from "./docs.js";
import { detectManifest } from "./manifests.js";
import { loadChanges, loadIdeas, loadReleases, loadSnapshots, newIdea, planRecord, today } from "./records.js";
import { compare } from "./semver.js";
import { takeSnapshot } from "./snapshot.js";

export const LOCAL_IGNORES = [".syno/local/", ".syno/reports/", ".syno/sessions/", ".syno/trash/"];

const hasCommits = (root) => isRepo(root) && tryGit(["rev-parse", "--verify", "--quiet", "HEAD"], { cwd: root }) !== null;

/** A codebase is existing if it has any git commit or a CHANGELOG.md (CH-01). */
export const hasHistory = (root) => hasCommits(root) || existsSync(join(root, "CHANGELOG.md"));

function freshConfig(ctx) {
  const root = ctx.repo;
  const manifest = detectManifest(root);
  const name = typeof ctx.flags.name === "string" ? ctx.flags.name : readJson(join(root, "package.json"))?.name ?? basename(root);
  const repoUrl = isRepo(root) ? tryGit(["remote", "get-url", "origin"], { cwd: root }) : null;
  const versionSource = manifest ? `manifest:${manifest.path}` : isRepo(root) ? "git-tags" : "none";
  return { config: newConfig({ name, repoUrl, versionSource }), manifest };
}

/** /syno:init — a new codebase gets a config, a baseline snapshot, CHANGELOG.md and the five pages. */
export async function init(ctx) {
  if (loadConfig(ctx.repo)) return { code: 0, text: "Syno is already set up here. Nothing changed.", data: { applied: false, ops: [], already: true } };
  if (hasHistory(ctx.repo)) return adopt(ctx);
  const { config, manifest } = freshConfig(ctx);
  const date = today(nowOf(ctx));
  const plan = new WritePlan(ctx.repo).write(CONFIG_PATH, configText(config));
  const snap = takeSnapshot(ctx.repo, config.chronicle, { id: "baseline", date, ref: null });
  planRecord(plan, "snapshot", snap);
  const first = manifest?.version ?? "0.1.0";
  const intro = [`This looks like a new project, so Syno will start its record for "${config.project.name}".`, `The first release will be ${first} unless you choose another.`, ""];
  return finish(ctx, plan, config, newState(), { intro, data: { project: config.project.name, releases: [], pending: [], ideas: [], snapshots: [snap] }, extra: { kind: "new", firstVersion: first } });
}

/** Adds snapshots for releases, oldest first, each diffed against the one before it. */
function planSnapshots(plan, root, config, releases, existing) {
  const out = [...existing];
  for (const r of [...releases].sort((a, b) => compare(a.version, b.version))) {
    if (!r.git?.commit) continue;
    const before = out.filter((s) => s.source === "git-tree" && s.id !== r.version).at(-1) ?? null;
    const snap = takeSnapshot(root, config.chronicle, { id: r.version, date: r.date, ref: r.git.commit, previous: before });
    planRecord(plan, "snapshot", snap);
    out.push(snap);
  }
  return out;
}

function ideaImports(ctx, candidates, ideas, now) {
  const pick = ctx.flags.ideas;
  if (!pick || !candidates.length) return [];
  const chosen = pick === "all" ? candidates : String(pick).split(",").map((n) => candidates[Number(n) - 1]).filter(Boolean);
  const out = [];
  for (const c of chosen) out.push(newIdea({ title: c.title, notes: `Imported from ${c.file}.` }, { ideas: [...ideas, ...out], now }));
  return out;
}

function adoptIntro(result, releases, pending, imported, candidates, baselineTaken) {
  const lines = ["Syno read this project's history without changing anything:"];
  if (releases.length) lines.push(`  - ${releases.length} releases from version tags (${releases.at(-1).version} to ${releases[0].version})${result.tags.limited ? `, the last 50 of ${result.tags.total} tags (add --all for every tag)` : ""}`);
  else lines.push("  - No new releases to record.");
  lines.push(`  - ${releases.reduce((n, r) => n + r.changes.length, 0)} changes inside those releases`);
  if (pending.length) lines.push(`  - ${pending.length} waiting changes from the CHANGELOG's Unreleased part`);
  if (result.changelog.exists && !result.changelog.hasMarkers) lines.push("  - CHANGELOG.md: the text before the first version stays exactly as it is.");
  if (result.earlier) lines.push("  - Parts of the old CHANGELOG that Syno couldn't read are kept, word for word, under Earlier history.");
  if (result.tags.unmatched.length) lines.push(`  - Tags that don't look like versions were skipped: ${result.tags.unmatched.join(", ")}`);
  if (candidates.length && !imported.length) {
    lines.push(`  - ${candidates.length} possible ideas found. Add --ideas all, or --ideas 1,3 to pick:`);
    candidates.slice(0, 20).forEach((c, i) => lines.push(`      ${i + 1}. ${c.title} (${c.file})`));
  }
  if (imported.length) lines.push(`  - ${imported.length} ideas to import`);
  if (baselineTaken) lines.push("  - Syno takes one snapshot of the folder as a starting point.");
  return [...lines, ""];
}

/** /syno:init on a codebase with history, or `syno adopt`. Reads history, never changes it (CH-02). */
export async function adopt(ctx) {
  const root = ctx.repo;
  const existing = loadConfig(root);
  const { config } = existing ? { config: existing } : freshConfig(ctx);
  const now = nowOf(ctx);
  const result = adoptHistory(root, config, { all: ctx.flags.all === true, now });
  const known = new Set(loadReleases(root).map((r) => r.version));
  const releases = result.releases.filter((r) => !known.has(r.version));
  const firstTime = !existing && !result.changelog.hasMarkers;
  const pending = firstTime ? result.pending : [];
  const ideas = loadIdeas(root);
  const imported = ideaImports(ctx, result.ideas, ideas, now);
  const plan = new WritePlan(root);
  if (!existing) plan.write(CONFIG_PATH, configText(config));
  for (const r of releases) planRecord(plan, "release", r);
  for (const c of pending) planRecord(plan, "change", c);
  for (const i of imported) planRecord(plan, "idea", i);
  let snapshots = planSnapshots(plan, root, config, releases, loadSnapshots(root));
  const baselineTaken = !snapshots.length;
  if (baselineTaken) {
    const base = takeSnapshot(root, config.chronicle, { id: "baseline", date: today(now), ref: null });
    planRecord(plan, "snapshot", base);
    snapshots = [base];
  }
  const all = [...releases, ...loadReleases(root)].sort((a, b) => compare(b.version, a.version));
  const lastSyncedTag = all.find((r) => r.git?.tag)?.git.tag ?? null;
  const intro = adoptIntro(result, releases, pending, imported, result.ideas, baselineTaken);
  return finish(ctx, plan, config, existing ? loadState(root) : newState(), {
    intro,
    data: { project: config.project.name, releases: all, pending: [...loadChanges(root), ...pending], ideas: [...ideas, ...imported], snapshots },
    earlier: firstTime ? result.earlier : undefined,
    lastSyncedTag,
    extra: { kind: "adopt", releases: releases.length, pending: pending.length, ideaCandidates: result.ideas, unmatchedTags: result.tags.unmatched },
  });
}

/** /syno:sync — tags made with plain git since the last sync become proposed releases (CH-11). */
export async function sync(ctx) {
  const config = loadConfig(ctx.repo);
  const result = adoptHistory(ctx.repo, config, { all: true, now: nowOf(ctx) });
  const known = new Set(loadReleases(ctx.repo).map((r) => r.version));
  const fresh = result.releases.filter((r) => !known.has(r.version) && r.git);
  if (!fresh.length) return { code: 0, text: "No new version tags since the last sync. Nothing changed.", data: { applied: false, ops: [], releases: [] } };
  const plan = new WritePlan(ctx.repo);
  for (const r of fresh) planRecord(plan, "release", r);
  const snapshots = planSnapshots(plan, ctx.repo, config, fresh, loadSnapshots(ctx.repo));
  const all = [...fresh, ...loadReleases(ctx.repo)].sort((a, b) => compare(b.version, a.version));
  const intro = [`Found ${fresh.length} version tags made outside Syno:`, ...fresh.map((r) => `  - ${r.version} (${r.git.tag}, ${r.date}): ${r.changes.length} changes`), ""];
  const events = fresh.map((r) => ({ type: "chronicle.release", data: { version: r.version, date: r.date, status: r.status, changes: r.changes.length } }));
  return finish(ctx, plan, config, loadState(ctx.repo), { intro, events, data: { project: config.project.name, releases: all, pending: [], ideas: loadIdeas(ctx.repo), snapshots }, lastSyncedTag: all.find((r) => r.git?.tag)?.git.tag ?? null, extra: { releases: fresh.map((r) => r.version) } });
}

/** Adds .gitignore lines for Syno's local folders (CH-01.3), after a yes. */
export function ignore(ctx) {
  const text = readText(join(ctx.repo, ".gitignore"), "") ?? "";
  const have = new Set(text.split(/\r?\n/).map((l) => l.trim()));
  const missing = LOCAL_IGNORES.filter((l) => !have.has(l));
  if (!missing.length) return { code: 0, text: "Syno's local folders are already in .gitignore. Nothing changed.", data: { applied: false, ops: [] } };
  const sep = text && !text.endsWith("\n") ? "\n" : "";
  const plan = new WritePlan(ctx.repo).write(".gitignore", `${text}${sep}${text ? "\n" : ""}# Syno: files that stay on this machine\n${missing.join("\n")}\n`);
  const result = plan.apply({ confirm: ctx.confirm });
  return { code: 0, text: [`These lines keep Syno's local files out of git: ${missing.join(", ")}`, describePlan(plan, result.applied)].join("\n"), data: { applied: result.applied, ops: result.ops, missing } };
}
