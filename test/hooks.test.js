// Chunk 1.4: the hook dispatcher (PRD X-02, AC-XH.1, AC-XH.2, CH-12.2).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dispatch } from "../scripts/hooks/run.js";
import { MAX_LINES, composeBrief } from "../scripts/lib/brief.js";

const RUN = fileURLToPath(new URL("../scripts/hooks/run.js", import.meta.url));
const HOOKS = fileURLToPath(new URL("../hooks/hooks.json", import.meta.url));
const fake = (name, handle, budgetMs = 200) => ({ name, budgetMs, handle });
const hook = (event, stdin, cwd) => spawnSync(process.execPath, [RUN, event], { input: stdin, cwd, encoding: "utf8", timeout: 10000 });

test("AC-XH.1 a handler that throws doesn't stop the others", async () => {
  const reply = await dispatch("SessionStart", {}, [
    fake("broken", () => {
      throw new Error("boom");
    }),
    fake("chronicle", () => ({ lines: ["Version 1.2.0 · 3 pending changes"] })),
  ]);
  assert.match(reply.hookSpecificOutput.additionalContext, /Version 1\.2\.0/);
});

test("X-02 a handler past its time budget is dropped, the rest still answer", async () => {
  const started = Date.now();
  const reply = await dispatch("SessionStart", {}, [
    fake("slow", () => new Promise((r) => setTimeout(() => r({ lines: ["too late"] }), 1000)), 50),
    fake("pause", () => ({ lines: ["Paused: logo work"] })),
  ]);
  assert.ok(Date.now() - started < 900, "did not wait for the slow handler");
  assert.doesNotMatch(reply.hookSpecificOutput.additionalContext, /too late/);
  assert.match(reply.hookSpecificOutput.additionalContext, /Paused: logo work/);
});

test("X-02 the Syno brief has at most 8 lines, then the Governor's brief", () => {
  const many = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`);
  const text = composeBrief([{ source: "governor", context: "Workload Governor is active." }, { source: "chronicle", lines: many }]);
  const bullets = text.split("\n").filter((l) => l.startsWith("- "));
  assert.equal(bullets.length, MAX_LINES);
  assert.ok(text.indexOf("Syno brief") < text.indexOf("Workload Governor"));
  assert.equal(composeBrief([{ source: "x", lines: [] }]), "");
});

test("X-02 on PreToolUse the strictest decision wins", async () => {
  const reply = await dispatch("PreToolUse", {}, [
    fake("a", () => ({ decision: { permissionDecision: "ask", permissionDecisionReason: "device busy" } })),
    fake("b", () => ({ decision: { permissionDecision: "deny", permissionDecisionReason: "queue it" } })),
  ]);
  assert.equal(reply.hookSpecificOutput.permissionDecision, "deny");
  assert.equal(reply.hookSpecificOutput.hookEventName, "PreToolUse");
});

test("X-02 decisions are ignored outside PreToolUse, and silence means no reply", async () => {
  const reply = await dispatch("SessionStart", {}, [fake("a", () => ({ decision: { permissionDecision: "deny" } }))]);
  assert.equal(reply, null);
});

test("AC-XH.2 in a plain folder the hook prints nothing and exits 0", () => {
  const cwd = mkdtempSync(join(tmpdir(), "syno-hook-"));
  const res = hook("SessionStart", JSON.stringify({ cwd, session_id: "t" }), cwd);
  assert.equal(res.status, 0);
  assert.equal(res.stdout, "");
});

test("CH-12.2 broken input still exits 0 with no output", () => {
  const cwd = mkdtempSync(join(tmpdir(), "syno-hook-"));
  for (const stdin of ["{not json", "", "null"]) {
    const res = hook("PostToolUse", stdin, cwd);
    assert.equal(res.status, 0, `stdin ${JSON.stringify(stdin)}`);
    assert.equal(res.stdout, "");
  }
});

test("X-02 hooks.json sends every event to the dispatcher", () => {
  const { hooks } = JSON.parse(readFileSync(HOOKS, "utf8"));
  for (const event of ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop", "SessionEnd"]) {
    const cmd = hooks[event][0].hooks[0].command;
    assert.match(cmd, new RegExp(`scripts/hooks/run\\.js\\\\?"? ${event}$`), event);
  }
  assert.equal(hooks.PreToolUse[0].matcher, "Bash");
});
