#!/usr/bin/env node
// Syno CLI entry (PRD X-04). Commands and skills call:
//   node "${CLAUDE_PLUGIN_ROOT}/scripts/syno.js" <function> <subcommand> [args] [--json] [--repo <path>] [--confirm]
// Chronicle's subcommands also work at the top level (`syno init`, `syno release plan`).
// Exit codes: 0 done, 1 a check or gate failed, 2 a usage error, 3 refused.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { EXIT } from "./lib/fsutil.js";

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));

// One module per function; each exports `run(ctx)` → { code, text, data }.
const FUNCTIONS = {
  chronicle: "./lib/chronicle/cli.js",
  pulse: "./lib/pulse/cli.js",
  progress: "./lib/progress/cli.js",
  tasks: "./lib/tasks/cli.js",
  audit: "./lib/audit/cli.js",
  devices: "./lib/devices/cli.js",
  test: "./lib/testguide/cli.js",
  pause: "./lib/pause/cli.js",
  resume: "./lib/pause/cli.js",
  sigma: "./lib/sigma/cli.js",
  fives: "./lib/fives/cli.js",
  compliance: "./lib/compliance/cli.js",
  security: "./lib/security/cli.js",
  status: "./lib/status/cli.js",
  doctor: "./lib/status/doctor.js",
  migrate: "./lib/migrate/cli.js",
};
const ALIASES = { "5s": "fives" };
const CHRONICLE = new Set(["init", "adopt", "idea", "change", "release", "publish", "notes", "snapshot", "structure", "diff", "timeline", "render", "validate", "sync"]);
const BOOLEAN = new Set(["json", "confirm", "dry-run", "all", "empty", "check", "ci", "history", "perf"]);

/** Splits argv into positional words and --flags (`--key value`, `--key=value`, or a boolean). */
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

const version = () => JSON.parse(readFileSync(here("../.claude-plugin/plugin.json"), "utf8")).version;

const HELP = `Syno ${"{v}"} — every Synopus project tool in one plugin.
Usage: syno <function> <subcommand> [args] [--json] [--repo <path>] [--confirm]
Functions: ${Object.keys(FUNCTIONS).join(", ")}, 5s
Chronicle shortcuts: ${[...CHRONICLE].join(", ")}
Writes print their plan and change nothing until you add --confirm.`;

/** Picks the function module for the first word, or explains why it can't. */
function route(positional) {
  const first = ALIASES[positional[0]] ?? positional[0];
  if (CHRONICLE.has(first)) return { name: "chronicle", args: positional };
  if (!FUNCTIONS[first]) return { error: `Unknown function "${positional[0]}". Run "syno help" for the list.` };
  const args = first === "resume" ? ["resume", ...positional.slice(1)] : positional.slice(1);
  return { name: first, args };
}

function print(result, json) {
  if (json) process.stdout.write(`${JSON.stringify(result.data ?? { text: result.text ?? "" }, null, 2)}\n`);
  else if (result.text) process.stdout.write(`${result.text.replace(/\n?$/, "\n")}`);
}

export async function main(argv) {
  const { positional, flags } = parseArgs(argv);
  const json = flags.json === true;
  if (!positional.length || positional[0] === "help") {
    print({ text: HELP.replace("{v}", version()), data: { version: version(), functions: Object.keys(FUNCTIONS) } }, json);
    return EXIT.OK;
  }
  if (positional[0] === "version") {
    print({ text: version(), data: { version: version() } }, json);
    return EXIT.OK;
  }
  const target = route(positional);
  if (target.error) {
    process.stderr.write(`${target.error}\n`);
    return EXIT.USAGE;
  }
  const modulePath = here(FUNCTIONS[target.name]);
  if (!existsSync(modulePath)) {
    process.stderr.write(`Syno ${target.name} isn't built yet in this version.\n`);
    return EXIT.USAGE;
  }
  const ctx = {
    repo: resolve(typeof flags.repo === "string" ? flags.repo : process.cwd()),
    args: target.args,
    flags,
    json,
    confirm: flags.confirm === true && flags["dry-run"] !== true,
    pluginRoot: here(".."),
  };
  try {
    const { run } = await import(pathToFileURL(modulePath).href);
    const result = (await run(ctx)) ?? {};
    print(result, json);
    return result.code ?? EXIT.OK;
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    return err.exit ?? EXIT.FAILED;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
