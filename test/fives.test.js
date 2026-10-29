// Chunk 4.4: 5S Sort, Set in Order and the trash (PRD S-14, AC-FS.1, AC-FS.2, AC-FS.3).
// Fixture H: duplicates, temp files, an empty folder, and a file that is imported.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { WritePlan } from "../scripts/lib/fsutil.js";
import { globRe, resolveSpec } from "../scripts/lib/fives/set.js";
import { commit, initRepo, tmp } from "./fixtures.js";

const CLI = fileURLToPath(new URL("../scripts/syno.js", import.meta.url));
const BINARY = Buffer.from([0, 255, 10, 13, 0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

function fixtureH() {
  const root = initRepo("fixture-h");
  commit(root, "feat: start", "2026-01-01T09:00:00Z", {
    "src/logo.png": "", "assets/logo-copy.png": "",
    "src/util.js": "export const add = (a, b) => a + b;\n",
    "src/total.js": 'import { add } from "./util.js";\nexport const total = (xs) => xs.reduce(add, 0);\n',
    "src/index.js": 'import { total } from "./total.js";\nimport "./total.test.js";\nconsole.log(total([1, 2]));\n',
    "src/total.test.js": 'import { total } from "./total.js";\nif (total([1]) !== 1) throw new Error("bad");\n',
    "src/old-helper.js": "export const unused = 1;\n",
    ".gitignore": ".syno/local/\n.syno/reports/\n.syno/trash/\n.syno/sessions/\nignored/\n",
  });
  writeFileSync(join(root, "src/logo.png"), BINARY);
  writeFileSync(join(root, "assets/logo-copy.png"), BINARY);
  execFileSync("git", ["-c", "user.name=A", "-c", "user.email=a@x", "commit", "-qam", "binary logos"], { cwd: root });
  writeFileSync(join(root, "debug.log"), "noise\n");
  mkdirSync(join(root, "empty/inner"), { recursive: true });
  mkdirSync(join(root, "ignored"), { recursive: true });
  writeFileSync(join(root, "ignored/keep.log"), "ignored\n");
  const syno = (...a) => spawnSync(process.execPath, [CLI, ...a, "--repo", root, "--now", "2026-10-30T10:00:00"], { encoding: "utf8", env: { ...process.env, SYNO_PULSE_HOME: tmp("pulse") } });
  return { root, syno };
}

/** Every file under root (but .git) with its hash. */
function inventory(root, dir = "") {
  const out = {};
  for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (rel === ".git") continue;
    if (e.isDirectory()) Object.assign(out, inventory(root, rel));
    else out[rel] = createHash("sha256").update(readFileSync(join(root, rel))).digest("hex");
  }
  return out;
}

test("S-14 Sort ticks duplicates, temp files and empty folders; it only lists unused files, and never touches ignored ones", () => {
  const { syno } = fixtureH();
  const res = JSON.parse(syno("5s", "sort", "--json").stdout);
  const byId = Object.fromEntries(res.findings.map((f) => [f.id, f.pick]));
  assert.equal(byId["dup:assets/logo-copy.png"], true);
  assert.equal(byId["temp:debug.log"], true);
  assert.equal(byId["empty:empty/inner"], true);
  assert.equal(byId["unused:src/old-helper.js"], false);
  assert.ok(!("unused:src/util.js" in byId), "an imported file isn't unused");
  assert.ok(!res.findings.some((f) => f.path.startsWith("ignored")));
  assert.equal(res.applied, false);
});

test("AC-FS.2 no 5S command deletes a file outside .syno/trash/", () => {
  const { root, syno } = fixtureH();
  const before = inventory(root);
  const { trashId } = JSON.parse(syno("5s", "sort", "--confirm", "--json").stdout);
  const after = inventory(root);
  for (const [path, hash] of Object.entries(before)) {
    if (after[path] === hash) continue;
    assert.equal(after[`.syno/trash/${trashId}/files/${path}`], hash, `${path} is kept in the trash`);
  }
  assert.ok(!existsSync(join(root, "empty/inner")));
  assert.throws(() => new WritePlan(root).trash(".git/config", "20261030-100000"), /never touches/);
  assert.throws(() => new WritePlan(root).trash(".syno/trash/x", "20261030-100000"), /never touches/);
});

test("AC-FS.1 a file moved by Sort is restored byte-identical by restore, and so is the empty folder", () => {
  const { root, syno } = fixtureH();
  const { trashId } = JSON.parse(syno("5s", "sort", "--confirm", "--json").stdout);
  assert.ok(!existsSync(join(root, "assets/logo-copy.png")));
  syno("5s", "restore", trashId, "--confirm");
  assert.ok(readFileSync(join(root, "assets/logo-copy.png")).equals(BINARY));
  assert.ok(statSync(join(root, "empty/inner")).isDirectory());
  assert.match(syno("5s", "trash").stdout, new RegExp(`${trashId}: 5S Sort, 3 item\\(s\\), restored`));
  assert.equal(syno("5s", "restore", trashId, "--confirm").status, 2, "a folder is restored once");
});

test("AC-FS.3 a proposed move that would break an import lists the import change in the same preview", () => {
  const { root, syno } = fixtureH();
  mkdirSync(join(root, ".syno/5s"), { recursive: true });
  writeFileSync(join(root, ".syno/5s/standards.json"), JSON.stringify({ layout: [{ match: "**/*.test.js", dir: "test", why: "tests live in test/" }] }));
  const preview = syno("5s", "set").stdout;
  assert.match(preview, /move src\/total\.test\.js → test\/total\.test\.js \(tests live in test\/\)/);
  assert.match(preview, /its own import \.\/total\.js → \.\.\/src\/total\.js/);
  assert.match(preview, /src\/index\.js: \.\/total\.test\.js → \.\.\/test\/total\.test\.js/);
  const { trashId } = JSON.parse(syno("5s", "set", "--confirm", "--json").stdout);
  assert.match(readFileSync(join(root, "test/total.test.js"), "utf8"), /from "\.\.\/src\/total\.js"/);
  execFileSync(process.execPath, [join(root, "src/index.js")]);
  syno("5s", "restore", trashId, "--confirm");
  assert.ok(existsSync(join(root, "src/total.test.js")));
  assert.ok(!existsSync(join(root, "test/total.test.js")), "the moved copy goes back to the trash");
  assert.match(readFileSync(join(root, "src/index.js"), "utf8"), /"\.\/total\.test\.js"/);
});

test("S-14 globs and import specifiers resolve the way bundlers read them", () => {
  assert.ok(globRe("**/*.test.js").test("total.test.js"));
  assert.ok(globRe("**/*.test.js").test("a/b/total.test.js"));
  assert.ok(!globRe("src/*.js").test("src/a/b.js"));
  const files = new Set(["src/a.ts", "src/lib/index.ts"]);
  assert.equal(resolveSpec("src/b.ts", "./a", files), "src/a.ts");
  assert.equal(resolveSpec("src/b.ts", "./lib", files), "src/lib/index.ts");
  assert.equal(resolveSpec("src/b.ts", "./missing", files), null);
});
