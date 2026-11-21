// S-17 Syno Console in the plugin: the CLI route, the cloud copy and the hooks (AC-CN.9, AC-CN.10).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { commit, initRepo } from "./fixtures.js";
import { dispatch } from "../scripts/hooks/run.js";
import { checkInstall, planInstall } from "../scripts/lib/console/install.js";
import { handle as consoleHandle } from "../scripts/lib/console/hooks.js";
import { handle as governorHandle } from "../scripts/lib/governor/hooks.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SYNO = join(ROOT, "scripts/syno.js");
const RUN = join(ROOT, "scripts/hooks/run.js");
const read = (root, rel) => readFileSync(join(root, rel), "utf8");
const sandboxEnv = () => {
  const home = mkdtempSync(join(tmpdir(), "syno-home-"));
  return { ...process.env, HOME: home, USERPROFILE: home, WG_HOME: mkdtempSync(join(tmpdir(), "syno-wg-")), CLAUDE_ENV_FILE: join(home, "env.sh") };
};

function projectWithSettings() {
  const root = initRepo("console-install");
  commit(root, "init", undefined, { "README.md": "r\n" });
  mkdirSync(join(root, ".claude"), { recursive: true });
  const settings = {
    enabledPlugins: { "syno@synopus": true },
    hooks: {
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo law", timeout: 10 }] }],
      PostToolUse: [{ matcher: "Edit|Write", hooks: [{ type: "command", command: "echo edit", timeout: 10 }] }],
    },
  };
  writeFileSync(join(root, ".claude/settings.json"), JSON.stringify(settings, null, 2));
  return { root, settings };
}

/** A git repo on a task branch with that task's role saved. */
function taskRepo() {
  const repo = initRepo("console-task");
  commit(repo, "init", undefined, { "README.md": "r\n" });
  execFileSync("git", ["checkout", "-q", "-b", "claude/syno-pha-m1-t1"], { cwd: repo });
  mkdirSync(join(repo, ".syno/local/console"), { recursive: true });
  writeFileSync(join(repo, ".syno/local/console/role.json"), JSON.stringify({ level: "task", id: "A.M1.T1", branch: "claude/syno-pha-m1-t1", parentId: "A.M1" }));
  return repo;
}

const ask = (cwd) => ({ tool_name: "AskUserQuestion", tool_input: { questions: [] }, cwd });

test("AC-CN.9 install keeps other settings and adds the guard and brief hooks", () => {
  const { root, settings } = projectWithSettings();
  const plan = planInstall(root, ROOT, { version: "9.9.9" });
  assert.equal(plan.apply({ confirm: true }).applied, true);
  const after = JSON.parse(read(root, ".claude/settings.json"));
  assert.deepEqual(after.enabledPlugins, settings.enabledPlugins);
  assert.deepEqual(after.hooks.PostToolUse, settings.hooks.PostToolUse);
  assert.equal(after.hooks.PreToolUse.length, 2);
  assert.deepEqual(after.hooks.PreToolUse[0], settings.hooks.PreToolUse[0]);
  assert.match(after.hooks.PreToolUse[1].hooks[0].command, /syno-console\/scripts\/console\.mjs" guard$/);
  assert.match(after.hooks.PreToolUse[1].matcher, /AskUserQuestion/);
  assert.match(after.hooks.SessionStart[0].hooks[0].command, /brief-hook$/);
  assert.equal(read(root, ".claude/skills/syno-console/scripts/console.mjs"), read(ROOT, "skills/console/scripts/console.mjs"));
  assert.ok(read(root, ".claude/skills/syno-console/references/role-card.md").startsWith("SYNO ROLE CARD"));
  assert.equal(JSON.parse(read(root, ".syno/config.json")).console.askAt, "console");
  assert.match(read(root, ".gitignore"), /^\.syno\/local\/$/m);
});

test("AC-CN.9 install is idempotent and --check spots an edited copy", () => {
  const { root } = projectWithSettings();
  planInstall(root, ROOT, { version: "9.9.9" }).apply({ confirm: true });
  assert.equal(planInstall(root, ROOT, { version: "9.9.9" }).empty, true);
  assert.equal(checkInstall(root, ROOT, { version: "9.9.9" }).ok, true);
  writeFileSync(join(root, ".claude/skills/syno-console/scripts/guard.mjs"), "// edited\n");
  const check = checkInstall(root, ROOT, { version: "9.9.9" });
  assert.equal(check.ok, false);
  assert.deepEqual(check.edited, [".claude/skills/syno-console/scripts/guard.mjs"]);
});

test("AC-CN.9 syno console install previews, then writes with --confirm", () => {
  const { root } = projectWithSettings();
  const preview = spawnSync(process.execPath, [SYNO, "console", "install", "--repo", root], { encoding: "utf8" });
  assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, /would write/);
  const check = spawnSync(process.execPath, [SYNO, "console", "install", "--check", "--repo", root], { encoding: "utf8" });
  assert.equal(check.status, 1);
  const done = spawnSync(process.execPath, [SYNO, "console", "install", "--confirm", "--repo", root], { encoding: "utf8" });
  assert.equal(done.status, 0, done.stderr);
  assert.equal(spawnSync(process.execPath, [SYNO, "console", "install", "--check", "--repo", root], { encoding: "utf8" }).status, 0);
});

