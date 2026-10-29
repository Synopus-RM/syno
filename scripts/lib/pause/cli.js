// Syno Pause (PRD S-12). /syno:pause saves where a session stopped in
// .syno/sessions/ (git-ignored), so any later session can carry on. Claude
// writes what it knows (goal, done, next steps, decisions) as JSON; this adds
// the facts it can check (branch, last commit, uncommitted files, tests and
// gates, queued Governor jobs) and redacts anything that looks like a secret.
// Pause runs only when asked and sends nothing to Pulse.
//   syno pause --file <session.json> [--confirm]
//   syno resume [list]
//   syno resume <file> [--confirm]      --confirm records resumedAt
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, join } from "node:path";
import { WritePlan, readJson, readText, usage } from "../fsutil.js";
import { isRepo, tryGit } from "../git.js";
import { loadConfig } from "../chronicle/config.js";
import { describePlan, nowOf } from "../chronicle/docs.js";
import { slugify, stamp, today } from "../chronicle/records.js";
import { readerDate } from "../report/render.js";
import { redactText } from "../pulse/redact.js";
import { RUNS } from "../sigma/measure.js";

export const DIR = ".syno/sessions";
const require = createRequire(import.meta.url);
const clean = (s) => redactText(String(s ?? "")) ?? "";
// Local date and time, as the owner reads it: 2026-10-30T10:00:00.
const localTime = (now) => `${today(now)}T${stamp(now).slice(9).replace(/(\d{2})(\d{2})(\d{2})/, "$1:$2:$3")}`;
const list = (v) => (Array.isArray(v) ? v.map(clean).filter(Boolean) : []);

/** Branch, last commit and uncommitted files, or nulls outside git. */
export function codeState(root) {
  if (!isRepo(root)) return { branch: null, commit: null, uncommitted: [] };
  const porcelain = tryGit(["status", "--porcelain"], { cwd: root }) ?? "";
  return {
    branch: tryGit(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root }),
    commit: tryGit(["log", "-1", "--format=%h %s"], { cwd: root }),
    uncommitted: porcelain.split("\n").filter(Boolean).map((l) => l.slice(3)).filter((f) => !f.startsWith(`${DIR}/`)).sort(),
  };
}

function lastTestRun(root) {
  try {
    const runs = readFileSync(join(root, RUNS), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.kind === "test");
    const r = runs.at(-1);
    return r ? `${r.ok ? "passed" : "failed"} (${r.passed} passed, ${r.failed} failed) at ${r.at}` : "none logged";
  } catch {
    return "none logged";
  }
}

/** Governor jobs still waiting or running for this project (read-only). */
function governorJobs(root) {
  try {
    const state = require("../../governor/lib/state.js");
    const project = state.projectOf(root);
    return state.loadQueue().tickets.filter((t) => t.project === project).map((t) => `${t.label} (${t.state})`);
  } catch {
    return [];
  }
}

const section = (heading, items, numbered = false) => (items.length ? [`## ${heading}`, "", ...items.map((x, i) => `${numbered ? `${i + 1}.` : "-"} ${x}`), ""] : []);

export function sessionMarkdown(s, facts, name) {
  const meta = { title: s.title, paused: facts.at, branch: facts.code.branch, commit: facts.code.commit, uncommitted: facts.code.uncommitted, resumedAt: null };
  return [
    "---",
    ...Object.entries(meta).map(([k, v]) => `${k}: ${JSON.stringify(v)}`),
    "---",
    "",
    `# Paused: ${s.title}`,
    "",
    ...(s.goal ? [`**Goal:** ${s.goal}`, ""] : []),
    ...(s.note ? [`**Note:** ${s.note}`, ""] : []),
    ...section("Done", s.done),
    ...section("In progress", s.inProgress),
    ...section("Next steps", s.next, true),
    ...section("Decisions only the owner can make", s.decisions),
    ...section("Key files", s.files),
    "## Where the code stands",
    "",
    `- Branch: ${facts.code.branch ?? "not a git repository"}`,
    ...(facts.code.commit ? [`- Last commit: ${facts.code.commit}`] : []),
    `- Uncommitted files (${facts.code.uncommitted.length}):${facts.code.uncommitted.length ? "" : " none"}`,
    ...facts.code.uncommitted.map((f) => `  - ${f}`),
    "",
    "## Tests and gates",
    "",
    `- Last test run: ${facts.tests}`,
    `- Release gate: ${facts.gate}`,
    "",
    ...section("Governor jobs still queued", facts.jobs),
    "## To resume",
    "",
    `Paste this into any session: \`/syno:resume ${name}\``,
    "",
  ].join("\n");
}

