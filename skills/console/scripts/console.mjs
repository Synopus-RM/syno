#!/usr/bin/env node
// Syno Console's command line (PRD S-17, design 5.12). The same file runs from
// the Syno plugin (`syno console …`) and from a project's cloud copy
// (`node .claude/skills/syno-console/scripts/console.mjs …`), with Node's
// standard library only. Reads print; writes plan first and need --confirm;
// `guard` and `brief-hook` are the hooks and always exit 0.
//   whoami | names <id> | card <id> | brief <id> --file | spawn <id> | verify <id> | tree
//   join | start | record <id> | decide --file | rule --text | question --file | numbers [<series>]
//   guard | brief-hook
import { readFileSync } from "node:fs";
import { dirname, join as joinPath, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { briefText, roleCard, spawnParams } from "./cards.mjs";
import { activeRules, decide, join, list, need, numbers, question, record, rule, start } from "./commands.mjs";
import { repoUrl, tryGitRead } from "./gitread.mjs";
import { judge } from "./guard.mjs";
import { checkSpawn, namesFor, refusal, usage } from "./model.mjs";
import { currentBranch, findRoot, listRecords, loadConfig, readJson, resolveRole } from "./store.mjs";
import { renderTree } from "./tree.mjs";
import { verifyChild } from "./verify.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const template = (name) => readFileSync(joinPath(HERE, "..", "references", name), "utf8");
const BOOLEAN = new Set(["confirm", "json", "check"]);
const NONE = Object.freeze({ code: 0, text: "", data: null });

export function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const word = argv[i];
    if (!word.startsWith("--")) {
      positional.push(word);
      continue;
    }
    const [key, inline] = word.slice(2).split(/=(.*)/s);
    if (inline !== undefined) flags[key] = inline;
    else if (BOOLEAN.has(key) || i + 1 >= argv.length || argv[i + 1].startsWith("--")) flags[key] = true;
    else flags[key] = argv[++i];
  }
  return { positional, flags };
}

function whoami(ctx) {
  const r = ctx.role;
  if (!r) return { code: 0, text: "No role: this session isn't in a Syno Console tree yet. A child session runs the join command from its role card; the Console runs start.", data: null };
  const n = namesFor(r.id, r.name ?? "", ctx.cfg);
  const parent = r.parentId ? ` Parent: ${r.parentId}${r.parentSession ? ` (session ${r.parentSession})` : ""}.` : "";
  const hint = r.inferred ? " Worked out from the branch name: run the join command from your role card to save the full role." : "";
  return { code: 0, text: `You are ${n.title} (${r.level} ${r.id}), on branch ${r.branch}.${parent}${r.consoleSession ? ` Console session: ${r.consoleSession}.` : ""}${hint}`, data: r };
}

function names(ctx) {
  const n = namesFor(ctx.positional[0] ?? "", ctx.flags.name, ctx.cfg);
  return { code: 0, text: [`Title: ${n.title}`, `Branch: ${n.branch}`, `Parent: ${n.parentId ?? "none"} (${n.parentBranch ?? "no branch"})`, `Tags: ${n.tags.join(", ")}`].join("\n"), data: n };
}

function sessions(ctx) {
  const r = ctx.role;
  const parentSession = ctx.flags["parent-session"] ?? r?.session;
  const consoleSession = ctx.flags["console-session"] ?? r?.consoleSession ?? (r?.level === "console" ? r.session : null);
  if (!parentSession || !consoleSession) throw usage("Pass --parent-session <your own session ID> and --console-session <the Console's session ID>; get_session shows them.");
  return { parentSession, consoleSession };
}

function makeCard(ctx, n, lane, parentSession, consoleSession) {
  return roleCard({ cfg: ctx.cfg, names: n, parent: { id: n.parentId, session: parentSession, branch: n.parentBranch }, consoleSession, lane, rules: activeRules(ctx.root), template: template("role-card.md") });
}

function card(ctx) {
  const n = namesFor(ctx.positional[0] ?? "", ctx.flags.name, ctx.cfg);
  const text = makeCard(ctx, n, list(ctx.flags.lane), need(ctx.flags, "parent-session", "<the parent's session ID>"), need(ctx.flags, "console-session", "<the Console's session ID>"));
  return { code: 0, text, data: { card: text } };
}

function brief(ctx) {
  const n = namesFor(ctx.positional[0] ?? "", ctx.flags.name, ctx.cfg);
  const input = readJson(resolve(ctx.cwd, need(ctx.flags, "file", "<brief.json>")));
  if (!input) throw usage("The brief file isn't JSON.");
  const text = briefText({ template: template("brief.md"), names: n, parentId: n.parentId, brief: input });
  return { code: 0, text, data: { brief: text } };
}

