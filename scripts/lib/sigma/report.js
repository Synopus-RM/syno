// Syno Sigma's report in the shared look (PRD §5.3, S-13): the verdict against
// the target and the gates, a Pareto of defects by source and a weekly control
// chart. Pure.

const SOURCE = {
  acceptance: "Acceptance checks that failed first time",
  reopened: "Tasks reopened after done",
  "test-run": "Failed test runs",
  build: "Failed builds",
  "test-guide": "Test guide steps that didn't match",
  audit: "Critical or Major audit findings",
  security: "Critical or High security findings",
  compliance: "Critical or Major compliance gaps",
};
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const fmt = (n) => n.toLocaleString("en-IN");

function verdict(m, gates) {
  const failing = gates.filter((g) => g.status === "fail");
  if (failing.length) return { level: "red", text: `The ${failing.map((g) => g.name).join(" and ")} ${failing.length === 1 ? "gate is" : "gates are"} failing, so work can't count as finished yet.` };
  if (!m.opportunities) return { level: "amber", text: "Nothing has been checked yet, so there is nothing to measure." };
  if (m.sigma >= m.target) return { level: "green", text: `Quality is ${m.sigma}σ, at or above the ${m.target}σ target, and every gate passes.` };
  return { level: "amber", text: `Quality is ${m.sigma}σ, below the ${m.target}σ target. The gates still pass.` };
}

function summary(m) {
  const top = Object.entries(m.bySource).sort((a, b) => b[1] - a[1])[0];
  const out = [
    `${plural(m.defects, "problem was", "problems were")} found in ${fmt(m.opportunities)} checks across ${plural(m.units, m.unit)}.`,
    `That is ${fmt(m.dpmo)} problems per million checks (DPMO), which is ${m.sigma}σ.`,
    m.fpy.pct === null ? "No unit has been checked yet, so first-pass yield isn't known." : `${m.fpy.pct}% of checked ${m.unit}s passed every check the first time (${m.fpy.passed} of ${m.fpy.checked}).`,
  ];
  if (top) out.push(`Most problems came from: ${SOURCE[top[0]] ?? top[0]} (${top[1]}).`);
  const out_ = m.control.weeks.filter((w) => w.out);
  if (out_.length) out.push(`${plural(out_.length, "week was", "weeks were")} out of control: more problems than usual.`);
  return out.slice(0, 5);
}

function actions(m, gates) {
  const out = gates.filter((g) => g.status === "fail").flatMap((g) => g.reasons.map((r) => ({ text: `${g.name} gate: ${r}`, who: "Developer" })));
  if (!out.length && m.opportunities && m.sigma < m.target) {
    const top = Object.entries(m.bySource).sort((a, b) => b[1] - a[1])[0];
    if (top) out.push({ text: `Cut down ${SOURCE[top[0]]?.toLowerCase() ?? top[0]} first; it is the biggest source of problems.`, who: "Team" });
  }
  return out;
}

function sections(m, overrides) {
  const pareto = Object.entries(m.bySource).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  return [
    { heading: "Where problems come from", intro: "Biggest source first. Fixing the top one or two usually removes most problems.", bars: pareto.map(([s, n]) => ({ label: SOURCE[s] ?? s, value: Math.round((n / m.defects) * 100), display: String(n), tone: "bad" })) },
    {
      heading: "Problems per week",
      intro: `The usual level is ${m.control.centre} problems per ${m.unit}. A week above ${m.control.ucl} is out of control and worth a look.`,
      table: { columns: [{ label: "Week of" }, { label: "Problems", num: true }, { label: `Per ${m.unit}`, num: true }, { label: "In control" }], rows: m.control.weeks.map((w) => [w.week, String(w.defects), String(w.perUnit), w.out ? "No" : "Yes"]) },
    },
    { heading: "Every problem counted", list: m.defectList.map((d) => d.title) },
    overrides.length && { heading: "Gate overrides", intro: "Each time someone let work through a failing gate, and why.", table: { columns: [{ label: "When" }, { label: "Who" }, { label: "Gate" }, { label: "Why" }], rows: overrides.map((o) => [o.at.slice(0, 10), o.who, o.gate, o.reason]) } },
    {
      heading: "The numbers",
      table: { columns: [{ label: "Measure" }, { label: "Value", num: true }], rows: [[`Units (${m.unit}s)`, String(m.units)], ["Checks (opportunities)", fmt(m.opportunities)], ["Problems (defects)", String(m.defects)], ["DPMO", fmt(m.dpmo)], ["Sigma level", `${m.sigma}σ`], ["Target", `${m.target}σ`], ["First-pass yield", m.fpy.pct === null ? "Not known yet" : `${m.fpy.pct}%`]] },
    },
  ].filter((s) => s && (s.bars ? s.bars.length : s.table ? s.table.rows.length : s.list ? s.list.length : true));
}

/** The shared-look report. `gates` are [{ name, status, reasons }]; `overrides` the recorded overrides. */
export function sigmaReport(m, { project, gates = [], overrides = [] }) {
  return {
    title: "Quality (Six Sigma)",
    project,
    date: m.date,
    eyebrow: "Syno Sigma",
    verdict: verdict(m, gates),
    summary: summary(m),
    actions: actions(m, gates),
    sections: sections(m, overrides),
    glossary: [
      { term: "Unit", meaning: `One ${m.unit} of work that gets checked.` },
      { term: "Check", meaning: "One thing a unit must pass, such as an acceptance criterion or a test run." },
      { term: "DPMO", meaning: "Problems per million checks. Lower is better." },
      { term: "Sigma level (σ)", meaning: "A quality score from 0 to 6 worked out from DPMO. Higher is better; 4σ is the target." },
      { term: "First-pass yield", meaning: "The share of units that passed every check the first time." },
      { term: "Gate", meaning: "A check that stops work counting as done, or a release going out, until it passes." },
    ],
  };
}

/** What goes to Pulse as sigma.snapshot: numbers, plus each gate's pass or fail (the panel's Sigma column turns red on a fail). */
export const sigmaPulse = (m, gates = []) => ({
  units: m.units,
  unit: m.unit,
  opportunities: m.opportunities,
  defects: m.defects,
  dpmo: m.dpmo,
  sigma: m.sigma,
  target: m.target,
  fpy: m.fpy.pct,
  bySource: m.bySource,
  ...(gates.length ? { gates: Object.fromEntries(gates.map((g) => [g.name.toLowerCase(), g.status])) } : {}),
});
