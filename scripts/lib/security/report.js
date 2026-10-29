// Syno Security's report in the shared look (PRD S-16 rules 7, 9 and 10). The
// report stays on this machine, so it may show where each finding is; secrets
// are shown masked. Pulse gets counts and titles only. Pure.

const ORDER = ["Critical", "High", "Medium", "Low"];
const KIND = { scan: "Routes and secrets", deps: "Libraries", review: "Code review", attack: "Attack tests" };
const where = (f) => (f.evidence ?? []).map((e) => (e.commit ? `commit ${e.commit}` : e.line ? `${e.file}:${e.line}` : e.file)).join(", ");

function verdict(open, cases) {
  const blocking = open.filter((f) => f.severity === "Critical" || f.severity === "High").length;
  const failing = cases.filter((c) => c.status === "Failing").length;
  if (blocking || failing) return { level: "red", text: `${blocking} Critical or High finding(s) and ${failing} failing abuse case(s) block work being done or released.` };
  const untested = cases.filter((c) => c.status === "Planned").length;
  if (open.length || untested) return { level: "amber", text: `Nothing blocks, but ${open.length} smaller finding(s) are open and ${untested} abuse case(s) aren't enforced yet.` };
  return { level: "green", text: cases.length ? `No open findings, and all ${cases.length} abuse cases are enforced or tested.` : "No open findings." };
}

export function securityReport({ date, cases, records }, { project }) {
  const open = records.flatMap((r) => r.findings.filter((f) => f.status === "open"));
  const count = (s) => open.filter((f) => f.severity === s).length;
  const sorted = [...open].sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity));
  return {
    title: "Security",
    project,
    date,
    eyebrow: "Syno Security",
    notice: "This report stays on this machine. It shows where each problem is, so don't share it outside the team.",
    verdict: verdict(open, cases),
    summary: [
      `${open.length} open finding(s): ${count("Critical")} Critical, ${count("High")} High, ${count("Medium")} Medium and ${count("Low")} Low.`,
      `${cases.length} abuse case(s) say what each role must never be able to do. ${cases.filter((c) => c.status === "Tested").length} are proved by a test.`,
      records.length ? `Checks run: ${records.map((r) => `${KIND[r.kind] ?? r.kind} (${r.date})`).join(", ")}.` : "No security check has been run yet.",
    ],
    actions: sorted.filter((f) => f.severity === "Critical" || f.severity === "High").map((f) => ({ text: `${f.severity}: ${f.fix} (${f.title})`, who: "Developer" })),
    sections: [
      cases.length && { heading: "Abuse cases", intro: "What each role must never be able to do, and what stops it.", table: { columns: [{ label: "ID" }, { label: "Role" }, { label: "Must never" }, { label: "What stops it" }, { label: "Status" }], rows: cases.map((c) => [c.id, c.role, c.rule.replace(/^must never /i, ""), c.control, c.status]) } },
      sorted.length && { heading: "Open findings", table: { columns: [{ label: "Severity" }, { label: "Finding" }, { label: "Why it matters" }, { label: "Where" }, { label: "Fix" }], rows: sorted.map((f) => [f.severity, f.title, f.reason, `${where(f)}${f.evidence?.[0]?.masked ? ` (${f.evidence[0].masked})` : ""}`, f.fix]) } },
    ].filter(Boolean),
    glossary: [
      { term: "Abuse case", meaning: "Something a person in a role must never be able to do, written down so it can be enforced and tested." },
      { term: "Finding", meaning: "One security problem found in the code, its settings or its libraries." },
      { term: "Critical or High", meaning: "Serious enough to stop a task being done, or a release going out, until it is fixed or the owner overrides it with a reason." },
      { term: "Masked", meaning: "Only the first 4 characters of a secret are shown, so the report itself doesn't leak it." },
    ],
  };
}

/** What goes to Pulse as security.result: counts and titles only, never where or the secret. */
export function securityPulse({ cases, records }) {
  const open = records.flatMap((r) => r.findings.filter((f) => f.status === "open"));
  return {
    counts: Object.fromEntries(ORDER.map((s) => [s.toLowerCase(), open.filter((f) => f.severity === s).length])),
    cases: Object.fromEntries(["Planned", "Enforced", "Tested", "Failing"].map((s) => [s.toLowerCase(), cases.filter((c) => c.status === s).length])),
    blocking: open.filter((f) => f.severity === "Critical" || f.severity === "High").map((f) => ({ title: f.title })),
  };
}
