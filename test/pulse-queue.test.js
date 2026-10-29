// Ported from Synopus Insider's queue.test.mjs, with Syno Pulse's rules (PRD S-02,
// AC-PU.4, AC-PU.7): nothing is dropped while the site may take it later, new
// event types wait until the site accepts them, and a 401 clears the queue.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { CONSENT_VERSION, paths, sha256, writeJson } from "../scripts/lib/pulse/config.js";
import { enqueue, newEventId, readSegment, segments } from "../scripts/lib/pulse/queue.js";
import { flush } from "../scripts/lib/pulse/sender.js";
import { isRevoked, saveStatus } from "../scripts/lib/pulse/state.js";

const projectKey = sha256("git:github.com/acme/site");
let server;
let received;
let respond;

function startServer() {
  return new Promise((resolve) => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const events = JSON.parse(body).events;
        received.push(events);
        const [status, json] = respond(events);
        res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(json));
      });
    }).listen(0, "127.0.0.1", () => {
      process.env.SYNO_PULSE_API = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
}

const event = (type, atMs, extra = {}) => ({ id: newEventId(atMs), type, projectKey, sessionId: "sess-1", at: new Date(atMs).toISOString(), ...extra });
const queued = () => segments().flatMap((f) => readSegment(f));

beforeEach(() => {
  process.env.SYNO_PULSE_HOME = mkdtempSync(join(tmpdir(), "pulse-queue-"));
  writeJson(paths.device(), { token: "t".repeat(43), consentVersion: CONSENT_VERSION });
  received = [];
  respond = (events) => [200, { accepted: events.length, duplicates: 0, rejected: [] }];
});

afterEach(() => {
  server?.close();
  server = undefined;
  rmSync(process.env.SYNO_PULSE_HOME, { recursive: true, force: true });
});

test("ULIDs are 26 Crockford characters and sort by time", () => {
  const a = newEventId(1_700_000_000_000);
  const b = newEventId(1_700_000_000_001);
  assert.match(a, /^[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.ok(a.slice(0, 10) < b.slice(0, 10));
});

test("AC-PU.7 events queued while offline are kept, then sent once, in order", async () => {
  process.env.SYNO_PULSE_API = "http://127.0.0.1:9"; // nothing listens here
  const now = Date.now();
  for (let i = 0; i < 3; i++) enqueue(event("commit", now + i));
  assert.equal((await flush({ force: true })).kept, 3);
  await startServer();
  assert.equal((await flush({ force: true })).sent, 3);
  assert.deepEqual(received.flat().map((e) => e.at), [0, 1, 2].map((i) => new Date(now + i).toISOString()));
  assert.equal(segments().length, 0);
  assert.equal((await flush({ force: true })).sent, 0);
});

test("backs off after a failure unless forced", async () => {
  process.env.SYNO_PULSE_API = "http://127.0.0.1:9";
  enqueue(event("commit", Date.now()));
  await flush({ force: true });
  await startServer();
  assert.equal((await flush()).sent, 0, "inside the backoff window");
  assert.equal((await flush({ force: true })).sent, 1);
});

test("splits 120 events into batches of 50 and keeps their order", async () => {
  await startServer();
  const now = Date.now();
  for (let i = 0; i < 120; i++) enqueue(event("heartbeat", now + i));
  assert.equal((await flush({ force: true })).sent, 120);
  assert.deepEqual(received.map((b) => b.length), [50, 50, 20]);
});

test("S-02 a device the old site still holds as pending (403) keeps its events", async () => {
  await startServer();
  respond = () => [403, { error: "device_pending" }];
  enqueue(event("commit", Date.now()));
  assert.deepEqual(await flush({ force: true }), { sent: 0, dropped: 0, kept: 1 });
  assert.equal(queued().length, 1);
  respond = (events) => [200, { accepted: events.length, duplicates: 0, rejected: [] }];
  assert.equal((await flush({ force: true })).sent, 1);
});

test("S-02 events for a project the site doesn't know yet are kept; malformed ones are dropped", async () => {
  await startServer();
  const now = Date.now();
  const unknown = event("commit", now);
  const bad = event("commit", now + 1);
  const good = event("commit", now + 2);
  respond = () => [200, { accepted: 1, duplicates: 0, rejected: [{ id: unknown.id, reason: "project_unknown" }, { id: bad.id, reason: "session_mismatch" }] }];
  [unknown, bad, good].forEach((e) => enqueue(e));
  assert.deepEqual(await flush({ force: true }), { sent: 1, dropped: 1, kept: 1 });
  assert.deepEqual(queued().map((e) => e.id), [unknown.id]);
});

test("AC-PU.4 a new event type waits until the site lists it as accepted", async () => {
  await startServer();
  const now = Date.now();
  enqueue(event("audit.result", now, { title: "Audit: 2 Critical" }));
  enqueue(event("commit", now + 1));
  assert.deepEqual(await flush({ force: true }), { sent: 1, dropped: 0, kept: 1 });
  assert.deepEqual(received.flat().map((e) => e.type), ["commit"]);
  saveStatus(projectKey, { device: "active", accepts: ["audit.result"] });
  assert.equal((await flush({ force: true })).sent, 1);
  assert.deepEqual(received.flat().map((e) => e.type), ["commit", "audit.result"]);
});

test("AC-PU.4 a waiting event is dropped after 7 days", () => {
  enqueue(event("audit.result", Date.now() - 8 * 24 * 60 * 60_000));
  enqueue(event("audit.result", Date.now()));
  assert.equal(readSegment(paths.queue()).length, 1);
});

test("AC-PU.3 a 401 clears the queue and marks this machine revoked", async () => {
  await startServer();
  respond = () => [401, { error: "device_revoked" }];
  enqueue(event("commit", Date.now()));
  enqueue(event("commit", Date.now() + 1));
  const result = await flush({ force: true });
  assert.equal(result.dropped, 2);
  assert.equal(segments().length, 0);
  assert.equal(isRevoked(), true);
});

test("does nothing without consent to the current notice", async () => {
  writeJson(paths.device(), { token: "t".repeat(43), consentVersion: "2026-10-28" });
  await startServer();
  enqueue(event("commit", Date.now()));
  assert.deepEqual(await flush({ force: true }), { sent: 0, dropped: 0, kept: 0 });
  assert.equal(received.length, 0);
});
