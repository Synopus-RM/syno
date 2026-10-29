// Chunk 2.2: versions, records and config (PRD CH-03, CH-04, CH-05.1, §8).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WritePlan } from "../scripts/lib/fsutil.js";
import { compare, nextVersion, parse, sortDesc } from "../scripts/lib/chronicle/semver.js";
import { checkRecord, loadReleases, newChange, newIdea, nextIdeaId, planRecord, setIdeaStatus, slugify } from "../scripts/lib/chronicle/records.js";
import { loadConfig, migrateConfig, newConfig } from "../scripts/lib/chronicle/config.js";
import { bumpManifestText, detectManifest, findManifests } from "../scripts/lib/chronicle/manifests.js";
import { validate } from "../scripts/lib/schema.js";
import { schemaFor } from "../scripts/lib/chronicle/records.js";

const NOW = new Date(2026, 9, 30, 10, 15, 0); // 30 Oct 2026, 10:15:00 local
const tmp = () => mkdtempSync(join(tmpdir(), "syno-rec-"));
const fixed = [{ type: "Fixed" }];
const added = [{ type: "Added" }];
const breaking = [{ type: "Changed", breaking: true }];

test("AC-CH-05.1 next-version proposals across 0.x and 1.x", () => {
  const cases = [
    [null, [], {}, "0.1.0"],
    [null, [], { first: "1.4.2" }, "1.4.2"],
    [null, [], { pre: "alpha" }, "0.1.0-alpha.1"],
    ["1.2.3", fixed, {}, "1.2.4"],
    ["1.2.3", added, {}, "1.3.0"],
    ["1.2.3", breaking, {}, "2.0.0"],
    ["2.0.0", [{ type: "Security" }], {}, "2.0.1"],
    ["1.2.3", [{ type: "Deprecated" }, { type: "Added" }], {}, "1.3.0"],
    ["0.4.1", breaking, {}, "0.5.0"],
    ["0.9.9", breaking, {}, "0.10.0"],
    ["0.4.1", [{ type: "Changed" }], {}, "0.4.2"],
    ["1.2.3", added, { pre: "rc" }, "1.3.0-rc.1"],
    ["1.3.0-rc.1", fixed, { pre: "rc" }, "1.3.0-rc.2"],
    ["1.3.0-rc.2", fixed, {}, "1.3.0"],
    ["1.3.0-alpha.3", fixed, { pre: "beta" }, "1.3.0-beta.1"],
  ];
  assert.ok(cases.length >= 12);
  for (const [current, changes, opts, want] of cases) {
    assert.equal(nextVersion(current, changes, opts), want, `${current} + ${JSON.stringify(changes)} ${JSON.stringify(opts)}`);
  }
});

test("CH-05 SemVer precedence follows the spec's own example", () => {
  const order = ["1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-alpha.beta", "1.0.0-beta", "1.0.0-beta.2", "1.0.0-beta.11", "1.0.0-rc.1", "1.0.0"];
  for (let i = 1; i < order.length; i++) assert.ok(compare(order[i - 1], order[i]) < 0, `${order[i - 1]} < ${order[i]}`);
  assert.deepEqual(sortDesc(["0.2.0", "1.0.0-rc.1", "1.0.0", "0.1.0"]), ["1.0.0", "1.0.0-rc.1", "0.2.0", "0.1.0"]);
  assert.equal(parse("v1.2.3").major, 1);
  assert.equal(parse("1.2"), null);
});

test("AC-CH-03.1 idea IDs are four digits, then five after IDEA-9999", () => {
  assert.equal(nextIdeaId([]), "IDEA-0001");
  assert.equal(nextIdeaId([{ id: "IDEA-0009" }, { id: "IDEA-0003" }]), "IDEA-0010");
  assert.equal(nextIdeaId([{ id: "IDEA-9999" }]), "IDEA-10000");
  const idea = newIdea({ title: "Dark mode for exported PDFs" }, { ideas: [], now: NOW, author: "Synopus" });
  assert.equal(idea.status, "proposed");
  assert.equal(idea.created, "2026-10-30");
  assert.deepEqual(checkRecord("idea", idea), []);
});

test("CH-03.2 the idea lifecycle allows only its own moves", () => {
  let idea = newIdea({ title: "Export to Excel" }, { ideas: [], now: NOW });
  assert.throws(() => setIdeaStatus(idea, "planned", { now: NOW }), { exit: 3 });
  idea = setIdeaStatus(idea, "accepted", { now: NOW });
  idea = setIdeaStatus(idea, "parked", { now: NOW });
  idea = setIdeaStatus(idea, "proposed", { now: NOW });
  assert.deepEqual(idea.statusHistory.map((s) => s.status), ["proposed", "accepted", "parked", "proposed"]);
  const rejected = setIdeaStatus(idea, "rejected", { now: NOW });
  assert.throws(() => setIdeaStatus(rejected, "proposed", { now: NOW }), { exit: 3 });
});

test("AC-CH-03.3 only a release marks an idea shipped, with its version", () => {
  const idea = newIdea({ title: "Bulk import" }, { ideas: [], now: NOW });
  assert.throws(() => setIdeaStatus(idea, "shipped", { now: NOW }), /Only a release/);
  const shipped = setIdeaStatus(idea, "shipped", { now: NOW, byRelease: true, version: "1.3.0" });
  assert.equal(shipped.shippedIn, "1.3.0");
});

