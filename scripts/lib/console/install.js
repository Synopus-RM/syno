// Syno Console's cloud copy (PRD S-17, design 5.12). Cloud sessions can't load
// the owner's plugins, so `syno console install` copies the console skill into
// the project's .claude/skills/syno-console/ and adds its guard and brief
// hooks to .claude/settings.json, keeping every other key and hook. Written
// only with --confirm; running it again changes nothing; --check reports a
// missing, stale or edited copy.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { WritePlan, jsonText, readJson, readText, refusal } from "../fsutil.js";
import { GUARD_MATCHER } from "../../../skills/console/scripts/guard.mjs";
import { mergeConsoleConfig } from "../../../skills/console/scripts/store.mjs";

export const COPY_DIR = ".claude/skills/syno-console";
const SCRIPT = `${COPY_DIR}/scripts/console.mjs`;
export const GUARD_CMD = `node "$CLAUDE_PROJECT_DIR/${SCRIPT}" guard`;
export const BRIEF_CMD = `node "$CLAUDE_PROJECT_DIR/${SCRIPT}" brief-hook`;
const CONFIG_GROUP = { askAt: "console", rolling: true, limits: { maxTasks: 3, maxMilestones: 2 }, sharedFiles: [], mergeRecipe: null, checks: { task: [], milestone: [], phase: [], console: [] }, numbers: [] };

function walk(dir, prefix = "") {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => (statSync(join(dir, name)).isDirectory() ? walk(join(dir, name), `${prefix}${name}/`) : [`${prefix}${name}`]));
}

function skillCopy(text, version) {
  const m = /^---\n[\s\S]*?\n---\n/.exec(text);
  if (!m) return text;
  const front = m[0].replace(/^name:\s*console\s*$/m, "name: syno-console");
  return `${front}\n<!-- Copied from Syno ${version} by /syno:console install. Update with the same command; don't edit by hand. -->\n${text.slice(m[0].length)}`;
}

/** Every file of the cloud copy, with the text it must have. */
export function copyFiles(pluginRoot, version) {
  const src = join(pluginRoot, "skills", "console");
  return walk(src).map((rel) => {
    const text = readFileSync(join(src, rel), "utf8");
    return { path: `${COPY_DIR}/${rel}`, text: rel === "SKILL.md" ? skillCopy(text, version) : text };
  });
}

function withHook(list, entry, command) {
  const all = Array.isArray(list) ? structuredClone(list) : [];
  const found = all.find((e) => e?.hooks?.some?.((h) => h?.command === command));
  if (!found) return [...all, entry];
  if (entry.matcher !== undefined) found.matcher = entry.matcher;
  return all;
}

/** .claude/settings.json with the guard and brief hooks added; refuses a file that isn't valid JSON. */
export function settingsText(existingText) {
  let settings = {};
  try {
    settings = existingText ? JSON.parse(existingText) : {};
  } catch {
    throw refusal("Refused: .claude/settings.json isn't valid JSON. Fix it first, so nothing in it is lost.");
  }
  const hooks = { ...(settings.hooks ?? {}) };
  hooks.PreToolUse = withHook(hooks.PreToolUse, { matcher: GUARD_MATCHER, hooks: [{ type: "command", command: GUARD_CMD, timeout: 10 }] }, GUARD_CMD);
  hooks.SessionStart = withHook(hooks.SessionStart, { hooks: [{ type: "command", command: BRIEF_CMD, timeout: 10 }] }, BRIEF_CMD);
  return jsonText({ ...settings, hooks });
}

const hasIgnoreLine = (text) => (text ?? "").split("\n").some((l) => l.trim() === ".syno/local/");

/** Every write the cloud copy needs, as a plan that applies only with the owner's yes. */
export function planInstall(root, pluginRoot, { version }) {
  const plan = new WritePlan(root);
  for (const f of copyFiles(pluginRoot, version)) plan.write(f.path, f.text);
  plan.write(".claude/settings.json", settingsText(readText(join(root, ".claude/settings.json"))));
  if (!readJson(join(root, ".syno/config.json"))?.console) plan.write(".syno/config.json", mergeConsoleConfig(readText(join(root, ".syno/config.json")), CONFIG_GROUP));
  const ignore = readText(join(root, ".gitignore")) ?? "";
  if (!hasIgnoreLine(ignore)) plan.write(".gitignore", `${ignore}${ignore && !ignore.endsWith("\n") ? "\n" : ""}.syno/local/\n`);
  return plan;
}

/** { ok, missing, edited, hooks }: whether the project's copy matches this Syno version. Read-only. */
export function checkInstall(root, pluginRoot, { version }) {
  const missing = [];
  const edited = [];
  for (const f of copyFiles(pluginRoot, version)) {
    const current = readText(join(root, f.path));
    if (current === null) missing.push(f.path);
    else if (current !== f.text) edited.push(f.path);
  }
  const settings = readText(join(root, ".claude/settings.json")) ?? "";
  const hooks = settings.includes(GUARD_CMD.replace(/"/g, '\\"')) && settings.includes(BRIEF_CMD.replace(/"/g, '\\"'));
  return { ok: !missing.length && !edited.length && hooks, missing, edited, hooks };
}
