// Chunk 4.3: Syno Pause (PRD S-12, AC-PS.1, AC-PS.2, AC-PS.3). The Governor's
// queue is read from a throwaway WG_HOME, never the owner's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { handle } from "../scripts/lib/pause/hooks.js";
import { commit, initRepo, put, tmp } from "./fixtures.js";

const CLI = fileURLToPath(new URL("../scripts/syno.js", import.meta.url));

function project() {
  const root = initRepo("pause");
  commit(root, "feat: invoices", "2026-10-29T09:00:00Z", { "src/a.js": "a\n", "src/b.js": "b\n" });
  const wg = tmp("wg");
  writeFileSync(join(wg, "queue.json"), JSON.stringify({ tickets: [{ id: "t-1", label: "e2e invoices", state: "waiting", project: basename(root), pid: 1 }, { id: "t-2", label: "other build", state: "running", project: "elsewhere", pid: 1 }] }));
  const env = { ...process.env, SYNO_PULSE_HOME: tmp("pulse"), WG_HOME: wg };
  const syno = (...a) => spawnSync(process.execPath, [CLI, ...a, "--repo", root, "--now", "2026-10-30T10:00:00"], { encoding: "utf8", env });
  syno("init", "--name", "Demo", "--confirm");
  commit(root, "chore: syno", "2026-10-29T10:00:00Z");
  const session = join(tmp("pause-scratch"), "session.json");
  writeFileSync(session, JSON.stringify({ title: "Invoice sharing", goal: "Share invoices on WhatsApp", done: ["PDF export"], next: ["Add the Share button", "Write the test guide"], decisions: ["Which WhatsApp API to pay for"], files: ["src/a.js"], note: "token ghp_abcdefghijklmnopqrstuvwxyz0123456789AB was in the log" }));
  return { root, syno, session };
}

test("AC-PS.1 pausing with 2 uncommitted files lists both, with the next steps and queued Governor jobs", () => {
  const { root, syno, session } = project();
  put(root, "src/a.js", "a changed\n");
  put(root, "src/c.js", "new\n");
  const preview = JSON.parse(syno("pause", "--file", session, "--json").stdout);
  assert.equal(preview.applied, false);
  const res = JSON.parse(syno("pause", "--file", session, "--confirm", "--json").stdout);
  assert.deepEqual(res.uncommitted, ["src/a.js", "src/c.js"]);
  const md = readFileSync(join(root, res.file), "utf8");
  assert.match(md, /Uncommitted files \(2\):\n  - src\/a\.js\n  - src\/c\.js/);
  assert.match(md, /## Next steps\n\n1\. Add the Share button\n2\. Write the test guide/);
  assert.match(md, /## Governor jobs still queued\n\n- e2e invoices \(waiting\)\n\n/);
  assert.doesNotMatch(md, /other build/);
  assert.match(md, /`\/syno:resume 20261030-100000-invoice-sharing\.md`/);
});

test("§S-12 text that looks like a secret is redacted before writing", () => {
  const { root, syno, session } = project();
  const res = JSON.parse(syno("pause", "--file", session, "--confirm", "--json").stdout);
  assert.doesNotMatch(readFileSync(join(root, res.file), "utf8"), /ghp_abcdefghijklmnopqrstuvwxyz/);
});

test("AC-PS.2 the resume file is git-ignored; git status doesn't show it", () => {
  const { root, syno, session } = project();
  syno("pause", "--file", session, "--confirm");
  assert.match(readFileSync(join(root, ".gitignore"), "utf8"), /^\.syno\/sessions\/$/m, "pause adds the ignore line when it is missing");
  assert.equal(execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }), "?? .gitignore\n");
  assert.equal(execFileSync("git", ["status", "--porcelain", "--ignored", ".syno/sessions"], { cwd: root, encoding: "utf8" }), "!! .syno/sessions/\n");
});

test("AC-PS.3 resuming on another branch warns before any next step, then records resumedAt", () => {
  const { root, syno, session } = project();
  const { file } = JSON.parse(syno("pause", "--file", session, "--confirm", "--json").stdout);
  execFileSync("git", ["checkout", "-q", "-b", "other"], { cwd: root });
  const out = syno("resume", basename(file)).stdout;
  assert.match(out, /^Warning: this was paused on branch main, but you are on other now/);
  assert.ok(out.indexOf("Warning") < out.indexOf("## Next steps"));
  syno("resume", basename(file), "--confirm");
  assert.match(readFileSync(join(root, file), "utf8"), /^resumedAt: "2026-10-30T/m);
});

test("S-12 the brief shows one line while a paused session waits, and none once it is resumed", () => {
  const { root, syno, session } = project();
  const { file } = JSON.parse(syno("pause", "--file", session, "--confirm", "--json").stdout);
  assert.deepEqual(handle("SessionStart", {}, { cwd: root }).lines, ["Paused: Invoice sharing (30 Oct 2026). Run /syno:resume to continue."]);
  assert.match(syno("resume", "list").stdout, /Invoice sharing \(30 Oct 2026, branch main\)/);
  syno("resume", basename(file), "--confirm");
  assert.equal(handle("SessionStart", {}, { cwd: root }), null);
});
