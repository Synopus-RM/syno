// What 5S looks at (PRD S-14 rules 2 and 8). The project's files, as git sees
// them (tracked and untracked, ignored ones left out), or a plain walk outside
// git. Never .git, .syno, or anything outside the project. Reads only.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, posix } from "node:path";
import { sha256 } from "../fsutil.js";
import { isRepo, tryGit } from "../git.js";

const SKIP_DIRS = new Set([".git", ".syno", "node_modules", "dist", "build", ".next", "coverage", "target", ".venv", "__pycache__"]);
export const LARGE = 5 * 1024 * 1024;
const TEMP = /(\.(log|tmp|temp|bak|swp|swo|orig|rej)$|~$|(^|\/)\.DS_Store$|(^|\/)Thumbs\.db$|(^|\/)npm-debug\.log)/i;
const SOURCE = new Set([".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".py", ".css", ".scss", ".vue", ".svelte"]);
// Files that are entry points or picked up by a tool by name, so nothing imports them.
const ENTRY = /(^|\/)(index|main|app|server|cli|setup|manage|conftest|__init__)\.\w+$|\.config\.\w+$|\.(test|spec)\.\w+$|(^|\/)(test|tests|__tests__|e2e|bin|scripts|migrations|public|app|pages)\//;

const outside = (rel) => rel.split("/").some((part) => SKIP_DIRS.has(part));

/** Project files, relative and with forward slashes, sorted. */
export function projectFiles(root) {
  if (isRepo(root)) {
    const out = tryGit(["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: root }) ?? "";
    return [...new Set(out.split("\n").filter(Boolean))].filter((f) => !outside(f)).filter((f) => { try { return statSync(join(root, f)).isFile(); } catch { return false; } }).sort();
  }
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDirectory() && !SKIP_DIRS.has(e.name)) walk(rel);
      else if (e.isFile()) out.push(rel);
    }
  };
  walk("");
  return out.sort();
}

/** Folders with nothing in them (git can't track these, so they come from a walk). */
export function emptyFolders(root, ignored = () => false) {
  const out = [];
  const walk = (dir) => {
    const entries = readdirSync(join(root, dir), { withFileTypes: true });
    if (dir && !entries.length) out.push(dir);
    for (const e of entries) if (e.isDirectory() && !SKIP_DIRS.has(e.name)) walk(dir ? `${dir}/${e.name}` : e.name);
  };
  walk("");
  return out.filter((d) => !ignored(d)).sort();
}

/** Same bytes in more than one file: the first path (shortest, then A to Z) is kept. */
export function duplicates(root, files) {
  const byHash = new Map();
  for (const f of files) {
    const st = statSync(join(root, f));
    if (!st.size || st.size > LARGE) continue;
    const h = sha256(readFileSync(join(root, f)));
    byHash.set(h, [...(byHash.get(h) ?? []), f]);
  }
  return [...byHash.values()].filter((g) => g.length > 1).map((g) => g.sort((a, b) => a.length - b.length || (a < b ? -1 : 1))).map(([keep, ...extra]) => ({ keep, extra }));
}

/**
 * Source files no other file mentions by name, so probably unused. A guess, so
 * Sort lists them for the owner to check and never selects them on its own.
 */
export function unusedFiles(root, files) {
  const sources = files.filter((f) => SOURCE.has(extname(f)) && !ENTRY.test(f));
  const texts = files.filter((f) => SOURCE.has(extname(f)) || /\.(json|html|md|mdx|yml|yaml|toml)$/.test(f)).map((f) => [f, readFileSync(join(root, f), "utf8")]);
  return sources.filter((f) => {
    const stem = posix.basename(f, extname(f));
    const quoted = new RegExp(`["'\`(/]${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\.\\w+)?["'\`)]`);
    return !texts.some(([g, text]) => g !== f && quoted.test(text));
  });
}

/** Branches merged into the main branch, or idle for 30 days. Listed only; Syno never deletes a branch. */
export function staleBranches(root, now) {
  if (!isRepo(root)) return [];
  const main = ["main", "master"].find((b) => tryGit(["rev-parse", "--verify", "--quiet", `refs/heads/${b}`], { cwd: root }));
  if (!main) return [];
  const merged = new Set((tryGit(["for-each-ref", `--merged=refs/heads/${main}`, "--format=%(refname:short)", "refs/heads"], { cwd: root }) ?? "").split("\n").filter(Boolean));
  const rows = (tryGit(["for-each-ref", "--format=%(refname:short)\t%(committerdate:iso-strict)", "refs/heads"], { cwd: root }) ?? "").split("\n").filter(Boolean);
  return rows
    .map((r) => r.split("\t"))
    .filter(([name]) => name !== main)
    .map(([name, date]) => ({ name, merged: merged.has(name), idleDays: Math.floor((now - new Date(date)) / 86_400_000) }))
    .filter((b) => b.merged || b.idleDays >= 30);
}

/** Everything Sort finds, each with an id the owner can pick. */
export function sortFindings(root, now) {
  const files = projectFiles(root);
  const tracked = new Set(files);
  const out = [];
  for (const d of duplicates(root, files)) for (const f of d.extra) out.push({ id: `dup:${f}`, kind: "duplicate", path: f, why: `same bytes as ${d.keep}`, pick: true });
  for (const f of files.filter((x) => TEMP.test(x))) out.push({ id: `temp:${f}`, kind: "temp", path: f, why: "a temp, backup or log file", pick: true });
  const ignored = (d) => isRepo(root) && tryGit(["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "--", d], { cwd: root });
  for (const d of emptyFolders(root, ignored)) out.push({ id: `empty:${d}`, kind: "empty", path: d, why: "an empty folder", pick: true });
  for (const f of files.filter((x) => statSync(join(root, x)).size > LARGE)) out.push({ id: `large:${f}`, kind: "large", path: f, why: `${Math.round(statSync(join(root, f)).size / 1048576)} MB`, pick: false });
  for (const f of unusedFiles(root, files)) if (!out.some((o) => o.path === f)) out.push({ id: `unused:${f}`, kind: "unused", path: f, why: "no other file mentions it, so it is probably unused", pick: false });
  for (const b of staleBranches(root, now)) out.push({ id: `branch:${b.name}`, kind: "branch", path: b.name, why: b.merged ? "already merged into main" : `no commits for ${b.idleDays} days`, pick: false, listOnly: true });
  return { files: tracked.size, findings: out };
}
