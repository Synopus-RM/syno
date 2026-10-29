// Chunk 2.6: Chronicle's commands end to end (PRD AC-CH-01, 02.2, 02.4, 03, 04, 05.2-5.3, 06, 09.2, 10, 11, 13).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CHANGELOG_C, commit, fixtureB, fixtureC, initRepo, tag, tmp } from "./fixtures.js";

const CLI = fileURLToPath(new URL("../scripts/syno.js", import.meta.url));
const NOW = "2026-10-30T10:15:00";
function syno(repo, ...args) {
  const res = spawnSync(process.execPath, [CLI, ...args, "--repo", repo, "--now", NOW], { encoding: "utf8", env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" } });
  return { code: res.status, out: res.stdout, err: res.stderr };
}
const json = (repo, ...args) => JSON.parse(syno(repo, ...args, "--json").out);
const read = (repo, file) => readFileSync(join(repo, file), "utf8");
const list = (repo, dir) => (existsSync(join(repo, dir)) ? readdirSync(join(repo, dir)).sort() : []);
const PAGES = ["IDEAS.md", "README.md", "RELEASES.md", "STRUCTURE.md", "TIMELINE.md"];

test("AC-CH-01.1 init in an empty folder writes the config, baseline, CHANGELOG and five pages, only after --confirm", () => {
  const repo = tmp("init");
  writeFileSync(join(repo, "app.js"), "x\n");
  const dry = syno(repo, "init");
  assert.equal(dry.code, 0);
  assert.match(dry.out, /would write these files/);
  assert.equal(existsSync(join(repo, ".syno")), false);
  assert.equal(syno(repo, "init", "--confirm").code, 0);
  assert.ok(existsSync(join(repo, ".syno/config.json")) && existsSync(join(repo, ".syno/local/state.json")) && existsSync(join(repo, ".syno/snapshots/baseline.json")));
  assert.match(read(repo, "CHANGELOG.md"), /^# Changelog[\s\S]*<!-- syno:start -->\n## \[Unreleased\]/);
  assert.deepEqual(list(repo, "docs/syno").filter((f) => f.endsWith(".md")), PAGES);
  assert.deepEqual(list(repo, "docs/syno/html"), PAGES.map((p) => p.replace(".md", ".html")));
  assert.equal(syno(repo, "validate").code, 0);
});

test("AC-CH-01.2 running init a second time changes no files", () => {
  const repo = tmp("init2");
  syno(repo, "init", "--confirm");
  const before = read(repo, "docs/syno/README.md");
  const again = json(repo, "init", "--confirm");
  assert.equal(again.applied, false);
  assert.equal(read(repo, "docs/syno/README.md"), before);
});

test("CH-01.3 the .gitignore lines are their own step", () => {
  const repo = tmp("ignore");
  syno(repo, "init", "--confirm");
  assert.equal(existsSync(join(repo, ".gitignore")), false);
  syno(repo, "ignore", "--confirm");
  assert.match(read(repo, ".gitignore"), /\.syno\/sessions\/\n\.syno\/trash\/\n$/);
  assert.match(syno(repo, "ignore").out, /already in \.gitignore/);
});

test("AC-CH-03 ideas: add, change status, and IDEAS.md follows", () => {
  const repo = tmp("ideas");
  syno(repo, "init", "--confirm");
  syno(repo, "idea", "Dark", "mode", "for", "exported", "PDFs", "--confirm");
  const idea = JSON.parse(read(repo, ".syno/ideas/IDEA-0001.json"));
  assert.equal(idea.status, "proposed");
  assert.match(read(repo, "docs/syno/IDEAS.md"), /### Proposed\n\n\| ID \| Idea[\s\S]*IDEA-0001 \| Dark mode for exported PDFs/);
  const dry = syno(repo, "idea", "set", "IDEA-0001", "accepted");
  assert.match(dry.out, /Move IDEA-0001 to Accepted/);
  assert.equal(JSON.parse(read(repo, ".syno/ideas/IDEA-0001.json")).status, "proposed", "nothing written without --confirm");
  syno(repo, "idea", "set", "IDEA-0001", "accepted", "--confirm");
  assert.match(read(repo, "docs/syno/IDEAS.md"), /### Accepted\n\n\| ID[\s\S]*IDEA-0001/);
  assert.equal(syno(repo, "idea", "set", "IDEA-0001", "shipped", "--confirm").code, 3);
});

test("AC-CH-04.1 a new change shows under [Unreleased] and its type at once", () => {
  const repo = tmp("change");
  syno(repo, "init", "--confirm");
  assert.equal(syno(repo, "change", "Totals round", "--confirm").code, 2, "a type is required");
  syno(repo, "change", "Invoice", "totals", "round", "to", "2", "decimals", "--type", "fixed", "--confirm");
  assert.match(read(repo, "CHANGELOG.md"), /## \[Unreleased\]\n\n### Fixed\n\n- Invoice totals round to 2 decimals/);
});

test("AC-CH-05.2 AC-CH-05.3 AC-CH-03.3 cutting a release: refused when empty, previewed, then written", () => {
  const repo = tmp("release");
  syno(repo, "init", "--confirm");
  assert.equal(syno(repo, "release", "cut").code, 3);
  syno(repo, "idea", "CSV export", "--confirm");
  syno(repo, "change", "CSV export of invoices", "--type", "Added", "--ideas", "IDEA-0001", "--confirm");
  const plan = json(repo, "release", "plan");
  assert.equal(plan.version, "0.1.0");
  const preview = syno(repo, "release", "cut");
  assert.match(preview.out, /create  \.syno\/releases\/0\.1\.0\.json/);
  assert.match(preview.out, /remove  \.syno\/changes\//);
  assert.equal(list(repo, ".syno/releases").length, 0, "answering No writes nothing");
  assert.equal(syno(repo, "release", "cut", "--confirm").code, 0);
  assert.deepEqual(list(repo, ".syno/releases"), ["0.1.0.json"]);
  assert.deepEqual(list(repo, ".syno/changes"), []);
  assert.equal(JSON.parse(read(repo, ".syno/ideas/IDEA-0001.json")).shippedIn, "0.1.0");
  assert.match(read(repo, "CHANGELOG.md"), /## \[0\.1\.0\] - 2026-10-30\n\n### Added\n\n- CSV export of invoices/);
  assert.equal(syno(repo, "validate").code, 0);
});

test("AC-CH-06 publishes add a row; non-http links are refused; yank marks the CHANGELOG", () => {
  const repo = tmp("publish");
  syno(repo, "init", "--confirm");
  syno(repo, "change", "First version", "--type", "Added", "--confirm");
  syno(repo, "release", "cut", "--confirm");
  assert.equal(syno(repo, "publish", "0.1.0", "npm", "published", "ftp://x.example").code, 3);
  syno(repo, "publish", "0.1.0", "npm", "published", "https://www.npmjs.com/package/demo", "--confirm");
  assert.match(read(repo, "docs/syno/RELEASES.md"), /\| 0\.1\.0 \| 30 Oct 2026 \| 1 added \| 0 \| npm \| Released \|/);
  syno(repo, "release", "yank", "0.1.0", "--reason", "Wrong totals", "--confirm");
  assert.match(read(repo, "CHANGELOG.md"), /## \[0\.1\.0\] - 2026-10-30 \[YANKED\]/);
});

test("AC-CH-10.1 release notes print Markdown and write nothing", () => {
  const repo = tmp("notes");
  syno(repo, "init", "--confirm");
  syno(repo, "change", "Bulk import", "--type", "Added", "--confirm");
  syno(repo, "release", "cut", "--confirm");
  const before = JSON.stringify(list(repo, ".syno/releases"));
  const { out, code } = syno(repo, "notes", "0.1.0");
  assert.equal(code, 0);
  assert.match(out, /^## 0\.1\.0 — 30 Oct 2026\n\n### Added\n- Bulk import/);
  assert.equal(JSON.stringify(list(repo, ".syno/releases")), before);
});

test("AC-CH-02.1 AC-CH-02.4 init on fixture B adopts four releases, and adopting again changes nothing", () => {
  const repo = fixtureB();
  const dry = syno(repo, "init");
  assert.match(dry.out, /4 releases from version tags \(0\.1\.0 to 1\.0\.0\)/);
  assert.match(dry.out, /skipped: release-candidate/);
  syno(repo, "init", "--confirm");
  assert.deepEqual(list(repo, ".syno/releases"), ["0.1.0.json", "0.2.0.json", "1.0.0-rc.1.json", "1.0.0.json"]);
  assert.deepEqual(list(repo, ".syno/snapshots"), ["0.1.0.json", "0.2.0.json", "1.0.0-rc.1.json", "1.0.0.json"]);
  assert.match(read(repo, "docs/syno/STRUCTURE.md"), /\| Renamed \| src\/invoices → src\/billing \|/);
  assert.equal(json(repo, "adopt", "--confirm").applied, false);
  assert.equal(syno(repo, "validate").code, 0);
});

test("AC-CH-02.2 init on fixture C keeps every byte before the first version", () => {
  const repo = fixtureC();
  syno(repo, "init", "--confirm");
  const text = read(repo, "CHANGELOG.md");
  const intro = CHANGELOG_C.slice(0, CHANGELOG_C.indexOf("## [Unreleased]"));
  assert.ok(text.startsWith(`${intro}<!-- syno:start -->`));
  assert.match(text, /## Earlier history[\s\S]*Some free text we must not lose\./);
  syno(repo, "release", "cut", "--confirm");
  const after = read(repo, "CHANGELOG.md");
  assert.ok(after.startsWith(`${intro}<!-- syno:start -->`));
  assert.equal(after.match(/## Earlier history/g).length, 1, "earlier history isn't repeated");
});

test("AC-CH-11.1 a tag made with plain git becomes a proposed release", () => {
  const repo = fixtureB();
  syno(repo, "init", "--confirm");
  commit(repo, "feat: export to Excel", "2026-04-01T09:00:00Z", { "src/export.js": "x\n" });
  tag(repo, "v1.1.0", "2026-04-02T09:00:00Z", true);
  assert.match(syno(repo, "chronicle", "status").out, /Tags not recorded yet: v1\.1\.0/);
  const dry = syno(repo, "sync");
  assert.match(dry.out, /1\.1\.0 \(v1\.1\.0, 2026-04-02\): 1 changes/);
  syno(repo, "sync", "--confirm");
  const r = JSON.parse(read(repo, ".syno/releases/1.1.0.json"));
  assert.deepEqual(r.changes.map((c) => `${c.type}: ${c.summary}`), ["Added: export to Excel"]);
  assert.equal(JSON.parse(read(repo, ".syno/local/state.json")).lastSyncedTag, "v1.1.0");
});

test("CH-05.6 the version bump and the local tag are separate steps, and nothing is pushed", () => {
  const repo = initRepo("bump");
  writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "demo", version: "0.1.0" }, null, 2));
  commit(repo, "chore: start", "2026-01-01T09:00:00Z");
  syno(repo, "init", "--confirm");
  syno(repo, "change", "Reports", "--type", "Added", "--confirm");
  syno(repo, "release", "cut", "--version", "0.2.0", "--confirm");
  syno(repo, "release", "bump", "0.2.0", "--files", "package.json", "--confirm");
  assert.equal(JSON.parse(read(repo, "package.json")).version, "0.2.0");
  assert.match(syno(repo, "release", "tag", "0.2.0").out, /would make the local tag v0\.2\.0/);
  syno(repo, "release", "tag", "0.2.0", "--confirm");
  assert.equal(execFileSync("git", ["tag", "--list", "v0.2.0"], { cwd: repo, encoding: "utf8" }).trim(), "v0.2.0");
  assert.equal(JSON.parse(read(repo, ".syno/releases/0.2.0.json")).git.tag, "v0.2.0");
});

test("AC-CH-13.1 AC-CH-13.2 validate names the file, field and reason; render --check catches stale docs", () => {
  const repo = tmp("validate");
  syno(repo, "init", "--confirm");
  syno(repo, "change", "Login page", "--type", "Added", "--confirm");
  const [name] = list(repo, ".syno/changes");
  const file = `.syno/changes/${name}`;
  writeFileSync(join(repo, file), JSON.stringify({ ...JSON.parse(read(repo, file)), type: "Improved" }));
  const v = syno(repo, "validate");
  assert.equal(v.code, 1);
  assert.match(v.out, new RegExp(`${file.replace(/\./g, "\\.")}: type must be one of`));
  const r = syno(repo, "render", "--check");
  assert.equal(r.code, 1);
  assert.match(r.out, /CHANGELOG\.md/);
});

test("AC-CH-09.2 a page edited by hand is noticed and not overwritten without a yes", () => {
  const repo = tmp("handedit");
  syno(repo, "init", "--confirm");
  writeFileSync(join(repo, "docs/syno/IDEAS.md"), `${read(repo, "docs/syno/IDEAS.md")}\nMy own note.\n`);
  const res = syno(repo, "idea", "Offline mode", "--confirm");
  assert.match(res.out, /edited by hand, so Syno left them alone:\n  docs\/syno\/IDEAS\.md/);
  assert.match(read(repo, "docs/syno/IDEAS.md"), /My own note\./);
  syno(repo, "render", "--confirm", "--overwrite-edits");
  assert.doesNotMatch(read(repo, "docs/syno/IDEAS.md"), /My own note\./);
  assert.match(read(repo, "docs/syno/IDEAS.md"), /Offline mode/);
});

test("AC-CH-04.2 two branches that each add a change merge with no conflict in .syno/", () => {
  const repo = initRepo("merge");
  commit(repo, "chore: start", "2026-01-01T09:00:00Z", { "a.txt": "a\n" });
  syno(repo, "init", "--confirm");
  syno(repo, "ignore", "--confirm");
  commit(repo, "chore: syno", "2026-01-01T09:05:00Z");
  const g = (...args) => execFileSync("git", ["-c", "user.name=A", "-c", "user.email=a@x", ...args], { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  g("checkout", "-q", "-b", "one");
  spawnSync(process.execPath, [CLI, "change", "From branch one", "--type", "Added", "--repo", repo, "--now", "2026-01-02T09:00:00", "--confirm"]);
  commit(repo, "feat: one", "2026-01-02T09:00:00Z");
  g("checkout", "-q", "main");
  g("checkout", "-q", "-b", "two");
  spawnSync(process.execPath, [CLI, "change", "From branch two", "--type", "Fixed", "--repo", repo, "--now", "2026-01-03T09:00:00", "--confirm"]);
  commit(repo, "fix: two", "2026-01-03T09:00:00Z");
  g("checkout", "-q", "one");
  spawnSync("git", ["-c", "user.name=A", "-c", "user.email=a@x", "merge", "-q", "--no-edit", "two"], { cwd: repo });
  const conflicted = g("diff", "--name-only", "--diff-filter=U").split("\n").filter(Boolean);
  assert.ok(conflicted.every((f) => !f.startsWith(".syno/")), `conflicts: ${conflicted.join(", ")}`);
  assert.equal(list(repo, ".syno/changes").length, 2);
});
