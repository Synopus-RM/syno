// Fixture E (PRD AC-CH-02.3): adopting 10,000 commits and 50 tags takes 30 s
// or less. Slow to build, so it runs only with SYNO_PERF=1
// (`node test/selftest.js --perf` sets it).
import { test } from "node:test";
import assert from "node:assert/strict";
import { adoptHistory } from "../scripts/lib/chronicle/adopt.js";
import { newConfig } from "../scripts/lib/chronicle/config.js";
import { fixtureE } from "./fixtures.js";

const run = process.env.SYNO_PERF === "1";

test("AC-CH-02.3 adopting 10,000 commits and 50 tags takes 30 s or less", { skip: !run && "set SYNO_PERF=1 to run", timeout: 120000 }, () => {
  const repo = fixtureE();
  const started = Date.now();
  const result = adoptHistory(repo, newConfig({ name: "Scale" }), { all: true });
  const seconds = (Date.now() - started) / 1000;
  console.log(`# adoption of 10,000 commits and 50 tags: ${seconds.toFixed(2)} s`);
  assert.equal(result.releases.length, 50);
  assert.equal(result.releases.reduce((n, r) => n + r.changes.length, 0), 10000);
  assert.ok(seconds <= 30, `took ${seconds} s`);
});
