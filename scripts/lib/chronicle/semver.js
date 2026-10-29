// Semantic Versioning 2.0.0 for Chronicle releases (PRD CH-05): parse, compare
// and propose the next version from pending changes. Pure functions.

const RE = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

/** "v1.2.3-rc.1+build" → { major, minor, patch, pre: ["rc", 1], build }; null when not SemVer. */
export function parse(text) {
  const m = RE.exec(String(text ?? "").trim());
  if (!m) return null;
  const pre = m[4] ? m[4].split(".").map((id) => (/^\d+$/.test(id) ? Number(id) : id)) : [];
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre, build: m[5] ?? null };
}

export const valid = (text) => parse(text) !== null;

/** Back to text, without the build part (Chronicle never stores build metadata). */
export const format = (v) => `${v.major}.${v.minor}.${v.patch}${v.pre.length ? `-${v.pre.join(".")}` : ""}`;

function comparePre(a, b) {
  if (!a.length && !b.length) return 0;
  if (!a.length) return 1;
  if (!b.length) return -1;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === undefined) return -1;
    if (b[i] === undefined) return 1;
    if (a[i] === b[i]) continue;
    const an = typeof a[i] === "number";
    const bn = typeof b[i] === "number";
    if (an && bn) return a[i] < b[i] ? -1 : 1;
    if (an !== bn) return an ? -1 : 1;
    return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

/** SemVer precedence: negative when a < b, 0 when equal, positive when a > b. */
export function compare(a, b) {
  const x = typeof a === "string" ? parse(a) : a;
  const y = typeof b === "string" ? parse(b) : b;
  for (const k of ["major", "minor", "patch"]) if (x[k] !== y[k]) return x[k] - y[k];
  return comparePre(x.pre, y.pre);
}

/** "major" | "minor" | "patch" from pending changes (CH-05.1). In 0.x a breaking change is a minor bump. */
export function bumpKind(changes, current) {
  const breaking = changes.some((c) => c.breaking);
  const zero = current ? parse(current).major === 0 : true;
  if (breaking) return zero ? "minor" : "major";
  if (changes.some((c) => c.type === "Added")) return "minor";
  return "patch";
}

function bump(v, kind) {
  if (kind === "major") return { major: v.major + 1, minor: 0, patch: 0, pre: [] };
  if (kind === "minor") return { major: v.major, minor: v.minor + 1, patch: 0, pre: [] };
  return { major: v.major, minor: v.minor, patch: v.patch + 1, pre: [] };
}

/**
 * Proposes the next version (CH-05.1, CH-05.2).
 *   current: the latest released version, or null for the first release
 *   changes: pending changes ({ type, breaking })
 *   pre:     "alpha" | "beta" | "rc" for a pre-release, or undefined
 *   first:   the version to propose for a first release (default "0.1.0")
 * A stable proposal never jumps a 0.x project to 1.0.0; the owner chooses that.
 */
export function nextVersion(current, changes, { pre, first = "0.1.0" } = {}) {
  if (!current) {
    const base = parse(first) ?? parse("0.1.0");
    return format(pre ? { ...base, pre: [pre, 1] } : { ...base, pre: [] });
  }
  const cur = parse(current);
  if (cur.pre.length && !pre) return format({ ...cur, pre: [] });
  if (cur.pre.length && pre) {
    const sameTag = cur.pre[0] === pre && typeof cur.pre[1] === "number";
    return format({ ...cur, pre: sameTag ? [pre, cur.pre[1] + 1] : [pre, 1] });
  }
  const next = bump(cur, bumpKind(changes, current));
  return format(pre ? { ...next, pre: [pre, 1] } : next);
}

/** Sorts version strings newest first; anything that isn't SemVer goes last. */
export const sortDesc = (versions) =>
  [...versions].sort((a, b) => {
    const pa = parse(a);
    const pb = parse(b);
    if (!pa || !pb) return pa ? -1 : pb ? 1 : 0;
    return compare(pb, pa);
  });
