#!/usr/bin/env node
// Syno Security's attack-test runner (PRD S-16 rule 6). Runs each abuse case's
// requests against the project's own app on this machine and checks the app
// refuses them. Every URL is checked against the local list before the first
// request; redirects are never followed, so a test can't be bounced off-site.
// Run only by `syno security attack --confirm`, through Syno Governor.
//   node attack.mjs <plan.json>   prints { results: [{ id, status, checks }] }
import { readFileSync } from "node:fs";
import { assertLocalPlan, isLocalUrl } from "../../../scripts/lib/security/local.js";

const TIMEOUT_MS = 10_000;

async function send(base, req) {
  const url = new URL(req.url, base).href;
  if (!isLocalUrl(url)) throw new Error(`Refused: ${url} isn't local.`);
  const res = await fetch(url, { method: req.method ?? "GET", headers: req.headers, body: req.body === undefined ? undefined : typeof req.body === "string" ? req.body : JSON.stringify(req.body), redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
  return { status: res.status, text: (await res.text()).slice(0, 20_000) };
}

/** A request passes when the app refused it the way the case expects. */
function judge(expect, got) {
  const statuses = expect?.status === undefined ? [401, 403, 404] : [].concat(expect.status);
  if (!statuses.includes(got.status)) return `got ${got.status}, expected ${statuses.join(" or ")}`;
  if (expect?.notContains && got.text.includes(expect.notContains)) return "the response showed data it must not show";
  return null;
}

async function main(file) {
  const plan = JSON.parse(readFileSync(file, "utf8"));
  assertLocalPlan(plan);
  const results = [];
  for (const c of plan.cases) {
    const checks = [];
    for (const req of c.requests) {
      try {
        const problem = judge(req.expect, await send(plan.base, req));
        checks.push({ request: `${req.method ?? "GET"} ${req.url}`, ok: !problem, problem });
      } catch (err) {
        checks.push({ request: `${req.method ?? "GET"} ${req.url}`, ok: false, problem: err.name === "TimeoutError" ? "no answer within 10 seconds" : `couldn't reach the app (${err.message})` });
      }
    }
    results.push({ id: c.id, status: checks.every((x) => x.ok) ? "Tested" : "Failing", checks });
  }
  process.stdout.write(`${JSON.stringify({ results })}\n`);
}

main(process.argv[2]).catch((err) => {
  process.stderr.write(`${err.message}\n`);
  process.exit(err.exit ?? 1);
});
