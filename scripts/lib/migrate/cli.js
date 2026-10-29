// /syno:migrate (PRD X-03): moving from the standalone plugins and skills to
// Syno. It finds them, moves Insider's settings and marker files after a yes
// (through Syno Pulse's migrate), keeps the Governor's state folder where it
// is, leaves app-sync.json alone, and prints the exact uninstall steps. Syno
// never uninstalls anything itself, and only shows the steps once Syno's
// self-test has passed on this machine for this version.
//   syno migrate [--confirm]
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { readJson, refusal } from "../fsutil.js";
import { readerDate } from "../report/render.js";
import { pluginVersion } from "../reports.js";

export const PLUGINS = { "synopus-insider": "Syno Pulse", "workload-governor": "Syno Governor", "akmo-app-sync": "Syno Devices" };
export const SKILLS = { "project-progress-report": "Syno Progress", "task-breakdown-progress-report": "Syno Tasks", "codebase-audit": "Syno Audit", "easy-test-guide": "Syno Test", "parallel-finish": "Syno Parallel", "prd-brainstorm": "Syno Plan", "prompt-master": "Syno Prompt" };

/** Syno's own settings folder on this machine. */
export const synoHome = () => process.env.SYNO_HOME || join(homedir(), ".claude", "syno");
export const SELFTEST = "selftest.json";

/** The old plugins installed or enabled for this user: ["name@marketplace"]. */
export function oldPlugins(home = homedir()) {
  const enabled = Object.keys(readJson(join(home, ".claude", "settings.json"), {})?.enabledPlugins ?? {});
  const installed = Object.keys(readJson(join(home, ".claude", "plugins", "installed_plugins.json"), {})?.plugins ?? {});
  return [...new Set([...enabled, ...installed])].filter((id) => PLUGINS[id.split("@")[0]]).sort();
}

const dirs = (dir) => {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
};

const SYNCED = (home) => join(home, ".config", "Claude", "local-agent-mode-sessions");

/** The old plugins added in claude.ai, which the desktop app keeps in its own folder. */
export function syncedPlugins(home = homedir()) {
  const names = new Set();
  for (const a of dirs(SYNCED(home))) for (const b of dirs(join(SYNCED(home), a))) for (const p of dirs(join(SYNCED(home), a, b, "rpm"))) {
    const name = readJson(join(SYNCED(home), a, b, "rpm", p, ".claude-plugin", "plugin.json"))?.name;
    if (PLUGINS[name]) names.add(name);
  }
  return [...names].sort();
}

/** The old skills: in ~/.claude/skills/, and synced from claude.ai into the desktop app. */
export function oldSkills(home = homedir()) {
  const local = dirs(join(home, ".claude", "skills")).filter((d) => SKILLS[d]).map((name) => ({ name, path: join(home, ".claude", "skills", name) }));
  const base = join(SYNCED(home), "skills-plugin");
  const synced = new Set();
  for (const a of dirs(base)) for (const b of dirs(join(base, a))) for (const s of dirs(join(base, a, b, "skills"))) if (SKILLS[s]) synced.add(s);
  return { local, synced: [...synced].sort() };
}

/** Whether Syno's self-test passed on this machine for this version. */
export function selftestPassed() {
  const rec = readJson(join(synoHome(), SELFTEST));
  return rec?.version === pluginVersion() ? rec : null;
}

export function uninstallSteps(found) {
  return [
    ...found.plugins.map((id) => `claude plugin uninstall ${id}    (${PLUGINS[id.split("@")[0]]} replaces it)`),
    ...found.synced.map((name) => `Remove the "${name}" plugin in claude.ai: Settings › Plugins    (${PLUGINS[name]} replaces it)`),
    ...found.skills.local.map((s) => `Move the folder ${s.path} out of ~/.claude/skills/    (${SKILLS[s.name]} replaces it)`),
    ...found.skills.synced.map((s) => `Remove the "${s}" skill in claude.ai: Settings › Capabilities › Skills    (${SKILLS[s]} replaces it)`),
  ];
}

export async function run(ctx) {
  const found = { plugins: oldPlugins(), synced: syncedPlugins(), skills: oldSkills() };
  const passed = selftestPassed();
  if (ctx.confirm && !passed) throw refusal(`Refused: Syno's self-test hasn't passed on this machine for version ${pluginVersion()} yet, so nothing old is retired. Run node "${ctx.pluginRoot}/test/selftest.js" first.`);
  const { migrate } = await import("../pulse/migrate.js");
  const pulse = migrate(ctx);
  const steps = uninstallSteps(found);
  const lines = [
    found.plugins.length || found.synced.length || found.skills.local.length || found.skills.synced.length ? "Old Synopus installs on this machine:" : "No old Synopus plugins or skills are installed here.",
    ...found.plugins.map((id) => `  - plugin ${id} → ${PLUGINS[id.split("@")[0]]}`),
    ...found.synced.map((name) => `  - plugin ${name}, added in claude.ai → ${PLUGINS[name]} (remove it in claude.ai; Syno doesn't touch it)`),
    ...found.skills.local.map((s) => `  - skill ${s.name} in ~/.claude/skills → ${SKILLS[s.name]}`),
    ...found.skills.synced.map((s) => `  - skill ${s}, synced from claude.ai → ${SKILLS[s]} (remove it in claude.ai; Syno doesn't touch it)`),
    "",
    pulse.text,
    "The Governor's state folder (~/.claude/workload-governor) stays where it is; Syno Governor uses it as it is.",
    "app-sync.json stays where it is; Syno Devices reads it there.",
    "",
    passed ? `Syno's self-test passed here on ${readerDate(passed.passedAt.slice(0, 10))} (version ${passed.version}).` : `Syno's self-test hasn't passed here for version ${pluginVersion()} yet. Run node "${ctx.pluginRoot}/test/selftest.js" before retiring anything.`,
    ...(passed && steps.length ? ["", "To retire the old installs, do these yourself (Syno never uninstalls anything):", ...steps.map((s, i) => `  ${i + 1}. ${s}`)] : []),
  ];
  return { code: 0, text: lines.join("\n"), data: { applied: Boolean(pulse.data?.applied), found, selftest: Boolean(passed), steps: passed ? steps : [] } };
}