test("CH-04 change files are named YYYYMMDD-HHMMSS-<slug> and validate", () => {
  const change = newChange({ type: "Fixed", summary: "Invoice totals round to 2 decimals" }, { now: NOW, author: "Synopus" });
  assert.equal(change.id, "20261030-101500-invoice-totals-round-to-2-decimals");
  assert.deepEqual(checkRecord("change", change), []);
  assert.throws(() => newChange({ type: "Improved", summary: "x" }, { now: NOW }), { exit: 2 });
  assert.throws(() => newChange({ type: "Fixed", summary: "x".repeat(201) }, { now: NOW }), { exit: 2 });
  assert.equal(slugify("  Ünïcode & Spaces!! "), "unicode-spaces");
});

test("CH-13 schema errors read in plain words", () => {
  const change = newChange({ type: "Fixed", summary: "x" }, { now: NOW });
  const [err] = checkRecord("change", { ...change, id: "bad id" });
  assert.equal(`${err.path} ${err.message}`, "id must be a change ID like 20261030-101500-fix-totals");
});

test("§8 records land in their own files, and releases load newest first", () => {
  const root = tmp();
  const plan = new WritePlan(root);
  for (const v of ["0.2.0", "1.0.0-rc.1", "1.0.0", "0.1.0"]) {
    planRecord(plan, "release", { schemaVersion: 1, version: v, date: "2026-10-30", status: "released", changes: [], ideas: [], channels: [], source: "syno" });
  }
  plan.apply({ confirm: true });
  assert.deepEqual(loadReleases(root).map((r) => r.version), ["1.0.0", "1.0.0-rc.1", "0.2.0", "0.1.0"]);
});

test("§8 a PRD 0.1 config migrates to version 2 and validates", () => {
  const v1 = { schemaVersion: 1, project: { name: "Old", repoUrl: null }, versionSource: "git-tags", tagPrefix: "release-", nudges: "commits", locale: "en" };
  const v2 = migrateConfig(v1);
  assert.equal(v2.schemaVersion, 2);
  assert.equal(v2.chronicle.tagPrefix, "release-");
  assert.equal(v2.chronicle.nudges, "commits");
  assert.equal(v2.chronicle.snapshot.depth, 3);
  assert.deepEqual(validate(schemaFor("config"), v2), []);
  assert.deepEqual(validate(schemaFor("config"), newConfig({ name: "New" })), []);
  const root = tmp();
  mkdirSync(join(root, ".syno"));
  writeFileSync(join(root, ".syno/config.json"), JSON.stringify(v1));
  assert.equal(loadConfig(root).chronicle.versionSource, "git-tags");
  assert.equal(loadConfig(tmp()), null);
});

test("CH-02.4 the version is read from the first manifest, as text", () => {
  const root = tmp();
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "x", version: "1.4.2", dependencies: { y: "1.4.2" } }, null, 2));
  writeFileSync(join(root, "Cargo.toml"), '[package]\nname = "x"\nversion = "0.3.0"\n\n[dependencies]\nserde = { version = "1.0" }\n');
  writeFileSync(join(root, "VERSION"), "2.0.0\n");
  writeFileSync(join(root, "app.csproj"), "<Project><PropertyGroup><Version>5.1.0</Version></PropertyGroup></Project>");
  assert.deepEqual(detectManifest(root), { path: "package.json", version: "1.4.2" });
  assert.deepEqual(findManifests(root).map((m) => `${m.path}@${m.version}`), ["package.json@1.4.2", "Cargo.toml@0.3.0", "app.csproj@5.1.0", "VERSION@2.0.0"]);
  const pom = "<project><parent><version>9.9.9</version></parent><modelVersion>4.0.0</modelVersion><version>3.2.1</version></project>";
  writeFileSync(join(root, "pom.xml"), pom);
  assert.equal(findManifests(root).find((m) => m.path === "pom.xml").version, "3.2.1");
});

test("CH-05.6 a manifest bump changes only the project's own version", () => {
  const pkg = JSON.stringify({ name: "x", version: "1.4.2", dependencies: { y: "1.4.2" } }, null, 2);
  const bumped = bumpManifestText("package.json", pkg, "1.4.2", "1.5.0");
  assert.equal(JSON.parse(bumped).version, "1.5.0");
  assert.equal(JSON.parse(bumped).dependencies.y, "1.4.2");
  const cargo = '[package]\nname = "x"\nversion = "0.3.0"\n\n[dependencies]\nserde = { version = "1.0" }\n';
  assert.equal(bumpManifestText("Cargo.toml", cargo, "0.3.0", "0.4.0"), cargo.replace('version = "0.3.0"', 'version = "0.4.0"'));
  assert.equal(bumpManifestText("Cargo.toml", cargo, "9.9.9", "1.0.0"), null);
  assert.equal(bumpManifestText("pyproject.toml", '[project]\nversion = "0.1.0"\n', "0.1.0", "0.2.0"), '[project]\nversion = "0.2.0"\n');
});
