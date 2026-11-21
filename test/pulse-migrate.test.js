// Chunk 3.5: moving from Synopus Insider to Syno Pulse (PRD S-02.11, AC-PU.8).
// Runs in a throwaway HOME and Pulse home.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmp } from "./fixtures.js";

const CLI = fileURLToPath(new URL("../scripts/syno.js", import.meta.url));
const KEY = "z".repeat(40);
const OLD = { projectKey: "c".repeat(64), displayName: "Old Insider project", repoHost: "github.com", repoPath: "acme/site" };

function setup() {
  const home = tmp("migrate-home");
  const repo = tmp("migrate-repo");
  mkdirSync(join(repo, ".claude"), { recursive: true });
  writeFileSync(join(repo, ".claude", "insider.json"), JSON.stringify(OLD));
  writeFileSync(join(repo, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "synopus-insider@synopus": true, "other@x": true }, extraKnownMarketplaces: { synopus: { source: { source: "github", repo: "rishimurugan-synopus/synopus-insider" } } } }));
  mkdirSync(join(home, "legacy", "config"), { recursive: true });
  writeFileSync(join(home, "legacy", "config", "config.json"), JSON.stringify({ enrolmentKey: KEY }));
  const env = { ...process.env, HOME: home, USERPROFILE: home, SYNO_PULSE_HOME: home, SYNO_PULSE_NO_BACKGROUND: "1" };
  const syno = (...args) => spawnSync(process.execPath, [CLI, ...args, "--repo", repo], { env, encoding: "utf8" });
  return { home, repo, syno };
}

test("AC-PU.8 an Insider project moves to .syno/pulse.json only after a yes", () => {
  const { home, repo, syno } = setup();
  const dry = syno("pulse", "migrate");
  assert.match(dry.stdout, /keeps its project key/);
  assert.match(dry.stdout, /Run again with --confirm/);
  assert.equal(existsSync(join(repo, ".syno", "pulse.json")), false);
  assert.equal(existsSync(join(home, "config", "config.json")), false, "the key isn't copied without a yes");
  syno("pulse", "migrate", "--confirm");
  const moved = JSON.parse(readFileSync(join(repo, ".syno", "pulse.json"), "utf8"));
  assert.equal(moved.projectKey, OLD.projectKey);
  const settings = JSON.parse(readFileSync(join(repo, ".claude", "settings.json"), "utf8"));
  assert.deepEqual(settings.enabledPlugins, { "other@x": true, "syno@synopus": true });
  assert.equal(settings.extraKnownMarketplaces.synopus.source.repo, "Synopus-RM/syno");
  assert.equal(JSON.parse(readFileSync(join(home, "config", "config.json"), "utf8")).enrolmentKey, KEY);
  assert.ok(existsSync(join(repo, ".claude", "insider.json")), "the old marker is left for the owner");
});

test("S-02.11 migrating twice changes nothing the second time", () => {
  const { syno } = setup();
  syno("pulse", "migrate", "--confirm");
  assert.match(syno("pulse", "migrate").stdout, /Nothing to move from Synopus Insider here\./);
});

test("S-02 after migrating, status sees the project as enabled and asks the person to join", () => {
  const { syno } = setup();
  assert.match(syno("pulse", "status").stdout, /Synopus Insider was enabled here; run \/syno:pulse migrate/);
  syno("pulse", "migrate", "--confirm");
  const out = syno("pulse", "status").stdout;
  assert.match(out, /Project: enabled \("Old Insider project"\)/);
  assert.match(out, /This machine: not joined/);
});
