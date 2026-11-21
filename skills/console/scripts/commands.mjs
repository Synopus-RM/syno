// Syno Console's writes (PRD S-17, design 5.9 to 5.11): join, start, record,
// decide, rule, question and numbers. Each one plans its files and writes them
// only with --confirm. Decisions, rules, questions and number blocks belong to
// the Console alone; a node record belongs to the node's parent alone.
import { resolve } from "node:path";
import { STANDING_RULES, namesFor, parseId, refusal, usage } from "./model.mjs";
import { CONFIG_PATH, Plan, RECORDS_DIR, ROLE_PATH, currentBranch, describeWrites, jsonText, listRecords, mergeConsoleConfig, nextNumber, readJson, readText } from "./store.mjs";
import { GENERATED, registerPage, rulebookPage } from "./pages.mjs";

export const STATUSES = ["planned", "running", "handed-off", "merged", "archived", "rework", "stopped"];
const iso = (now) => now.toISOString().replace(/\.\d{3}Z$/, "Z");
const day = (now) => iso(now).slice(0, 10);
export const list = (v) => (typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);
const byId = (a, b) => String(a.id).localeCompare(String(b.id), "en", { numeric: true });

export function need(flags, key, hint) {
  const v = flags[key];
  if (typeof v !== "string" || !v.trim()) throw usage(`Pass --${key} ${hint}.`);
  return v.trim();
}

function consoleOnly(role) {
  if (role?.level !== "console") throw refusal("Refused: only Syno Console records decisions, rules, questions and number blocks. Send it up as a [SYNO question].");
}

function readInput(ctx) {
  const path = need(ctx.flags, "file", "<file.json>");
  const value = readJson(resolve(ctx.cwd, path));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw usage(`${path} isn't a JSON object.`);
  return value;
}

function finish(plan, ctx, summary, data = {}) {
  const { applied } = plan.apply({ confirm: ctx.confirm });
  return { code: 0, text: [summary, describeWrites(plan, applied)].join("\n"), data: { applied, ops: plan.describe(), ...data } };
}

function ensureIgnore(plan, root) {
  const text = readText(resolve(root, ".gitignore")) ?? "";
  if (!text.split("\n").some((l) => l.trim() === ".syno/local/")) plan.write(".gitignore", `${text}${text && !text.endsWith("\n") ? "\n" : ""}.syno/local/\n`);
}

/** Writes a generated page only when it is missing or still Syno's own. */
function writePage(plan, root, rel, text) {
  const current = readText(resolve(root, rel));
  if (current === null || current.includes(GENERATED)) plan.write(rel, text);
}

/** Keeps the first join time when nothing else about the role changed, so a second join writes nothing. */
function roleRecord(root, role, now) {
  const old = readJson(resolve(root, ROLE_PATH));
  const same = old && JSON.stringify({ ...old, joinedAt: null }) === JSON.stringify({ ...role, joinedAt: null });
  return { ...role, joinedAt: same ? old.joinedAt : iso(now) };
}

/** Every ID a record folder holds, readable or not, so a number is never reused. */
function taken(root, kind) {
  const { records, skipped } = listRecords(root, kind);
  return [...records, ...skipped.map((p) => ({ id: p.split("/").pop().replace(/\.json$/, "") }))];
}

export function activeRules(root) {
  const { records } = listRecords(root, "rules");
  const replaced = new Set(records.map((r) => r.supersedes).filter(Boolean));
  const active = records.filter((r) => !replaced.has(r.id)).sort(byId);
  return active.length ? active : STANDING_RULES;
}

