// 5S Shine (PRD S-14 rule 4): the project's own formatter, linter and type
// checker, run through Syno Governor only after the owner's yes. Syno counts
// the errors each one reports; it never changes the tools' settings.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { readJson, readText } from "../fsutil.js";

export const SHINE = ".syno/local/fives/shine.json";

function packageManager(root) {
  if (existsSync(join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(root, "yarn.lock"))) return "yarn";
  if (existsSync(join(root, "bun.lockb")) || existsSync(join(root, "bun.lock"))) return "bun";
  return "npm";
}

/** The checks this project already has, as [{ kind: "lint"|"format"|"types", command }]. */
export function shineCommands(root) {
  const out = [];
  const pkg = readJson(join(root, "package.json"));
  if (pkg) {
    const pm = packageManager(root);
    const scripts = pkg.scripts ?? {};
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const script = (...names) => names.find((n) => scripts[n]);
    const run = (name) => `${pm} run ${name}`;
    const lint = script("lint", "lint:check");
    if (lint) out.push({ kind: "lint", command: run(lint) });
    else if (deps.eslint) out.push({ kind: "lint", command: "npx eslint ." });
    else if (deps["@biomejs/biome"]) out.push({ kind: "lint", command: "npx biome check ." });
    const format = script("format:check", "check-format", "prettier:check");
    if (format) out.push({ kind: "format", command: run(format) });
    else if (deps.prettier) out.push({ kind: "format", command: "npx prettier --check ." });
    const types = script("typecheck", "type-check", "check-types", "tsc");
    if (types) out.push({ kind: "types", command: run(types) });
    else if (deps.typescript && existsSync(join(root, "tsconfig.json"))) out.push({ kind: "types", command: "npx tsc --noEmit" });
  }
  const pyproject = readText(join(root, "pyproject.toml"), "");
  if (/\bruff\b/.test(pyproject)) out.push({ kind: "lint", command: "ruff check ." }, { kind: "format", command: "ruff format --check ." });
  if (/\bmypy\b/.test(pyproject)) out.push({ kind: "types", command: "mypy ." });
  if (existsSync(join(root, "pubspec.yaml"))) out.push({ kind: "lint", command: "dart analyze" }, { kind: "format", command: "dart format --output=none --set-exit-if-changed ." });
  return out;
}

const COUNTS = [
  /✖\s+(\d+)\s+problems?/, // eslint
  /Found (\d+) errors?/, // tsc, ruff, biome, mypy
  /(\d+) errors? found/, // dart analyze
  /Code style issues found in (\d+) files?/, // prettier --check
  /(\d+) files? would be reformatted/, // ruff format, black
  /Changed (\d+) files?/, // dart format
];

/** How many errors one check reported: its count, else 0 on success and 1 on failure. */
export function errorCount(code, output) {
  for (const re of COUNTS) {
    const m = re.exec(output);
    if (m) return Number(m[1]);
  }
  return code === 0 ? 0 : 1;
}
