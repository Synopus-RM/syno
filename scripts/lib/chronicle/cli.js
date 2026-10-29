// Syno Chronicle's commands (PRD CH-01 to CH-14, §9). Called as
// `syno <sub> …` or `syno chronicle <sub> …`. Writes print their plan and
// change nothing until --confirm.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { WritePlan, readJson, usage } from "../fsutil.js";
import { isRepo, tryGit, userName } from "../git.js";
import { readerDate } from "../report/render.js";
import { validate as checkSchema } from "../schema.js";
import { readTags } from "./adopt.js";
import { CONFIG_PATH, STATE_PATH, loadConfig, loadState } from "./config.js";
import { isEmptyDiff } from "./diff.js";
import { finish, handEdited, loadData, nowOf, staleDocs } from "./docs.js";
import { CHANGE_TYPES, DIRS, checkRecord, newChange, newIdea, planRecord, schemaFor, setIdeaStatus, today } from "./records.js";
import * as release from "./release.js";
import { STATUS_LABEL, STATUS_ORDER, waiting } from "./render/pages.js";
import { events } from "./render/timeline.js";
import { compare } from "./semver.js";
import { adopt, ignore, init, sync } from "./setup.js";
import { takeSnapshot } from "./snapshot.js";

function need(ctx) {
  const config = loadConfig(ctx.repo);
  if (!config) throw usage("Syno isn't set up in this folder yet. Run /syno:init first.");
  return config;
}

const author = (ctx, config) => (config.chronicle.recordAuthors ? userName(ctx.repo) : null);
const listFlag = (v) => (typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);
const head = (root) => (isRepo(root) ? tryGit(["rev-parse", "--verify", "--quiet", "HEAD"], { cwd: root }) : null);

async function idea(ctx, [sub, ...rest]) {
  const config = need(ctx);
  const data = loadData(ctx.repo, config);
  if (sub === "list") return { code: 0, text: STATUS_ORDER.flatMap((s) => data.ideas.filter((i) => i.status === s).map((i) => `${i.id}  ${STATUS_LABEL[s].padEnd(11)} ${i.title}`)).join("\n") || "No ideas yet.", data: { ideas: data.ideas } };
  const plan = new WritePlan(ctx.repo);
  let record;
  if (sub === "set") {
    const [id, status] = rest;
    const current = data.ideas.find((i) => i.id === id);
    if (!current) throw usage(`No idea ${id}.`);
    record = setIdeaStatus(current, status, { now: nowOf(ctx) });
  } else {
    const words = sub === "add" ? rest : [sub, ...rest].filter(Boolean);
    record = newIdea({ title: words.join(" ") || ctx.flags.title, problem: ctx.flags.problem, value: ctx.flags.value, notes: ctx.flags.notes, tags: listFlag(ctx.flags.tags) }, { ideas: data.ideas, now: nowOf(ctx), author: author(ctx, config) });
  }
  planRecord(plan, "idea", record);
  const ideas = [...data.ideas.filter((i) => i.id !== record.id), record];
  const intro = sub === "set" ? [`Move ${record.id} to ${STATUS_LABEL[record.status]}: ${record.title}`, ""] : [`New idea ${record.id}: ${record.title}`, ""];
  return finish(ctx, plan, config, loadState(ctx.repo), { intro, data: { ...data, ideas }, events: [{ type: "chronicle.idea", data: { id: record.id, title: record.title, status: record.status } }], extra: { idea: record.id } });
}

async function change(ctx, [sub, ...rest]) {
  const config = need(ctx);
  const data = loadData(ctx.repo, config);
  if (sub === "list") return { code: 0, text: data.pending.map((c) => `${c.type.padEnd(10)} ${c.summary}`).join("\n") || "No changes are waiting.", data: { pending: data.pending } };
  const type = CHANGE_TYPES.find((t) => t.toLowerCase() === String(ctx.flags.type ?? "").toLowerCase());
  if (!type) throw usage(`Say what kind of change with --type (${CHANGE_TYPES.join(", ")}).`);
  const words = sub === "add" ? rest : [sub, ...rest].filter(Boolean);
  const ideas = listFlag(ctx.flags.ideas);
  const missing = ideas.filter((id) => !data.ideas.some((i) => i.id === id));
  if (missing.length) throw usage(`No such idea: ${missing.join(", ")}.`);
  const record = newChange({ type, summary: words.join(" "), breaking: ctx.flags.breaking === true, ideas, details: ctx.flags.details }, { now: nowOf(ctx), author: author(ctx, config) });
  const plan = new WritePlan(ctx.repo);
  planRecord(plan, "change", record);
  return finish(ctx, plan, config, loadState(ctx.repo), { intro: [`New change: ${type}: ${record.summary}`, ""], data: { ...data, pending: [...data.pending, record] }, events: [{ type: "chronicle.change", data: { type, summary: record.summary, breaking: record.breaking } }], extra: { change: record.id } });
}

