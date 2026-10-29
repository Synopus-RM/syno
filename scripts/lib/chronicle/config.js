// Syno's project config and Chronicle's state (PRD §8). Config is edited by
// the owner; state is written by Syno only. A version 1 config from PRD 0.1
// (Chronicle fields at the top level) is migrated to version 2 when read.
import { join } from "node:path";
import { jsonText, readJson } from "../fsutil.js";

export const SYNO = ".syno";
export const CONFIG_PATH = `${SYNO}/config.json`;
export const STATE_PATH = `${SYNO}/state.json`;

export const CHRONICLE_DEFAULTS = {
  versionSource: "none",
  tagPattern: "^v?(\\d+\\.\\d+\\.\\d+(-[0-9A-Za-z.]+)?)$",
  tagPrefix: "v",
  snapshot: { depth: 3, ignore: ["node_modules", ".git", "dist", "build", "out", ".next", "coverage", "vendor", "target", "__pycache__", ".venv"] },
  channels: ["GitHub Release", "GitLab Release", "npm", "PyPI", "crates.io", "Maven Central", "Play Store", "App Store", "Microsoft Store", "Docker image", "web deploy", "desktop download"],
  docsDir: "docs/syno",
  changelogPath: "CHANGELOG.md",
  nudges: "tags",
  recordAuthors: true,
};

const CHRONICLE_KEYS = Object.keys(CHRONICLE_DEFAULTS);

/** A new version 2 config for a project. */
export function newConfig({ name, repoUrl = null, versionSource = "none" }) {
  return {
    schemaVersion: 2,
    project: { name, repoUrl },
    chronicle: { ...structuredClone(CHRONICLE_DEFAULTS), versionSource },
    sigma: { target: 4 },
    compliance: { jurisdictions: [{ country: "IN" }] },
    security: { localHosts: [] },
    reports: { theme: "sky-glass" },
    locale: "en",
  };
}

/** A PRD 0.1 config (schemaVersion 1, Chronicle fields at the top) as version 2. */
export function migrateConfig(raw) {
  if (!raw || raw.schemaVersion !== 1) return raw;
  const chronicle = {};
  const rest = {};
  for (const [key, value] of Object.entries(raw)) {
    if (CHRONICLE_KEYS.includes(key)) chronicle[key] = value;
    else if (!["schemaVersion", "project", "locale"].includes(key)) rest[key] = value;
  }
  const base = newConfig({ name: raw.project?.name ?? "Project", repoUrl: raw.project?.repoUrl ?? null });
  return { ...base, ...rest, project: { ...base.project, ...raw.project }, chronicle: { ...base.chronicle, ...chronicle }, locale: raw.locale ?? "en" };
}

/** The project's config with defaults filled in, or null when Syno isn't set up there. */
export function loadConfig(root) {
  const raw = migrateConfig(readJson(join(root, CONFIG_PATH)));
  if (!raw) return null;
  const chronicle = { ...structuredClone(CHRONICLE_DEFAULTS), ...raw.chronicle };
  chronicle.snapshot = { ...CHRONICLE_DEFAULTS.snapshot, ...raw.chronicle?.snapshot };
  return { ...raw, chronicle, sigma: { target: 4, ...raw.sigma } };
}

export const newState = () => ({ schemaVersion: 1, lastSyncedTag: null, renderHashes: {} });

export const loadState = (root) => ({ ...newState(), ...readJson(join(root, STATE_PATH), {}) });

export const configText = (config) => jsonText(config);
