// Syno Console's part of the Syno hooks (PRD S-17, X-02): one brief line at
// session start for a session in a Syno tree, and the guard before the
// question dialog, plan mode, session tools and Bash. When the project has
// the cloud copy's own hook, this handler stays quiet, so nothing is guarded
// twice (as the Governor does, AC-GO.2). Reads only; fails open.
import { join } from "node:path";
import { readText } from "../fsutil.js";
import { pushedCheck } from "../../../skills/console/scripts/gitread.mjs";
import { judge } from "../../../skills/console/scripts/guard.mjs";
import { namesFor } from "../../../skills/console/scripts/model.mjs";
import { currentBranch, findRoot, listRecords, loadConfig, resolveRole } from "../../../skills/console/scripts/store.mjs";

const CLOUD_COPY = "syno-console/scripts/console.mjs";

/** True when .claude/settings.json already runs the cloud copy's hook. */
export const cloudCopyActive = (root) => (readText(join(root, ".claude", "settings.json")) ?? "").includes(CLOUD_COPY);

function briefLine(root, role, cfg) {
  if (role.inferred) return `Console: this checkout's branch belongs to ${role.id}, but this session hasn't joined its Syno tree yet. Run the join command from its role card (or start, in the Console) first.`;
  if (role.level === "console") {
    const open = listRecords(root, "questions").records.filter((q) => q.status === "open").length;
    return `Console: this is Syno Console; ${open} open question(s). /syno:console status shows the tree.`;
  }
  const { title } = namesFor(role.id, role.name ?? "", cfg);
  return `Console: you are ${title} (${role.level}). Questions go up as [SYNO question]; push only ${role.branch}.`;
}

export function handle(event, input, env) {
  if (event !== "SessionStart" && event !== "PreToolUse") return null;
  const root = findRoot(input?.cwd || env.cwd);
  if (!root || cloudCopyActive(root)) return null;
  const cfg = loadConfig(root);
  const role = resolveRole(root, cfg);
  if (!role) return null;
  if (event === "SessionStart") return { lines: [briefLine(root, role, cfg)] };
  const decision = judge(input, { role, cfg, nodes: listRecords(root, "nodes").records, currentBranch: currentBranch(root), isPushed: pushedCheck(root, role.branch) });
  return decision ? { decision } : null;
}
