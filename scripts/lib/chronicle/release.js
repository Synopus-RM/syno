// Releases (PRD CH-05, CH-06, CH-10): plan, cut, yank, publish, notes, and the
// two optional steps after a cut, a manifest bump and a local tag, each its own
// command so the owner answers each separately. Syno never pushes.
import { join } from "node:path";
import { WritePlan, readText, refusal, usage } from "../fsutil.js";
import { git, isRepo, tryGit } from "../git.js";
import { readerDate } from "../report/render.js";
import { loadConfig, loadState } from "./config.js";
import { describePlan, finish, nowOf } from "./docs.js";
import { bumpManifestText, detectManifest, findManifests } from "./manifests.js";
import { loadChanges, loadIdeas, loadReleases, loadSnapshots, planRecord, recordPath, setIdeaStatus, today } from "./records.js";
import { TYPE_ORDER, compareUrl, repoLinks } from "./render/changelog.js";
import { bumpKind, nextVersion, parse } from "./semver.js";
import { takeSnapshot } from "./snapshot.js";

const REASON = { major: "a change may break things, so the first number goes up", minor: "something new was added, so the middle number goes up", patch: "only fixes and small changes, so the last number goes up" };

/** The release gate (PRD §4.3) is Syno Sigma's. */
export async function releaseGate(root, config) {
  const { gate } = await import("../sigma/gate.js");
  return gate(root, config, "release");
}

function proposal(ctx) {
  const releases = loadReleases(ctx.repo);
  const pending = loadChanges(ctx.repo);
  const current = releases[0]?.version ?? null;
  const first = detectManifest(ctx.repo)?.version ?? "0.1.0";
  const pre = typeof ctx.flags.pre === "string" ? ctx.flags.pre : undefined;
  if (pre && !["alpha", "beta", "rc"].includes(pre)) throw usage("--pre takes alpha, beta or rc.");
  const version = nextVersion(current, pending, { pre, first });
  const kind = current ? bumpKind(pending, current) : null;
  return { releases, pending, current, version, kind, date: today(nowOf(ctx)), ideas: [...new Set(pending.flatMap((c) => c.ideas))].sort() };
}

export async function plan(ctx) {
  const config = loadConfig(ctx.repo);
  const p = proposal(ctx);
  const gate = await releaseGate(ctx.repo, config);
  const lines = [
    `Next version: ${p.version}${p.current ? ` (now ${p.current}; ${p.current && parse(p.current).pre.length && !ctx.flags.pre ? "this finishes the pre-release" : REASON[p.kind]})` : " (the first release)"}.`,
    `Date: ${readerDate(p.date)}. You can change either.`,
    p.pending.length ? `${p.pending.length} waiting changes go into it:` : "No changes are waiting. Add --empty to release anyway.",
    ...TYPE_ORDER.flatMap((t) => p.pending.filter((c) => c.type === t).map((c) => `  - ${t}: ${c.summary}${c.breaking ? " (may break things)" : ""}`)),
    ...(p.ideas.length ? [`Ideas it ships: ${p.ideas.join(", ")}`] : []),
    `Quality gate: ${gate.text ?? gate.status}`,
    ...(gate.reasons ?? []).map((r) => `  - ${r}`),
  ];
  return { code: 0, text: lines.join("\n"), data: { version: p.version, date: p.date, current: p.current, pending: p.pending.map((c) => c.id), ideas: p.ideas, gate } };
}

function shipIdeas(plan, root, ids, version, now) {
  const all = loadIdeas(root);
  const shipped = [];
  for (const id of ids) {
    const idea = all.find((i) => i.id === id);
    if (!idea || idea.status === "shipped") continue;
    const next = setIdeaStatus(idea, "shipped", { now, byRelease: true, version });
    planRecord(plan, "idea", next);
    shipped.push(next);
  }
  return all.map((i) => shipped.find((s) => s.id === i.id) ?? i);
}

