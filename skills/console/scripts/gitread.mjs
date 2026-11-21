// The one Syno Console module that starts a process (PRD S-17, §5.2): it runs
// read-only git from an allowlist, the same list as Syno's own git.js, so a
// parent can check a child's branch before merging it. Merging, pushing and
// fetching are Claude's steps, never this module's.
import { execFileSync } from "node:child_process";
import { refusal } from "./model.mjs";

const READ_ONLY = new Set(["rev-parse", "merge-base", "log", "for-each-ref"]);
const FORBIDDEN_ARG = /^(--output|--exec|--upload-pack|--receive-pack|--config-env|--ext-diff|--textconv|-c$)/;
const ENV = { GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" };

/** Throws a refusal (exit 3) unless `args` is a read-only git call on the list. */
export function checkArgs(args) {
  const [cmd, ...rest] = args;
  const ok =
    !rest.some((a) => FORBIDDEN_ARG.test(a)) &&
    (READ_ONLY.has(cmd) || (cmd === "diff" && rest.includes("--name-status")) || (cmd === "remote" && rest[0] === "get-url" && rest.length === 2));
  if (!ok) throw refusal(`Refused: git ${args.join(" ")} is not on Syno Console's read-only list.`);
}

const run = (args, cwd) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...ENV } });

/** Runs an allowed git command and returns its output without the final newline. Throws when git fails. */
export function gitRead(args, { cwd } = {}) {
  checkArgs(args);
  return run(args, cwd).replace(/\n$/, "");
}

/** Like gitRead, but null when git fails (an unknown ref, not a repository). Refusals still throw. */
export function tryGitRead(args, opts = {}) {
  checkArgs(args);
  try {
    return gitRead(args, opts);
  } catch {
    return null;
  }
}

/** True when commit `a` is in the history of `b`. Git's "no" (exit 1) is false; any other failure throws. */
export function isAncestor(a, b, { cwd } = {}) {
  const args = ["merge-base", "--is-ancestor", a, b];
  checkArgs(args);
  try {
    run(args, cwd);
    return true;
  } catch (err) {
    if (err.status === 1) return false;
    throw err;
  }
}

/** `https://github.com/<owner>/<repo>` for create_session's source_url: no credentials, proxy host or `.git`. */
export function normaliseRepoUrl(url) {
  if (!url) return null;
  const ssh = /^[\w.-]+@([\w.-]+):(.+?)(\.git)?$/.exec(url);
  if (ssh) return `https://${ssh[1]}/${ssh[2]}`;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const path = parsed.pathname.replace(/\.git$/, "").replace(/\/+$/, "");
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname);
  if (local || parsed.hostname === "github.com") return `https://github.com/${path.split("/").filter(Boolean).slice(-2).join("/")}`;
  return `https://${parsed.host}${path}`;
}

/** The repository's own URL, normalised, or null outside a repository with an origin. */
export const repoUrl = (root) => normaliseRepoUrl(tryGitRead(["remote", "get-url", "origin"], { cwd: root }));
