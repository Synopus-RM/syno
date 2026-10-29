#!/usr/bin/env node
// One dispatcher for every Syno hook (PRD X-02). hooks.json sends each event
// here; each function's handler runs in a fixed order, in its own try/catch and
// time budget, so one failing or slow function never stops the others. Every
// hook fails open: on any error it exits 0 and shows nothing.
//
// A handler module exports `handle(event, input, env)` and returns
//   { lines?: string[] }   lines for the session-start brief
//   { context?: string }   text added to Claude's context
//   { decision?: { permissionDecision, permissionDecisionReason } }   PreToolUse only
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { composeBrief, strictestDecision } from "../lib/brief.js";

const lib = (rel) => fileURLToPath(new URL(`../lib/${rel}`, import.meta.url));

// Order matters: the Governor gates first, Pulse records, then the briefs.
export const HANDLERS = [
  { name: "governor", path: lib("governor/hooks.js"), budgetMs: 12000 },
  { name: "pulse", path: lib("pulse/hooks.js"), budgetMs: 100 },
  { name: "chronicle", path: lib("chronicle/hooks.js"), budgetMs: 1000 },
  { name: "pause", path: lib("pause/hooks.js"), budgetMs: 200 },
  { name: "sigma", path: lib("sigma/hooks.js"), budgetMs: 200 },
  { name: "fives", path: lib("fives/hooks.js"), budgetMs: 200 },
  { name: "migrate", path: lib("migrate/hooks.js"), budgetMs: 200 },
];

const debug = (msg) => process.env.SYNO_DEBUG && process.stderr.write(`syno hook: ${msg}\n`);

/** Runs one handler within its budget; a throw or a timeout counts as "nothing to add". */
async function runOne(handler, event, input, env) {
  let timer;
  try {
    const mod = handler.handle ? handler : existsSync(handler.path) ? await import(pathToFileURL(handler.path).href) : null;
    if (!mod?.handle) return null;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ timedOut: true }), handler.budgetMs);
    });
    const result = await Promise.race([Promise.resolve(mod.handle(event, input, env)), timeout]);
    if (result?.timedOut) {
      debug(`${handler.name} passed its ${handler.budgetMs} ms budget on ${event}`);
      return null;
    }
    return result ? { source: handler.name, ...result } : null;
  } catch (err) {
    debug(`${handler.name} failed on ${event}: ${err.message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Runs every handler for an event and merges their answers into one hook reply (or null). */
export async function dispatch(event, input, handlers = HANDLERS, env = {}) {
  const ctx = { cwd: resolve(input?.cwd || process.cwd()), ...env };
  const parts = [];
  for (const handler of handlers) {
    const part = await runOne(handler, event, input ?? {}, ctx);
    if (part) parts.push(part);
  }
  const decision = event === "PreToolUse" ? strictestDecision(parts) : null;
  const context = composeBrief(parts);
  if (!decision && !context) return null;
  const out = { hookEventName: event };
  if (decision) Object.assign(out, decision);
  if (context) out.additionalContext = context;
  return { hookSpecificOutput: out };
}

function readStdin(limitMs = 2000) {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve("");
    let data = "";
    const done = () => resolve(data);
    setTimeout(done, limitMs).unref();
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", done);
    process.stdin.on("error", done);
  });
}

async function main() {
  const raw = await readStdin();
  let input = {};
  try {
    input = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    input = {};
  }
  const event = process.argv[2] || input.hook_event_name;
  if (!event) return;
  const reply = await dispatch(event, input, HANDLERS, { pluginRoot: fileURLToPath(new URL("../..", import.meta.url)) });
  if (reply) process.stdout.write(JSON.stringify(reply));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main()
    .catch((err) => debug(`dispatcher failed: ${err.message}`))
    .finally(() => process.exit(0));
}
