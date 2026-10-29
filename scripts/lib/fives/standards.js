// 5S Standardize (PRD S-14 rule 5). Proposes .syno/5s/standards.json from what
// the project already does most (one naming style per kind of file), a
// 300-line file limit and the files every project needs, then checks the
// project against it. Every Syno function follows it when it creates files.
import { existsSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { readText } from "../fsutil.js";
import { globRe } from "./set.js";

const STYLES = {
  "kebab-case": /^[a-z0-9]+(-[a-z0-9]+)+$/,
  camelCase: /^[a-z][a-z0-9]*([A-Z][a-z0-9]*)+$/,
  snake_case: /^[a-z0-9]+(_[a-z0-9]+)+$/,
  PascalCase: /^([A-Z][a-z0-9]+){2,}$/,
};
const SINGLE = /^[a-z0-9]+$|^[A-Z][a-z0-9]+$/;
const CODE = /\.(js|mjs|cjs|jsx|ts|tsx|py|dart|vue|svelte|css|scss)$/;
const GROUPS = [
  { match: "**/*.{jsx,tsx,vue,svelte}", label: "components" },
  { match: "**/*.{js,mjs,cjs,ts}", label: "scripts" },
  { match: "**/*.py", label: "Python files" },
  { match: "**/*.dart", label: "Dart files" },
];

const stemOf = (f) => posix.basename(f).replace(/(\.(test|spec|config|d))?\.\w+$/, "");
export const styleOf = (stem) => Object.keys(STYLES).find((s) => STYLES[s].test(stem)) ?? (SINGLE.test(stem) ? "single" : "mixed");

/** A proposed standards file for this project. */
export function proposeStandards(root, files) {
  const naming = [];
  for (const g of GROUPS) {
    const re = globRe(g.match);
    const styles = files.filter((f) => re.test(f)).map((f) => styleOf(stemOf(f))).filter((s) => STYLES[s]);
    if (styles.length < 3) continue;
    const [style, n] = Object.entries(styles.reduce((a, s) => ({ ...a, [s]: (a[s] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1])[0];
    if (n / styles.length >= 0.6) naming.push({ match: g.match, style, why: `most ${g.label} here already use ${style} (${n} of ${styles.length})` });
  }
  const required = ["README.md", "LICENSE"];
  if (existsSync(join(root, ".env")) || files.some((f) => f === ".env.local") || /(^|\n)\.env/.test(readText(join(root, ".gitignore"), ""))) required.push(".env.example");
  return { schemaVersion: 1, naming, layout: [], maxLines: 300, required };
}

/** Where the project departs from its standards: naming, size and missing files. */
export function checkStandards(root, files, standards) {
  const naming = [];
  for (const rule of standards.naming ?? []) {
    const re = globRe(rule.match);
    for (const f of files.filter((x) => re.test(x))) {
      const style = styleOf(stemOf(f));
      if (STYLES[style] && style !== rule.style) naming.push({ path: f, why: `named in ${style}; the standard is ${rule.style}` });
    }
  }
  const max = standards.maxLines ?? 300;
  const size = files.filter((f) => CODE.test(f)).map((f) => ({ path: f, lines: readFileSync(join(root, f), "utf8").split("\n").length })).filter((x) => x.lines > max).map((x) => ({ path: x.path, why: `${x.lines} lines, over the ${max}-line limit` }));
  const missing = (standards.required ?? []).filter((f) => !existsSync(join(root, f))).map((f) => ({ path: f, why: "a required file is missing" }));
  const checked = files.length + (standards.required?.length ?? 0);
  return { naming, size, missing, checked };
}
