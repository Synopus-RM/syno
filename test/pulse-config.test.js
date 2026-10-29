// Ported from Synopus Insider's config.test.mjs (PRD S-02).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { findEnabledProject, normaliseRemote, projectKeyFor, sha256 } from "../scripts/lib/pulse/config.js";

const tmp = () => mkdtempSync(join(tmpdir(), "pulse-config-"));

test("a project without .syno/pulse.json is not enabled", () => {
  const root = tmp();
  mkdirSync(join(root, "src", "deep"), { recursive: true });
  assert.equal(findEnabledProject(join(root, "src", "deep")), null);
});

test("finds the nearest .syno/pulse.json from a subfolder", () => {
  const root = tmp();
  const key = sha256("git:github.com/acme/site");
  mkdirSync(join(root, ".syno"));
  mkdirSync(join(root, "src", "lib"), { recursive: true });
  writeFileSync(join(root, ".syno", "pulse.json"), JSON.stringify({ projectKey: key, displayName: "Acme" }));
  const found = findEnabledProject(join(root, "src", "lib"));
  assert.equal(found.root, root);
  assert.equal(found.projectKey, key);
});

test("a malformed pulse.json counts as not enabled", () => {
  const root = tmp();
  mkdirSync(join(root, ".syno"));
  writeFileSync(join(root, ".syno", "pulse.json"), "{ not json");
  assert.equal(findEnabledProject(root), null);
});

test("the gate check is fast enough for every hook (< 10 ms)", () => {
  const root = tmp();
  mkdirSync(join(root, "a", "b", "c"), { recursive: true });
  const start = process.hrtime.bigint();
  for (let i = 0; i < 100; i++) findEnabledProject(join(root, "a", "b", "c"));
  const perCallMs = Number(process.hrtime.bigint() - start) / 1e6 / 100;
  assert.ok(perCallMs < 10, `gate took ${perCallMs.toFixed(2)} ms`);
});

test("normalises SSH and HTTPS remotes to the same key", () => {
  assert.equal(normaliseRemote("git@github.com:Acme/Site.git"), "github.com/acme/site");
  assert.equal(normaliseRemote("https://user:pw@github.com/acme/site/"), "github.com/acme/site");
  assert.equal(normaliseRemote("ssh://git@github.com:22/acme/site.git"), "github.com/acme/site");
  assert.equal(normaliseRemote(""), null);
  assert.equal(
    projectKeyFor({ remoteUrl: "git@github.com:Acme/Site.git", root: "/a" }),
    projectKeyFor({ remoteUrl: "https://github.com/acme/site", root: "/b" }),
  );
});

test("falls back to the folder path when there is no remote", () => {
  assert.equal(projectKeyFor({ remoteUrl: null, root: "/x/y" }), sha256("path:/x/y"));
});
