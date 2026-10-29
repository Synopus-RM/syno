// 5S Set in Order (PRD S-14 rule 3): the layout against .syno/5s/standards.json.
// Each proposed move comes with the import changes it needs, in the same
// preview (AC-FS.3): files that import the moved file, and the moved file's own
// relative imports. Pure apart from reading files.
import { readFileSync } from "node:fs";
import { extname, join, posix } from "node:path";
import { readJson } from "../fsutil.js";

export const STANDARDS = ".syno/5s/standards.json";
const CODE = new Set([".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".vue", ".svelte"]);
const EXTS = [".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".json", ".vue", ".svelte"];
// import … from "./x", import("./x"), require("./x"), export … from "./x", import "./x.css"
const SPEC = /(\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)(["'])(\.{1,2}\/[^"'\n]+)\2/g;

export const loadStandards = (root) => readJson(join(root, STANDARDS));

/** A glob with *, **, ? and {a,b} as a RegExp over forward-slash paths. */
export function globRe(glob) {
  const token = { "**/": "(?:.*/)?", "**": ".*", "*": "[^/]*", "?": "[^/]", "{": "(?:", "}": ")", ",": "|" };
  const body = glob.split(/(\*\*\/|\*\*|\*|\?|\{|\}|,)/).map((part) => token[part] ?? part.replace(/[.+^$()|[\]\\]/g, "\\$&")).join("");
  return new RegExp(`^${body}$`);
}

/** The project file a relative specifier points at, or null. */
export function resolveSpec(fromFile, spec, files) {
  const base = posix.normalize(posix.join(posix.dirname(fromFile), spec));
  const tries = [base, ...EXTS.map((e) => base + e), ...EXTS.map((e) => `${base}/index${e}`)];
  return tries.find((t) => files.has(t)) ?? null;
}

/** The specifier from `fromFile` to `target`, written the way the old one was (with or without the extension). */
function specFor(fromFile, target, oldSpec, oldTarget) {
  let rel = posix.relative(posix.dirname(fromFile), target);
  if (!rel.startsWith(".")) rel = `./${rel}`;
  const hadExt = oldSpec.endsWith(extname(oldTarget)) && extname(oldTarget) !== "";
  const wasIndex = !hadExt && /\/index\.\w+$/.test(oldTarget) && !oldSpec.endsWith("/index");
  if (wasIndex) return rel.replace(/\/index\.\w+$/, "");
  return hadExt ? rel : rel.slice(0, rel.length - extname(rel).length);
}

/** Rewrites the relative imports in `text` (living at `oldPath`, now at `newPath`) given every move. */
function rewrite(text, oldPath, newPath, moves, files) {
  const changes = [];
  const out = text.replace(SPEC, (whole, head, q, spec) => {
    const target = resolveSpec(oldPath, spec, files);
    if (!target) return whole;
    const dest = moves.get(target) ?? target;
    if (dest === target && newPath === oldPath) return whole;
    const next = specFor(newPath, dest, spec, target);
    if (next === spec) return whole;
    changes.push(`${spec} → ${next}`);
    return `${head}${q}${next}${q}`;
  });
  return { text: out, changes };
}

/** Moves the standards ask for, each with its reason and every import change. */
export function proposeMoves(root, fileList, standards) {
  const files = new Set(fileList);
  const moves = new Map();
  const reasons = new Map();
  for (const rule of standards?.layout ?? []) {
    const re = globRe(rule.match);
    const dir = rule.dir.replace(/\/$/, "");
    for (const f of fileList) {
      if (!re.test(f) || f.startsWith(`${dir}/`) || moves.has(f)) continue;
      const to = `${dir}/${posix.basename(f)}`;
      if (files.has(to) || [...moves.values()].includes(to)) continue;
      moves.set(f, to);
      reasons.set(f, rule.why ?? `files matching ${rule.match} go in ${dir}/`);
    }
  }
  const edits = [];
  const moved = [];
  for (const f of fileList.filter((x) => CODE.has(extname(x)))) {
    const text = readFileSync(join(root, f), "utf8");
    const to = moves.get(f) ?? f;
    const r = rewrite(text, f, to, moves, files);
    if (moves.has(f)) moved.push({ from: f, to, content: r.changes.length ? r.text : undefined, changes: r.changes });
    else if (r.changes.length) edits.push({ path: f, content: r.text, changes: r.changes });
  }
  for (const [from, to] of moves) if (!moved.some((m) => m.from === from)) moved.push({ from, to, content: undefined, changes: [] });
  return { moves: moved.map((m) => ({ ...m, why: reasons.get(m.from) })).sort((a, b) => (a.from < b.from ? -1 : 1)), edits: edits.sort((a, b) => (a.path < b.path ? -1 : 1)) };
}
