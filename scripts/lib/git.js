// The only module that starts git (PRD §5.2, §10). It runs read-only
// subcommands from an allowlist. The single write is a local annotated tag,
// and only when the caller passes the owner's yes. Anything else throws before
// git starts: no push, fetch, pull, checkout, stash, reset, commit, merge or rebase.
import { execFileSync } from "node:child_process";
import { refusal } from "./fsutil.js";

const READ_ONLY = new Set(["log", "show", "ls-tree", "ls-files", "rev-parse", "rev-list", "for-each-ref", "merge-base", "cat-file", "describe"]);
const CONFIG_KEYS = new Set(["user.name", "user.email", "remote.origin.url"]);
// Options that make a read-only command write a file, run a program or change config.
const FORBIDDEN_ARG = /^(--output|--exec|--upload-pack|--receive-pack|--config-env|--ext-diff|--textconv|-c$)/;

const refused = (args) => refusal(`Refused: git ${args.join(" ")} is not on Syno's read-only list.`);

/** Throws unless `args` is an allowed git invocation. Exported for the self-test. */
export function checkGitArgs(args, { allowTag = false } = {}) {
  const [cmd, ...rest] = args;
  if (rest.some((a) => FORBIDDEN_ARG.test(a))) throw refused(args);
  if (READ_ONLY.has(cmd)) return;
  const listing = rest.includes("--list") || rest.includes("-l");
  if (cmd === "tag" && listing && !rest.some((a) => ["-a", "-d", "-f", "--delete"].includes(a))) return;
  if (cmd === "tag" && rest[0] === "-a" && allowTag && !rest.includes("-f")) return;
  if (cmd === "diff" && rest.includes("--name-status")) return;
  if (cmd === "remote" && rest[0] === "get-url" && rest.length === 2) return;
  if (cmd === "config" && rest.length === 2 && rest[0] === "--get" && CONFIG_KEYS.has(rest[1])) return;
  if (cmd === "status" && rest[0] === "--porcelain") return;
  throw refused(args);
}

const ENV = { GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" };

/** Runs an allowed git command and returns its output without the final newline. Throws on failure. */
export function git(args, { cwd, allowTag = false } = {}) {
  checkGitArgs(args, { allowTag });
  const out = execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, ...ENV },
  });
  return out.replace(/\n$/, "");
}

/** Like `git`, but returns null when git fails (not a repo, unknown ref). Refusals still throw. */
export function tryGit(args, opts = {}) {
  checkGitArgs(args, opts);
  try {
    return git(args, opts);
  } catch {
    return null;
  }
}

export const isRepo = (cwd) => tryGit(["rev-parse", "--is-inside-work-tree"], { cwd }) === "true";

export const userName = (cwd) => tryGit(["config", "--get", "user.name"], { cwd }) || null;
