// Finds and bumps the version in a project's manifest (PRD CH-01.2, CH-02.4,
// CH-05.6). Manifests are read as text, never executed: JSON is parsed, every
// other format is matched line by line.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { readText } from "../fsutil.js";

const Q = `["']`;
// Each entry: a file name (or a pattern for one), and the pattern whose first group is the version.
const KINDS = [
  { file: "package.json", json: "version" },
  { file: "pyproject.toml", line: new RegExp(`^version\\s*=\\s*${Q}([^"']+)${Q}`, "m") },
  { file: "Cargo.toml", line: new RegExp(`^\\[package\\][\\s\\S]*?^version\\s*=\\s*${Q}([^"']+)${Q}`, "m") },
  { file: "pom.xml", line: /<\/(?:parent|modelVersion)>[\s\S]*?<version>([^<]+)<\/version>/ },
  { file: "build.gradle", line: new RegExp(`^version\\s*=?\\s*${Q}([^"']+)${Q}`, "m") },
  { file: "build.gradle.kts", line: new RegExp(`^version\\s*=\\s*${Q}([^"']+)${Q}`, "m") },
  { file: "pubspec.yaml", line: /^version:\s*["']?([^\s"'#]+)/m },
  { match: /\.csproj$/, line: /<Version>([^<]+)<\/Version>/ },
  { file: "composer.json", json: "version" },
  { file: "mix.exs", line: new RegExp(`version:\\s*${Q}([^"']+)${Q}`) },
  { match: /\.gemspec$/, line: new RegExp(`\\.version\\s*=\\s*${Q}([^"']+)${Q}`) },
  { file: "VERSION", line: /^\s*v?([0-9][^\s]*)\s*$/m },
];

function readVersion(kind, text) {
  if (kind.json) {
    try {
      const value = JSON.parse(text)[kind.json];
      return typeof value === "string" ? value : null;
    } catch {
      return null;
    }
  }
  return kind.line.exec(text)?.[1]?.trim() ?? null;
}

function candidates(root) {
  let names = [];
  try {
    names = readdirSync(root).sort();
  } catch {
    return [];
  }
  const out = [];
  for (const kind of KINDS) {
    if (kind.file && names.includes(kind.file)) out.push({ kind, path: kind.file });
    if (kind.match) for (const n of names.filter((x) => kind.match.test(x))) out.push({ kind, path: n });
  }
  return out;
}

/** Every manifest in the project root that holds a version: [{ path, version }], in PRD order. */
export function findManifests(root) {
  return candidates(root)
    .map(({ kind, path }) => ({ path, version: readVersion(kind, readText(join(root, path), "")) }))
    .filter((m) => m.version);
}

/** The first manifest with a version, or null (CH-02.4). */
export const detectManifest = (root) => findManifests(root)[0] ?? null;

/**
 * Returns the manifest text with `from` replaced by `to` at the version's own
 * place only, or null when that version isn't where Syno expects it.
 */
export function bumpManifestText(path, text, from, to) {
  const kind = KINDS.find((k) => (k.file ? k.file === path.split("/").pop() : k.match.test(path)));
  if (!kind || readVersion(kind, text) !== from) return null;
  if (kind.json) {
    const re = new RegExp(`("${kind.json}"\\s*:\\s*")${from.replace(/[.+]/g, "\\$&")}(")`);
    return re.test(text) ? text.replace(re, `$1${to}$2`) : null;
  }
  const m = kind.line.exec(text);
  const start = m.index + m[0].lastIndexOf(m[1]);
  return `${text.slice(0, start)}${to}${text.slice(start + m[1].length)}`;
}
