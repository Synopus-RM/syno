// Chunk 2.3: adopting an existing repository (PRD CH-02, AC-CH-02.1, 02.4, 02.5).
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { adoptHistory, ideaCandidates, readTags } from "../scripts/lib/chronicle/adopt.js";
import { parseChangelog } from "../scripts/lib/chronicle/changelog-parse.js";
import { classifyCommit } from "../scripts/lib/chronicle/classify.js";
import { newConfig } from "../scripts/lib/chronicle/config.js";
import { checkRecord } from "../scripts/lib/chronicle/records.js";
import { CHANGELOG_C, fixtureB, fixtureC, tmp } from "./fixtures.js";

const NOW = new Date(2026, 9, 30, 10, 15, 0);
const config = newConfig({ name: "Demo" });
const repoB = fixtureB();

test("CH-02.2 commits are classified by their Conventional Commits prefix", () => {
  assert.deepEqual(classifyCommit("feat(api): add search"), { type: "Added", breaking: false, summary: "add search" });
  assert.deepEqual(classifyCommit("fix!: drop v1 tokens"), { type: "Fixed", breaking: true, summary: "drop v1 tokens" });
  assert.equal(classifyCommit("perf: faster").type, "Changed");
  assert.equal(classifyCommit("refactor: tidy").type, "Changed");
  assert.equal(classifyCommit("revert: undo x").type, "Removed");
  assert.equal(classifyCommit('Revert "feat: x"').type, "Removed");
  assert.equal(classifyCommit("docs: readme").type, "Changed");
  assert.equal(classifyCommit("Update readme").type, "Changed");
  assert.equal(classifyCommit("fix: x", "Body\n\nBREAKING CHANGE: y").breaking, true);
});

test("AC-CH-02.1 four tags become four releases, typed as mapped, with the breaking commit flagged", () => {
  const result = adoptHistory(repoB, config, { now: NOW });
  assert.equal(result.repo, true);
  assert.deepEqual(result.releases.map((r) => r.version), ["1.0.0", "1.0.0-rc.1", "0.2.0", "0.1.0"]);
  const types = Object.fromEntries(result.releases.map((r) => [r.version, r.changes.map((c) => `${c.type}${c.breaking ? "!" : ""}: ${c.summary}`).sort()]));
  assert.deepEqual(types["0.1.0"], ["Added: add invoices", "Changed: Initial commit", "Fixed: round invoice totals"]);
  assert.deepEqual(types["0.2.0"], ["Added!: new public API", "Changed: Update readme", "Changed: tidy scripts"]);
  assert.deepEqual(types["1.0.0-rc.1"], ["Added: monthly reports", "Changed: faster totals", "Changed: rename invoices to billing"]);
  assert.deepEqual(types["1.0.0"], ["Fixed!: totals are whole paise", "Removed: remove the old API"]);
  assert.ok(result.releases.every((r) => r.changes.every((c) => !/^Merge/.test(c.summary))), "merge commit skipped");
  for (const r of result.releases) assert.deepEqual(checkRecord("release", r), [], r.version);
  assert.deepEqual(result.tags.unmatched, ["release-candidate"]);
  assert.equal(result.releases[0].git.tag, "v1.0.0");
  assert.equal(result.releases[0].date, "2026-03-15");
});

test("AC-CH-02.4 adopting twice gives exactly the same records", () => {
  assert.deepEqual(adoptHistory(repoB, config, { now: NOW }), adoptHistory(repoB, config, { now: NOW }));
});

test("CH-02.1 only the last 50 tags are read unless --all", () => {
  const { tags } = readTags(repoB, config.chronicle.tagPattern);
  assert.deepEqual(tags.map((t) => t.version), ["0.1.0", "0.2.0", "1.0.0-rc.1", "1.0.0"]);
  assert.equal(adoptHistory(repoB, config, { now: NOW }).tags.limited, false);
});

test("CH-02.5 a hand-written CHANGELOG is parsed, and what can't be parsed is kept", () => {
  const parsed = parseChangelog(CHANGELOG_C);
  assert.deepEqual(parsed.releases.map((r) => `${r.version}@${r.date}`), ["1.1.0@2026-02-01", "1.0.0@2026-01-01", "0.9.0@null"]);
  assert.deepEqual(parsed.releases[0].entries, [
    { type: "Added", breaking: false, summary: "CSV export" },
    { type: "Fixed", breaking: false, summary: "Totals rounding across pages" },
  ]);
  assert.deepEqual(parsed.unreleased, [{ type: "Added", breaking: false, summary: "Dark mode" }]);
  assert.match(parsed.earlier, /## Notes from the old team\nSome free text we must not lose\./);
  assert.equal(CHANGELOG_C.slice(0, parsed.region.start), "# Changelog\n\nAll notable changes to this project are documented here.\nHand-written intro that must survive byte for byte.\n\n");
  assert.equal(parsed.region.end, CHANGELOG_C.length);
});

test("CH-02.5 adoption without git uses the CHANGELOG and keeps undated versions verbatim", () => {
  const result = adoptHistory(fixtureC(), config, { now: NOW });
  assert.equal(result.repo, false);
  assert.deepEqual(result.releases.map((r) => `${r.version}:${r.source}`), ["1.1.0:adopted-changelog", "1.0.0:adopted-changelog"]);
  assert.equal(result.pending.length, 1);
  assert.equal(result.pending[0].summary, "Dark mode");
  assert.match(result.earlier, /## 0\.9\.0\n### Highlights\n- Beta for friends/);
  for (const r of result.releases) assert.deepEqual(checkRecord("release", r), [], r.version);
  for (const c of result.pending) assert.deepEqual(checkRecord("change", c), []);
});

test("CH-02.5 a CHANGELOG Syno already manages is read between its markers", () => {
  const text = "# Log\n\nIntro.\n\n<!-- syno:start -->\n## [2.0.0] - 2026-05-01\n### Added\n- Teams\n<!-- syno:end -->\n\nFooter\n";
  const parsed = parseChangelog(text);
  assert.equal(parsed.hasMarkers, true);
  assert.deepEqual(parsed.releases.map((r) => r.version), ["2.0.0"]);
  assert.equal(text.slice(parsed.region.end), "\n\nFooter\n");
});

test("CH-02.6 ROADMAP, IDEAS and BACKLOG bullets are offered as ideas", () => {
  const root = tmp("ideas");
  writeFileSync(join(root, "ROADMAP.md"), "# Roadmap\n\n- Offline mode\n- [ ] Tamil interface\n\nNot a bullet\n");
  writeFileSync(join(root, "BACKLOG.md"), "* Bulk SMS reminders\n");
  assert.deepEqual(ideaCandidates(root).map((c) => `${c.file}: ${c.title}`), ["ROADMAP.md: Offline mode", "ROADMAP.md: Tamil interface", "BACKLOG.md: Bulk SMS reminders"]);
});
