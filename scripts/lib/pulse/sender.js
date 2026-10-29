// Pulse's sender (PRD S-02): flushes queued events, oldest first, in batches of
// at most 50. It runs detached from the hooks (`node sender.js --flush`) so a
// session never waits on the network; one sender at a time; failures back off
// 5 s → 15 min. It also refreshes the device status in the background
// (`--refresh-status <dir>`). It is the only Pulse file that starts a process.
//
// Nothing is dropped while the site can still take it later: events the site
// doesn't accept yet (a newer type, or a device the old site still holds as
// pending) wait in the queue for up to 7 days. A 401 means the key is gone, so
// the queue is cleared and the machine is marked revoked.
import { spawn } from "node:child_process";
import { mkdirSync, rmdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BATCH_MAX_EVENTS, deviceCredentials, env, findEnabledProject, readJson, stateDir, writeJson } from "./config.js";
import { getStatus, postEvents, registerProject } from "./net.js";
import { enforceSizeCap, readSegment, sealQueue, segments, writeSegment } from "./queue.js";
import { acceptedTypes, clearRevoked, markRevoked, saveStatus } from "./state.js";

const BATCH_MAX_BYTES = 60 * 1024; // the API refuses bodies over 64 KB
const BACKOFF_MIN_MS = 5_000;
const BACKOFF_MAX_MS = 15 * 60_000;
const LOCK_STALE_MS = 60_000;
const KEEP_REASONS = new Set(["project_unknown", "project_not_approved"]);

const lockDir = () => join(stateDir(), "sender.lock");
const backoffFile = () => join(stateDir(), "sender.json");

function acquireLock() {
  mkdirSync(stateDir(), { recursive: true, mode: 0o700 });
  try {
    mkdirSync(lockDir());
    return true;
  } catch {
    const age = Date.now() - (statSync(lockDir(), { throwIfNoEntry: false })?.mtimeMs ?? 0);
    if (age < LOCK_STALE_MS) return false;
    rmdirSync(lockDir()); // a crashed sender left it behind
    return acquireLock();
  }
}

function releaseLock() {
  try {
    rmdirSync(lockDir());
  } catch {}
}

function batches(events) {
  const out = [];
  let current = [];
  let bytes = 0;
  for (const event of events) {
    const size = Buffer.byteLength(JSON.stringify(event)) + 1;
    if (current.length && (current.length >= BATCH_MAX_EVENTS || bytes + size > BATCH_MAX_BYTES)) {
      out.push(current);
      current = [];
      bytes = 0;
    }
    current.push(event);
    bytes += size;
  }
  if (current.length) out.push(current);
  return out;
}

function backOff() {
  const state = readJson(backoffFile(), { failures: 0 });
  const failures = state.failures + 1;
  const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** (failures - 1));
  writeJson(backoffFile(), { failures, nextAttemptAt: Date.now() + delay });
}

/** Sends one segment's acceptable events. Returns "done", "stop" (back off) or "revoked". */
async function sendSegment(file, token, summary, now) {
  const accepted = acceptedTypes();
  const all = readSegment(file, now);
  const waiting = all.filter((e) => !accepted.has(e.type));
  let pending = all.filter((e) => accepted.has(e.type));
  for (const batch of batches(pending)) {
    const { status, json } = await postEvents(token, batch);
    if (status === 401) return "revoked";
    if (status === 200) {
      const keep = new Set((json?.rejected ?? []).filter((r) => KEEP_REASONS.has(r.reason)).map((r) => r.id));
      const dropped = (json?.rejected ?? []).filter((r) => !KEEP_REASONS.has(r.reason)).length;
      summary.sent += batch.length - keep.size - dropped;
      summary.dropped += dropped;
      waiting.push(...batch.filter((e) => keep.has(e.id)));
    } else if (status === 400) {
      summary.dropped += batch.length; // malformed: retrying won't help
    } else {
      // 403 (the old site still holds this device or project as pending), 429, 5xx or offline: try later.
      writeSegment(file, [...waiting, ...pending].sort((a, b) => (a.at < b.at ? -1 : 1)));
      summary.kept += waiting.length + pending.length;
      return "stop";
    }
    pending = pending.slice(batch.length);
  }
  summary.kept += waiting.length;
  writeSegment(file, waiting);
  return "done";
}

/**
 * Sends everything that can be sent. Returns { sent, dropped, kept } for tests
 * and logs. `force` ignores the backoff window (session end, explicit commands).
 */
export async function flush({ force = false, now = Date.now() } = {}) {
  const summary = { sent: 0, dropped: 0, kept: 0 };
  const creds = deviceCredentials();
  if (!creds) return summary;
  if (!force && (readJson(backoffFile())?.nextAttemptAt ?? 0) > now) return summary;
  if (!acquireLock()) return summary;
  try {
    sealQueue();
    await new Promise((r) => setTimeout(r, 20)); // let an in-flight append land in the sealed segment
    enforceSizeCap();
    for (const file of segments()) {
      const outcome = await sendSegment(file, creds.token, summary, now);
      if (outcome === "revoked") {
        for (const f of segments()) summary.dropped += readSegment(f, now).length;
        for (const f of segments()) writeSegment(f, []);
        markRevoked(now);
        return summary;
      }
      if (outcome === "stop") {
        backOff();
        return summary; // keep order: later segments wait for this one
      }
    }
    writeJson(backoffFile(), { failures: 0, nextAttemptAt: 0 });
    return summary;
  } finally {
    releaseLock();
  }
}

/** Detached: the device's status and the event types the site accepts; registers the project the first time. */
export async function refreshStatus(root) {
  const project = findEnabledProject(root);
  const creds = deviceCredentials();
  if (!project || !creds) return;
  const { status, json } = await getStatus(creds.token, project.projectKey);
  if (status === 401) return markRevoked();
  if (status !== 200 || !json) return; // keep the old cache; try again next session
  clearRevoked();
  if (json.project?.status === "unknown") {
    await registerProject(creds.token, { projectKey: project.projectKey, displayName: project.displayName, repoHost: project.repoHost, repoPath: project.repoPath });
  }
  saveStatus(project.projectKey, { device: json.device?.status ?? "active", accepts: Array.isArray(json.accepts) ? json.accepts : [] });
}

function background(args) {
  if (env("NO_BACKGROUND")) return; // tests inspect the queue directly
  spawn(process.execPath, [fileURLToPath(import.meta.url), ...args], { detached: true, stdio: "ignore", env: process.env }).unref();
}

/** Starts a detached flush and returns at once (used by hooks and emit). */
export const flushInBackground = ({ force = false } = {}) => background(["--flush", ...(force ? ["--force"] : [])]);

/** Starts a detached status refresh for the project at `root`. */
export const refreshInBackground = (root) => background(["--refresh-status", root]);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--flush")) flush({ force: process.argv.includes("--force") }).catch(() => {});
  else if (process.argv[2] === "--refresh-status") refreshStatus(process.argv[3]).catch(() => {});
}
