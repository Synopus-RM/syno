// Function results for the Synopus panel (PRD §5.4, S-02). Every Syno function
// calls emit() when it finishes. Pulse queues the event only when the project
// is enabled and this machine has joined, and only titles and counts: strings
// are redacted and cut to 120 characters, lists to 20 items, file paths are
// scrubbed, and fields that could carry code or paths are dropped.
import { LIST_MAX, TITLE_MAX, deviceCredentials, findEnabledProject } from "./config.js";
import { enqueue, newEventId } from "./queue.js";
import { redactEvent, redactText } from "./redact.js";
import { flushInBackground } from "./sender.js";
import { currentSession, isRevoked, markRolledUp, rememberResult, results, rollupDue } from "./state.js";

export const FUNCTION_TYPES = [
  "chronicle.idea", "chronicle.change", "chronicle.release", "chronicle.publish",
  "progress.snapshot", "tasks.snapshot", "audit.result", "devices.parity", "test.result",
  "sigma.snapshot", "gate.override", "compliance.result", "security.result", "fives.score", "daily.rollup",
];

// Fields that could carry code, contents, paths or prompts never leave the machine.
const DROPPED_KEY = /path|file|code|content|diff|prompt|reply|transcript|evidence|snippet|stack/i;
// "src/app/page.tsx", "lib\\db.js:42", "./x.py" read as file paths, not titles.
const FILE_PATH = /(?:\.{0,2}[\\/])?(?:[\w.@-]+[\\/])+[\w.@-]+\.[A-Za-z0-9]{1,8}(?::\d+(?::\d+)?)?|\b[\w-]+\.(?:js|jsx|ts|tsx|mjs|cjs|py|rb|go|rs|java|kt|swift|php|cs|vue|svelte|css|scss|html|json|ya?ml|toml|sql|sh)(?::\d+)?\b/g;

/** Titles and counts only, as PRD §5.4 says. */
export function shapeData(value, keepEmail, depth = 0) {
  if (typeof value === "string") return (redactText(value.replace(FILE_PATH, "[file]"), { keepEmail, max: TITLE_MAX }) ?? "");
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, LIST_MAX).map((v) => shapeData(v, keepEmail, depth + 1));
  if (typeof value === "object" && depth < 4) {
    return Object.fromEntries(Object.entries(value).filter(([k]) => !DROPPED_KEY.test(k)).map(([k, v]) => [k, shapeData(v, keepEmail, depth + 1)]));
  }
  return null;
}

/** The same data with every list replaced by its length, for an event that would be too large. */
const countsOnly = (value) =>
  Array.isArray(value) ? value.length : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, countsOnly(v)])) : value;

function queueEvent(project, creds, type, data, now) {
  const base = { id: newEventId(now), type, projectKey: project.projectKey, sessionId: currentSession(project.projectKey) ?? "cli", at: new Date(now).toISOString() };
  if (enqueue(redactEvent({ ...base, data }, creds.memberEmail))) return true;
  return enqueue(redactEvent({ ...base, data: countsOnly(data) }, creds.memberEmail));
}

/**
 * Queues one function result for the panel. Returns true when it was queued,
 * false when Pulse isn't enabled here, the machine hasn't joined, or its key
 * was revoked. Never throws for those cases.
 */
export async function emit(root, type, data = {}, { now = Date.now(), background = true } = {}) {
  if (!FUNCTION_TYPES.includes(type)) throw new Error(`Unknown Pulse event type: ${type}`);
  const project = findEnabledProject(root);
  const creds = project ? deviceCredentials() : null;
  if (!project || !creds || isRevoked()) return false;
  const shaped = shapeData(data, creds.memberEmail);
  if (type !== "daily.rollup") rememberResult(project.projectKey, type, shaped, now);
  const queued = queueEvent(project, creds, type, shaped, now);
  if (queued && background) flushInBackground();
  return queued;
}

/** The once-a-day summary: the latest result of every function (PRD §5.4). */
export function rollupData(projectKey) {
  const { latest } = results(projectKey);
  return { latest: Object.fromEntries(Object.entries(latest).sort(([a], [b]) => (a < b ? -1 : 1)).map(([type, r]) => [type, r.data])) };
}

/** Queues the daily roll-up when one is due. Called from the session-start hook. */
export function maybeRollup(project, creds, now = Date.now()) {
  if (!rollupDue(project.projectKey, now)) return false;
  const queued = queueEvent(project, creds, "daily.rollup", rollupData(project.projectKey), now);
  if (queued) markRolledUp(project.projectKey, now);
  return queued;
}