function diffText(d) {
  if (isEmptyDiff(d)) return ["No structure changes."];
  return [
    ...d.added.map((p) => `  Added:   ${p}`),
    ...d.removed.map((p) => `  Removed: ${p}`),
    ...d.renamed.map((r) => `  Renamed: ${r.from} → ${r.to}`),
    ...d.topLevel.map((t) => `  ${t.path}: ${t.filesDelta >= 0 ? "+" : ""}${t.filesDelta} files`),
  ];
}

/** /syno:structure — a snapshot now, compared with the last release (CH-07). Writing it is optional. */
async function structure(ctx) {
  const config = need(ctx);
  const data = loadData(ctx.repo, config);
  const last = data.releases.map((r) => data.snapshots.find((s) => s.id === r.version)).find(Boolean) ?? data.snapshots.find((s) => s.id === "baseline") ?? null;
  const date = today(nowOf(ctx));
  const snap = takeSnapshot(ctx.repo, config.chronicle, { id: typeof ctx.flags.id === "string" ? ctx.flags.id : date, date, ref: head(ctx.repo), previous: last });
  const intro = [`Folders now: ${snap.totals.files} files in ${snap.folders.length} folders.`, `Compared with ${last ? last.id : "nothing yet"}:`, ...diffText(snap.diffFromPrevious ?? { added: [], removed: [], renamed: [], topLevel: [], moves: [] }), ""];
  const plan = new WritePlan(ctx.repo);
  planRecord(plan, "snapshot", snap);
  return finish(ctx, plan, config, loadState(ctx.repo), { intro, data: { ...data, snapshots: [...data.snapshots.filter((s) => s.id !== snap.id), snap] }, extra: { snapshot: snap.id, diff: snap.diffFromPrevious } });
}

function diff(ctx, [from, to]) {
  const config = need(ctx);
  const snaps = loadData(ctx.repo, config).snapshots;
  const find = (id) => snaps.find((s) => s.id === id) ?? (() => { throw usage(`No snapshot ${id}.`); })();
  const b = to ? find(to) : takeSnapshot(ctx.repo, config.chronicle, { id: "now", date: today(nowOf(ctx)), ref: head(ctx.repo), previous: from ? find(from) : snaps.at(-1) ?? null });
  const d = to ? takeSnapshot(ctx.repo, config.chronicle, { id: b.id, date: b.date, ref: b.ref, previous: find(from) }).diffFromPrevious : b.diffFromPrevious;
  return { code: 0, text: diffText(d).join("\n"), data: { diff: d } };
}

function timeline(ctx) {
  const config = need(ctx);
  const limit = Number(ctx.flags.limit) || 20;
  const list = events(loadData(ctx.repo, config)).slice(0, limit);
  return { code: 0, text: list.map((e) => `${readerDate(e.date).padEnd(12)} ${e.text}`).join("\n") || "Nothing has happened yet.", data: { events: list } };
}

async function render(ctx) {
  const config = need(ctx);
  if (ctx.flags.check === true) {
    const stale = staleDocs(ctx.repo, config);
    return { code: stale.length ? 1 : 0, text: stale.length ? ["These generated files are out of date. Run /syno:status or syno render --confirm:", ...stale.map((p) => `  ${p}`)].join("\n") : "Docs are up to date.", data: { stale } };
  }
  return finish(ctx, new WritePlan(ctx.repo), config, loadState(ctx.repo));
}

function files(root, dir) {
  try {
    return readdirSync(join(root, dir)).filter((n) => n.endsWith(".json")).sort();
  } catch {
    return [];
  }
}

