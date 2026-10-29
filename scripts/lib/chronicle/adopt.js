// Adopting an existing repository (PRD CH-02). Adoption reads history and never
// changes it: tags, commits and an old CHANGELOG.md become release records,
// unreleased CHANGELOG entries become pending changes, and ROADMAP, IDEAS or
// BACKLOG bullets are offered as ideas. All git access is read-only (git.js).
import { join } from "node:path";
import { readText } from "../fsutil.js";
import { git, isRepo, tryGit } from "../git.js";
import { parseChangelog } from "./changelog-parse.js";
import { classifyCommit } from "./classify.js";
import { slugify, stamp } from "./records.js";
import { compare, format, parse } from "./semver.js";

const SEP = "\x1f";
const REC = "\x1e";
export const TAG_LIMIT = 50;

/** Every tag matching the tag pattern, oldest version first, plus the names that didn't match. */
export function readTags(root, tagPattern) {
  const out = tryGit(["for-each-ref", "--format=%(refname:strip=2)%09%(objectname)%09%(*objectname)%09%(creatordate:short)", "refs/tags"], { cwd: root });
  const tags = [];
  const unmatched = [];
  const re = new RegExp(tagPattern);
  for (const line of (out ?? "").split("\n").filter(Boolean)) {
    const [name, object, peeled, date] = line.split("\t");
    const version = parse(re.exec(name)?.[1] ?? "");
    if (version) tags.push({ tag: name, version: format(version), commit: peeled || object, date });
    else unmatched.push(name);
  }
  tags.sort((a, b) => compare(a.version, b.version));
  return { tags, unmatched };
}

/** Commits reachable from `to` but not `from` (or all of them), merges skipped (CH-02.2). */
export function commitsBetween(root, from, to) {
  const range = from ? `${from}..${to}` : to;
  const out = git(["log", "--no-merges", `--format=%H${SEP}%an${SEP}%ad${SEP}%s${SEP}%b${REC}`, "--date=format:%Y%m%d-%H%M%S", range], { cwd: root });
  return out
    .split(REC)
    .map((r) => r.replace(/^\n/, ""))
    .filter(Boolean)
    .map((r) => {
      const [sha, author, when, subject, body] = r.split(SEP);
      return { sha, author, stamp: when, created: `${when.slice(0, 4)}-${when.slice(4, 6)}-${when.slice(6, 8)}`, subject, body };
    });
}

function commitChange(c, recordAuthors) {
  const { type, breaking, summary } = classifyCommit(c.subject, c.body);
  return { schemaVersion: 1, id: `${c.stamp}-${slugify(summary, 30)}-${c.sha.slice(0, 7)}`, type, summary, breaking, ideas: [], links: [], author: recordAuthors ? c.author : null, created: c.created, commit: c.sha };
}

function entryChanges(entries, idStamp, created) {
  const seen = new Map();
  return entries.map((e) => {
    const slug = slugify(e.summary, 30);
    const n = (seen.get(slug) ?? 0) + 1;
    seen.set(slug, n);
    return { schemaVersion: 1, id: `${idStamp}-${slug}${n > 1 ? `-${n}` : ""}`, type: e.type, summary: e.summary, breaking: e.breaking, ideas: [], links: [], author: null, created, commit: null };
  });
}

function release(version, date, changes, extra) {
  return { schemaVersion: 1, version, date, status: "released", changes, ideas: [], channels: [], git: null, source: "adopted-tag", yanked: null, overrides: [], ...extra };
}

/** Releases from tags; a version the old CHANGELOG also describes keeps its hand-written entries. */
function tagReleases(root, tags, start, fromChangelog, recordAuthors) {
  const out = [];
  for (let i = start; i < tags.length; i++) {
    const t = tags[i];
    const written = fromChangelog.get(t.version);
    const date = written?.date ?? t.date;
    const changes = written
      ? entryChanges(written.entries, `${date.replace(/-/g, "")}-000000`, date)
      : commitsBetween(root, tags[i - 1]?.commit, t.commit).map((c) => commitChange(c, recordAuthors));
    const yanked = written?.yanked ? { status: "yanked", yanked: { date, reason: "Marked [YANKED] in the earlier CHANGELOG." } } : {};
    out.push(release(t.version, date, changes, { git: { tag: t.tag, commit: t.commit }, source: written ? "adopted-changelog" : "adopted-tag", ...yanked }));
  }
  return out;
}

/** ROADMAP, IDEAS or BACKLOG bullets the owner may import as ideas (CH-02.6). */
export function ideaCandidates(root) {
  const out = [];
  for (const file of ["ROADMAP.md", "IDEAS.md", "BACKLOG.md", "ROADMAP", "IDEAS", "BACKLOG"]) {
    for (const line of (readText(join(root, file), "") ?? "").split("\n")) {
      const m = /^\s*[-*]\s+(?:\[[ xX]\]\s+)?(.+?)\s*$/.exec(line);
      if (m && out.length < 200) out.push({ file, title: m[1].replace(/\s+/g, " ").slice(0, 120) });
    }
  }
  return out;
}

/**
 * Everything adoption would record, without writing anything:
 * { repo, releases (newest first), pending, earlier, ideas, changelog, tags }.
 */
export function adoptHistory(root, config, { all = false, now = new Date() } = {}) {
  const chron = config.chronicle;
  const repo = isRepo(root);
  const { tags, unmatched } = repo ? readTags(root, chron.tagPattern) : { tags: [], unmatched: [] };
  const start = all ? 0 : Math.max(0, tags.length - TAG_LIMIT);
  const changelogText = readText(join(root, chron.changelogPath));
  const cl = parseChangelog(changelogText ?? "");
  const written = new Map(cl.releases.map((r) => [format(parse(r.version)), r]));
  const releases = tagReleases(root, tags, start, written, chron.recordAuthors);
  const tagged = new Set(tags.map((t) => t.version));
  const earlier = cl.earlier ? [cl.earlier] : [];
  for (const [version, r] of written) {
    if (tagged.has(version)) continue;
    if (r.date) releases.push(release(version, r.date, entryChanges(r.entries, `${r.date.replace(/-/g, "")}-000000`, r.date), { source: "adopted-changelog", ...(r.yanked ? { status: "yanked", yanked: { date: r.date, reason: "Marked [YANKED] in the earlier CHANGELOG." } } : {}) }));
    else earlier.push(r.raw);
  }
  releases.sort((a, b) => compare(b.version, a.version));
  const today = stamp(now);
  return {
    repo,
    releases,
    pending: entryChanges(cl.unreleased, today, `${today.slice(0, 4)}-${today.slice(4, 6)}-${today.slice(6, 8)}`),
    earlier: earlier.join("\n\n"),
    ideas: ideaCandidates(root),
    changelog: { exists: changelogText !== null, region: cl.region, hasMarkers: cl.hasMarkers },
    tags: { total: tags.length, adopted: tags.length - start, unmatched, limited: start > 0 },
  };
}
