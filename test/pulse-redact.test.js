// Ported from Synopus Insider's redact.test.mjs (PRD S-02).
import assert from "node:assert/strict";
import { test } from "node:test";
import { redactEvent, redactText } from "../scripts/lib/pulse/redact.js";

// 20 credential shapes (F-06 acceptance: all must come out redacted).
// Built from fragments so the source holds no complete secret-shaped literal.
const k = (...parts) => parts.join("");
const SECRETS = [
  k("sk-ant-api03-", "Zx9QwErTyUiOp1234567890abcdEFGH"),
  k("sk-proj-", "AbCdEfGh1234567890IjKlMnOpQrSt"),
  k("AIza", "SyAi-n-FYJ2NZlX4MCZFFB1Y1UNGC4Uz6wE"),
  k("ghp_", "16C7e42F292c6912E7710c838347Ae178B4a"),
  k("github_pat_", "11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz"),
  k("xoxb-", "123456789012-1234567890123-AbCdEfGhIjKl"),
  k("AKIA", "IOSFODNN7EXAMPLE"),
  k("sk_live_", "4eC39HqLyjWDarjtT1zdp7dc"),
  k("glpat-", "xxxxXXXXxxxx1234abcd"),
  k("npm_", "abcdefghijklmnopqrstuvwxyz0123456789"),
  k("eyJhbGciOiJIUzI1NiJ9", ".", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", ".", "dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"),
  k("Bearer ", "abcDEF123456ghiJKL789012mnoPQR"),
  k("postgres://admin:", "hunter2pass", "@db.example.com:5432/app"),
  k("API_KEY", "=", "abc123def456"),
  k("DATABASE_PASSWORD", ": ", '"s3cret value"'),
  k("client_secret", "=", "q8Zr2LmX0vB7nT4k"),
  k("-----BEGIN RSA PRIVATE KEY-----\nMIIEow", "IBAAKCAQEA\n-----END RSA PRIVATE KEY-----"),
  k("f".repeat(20), "0123456789abcdef0123"),
  k("Zm9vYmFyQmF6UXV4", "MTIzNDU2Nzg5MGFiY2RlZg=="),
  k("intruder@", "example.org"),
];

test("redacts all 20 credential shapes", () => {
  for (const secret of SECRETS) {
    const out = redactText(`deploy note: ${secret} end`, { keepEmail: "dev@synopus.in" });
    assert.ok(out.includes("[redacted]"), `not redacted: ${secret.slice(0, 12)}…`);
    // The secret part only: a URL's host, or a KEY= name, may stay.
    const core = secret.includes("://")
      ? "hunter2pass"
      : secret.replace(/^[A-Za-z_ ]+[=:]\s*/, "").replace(/^Bearer /, "").replace(/-----END[\s\S]*$/, "");
    assert.ok(!out.includes(core.slice(-10)), `tail leaked for: ${secret.slice(0, 12)}…`);
  }
});

test("keeps ordinary summaries, paths and the member's own email", () => {
  const text = "feat(admin): add sign-in to src/components/admin/AdminAuthButtons.tsx for dev@synopus.in";
  assert.equal(redactText(text, { keepEmail: "dev@synopus.in" }), text);
  assert.equal(redactText("Tests: 18 passed, 0 failed in 7.98s"), "Tests: 18 passed, 0 failed in 7.98s");
});

test("caps title and detail lengths and drops empty fields", () => {
  const event = redactEvent({ id: "x", type: "milestone", title: "t".repeat(500), detail: "   " }, null);
  assert.equal(event.title.length, 120);
  assert.equal(event.detail, undefined);
  assert.ok(!("detail" in event));
});
