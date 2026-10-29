// Chronicle's part of the Syno hooks (PRD CH-12). At session start, a few
// lines for the Syno brief: the version, waiting changes, ideas in progress,
// unrecorded tags. After a successful `git tag` in Bash (or `git commit`,
// when nudges are "commits"), a one-line nudge. Silent where Syno isn't set
// up. Fails open: the dispatcher catches any error.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { isRepo } from "../git.js";
import { readTags } from "./adopt.js";
import { CONFIG_PATH, loadConfig } from "./config.js";
import { loadChanges, loadIdeas, loadReleases } from "./records.js";

// `git tag v1.2.0` or `git tag -a v1.2.0 -m …`, but not listing, deleting or verifying tags.
const TAG = /(^|[;&|]\s*)git\s+tag(?![^;&|]*\s(?:-l|--list|-d|--delete|-v|--verify)\b)\s+\S/;
const COMMIT = /(^|[;&|]\s*)git\s+commit\b/;
const failed = (res) => /\b(fatal|error):/i.test(String(res?.stderr ?? "")) || res?.interrupted === true;

function brief(cwd) {
  const config = loadConfig(cwd);
  const releases = loadReleases(cwd);
  const pending = loadChanges(cwd).length;
  const doing = loadIdeas(cwd).filter((i) => i.status === "in-progress").length;
  const latest = releases[0];
  const lines = [`Chronicle: ${latest ? `version ${latest.version}` : "no release yet"} · ${pending} changes waiting · ${doing} ideas in progress.`];
  if (isRepo(cwd)) {
    const known = new Set(releases.map((r) => r.version));
    const fresh = readTags(cwd, config.chronicle.tagPattern).tags.filter((t) => !known.has(t.version));
    if (fresh.length) lines.push(`Chronicle: ${fresh.length} version tag${fresh.length === 1 ? "" : "s"} not recorded yet (${fresh.map((t) => t.tag).join(", ")}). Offer /syno:sync.`);
  }
  return lines;
}

export function handle(event, input, env) {
  const cwd = env.cwd;
  if (!existsSync(join(cwd, CONFIG_PATH))) return null;
  if (event === "SessionStart") return { lines: brief(cwd) };
  if (event !== "PostToolUse" || input.tool_name !== "Bash") return null;
  const nudges = loadConfig(cwd)?.chronicle.nudges ?? "tags";
  const command = String(input.tool_input?.command ?? "");
  if (nudges === "off" || failed(input.tool_response)) return null;
  if (TAG.test(command)) return { context: "Syno Chronicle: a git tag was just made. Offer to record it as a release with /syno:sync (one line, Record or Skip)." };
  if (nudges === "commits" && COMMIT.test(command)) return { context: "Syno Chronicle: a commit was just made. If it finished a feature or fix, offer one change entry (Record, Edit or Skip)." };
  return null;
}
