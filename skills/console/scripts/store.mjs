// Syno Console's records (PRD S-17, design 5.11): the project root, the
// current branch, this session's role, the config group, the record folders
// and a write plan. Git is read through its files, so nothing here starts a
// process. Every write is planned first and applied only with the owner's yes
// (--confirm): atomic, inside the project root, skipped when unchanged.
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { LEVELS, idFromBranch, namesFor, parseId, refusal, withDefaults } from "./model.mjs";

export const RECORDS_DIR = ".syno/console";
export const ROLE_PATH = ".syno/local/console/role.json";
export const CONFIG_PATH = ".syno/config.json";
export const KINDS = { nodes: "nodes", decisions: "decisions", rules: "rules", questions: "questions", numbers: "numbers" };

export const jsonText = (value) => `${JSON.stringify(value, null, 2)}\n`;
const toPosix = (p) => p.split(sep).join("/");

export function readText(file) {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

export function readJson(file) {
  const text = readText(file);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** The nearest folder at or above `cwd` that holds `.git` (a folder, or a worktree's file), or null. */
export function findRoot(cwd) {
  let dir = resolve(cwd || ".");
  for (;;) {
    if (existsSync(join(dir, ".git"))) return dir;
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

function gitDir(root) {
  const dotGit = join(root, ".git");
  try {
    if (statSync(dotGit).isDirectory()) return dotGit;
    const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, "utf8"));
    return m ? resolve(root, m[1].trim()) : null;
  } catch {
    return null;
  }
}

/** The checked-out branch, read from HEAD; null when detached or not a repository. */
export function currentBranch(root) {
  const dir = root ? gitDir(root) : null;
  const head = dir ? readText(join(dir, "HEAD")) : null;
  const m = /^ref: refs\/heads\/(.+)$/m.exec(head ?? "");
  return m ? m[1].trim() : null;
}

/** The `console` config group with defaults, and the project's name for tags. */
export function loadConfig(root) {
  const raw = readJson(join(root, CONFIG_PATH)) ?? {};
  const cfg = withDefaults(raw.console);
  if (!cfg.project) cfg.project = raw.project?.name ?? basename(root);
  return cfg;
}

export function loadRole(root) {
  const role = readJson(join(root, ROLE_PATH));
  return role && LEVELS.includes(role.level) && parseId(role.id)?.id === role.id ? role : null;
}

/** This session's role: the role file when it is there, else worked out from the branch name. */
export function resolveRole(root, cfg) {
  const saved = loadRole(root);
  if (saved) return { ...saved, inferred: false };
  const id = idFromBranch(currentBranch(root), cfg);
  if (!id) return null;
  const n = namesFor(id, "", cfg);
  return { level: n.level, id: n.id, branch: n.branch, parentId: n.parentId, parentBranch: n.parentBranch, inferred: true };
}

/** Every readable record of one kind, in file-name order; unreadable files are listed, never thrown. */
export function listRecords(root, kind) {
  const rel = `${RECORDS_DIR}/${KINDS[kind] ?? kind}`;
  let names = [];
  try {
    names = readdirSync(join(root, rel)).filter((f) => f.endsWith(".json")).sort();
  } catch {
    return { records: [], skipped: [] };
  }
  const records = [];
  const skipped = [];
  for (const name of names) {
    const value = readJson(join(root, rel, name));
    if (value && typeof value === "object" && !Array.isArray(value)) records.push(value);
    else skipped.push(`${rel}/${name}`);
  }
  return { records, skipped };
}

/** The next free number in a series (`D-0004`); gaps are never filled, so a number is never reused. */
export function nextNumber(records, prefix) {
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  const max = records.reduce((m, r) => Math.max(m, Number(re.exec(r?.id ?? "")?.[1] ?? 0)), 0);
  return `${prefix}-${String(max + 1).padStart(4, "0")}`;
}

/** Sets the `console` group over what is there, keeping every other key of `.syno/config.json`. */
export function mergeConsoleConfig(existingText, group) {
  let config = {};
  try {
    config = existingText ? JSON.parse(existingText) : {};
  } catch {
    config = {};
  }
  config.console = { ...(config.console ?? {}), ...group };
  return jsonText(config);
}

const escapes = (rel) => rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);

function insideRoot(root, target) {
  const base = realpathSync(root);
  const full = resolve(base, target);
  if (escapes(relative(base, full))) throw refusal(`Refused: ${target} is outside the project.`);
  let probe = full;
  while (!existsSync(probe)) probe = dirname(probe);
  if (escapes(relative(base, realpathSync(probe)))) throw refusal(`Refused: ${target} leads outside the project through a link.`);
  return full;
}

/** The owner-decides rule: collect writes, show them, apply them only with confirm. */
export class Plan {
  constructor(root) {
    this.root = root;
    this.ops = [];
  }

  write(rel, text) {
    const full = insideRoot(this.root, rel);
    const current = readText(full);
    if (current !== text) this.ops.push({ op: current === null ? "create" : "update", path: toPosix(rel), text });
    return this;
  }

  get empty() {
    return this.ops.length === 0;
  }

  describe() {
    return this.ops.map(({ op, path }) => `${op.padEnd(7)} ${path}`);
  }

  apply({ confirm }) {
    const ops = this.ops.map(({ op, path }) => ({ op, path }));
    if (!confirm || this.empty) return { applied: false, ops };
    for (const { path, text } of this.ops) {
      const full = insideRoot(this.root, path);
      mkdirSync(dirname(full), { recursive: true });
      const tmp = `${full}.${randomBytes(4).toString("hex")}.tmp`;
      writeFileSync(tmp, text);
      renameSync(tmp, full);
    }
    return { applied: true, ops };
  }
}

/** The plan in plain words, for the preview and the result. */
export function describeWrites(plan, applied) {
  if (plan.empty) return "No files would change.";
  const head = applied ? "Syno wrote these files:" : "Syno would write these files (nothing is written until you confirm):";
  return [head, ...plan.describe().map((l) => `  ${l}`), ...(applied ? [] : ["Run again with --confirm to write them."])].join("\n");
}
