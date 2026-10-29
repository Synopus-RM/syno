// The only module besides git.js that starts a process (PRD §5.2, §10). It runs
// a project's own command (formatter, audit tool, test runner) only when the
// caller passes the owner's yes, and routes it through Syno Governor's queue
// when the Governor is available, so it counts against the device budget.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { refusal } from "./fsutil.js";

const WIN = process.platform === "win32";
const BUNDLED_GOV = fileURLToPath(new URL("../governor/gov.js", import.meta.url));

/** Where the Governor's CLI is: Syno's own copy first, then `gov` on PATH. Null when neither exists. */
export function findGov() {
  if (existsSync(BUNDLED_GOV)) return { file: process.execPath, pre: [BUNDLED_GOV] };
  const probe = spawnSync(WIN ? "where" : "which", ["gov"], { encoding: "utf8" });
  const path = probe.status === 0 ? probe.stdout.split(/\r?\n/)[0].trim() : "";
  return path ? { file: path, pre: [] } : null;
}

/**
 * Runs `command` in `cwd` after the owner's yes. With the Governor, it waits in
 * the shared queue (`gov run`); without it, it runs directly in the shell.
 * Returns { code, stdout, stderr, queued }.
 */
export function runApproved(command, { approved, cwd, label = "syno", timeoutMs } = {}) {
  if (approved !== true) throw refusal(`Refused: "${command}" needs the owner's yes before it runs.`);
  const gov = findGov();
  const [file, args] = gov
    ? [gov.file, [...gov.pre, "run", "--label", label, "--", command]]
    : WIN
      ? ["cmd.exe", ["/d", "/s", "/c", command]]
      : ["/bin/sh", ["-c", command]];
  const res = spawnSync(file, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });
  return { code: res.status ?? 1, stdout: res.stdout ?? "", stderr: res.stderr ?? "", queued: Boolean(gov) };
}