export function join(ctx) {
  const { flags, cfg, root } = ctx;
  const names = namesFor(need(flags, "id", "<this session's ID, from the role card>"), flags.name, cfg);
  if (names.level === "console") throw usage("The Console runs start, not join.");
  const old = readJson(resolve(root, ROLE_PATH));
  const role = roleRecord(root, {
    schemaVersion: 1, level: names.level, id: names.id, name: names.name, branch: names.branch, parentId: names.parentId, parentBranch: names.parentBranch,
    parentSession: need(flags, "parent-session", "<your parent's session ID>"), consoleSession: need(flags, "console-session", "<the Console's session ID>"),
    session: flags.session ?? old?.session ?? null, lane: list(flags.lane), joinedAt: null,
  }, ctx.now);
  const plan = new Plan(root).write(ROLE_PATH, jsonText(role));
  ensureIgnore(plan, root);
  const cur = currentBranch(root);
  const warn = cur && cur !== names.branch ? `\nThis checkout is on ${cur}. Work on your own branch: git checkout -B ${names.branch}` : "";
  return finish(plan, ctx, `Join the Syno Console tree as ${names.title} (${names.level}).${warn}`, { role });
}

export function start(ctx) {
  const { flags, cfg, root, role, now } = ctx;
  if (role && role.level !== "console") throw refusal(`Refused: this checkout belongs to ${role.id}. start belongs in the Syno Console session.`);
  const branch = flags.branch ?? cfg.syno?.branch ?? currentBranch(root);
  if (!branch) throw usage("Pass --branch <the Syno branch>, the branch the Console collects every phase into.");
  if (flags["ask-at"] && !["console", "phase"].includes(flags["ask-at"])) throw usage("--ask-at is console or phase.");
  const group = { syno: { ...cfg.syno, branch }, ...(flags["ask-at"] ? { askAt: flags["ask-at"] } : {}), ...(flags.label ? { label: flags.label } : {}) };
  const after = { ...cfg, ...group };
  const plan = new Plan(root).write(CONFIG_PATH, mergeConsoleConfig(readText(resolve(root, CONFIG_PATH)), group));
  const { records } = listRecords(root, "rules");
  const rules = records.length ? activeRules(root) : STANDING_RULES.map((r) => ({ schemaVersion: 1, id: r.id, text: r.text, scope: "project", since: day(now), supersedes: null }));
  if (!records.length) for (const r of rules) plan.write(`${RECORDS_DIR}/rules/${r.id}.json`, jsonText(r));
  const old = readJson(resolve(root, ROLE_PATH));
  const session = flags.session ?? old?.session ?? null;
  const me = { schemaVersion: 1, level: "console", id: "console", name: "", branch, parentId: null, parentBranch: null, parentSession: null, consoleSession: session, session, lane: [], joinedAt: null };
  plan.write(ROLE_PATH, jsonText(roleRecord(root, me, now)));
  ensureIgnore(plan, root);
  writePage(plan, root, after.rulebook, rulebookPage(after, rules));
  const title = namesFor("console", "", after).title;
  return finish(plan, ctx, `Make this session ${title} for ${cfg.project}, collecting into ${branch}. Then name the session "${title}" with set_session_title.`);
}

function nodeRecord(names, old, flags, now) {
  const status = flags.status;
  const node = {
    schemaVersion: 1, id: names.id, level: names.level, name: flags.name ?? old?.name ?? "", ref: flags.ref ?? old?.ref ?? null, parentId: names.parentId,
    sessionId: flags.session ?? old?.sessionId ?? null, branch: names.branch, parentBranch: names.parentBranch,
    lane: flags.lane ? list(flags.lane) : (old?.lane ?? []), status, createdAt: old?.createdAt ?? iso(now),
    mergedAt: status === "merged" ? (old?.status === "merged" ? old.mergedAt : iso(now)) : (old?.mergedAt ?? null),
    mergeCommit: flags.merge ?? old?.mergeCommit ?? null, headCommit: flags.head ?? old?.headCommit ?? null,
    archivedAt: status === "archived" ? (old?.status === "archived" ? old.archivedAt : iso(now)) : (old?.archivedAt ?? null),
    deliveries: [...(old?.deliveries ?? [])],
  };
  if (flags.merge && !node.deliveries.some((d) => d.merge === flags.merge)) node.deliveries.push({ merge: flags.merge, at: iso(now) });
  return node;
}

