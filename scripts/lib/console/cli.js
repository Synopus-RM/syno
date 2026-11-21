// Syno Console in the Syno CLI (PRD S-17, X-04):
//   syno console <subcommand> [args] [--json] [--repo <path>] [--confirm]
// Every subcommand but install runs the console skill's own script, so the
// plugin and a project's cloud copy behave the same. install writes or checks
// that cloud copy.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runConsole } from "../../../skills/console/scripts/console.mjs";
import { describePlan } from "../chronicle/docs.js";
import { EXIT } from "../fsutil.js";
import { checkInstall, planInstall } from "./install.js";

const SKIP = new Set(["repo", "json", "confirm", "dry-run", "check"]);
const versionOf = (pluginRoot) => JSON.parse(readFileSync(join(pluginRoot, ".claude-plugin", "plugin.json"), "utf8")).version;

function install(ctx) {
  const version = versionOf(ctx.pluginRoot);
  if (ctx.flags.check === true) {
    const c = checkInstall(ctx.repo, ctx.pluginRoot, { version });
    const text = c.ok
      ? `Green: the Syno Console cloud copy matches Syno ${version}.`
      : [
          "Amber: the Syno Console cloud copy needs /syno:console install.",
          ...c.missing.map((f) => `- missing: ${f}`),
          ...c.edited.map((f) => `- differs from Syno ${version}: ${f}`),
          ...(c.hooks ? [] : ["- the guard or brief hook is missing from .claude/settings.json"]),
        ].join("\n");
    return { code: c.ok ? EXIT.OK : EXIT.FAILED, text, data: c };
  }
  const plan = planInstall(ctx.repo, ctx.pluginRoot, { version });
  const { applied } = plan.apply({ confirm: ctx.confirm });
  const text = [`Install the Syno Console cloud copy (Syno ${version}), so cloud sessions in this project get the console skill and its guard.`, describePlan(plan, applied)].join("\n");
  return { code: EXIT.OK, text, data: { applied, ops: plan.describe() } };
}

export async function run(ctx) {
  if (ctx.args[0] === "install") return install(ctx);
  const argv = [...ctx.args];
  for (const [key, value] of Object.entries(ctx.flags)) {
    if (SKIP.has(key)) continue;
    argv.push(`--${key}`);
    if (value !== true) argv.push(String(value));
  }
  if (ctx.flags.check === true) argv.push("--check");
  if (ctx.confirm) argv.push("--confirm");
  const r = await runConsole(argv, { cwd: ctx.repo });
  return { code: r.code, text: r.text, data: r.data ?? { text: r.text } };
}
