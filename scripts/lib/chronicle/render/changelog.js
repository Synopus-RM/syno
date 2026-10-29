// CHANGELOG.md in Keep a Changelog 1.1.0 form (PRD CH-09, §7). Syno writes
// only between <!-- syno:start --> and <!-- syno:end -->; every byte outside
// the markers stays as it was. Pure: records and the old text come in.
import { END, START } from "../changelog-parse.js";

export const TYPE_ORDER = ["Added", "Changed", "Deprecated", "Removed", "Fixed", "Security"];

const HEADER = `# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`;

const esc = (s) => String(s).replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r?\n/g, " ");
const byCreated = (a, b) => (a.created < b.created ? -1 : a.created > b.created ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** "git@github.com:o/r.git" or "https://github.com/o/r.git" → { host, base } for compare links; null otherwise. */
export function repoLinks(repoUrl) {
  const m = /^(?:https?:\/\/|git@|ssh:\/\/git@)([^/:]+)[/:](.+?)(?:\.git)?\/?$/.exec(String(repoUrl ?? ""));
  if (!m) return null;
  const host = /github/.test(m[1]) ? "github" : /gitlab/.test(m[1]) ? "gitlab" : /bitbucket/.test(m[1]) ? "bitbucket" : null;
  return host ? { host, base: `https://${m[1]}/${m[2]}` } : null;
}

export function compareUrl(links, from, to) {
  if (!links) return null;
  if (!from) return links.host === "bitbucket" ? `${links.base}/src/${to}` : links.host === "gitlab" ? `${links.base}/-/tags/${to}` : `${links.base}/releases/tag/${to}`;
  if (links.host === "gitlab") return `${links.base}/-/compare/${from}...${to}`;
  if (links.host === "bitbucket") return `${links.base}/branches/compare/${to}%0D${from}`;
  return `${links.base}/compare/${from}...${to}`;
}

function entries(changes) {
  const out = [];
  for (const type of TYPE_ORDER) {
    const list = changes.filter((c) => c.type === type).sort(byCreated);
    if (!list.length) continue;
    out.push(`### ${type}`, "", ...list.map((c) => `- ${c.breaking ? "**BREAKING:** " : ""}${esc(c.summary)}`), "");
  }
  return out;
}

const tagOf = (release, prefix) => release.git?.tag ?? `${prefix}${release.version}`;

/** The managed block: [Unreleased], each release newest first, Earlier history, compare links. */
export function changelogBlock({ releases, pending, earlier = "", repoUrl = null, tagPrefix = "v" }) {
  const lines = [START, "## [Unreleased]", "", ...entries(pending)];
  for (const r of releases) {
    lines.push(`## [${r.version}] - ${r.date}${r.status === "yanked" ? " [YANKED]" : ""}`, "");
    if (r.summary) lines.push(esc(r.summary), "");
    lines.push(...entries(r.changes));
  }
  if (earlier.trim()) lines.push("## Earlier history", "", earlier.trim(), "");
  const links = repoLinks(repoUrl);
  if (links) {
    const tags = releases.map((r) => tagOf(r, tagPrefix));
    lines.push(`[Unreleased]: ${tags.length ? compareUrl(links, tags[0], "HEAD") : links.base}`);
    releases.forEach((r, i) => lines.push(`[${r.version}]: ${compareUrl(links, tags[i + 1] ?? null, tags[i])}`));
  }
  lines.push(END);
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n")}`;
}

/**
 * The whole CHANGELOG.md. `existing` is the current text (or null) and `region`
 * comes from parseChangelog(existing). With no file, Syno writes a standard
 * header; with a hand-written file, the block replaces only the parsed region.
 */
export function renderChangelog(data, existing = null, region = null) {
  const block = changelogBlock(data);
  if (existing === null) return `${HEADER}${block}\n`;
  if (!region) return `${existing.replace(/\s*$/, "\n\n")}${block}\n`;
  const after = existing.slice(region.end);
  return `${existing.slice(0, region.start)}${block}${after || "\n"}`;
}
