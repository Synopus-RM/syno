// Chunk 4.7: Syno Security (PRD S-16, AC-SE.1 to AC-SE.4, AC-CH-05.4 with a security finding).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isLocalUrl } from "../scripts/lib/security/local.js";
import { entropy, scanRoutes, secretsIn } from "../scripts/lib/security/scan.js";
import { parseAudit } from "../scripts/lib/security/deps.js";
import { securityPulse, securityReport } from "../scripts/lib/security/report.js";
import { renderReport } from "../scripts/lib/report/render.js";
import { commit, initRepo, tmp } from "./fixtures.js";

const CLI = fileURLToPath(new URL("../scripts/syno.js", import.meta.url));
const ATTACK = fileURLToPath(new URL("../skills/security/scripts/attack.mjs", import.meta.url));
const TEST_KEY = "sk_test_4eC39HqLyjWDarjtT1zdp7dc";

function project(files = {}) {
  const root = initRepo("security");
  commit(root, "feat: app", "2026-10-01T09:00:00Z", {
    "src/routes.js": 'router.get("/api/marks", (req, res) => res.json(db.marks()));\nrouter.get("/api/me", requireAuth, (req, res) => res.json(req.user));\n// syno: public\nrouter.get("/health", (req, res) => res.send("ok"));\n',
    "src/pay.js": `const stripe = new Stripe("${TEST_KEY}");\n`,
    ...files,
  });
  const env = { ...process.env, SYNO_PULSE_HOME: tmp("pulse") };
  const syno = (...a) => spawnSync(process.execPath, [CLI, ...a, "--repo", root, "--now", "2026-10-30T10:00:00"], { encoding: "utf8", env });
  syno("init", "--name", "School", "--confirm");
  syno("ignore", "--confirm");
  const scratch = tmp("sec-scratch");
  const put = (name, data) => {
    writeFileSync(join(scratch, name), JSON.stringify(data));
    return join(scratch, name);
  };
  return { root, syno, put };
}

const run = (args) => new Promise((resolve) => {
  const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => (stdout += d));
  child.stderr.on("data", (d) => (stderr += d));
  child.on("close", (code) => resolve({ code, stdout, stderr }));
});

