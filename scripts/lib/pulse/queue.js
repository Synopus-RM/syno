// Syno Pulse's local queue (ported from Synopus Insider, F-07). Hooks only append a line and return; the sender renames
// the live file into a "sending" segment before reading it, so appends never
// wait on a send. Segments are sent oldest first, which keeps each session's
// events in time order — the server's active-time maths relies on that.
import { randomBytes } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { EVENT_MAX_BYTES, paths, stateDir } from "./config.js";

export const MAX_AGE_MS = 7 * 24 * 60 * 60_000;
export const MAX_QUEUE_BYTES = 5 * 1024 * 1024;

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** ULID: 48-bit millisecond time + 80 random bits, Crockford base32. */
export function newEventId(now = Date.now()) {
  let time = "";
  for (let t = now, i = 0; i < 10; i++, t = Math.floor(t / 32)) time = CROCKFORD[t % 32] + time;
  let rand = "";
  for (const byte of randomBytes(16)) rand += CROCKFORD[byte % 32];
  return time + rand.slice(0, 16);
}

/** Appends one event. Oversized events are dropped with a local warning (F-06). */
export function enqueue(event) {
  const line = JSON.stringify(event);
  if (Buffer.byteLength(line) > EVENT_MAX_BYTES) {
    process.stderr.write(`syno-pulse: dropped ${event.type} event over ${EVENT_MAX_BYTES} bytes\n`);
    return false;
  }
  const file = paths.queue();
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  appendFileSync(file, `${line}\n`, { mode: 0o600 });
  return true;
}

/** Moves the live queue into a new sending segment (atomic rename). */
export function sealQueue() {
  const live = paths.queue();
  try {
    if (statSync(live).size === 0) return;
  } catch {
    return;
  }
  renameSync(live, join(stateDir(), `sending-${Date.now()}-${randomBytes(3).toString("hex")}.jsonl`));
}

export function segments() {
  let names = [];
  try {
    names = readdirSync(stateDir());
  } catch {}
  return names.filter((n) => /^sending-\d+-[0-9a-f]+\.jsonl$/.test(n)).sort().map((n) => join(stateDir(), n));
}

/** Events in a segment, minus malformed lines and anything older than 7 days. */
export function readSegment(file, now = Date.now()) {
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const events = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (now - Date.parse(event.at) <= MAX_AGE_MS) events.push(event);
    } catch {}
  }
  return events;
}

/** Rewrites a segment with only the given events, or deletes it when none remain. */
export function writeSegment(file, events) {
  if (events.length === 0) {
    try {
      unlinkSync(file);
    } catch {}
    return;
  }
  writeFileSync(file, events.map((e) => JSON.stringify(e)).join("\n") + "\n", { mode: 0o600 });
}

/** Keeps total queued bytes under 5 MB by dropping the oldest segments first. */
export function enforceSizeCap() {
  const files = segments();
  let total = files.reduce((sum, f) => sum + (statSync(f, { throwIfNoEntry: false })?.size ?? 0), 0);
  for (const file of files) {
    if (total <= MAX_QUEUE_BYTES) break;
    total -= statSync(file, { throwIfNoEntry: false })?.size ?? 0;
    writeSegment(file, []);
  }
}
