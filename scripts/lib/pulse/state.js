// Small per-machine state shared by Pulse's hooks, its MCP server and emit():
// the cached device status (active or revoked, and which event types the site
// accepts), the current session per project, per-session counters for the
// end-of-session summary, and each function's latest result for the daily
// roll-up. There is no approval state: once a machine joins, it reports.
import { readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { CORE_TYPES, paths, readJson, stateDir, writeJson } from "./config.js";

export const STATUS_TTL_MS = 10 * 60_000;
export const ROLLUP_EVERY_MS = 24 * 60 * 60_000;

export function cachedStatus(projectKey, now = Date.now()) {
  const entry = readJson(paths.status(), {})[projectKey];
  return entry ? { ...entry, fresh: now - entry.checkedAt < STATUS_TTL_MS } : null;
}

export function saveStatus(projectKey, status, now = Date.now()) {
  const all = readJson(paths.status(), {});
  all[projectKey] = { ...status, checkedAt: now };
  writeJson(paths.status(), all);
}

const revokedFile = () => join(stateDir(), "revoked.json");

/** Set when the site answers 401: this machine's key no longer works anywhere. */
export const markRevoked = (now = Date.now()) => writeJson(revokedFile(), { at: now });
export const isRevoked = () => Boolean(readJson(revokedFile()));
export function clearRevoked() {
  try {
    unlinkSync(revokedFile());
  } catch {}
}

/** Event types the site accepts: the core ones, plus any the site listed in /status. */
export function acceptedTypes() {
  const all = Object.values(readJson(paths.status(), {}));
  return new Set([...CORE_TYPES, ...all.flatMap((s) => (Array.isArray(s.accepts) ? s.accepts : []))]);
}

const currentFile = (projectKey) => join(stateDir(), "current", `${projectKey}.json`);
const sessionFile = (sessionId) => join(stateDir(), "sessions", `${sessionId.replace(/[^\w-]/g, "_")}.json`);
const resultsFile = (projectKey) => join(stateDir(), "results", `${projectKey}.json`);

/** The MCP server and the CLI have no session id of their own; they use the project's latest session. */
export const setCurrentSession = (projectKey, sessionId) => writeJson(currentFile(projectKey), { sessionId, at: Date.now() });
export const currentSession = (projectKey) => readJson(currentFile(projectKey))?.sessionId ?? null;

export const sessionStats = (sessionId) => readJson(sessionFile(sessionId), { commits: [], milestones: 0 });

export function recordInSession(sessionId, { commit, milestone } = {}) {
  const stats = sessionStats(sessionId);
  if (commit) stats.commits = [...stats.commits, commit].slice(-20);
  if (milestone) stats.milestones += 1;
  writeJson(sessionFile(sessionId), stats);
}

export function forgetSession(sessionId) {
  try {
    unlinkSync(sessionFile(sessionId));
  } catch {}
}

/** Drops session files older than a week (sessions that never ended cleanly). */
export function pruneSessions(now = Date.now()) {
  const dir = join(stateDir(), "sessions");
  let names = [];
  try {
    names = readdirSync(dir);
  } catch {}
  for (const name of names) {
    const file = join(dir, name);
    if (now - (statSync(file, { throwIfNoEntry: false })?.mtimeMs ?? now) > 7 * 864e5) {
      try {
        unlinkSync(file);
      } catch {}
    }
  }
}

/** Keeps each function's latest result, for the daily roll-up. */
export function rememberResult(projectKey, type, data, now = Date.now()) {
  const all = readJson(resultsFile(projectKey), { latest: {}, rolledUpAt: 0 });
  all.latest[type] = { data, at: now };
  writeJson(resultsFile(projectKey), all);
}

export const results = (projectKey) => readJson(resultsFile(projectKey), { latest: {}, rolledUpAt: 0 });

export function markRolledUp(projectKey, now = Date.now()) {
  writeJson(resultsFile(projectKey), { ...results(projectKey), rolledUpAt: now });
}

export const rollupDue = (projectKey, now = Date.now()) => now - results(projectKey).rolledUpAt >= ROLLUP_EVERY_MS;
