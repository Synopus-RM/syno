// Syno Sigma's part of the Syno hooks (PRD S-13 rule 2). After a Bash call in
// a Syno project, a test or build run is logged in .syno/local/runs.jsonl
// (git-ignored), whether or not Pulse is on. Only the kind, the result and the
// counts are kept: never the command or its output.
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { detect } from "../pulse/detect.js";
import { RUNS } from "./measure.js";

/** The nearest folder at or above `start` that has .syno/config.json, or null. */
export function projectRoot(start) {
  for (let dir = start, i = 0; i < 40; i++) {
    if (existsSync(join(dir, ".syno", "config.json"))) return dir;
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
  return null;
}

/** The run lines one Bash call adds (empty when it was neither a test nor a build). */
export function runLines(command, output, at) {
  return detect(command, output)
    .filter((f) => f.type === "test_run" || f.type === "build")
    .map((f) => (f.type === "test_run" ? { at, kind: "test", ok: f.data.ok, passed: f.data.passed, failed: f.data.failed } : { at, kind: "build", ok: f.data.ok }));
}

export function handle(event, input, env) {
  if (event !== "PostToolUse" || input.tool_name !== "Bash") return null;
  const root = projectRoot(env.cwd);
  if (!root) return null;
  const res = input.tool_response ?? {};
  const output = typeof res === "string" ? res : `${res.stdout ?? ""}\n${res.stderr ?? ""}`;
  const lines = runLines(input.tool_input?.command, output, env.now ?? new Date().toISOString());
  if (!lines.length) return null;
  const file = join(root, RUNS);
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, lines.map((l) => `${JSON.stringify(l)}\n`).join(""));
  return null;
}
