// /syno:status (PRD X-04 rule 3): the one-screen view for anyone. It asks each
// function for its own status, then opens with one verdict and ends with what
// to do next (AC-XC.1). Reads only; a function that fails to answer is skipped.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { readText } from "../fsutil.js";
import { today } from "../chronicle/records.js";
import { nowOf } from "../chronicle/docs.js";
import { readerDate } from "../report/render.js";
import { LOCAL_IGNORES } from "../chronicle/setup.js";

const mod = (rel) => pathToFileURL(fileURLToPath(new URL(`../${rel}`, import.meta.url))).href;

/** One function's status, or null when it has nothing to say here. */
async function ask(ctx, rel, args = ["status"]) {
  try {
    const { run } = await import(mod(rel));
    return await run({ ...ctx, args, confirm: false });
  } catch {
    return null;
  }
}

export const missingIgnores = (root) => {
  const have = new Set((readText(join(root, ".gitignore"), "") ?? "").split(/\r?\n/).map((l) => l.trim()));
  return LOCAL_IGNORES.filter((l) => !have.has(l));
};

async function facts(ctx) {
  const root = ctx.repo;
  const has = (p) => existsSync(join(root, p));
  const { gate } = await import(mod("sigma/gate.js"));
  const { loadConfig } = await import(mod("chronicle/config.js"));
  const { measure } = await import(mod("sigma/measure.js"));
  const { history } = await import(mod("fives/score.js"));
  const { isStale, latestCheck } = await import(mod("compliance/cli.js"));
  const { sessions } = await import(mod("pause/cli.js"));
  const { latestByKind } = await import(mod("security/cli.js"));
  const config = loadConfig(root) ?? {};
  return {
    chronicle: await ask(ctx, "chronicle/cli.js"),
    tasks: has(".syno/tasks/breakdown.json") ? await ask(ctx, "tasks/cli.js") : null,
    release: await gate(root, config, "release"),
    sigma: await measure(root, { date: today(nowOf(ctx)), target: Number(config.sigma?.target ?? 4) }),
    fives: history(root).at(-1) ?? null,
    compliance: { stale: isStale(root), last: latestCheck(root), prd: has(config.compliance?.prd ?? "PRD.md") },
    security: latestByKind(root).length ? await ask(ctx, "security/cli.js") : null,
    pulse: await ask(ctx, "pulse/cli.js"),
    paused: sessions(root).filter((s) => !s.meta.resumedAt),
    ignores: missingIgnores(root),
  };
}

function lines(f, now) {
  const c = f.chronicle?.data ?? {};
  const s = f.sigma;
  const sec = f.security?.data;
  const daysSince5s = f.fives ? Math.floor((new Date(`${now}T00:00:00Z`) - new Date(`${f.fives.date}T00:00:00Z`)) / 86_400_000) : null;
  return [
    `Version: ${c.version ?? "no release yet"}; ${c.pending ?? 0} change(s) waiting for the next release.`,
    ...(f.tasks ? [`Tasks: ${f.tasks.text.split("\n")[0].replace(/^\w+: /, "")}`] : []),
    `Release gate: ${f.release.status === "pass" ? "passes" : `doesn't pass (${f.release.items.length} problem(s))`}${f.release.overridden.length ? `, with ${f.release.overridden.length} override(s)` : ""}.`,
    `Quality: ${s.opportunities ? `${s.sigma}σ against a ${s.target}σ target, ${s.defects} problem(s) in ${s.opportunities} checks` : "nothing measured yet"}.`,
    `5S: ${f.fives ? `${f.fives.scores.overall} out of 100, checked ${readerDate(f.fives.date)}` : "not checked yet"}.`,
    `Compliance: ${f.compliance.stale && f.compliance.last ? "Compliance check out of date" : f.compliance.last ? `checked ${readerDate(f.compliance.last.date)}` : f.compliance.prd ? "not checked yet" : "no PRD to check"}.`,
    `Security: ${sec ? `${sec.counts.critical + sec.counts.high} Critical or High finding(s), ${sec.cases.failing} failing abuse case(s)` : "not checked yet"}.`,
    `Pulse: ${f.pulse?.data?.enabled ? (f.pulse.data.joined ? "reporting to the panel" : "enabled, but this machine hasn't joined") : "off"}.`,
    ...(f.paused.length ? [`Paused: ${f.paused[0].meta.title} (${readerDate(f.paused[0].meta.paused.slice(0, 10))}).`] : []),
    ...(f.ignores.length ? [`Warning: Syno's local folders are not ignored by git (${f.ignores.join(", ")}).`] : []),
    ...(daysSince5s !== null && daysSince5s > 7 ? [`5S: the last check was ${daysSince5s} days ago.`] : []),
  ];
}

function next(f, now) {
  const out = [];
  if (f.release.status === "fail") out.push(...f.release.items.slice(0, 3).map((i) => i.text));
  if (f.ignores.length) out.push("Run /syno:init's last step (syno ignore) to keep Syno's local folders out of git.");
  if (f.compliance.stale || (f.compliance.prd && !f.compliance.last)) out.push("Run /syno:compliance prd.");
  if (f.paused.length) out.push("Run /syno:resume to carry on the paused session.");
  if (!f.fives || Math.floor((new Date(`${now}T00:00:00Z`) - new Date(`${f.fives.date}T00:00:00Z`)) / 86_400_000) > 7) out.push("Run /syno:5s to check the project is tidy.");
  if (f.sigma.opportunities && f.sigma.sigma < f.sigma.target) out.push("Run /syno:sigma to see where problems come from.");
  if (!f.security?.data) out.push("Run /syno:security scan.");
  return out.slice(0, 6);
}

export async function run(ctx) {
  if (!existsSync(join(ctx.repo, ".syno", "config.json"))) {
    const text = ["AMBER: Syno isn't set up in this project yet.", "", "What to do next:", "  1. Run /syno:init to start the project's record.", "  2. Then run /syno:status again."].join("\n");
    return { code: 0, text, data: { verdict: { level: "amber", text: "Syno isn't set up in this project yet." }, next: ["Run /syno:init"] } };
  }
  const now = today(nowOf(ctx));
  const f = await facts(ctx);
  const todo = next(f, now);
  const level = f.release.status === "fail" ? "red" : todo.length ? "amber" : "green";
  const verdict = { level, text: { red: "Something blocks the next release.", amber: "Nothing blocks a release, but a few things need attention.", green: "Everything is in order." }[level] };
  const text = [`${level.toUpperCase()}: ${verdict.text}`, "", ...lines(f, now).map((l) => `- ${l}`), ...(todo.length ? ["", "What to do next:", ...todo.map((t, i) => `  ${i + 1}. ${t}`)] : [])].join("\n");
  return { code: 0, text, data: { verdict, next: todo, release: f.release.status, sigma: f.sigma.sigma, fives: f.fives?.scores.overall ?? null, complianceStale: f.compliance.stale, ignoresMissing: f.ignores, paused: f.paused.length } };
}
