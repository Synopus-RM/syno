// Chunk 1.5: the code guards (PRD §5.2, §10, §12). Only Pulse's network module
// may open a connection; only git.js and run.js (plus listed ported code) may
// start a process; render code is pure; files stay under 300 lines and
// top-level functions under 60.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCRIPTS = join(ROOT, "scripts");
// Code Syno ships: its own scripts, the MCP server, and the tools inside skills that Claude runs.
const CODE_DIRS = ["scripts", "mcp", "skills"].map((d) => join(ROOT, d));

// Ported code keeps its own shape; each entry says why it is allowed.
export const NETWORK_ALLOWED = {
  "scripts/lib/pulse/net.js": "Syno Pulse, the only function that goes online",
  "skills/security/scripts/attack.mjs": "Syno Security's attack tests: this machine only, every URL checked before the first request (PRD S-16 rule 6)",
};
export const PROCESS_ALLOWED = {
  "scripts/lib/git.js": "read-only git from an allowlist",
  "scripts/lib/run.js": "project commands the owner approved",
  "scripts/lib/pulse/sender.js": "Syno Pulse sends in a detached process, so hooks stay under 100 ms",
  "scripts/governor/": "ported Workload Governor queue runner (gov run)",
  "skills/progress/scripts/collect.mjs": "Syno Progress reads git (read-only) to collect facts",
  "skills/tasks/scripts/collect.mjs": "Syno Tasks reads git (read-only) to collect facts",
};
export const SIZE_EXEMPT = { "scripts/governor/": "ported Workload Governor 0.2.0, kept as it was", "skills/": "tools ported with their skills, kept as they were" };
const PURE_DIRS = ["scripts/lib/report/", "scripts/lib/chronicle/render/"];

function codeFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...codeFiles(full));
    else if (/\.(c|m)?js$/.test(name)) out.push(full);
  }
  return out;
}

const files = () => CODE_DIRS.flatMap((d) => { try { return codeFiles(d); } catch { return []; } }).map((f) => ({ rel: relative(ROOT, f).split("\\").join("/"), text: readFileSync(f, "utf8") }));
const allowed = (list, rel) => Object.keys(list).some((k) => (k.endsWith("/") ? rel.startsWith(k) : rel === k));
// Strip comments so a word in a comment doesn't trip a guard.
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
const imports = (text, mods) => mods.some((m) => new RegExp(`(from\\s+|import\\(\\s*|require\\(\\s*)["'](node:)?${m}["']`).test(code(text)));

test("§5.2 only Pulse's network module opens connections", () => {
  const offenders = files()
    .filter(({ rel }) => !allowed(NETWORK_ALLOWED, rel))
    .filter(({ text }) => imports(text, ["http", "https", "http2", "net", "dgram", "tls"]) || /\b(fetch|WebSocket|XMLHttpRequest)\s*\(/.test(code(text)))
    .map(({ rel }) => rel);
  assert.deepEqual(offenders, []);
});

test("§10 only git.js, run.js and listed ported code start processes", () => {
  const offenders = files()
    .filter(({ rel }) => !allowed(PROCESS_ALLOWED, rel))
    .filter(({ text }) => imports(text, ["child_process", "worker_threads", "cluster"]) || /process\.binding\(/.test(code(text)))
    .map(({ rel }) => rel);
  assert.deepEqual(offenders, []);
});

test("§12 report and render code is pure: no file system, process or clock", () => {
  const offenders = files()
    .filter(({ rel }) => PURE_DIRS.some((d) => rel.startsWith(d)))
    .filter(({ text }) => imports(text, ["fs", "fs/promises", "child_process"]) || /Date\.now\(|new Date\(\s*\)|Math\.random\(/.test(code(text)))
    .map(({ rel }) => rel);
  assert.deepEqual(offenders, []);
});

test("§12 files stay under 300 lines", () => {
  const long = files()
    .filter(({ rel }) => !allowed(SIZE_EXEMPT, rel))
    .map(({ rel, text }) => ({ rel, lines: text.split("\n").length }))
    .filter(({ lines }) => lines > 300)
    .map(({ rel, lines }) => `${rel} (${lines})`);
  assert.deepEqual(long, []);
});

/** Top-level functions: from a line starting `function`/`export function` to the next line that is exactly "}". */
function longFunctions(rel, text) {
  const lines = text.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^(export\s+)?(async\s+)?function\b/.test(lines[i])) continue;
    const end = lines.findIndex((l, j) => j > i && l === "}");
    if (end > i && end - i + 1 > 60) out.push(`${rel}:${i + 1} (${end - i + 1} lines)`);
  }
  return out;
}

test("§12 top-level functions stay under 60 lines", () => {
  const long = files()
    .filter(({ rel }) => !allowed(SIZE_EXEMPT, rel))
    .flatMap(({ rel, text }) => longFunctions(rel, text));
  assert.deepEqual(long, []);
});

test("§5.2 the guards really catch a forbidden import", () => {
  assert.ok(imports('import https from "node:https";', ["https"]));
  assert.ok(imports("const cp = require('child_process');", ["child_process"]));
  assert.ok(!imports('// import https from "node:https";', ["https"]));
  assert.ok(/\bfetch\s*\(/.test(code("await fetch(url)")));
});