export async function cut(ctx) {
  const config = loadConfig(ctx.repo);
  const p = proposal(ctx);
  const version = typeof ctx.flags.version === "string" ? ctx.flags.version.replace(/^v/, "") : p.version;
  const date = typeof ctx.flags.date === "string" ? ctx.flags.date : p.date;
  if (!parse(version)) throw usage(`"${version}" isn't a version like 1.2.0.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw usage("--date takes YYYY-MM-DD.");
  if (p.releases.some((r) => r.version === version)) throw refusal(`Version ${version} already exists.`);
  if (!p.pending.length && ctx.flags.empty !== true) throw refusal("Nothing to release: no changes are waiting. Add --empty to cut a release with no changes.");
  const gate = await releaseGate(ctx.repo, config);
  const overrides = gate.overridden;
  if (gate.status === "fail") return { code: 1, text: ["The release gate didn't pass:", ...gate.reasons.map((r) => `  - ${r}`), "Fix these first, or record an override with a reason (/syno:sigma)."].join("\n"), data: { gate } };
  const now = nowOf(ctx);
  const plan = new WritePlan(ctx.repo);
  const head = isRepo(ctx.repo) ? tryGit(["rev-parse", "HEAD"], { cwd: ctx.repo }) : null;
  const release = { schemaVersion: 1, version, date, status: "released", changes: p.pending.map(({ file, ...c }) => c), ideas: p.ideas, channels: [], git: head ? { tag: null, commit: head } : null, source: "syno", yanked: null, overrides };
  planRecord(plan, "release", release);
  for (const c of p.pending) plan.remove(recordPath("change", c));
  const ideas = shipIdeas(plan, ctx.repo, p.ideas, version, now);
  const snapshots = loadSnapshots(ctx.repo);
  const byDate = [...snapshots].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const previous = byDate.filter((s) => s.source === (head ? "git-tree" : "filesystem")).at(-1) ?? byDate.at(-1) ?? null;
  const snap = takeSnapshot(ctx.repo, config.chronicle, { id: version, date, ref: head, previous });
  planRecord(plan, "snapshot", snap);
  const manifests = findManifests(ctx.repo).map((m) => m.path);
  const intro = [`Release ${version}, dated ${readerDate(date)}, with ${p.pending.length} changes${p.ideas.length ? ` and ${p.ideas.length} ideas shipped` : ""}.`, ""];
  const after = ["", "Next, two optional steps, asked one at a time:", `  - bump the version to ${version} in ${manifests.join(", ") || "no manifest found"}`, `  - make a local tag ${config.chronicle.tagPrefix}${version} (Syno never pushes)`];
  const result = await finish(ctx, plan, config, loadState(ctx.repo), {
    intro,
    events: [{ type: "chronicle.release", data: { version, date, status: "released", changes: release.changes.length, ideas: p.ideas.length, overrides: overrides.length } }],
    data: { project: config.project.name, releases: [release, ...p.releases], pending: [], ideas, snapshots: [...snapshots, snap] },
    extra: { version, date, manifests },
  });
  return { ...result, text: result.data.applied ? `${result.text}${after.join("\n")}` : result.text };
}

function findRelease(root, version) {
  const r = loadReleases(root).find((x) => x.version === String(version ?? "").replace(/^v/, ""));
  if (!r) throw usage(`No release ${version}. Run /syno:status to see the releases.`);
  return r;
}

async function update(ctx, release, intro, event) {
  const config = loadConfig(ctx.repo);
  const plan = new WritePlan(ctx.repo);
  planRecord(plan, "release", release);
  const releases = loadReleases(ctx.repo).map((r) => (r.version === release.version ? release : r));
  return finish(ctx, plan, config, loadState(ctx.repo), { intro, events: event ? [event] : [], data: { project: config.project.name, releases, pending: loadChanges(ctx.repo), ideas: loadIdeas(ctx.repo), snapshots: loadSnapshots(ctx.repo) } });
}

export async function yank(ctx, [version]) {
  const reason = typeof ctx.flags.reason === "string" ? ctx.flags.reason.trim() : "";
  if (!reason) throw usage('Say why with --reason "...".');
  const r = findRelease(ctx.repo, version);
  const date = typeof ctx.flags.date === "string" ? ctx.flags.date : today(nowOf(ctx));
  return update(ctx, { ...r, status: "yanked", yanked: { date, reason } }, [`Mark ${r.version} as withdrawn on ${readerDate(date)}: ${reason}`, ""], { type: "chronicle.release", data: { version: r.version, status: "yanked" } });
}

export async function publish(ctx, [version, channel, status = "published", url]) {
  if (!channel) throw usage("Usage: publish <version> <channel> <planned|published|yanked> [url]");
  if (!["planned", "published", "yanked"].includes(status)) throw usage("The status is planned, published or yanked.");
  if (url && !/^https?:\/\/\S+$/i.test(url)) throw refusal(`Refused: "${url}" isn't an http or https link.`);
  const r = findRelease(ctx.repo, version);
  const date = typeof ctx.flags.date === "string" ? ctx.flags.date : status === "planned" ? null : today(nowOf(ctx));
  const entry = { channel, status, date, url: url ?? null, ...(typeof ctx.flags.notes === "string" ? { notes: ctx.flags.notes } : {}) };
  const channels = [...r.channels.filter((c) => c.channel !== channel), entry].sort((a, b) => (a.channel < b.channel ? -1 : 1));
  return update(ctx, { ...r, channels }, [`Record that ${r.version} is ${status} on ${channel}${url ? ` (${url})` : ""}.`, ""], { type: "chronicle.publish", data: { version: r.version, channel, status, date } });
}

/** Copy-ready release notes (CH-10). Prints only: no file, no network. */
export function notes(ctx, [version]) {
  const config = loadConfig(ctx.repo);
  const all = loadReleases(ctx.repo);
  const r = findRelease(ctx.repo, version);
  const previous = all[all.indexOf(all.find((x) => x.version === r.version)) + 1];
  const tag = (x) => x.git?.tag ?? `${config.chronicle.tagPrefix}${x.version}`;
  const ideas = loadIdeas(ctx.repo);
  const authors = [...new Set(r.changes.map((c) => c.author).filter(Boolean))].sort();
  const link = compareUrl(repoLinks(config.project.repoUrl), previous ? tag(previous) : null, tag(r));
  const lines = [`## ${r.version} — ${readerDate(r.date)}`, ""];
  if (r.summary) lines.push(r.summary, "");
  for (const t of TYPE_ORDER) {
    const list = r.changes.filter((c) => c.type === t);
    if (list.length) lines.push(`### ${t}`, ...list.map((c) => `- ${c.breaking ? "**BREAKING:** " : ""}${c.summary}`), "");
  }
  if (r.ideas.length) lines.push("### Ideas shipped", ...r.ideas.map((id) => `- ${id} ${ideas.find((i) => i.id === id)?.title ?? ""}`.trimEnd()), "");
  if (authors.length) lines.push("### Contributors", authors.join(", "), "");
  if (link) lines.push(`**Full changes:** ${link}`);
  return { code: 0, text: lines.join("\n").trimEnd(), data: { version: r.version, markdown: lines.join("\n").trimEnd() } };
}

/** Optional step 1 after a cut: the version in the manifests the owner picked (CH-05.6). */
export function bump(ctx, [version]) {
  const r = findRelease(ctx.repo, version);
  const found = findManifests(ctx.repo);
  const files = typeof ctx.flags.files === "string" ? ctx.flags.files.split(",").map((f) => f.trim()) : [];
  if (!files.length) return { code: 0, text: [`Manifests with a version: ${found.map((m) => `${m.path} (${m.version})`).join(", ") || "none"}.`, "Pick them with --files package.json,Cargo.toml"].join("\n"), data: { manifests: found } };
  const plan = new WritePlan(ctx.repo);
  for (const f of files) {
    const m = found.find((x) => x.path === f);
    if (!m) throw usage(`${f} has no version Syno can read.`);
    const next = bumpManifestText(f, readText(join(ctx.repo, f)), m.version, r.version);
    if (next === null) throw refusal(`Syno couldn't find the version in ${f} where it expected it, so it left the file alone.`);
    plan.write(f, next);
  }
  const result = plan.apply({ confirm: ctx.confirm });
  return { code: 0, text: describePlan(plan, result.applied), data: { applied: result.applied, ops: result.ops } };
}

/** Optional step 2 after a cut: a local annotated tag. Never pushed (CH-05.6). */
export async function tag(ctx, [version]) {
  const config = loadConfig(ctx.repo);
  const r = findRelease(ctx.repo, version);
  if (!isRepo(ctx.repo)) throw refusal("This folder has no git, so there's nothing to tag.");
  const name = `${config.chronicle.tagPrefix}${r.version}`;
  if (tryGit(["tag", "--list", name], { cwd: ctx.repo })) throw refusal(`The tag ${name} already exists.`);
  const commit = r.git?.commit ?? git(["rev-parse", "HEAD"], { cwd: ctx.repo });
  if (!ctx.confirm) return { code: 0, text: `Syno would make the local tag ${name} on commit ${commit.slice(0, 7)}. It never pushes.\nRun again with --confirm to make it.`, data: { applied: false, tag: name, commit } };
  git(["tag", "-a", name, "-m", `Release ${r.version}`, commit], { cwd: ctx.repo, allowTag: true });
  const result = await update(ctx, { ...r, git: { tag: name, commit } }, [`Made the local tag ${name}. Push it yourself when you're ready.`, ""]);
  return { ...result, data: { ...result.data, tag: name, commit } };
}
