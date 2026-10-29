// Syno Test's commands (PRD S-07). The skill writes the guide and publishes its
// checklist page; the tester answers Pass or Fail on each step. After reading
// the answers back, `record` keeps them in .syno/local/tests/ (git-ignored),
// counts each Fail as a defect for Syno Sigma, makes the linked task's done
// gate fail until a new guide passes (AC-TE.1), saves the shared-look report
// and sends test.result to Pulse.
//   syno test record --guide <guide.json> --answers <answers.json> [--task <id>] [--confirm]
//   syno test status
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { WritePlan, jsonText, readJson, usage } from "../fsutil.js";
import { describePlan, notifyPulse, nowOf } from "../chronicle/docs.js";
import { slugify, today } from "../chronicle/records.js";
import { planReport } from "../reports.js";

export const DIR = ".syno/local/tests";
const plain = (s) => String(s ?? "").replace(/\*\*/g, "");

/** Answers come from the page's store, as ArtifactData rows ({ id, data }) or flat ({ id, status, … }). */
function answerMap(raw) {
  const rows = Array.isArray(raw) ? raw : raw?.documents ?? raw?.rows ?? [];
  return new Map(rows.map((r) => [r.id ?? r.docId, { status: r.status ?? r.data?.status, note: r.note ?? r.data?.note ?? "" }]));
}

export function testRecord(guide, answers, { date, task = null }) {
  const scenarios = (guide.scenarios ?? []).map((sc, si) => ({
    id: sc.id,
    title: sc.title,
    kind: sc.kind,
    steps: sc.steps.map((st, i) => {
      const a = answers.get(st.id);
      return { id: st.id, step: `${si + 1}.${i + 1}`, do: plain(st.do), status: a?.status === "pass" || a?.status === "fail" ? a.status : "unanswered", note: a?.note ?? "" };
    }),
  }));
  const all = scenarios.flatMap((s) => s.steps);
  const totals = { pass: all.filter((s) => s.status === "pass").length, fail: all.filter((s) => s.status === "fail").length, unanswered: all.filter((s) => s.status === "unanswered").length };
  return { schemaVersion: 1, date, title: guide.title, slug: slugify(guide.title, 32), task, scenarios, totals };
}

function records(root) {
  let names = [];
  try {
    names = readdirSync(join(root, DIR)).filter((n) => n.endsWith(".json")).sort();
  } catch {}
  return names.map((n) => readJson(join(root, DIR, n), {}));
}

/** The latest test guide recorded for a task, or null. The done gate reads this. */
export const latestTestFor = (root, task) => records(root).filter((r) => r.task === task).at(-1) ?? null;

/** Every recorded Fail, for Syno Sigma's defect count. */
export const failedSteps = (root) => records(root).flatMap((r) => r.scenarios.flatMap((s) => s.steps.filter((st) => st.status === "fail").map((st) => ({ guide: r.title, task: r.task, step: st.step }))));

export function testReport(rec, { project }) {
  const { pass, fail, unanswered } = rec.totals;
  const total = pass + fail + unanswered;
  const verdict = fail ? { level: "red", text: `${fail} of ${total} steps didn't match what the guide said.` } : unanswered ? { level: "amber", text: `${unanswered} of ${total} steps haven't been checked yet.` } : { level: "green", text: `Every step matched (${total} of ${total}).` };
  const summary = [
    `${pass} steps matched, ${fail} didn't and ${unanswered} weren't answered.`,
    ...rec.scenarios.map((s) => `${s.title}: ${s.steps.some((st) => st.status === "fail") ? "something was different" : s.steps.every((st) => st.status === "pass") ? "all matched" : "not finished"}.`),
  ].slice(0, 5);
  if (summary.length < 3) summary.push("Each step was checked by a person, on a real screen.");
  return {
    title: `Test results: ${rec.title}`,
    project,
    date: rec.date,
    eyebrow: "Syno Test",
    verdict,
    summary,
    actions: rec.scenarios.flatMap((s) => s.steps.filter((st) => st.status === "fail").map((st) => ({ text: `Fix step ${st.step}: ${st.note || "it looked different"}`, who: "Developer" }))),
    sections: rec.scenarios.map((s) => ({ heading: s.title, table: { columns: [{ label: "Step" }, { label: "What to do" }, { label: "Result" }, { label: "Note" }], rows: s.steps.map((st) => [st.step, st.do, { pass: "Matched", fail: "Different", unanswered: "Not checked" }[st.status], st.note]) } })),
    glossary: [{ term: "Step", meaning: "One action on the screen and one thing to look for." }, { term: "Matched", meaning: "The screen showed what the guide said it would." }],
  };
}

const pulseData = (rec) => ({ title: rec.title, scenarios: rec.scenarios.map((s) => ({ title: s.title, result: s.steps.some((st) => st.status === "fail") ? "fail" : s.steps.every((st) => st.status === "pass") ? "pass" : "incomplete" })), totals: rec.totals });

async function record(ctx) {
  const guide = readJson(typeof ctx.flags.guide === "string" ? ctx.flags.guide : "");
  const answers = readJson(typeof ctx.flags.answers === "string" ? ctx.flags.answers : "");
  if (!guide?.scenarios) throw usage("Pass the guide with --guide <guide.json>.");
  if (!answers) throw usage("Pass the answers read from the page with --answers <answers.json>.");
  const date = today(nowOf(ctx));
  const rec = testRecord(guide, answerMap(answers), { date, task: typeof ctx.flags.task === "string" ? ctx.flags.task : null });
  const name = `${DIR}/${date}-${rec.slug}.json`;
  const plan = new WritePlan(ctx.repo).write(name, jsonText(rec));
  const report = testReport(rec, { project: readJson(join(ctx.repo, ".syno/config.json"))?.project?.name ?? "This project" });
  const out = planReport(plan, "test", report);
  const applied = plan.apply({ confirm: ctx.confirm });
  if (applied.applied) await notifyPulse(ctx.repo, "test.result", pulseData(rec));
  return { code: 0, text: [`${report.verdict.level.toUpperCase()}: ${report.verdict.text}`, describePlan(plan, applied.applied)].join("\n"), data: { applied: applied.applied, totals: rec.totals, paths: out.paths } };
}

export async function run(ctx) {
  const [sub = "status"] = ctx.args;
  if (sub === "record") return record(ctx);
  if (sub === "status") {
    const latest = records(ctx.repo).at(-1);
    return { code: 0, text: latest ? `${latest.title}: ${latest.totals.pass} matched, ${latest.totals.fail} different, ${latest.totals.unanswered} not checked.` : "No test guide has been recorded here yet.", data: latest?.totals ?? null };
  }
  throw usage("test takes: record, status.");
}