async function pause(ctx) {
  const raw = typeof ctx.flags.file === "string" ? readJson(ctx.flags.file) : null;
  if (!raw?.title) throw usage("Pass what to save with --file <session.json>; it needs at least a title.");
  const s = { title: clean(raw.title), goal: clean(raw.goal), note: clean(raw.note), done: list(raw.done), inProgress: list(raw.inProgress), next: list(raw.next), decisions: list(raw.decisions), files: list(raw.files) };
  const now = nowOf(ctx);
  const { gate } = await import("../sigma/gate.js");
  const g = await gate(ctx.repo, loadConfig(ctx.repo), "release");
  const facts = { at: localTime(now), code: codeState(ctx.repo), tests: lastTestRun(ctx.repo), gate: g.text, jobs: governorJobs(ctx.repo) };
  const name = `${stamp(now)}-${slugify(s.title, 32)}.md`;
  const plan = new WritePlan(ctx.repo).write(`${DIR}/${name}`, sessionMarkdown(s, facts, name));
  const ignore = readText(join(ctx.repo, ".gitignore"), "") ?? "";
  if (!ignore.split("\n").some((l) => l.trim() === `${DIR}/`)) plan.write(".gitignore", `${ignore}${ignore && !ignore.endsWith("\n") ? "\n" : ""}${DIR}/\n`);
  const applied = plan.apply({ confirm: ctx.confirm });
  return { code: 0, text: [`Save "${s.title}" so any session can pick it up.`, describePlan(plan, applied.applied)].join("\n"), data: { applied: applied.applied, file: `${DIR}/${name}`, uncommitted: facts.code.uncommitted } };
}

export function parseSession(text) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) return null;
  const meta = Object.fromEntries(m[1].split("\n").map((l) => /^(\w+): (.*)$/.exec(l)).filter(Boolean).map(([, k, v]) => [k, JSON.parse(v)]));
  return { meta, body: text.slice(m[0].length) };
}

/** Paused sessions, newest first. */
export function sessions(root) {
  let names = [];
  try {
    names = readdirSync(join(root, DIR)).filter((n) => n.endsWith(".md")).sort().reverse();
  } catch {}
  return names.map((name) => ({ name, ...parseSession(readFileSync(join(root, DIR, name), "utf8")) })).filter((s) => s.meta);
}

/** What changed since the pause: the warnings shown before any next step (AC-PS.3). */
export function differences(meta, now) {
  const out = [];
  if (meta.branch && now.branch !== meta.branch) out.push(`Warning: this was paused on branch ${meta.branch}, but you are on ${now.branch ?? "no branch"} now. Switch back, or confirm you want to carry on here.`);
  const gone = meta.uncommitted.filter((f) => !now.uncommitted.includes(f));
  const added = now.uncommitted.filter((f) => !meta.uncommitted.includes(f));
  if (gone.length) out.push(`Warning: ${gone.length} file(s) that were uncommitted at the pause aren't any more (committed or undone): ${gone.join(", ")}.`);
  if (added.length) out.push(`Warning: ${added.length} file(s) changed since the pause: ${added.join(", ")}.`);
  return out;
}

function resume(ctx, [which]) {
  const all = sessions(ctx.repo);
  if (!which || which === "list") {
    if (!all.length) return { code: 0, text: "No paused sessions here. /syno:pause saves one.", data: { sessions: [] } };
    return { code: 0, text: all.map((s) => `- ${s.name}: ${s.meta.title} (${readerDate(s.meta.paused.slice(0, 10))}, branch ${s.meta.branch ?? "none"})${s.meta.resumedAt ? ", resumed" : ""}`).join("\n"), data: { sessions: all.map(({ body, ...s }) => s) } };
  }
  const s = all.find((x) => x.name === basename(which));
  if (!s) throw usage(`No paused session ${which}. Run "syno resume list".`);
  const warnings = differences(s.meta, codeState(ctx.repo));
  const plan = new WritePlan(ctx.repo);
  const now = nowOf(ctx);
  const text = readFileSync(join(ctx.repo, DIR, s.name), "utf8").replace(/^resumedAt: .*$/m, `resumedAt: ${JSON.stringify(now.toISOString())}`);
  plan.write(`${DIR}/${s.name}`, text);
  const applied = plan.apply({ confirm: ctx.confirm });
  return { code: 0, text: [...warnings, ...(warnings.length ? [""] : []), s.body.trim(), "", applied.applied ? "Marked as resumed." : "Add --confirm to mark it as resumed."].join("\n"), data: { applied: applied.applied, warnings, meta: s.meta } };
}

export async function run(ctx) {
  const [sub, ...rest] = ctx.args;
  if (sub === "resume") return resume(ctx, rest);
  return pause(ctx);
}