test("S-17 syno console routes to the console script", () => {
  const out = spawnSync(process.execPath, [SYNO, "console", "names", "A.M1", "--name", "Editor", "--json", "--repo", initRepo("console-route")], { encoding: "utf8" });
  assert.equal(out.status, 0, out.stderr);
  assert.equal(JSON.parse(out.stdout).branch, "claude/syno-pha-m1");
});

test("AC-CN.10 the dispatcher's console handler guards, and stays quiet when the cloud copy is installed", async () => {
  const repo = taskRepo();
  const handlers = [{ name: "console", budgetMs: 2000, handle: consoleHandle }];
  const reply = await dispatch("PreToolUse", ask(repo), handlers);
  assert.equal(reply.hookSpecificOutput.permissionDecision, "deny");
  const brief = await dispatch("SessionStart", { cwd: repo }, handlers);
  assert.match(brief.hookSpecificOutput.additionalContext, /PhA·M1·T1/);
  mkdirSync(join(repo, ".claude"), { recursive: true });
  writeFileSync(join(repo, ".claude/settings.json"), JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: 'node "$CLAUDE_PROJECT_DIR/.claude/skills/syno-console/scripts/console.mjs" guard' }] }] } }));
  assert.equal(await dispatch("PreToolUse", ask(repo), handlers), null);
  assert.equal(await consoleHandle("PreToolUse", { tool_name: "Bash", tool_input: 5 }, { cwd: "/nonexistent/place" }), null);
});

test("AC-CN.10 the hook process denies a task's question dialog through run.js", () => {
  const repo = taskRepo();
  const out = spawnSync(process.execPath, [RUN, "PreToolUse"], { input: JSON.stringify(ask(repo)), cwd: repo, env: sandboxEnv(), encoding: "utf8", timeout: 20000 });
  assert.equal(out.status, 0);
  assert.equal(JSON.parse(out.stdout).hookSpecificOutput.permissionDecision, "deny");
  const hooks = JSON.parse(read(ROOT, "hooks/hooks.json")).hooks.PreToolUse;
  assert.ok(hooks.some((h) => /AskUserQuestion/.test(h.matcher) && /run\.js" PreToolUse/.test(h.hooks[0].command)));
});

test("the Governor ignores tools other than Bash", async () => {
  assert.equal(await governorHandle("PreToolUse", { tool_name: "AskUserQuestion", tool_input: {} }, { cwd: tmpdir() }), null);
});