export function record(ctx) {
  const { flags, cfg, root, role } = ctx;
  const id = parseId(ctx.positional[0] ?? "")?.id;
  if (!id) throw usage("Name the node to record, for example: record A.M1.T1 --status merged --merge <sha>.");
  const { records } = listRecords(root, "nodes");
  const old = records.find((n) => n.id === id);
  const names = namesFor(id, flags.name ?? old?.name ?? "", cfg);
  if (!role) throw refusal("Refused: this session has no Syno Console role. Run join (or start, in the Console) first.");
  const ancestor = role.level === "console" || id.startsWith(`${role.id}.`);
  if (role.inferred || !ancestor) throw refusal(`Refused: only ${names.parentId}, the parent (or an ancestor on its behalf), records ${id}. This session is ${role.id}${role.inferred ? " and hasn't joined yet" : ""}.`);
  if (!STATUSES.includes(need(flags, "status", `<${STATUSES.join("|")}>`))) throw usage(`--status is one of ${STATUSES.join(", ")}.`);
  if (["merged", "archived"].includes(flags.status) && !(flags.merge ?? old?.mergeCommit)) throw usage(`A ${flags.status} record needs --merge <the merge commit>, so the archive guard can prove it is pushed.`);
  const plan = new Plan(root).write(`${RECORDS_DIR}/nodes/${id}.json`, jsonText(nodeRecord(names, old, flags, ctx.now)));
  if (typeof flags.report === "string") {
    const text = readText(resolve(ctx.cwd, flags.report));
    if (text === null) throw usage(`Can't read the report ${flags.report}.`);
    const rel = `${RECORDS_DIR}/reports/${id}.md`;
    const prev = readText(resolve(root, rel));
    plan.write(rel, prev === null ? `${text.trim()}\n` : prev.includes(text.trim()) ? prev : `${prev.trimEnd()}\n\n---\n\n${text.trim()}\n`);
  }
  return finish(plan, ctx, `Record ${names.title} as ${flags.status}.`);
}

export function decide(ctx) {
  consoleOnly(ctx.role);
  const input = readInput(ctx);
  if (!String(input.question ?? "").trim() || !String(input.chosen ?? "").trim()) throw usage("A decision needs question and chosen.");
  const decisions = listRecords(ctx.root, "decisions").records;
  if (input.supersedes && !decisions.some((d) => d.id === input.supersedes)) throw usage(`${input.supersedes} isn't a recorded decision.`);
  const id = nextNumber(taken(ctx.root, "decisions"), "D");
  const rec = {
    schemaVersion: 1, id, scope: input.scope ?? "project", question: String(input.question), options: Array.isArray(input.options) ? input.options.map(String) : [],
    chosen: String(input.chosen), reason: input.reason ?? null, questionId: input.questionId ?? null, askedBy: input.askedBy ?? null,
    decidedAt: iso(ctx.now), supersedes: input.supersedes ?? null, by: "owner",
  };
  const plan = new Plan(ctx.root).write(`${RECORDS_DIR}/decisions/${id}.json`, jsonText(rec));
  const q = rec.questionId ? listRecords(ctx.root, "questions").records.find((x) => x.id === rec.questionId) : null;
  if (q) plan.write(`${RECORDS_DIR}/questions/${q.id}.json`, jsonText({ ...q, status: "answered", decision: id }));
  writePage(plan, ctx.root, ctx.cfg.register, registerPage([...decisions, rec]));
  return finish(plan, ctx, `Record ${id}: ${rec.question} → ${rec.chosen}. Then send [SYNO decision] ${id} to the session that asked, every level in between, and the running sessions in scope ${rec.scope}.`, { decision: rec });
}

