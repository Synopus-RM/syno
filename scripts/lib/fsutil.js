// Every file Syno writes goes through here (PRD §5.1, §10). Writes are planned
// first, shown to the owner, and applied only with --confirm. Each write is
// atomic (temp file, then rename) and must stay inside the project root, never
// through a link that leads out of it. The shared CLI errors live here too, so
// every module refuses the same way.
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";

export const EXIT = { OK: 0, FAILED: 1, USAGE: 2, REFUSED: 3 };

/** A refusal: the request is understood but not allowed (exit 3). */
export const refusal = (message) => Object.assign(new Error(message), { exit: EXIT.REFUSED });

/** A usage error: the request itself is malformed (exit 2). */
export const usage = (message) => Object.assign(new Error(message), { exit: EXIT.USAGE });

/** Paths in stored records always use forward slashes (PRD §12). */
export const toPosix = (p) => p.split(sep).join("/");

/** Stable JSON text: 2-space indent, LF line endings, trailing newline. */
export const jsonText = (value) => `${JSON.stringify(value, null, 2)}\n`;

export function readText(file, fallback = null) {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return fallback;
  }
}

export function readJson(file, fallback = null) {
  const text = readText(file);
  if (text === null) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

const escapes = (rel) => rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);

/** Resolves `target` under `root`, refusing anything outside it, including through a symlink. */
export function insideRoot(root, target) {
  const base = realpathSync(root);
  const full = resolve(base, target);
  if (escapes(relative(base, full))) throw refusal(`Refused: ${target} is outside the project.`);
  let probe = full;
  while (!existsSync(probe)) probe = dirname(probe);
  if (escapes(relative(base, realpathSync(probe)))) {
    throw refusal(`Refused: ${target} leads outside the project through a link.`);
  }
  return full;
}

/** Writes through a temp file and a rename, so a crash never leaves half a file. */
export function atomicWrite(file, content) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, content);
  renameSync(tmp, file);
}

/**
 * The owner-decides rule in code. A plan collects every file a command would
 * create, update or remove; `describe()` is the preview; `apply()` writes only
 * when the caller passes the owner's yes (`--confirm`). Writes that would leave
 * a file unchanged are dropped, so running a command twice changes nothing.
 */
export class WritePlan {
  constructor(root) {
    this.root = root;
    this.ops = [];
  }

  write(path, content) {
    const full = insideRoot(this.root, path);
    const current = readText(full);
    if (current === content) return this;
    this.ops.push({ op: current === null ? "create" : "update", path: toPosix(path), content });
    return this;
  }

  /** Removes one of Syno's own records. Project files are never removed (5S moves them to a trash). */
  remove(path) {
    const rel = toPosix(path);
    if (!rel.startsWith(".syno/") || rel.startsWith(".syno/trash/")) {
      throw refusal(`Refused: Syno only removes its own records under .syno/, not ${rel}.`);
    }
    const full = insideRoot(this.root, path);
    if (existsSync(full)) this.ops.push({ op: "remove", path: rel });
    return this;
  }

  get empty() {
    return this.ops.length === 0;
  }

  describe() {
    if (this.empty) return ["No files would change."];
    return this.ops.map(({ op, path }) => `${op.padEnd(7)} ${path}`);
  }

  apply({ confirm }) {
    if (!confirm || this.empty) return { applied: false, ops: this.ops.map(({ op, path }) => ({ op, path })) };
    for (const { op, path, content } of this.ops) {
      const full = insideRoot(this.root, path);
      if (op === "remove") rmSync(full, { force: true });
      else atomicWrite(full, content);
    }
    return { applied: true, ops: this.ops.map(({ op, path }) => ({ op, path })) };
  }
}
