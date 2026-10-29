// Chunk 2.5: Chronicle docs and CHANGELOG (PRD CH-08, CH-09, AC-CH-02.2, 07.3, 08.x, 09.1).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { adoptHistory } from "../scripts/lib/chronicle/adopt.js";
import { END, START, parseChangelog } from "../scripts/lib/chronicle/changelog-parse.js";
import { newConfig } from "../scripts/lib/chronicle/config.js";
import { compareUrl, renderChangelog, repoLinks } from "../scripts/lib/chronicle/render/changelog.js";
import { ideasPage, readmePage, releasesPage } from "../scripts/lib/chronicle/render/pages.js";
import { events, structurePage, timelinePage } from "../scripts/lib/chronicle/render/timeline.js";
import { takeSnapshot } from "../scripts/lib/chronicle/snapshot.js";
import { STYLES_PATH, renderReport } from "../scripts/lib/report/render.js";
import { CHANGELOG_C, fixtureB, fixtureC } from "./fixtures.js";

const NOW = new Date(2026, 9, 30, 10, 15, 0);
const config = newConfig({ name: "Demo", repoUrl: "git@github.com:example/demo.git" });
const css = readFileSync(STYLES_PATH, "utf8");
const outside = (text) => {
  const s = text.indexOf(START);
  const e = text.indexOf(END) + END.length;
  return [text.slice(0, s), text.slice(e)];
};

function dataB() {
  const repo = fixtureB();
  const adopted = adoptHistory(repo, config, { now: NOW });
  const asc = [...adopted.releases].reverse();
  const snapshots = [];
  for (const r of asc) snapshots.push(takeSnapshot(repo, config.chronicle, { id: r.version, date: r.date, ref: r.git.tag, previous: snapshots.at(-1) ?? null }));
  snapshots.push(takeSnapshot(repo, config.chronicle, { id: "2026-03-20", date: "2026-03-20", ref: "v1.0.0", previous: snapshots.at(-1) }));
  const releases = adopted.releases.map((r) => (r.version === "1.0.0" ? { ...r, ideas: ["IDEA-0001"], channels: [{ channel: "npm", status: "published", date: "2026-03-16", url: "https://www.npmjs.com/package/demo" }] } : r));
  const ideas = [
    { schemaVersion: 1, id: "IDEA-0001", title: "Monthly reports", status: "shipped", statusHistory: [{ status: "proposed", date: "2026-01-02" }, { status: "accepted", date: "2026-01-15" }, { status: "shipped", date: "2026-03-15" }], shippedIn: "1.0.0", created: "2026-01-02", updated: "2026-03-15", author: null, links: [], tags: [] },
    { schemaVersion: 1, id: "IDEA-0002", title: "Tamil interface", status: "proposed", statusHistory: [{ status: "proposed", date: "2026-03-18" }], shippedIn: null, created: "2026-03-18", updated: "2026-03-18", author: null, links: [], tags: [] },
  ];
  return { project: "Demo", releases, pending: [], ideas, snapshots };
}

const data = dataB();
const PAGES = { README: readmePage, RELEASES: releasesPage, IDEAS: ideasPage, STRUCTURE: structurePage, TIMELINE: timelinePage };

