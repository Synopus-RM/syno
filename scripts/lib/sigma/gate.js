// Syno Sigma's gates (PRD §4.3, S-13). The done gate stops a task counting as
// done; the release gate stops a Chronicle release being cut. Each failing item
// has an id, so the owner can override exactly those items with a reason.
// Overrides live in .syno/sigma/overrides/ (committed). A release override is
// used once: the release that passes because of it lists it in `overrides`.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readJson } from "../fsutil.js";
import { loadReleases } from "../chronicle/records.js";
import { RUNS } from "./measure.js";

export const OVERRIDES = ".syno/sigma/overrides";
// The default rules (PRD §4.3). config.sigma.gates can drop any of them.
export const RULES = { done: ["acceptance", "tests", "audit", "security"], release: ["tests", "audit", "security", "compliance"] };

export function loadOverrides(root) {
  let names = [];
  try {
    names = readdirSync(join(root, OVERRIDES)).filter((n) => n.endsWith(".json")).sort();
  } catch {}
  return names.map((n) => readJson(join(root, OVERRIDES, n), {}));
}

const leavesOf = (nodes) => (nodes ?? []).flatMap((n) => (n.children?.length ? leavesOf(n.children) : [n]));

function lastRun(root, kind) {
  try {
    const lines = readFileSync(join(root, RUNS), "utf8").split("\n").filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      const r = JSON.parse(lines[i]);
      if (r.kind === kind) return r;
    }
  } catch {}
  return null;
}

async function testItems(root, task) {
  const out = [];
  const run = lastRun(root, "test");
  if (run?.ok === false) {
    const named = run.failing?.length ? `: ${run.failing.join("; ")}` : "";
    out.push({ id: "tests:last-run", text: `The last test run failed (${run.failed ?? "some"} failing${named}). Run the tests again once they are fixed.` });
  }
  const { latestTestFor } = await import("../testguide/cli.js");
  const breakdown = readJson(join(root, ".syno/tasks/breakdown.json"));
  const ids = task ? [task.id] : leavesOf(breakdown?.tree).map((t) => t.id);
  for (const id of ids) {
    const guide = latestTestFor(root, id);
    if (guide?.totals.fail) out.push({ id: `guide:${id}`, text: `Test guide "${guide.title}" had ${guide.totals.fail} step(s) that didn't match. Fix them and test again.` });
  }
  return out;
}

async function auditItems(root) {
  const { openFindings } = await import("../audit/cli.js");
  return openFindings(root, "critical").map((f) => ({ id: `audit:${f.id}`, text: `Critical audit finding still open: ${f.title}.` }));
}

/** Syno Security and Compliance add their items when they are installed (S-15, S-16). */
async function moduleItems(root, name, kind) {
  const path = fileURLToPath(new URL(`../${name}/cli.js`, import.meta.url));
  if (!existsSync(path)) return [];
  const mod = await import(pathToFileURL(path).href);
  return typeof mod.gateItems === "function" ? mod.gateItems(root, kind) : [];
}

async function items(root, kind, rules, task) {
  const out = [];
  if (rules.includes("acceptance") && task) {
    (task.acceptance ?? []).map((a) => (typeof a === "string" ? { text: a } : a)).forEach((a, i) => !a.done && out.push({ id: `acceptance:${task.id}:${i + 1}`, text: `Acceptance not met yet: ${a.text}` }));
  }
  if (rules.includes("tests")) out.push(...(await testItems(root, task)));
  if (rules.includes("audit")) out.push(...(await auditItems(root)));
  if (rules.includes("security")) out.push(...(await moduleItems(root, "security", kind)));
  if (rules.includes("compliance") && kind === "release") out.push(...(await moduleItems(root, "compliance", kind)));
  return out;
}

/** Overrides that still apply: a done override for this task, or a release override no release has used. */
function liveOverrides(root, kind, task) {
  const used = new Set(loadReleases(root).flatMap((r) => r.overrides ?? []));
  return loadOverrides(root).filter((o) => o.gate === kind && (kind === "done" ? !task || o.task === task.id : !used.has(o.id)));
}

/**
 * Runs a gate. Returns { status: "pass" | "fail", reasons, items, overridden, text }:
 * `items` are what still fails; `overridden` the ids of the overrides that let others through.
 */
export async function gate(root, config, kind, { task = null } = {}) {
  const rules = config?.sigma?.gates?.[kind] ?? RULES[kind];
  const found = await items(root, kind, rules, task);
  const overrides = liveOverrides(root, kind, task);
  const covering = (item) => overrides.find((o) => o.items.includes(item.id));
  const failing = found.filter((i) => !covering(i));
  const overridden = [...new Set(found.map(covering).filter(Boolean).map((o) => o.id))];
  const name = kind === "done" ? "done gate" : "release gate";
  const text = failing.length ? `The ${name} didn't pass (${failing.length} ${failing.length === 1 ? "problem" : "problems"}).` : overridden.length ? `The ${name} passes with ${overridden.length} recorded override(s).` : `The ${name} passes.`;
  return { status: failing.length ? "fail" : "pass", reasons: failing.map((i) => i.text), items: failing, overridden, text };
}
