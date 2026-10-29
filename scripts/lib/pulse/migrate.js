// Moving from Synopus Insider to Syno Pulse (PRD S-02.11, X-03, AC-PU.8). For
// a project: .claude/insider.json becomes .syno/pulse.json (same project key,
// so the panel keeps its history) and the project settings name syno@synopus
// instead of synopus-insider@synopus. For this machine: the team enrolment key
// is copied over. Each person joins again, because the notice changed. Nothing
// moves without the owner's yes, and the old marker is left for the owner.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { WritePlan, jsonText, readJson as readProjectJson } from "../fsutil.js";
import { tryGit } from "../git.js";
import { LEGACY_MARKER, MARKER, legacyDirs, paths, readJson, writeJson } from "./config.js";
import { MARKETPLACE, PLUGIN_ID } from "./cli.js";

const OLD_PLUGIN = "synopus-insider@synopus";

/** What a migration would move here: { project, settings, key } (each null when there's nothing). */
export function migrationFor(root) {
  const marker = readProjectJson(join(root, LEGACY_MARKER));
  const project = marker && /^[a-f0-9]{64}$/.test(marker.projectKey ?? "") && !existsSync(join(root, MARKER)) ? marker : null;
  const settingsFile = join(root, ".claude", "settings.json");
  const settings = readProjectJson(settingsFile);
  const needsSettings = Boolean(settings?.enabledPlugins?.[OLD_PLUGIN] !== undefined || settings?.extraKnownMarketplaces?.synopus?.source?.repo === "rishimurugan-synopus/synopus-insider");
  const key = readJson(paths.config())?.enrolmentKey ? null : readJson(join(legacyDirs().config, "config.json"))?.enrolmentKey ?? null;
  return { project, settings: needsSettings ? settings : null, key };
}

function newSettings(settings) {
  const enabled = { ...(settings.enabledPlugins ?? {}) };
  delete enabled[OLD_PLUGIN];
  enabled[PLUGIN_ID] = true;
  return { ...settings, enabledPlugins: enabled, extraKnownMarketplaces: { ...(settings.extraKnownMarketplaces ?? {}), synopus: MARKETPLACE } };
}

/** `syno pulse migrate` — preview, then --confirm. */
export function migrate(ctx) {
  const root = tryGit(["rev-parse", "--show-toplevel"], { cwd: ctx.repo }) || ctx.repo;
  const found = migrationFor(root);
  if (!found.project && !found.settings && !found.key) return { code: 0, text: "Nothing to move from Synopus Insider here.", data: { applied: false } };
  const plan = new WritePlan(root);
  if (found.project) plan.write(MARKER, jsonText({ ...found.project, migratedFrom: "synopus-insider" }));
  if (found.settings) plan.write(".claude/settings.json", jsonText(newSettings(found.settings)));
  const lines = [
    "Moving from Synopus Insider to Syno Pulse:",
    ...(found.project ? [`  - This project ("${found.project.displayName}") keeps its project key, so the panel keeps its history.`] : []),
    ...(found.settings ? ["  - Project settings switch from synopus-insider@synopus to syno@synopus."] : []),
    ...(found.key ? ["  - This machine's team enrolment key is copied to Syno Pulse."] : []),
    ...plan.describe().map((l) => `  ${l}`),
  ];
  const applied = plan.apply({ confirm: ctx.confirm });
  if (ctx.confirm && found.key) writeJson(paths.config(), { ...readJson(paths.config(), {}), enrolmentKey: found.key });
  const after = ctx.confirm
    ? ["", "Done. Commit .syno/pulse.json and .claude/settings.json.", "Each person runs /syno:pulse join once, because the notice changed.", `You can delete ${LEGACY_MARKER} yourself once the old plugin is uninstalled.`]
    : ["Run again with --confirm to move them."];
  return { code: 0, text: [...lines, ...after].join("\n"), data: { applied: applied.applied || (ctx.confirm && Boolean(found.key)), project: Boolean(found.project), settings: Boolean(found.settings), key: Boolean(found.key) } };
}
