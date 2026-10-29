// Syno Pulse: paths, limits and the project gate (PRD S-02). Ported from
// Synopus Insider 0.1.1. Loaded by every hook, so it stays cheap: no network,
// no child processes, a handful of stat calls at most.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

// Mirrors src/lib/schemas/insider.ts in the Synopus site; change both together.
export const TITLE_MAX = 120;
export const DETAIL_MAX = 1000;
export const LIST_MAX = 20;
export const EVENT_MAX_BYTES = 4096;
export const BATCH_MAX_EVENTS = 50;
// Consent notice version 2 (PRD S-02). The site accepts it after its upgrade.
export const CONSENT_VERSION = "2026-10-30";
// www directly: the apex redirects (slowly) and a cross-host redirect drops the bearer token.
export const DEFAULT_API_BASE = "https://www.synopus.in";
// Event types every version of the site accepts. Newer ones wait until /status lists them.
export const CORE_TYPES = ["session_start", "session_end", "heartbeat", "commit", "test_run", "build", "milestone", "progress", "blocker", "blocker_resolved", "note"];

export const MARKER = ".syno/pulse.json";
export const LEGACY_MARKER = ".claude/insider.json";

/** SYNO_PULSE_<NAME>, or the old SYNOPUS_INSIDER_<NAME> so existing setups keep working. */
export const env = (name) => process.env[`SYNO_PULSE_${name}`] ?? process.env[`SYNOPUS_INSIDER_${name}`];

const xdgConfig = () => process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
const xdgState = () => process.env.XDG_STATE_HOME || join(homedir(), ".local", "state");

export const configDir = () => (env("HOME") ? join(env("HOME"), "config") : join(xdgConfig(), "syno", "pulse"));
export const stateDir = () => (env("HOME") ? join(env("HOME"), "state") : join(xdgState(), "syno", "pulse"));

/**
 * Where Synopus Insider kept its files, for /syno:migrate. With a Pulse home
 * set (tests, unusual setups) it stays inside that home and never reads the
 * machine's real Insider folder.
 */
export const legacyDirs = () =>
  env("HOME")
    ? { config: join(env("HOME"), "legacy", "config"), state: join(env("HOME"), "legacy", "state") }
    : { config: join(xdgConfig(), "synopus-insider"), state: join(xdgState(), "synopus-insider") };

export const paths = {
  config: () => join(configDir(), "config.json"), // { apiBase?, enrolmentKey }
  device: () => join(configDir(), "device.json"), // { token, memberName, memberEmail, label, consentVersion, consentAt }
  queue: () => join(stateDir(), "queue.jsonl"),
  status: () => join(stateDir(), "status.json"), // projectKey -> { device, accepts, checkedAt }
  timings: () => join(stateDir(), "timings.log"),
};

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

/** Owner-only permissions: the device file holds a secret. */
export function writeJson(file, value, mode = 0o600) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode });
}

export const apiBase = () => (env("API") || readJson(paths.config())?.apiBase || DEFAULT_API_BASE).replace(/\/+$/, "");

/**
 * Device credentials. A cloud environment sets SYNO_PULSE_TOKEN instead of
 * keeping a device file. A device that consented to an older notice must join
 * again, because the notice changed.
 */
export function deviceCredentials() {
  if (env("TOKEN")) return { token: env("TOKEN"), cloud: true };
  const device = readJson(paths.device());
  if (!device?.token || device.consentVersion !== CONSENT_VERSION) return null;
  return { ...device, cloud: false };
}

function walkUp(cwd, marker) {
  let dir = resolve(cwd);
  for (;;) {
    const file = join(dir, marker);
    if (existsSync(file)) return { dir, file };
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * The gate: walk up from cwd to the nearest .syno/pulse.json. No file → null
 * → every hook exits without touching the network or the disk.
 */
export function findEnabledProject(cwd = process.cwd()) {
  const hit = walkUp(cwd, MARKER);
  if (!hit) return null;
  const project = readJson(hit.file);
  return project && /^[a-f0-9]{64}$/.test(project.projectKey ?? "") ? { root: hit.dir, ...project } : null;
}

/** A project Synopus Insider enabled, not yet moved to Syno Pulse. */
export const findLegacyProject = (cwd = process.cwd()) => walkUp(cwd, LEGACY_MARKER)?.dir ?? null;

/** "git@github.com:Acme/Site.git" and "https://github.com/acme/site" → "github.com/acme/site". */
export function normaliseRemote(url) {
  if (!url) return null;
  let s = url.trim().replace(/\.git$/i, "");
  const scp = s.includes("://") ? null : /^[^@\s]+@([^:\s]+):(.+)$/.exec(s); // git@host:path
  if (scp) s = `${scp[1]}/${scp[2]}`;
  else s = s.replace(/^[a-z+]+:\/\//i, "").replace(/^[^@/]+@/, ""); // scheme, credentials
  s = s.replace(/:\d+(?=\/)/, "").replace(/\/+$/, "").toLowerCase();
  return /^[^/]+\/.+/.test(s) ? s : null;
}

export const sha256 = (value) => createHash("sha256").update(value, "utf8").digest("hex");

/** Project key = hash of the normalised remote, or of the folder path when there is none (same as Insider's). */
export function projectKeyFor({ remoteUrl, root }) {
  const remote = normaliseRemote(remoteUrl);
  return sha256(remote ? `git:${remote}` : `path:${resolve(root)}`);
}
