// Syno Audit's report (PRD S-05) in Syno's shared look. It keeps the source
// template's content: the count table, the top issues, the automated checks,
// each category's findings, the remediation plan, what still needs manual
// testing, and what was fixed since the last audit. Red with any open
// Critical, Amber with any open Major, Green otherwise. Pure.
const NAMES = { WFB: "Workflow bugs", WFE: "Workflow errors", UX: "Screens and usability", LOG: "Logic errors", SYN: "Build and syntax errors" };
const CATS = Object.keys(NAMES);
const SEV = ["critical", "major", "minor"];
const LABEL = { critical: "Critical", major: "Major", minor: "Minor" };
const rank = (f) => SEV.indexOf(f.severity);
const where = (f) => (f.evidence ?? []).map((e) => (e.file ? `${e.file}${e.line ? `:${e.line}` : ""}` : e.command)).join(", ");
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function counts(findings) {
  const open = findings.filter((f) => f.status === "open");
  return Object.fromEntries(CATS.map((c) => [c, Object.fromEntries(SEV.map((s) => [s, open.filter((f) => f.category === c && f.severity === s).length]))]));
}

export function auditReport(rec, { project }) {
  const open = rec.findings.filter((f) => f.status === "open").sort((a, b) => rank(a) - rank(b));
  const fixed = rec.findings.filter((f) => f.status === "fixed");
  const by = (s) => open.filter((f) => f.severity === s).length;
  const verdict = by("critical")
    ? { level: "red", text: `${plural(by("critical"), "Critical problem")} to fix before this ships.` }
    : by("major")
      ? { level: "amber", text: `No Critical problems, but ${plural(by("major"), "Major one")} to fix.` }
      : { level: "green", text: open.length ? `Only ${plural(by("minor"), "small issue")} left.` : "No open problems found." };
  const c = counts(rec.findings);
  const sections = [
    { heading: "Problems by area", table: { columns: [{ label: "Area" }, { label: "Critical", num: true }, { label: "Major", num: true }, { label: "Minor", num: true }], rows: CATS.map((k) => [NAMES[k], String(c[k].critical), String(c[k].major), String(c[k].minor)]) } },
    open.length && { heading: "Fix these first", list: open.slice(0, 10).map((f) => `${f.id} (${LABEL[f.severity]}): ${f.title}${f.why ? `. ${f.why}` : ""}`) },
    rec.checks?.length && { heading: "Automatic checks", table: { columns: [{ label: "Check" }, { label: "Result" }, { label: "Errors", num: true }, { label: "Notes" }], rows: rec.checks.map((k) => [k.command, k.result, String(k.errors ?? 0), k.notes ?? ""]) } },
    ...CATS.map((k) => {
      const list = open.filter((f) => f.category === k);
      return { heading: NAMES[k], ...(list.length ? { table: { columns: [{ label: "ID" }, { label: "Severity" }, { label: "Problem" }, { label: "Where" }, { label: "Fix" }], rows: list.map((f) => [f.id, LABEL[f.severity], f.title, where(f), f.fix]) } } : { text: "No findings." }) };
    }),
    { heading: "Plan", list: [`Fix now: ${open.filter((f) => f.severity === "critical").map((f) => f.id).join(", ") || "nothing"}`, `Next: ${open.filter((f) => f.severity === "major").map((f) => f.id).join(", ") || "nothing"}`, `Later: ${open.filter((f) => f.severity === "minor").map((f) => f.id).join(", ") || "nothing"}`] },
    fixed.length && { heading: "Fixed since the last audit", list: fixed.map((f) => `${f.id}: ${f.title}`) },
    rec.unverified?.length && { heading: "Needs a manual check", list: rec.unverified.map((u) => (typeof u === "string" ? u : u.text)) },
    rec.coverage?.length && { heading: "What was checked", text: `${plural(rec.coverage.length, "file")} reviewed, one by one.` },
  ].filter(Boolean);
  return {
    title: "Code audit",
    project,
    date: rec.date,
    eyebrow: "Syno Audit",
    verdict,
    summary: [
      `${plural(open.length, "open problem")}: ${by("critical")} Critical, ${by("major")} Major, ${by("minor")} Minor.`,
      fixed.length ? `${plural(fixed.length, "problem")} from the last audit ${fixed.length === 1 ? "is" : "are"} now fixed.` : "This is the first audit, or nothing from the last one was fixed yet.",
      "Every problem listed was checked in the code itself.",
      by("critical") ? "Critical problems stop a task from counting as done." : "Nothing here stops work from counting as done.",
    ],
    actions: open.filter((f) => f.severity === "critical").map((f) => ({ text: `Fix ${f.id}: ${f.title}`, who: "Developer" })),
    sections,
    notice: "This audit only read the code. It changed nothing in the project.",
    glossary: [
      { term: "Critical", meaning: "Data loss, a security hole, a crash on a main task, or a build that fails." },
      { term: "Major", meaning: "A main feature is wrong or broken for some people." },
      { term: "Minor", meaning: "A small or cosmetic issue, or one with an easy way around it." },
    ],
  };
}

/** What Syno Pulse sends: counts and titles only (no paths, no evidence). */
export function auditPulse(rec) {
  const open = rec.findings.filter((f) => f.status === "open");
  return {
    counts: counts(rec.findings),
    critical: open.filter((f) => f.severity === "critical").map((f) => ({ title: f.title })),
    major: open.filter((f) => f.severity === "major").map((f) => ({ title: f.title })),
    fixed: rec.findings.filter((f) => f.status === "fixed").length,
  };
}