export function rule(ctx) {
  consoleOnly(ctx.role);
  const text = need(ctx.flags, "text", '"<the rule in one plain sentence>"');
  const rules = listRecords(ctx.root, "rules").records;
  const supersedes = ctx.flags.supersedes ?? null;
  if (supersedes && !rules.some((r) => r.id === supersedes)) throw usage(`${supersedes} isn't a recorded rule.`);
  const rec = { schemaVersion: 1, id: nextNumber(taken(ctx.root, "rules"), "R"), text, scope: ctx.flags.scope ?? "project", since: day(ctx.now), supersedes };
  const plan = new Plan(ctx.root).write(`${RECORDS_DIR}/rules/${rec.id}.json`, jsonText(rec));
  const replaced = new Set([...rules.map((r) => r.supersedes), supersedes].filter(Boolean));
  writePage(plan, ctx.root, ctx.cfg.rulebook, rulebookPage(ctx.cfg, [...rules, rec].filter((r) => !replaced.has(r.id)).sort(byId)));
  return finish(plan, ctx, `Record ${rec.id}. Then send [SYNO rule] ${rec.id} to every running session.`, { rule: rec });
}

export function question(ctx) {
  consoleOnly(ctx.role);
  const input = readInput(ctx);
  const from = parseId(String(input.from ?? ""))?.id;
  if (!from || !String(input.text ?? "").trim()) throw usage("A question needs from (the asking session's ID) and text.");
  const mine = taken(ctx.root, "questions").filter((q) => String(q.id).startsWith(`Q-${from}-`));
  const nn = mine.reduce((m, q) => Math.max(m, Number(/-(\d+)$/.exec(q.id)?.[1] ?? 0)), 0) + 1;
  const rec = { schemaVersion: 1, id: `Q-${from}-${String(nn).padStart(2, "0")}`, from, path: Array.isArray(input.path) ? input.path : [], text: String(input.text), options: Array.isArray(input.options) ? input.options.map(String) : [], blocking: input.blocking === true, status: "open", decision: null, receivedAt: iso(ctx.now) };
  const plan = new Plan(ctx.root).write(`${RECORDS_DIR}/questions/${rec.id}.json`, jsonText(rec));
  return finish(plan, ctx, `Record ${rec.id} from ${from}. Ask the owner with AskUserQuestion, then decide.`, { question: rec });
}

export function numbers(ctx) {
  const series = ctx.positional[0];
  if (!series) {
    const recs = listRecords(ctx.root, "numbers").records;
    const lines = recs.flatMap((r) => r.blocks.map((b) => `${r.series} ${b.from} … ${b.until} → ${b.to}`));
    return { code: 0, text: lines.length ? lines.join("\n") : "No number blocks handed out yet.", data: { numbers: recs } };
  }
  consoleOnly(ctx.role);
  if (!ctx.cfg.numbers.includes(series)) throw usage(`${series} isn't in console.numbers. Add it there first, so everyone knows the Console hands it out.`);
  const to = parseId(need(ctx.flags, "to", "<the node that gets the block>"))?.id;
  const count = Number(need(ctx.flags, "count", "<how many numbers>"));
  if (!to || !Number.isInteger(count) || count < 1) throw usage("--to is a node ID and --count a whole number of 1 or more.");
  const rel = `${RECORDS_DIR}/numbers/${series}.json`;
  const old = readJson(resolve(ctx.root, rel));
  if (!old && readText(resolve(ctx.root, rel)) !== null) throw usage(`Syno can't read ${rel}. Fix it from git history first, so no block is handed out twice.`);
  const from = old?.next ?? Number(ctx.flags.start);
  if (!Number.isInteger(from) || from < 0) throw usage(`Pass --start <the first free ${series} number> the first time.`);
  const block = { to, from, until: from + count - 1, at: day(ctx.now) };
  const rec = { schemaVersion: 1, series, next: from + count, blocks: [...(old?.blocks ?? []), block] };
  const plan = new Plan(ctx.root).write(rel, jsonText(rec));
  return finish(plan, ctx, `Hand ${series} ${block.from} … ${block.until} to ${to}. Then send [SYNO numbers] to ${to}.`, { block });
}
