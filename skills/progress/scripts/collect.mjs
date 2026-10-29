#!/usr/bin/env node
// Syno Progress: ported from project-progress-report. Reads git and files only; it never fetches or writes outside --out.
// Collects raw, verifiable facts about a project's progress: git state and
// task checklists found in markdown files. Output is JSON for Claude to read
// and turn into a report. Never reads secret values (only .env key names).
//
// Usage: node collect.mjs [--root <dir>] [--out <file>] [--out-dir <name>]

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const startDir = path.resolve(args.root || process.cwd());
const OUT_DIR_NAME = args["out-dir"] || "progress-report";
const IGNORE_DIRS = new Set([
  ".git", "node_modules", ".next", "dist", "build", "out", "coverage", ".turbo",
  ".vercel", ".venv", "venv", "__pycache__", "target", "vendor", ".idea", ".vscode",
  OUT_DIR_NAME, ".claude", ".cache", ".syno",
]);
const MAX_MD_FILES = 200;
const MAX_CODE_FILES = 3000;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) out[key] = true;
      else { out[key] = next; i++; }
    }
  }
  return out;
}

function git(gitArgs, cwd = root) {
  try {
    return execFileSync("git", gitArgs, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function lines(s) {
  return s ? s.split(/\r?\n/).filter(Boolean) : [];
}

// ---------- Git ----------

const gitRoot = git(["rev-parse", "--show-toplevel"], startDir);
const root = gitRoot ? path.resolve(gitRoot) : startDir;

function collectGit() {
  if (!gitRoot) return { isRepo: false };

  const currentBranch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const remotes = lines(git(["remote"]));
  const remote = remotes.includes("origin") ? "origin" : remotes[0] || null;
  const remoteUrl = remote ? redactUrl(git(["remote", "get-url", remote])) : null;

  // Default branch: origin/HEAD, else main, else master, else current.
  let defaultBranch = null;
  if (remote) {
    const sym = git(["symbolic-ref", "--quiet", "--short", `refs/remotes/${remote}/HEAD`]);
    if (sym) defaultBranch = sym.replace(`${remote}/`, "");
  }
  const localBranches = lines(git(["for-each-ref", "--format=%(refname:short)", "refs/heads"]));
  if (!defaultBranch) {
    defaultBranch = ["main", "master", "trunk", "develop"].find((b) => localBranches.includes(b)) || currentBranch;
  }
  // Compare against the freshest known copy of the default branch.
  const remoteDefault = remote && git(["rev-parse", "--verify", "--quiet", `${remote}/${defaultBranch}`]) ? `${remote}/${defaultBranch}` : null;
  const baseRef = localBranches.includes(defaultBranch) ? defaultBranch : remoteDefault || defaultBranch;

  const lastFetch = (() => {
    const f = path.join(root, ".git", "FETCH_HEAD");
    try { return fs.statSync(f).mtime.toISOString(); } catch { return null; }
  })();

  // Working tree
  const porcelain = lines(git(["status", "--porcelain=v1", "--untracked-files=all"]))
    .filter((l) => !l.slice(3).replace(/"/g, "").startsWith(`${OUT_DIR_NAME}/`));
  const working = { staged: [], modified: [], untracked: [], conflicted: [] };
  for (const l of porcelain) {
    const x = l[0], y = l[1], file = l.slice(3);
    if (x === "?" && y === "?") working.untracked.push(file);
    else if (x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D")) working.conflicted.push(file);
    else {
      if (x !== " ") working.staged.push(file);
      if (y !== " ") working.modified.push(file);
    }
  }
  const cap = (a) => ({ count: a.length, files: a.slice(0, 40) });

  const stashCount = lines(git(["stash", "list"])).length;

  // Branches
  const mergedSet = new Set(lines(git(["branch", "--format=%(refname:short)", "--merged", baseRef])));
  const fmt = "%(refname:short)|%(objectname:short)|%(committerdate:iso-strict)|%(upstream:short)|%(upstream:track)|%(authorname)|%(subject)";
  const branches = lines(git(["for-each-ref", `--format=${fmt}`, "refs/heads"])).map((row) => {
    const [name, sha, date, upstream, track, author, ...subj] = row.split("|");
    const counts = name === baseRef ? null : git(["rev-list", "--left-right", "--count", `${baseRef}...${name}`]);
    const [behind, ahead] = counts ? counts.split(/\s+/).map(Number) : [0, 0];
    const upstreamGone = /gone/.test(track || "");
    const aheadUp = Number((track || "").match(/ahead (\d+)/)?.[1] || 0);
    const behindUp = Number((track || "").match(/behind (\d+)/)?.[1] || 0);
    const unmergedCommits = ahead > 0
      ? lines(git(["log", "--format=%h|%cs|%s", "-n", "8", `${baseRef}..${name}`])).map((c) => {
          const [h, d, ...s] = c.split("|");
          return { sha: h, date: d, subject: s.join("|") };
        })
      : [];
    return {
      name, isDefault: name === defaultBranch, isCurrent: name === currentBranch,
      lastCommit: { sha, date, author, subject: subj.join("|") },
      aheadOfDefault: ahead, behindDefault: behind,
      mergedIntoDefault: name !== defaultBranch && (mergedSet.has(name) || ahead === 0),
      upstream: upstream || null, pushed: !!upstream && !upstreamGone && aheadUp === 0,
      upstreamGone, aheadOfUpstream: aheadUp, behindUpstream: behindUp,
      unmergedCommits,
    };
  });

  // Remote-only branches (e.g. teammates' or PR branches not checked out locally)
  const remoteOnly = remote
    ? lines(git(["for-each-ref", "--format=%(refname:short)|%(committerdate:short)|%(subject)", `refs/remotes/${remote}`]))
        .map((r) => r.split("|"))
        .filter(([n]) => n !== `${remote}/HEAD` && n !== remote && !localBranches.includes(n.replace(`${remote}/`, "")))
        .map(([n, d, ...s]) => {
          const c = git(["rev-list", "--left-right", "--count", `${baseRef}...${n}`]);
          const [behind, ahead] = c ? c.split(/\s+/).map(Number) : [0, 0];
          return { name: n, date: d, subject: s.join("|"), aheadOfDefault: ahead, behindDefault: behind, mergedIntoDefault: ahead === 0 };
        })
    : [];

  const recentOnDefault = lines(git(["log", "--format=%h|%cs|%an|%s", "-n", "20", baseRef])).map((c) => {
    const [sha, date, author, ...s] = c.split("|");
    const subject = s.join("|");
    const pr = subject.match(/(?:Merge pull request #|\(#)(\d+)/)?.[1] || null;
    return { sha, date, author, subject, pr };
  });

  const totalCommits = Number(git(["rev-list", "--count", baseRef]) || 0);
  const firstCommitDate = lines(git(["log", "--reverse", "--format=%cs", baseRef]))[0] || null;
  const latestTag = git(["describe", "--tags", "--abbrev=0", baseRef]);
  const worktrees = lines(git(["worktree", "list", "--porcelain"]))
    .filter((l) => l.startsWith("worktree ")).map((l) => l.slice(9));

  return {
    isRepo: true, root, currentBranch, defaultBranch, baseRef, remote, remoteUrl, lastFetch,
    working: {
      clean: porcelain.length === 0,
      staged: cap(working.staged), modified: cap(working.modified),
      untracked: cap(working.untracked), conflicted: cap(working.conflicted),
    },
    stashCount, branches, remoteOnlyBranches: remoteOnly.slice(0, 40),
    recentOnDefault, totalCommitsOnDefault: totalCommits, firstCommitDate, latestTag, worktrees,
  };
}

function redactUrl(u) {
  // Strip any embedded credentials, e.g. https://user:token@host/...
  return u ? u.replace(/\/\/[^@/]+@/, "//") : u;
}

// ---------- File walk ----------

function walk(dir, depth, maxDepth, out, filter, limit) {
  if (depth > maxDepth || out.length >= limit) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (out.length >= limit) return;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!IGNORE_DIRS.has(e.name) && !e.name.startsWith(".")) walk(p, depth + 1, maxDepth, out, filter, limit);
      else if (e.name === ".github" || e.name === ".planning") walk(p, depth + 1, maxDepth, out, filter, limit);
    } else if (filter(e.name)) out.push(p);
  }
}

const rel = (p) => path.relative(root, p).split(path.sep).join("/");

// ---------- Task checklists in markdown ----------

const PLAN_NAME = /(prd|plan|todo|roadmap|task|progress|milestone|spec|backlog|checklist|requirements|agents|status)/i;

function collectTasks() {
  const mdFiles = [];
  walk(root, 0, 5, mdFiles, (n) => /\.(md|mdx|markdown)$/i.test(n), MAX_MD_FILES);
  const sources = [];
  for (const file of mdFiles) {
    let text;
    try { text = fs.readFileSync(file, "utf8"); } catch { continue; }
    const items = [];
    const headings = [];
    text.split(/\r?\n/).forEach((line, i) => {
      const h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) {
        headings.length = h[1].length - 1;
        headings[h[1].length - 1] = h[2].trim();
        return;
      }
      const m = line.match(/^(\s*)[-*+]\s+\[( |x|X|~|-|\/|>|!)\]\s+(.*)$/) || line.match(/^(\s*)\d+[.)]\s+\[( |x|X|~|-|\/|>|!)\]\s+(.*)$/);
      if (m) {
        const mark = m[2];
        const state = /[xX]/.test(mark) ? "done" : /[~\/>]/.test(mark) ? "in_progress" : mark === "-" ? "cancelled_or_partial" : mark === "!" ? "blocked" : "todo";
        items.push({
          line: i + 1, indent: m[1].length, state, text: m[3].trim(),
          section: headings.filter(Boolean).slice(-2).join(" › ") || null,
        });
      }
    });
    const status = text.match(/^\s*(?:\*\*)?status(?:\*\*)?\s*[:|]\s*(.+)$/im)?.[1]?.trim() || null;
    if (items.length || PLAN_NAME.test(path.basename(file))) {
      const tally = items.reduce((a, it) => ((a[it.state] = (a[it.state] || 0) + 1), a), {});
      sources.push({
        file: rel(file), looksLikePlan: PLAN_NAME.test(path.basename(file)), declaredStatus: status,
        modified: safeMtime(file), tally, items: items.slice(0, 400), truncated: items.length > 400,
      });
    }
  }
  // Plans first, then by number of checklist items
  sources.sort((a, b) => (b.looksLikePlan - a.looksLikePlan) || (b.items.length - a.items.length));
  return sources;
}

function safeMtime(f) {
  try { return fs.statSync(f).mtime.toISOString(); } catch { return null; }
}

// ---------- Code markers (TODO/FIXME/MANUAL) ----------

const CODE_EXT = /\.(js|jsx|ts|tsx|mjs|cjs|py|go|rs|java|kt|cs|rb|php|vue|svelte|sql|sh|ps1|yml|yaml|toml|css|scss|html)$/i;

function collectMarkers() {
  const files = [];
  walk(root, 0, 8, files, (n) => CODE_EXT.test(n), MAX_CODE_FILES);
  const markers = [];
  const re = /\b(TODO|FIXME|HACK|XXX|MANUAL|ACTION REQUIRED)\b[:(\s]\s*(.*)/;
  for (const f of files) {
    let text;
    try {
      if (fs.statSync(f).size > 400_000) continue;
      text = fs.readFileSync(f, "utf8");
    } catch { continue; }
    text.split(/\r?\n/).forEach((line, i) => {
      const m = line.match(re);
      if (m && markers.length < 150) markers.push({ file: rel(f), line: i + 1, kind: m[1], text: m[2].replace(/\*\/\s*$|-->\s*$/, "").trim().slice(0, 200) });
    });
  }
  return markers;
}

// ---------- Environment variables (names only) ----------

function envKeys(file) {
  try {
    return fs.readFileSync(file, "utf8").split(/\r?\n/)
      .map((l) => l.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1])
      .filter(Boolean);
  } catch { return null; }
}

function collectEnv() {
  const templates = [".env.example", ".env.sample", ".env.template", ".env.local.example", ".env.example.local"];
  const actuals = [".env", ".env.local", ".env.development", ".env.development.local", ".env.production", ".env.production.local"];
  const found = templates.map((t) => [t, envKeys(path.join(root, t))]).filter(([, k]) => k);
  if (!found.length) return { template: null };
  const present = new Set();
  const actualFiles = [];
  for (const a of actuals) {
    const k = envKeys(path.join(root, a));
    if (k) { actualFiles.push(a); k.forEach((x) => present.add(x)); }
  }
  const required = [...new Set(found.flatMap(([, k]) => k))];
  return {
    template: found.map(([t]) => t), localEnvFiles: actualFiles,
    requiredKeys: required, missingLocally: required.filter((k) => !present.has(k)),
    note: "Only key names were read; values were never read. Hosted/deploy env vars cannot be checked from here.",
  };
}

// ---------- Project metadata ----------

function collectProject() {
  let pkg = null;
  try { pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")); } catch {}
  const has = (f) => fs.existsSync(path.join(root, f));
  return {
    name: pkg?.name || path.basename(root),
    version: pkg?.version || null,
    description: pkg?.description || null,
    scripts: pkg?.scripts ? Object.keys(pkg.scripts) : [],
    ci: has(".github/workflows") ? fs.readdirSync(path.join(root, ".github/workflows")) : [],
    hasTests: ["test", "tests", "__tests__", "spec", "e2e"].some(has) || !!pkg?.scripts?.test,
  };
}

const previousHistory = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(root, OUT_DIR_NAME, "history.json"), "utf8")); } catch { return []; }
})();

const facts = {
  collectedAt: new Date().toISOString(),
  root,
  outputDir: path.join(root, OUT_DIR_NAME),
  project: collectProject(),
  git: collectGit(),
  taskSources: collectTasks(),
  codeMarkers: collectMarkers(),
  env: collectEnv(),
  previousReport: previousHistory.at(-1) || null,
};

const json = JSON.stringify(facts, null, 2);
if (args.out) {
  fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
  fs.writeFileSync(args.out, json);
  const g = facts.git;
  const items = facts.taskSources.reduce((n, s) => n + s.items.length, 0);
  console.log(`Facts written to ${args.out}`);
  console.log(`  git: ${g.isRepo ? `${g.currentBranch} (default ${g.defaultBranch}), ${g.branches.length} local branches, ${g.working.clean ? "clean" : "uncommitted changes"}` : "not a repository"}`);
  console.log(`  checklists: ${items} items in ${facts.taskSources.filter((s) => s.items.length).length} files; ${facts.taskSources.length} plan-like files`);
  console.log(`  code markers: ${facts.codeMarkers.length}; env missing locally: ${facts.env.missingLocally?.length ?? "n/a"}`);
} else {
  process.stdout.write(json);
}
