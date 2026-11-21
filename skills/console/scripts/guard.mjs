// Syno Console's guard (PRD S-17, design 5.8): one PreToolUse check for every
// session in a Syno tree. Below the Console it refuses the question dialog and
// plan mode; at every level it refuses a push (git or GitHub tools) to any
// branch but the session's own, a session outside its own part of the tree or
// without a role card, archiving a child whose merge isn't recorded and pushed,
// and merging pull requests; below the Console it keeps the Console's records
// and the guard's own files from Edit and Write. A session whose role was only
// worked out from its branch is held until it joins. Pure: the caller passes
// the role, config, node records and a pushed-check in. Outside a tree (no
// role) it has no opinion, and on input it can't read it allows the call.
import { idFromBranch, namesFor, parseId } from "./model.mjs";
import { mergesPr, parsePushes, shellStrings, touchesRemote } from "./shell.mjs";

export { parsePushes } from "./shell.mjs";
export const MARKER = "SYNO ROLE CARD";
const MCP_TOOLS = "create_session|archive_session|merge_pull_request|enable_pr_auto_merge|update_pull_request_branch|push_files|create_or_update_file|delete_file|create_branch";
/** Tools the plugin's dispatcher adds to its existing Bash entry. */
export const PLUGIN_MATCHER = `AskUserQuestion|EnterPlanMode|ExitPlanMode|mcp__.*__(${MCP_TOOLS})`;
/** Every tool the cloud copy's hook watches. */
export const GUARD_MATCHER = `Bash|Edit|Write|MultiEdit|NotebookEdit|${PLUGIN_MATCHER}`;

const say = (text) => ({ permissionDecision: "deny", permissionDecisionReason: `Syno Console: ${text}` });
const OWNER_MERGES = "only the owner merges pull requests (R-0010).";
const HELD_TOOLS = new RegExp(`^(AskUserQuestion|EnterPlanMode|ExitPlanMode)$|__(${MCP_TOOLS})$`);
const BRANCH_TOOLS = /__(push_files|create_or_update_file|delete_file|create_branch)$/;
const PROTECTED = /(^|\/)\.syno\/console\/(decisions|rules|questions|numbers)\/|(^|\/)\.claude\/skills\/syno-console\/|(^|\/)\.syno\/local\/console\/role\.json$/;