function spawn(ctx) {
  const childId = ctx.positional[0] ?? "";
  const lane = list(ctx.flags.lane);
  const check = checkSpawn({ role: ctx.role, childId, lane, nodes: listRecords(ctx.root, "nodes").records, cfg: ctx.cfg });
  if (!check.ok) throw refusal(`Refused: ${check.reasons.join(" ")}`);
  const n = namesFor(childId, ctx.flags.name, ctx.cfg);
  const { parentSession, consoleSession } = sessions(ctx);
  const input = ctx.flags["brief-file"] ? readJson(resolve(ctx.cwd, ctx.flags["brief-file"])) : null;
  const prompt = briefText({ template: template("brief.md"), names: n, parentId: ctx.role.id, brief: input ?? { goal: n.name || n.title, lane } });
  const params = spawnParams({ names: n, repoUrl: repoUrl(ctx.root) ?? ctx.flags["repo-url"] ?? null, card: makeCard(ctx, n, lane, parentSession, consoleSession), brief: prompt, cfg: ctx.cfg });
  const warnings = [];
  if (!params.source_url) warnings.push("No origin URL was found: pass --repo-url https://github.com/<owner>/<repo>.");
  if (!tryGitRead(["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${n.parentBranch}`], { cwd: ctx.root })) warnings.push(`Push your branch first (git push -u origin ${n.parentBranch}), so the new session can start from it.`);
  const next = `Then: console record ${n.id} --status running --session <the new session's ID>${n.name ? ` --name "${n.name}"` : ""}${lane.length ? ` --lane "${lane.join(",")}"` : ""} --confirm, commit and push.`;
  const text = [`Ready to create ${n.title} under ${ctx.role.id}.`, ...warnings.map((w) => `Warning: ${w}`), "Call create_session with exactly these parameters:", JSON.stringify(params, null, 2), next].join("\n");
  return { code: 0, text, data: { params, warnings } };
}

function verify(ctx) {
  const n = namesFor(ctx.positional[0] ?? "", "", ctx.cfg);
  const node = listRecords(ctx.root, "nodes").records.find((x) => x.id === n.id);
  const r = verifyChild(ctx.root, { childId: n.id, childBranch: n.branch, childRef: ctx.flags.ref, reportedHead: ctx.flags.head, lane: ctx.flags.lane ? list(ctx.flags.lane) : (node?.lane ?? []), shared: ctx.cfg.sharedFiles });
  const word = { green: "Green: ready to merge", amber: "Amber: ready, with points to judge", red: "Red: don't merge; send [SYNO rework]" }[r.verdict];
  return { code: r.verdict === "red" ? 1 : 0, text: [`${word} (${n.title}).`, ...r.reasons.map((x) => `- ${x}`), `${r.files.length} files changed.`].join("\n"), data: r };
}

function tree(ctx) {
  const live = typeof ctx.flags.live === "string" ? (readJson(resolve(ctx.cwd, ctx.flags.live)) ?? {}) : {};
  const t = renderTree({ nodes: listRecords(ctx.root, "nodes").records, questions: listRecords(ctx.root, "questions").records, cfg: ctx.cfg, live });
  return { code: 0, text: t.text, data: { verdict: t.verdict } };
}

const COMMANDS = { whoami, names, card, brief, spawn, verify, tree, join, start, record, decide, rule, question, numbers };

function readStdin(limitMs = 2000) {
  return new Promise((done) => {
    if (process.stdin.isTTY) return done("");
    let data = "";
    setTimeout(() => done(data), limitMs).unref();
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => done(data));
    process.stdin.on("error", () => done(data));
  });
}

function hookContext(raw, cwd) {
  const input = JSON.parse(raw);
  if (!input || typeof input !== "object") return null;
  const root = findRoot(input.cwd ?? cwd);
  if (!root) return null;
  const cfg = loadConfig(root);
  const role = resolveRole(root, cfg);
  return role ? { input, root, cfg, role } : null;
}

function guardHook(raw, cwd) {
  const h = hookContext(raw, cwd);
  const verdict = h && judge(h.input, { role: h.role, cfg: h.cfg, nodes: listRecords(h.root, "nodes").records, currentBranch: currentBranch(h.root) });
  return verdict ? { code: 0, text: JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", ...verdict } }), data: verdict } : NONE;
}

function briefHook(raw, cwd) {
  const h = hookContext(raw || "{}", cwd);
  if (!h) return NONE;
  const r = h.role;
  let text;
  if (r.level === "console") {
    const open = listRecords(h.root, "questions").records.filter((q) => q.status === "open").length;
    text = `Syno Console: this is the Console. ${open} open question(s). See the tree with: node .claude/skills/syno-console/scripts/console.mjs tree`;
  } else {
    const n = namesFor(r.id, r.name ?? "", h.cfg);
    text = `Syno Console: you are ${n.title} (${r.level} ${r.id}), on branch ${r.branch}; parent ${r.parentId}${r.parentSession ? ` (session ${r.parentSession})` : ""}. Questions go up as [SYNO question]; push only your own branch.${r.inferred ? " Your role was worked out from the branch name: run the join command from your role card." : ""}`;
  }
  return { code: 0, text: JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text } }), data: { context: text } };
}

/** Runs one subcommand and returns { code, text, data }; never throws. */
export async function runConsole(argv, opts = {}) {
  const { positional, flags } = parseArgs(argv);
  const [cmd, ...rest] = positional;
  const cwd = resolve(opts.cwd ?? process.cwd());
  if (cmd === "guard" || cmd === "brief-hook") {
    try {
      const raw = opts.stdin ?? (await readStdin());
      return (cmd === "guard" ? guardHook : briefHook)(raw, cwd);
    } catch {
      return NONE;
    }
  }
  if (!COMMANDS[cmd]) return { code: 2, text: `Usage: console <${Object.keys(COMMANDS).join("|")}|guard|brief-hook> [args] [--json] [--confirm]`, data: null };
  try {
    const root = findRoot(cwd);
    if (!root) throw usage("Run this inside the project's git repository.");
    const cfg = loadConfig(root);
    const ctx = { root, cwd, cfg, role: resolveRole(root, cfg), positional: rest, flags, confirm: flags.confirm === true, now: opts.now ?? new Date() };
    return await COMMANDS[cmd](ctx);
  } catch (err) {
    return { code: err.exit ?? 1, text: err.message, data: null };
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  runConsole(process.argv.slice(2)).then((r) => {
    const out = process.argv.includes("--json") && r.data !== null ? JSON.stringify(r.data, null, 2) : r.text;
    if (out) (r.code === 0 ? process.stdout : process.stderr).write(`${out.replace(/\n$/, "")}\n`);
    process.exit(r.code);
  });
}
