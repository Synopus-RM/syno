// Chunk 4.9: /syno:migrate (PRD X-03, AC-XM.1). Every run uses a throwaway HOME,
// so the owner's real plugins, skills and Insider settings are never read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { initRepo, commit, tmp } from "./fixtures.js";

const CLI = fileURLToPath(new URL("../scripts/syno.js", import.meta.url));
const VERSION = JSON.parse(readFileSync(fileURLToPath(new URL("../.claude-plugin/plugin.json", import.meta.url)), "utf8")).version;

function machine({ passed = true } = {}) {
  const home = tmp("home");
  mkdirSync(join(home, ".claude/skills/prd-brainstorm"), { recursive: true });
  mkdirSync(join(home, ".claude/skills/my-own-skill"), { recursive: true });
  mkdirSync(join(home, ".config/Claude/local-agent-mode-sessions/skills-plugin/a/b/skills/prompt-master"), { recursive: true });
  mkdirSync(join(home, ".config/Claude/local-agent-mode-sessions/a/b/rpm/plugin_1/.claude-plugin"), { recursive: true });
  writeFileSync(join(home, ".config/Claude/local-agent-mode-sessions/a/b/rpm/plugin_1/.claude-plugin/plugin.json"), JSON.stringify({ name: "akmo-app-sync" }));
  writeFileSync(join(home, ".claude/settings.json"), JSON.stringify({ enabledPlugins: { "synopus-insider@synopus": true, "workload-governor@synopus-tools": true, "other@x": true } }));
  const synoHome = tmp("syno-home");
  if (passed) writeFileSync(join(synoHome, "selftest.json"), JSON.stringify({ version: VERSION, passedAt: "2026-10-30T09:00:00.000Z" }));
  const repo = initRepo("migrate");
  commit(repo, "chore: start", "2026-01-01T09:00:00Z", { ".claude/insider.json": JSON.stringify({ projectKey: "a".repeat(64), displayName: "Shop" }), ".claude/settings.json": JSON.stringify({ enabledPlugins: { "synopus-insider@synopus": true } }) });
  const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, ".config"), XDG_STATE_HOME: join(home, ".local/state"), SYNO_HOME: synoHome, SYNO_PULSE_HOME: tmp("pulse") };
  const syno = (...a) => spawnSync(process.execPath, [CLI, "migrate", ...a, "--repo", repo, "--json"], { encoding: "utf8", env });
  return { repo, syno };
}

test("X-03 migrate finds the old plugins and skills, and lists the exact uninstall steps", () => {
  const { syno } = machine();
  const res = JSON.parse(syno().stdout);
  assert.deepEqual(res.found.plugins, ["synopus-insider@synopus", "workload-governor@synopus-tools"]);
  assert.deepEqual(res.found.skills.local.map((s) => s.name), ["prd-brainstorm"]);
  assert.deepEqual(res.found.skills.synced, ["prompt-master"]);
  assert.deepEqual(res.found.synced, ["akmo-app-sync"]);
  assert.match(res.steps.join("\n"), /Remove the "akmo-app-sync" plugin in claude\.ai: Settings › Plugins +\(Syno Devices replaces it\)/);
  assert.match(res.steps[0], /^claude plugin uninstall synopus-insider@synopus +\(Syno Pulse replaces it\)$/);
  assert.match(res.steps.join("\n"), /Move the folder .*\.claude\/skills\/prd-brainstorm out/);
  assert.match(res.steps.join("\n"), /Remove the "prompt-master" skill in claude\.ai/);
  assert.equal(res.applied, false, "a preview moves nothing");
});

test("X-03 nothing is retired before Syno's self-test has passed on this machine", () => {
  const { repo, syno } = machine({ passed: false });
  const preview = JSON.parse(syno().stdout);
  assert.deepEqual(preview.steps, []);
  const res = syno("--confirm");
  assert.equal(res.status, 3);
  assert.match(res.stderr, /self-test hasn't passed/);
  assert.throws(() => readFileSync(join(repo, ".syno/pulse.json")));
});

test("AC-XM.1 running migrate twice changes nothing the second time", () => {
  const { repo, syno } = machine();
  const first = JSON.parse(syno("--confirm").stdout);
  assert.equal(first.applied, true);
  const marker = readFileSync(join(repo, ".syno/pulse.json"), "utf8");
  const settings = readFileSync(join(repo, ".claude/settings.json"), "utf8");
  assert.match(settings, /"syno@synopus": true/);
  const second = JSON.parse(syno("--confirm").stdout);
  assert.equal(second.applied, false);
  assert.equal(readFileSync(join(repo, ".syno/pulse.json"), "utf8"), marker);
  assert.equal(readFileSync(join(repo, ".claude/settings.json"), "utf8"), settings);
});
