// Syno Console's guard (PRD S-17, design 5.8): one PreToolUse check for every
// session in a Syno tree. Below the Console it refuses the question dialog and
// plan mode, pushes to any branch but the session's own, sessions of the wrong
// level or without a role card, archiving a child that isn't proven merged,
// merging pull requests, and edits to the Console's own records. Pure: the
// caller passes the role, config and node records in. Outside a tree (no role)
// it has no opinion, and on input it can't read it allows the call.
import { childLevel, idFromBranch, namesFor, parseId } from "./model.mjs";

export const MARKER = "SYNO ROLE CARD";
const SESSION_TOOLS = "mcp__.*__create_session|mcp__.*__archive_session|mcp__.*__merge_pull_request";
/** Tools the plugin's dispatcher adds to its existing Bash entry. */
export const PLUGIN_MATCHER = `AskUserQuestion|EnterPlanMode|ExitPlanMode|${SESSION_TOOLS}`;
/** Every tool the cloud copy's hook watches. */
export const GUARD_MATCHER = `Bash|Edit|Write|MultiEdit|NotebookEdit|${PLUGIN_MATCHER}`;

const say = (text) => ({ permissionDecision: "deny", permissionDecisionReason: `Syno Console: ${text}` });

function splitSegments(command) {
  const segs = [];
  let cur = "";
  let quote = null;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      cur += c;
      if (c === quote) quote = null;
      else if (c === "\\" && quote === '"') cur += command[++i] ?? "";
    } else if (c === "'" || c === '"') {
      quote = c;
      cur += c;
    } else if (c === "\\") cur += c + (command[++i] ?? "");
    else if (c === "&" && (/[<>]$/.test(cur) || command[i + 1] === ">")) cur += c;
    else if ("\n;|&".includes(c)) {
      segs.push(cur);
      cur = "";
      if ((c === "|" || c === "&") && command[i + 1] === c) i++;
    } else cur += c;
  }
  segs.push(cur);
  return segs.map((s) => s.trim()).filter(Boolean);
}

function dropRedirects(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i].text;
    if (/^\d*(>>?|<|&>)$/.test(t)) i++;
    else if (!/^\d*(>>?|<|&>)/.test(t)) out.push(tokens[i]);
  }
  return out;
}

function tokenize(segment) {
  const tokens = [];
  let cur = null;
  let quote = null;
  let dynamic = false;
  const flush = () => {
    if (cur !== null) tokens.push({ text: cur, dynamic });
    cur = null;
    dynamic = false;
  };
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (quote === '"' && c === "\\") cur += segment[++i] ?? "";
      else {
        if (quote === '"' && (c === "$" || c === "`")) dynamic = true;
        cur += c;
      }
      continue;
    }
    if (/\s/.test(c)) {
      flush();
      continue;
    }
    cur ??= "";
    if (c === "'" || c === '"') quote = c;
    else if (c === "\\") cur += segment[++i] ?? "";
    else {
      if (c === "$" || c === "`") dynamic = true;
      cur += c;
    }
  }
  flush();
  return dropRedirects(tokens);
}

const GIT_VALUE_OPTS = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--config-env"]);
const PUSH_VALUE_OPTS = new Set(["--push-option", "--repo", "--receive-pack", "--exec"]);

/** The git subcommand and its arguments, after env assignments and git's global options; null for other commands. */
function gitCall(tokens) {
  let i = 0;
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i].text)) i++;
  if (["command", "exec"].includes(tokens[i]?.text)) i++;
  const name = tokens[i]?.text ?? "";
  if (name !== "git" && !name.endsWith("/git")) return null;
  for (i++; i < tokens.length && tokens[i].text.startsWith("-"); i++) if (GIT_VALUE_OPTS.has(tokens[i].text)) i++;
  return { sub: tokens[i]?.text, args: tokens.slice(i + 1) };
}

function longFlag(p, text) {
  const name = text.split("=")[0];
  if (name === "--force" || name.startsWith("--force-with-lease") || name === "--force-if-includes") p.force = true;
  else if (name === "--delete") p.del = true;
  else if (name === "--prune") p.prune = true;
  else if (name === "--all" || name === "--branches") p.all = true;
  else if (name === "--mirror") p.mirror = true;
  else if (name === "--tags" || name === "--follow-tags") p.tags = true;
  return PUSH_VALUE_OPTS.has(name) && !text.includes("=");
}

function pushArgs(args) {
  const p = { force: false, del: false, all: false, mirror: false, tags: false, prune: false, remote: null, refspecs: [], dynamic: false };
  const pos = [];
  for (let i = 0; i < args.length; i++) {
    const { text } = args[i];
    if (text === "--") {
      pos.push(...args.slice(i + 1));
      break;
    }
    if (text.startsWith("--")) {
      if (longFlag(p, text)) i++;
    } else if (text === "-o") i++;
    else if (/^-[A-Za-z]+$/.test(text)) {
      if (text.includes("f")) p.force = true;
      if (text.includes("d")) p.del = true;
    } else pos.push(args[i]);
  }
  p.remote = pos[0]?.text ?? null;
  p.refspecs = pos.slice(1).map((t) => t.text);
  p.dynamic = pos.some((t) => t.dynamic);
  return p;
}

