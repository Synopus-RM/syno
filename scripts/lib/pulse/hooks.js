// Syno Pulse's part of the Syno hooks (PRD S-02), ported from Insider's
// hook.mjs. The gate comes first: outside a project with .syno/pulse.json it
// returns at once, with no network and nothing written. Inside one, hooks only
// append to the local queue; status checks and sending run in detached
// processes. Nothing the panel says is read back into a session: the panel
// only watches.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deviceCredentials, findEnabledProject, findLegacyProject, paths, stateDir } from "./config.js";

const GUIDANCE = [
  "Syno Pulse is active in this project: progress is reported to the Synopus PM panel as titles and counts.",
  "Call the report_update tool (server syno-pulse):",
  '- type "milestone" after finishing a task from the plan (one-line title, short detail);',
  '- type "progress" with done/total counted against the project\'s plan or PRD checklist;',
  '- type "blocker" when you are blocked or waiting on someone, and "blocker_resolved" with its blockerId once unblocked.',
  "Never put code, secrets, prompts, file paths or file contents in a report.",
].join("\n");

export const NOT_JOINED = "Pulse: enabled in this project, but this machine hasn't joined, so nothing is sent. /syno:pulse join shows what is collected.";
export const REVOKED = "Pulse: this machine's Pulse key was revoked. Run /syno:pulse join to rejoin.";
export const LEGACY = "Pulse: Synopus Insider was enabled in this project. Offer /syno:migrate to move it to Syno Pulse.";

function gitBranch(root) {
  try {
    const m = /^ref: refs\/heads\/(.+)$/m.exec(readFileSync(join(root, ".git", "HEAD"), "utf8"));
    return m ? m[1].trim().slice(0, 200) : undefined;
  } catch {
    return undefined;
  }
}

/** Heartbeats go out at most once a minute; important events flush at once. */
function maybeFlush(sender) {
  const marker = join(stateDir(), "last-flush");
  let last = 0;
  try {
    last = Number(readFileSync(marker, "utf8")) || 0;
  } catch {}
  if (Date.now() - last < 60_000) return;
  mkdirSync(stateDir(), { recursive: true, mode: 0o700 });
  writeFileSync(marker, String(Date.now()));
  sender.flushInBackground();
}

async function onEvent(event, input, project, creds) {
  const [state, queue, sender, { redactEvent }, { detect }, { maybeRollup }] = await Promise.all([
    import("./state.js"), import("./queue.js"), import("./sender.js"), import("./redact.js"), import("./detect.js"), import("./emit.js"),
  ]);
  if (event === "SessionStart" && !state.cachedStatus(project.projectKey)?.fresh) sender.refreshInBackground(project.root);
  if (state.isRevoked()) return event === "SessionStart" ? { lines: [REVOKED] } : null; // keep nothing new
  const sessionId = String(input.session_id ?? "unknown").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 128);
  const push = (type, extra = {}) => queue.enqueue(redactEvent({ id: queue.newEventId(), type, projectKey: project.projectKey, sessionId, at: new Date().toISOString(), ...extra }, creds.memberEmail));
  switch (event) {
    case "SessionStart": {
      state.setCurrentSession(project.projectKey, sessionId);
      state.pruneSessions();
      const branch = gitBranch(project.root);
      push("session_start", { data: { ...(input.source ? { source: String(input.source).slice(0, 40) } : {}), ...(branch ? { branch } : {}) } });
      maybeRollup(project, creds);
      sender.flushInBackground();
      return { context: GUIDANCE };
    }
    case "UserPromptSubmit":
    case "Stop":
      push("heartbeat"); // a timestamp only: the prompt is never read
      maybeFlush(sender);
      return null;
    case "PostToolUse": {
      if (input.tool_name !== "Bash") return null;
      const response = input.tool_response ?? {};
      const output = typeof response === "string" ? response : [response.stdout, response.stderr].filter(Boolean).join("\n");
      const facts = detect(input.tool_input?.command, output);
      for (const fact of facts) {
        push(fact.type, { title: fact.title, data: fact.data });
        if (fact.type === "commit") state.recordInSession(sessionId, { commit: fact.title });
      }
      if (facts.length) sender.flushInBackground();
      return null;
    }
    case "SessionEnd": {
      const stats = state.sessionStats(sessionId);
      // The fallback summary: commit subjects only. No AI call, no transcript.
      if (stats.commits.length > 0 && stats.milestones === 0) push("milestone", { title: "Session summary", detail: stats.commits.join("; ") });
      push("session_end", { data: input.reason ? { reason: String(input.reason).slice(0, 40) } : {} });
      state.forgetSession(sessionId);
      sender.flushInBackground({ force: true });
      return null;
    }
    default:
      return null;
  }
}

export async function handle(event, input, env) {
  const project = findEnabledProject(env.cwd);
  if (!project) return event === "SessionStart" && findLegacyProject(env.cwd) ? { lines: [LEGACY] } : null;
  const started = process.hrtime.bigint();
  try {
    const creds = deviceCredentials();
    if (!creds) return event === "SessionStart" ? { lines: [NOT_JOINED] } : null;
    return await onEvent(event, input, project, creds);
  } finally {
    try {
      mkdirSync(stateDir(), { recursive: true, mode: 0o700 });
      appendFileSync(paths.timings(), `${new Date().toISOString()} ${event} ${(Number(process.hrtime.bigint() - started) / 1e6).toFixed(1)}\n`);
    } catch {}
  }
}
