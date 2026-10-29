// Chunk 3.6: Syno Devices (PRD S-06, AC-DE.1, AC-DE.2).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { devicesReport, parity } from "../scripts/lib/devices/cli.js";
import { renderReport } from "../scripts/lib/report/render.js";
import { tmp } from "./fixtures.js";

const CLI = fileURLToPath(new URL("../scripts/syno.js", import.meta.url));
const SKILLS = fileURLToPath(new URL("../skills/", import.meta.url));
const syno = (repo, ...args) => spawnSync(process.execPath, [CLI, ...args, "--repo", repo, "--now", "2026-10-30T10:00:00"], { encoding: "utf8", env: { ...process.env, SYNO_PULSE_HOME: tmp("pulse") } });

function project(cfg) {
  const root = tmp("devices");
  writeFileSync(join(root, "app-sync.json"), JSON.stringify(cfg, null, 2));
  return root;
}

const CFG = {
  schema: 1,
  app: { name: "Demo Desk", id: "in.synopus.desk" },
  version: "1.3.0",
  versionSource: "app-sync",
  platforms: { desktop: { enabled: true, mode: "live" }, android: { enabled: true, mode: "bundled" }, ios: { enabled: false } },
  state: { lastDesktopRelease: { version: "1.0.0" }, lastNativeRelease: { version: "1.2.0", platforms: ["android"] } },
};

test("AC-DE.1 a web version ahead of the Android app shows Android as Behind, with both versions", () => {
  const state = parity(project(CFG));
  const android = state.platforms.find((p) => p.name === "android");
  assert.deepEqual([android.status, android.appVersion, android.webVersion], ["Behind", "1.2.0", "1.3.0"]);
  assert.equal(state.platforms.find((p) => p.name === "desktop").status, "In sync", "a live app always shows the latest web app");
  assert.equal(state.platforms.find((p) => p.name === "ios").status, "Not set up");
});

test("S-06 with versionSource web, the web package.json leads", () => {
  const root = project({ ...CFG, versionSource: "web", web: { root: "." } });
  writeFileSync(join(root, "package.json"), JSON.stringify({ version: "1.2.0" }));
  assert.equal(parity(root).platforms.find((p) => p.name === "android").status, "In sync");
});

test("S-06 the report opens with a verdict and passes the plain-language checks", () => {
  const report = devicesReport(parity(project(CFG)), { project: "Demo", date: "2026-10-30" });
  const { markdown, problems } = renderReport(report, { css: "", version: "0.1.0" });
  assert.deepEqual(problems, []);
  assert.match(markdown, /> \*\*Amber:\*\* 1 of 2 apps don't match the web app yet\./);
  assert.match(markdown, /The Android app is behind: it has 1\.2\.0, the web has 1\.3\.0\./);
  assert.equal(report.actions[0].text, "Release the Android app at version 1.3.0");
});

test("S-06 a project without app-sync.json says so, and the report is saved only after --confirm", () => {
  const root = tmp("no-devices");
  assert.match(syno(root, "devices", "status").stdout, /Android\s+Not set up/);
  const repo = project(CFG);
  syno(repo, "devices", "report");
  assert.equal(existsSync(join(repo, ".syno/reports/devices/latest.html")), false);
  syno(repo, "devices", "report", "--confirm");
  assert.ok(existsSync(join(repo, ".syno/reports/devices/2026-10-30.html")));
  assert.match(readFileSync(join(repo, ".syno/reports/devices/latest.md"), "utf8"), /# Device apps/);
});

test("AC-DE.2 every Devices skill asks separately before any push, store upload or workflow run", () => {
  for (const name of ["devices", "devices-desktop", "devices-mobile", "devices-release"]) {
    const text = readFileSync(join(SKILLS, name, "SKILL.md"), "utf8");
    assert.match(text, /needs its own yes, asked as a separate question/, name);
    assert.match(text, /gov run/, name);
    assert.doesNotMatch(text, /Akmo/i, name);
  }
});