test("AC-CH-02.2 bytes outside the markers survive adoption and a later release", () => {
  const root = fixtureC();
  const adopted = adoptHistory(root, config, { now: NOW });
  const region = parseChangelog(CHANGELOG_C).region;
  const first = renderChangelog({ releases: adopted.releases, pending: adopted.pending, earlier: adopted.earlier }, CHANGELOG_C, region);
  const [before] = outside(first);
  assert.equal(before, CHANGELOG_C.slice(0, region.start));
  assert.match(first, /## Earlier history[\s\S]*Some free text we must not lose\./);
  assert.match(first, /## \[Unreleased\]\n\n### Added\n\n- Dark mode/);
  const next = { schemaVersion: 1, version: "1.2.0", date: "2026-11-01", status: "released", changes: adopted.pending, ideas: [], channels: [], source: "syno" };
  const second = renderChangelog({ releases: [next, ...adopted.releases], pending: [], earlier: adopted.earlier }, first, parseChangelog(first).region);
  assert.deepEqual(outside(second), outside(first));
  assert.match(second, /## \[1\.2\.0\] - 2026-11-01\n\n### Added\n\n- Dark mode/);
});

test("CH-09 a new CHANGELOG has the standard header, yanked marks, breaking flags and compare links", () => {
  const releases = data.releases.map((r) => (r.version === "0.2.0" ? { ...r, status: "yanked", yanked: { date: "2026-02-02", reason: "Bad build" } } : r));
  const text = renderChangelog({ releases, pending: [], repoUrl: config.project.repoUrl });
  assert.match(text, /^# Changelog\n\nAll notable changes/);
  assert.match(text, /## \[0\.2\.0\] - 2026-02-01 \[YANKED\]/);
  assert.match(text, /- \*\*BREAKING:\*\* new public API/);
  assert.match(text, /\[Unreleased\]: https:\/\/github\.com\/example\/demo\/compare\/v1\.0\.0\.\.\.HEAD/);
  assert.match(text, /\[1\.0\.0\]: https:\/\/github\.com\/example\/demo\/compare\/v1\.0\.0-rc\.1\.\.\.v1\.0\.0/);
  assert.match(text, /\[0\.1\.0\]: https:\/\/github\.com\/example\/demo\/releases\/tag\/v0\.1\.0/);
});

test("CH-09 compare links follow GitLab and Bitbucket patterns too", () => {
  assert.equal(compareUrl(repoLinks("https://gitlab.com/g/p.git"), "v1.0.0", "v1.1.0"), "https://gitlab.com/g/p/-/compare/v1.0.0...v1.1.0");
  assert.equal(compareUrl(repoLinks("git@bitbucket.org:t/r.git"), "v1.0.0", "v1.1.0"), "https://bitbucket.org/t/r/branches/compare/v1.1.0%0Dv1.0.0");
  assert.equal(repoLinks("https://example.com/x/y"), null);
});

test("AC-CH-08.1 events land in the right months, newest first", () => {
  const list = events(data);
  const dates = list.map((e) => e.date);
  assert.deepEqual(dates, [...dates].sort().reverse());
  const { sections } = timelinePage(data);
  const headings = sections.map((s) => s.heading);
  assert.deepEqual(headings.slice(1), ["Mar 2026", "Feb 2026", "Jan 2026"]);
  const march = sections[1].table.rows.map((r) => r[1]);
  assert.ok(march.indexOf("Idea IDEA-0002 added: Tamil interface") < march.indexOf("1.0.0 published to npm"));
  assert.ok(march.indexOf("1.0.0 published to npm") < march.indexOf("Released 1.0.0 with 2 changes"));
  // v1.0.0-rc.1 is a lightweight tag, so it carries its commit's date (20 Feb), not the day it was tagged.
  assert.match(sections[0].mermaid, /^timeline\n  title Releases in the last 12 months\n  2026-01 : 0\.1\.0\n  2026-02 : 0\.2\.0 : 1\.0\.0-rc\.1\n  2026-03 : 1\.0\.0$/);
});

test("AC-CH-08.2 AC-CH-09.1 every page renders byte-identically twice, Markdown and HTML", () => {
  for (const [name, build] of Object.entries(PAGES)) {
    const a = renderReport(build(data), { css, version: "0.1.0" });
    const b = renderReport(build(structuredClone(data)), { css, version: "0.1.0" });
    assert.equal(a.markdown, b.markdown, name);
    assert.equal(a.html, b.html, name);
  }
});

test("§5.3 every Chronicle page passes the plain-language checks and opens with the banner", () => {
  for (const [name, build] of Object.entries(PAGES)) {
    const { markdown, problems } = renderReport(build(data), { css, version: "0.1.0" });
    assert.deepEqual(problems, [], name);
    assert.ok(markdown.startsWith("> Generated by Syno. Edit with /syno commands.\n\n# "), name);
    assert.match(markdown, /\*\*How to read this page\.\*\*/, name);
  }
});

test("AC-CH-07.3 a release with identical folders says No structure changes", () => {
  const page = structurePage({ ...data, snapshots: [...data.snapshots, { ...data.snapshots.at(-2), id: "1.0.1", date: "2026-03-21", diffFromPrevious: { previous: "1.0.0", added: [], removed: [], renamed: [], topLevel: [], moves: [] } }], releases: [{ ...data.releases[0], version: "1.0.1", date: "2026-03-21" }, ...data.releases] });
  assert.ok(page.sections.some((s) => s.heading === "Changes in 1.0.1" && s.text === "No structure changes."));
  assert.ok(page.sections.some((s) => s.heading === "Changes in 1.0.0-rc.1" && s.table.rows.some((r) => r[1] === "src/invoices → src/billing")));
});

test("CH-09 the releases page lists versions, publishes and shipped ideas", () => {
  const { markdown } = renderReport(releasesPage(data), { css, version: "0.1.0" });
  assert.match(markdown, /\| 1\.0\.0 \| 15 Mar 2026 \| 1 removed, 1 fixed \| 1 \| npm \| Released \|/);
  assert.match(markdown, /- Idea shipped: IDEA-0001 Monthly reports/);
  assert.match(markdown, /\| npm \| published \| 16 Mar 2026 \| https:\/\/www\.npmjs\.com\/package\/demo \|/);
});