/** Every `git push` in a command line, with its flags and refspecs. */
export const parsePushes = (command) =>
  splitSegments(String(command))
    .map((s) => gitCall(tokenize(s)))
    .filter((g) => g?.sub === "push")
    .map((g) => pushArgs(g.args));

function judgeRefspec(spec, own, current) {
  if (spec.startsWith("+")) return say(`force-pushes are never allowed (R-0006). Merge instead, then push ${own} normally.`);
  const [src, rawDst] = spec.includes(":") ? [spec.slice(0, spec.indexOf(":")), spec.slice(spec.indexOf(":") + 1)] : [spec, spec];
  // `:branch` (nothing pushed to it) deletes the remote branch.
  if (spec.includes(":") && (src === "" || rawDst === "")) return say("a push that deletes a remote branch is never allowed (R-0006).");
  if (rawDst.startsWith("refs/tags/")) return say(`tags are the owner's to push. Push only ${own}.`);
  const dst = (rawDst === "HEAD" || (rawDst === src && src === "HEAD") ? current : rawDst)?.replace(/^refs\/heads\//, "");
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

function judgeBash(command, role, current) {
  if (typeof command !== "string") return null;
  for (const seg of splitSegments(command)) {
    const t = tokenize(seg).map((x) => x.text);
    if (t[0] === "gh" && t[1] === "pr" && t[2] === "merge") return say("only the owner merges pull requests (R-0010).");
  }
  for (const p of parsePushes(command)) {
    const verdict = judgePush(p, role.branch, current);
    if (verdict) return verdict;
  }
  return null;
}

function judgeSpawn(input, role, cfg) {
  if (role.level === "task") return say("a task can't create sessions. If more work is needed, send a [SYNO question] to your milestone.");
  const child = parseId(idFromBranch(input.outcome_branch, cfg) ?? "");
  if (!child || child.parentId !== role.id || child.level !== childLevel(role.level)) {
    return say(`${role.id} can create only its next level directly under it, and outcome_branch "${input.outcome_branch ?? ""}" isn't one. Use the parameters from \`console spawn\`.`);
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

const ARCHIVABLE = new Set(["merged", "stopped", "archived"]);

function judgeArchive(input, role, nodes) {
  const node = (nodes ?? []).find((n) => n?.sessionId && n.sessionId === input.session_id);
  if (node && node.parentId === role.id && ARCHIVABLE.has(node.status)) return null;
  return say("archive only a child whose work is proven merged (R-0011): verify, merge, check, `console record <id> --status merged`, commit and push first.");
}

const PROTECTED = /(^|\/)\.syno\/console\/(decisions|rules|questions|numbers)\//;

function judgeAsk(role, cfg) {
  if (role.level === "console" || (role.level === "phase" && cfg.askAt === "phase")) return null;
  const who = cfg.askAt === "phase" ? "the Console and the phase sessions ask" : "the Console asks";
  return say(`only ${who} the owner (askAt: ${cfg.askAt}). Send a [SYNO question] to your parent instead, with 2 to 4 options and your recommendation first.`);
}

/** The guard's verdict for one tool call: a deny, or null for no objection. Never throws. */
export function judge(input, ctx) {
  try {
    const role = ctx?.role;
    if (!role || !input || typeof input !== "object") return null;
    const tool = String(input.tool_name ?? "");
    const ti = input.tool_input;
    if (!ti || typeof ti !== "object") return null;
    if (tool === "AskUserQuestion") return judgeAsk(role, ctx.cfg);
    if (tool === "EnterPlanMode" || tool === "ExitPlanMode") {
      return role.level === "console" ? null : say("plan mode waits for the owner, and only the Console asks the owner. Write the plan and send it up as a [SYNO question]: \"Approve this plan?\"");
    }
    if (tool === "Bash") return judgeBash(ti.command, role, ctx.currentBranch);
    if (/__create_session$/.test(tool)) return judgeSpawn(ti, role, ctx.cfg);
    if (/__archive_session$/.test(tool)) return role.level === "task" ? say("a task can't archive sessions.") : judgeArchive(ti, role, ctx.nodes);
    if (/__merge_pull_request$/.test(tool)) return say("only the owner merges pull requests (R-0010).");
    const path = String(ti.file_path ?? ti.notebook_path ?? "").split("\\").join("/");
    if (role.level !== "console" && PROTECTED.test(path)) {
      return say("only the Console writes decisions, rules, questions and number blocks. Send what you need up as a [SYNO question].");
    }
    return null;
  } catch {
    return null;
  }
}
