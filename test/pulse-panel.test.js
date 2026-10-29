// Chunk 3.4, fixture G: Syno Pulse against a fake Synopus panel on 127.0.0.1
// (PRD S-02, AC-PU.1, PU.2, PU.3, PU.5, PU.6). Everything runs in a throwaway
// Pulse home; nothing reaches the real panel.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmp, initRepo, commit } from "./fixtures.js";

const CLI = fileURLToPath(new URL("../scripts/syno.js", import.meta.url));
const MCP = fileURLToPath(new URL("../mcp/pulse-server.js", import.meta.url));
const KEY = "k".repeat(40);
// The fake panel runs in its own process: spawnSync blocks this one, so a
// server here couldn't answer while a command waits on it. It logs every
// request to a file the tests read.
let panel;
let api;
const logFile = join(tmp("panel"), "requests.jsonl");
const PANEL = `
import { appendFileSync } from "node:fs";
import { createServer } from "node:http";
const [log, key] = process.argv.slice(1);
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const json = body ? JSON.parse(body) : {};
    appendFileSync(log, JSON.stringify({ url: req.url, json }) + "\\n");
    const send = (status, out) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(out));
    if (req.url === "/api/reporter/register") {
      if (json.kind === "device" && json.enrolmentKey !== key) return send(401, { error: "bad_key" });
      return send(201, json.kind === "device" ? { device: { status: "active" } } : { project: { status: "active" } });
    }
    if (req.url.startsWith("/api/reporter/status")) return send(200, { device: { status: "active" }, project: { status: "active" }, accepts: ["audit.result", "daily.rollup"] });
    if (req.url === "/api/reporter/events") return send(200, { accepted: json.events.length, duplicates: 0, rejected: [] });
    send(404, {});
  });
});
server.listen(0, "127.0.0.1", () => process.stdout.write(String(server.address().port) + "\\n"));
`;

before(async () => {
  writeFileSync(logFile, "");
  panel = spawn(process.execPath, ["--input-type=module", "-e", PANEL, logFile, KEY], { stdio: ["ignore", "pipe", "inherit"] });
  const port = await new Promise((r) => panel.stdout.once("data", (d) => r(String(d).trim())));
  api = `http://127.0.0.1:${port}`;
});
after(() => panel.kill());

/** Everything the fake panel received so far. */
function seen() {
  const all = readFileSync(logFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return {
    register: all.filter((r) => r.url === "/api/reporter/register").map((r) => r.json),
    status: all.filter((r) => r.url.startsWith("/api/reporter/status")).length,
    events: all.filter((r) => r.url === "/api/reporter/events").flatMap((r) => r.json.events),
    other: all.filter((r) => !/^\/api\/reporter\/(register|status|events)/.test(r.url)).map((r) => r.url),
  };
}

function machine() {
  const home = tmp("pulse-home");
  // A throwaway HOME too, so nothing on this machine (an old Insider key, say) is ever read.
  const env = { ...process.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, "xdg-config"), XDG_STATE_HOME: join(home, "xdg-state"), SYNO_PULSE_HOME: home, SYNO_PULSE_API: api, SYNO_PULSE_NO_BACKGROUND: "1", GIT_CONFIG_NOSYSTEM: "1" };
  const syno = (repo, ...args) => {
    const res = spawnSync(process.execPath, [CLI, ...args, "--repo", repo, "--json"], { env, encoding: "utf8", input: args.includes("set-key") ? KEY : undefined });
    return { code: res.status, data: res.stdout ? JSON.parse(res.stdout) : null, err: res.stderr };
  };
  const hook = async (event, input) => {
    const res = spawnSync(process.execPath, ["--input-type=module", "-e", `import { handle } from ${JSON.stringify(new URL("../scripts/lib/pulse/hooks.js", import.meta.url).href)}; const out = await handle(${JSON.stringify(event)}, ${JSON.stringify(input)}, { cwd: ${JSON.stringify(input.cwd)} }); process.stdout.write(JSON.stringify(out));`], { env, encoding: "utf8" });
    return JSON.parse(res.stdout || "null");
  };
  const flush = () => spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/lib/pulse/sender.js", import.meta.url)), "--flush", "--force"], { env, encoding: "utf8" });
  const queue = () => {
    const out = spawnSync(process.execPath, ["--input-type=module", "-e", `import { segments, readSegment, sealQueue } from ${JSON.stringify(new URL("../scripts/lib/pulse/queue.js", import.meta.url).href)}; sealQueue(); process.stdout.write(JSON.stringify(segments().flatMap((f) => readSegment(f))));`], { env, encoding: "utf8" });
    return JSON.parse(out.stdout || "[]");
  };
  return { home, env, syno, hook, flush, queue };
}

