// Chunk 2.4: structure snapshots and diffs (PRD CH-07, AC-CH-07.1 to 07.3, fixture D).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { newConfig } from "../scripts/lib/chronicle/config.js";
import { diffSnapshots, isEmptyDiff } from "../scripts/lib/chronicle/diff.js";
import { checkRecord } from "../scripts/lib/chronicle/records.js";
import { foldersOf, fsFiles, takeSnapshot } from "../scripts/lib/chronicle/snapshot.js";
import { fixtureB, tmp } from "./fixtures.js";

const { chronicle } = newConfig({ name: "Demo" });
const repoB = fixtureB();
const snapAt = (tag, previous = null) => takeSnapshot(repoB, chronicle, { id: tag.replace(/^v/, ""), date: "2026-03-15", ref: tag, previous });

test("CH-07.1 folders are counted to the configured depth, each including what's under it", () => {
  const files = [{ path: "a/b/c/d/e.js", bytes: 10 }, { path: "a/x.js", bytes: 5 }, { path: "root.txt", bytes: 1 }];
  const { folders, totals } = foldersOf(files, 3);
  assert.deepEqual(folders, [
    { path: "a", files: 2, bytes: 15 },
    { path: "a/b", files: 1, bytes: 10 },
    { path: "a/b/c", files: 1, bytes: 10 },
  ]);
  assert.deepEqual(totals, { files: 3, bytes: 16 });
});

test("AC-CH-07.1 a renamed folder is reported as renamed, not as removed plus added", () => {
  const before = snapAt("v0.2.0");
  const after = snapAt("v1.0.0-rc.1", before);
  const d = after.diffFromPrevious;
  assert.deepEqual(d.renamed, [{ from: "src/invoices", to: "src/billing" }]);
  assert.ok(!d.removed.includes("src/invoices") && !d.added.includes("src/billing"));
  assert.deepEqual(d.added, ["src/reports"]);
  // total.js was edited after the move, so git sees 2 of its 3 files moved: still at least 60%.
  assert.deepEqual(d.moves.map((m) => `${m.from} → ${m.to}`).sort(), ["src/invoices/list.js → src/billing/list.js", "src/invoices/pdf.js → src/billing/pdf.js"]);
  assert.deepEqual(checkRecord("snapshot", after), []);
});

test("CH-07.3 a deleted folder is removed, and top-level changes are counted", () => {
  const before = snapAt("v1.0.0-rc.1");
  const after = snapAt("v1.0.0", before);
  assert.deepEqual(after.diffFromPrevious.removed, ["src/api"]);
  // src/api held "api\n" (4 bytes) and "auth\n" (5 bytes).
  assert.deepEqual(after.diffFromPrevious.topLevel, [{ path: "src", filesDelta: -2, bytesDelta: -9 }]);
});

test("AC-CH-07.3 two identical trees give no structure changes", () => {
  const a = snapAt("v1.0.0");
  const b = snapAt("v1.0.0", a);
  assert.equal(isEmptyDiff(b.diffFromPrevious), true);
});

test("AC-CH-07.2 node_modules and other ignored folders never appear (fixture D, no git)", () => {
  const root = tmp("fixture-d");
  for (const [file, text] of Object.entries({ "node_modules/left-pad/index.js": "x", "dist/app.js": "x", "src/app.js": "app", "src/lib/util.js": "u", "README.md": "hi" })) {
    mkdirSync(join(root, file, ".."), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  symlinkSync("/etc", join(root, "outside-link"));
  const snap = takeSnapshot(root, chronicle, { id: "baseline", date: "2026-10-30" });
  assert.equal(snap.source, "filesystem");
  assert.deepEqual(snap.folders.map((f) => f.path), ["src", "src/lib"]);
  assert.equal(snap.totals.files, 3);
  assert.ok(!fsFiles(root, chronicle.snapshot.ignore).some((f) => f.path.includes("node_modules") || f.path.startsWith("outside-link")));
});

test("CH-07.3 without git, a folder with the same files and bytes counts as renamed", () => {
  const prev = { id: "a", totals: { files: 2, bytes: 8 }, folders: [{ path: "docs", files: 2, bytes: 8 }] };
  const cur = { id: "b", totals: { files: 2, bytes: 8 }, folders: [{ path: "guides", files: 2, bytes: 8 }] };
  assert.deepEqual(diffSnapshots(prev, cur).renamed, [{ from: "docs", to: "guides" }]);
});
