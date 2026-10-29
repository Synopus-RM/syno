// Syno Governor's part of the Syno hooks (PRD S-11, X-02). It calls the ported
// Governor hooks (CommonJS, in scripts/governor/hooks/) in this process and
// hands their replies to the dispatcher. While the standalone Workload
// Governor plugin is still enabled, Syno's Governor stays quiet so nothing is
// gated twice (AC-GO.2), and says so once, at session start.
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { readJson } from "../fsutil.js";

const require = createRequire(import.meta.url);
const HOOKS = { SessionStart: "session-start", UserPromptSubmit: "prompt-submit", PreToolUse: "pre-bash", SessionEnd: "session-end" };

/**
 * True when the standalone workload-governor plugin is enabled. Later settings
 * files win, as in Claude Code: user, then project, then project-local.
 */
export function standaloneEnabled(cwd, home = homedir()) {
  const files = [join(home, ".claude", "settings.json"), join(cwd, ".claude", "settings.json"), join(cwd, ".claude", "settings.local.json")];
  const merged = {};
  for (const file of files) Object.assign(merged, readJson(file, {})?.enabledPlugins ?? {});
  return Object.entries(merged).some(([id, on]) => on === true && id.startsWith("workload-governor@"));
}

export async function handle(event, input, env) {
  const name = HOOKS[event];
  if (!name) return null;
  if (standaloneEnabled(env.cwd)) {
    return event === "SessionStart" ? { lines: ["Governor: the standalone Workload Governor plugin is still enabled, so Syno's Governor stays quiet until it is retired (/syno:migrate)."] } : null;
  }
  const { run } = require(`../../governor/hooks/${name}.js`);
  const out = await run(input);
  if (!out) return null;
  const { permissionDecision, permissionDecisionReason, additionalContext } = out;
  return {
    ...(additionalContext ? { context: additionalContext } : {}),
    ...(permissionDecision ? { decision: { permissionDecision, permissionDecisionReason } } : {}),
  };
}
