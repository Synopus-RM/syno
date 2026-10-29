// syno doctor (PRD X-04 rule 4): finds broken records, duplicate IDs, stale
// checks and missing .gitignore lines. With --confirm it fixes the two it can
// fix safely: it adds the .gitignore lines, and renumbers duplicate idea and
// abuse-case IDs (two branches can both create IDEA-0007 or SEC-0007).
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { WritePlan, jsonText, readJson, readText } from "../fsutil.js";
import { describePlan } from "../chronicle/docs.js";
import { LOCAL_IGNORES } from "../chronicle/setup.js";
import { missingIgnores } from "./cli.js";

const mod = (rel) => pathToFileURL(fileURLToPath(new URL(`../${rel}`, import.meta.url))).href;
const IDEAS = ".syno/ideas";
const CASES = ".syno/security/abuse-cases.json";

function ideaFiles(root) {
  try {
    return readdirSync(join(root, IDEAS)).filter((n) => n.endsWith(".json")).sort();
  } catch {
    return [];
  }
}

/** Ideas that share an id: every one after the first gets the next free number. */
function duplicateIdeas(root, plan) {
  const seen = new Map();
  // The file named exactly after its id keeps it; any other copy is renumbered.
  const ideas = ideaFiles(root).map((name) => ({ name, rec: readJson(join(root, IDEAS, name)) })).filter((x) => x.rec?.id).sort((a, b) => Number(b.name === `${b.rec.id}.json`) - Number(a.name === `${a.rec.id}.json`) || (a.name < b.name ? -1 : 1));
  let top = ideas.reduce((n, x) => Math.max(n, Number(String(x.rec.id).replace(/\D/g, "")) || 0), 0);
  const out = [];
  for (const { name, rec } of ideas) {
    if (!seen.has(rec.id)) {
      seen.set(rec.id, name);
      continue;
    }
    const id = `IDEA-${String(++top).padStart(4, "0")}`;
    out.push(`${IDEAS}/${name} has the same id as ${IDEAS}/${seen.get(rec.id)} (${rec.id}); renumber it ${id}. Check any change that links to ${rec.id}.`);
    plan.write(`${IDEAS}/${id}.json`, jsonText({ ...rec, id }));
    plan.remove(`${IDEAS}/${name}`);
  }
  return out;
}

function duplicateCases(root, plan) {
  const data = readJson(join(root, CASES));
  if (!data?.cases) return [];
  let top = data.cases.reduce((n, c) => Math.max(n, Number(c.id.slice(4)) || 0), 0);
  const seen = new Set();
  const out = [];
  const cases = data.cases.map((c) => {
    if (!seen.has(c.id)) {
      seen.add(c.id);
      return c;
    }
    const id = `SEC-${String(++top).padStart(4, "0")}`;
    out.push(`Abuse case ${c.id} appears twice; renumber the second "${c.rule}" ${id}.`);
    return { ...c, id };
  });
  if (out.length) plan.write(CASES, jsonText({ ...data, cases }));
  return out;
}

async function staleChecks(ctx) {
  const out = [];
  const { isStale, latestCheck } = await import(mod("compliance/cli.js"));
  if (isStale(ctx.repo)) out.push(latestCheck(ctx.repo) ? "Compliance check out of date: the PRD changed after the last check. Run /syno:compliance prd." : "The PRD has never had a compliance check. Run /syno:compliance prd.");
  const { run } = await import(mod("chronicle/cli.js"));
  try {
    const st = await run({ ...ctx, args: ["status"], confirm: false });
    if (st.data?.stale?.length) out.push(`Chronicle's pages are out of date (${st.data.stale.length} files). Run syno render --confirm.`);
    if (st.data?.unsynced?.length) out.push(`Tags not recorded yet: ${st.data.unsynced.join(", ")}. Run /syno:sync.`);
  } catch {}
  return out;
}

async function brokenRecords(ctx) {
  try {
    const { run } = await import(mod("chronicle/cli.js"));
    return (await run({ ...ctx, args: ["validate"], confirm: false })).data?.errors ?? [];
  } catch (err) {
    return [`Chronicle's records couldn't be read: ${err.message}`];
  }
}

export async function run(ctx) {
  const plan = new WritePlan(ctx.repo);
  const broken = await brokenRecords(ctx);
  const dups = [...duplicateIdeas(ctx.repo, plan), ...duplicateCases(ctx.repo, plan)];
  const stale = await staleChecks(ctx);
  const missing = missingIgnores(ctx.repo);
  if (missing.length) {
    const text = readText(join(ctx.repo, ".gitignore"), "") ?? "";
    plan.write(".gitignore", `${text}${text && !text.endsWith("\n") ? "\n" : ""}${text ? "\n" : ""}# Syno: files that stay on this machine\n${missing.join("\n")}\n`);
  }
  const sections = [
    ["Broken records (fix by hand)", broken],
    ["Duplicate IDs (renumbered with --confirm)", dups],
    ["Out of date", stale],
    [".gitignore lines missing (added with --confirm)", missing.length ? [`${missing.length} of ${LOCAL_IGNORES.length}: ${missing.join(", ")}`] : []],
  ].filter(([, items]) => items.length);
  const applied = plan.apply({ confirm: ctx.confirm });
  const problems = sections.reduce((n, [, items]) => n + items.length, 0);
  const text = problems ? [...sections.flatMap(([h, items]) => [`${h}:`, ...items.map((i) => `  - ${i}`)]), describePlan(plan, applied.applied)].join("\n") : "Syno's records are healthy. Nothing to fix.";
  return { code: broken.length ? 1 : 0, text, data: { applied: applied.applied, broken, duplicates: dups, stale, missingIgnores: missing } };
}