test("AC-SE.1 an abuse-case test pointed at a non-local host is refused before any request is made", async () => {
  let hits = 0;
  const server = createServer((_req, res) => { hits++; res.writeHead(403).end(); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const local = `http://127.0.0.1:${server.address().port}`;
  const dir = tmp("attack");
  writeFileSync(join(dir, "bad.json"), JSON.stringify({ cases: [{ id: "SEC-0001", requests: [{ url: `${local}/api/marks` }, { url: "https://example.com/api/marks" }] }] }));
  const bad = await run([ATTACK, join(dir, "bad.json")]);
  assert.equal(bad.code, 3);
  assert.match(bad.stderr, /Not local: https:\/\/example\.com\/api\/marks/);
  assert.equal(hits, 0, "not even the local request was sent");
  writeFileSync(join(dir, "good.json"), JSON.stringify({ base: local, cases: [{ id: "SEC-0001", requests: [{ url: "/api/marks", expect: { status: 403 } }] }, { id: "SEC-0002", requests: [{ url: "/api/marks", expect: { status: 200 } }] }] }));
  const good = await run([ATTACK, join(dir, "good.json")]);
  server.close();
  assert.deepEqual(JSON.parse(good.stdout).results.map((r) => [r.id, r.status]), [["SEC-0001", "Tested"], ["SEC-0002", "Failing"]]);
  assert.equal(hits, 2);
});

test("AC-SE.1 the CLI refuses a non-local plan too, before running anything", () => {
  const { syno, put } = project();
  syno("security", "design", "--file", put("cases.json", { cases: [{ role: "Student", rule: "see another student's marks", why: "Marks are private", control: "Server checks the student id" }] }), "--confirm");
  const res = syno("security", "attack", "--plan", put("plan.json", { cases: [{ id: "SEC-0001", requests: [{ url: "http://192.168.1.5/api/marks" }] }] }), "--confirm");
  assert.equal(res.status, 3);
  assert.equal(isLocalUrl("http://app.localhost:3000/x"), true);
  assert.equal(isLocalUrl("http://shop.test/x"), true);
  assert.equal(isLocalUrl("http://[::1]:8080/"), true);
  assert.equal(isLocalUrl("http://localhost.evil.com/"), false);
  assert.equal(isLocalUrl("http://user:pw@localhost/"), false);
  assert.equal(isLocalUrl("file:///etc/passwd"), false);
});

test("AC-SE.2 a committed test key is reported masked, with its file and line in the local report only", () => {
  const { root, syno } = project();
  const res = JSON.parse(syno("security", "scan", "--confirm", "--json").stdout);
  const key = res.findings.find((f) => f.category === "secret");
  assert.equal(key.title, "Stripe test key in a tracked file");
  assert.deepEqual(key.evidence, [{ file: "src/pay.js", line: 1, masked: "sk_t…" }]);
  const syno_ = (dir) => readdirSync(join(root, dir), { recursive: true }).filter((f) => /\.(json|md|html)$/.test(f)).map((f) => readFileSync(join(root, dir, f), "utf8")).join("\n");
  assert.doesNotMatch(syno_(".syno"), /4eC39HqLyjWDarjtT1zdp7dc/, "the key itself is stored nowhere");
  assert.match(readFileSync(join(root, ".syno/reports/security/latest.md"), "utf8"), /src\/pay\.js:1 \(sk_t…\)/);
  assert.doesNotMatch(JSON.stringify(securityPulse({ cases: [], records: [{ findings: res.findings }] })), /src\/|sk_t/);
});

test("AC-SE.3 a route without a server-side permission check is a High finding", () => {
  const { root } = project({ "app/api/grades/route.ts": "export async function GET() { return Response.json(await db.grades()); }\n", "app/api/me/route.ts": "export async function GET() { const s = await getServerSession(); return Response.json(s); }\n" });
  const found = scanRoutes(root).map((f) => [f.severity, f.title, `${f.evidence[0].file}:${f.evidence[0].line}`]);
  assert.deepEqual(found, [["High", "The route app/api/grades/route.ts has no server-side permission check", "app/api/grades/route.ts:1"], ["High", "The route GET /api/marks has no server-side permission check", "src/routes.js:1"]]);
});

test("AC-SE.4 the security report and findings folders are git-ignored after /syno:init", () => {
  const { root, syno } = project();
  syno("security", "scan", "--confirm");
  const ignored = execFileSync("git", ["check-ignore", ".syno/reports/security/latest.html", `.syno/local/security/${readdirSync(join(root, ".syno/local/security"))[0]}`], { cwd: root, encoding: "utf8" });
  assert.equal(ignored.trim().split("\n").length, 2);
});

test("AC-CH-05.4 with an open High finding the done gate fails and the release cut is refused until fixed or overridden", () => {
  const { root, syno } = project();
  syno("security", "scan", "--confirm");
  syno("change", "Marks page", "--type", "Added", "--confirm");
  const refused = syno("release", "cut", "--confirm");
  assert.equal(refused.status, 1);
  assert.match(refused.stdout, /High security finding still open: The route GET \/api\/marks has no server-side permission check/);
  const items = JSON.parse(syno("sigma", "gate", "--release", "--json").stdout).items.map((i) => i.id);
  const ov = JSON.parse(syno("sigma", "override", "--gate", "release", "--items", items.join(","), "--reason", "Marks API is behind the campus VPN until 2.0", "--confirm", "--json").stdout).override;
  assert.equal(syno("release", "cut", "--confirm").status, 0);
  const release = JSON.parse(readFileSync(join(root, ".syno/releases", readdirSync(join(root, ".syno/releases"))[0]), "utf8"));
  assert.deepEqual(release.overrides, [ov.id]);
});

test("S-16 abuse cases get ids, merge by id, and a Failing case blocks the gate", () => {
  const { root, syno, put } = project();
  syno("security", "design", "--file", put("a.json", { cases: [{ role: "Student", rule: "see another student's marks", why: "Marks are private", control: "Server checks the student id" }, { role: "Everyone", rule: "get a secret key in the browser", why: "Keys in the browser are public", control: "Keys stay on the server" }] }), "--confirm");
  syno("security", "design", "--file", put("b.json", { cases: [{ id: "SEC-0001", role: "Student", rule: "see another student's marks", why: "Marks are private", control: "Server checks the student id", status: "Failing" }] }), "--confirm");
  const cases = JSON.parse(readFileSync(join(root, ".syno/security/abuse-cases.json"), "utf8")).cases;
  assert.deepEqual(cases.map((c) => [c.id, c.status]), [["SEC-0001", "Failing"], ["SEC-0002", "Planned"]]);
  assert.match(syno("sigma", "gate", "--release").stdout, /Abuse case SEC-0001 is failing: Student must never see another student's marks/);
});

test("S-16 secrets: patterns, entropy, and placeholders that aren't secrets", () => {
  assert.equal(secretsIn('const k = "AKIAIOSFODNN7EXAMPLE";')[0].name, "AWS access key");
  assert.equal(secretsIn('password = "Xk9#mQ2$vL7pR4wZ"')[0].severity, "High");
  assert.deepEqual(secretsIn('password = "your-password-here"'), []);
  const web = secretsIn('NEXT_PUBLIC_FIREBASE_API_KEY="AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q"');
  assert.deepEqual([web[0].name, web[0].severity], ["Public Google API key", "Low"], "a browser key is public by design");
  assert.equal(secretsIn('GOOGLE_API_KEY="AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q"')[0].severity, "High");
  assert.deepEqual(secretsIn('apiKey: "${process.env.API_KEY}"'), []);
  assert.ok(entropy("aaaaaaaa") < 1 && entropy("Xk9#mQ2$vL7pR4wZ") > 3.5);
});

test("S-16 the dependency scan reads npm audit's JSON; the report reads plainly", () => {
  const npm = JSON.stringify({ vulnerabilities: { lodash: { severity: "high", via: [{ title: "Prototype pollution" }], fixAvailable: true }, minimist: { severity: "moderate", via: ["lodash"], fixAvailable: false } } });
  assert.deepEqual(parseAudit("npm", npm).map((f) => [f.title, f.severity]), [["lodash: Prototype pollution", "High"], ["minimist: known vulnerability", "Medium"]]);
  const report = securityReport({ date: "2026-10-30", cases: [{ id: "SEC-0001", role: "Student", rule: "see another student's marks", control: "Server check", status: "Tested" }], records: [{ kind: "deps", date: "2026-10-30", findings: parseAudit("npm", npm).map((f, i) => ({ ...f, id: `DEPS-00${i + 1}`, status: "open" })) }] }, { project: "School" });
  assert.equal(report.verdict.level, "red");
  assert.deepEqual(renderReport(report, { css: "", version: "0.1.0" }).problems, []);
});