function project() {
  const repo = initRepo("pulse-project");
  commit(repo, "chore: start", "2026-01-01T09:00:00Z", { "a.txt": "a\n" });
  spawnSync("git", ["config", "user.email", "asha@example.com"], { cwd: repo });
  spawnSync("git", ["config", "user.name", "Asha Dev"], { cwd: repo });
  return repo;
}

test("AC-PU.1 without .syno/pulse.json every Pulse hook returns at once and calls nothing", async () => {
  const m = machine();
  const plain = tmp("plain");
  const before = seen().status + seen().events.length;
  const started = process.hrtime.bigint();
  for (const event of ["SessionStart", "UserPromptSubmit", "PostToolUse", "Stop", "SessionEnd"]) assert.equal(await m.hook(event, { cwd: plain, session_id: "s" }), null);
  assert.equal(seen().status + seen().events.length, before);
  const { handle } = await import("../scripts/lib/pulse/hooks.js");
  const t = process.hrtime.bigint();
  await handle("SessionStart", {}, { cwd: plain });
  assert.ok(Number(process.hrtime.bigint() - t) / 1e6 < 20, "gate under 20 ms");
  assert.ok(started > 0n);
});

test("AC-PU.2 join with the team key, enable, and the first events are accepted with no approval", async () => {
  const m = machine();
  const repo = project();
  assert.equal(m.syno(repo, "pulse", "join", "--accept").data.needsKey, true);
  assert.equal(m.syno(repo, "pulse", "set-key").code, 0);
  const joined = m.syno(repo, "pulse", "join", "--accept");
  assert.equal(joined.data.joined, true);
  const device = seen().register.find((r) => r.kind === "device" && r.member.email === "asha@example.com");
  assert.equal(device.consent.version, "2026-10-30");
  assert.equal(m.syno(repo, "pulse", "enable").data.applied, false, "enable previews first");
  assert.equal(m.syno(repo, "pulse", "enable", "--confirm").data.applied, true);
  assert.deepEqual(JSON.parse(readFileSync(join(repo, ".claude/settings.json"), "utf8")).enabledPlugins, { "syno@synopus": true });
  const reply = await m.hook("SessionStart", { cwd: repo, session_id: "sess-1", source: "startup" });
  assert.match(reply.context, /Syno Pulse is active/);
  m.flush();
  assert.ok(seen().events.some((e) => e.type === "session_start" && e.sessionId === "sess-1"));
});

