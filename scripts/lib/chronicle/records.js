// Chronicle's records (PRD CH-03, CH-04, §8): one JSON file per idea, change,
// release and snapshot under .syno/, so branches merge without conflicts.
// Functions that need today's date take `now`, so tests control the clock.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { jsonText, readJson, refusal, usage } from "../fsutil.js";
import { validate } from "../schema.js";
import { sortDesc } from "./semver.js";

export const DIRS = { idea: ".syno/ideas", change: ".syno/changes", release: ".syno/releases", snapshot: ".syno/snapshots" };
export const CHANGE_TYPES = ["Added", "Changed", "Deprecated", "Removed", "Fixed", "Security"];
export const OPEN = ["proposed", "accepted", "planned", "in-progress"];
const NEXT = { proposed: ["accepted"], accepted: ["planned"], planned: ["in-progress"], "in-progress": [], parked: ["proposed"] };

const pad = (n, w = 2) => String(n).padStart(w, "0");

/** YYYY-MM-DD in local time. */
export const today = (now = new Date()) => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

/** YYYYMMDD-HHMMSS in local time, for change and override file names. */
export const stamp = (now = new Date()) => `${today(now).replace(/-/g, "")}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

export function slugify(text, max = 40) {
  const slug = String(text)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/, "");
  return slug || "change";
}

function list(root, kind) {
  let names = [];
  try {
    names = readdirSync(join(root, DIRS[kind])).filter((n) => n.endsWith(".json")).sort();
  } catch {
    return [];
  }
  return names.map((n) => ({ file: `${DIRS[kind]}/${n}`, ...readJson(join(root, DIRS[kind], n), {}) }));
}

export const loadIdeas = (root) => list(root, "idea");
export const loadChanges = (root) => list(root, "change");
export const loadSnapshots = (root) => list(root, "snapshot");
export function loadReleases(root) {
  const all = list(root, "release");
  const order = sortDesc(all.map((r) => r.version));
  return order.map((v) => all.find((r) => r.version === v));
}

/** IDEA-0001, four digits, growing to five after IDEA-9999 (CH-03.1). IDs are never reused. */
export function nextIdeaId(ideas) {
  const max = ideas.reduce((n, i) => Math.max(n, Number(/^IDEA-(\d+)$/.exec(i.id ?? "")?.[1] ?? 0)), 0);
  return `IDEA-${pad(max + 1, 4)}`;
}

export function newIdea({ title, problem, value, notes, tags = [], links = [] }, { ideas, now, author = null }) {
  if (!title?.trim()) throw usage("An idea needs a one-line title.");
  const date = today(now);
  const idea = { schemaVersion: 1, id: nextIdeaId(ideas), title: title.trim(), status: "proposed", statusHistory: [{ status: "proposed", date }], shippedIn: null, created: date, updated: date, author, links, tags };
  for (const [k, v] of Object.entries({ problem, value, notes })) if (v) idea[k] = v;
  return idea;
}

/** Moves an idea to a new status (CH-03.2). Only a release may set "shipped" (CH-03.3). */
export function setIdeaStatus(idea, status, { now, byRelease = false, version = null } = {}) {
  if (status === "shipped" && !byRelease) throw refusal(`Only a release marks an idea shipped. Cut a release that links ${idea.id}.`);
  const allowed = status === "shipped" ? true : OPEN.includes(idea.status) && ["parked", "rejected"].includes(status) ? true : (NEXT[idea.status] ?? []).includes(status);
  if (!allowed) throw refusal(`${idea.id} can't move from ${idea.status} to ${status}.`);
  const date = today(now);
  return { ...idea, status, updated: date, statusHistory: [...idea.statusHistory, { status, date }], shippedIn: status === "shipped" ? version : idea.shippedIn };
}

export function newChange({ type, summary, breaking = false, ideas = [], details, links = [], commit = null }, { now, author = null }) {
  if (!CHANGE_TYPES.includes(type)) throw usage(`A change type is one of: ${CHANGE_TYPES.join(", ")}.`);
  const text = String(summary ?? "").trim();
  if (!text || text.length > 200) throw usage("A change needs a one-line summary of at most 200 characters.");
  const change = { schemaVersion: 1, id: `${stamp(now)}-${slugify(text)}`, type, summary: text, breaking: Boolean(breaking), ideas, links, author, created: today(now), commit };
  if (details) change.details = details;
  return change;
}

const ID_KEY = { idea: "id", change: "id", release: "version", snapshot: "id" };

/** The file a record lives in, relative to the project root. */
export const recordPath = (kind, record) => `${DIRS[kind]}/${record[ID_KEY[kind]]}.json`;

/** Adds a record (without its `file` helper field) to a write plan. */
export function planRecord(plan, kind, record) {
  const { file, ...data } = record;
  return plan.write(recordPath(kind, data), jsonText(data));
}

const SCHEMAS = {};
export function schemaFor(kind) {
  SCHEMAS[kind] ??= readJson(fileURLToPath(new URL(`../../../schemas/${kind}.schema.json`, import.meta.url)));
  return SCHEMAS[kind];
}

/** Schema errors for one record ([] when valid). */
export function checkRecord(kind, record) {
  const { file, ...data } = record;
  return validate(schemaFor(kind), data);
}
