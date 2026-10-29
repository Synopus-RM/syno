// Test fixtures built in a temporary folder (PRD §16). Fixture B: a git repo
// with tags v0.1.0, v0.2.0, v1.0.0-rc.1 and v1.0.0, conventional and plain
// commits, one merge, a renamed and a deleted folder. Fixture C: a hand-written
// CHANGELOG.md. Fixture E: 10,000 commits and 50 tags, made with fast-import.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export const tmp = (name) => mkdtempSync(join(tmpdir(), `syno-${name}-`));

function g(repo, args, date = "2026-01-01T10:00:00Z", input) {
  const env = { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date, GIT_CONFIG_NOSYSTEM: "1" };
  return execFileSync("git", ["-c", "user.name=Asha Dev", "-c", "user.email=asha@example.com", "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", ...args], { cwd: repo, env, input, encoding: "utf8" });
}

export function initRepo(name = "repo") {
  const repo = tmp(name);
  g(repo, ["init", "-q", "-b", "main"]);
  return repo;
}

export function put(repo, file, content = `${file}\n`) {
  mkdirSync(dirname(join(repo, file)), { recursive: true });
  writeFileSync(join(repo, file), content);
}

export function commit(repo, message, date, files = {}) {
  for (const [file, content] of Object.entries(files)) put(repo, file, content);
  g(repo, ["add", "-A"], date);
  g(repo, ["commit", "-q", "--allow-empty", "-m", message], date);
}

export const tag = (repo, name, date, annotated = false) => g(repo, ["tag", ...(annotated ? ["-a", "-m", name] : []), name], date);

export function fixtureB() {
  const repo = initRepo("fixture-b");
  commit(repo, "Initial commit", "2026-01-01T09:00:00Z", { "README.md": "# Demo\n" });
  commit(repo, "feat: add invoices", "2026-01-05T09:00:00Z", { "src/invoices/list.js": "list\n", "src/invoices/total.js": "total\n", "src/invoices/pdf.js": "pdf\n" });
  commit(repo, "fix: round invoice totals", "2026-01-08T09:00:00Z", { "src/invoices/total.js": "total v2\n" });
  tag(repo, "v0.1.0", "2026-01-10T09:00:00Z");
  commit(repo, "feat!: new public API", "2026-01-20T09:00:00Z", { "src/api/v1.js": "api\n", "src/api/auth.js": "auth\n" });
  commit(repo, "chore: tidy scripts", "2026-01-22T09:00:00Z", { "scripts/dev.sh": "dev\n" });
  commit(repo, "Update readme", "2026-01-25T09:00:00Z", { "README.md": "# Demo\n\nMore.\n" });
  tag(repo, "v0.2.0", "2026-02-01T09:00:00Z", true);
  g(repo, ["checkout", "-q", "-b", "feature"], "2026-02-05T09:00:00Z");
  commit(repo, "feat: monthly reports", "2026-02-05T09:00:00Z", { "src/reports/monthly.js": "monthly\n" });
  g(repo, ["checkout", "-q", "main"], "2026-02-06T09:00:00Z");
  g(repo, ["merge", "-q", "--no-ff", "-m", "Merge branch 'feature'", "feature"], "2026-02-06T09:00:00Z");
  g(repo, ["mv", "src/invoices", "src/billing"], "2026-02-10T09:00:00Z");
  commit(repo, "refactor: rename invoices to billing", "2026-02-10T09:00:00Z");
  commit(repo, "perf: faster totals", "2026-02-20T09:00:00Z", { "src/billing/total.js": "total v3\n" });
  tag(repo, "v1.0.0-rc.1", "2026-03-01T09:00:00Z");
  rmSync(join(repo, "src/api"), { recursive: true });
  commit(repo, "revert: remove the old API", "2026-03-05T09:00:00Z");
  commit(repo, "fix: totals are whole paise\n\nBREAKING CHANGE: totals are now integers", "2026-03-10T09:00:00Z", { "src/billing/total.js": "total v4\n" });
  tag(repo, "v1.0.0", "2026-03-15T09:00:00Z", true);
  tag(repo, "release-candidate", "2026-03-15T09:00:00Z");
  return repo;
}

export const CHANGELOG_C = `# Changelog

All notable changes to this project are documented here.
Hand-written intro that must survive byte for byte.

## [Unreleased]
### Added
- Dark mode

## [1.1.0] - 2026-02-01
### Added
- CSV export
### Fixed
- Totals rounding
  across pages

## Notes from the old team
Some free text we must not lose.

## v1.0.0 - 2026-01-01
- First public release

## 0.9.0
### Highlights
- Beta for friends

[1.1.0]: https://github.com/example/demo/compare/v1.0.0...v1.1.0
`;

export function fixtureC() {
  const root = tmp("fixture-c");
  writeFileSync(join(root, "CHANGELOG.md"), CHANGELOG_C);
  return root;
}

/** 10,000 commits and 50 tags, built in one fast-import stream. */
export function fixtureE(commits = 10000, tags = 50) {
  const repo = initRepo("fixture-e");
  const every = Math.floor(commits / tags);
  const parts = [];
  for (let i = 1; i <= commits; i++) {
    const msg = `${i % 3 === 0 ? "fix" : "feat"}: change ${i}\n`;
    const body = `content ${i}\n`;
    parts.push(`commit refs/heads/main\nmark :${i}\ncommitter Asha Dev <asha@example.com> ${1700000000 + i * 60} +0000\ndata ${Buffer.byteLength(msg)}\n${msg}${i > 1 ? `from :${i - 1}\n` : ""}M 644 inline src/part${i % 100}/file.txt\ndata ${Buffer.byteLength(body)}\n${body}\n`);
    if (i % every === 0) parts.push(`reset refs/tags/v0.${i / every}.0\nfrom :${i}\n\n`);
  }
  g(repo, ["fast-import", "--quiet"], undefined, parts.join(""));
  return repo;
}