test("AC-PU.3 nothing in Pulse reads a reply, command or instruction from the panel", async () => {
  const net = readFileSync(fileURLToPath(new URL("../scripts/lib/pulse/net.js", import.meta.url)), "utf8");
  assert.doesNotMatch(net, /replies|command|instruction/i);
  const hooks = readFileSync(fileURLToPath(new URL("../scripts/lib/pulse/hooks.js", import.meta.url)), "utf8");
  assert.doesNotMatch(hooks, /getStatus|postEvents|fetch\(/, "hooks never talk to the panel themselves");
  assert.deepEqual(seen().other, []);
});

test("AC-PU.5 AC-PU.6 an audit result sends titles and counts, with no file paths or secrets", async () => {
  const m = machine();
  const repo = project();
  m.syno(repo, "pulse", "set-key");
  m.syno(repo, "pulse", "join", "--accept");
  m.syno(repo, "pulse", "enable", "--confirm");
  const emit = spawnSync(process.execPath, ["--input-type=module", "-e", `import { emit } from ${JSON.stringify(new URL("../scripts/lib/pulse/emit.js", import.meta.url).href)}; const ok = await emit(${JSON.stringify(repo)}, "audit.result", { counts: { critical: 2, major: 5 }, critical: [{ title: "Login form sends the password in src/app/login/page.tsx:42", file: "src/app/login/page.tsx", line: 42 }, { title: "Leaked key sk-ant-abcdefghijklmnopqrstu in config" }] }, { background: false }); process.stdout.write(String(ok));`], { env: m.env, encoding: "utf8" });
  assert.equal(emit.stdout, "true", emit.stderr);
  const [event] = m.queue().filter((e) => e.type === "audit.result");
  assert.deepEqual(event.data.counts, { critical: 2, major: 5 });
  assert.equal(event.data.critical.length, 2);
  assert.equal(event.data.critical[0].title, "Login form sends the password in [file]");
  assert.equal("file" in event.data.critical[0], false);
  assert.match(event.data.critical[1].title, /\[redacted\]/);
  assert.doesNotMatch(JSON.stringify(event), /page\.tsx|sk-ant-/);
});

test("S-02 a machine that hasn't joined, or whose key was revoked, sends nothing and says so once", async () => {
  const m = machine();
  const repo = project();
  m.syno(repo, "pulse", "enable", "--confirm");
  assert.deepEqual(await m.hook("SessionStart", { cwd: repo, session_id: "s" }), { lines: ["Pulse: enabled in this project, but this machine hasn't joined, so nothing is sent. /syno:pulse join shows what is collected."] });
  m.syno(repo, "pulse", "set-key");
  m.syno(repo, "pulse", "join", "--accept");
  mkdirSync(join(m.home, "state"), { recursive: true });
  writeFileSync(join(m.home, "state", "revoked.json"), JSON.stringify({ at: Date.now() }));
  const reply = await m.hook("SessionStart", { cwd: repo, session_id: "s" });
  assert.match(reply.lines[0], /key was revoked/);
  assert.equal(m.queue().length, 0);
});

test("S-02 a project Insider enabled points to /syno:migrate", async () => {
  const m = machine();
  const repo = project();
  mkdirSync(join(repo, ".claude"), { recursive: true });
  writeFileSync(join(repo, ".claude", "insider.json"), JSON.stringify({ projectKey: "a".repeat(64), displayName: "Old" }));
  assert.match((await m.hook("SessionStart", { cwd: repo, session_id: "s" })).lines[0], /\/syno:migrate/);
});

test("S-02 the daily roll-up goes out once a day with each function's latest result", async () => {
  const m = machine();
  const repo = project();
  m.syno(repo, "pulse", "set-key");
  m.syno(repo, "pulse", "join", "--accept");
  m.syno(repo, "pulse", "enable", "--confirm");
  spawnSync(process.execPath, ["--input-type=module", "-e", `import { emit } from ${JSON.stringify(new URL("../scripts/lib/pulse/emit.js", import.meta.url).href)}; await emit(${JSON.stringify(repo)}, "fives.score", { overall: 82 }, { background: false });`], { env: m.env });
  await m.hook("SessionStart", { cwd: repo, session_id: "a" });
  await m.hook("SessionStart", { cwd: repo, session_id: "b" });
  const rollups = m.queue().filter((e) => e.type === "daily.rollup");
  assert.equal(rollups.length, 1);
  assert.deepEqual(rollups[0].data.latest["fives.score"], { overall: 82 });
});

test("S-02 the report_update MCP server is syno-pulse and queues a milestone", async () => {
  const m = machine();
  const repo = project();
  m.syno(repo, "pulse", "set-key");
  m.syno(repo, "pulse", "join", "--accept");
  m.syno(repo, "pulse", "enable", "--confirm");
  const child = spawn(process.execPath, [MCP], { env: { ...m.env, CLAUDE_PROJECT_DIR: repo } });
  const replies = [];
  child.stdout.on("data", (d) => replies.push(...d.toString().trim().split("\n").map((l) => JSON.parse(l))));
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "report_update", arguments: { type: "milestone", title: "Invoices export done" } } })}\n`);
  await new Promise((r) => setTimeout(r, 400));
  child.kill();
  assert.equal(replies.find((r) => r.id === 1).result.serverInfo.name, "syno-pulse");
  assert.match(replies.find((r) => r.id === 2).result.content[0].text, /Reported milestone/);
  assert.ok(m.queue().some((e) => e.type === "milestone" && e.title === "Invoices export done"));
});