function judgeRefspec(spec, own, current) {
  if (spec.startsWith("+")) return say(`force-pushes are never allowed (R-0006). Merge instead, then push ${own} normally.`);
  const [src, rawDst] = spec.includes(":") ? [spec.slice(0, spec.indexOf(":")), spec.slice(spec.indexOf(":") + 1)] : [spec, spec];
  // `:branch` (nothing pushed to it) deletes the remote branch.
  if (spec.includes(":") && (src === "" || rawDst === "")) return say("a push that deletes a remote branch is never allowed (R-0006).");
  if (rawDst.startsWith("refs/tags/")) return say(`tags are the owner's to push. Push only ${own}.`);
  const dst = (rawDst === "HEAD" || rawDst === "@" ? current : rawDst)?.replace(/^refs\/heads\//, "");
  return dst === own ? null : say(`"${dst ?? rawDst}" isn't this session's branch (${own}). Each session pushes only its own branch (R-0006).`);
}

function judgePush(p, own, current) {
  if (p.force) return say(`force-pushes are never allowed (R-0006). Merge instead, then push ${own} normally.`);
  if (p.del || p.prune) return say("a push that can delete remote branches is never allowed (R-0006).");
  if (p.all || p.mirror) return say(`a push of every branch is never allowed (R-0006). Push only ${own}.`);
  if (p.tags) return say(`tags are the owner's to push. Push only ${own}.`);
  if (p.dynamic) return say(`name the branch literally, so the guard can check it: git push -u origin ${own}.`);
  if (!p.refspecs.length) {
    return current === own ? null : say(`a push with no branch named, from ${current ?? "a detached HEAD"}, would leave this session's branch. Run git push -u origin ${own}.`);
  }
  for (const spec of p.refspecs) {
    const verdict = judgeRefspec(spec, own, current);
    if (verdict) return verdict;
  }
  return null;
}

function judgeBash(command, role, current, depth = 0) {
  if (typeof command !== "string") return null;
  if (mergesPr(command)) return say(OWNER_MERGES);
  for (const p of parsePushes(command)) {
    const verdict = judgePush(p, role.branch, current);
    if (verdict) return verdict;
  }
  if (depth < 3) {
    for (const inner of shellStrings(command)) {
      const verdict = judgeBash(inner, role, current, depth + 1);
      if (verdict) return verdict;
    }
  }
  return null;
}

/** True when `id` lies in `role`'s part of the tree, below it. */
const below = (role, id) => (role.level === "console" ? parseId(id)?.level !== "console" : String(id).startsWith(`${role.id}.`));

function judgeSpawn(input, role, cfg) {
  if (role.level === "task") return say("a task can't create sessions. If more work is needed, send a [SYNO question] to your milestone.");
  const child = parseId(idFromBranch(input.outcome_branch, cfg) ?? "");
  if (!child || !below(role, child.id)) {
    return say(`${role.id} can create only sessions in its own part of the tree: its next level, or deeper on a child's behalf. outcome_branch "${input.outcome_branch ?? ""}" isn't one. Use the parameters from \`console spawn\`.`);
  }
  const { titlePrefix } = namesFor(child.id, "", cfg);
  const title = String(input.title ?? "");
  if (title !== titlePrefix && !title.startsWith(`${titlePrefix} · `)) return say(`the title must start with "${titlePrefix}" (R-0002); got "${title}".`);
  const mode = input.permission_mode;
  const okMode = cfg.autoMode ? ["auto", "default"].includes(mode) : !["bypassPermissions", "plan"].includes(mode);
  if (!okMode) return say(`pass permission_mode "auto" (R-0003), or "default" where the platform refuses auto.`);
  if (!String(input.append_system_prompt ?? "").startsWith(MARKER)) return say(`append_system_prompt must start with the role card (${MARKER}). Make it with \`console spawn\`.`);
  return null;
}

function judgeArchive(input, role, nodes, isPushed) {
  const node = (nodes ?? []).find((n) => n?.sessionId && n.sessionId === input.session_id);
  const mine = node && (node.parentId === role.id || below(role, node.id));
  if (mine && node.status === "stopped") return null;
  if (!mine || !["merged", "archived"].includes(node.status) || !node.mergeCommit) {
    return say("archive only a child whose work is proven merged (R-0011): verify, merge, check, `console record <id> --status merged --merge <sha>`, commit and push first.");
  }
  if (!isPushed?.(node.mergeCommit)) return say(`the merge ${node.mergeCommit} isn't in the pushed ${role.branch} yet. Push your branch (git push origin ${role.branch}), then archive (R-0011).`);
  return null;
}

function judgeGitHub(tool, ti, role) {
  if (/__(merge_pull_request|enable_pr_auto_merge)$/.test(tool)) return say(OWNER_MERGES);
  if (/__update_pull_request_branch$/.test(tool)) return role.level === "console" ? null : say("only the Console updates the combined pull request.");
  if (BRANCH_TOOLS.test(tool) && ti.branch !== role.branch) {
    return say(`GitHub writes go only to this session's own branch (${role.branch}); this one names "${ti.branch ?? "the default branch"}" (R-0006).`);
  }
  return null;
}

function judgeAsk(role, cfg) {
  if (role.level === "console" || (role.level === "phase" && cfg.askAt === "phase")) return null;
  const who = cfg.askAt === "phase" ? "the Console and the phase sessions ask" : "the Console asks";
  return say(`only ${who} the owner (askAt: ${cfg.askAt}). Send a [SYNO question] to your parent instead, with 2 to 4 options and your recommendation first.`);
}

function held(role) {
  return say(
    role.level === "console"
      ? "this session's role was only worked out from its branch. If it is the Console, run `console start` again (it changes nothing else). Until then questions, pushes and session tools wait."
      : "this session hasn't joined its Syno tree yet: its role was only worked out from the branch it started on, which may be its parent's. Run the join command from your role card first. Until then questions, pushes and session tools wait.",
  );
}

function judgeTool(tool, ti, role, ctx) {
  if (tool === "AskUserQuestion") return judgeAsk(role, ctx.cfg);
  if (tool === "EnterPlanMode" || tool === "ExitPlanMode") {
    return role.level === "console" ? null : say("plan mode waits for the owner, and only the Console asks the owner. Write the plan and send it up as a [SYNO question]: \"Approve this plan?\"");
  }
  if (tool === "Bash") return judgeBash(ti.command, role, ctx.currentBranch);
  if (/__create_session$/.test(tool)) return judgeSpawn(ti, role, ctx.cfg);
  if (/__archive_session$/.test(tool)) return role.level === "task" ? say("a task can't archive sessions.") : judgeArchive(ti, role, ctx.nodes, ctx.isPushed);
  if (/^mcp__/.test(tool)) return judgeGitHub(tool, ti, role);
  const path = String(ti.file_path ?? ti.notebook_path ?? "").split("\\").join("/");
  if (role.level !== "console" && PROTECTED.test(path)) {
    return say("only the Console writes decisions, rules, questions, number blocks and the guard's own files. Send what you need up as a [SYNO question].");
  }
  return null;
}

/** The guard's verdict for one tool call: a deny, or null for no objection. Never throws. */
export function judge(input, ctx) {
  try {
    const role = ctx?.role;
    if (!role || !input || typeof input !== "object") return null;
    const tool = String(input.tool_name ?? "");
    const ti = input.tool_input;
    if (!ti || typeof ti !== "object") return null;
    if (role.inferred && (HELD_TOOLS.test(tool) || (tool === "Bash" && touchesRemote(ti.command)))) return held(role);
    return judgeTool(tool, ti, role, ctx);
  } catch {
    return null;
  }
}
