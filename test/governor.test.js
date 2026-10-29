// Chunk 3.2: Syno Governor inside Syno (PRD S-11, AC-GO.1, AC-GO.2). Every
// run uses a throwaway HOME and WG_HOME, so the owner's real budget and queue
// are never touched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { standaloneEnabled } from "../scripts/lib/governor/hooks.js";
import { tmp } from "./fixtures.js";

const RUN = fileURLToPath(new URL("../scripts/hooks/run.js", import.meta.url));
const GOV = fileURLToPath(new URL("../scripts/governor/gov.js", import.meta.url));

function sandbox({ standalone = null } = {}) {
  const home = tmp("home");
  const wg = tmp("wg");
  const project = tmp("project");
  const envFile = join(tmp("env"), "env.sh");
  writeFileSync(envFile, "");
  if (standalone !== null) {
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "workload-governor@workload-governor-local": standalone } }));
  }
  const env = { ...process.env, HOME: home, USERPROFILE: home, WG_HOME: wg, CLAUDE_ENV_FILE: envFile };
  const hook = (event, input) => {
    const res = spawnSync(process.execPath, [RUN, event], { input: JSON.stringify({ session_id: "s1", cwd: project, ...input }), env, encoding: "utf8", timeout: 20000 });
    return res.stdout ? JSON.parse(res.stdout).hookSpecificOutput : null;
  };
  return { home, wg, project, envFile, env, hook };
}

test("AC-GO.1 a budget the owner already confirmed is used unchanged", () => {
  const box = sandbox();
  execFileSync(process.execPath, [GOV, "budget", "set", "--preset", "conservative"], { env: box.env, encoding: "utf8" });
  const before = readFileSync(join(box.wg, "device.json"), "utf8");
  const reply = box.hook("SessionStart");
  assert.match(reply.additionalContext, /Syno Governor is active/);
  assert.match(reply.additionalContext, /Budget: owner-confirmed [\d-]+ · conservative/);
  assert.equal(readFileSync(join(box.wg, "device.json"), "utf8"), before, "the device and budget file is untouched");
  assert.match(readFileSync(box.envFile, "utf8"), /scripts\/governor\/bin/);
});

test("AC-GO.2 with the standalone Governor enabled, only one gates a command", () => {
  const both = sandbox({ standalone: true });
  assert.equal(both.hook("PreToolUse", { tool_name: "Bash", tool_input: { command: "gov budget set --preset performance" } }), null);
  assert.match(both.hook("SessionStart").additionalContext, /standalone Workload Governor plugin is still enabled/);
  const syno = sandbox({ standalone: false });
  const reply = syno.hook("PreToolUse", { tool_name: "Bash", tool_input: { command: "gov budget set --preset performance" } });
  assert.equal(reply.permissionDecision, "ask");
  assert.match(reply.permissionDecisionReason, /Syno Governor — owner decision/);
});

test("S-11 later settings win: a project can switch the standalone plugin off", () => {
  const home = tmp("home");
  const project = tmp("project");
  mkdirSync(join(home, ".claude"), { recursive: true });
  mkdirSync(join(project, ".claude"), { recursive: true });
  writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "workload-governor@x": true } }));
  assert.equal(standaloneEnabled(project, home), true);
  writeFileSync(join(project, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "workload-governor@x": false } }));
  assert.equal(standaloneEnabled(project, home), false);
});

test("S-11 a light command passes the Governor silently", () => {
  const box = sandbox();
  assert.equal(box.hook("PreToolUse", { tool_name: "Bash", tool_input: { command: "ls -la" } }), null);
});