/** syno validate — schemas, duplicate IDs, broken idea links and release order (CH-13). */
function validate(ctx) {
  const config = need(ctx);
  const errors = [];
  for (const e of checkSchema(schemaFor("config"), readJson(join(ctx.repo, CONFIG_PATH), {}))) errors.push(`${CONFIG_PATH}: ${e.path} ${e.message}`);
  for (const e of checkSchema(schemaFor("state"), loadState(ctx.repo))) errors.push(`${STATE_PATH}: ${e.path} ${e.message}`);
  const ideaIds = new Set();
  for (const [kind, dir] of Object.entries(DIRS)) {
    for (const name of files(ctx.repo, dir)) {
      const file = `${dir}/${name}`;
      const record = readJson(join(ctx.repo, file));
      if (!record) {
        errors.push(`${file}: (record) is not valid JSON`);
        continue;
      }
      for (const e of checkRecord(kind, record)) errors.push(`${file}: ${e.path} ${e.message}`);
      const id = kind === "release" ? record.version : record.id;
      if (`${id}.json` !== name) errors.push(`${file}: ${kind === "release" ? "version" : "id"} ${id} doesn't match the file name`);
      if (kind === "idea") ideaIds.add(record.id);
    }
  }
  const data = loadData(ctx.repo, config);
  for (const c of [...data.pending, ...data.releases.flatMap((r) => r.changes)]) for (const id of c.ideas ?? []) if (!ideaIds.has(id)) errors.push(`${c.file ?? DIRS.release}: ideas links to ${id}, which doesn't exist`);
  const asc = [...data.releases].sort((a, b) => compare(a.version, b.version));
  for (let i = 1; i < asc.length; i++) if (asc[i].date < asc[i - 1].date) errors.push(`${DIRS.release}/${asc[i].version}.json: date ${asc[i].date} is before ${asc[i - 1].version} (${asc[i - 1].date})`);
  return { code: errors.length ? 1 : 0, text: errors.length ? errors.join("\n") : "All records are valid.", data: { errors } };
}

function status(ctx) {
  const config = need(ctx);
  const data = loadData(ctx.repo, config);
  const state = loadState(ctx.repo);
  const known = new Set(data.releases.map((r) => r.version));
  const unsynced = isRepo(ctx.repo) ? readTags(ctx.repo, config.chronicle.tagPattern).tags.filter((t) => !known.has(t.version)).map((t) => t.tag) : [];
  const stale = staleDocs(ctx.repo, config);
  const edited = handEdited(ctx.repo, config, state);
  const ideas = Object.fromEntries(STATUS_ORDER.map((s) => [s, data.ideas.filter((i) => i.status === s).length]));
  const latest = data.releases[0];
  const lines = [
    latest ? `Version ${latest.version}, released ${readerDate(latest.date)}.` : "No release yet.",
    waiting(data.pending.length),
    `Ideas: ${STATUS_ORDER.filter((s) => ideas[s]).map((s) => `${ideas[s]} ${STATUS_LABEL[s].toLowerCase()}`).join(", ") || "none yet"}.`,
    ...(unsynced.length ? [`Tags not recorded yet: ${unsynced.join(", ")}. Run /syno:sync.`] : []),
    ...(stale.length ? [`Docs out of date: ${stale.length} files. Run syno render --confirm.`] : []),
    ...(edited.length ? [`Pages edited by hand: ${edited.join(", ")}.`] : []),
  ];
  return { code: 0, text: lines.join("\n"), data: { version: latest?.version ?? null, pending: data.pending.length, ideas, unsynced, stale, handEdited: edited } };
}

const RELEASE = { plan: release.plan, cut: release.cut, yank: release.yank, publish: release.publish, notes: release.notes, bump: release.bump, tag: release.tag };

export async function run(ctx) {
  const [sub, ...rest] = ctx.args;
  switch (sub) {
    case "init":
      return init(ctx);
    case "adopt":
      return adopt(ctx);
    case "ignore":
      return ignore(ctx);
    case "idea":
      return idea(ctx, rest);
    case "change":
      return change(ctx, rest);
    case "release": {
      need(ctx);
      const [action = "plan", ...args] = rest;
      if (!RELEASE[action]) throw usage(`release takes: ${Object.keys(RELEASE).join(", ")}.`);
      return RELEASE[action](ctx, args);
    }
    case "publish":
    case "notes":
      need(ctx);
      return RELEASE[sub](ctx, rest);
    case "snapshot":
    case "structure":
      return structure(ctx);
    case "diff":
      return diff(ctx, rest);
    case "timeline":
      return timeline(ctx);
    case "render":
      return render(ctx);
    case "validate":
      return validate(ctx);
    case "sync":
      need(ctx);
      return sync(ctx);
    case "status":
    case undefined:
      return status(ctx);
    default:
      throw usage(`Chronicle doesn't know "${sub}". Try: init, idea, change, release, publish, notes, structure, timeline, sync, render, validate, status.`);
  }
}
