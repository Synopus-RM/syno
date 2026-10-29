// Syno Compliance's report in the shared look (PRD S-15 rule 9). Red with any
// open Critical gap, Amber with other gaps or Unclear items, Green otherwise.
// Every report says it is not legal advice. Pure.
import { PLACES } from "./catalog.js";

export const NOT_ADVICE = "This is not legal advice. Ask a qualified professional to confirm Critical items.";
const SCOPE = { idea: "the idea", prd: "the PRD", release: "this release" };

function verdict(rec) {
  const gaps = rec.items.filter((i) => i.status === "Gap");
  const critical = gaps.filter((i) => i.severity === "Critical").length;
  const unclear = rec.items.filter((i) => i.status === "Unclear").length;
  if (critical) return { level: "red", text: `${critical} Critical gap(s) must be fixed before a release.` };
  if (gaps.length || unclear) return { level: "amber", text: `No Critical gaps, but ${gaps.length} other gap(s) and ${unclear} item(s) still to confirm.` };
  return { level: "green", text: `Every one of the ${rec.items.length} requirements is met.` };
}

export function complianceReport(rec, { project }) {
  const count = (s) => rec.items.filter((i) => i.status === s).length;
  const memory = rec.items.filter((i) => i.verified === "memory").length;
  const places = rec.places.map((p) => PLACES[p] ?? p);
  const byPlace = new Map();
  for (const it of rec.items) byPlace.set(it.place ?? "IN", [...(byPlace.get(it.place ?? "IN") ?? []), it]);
  return {
    title: `Compliance check of ${SCOPE[rec.scope]}`,
    project,
    date: rec.date,
    eyebrow: "Syno Compliance",
    banner: NOT_ADVICE,
    verdict: verdict(rec),
    summary: [
      `Checked against the laws of ${places.join(", ")}.`,
      `${rec.items.length} requirements apply: ${count("Met")} met, ${count("Gap")} gaps and ${count("Unclear")} to confirm.`,
      memory ? `${memory} item(s) were checked from memory, not the law's current text, so none of them can count as met yet.` : "Each item was checked against the law's current text on an official site.",
    ],
    actions: rec.items.filter((i) => i.status === "Gap").sort((a, b) => ["Critical", "Major", "Minor"].indexOf(a.severity) - ["Critical", "Major", "Minor"].indexOf(b.severity)).map((i) => ({ text: `${i.severity}: ${i.action} (${i.law})`, who: i.severity === "Critical" ? "Owner and a legal adviser" : "Developer" })),
    sections: [...byPlace].map(([place, items]) => ({
      heading: PLACES[place] ?? place,
      table: { columns: [{ label: "Law" }, { label: "Why it applies" }, { label: "What it requires" }, { label: "Status" }, { label: "Severity" }, { label: "Feature" }], rows: items.map((i) => [`${i.law}${i.ref ? `, ${i.ref}` : ""}`, i.why, i.requires, i.note ? `${i.status} (${i.note})` : i.status, i.severity, i.feature ?? ""]) },
    })),
    glossary: [
      { term: "Requirement", meaning: "One thing a law asks this product to do." },
      { term: "Gap", meaning: "A requirement the product doesn't meet yet." },
      { term: "Unclear", meaning: "Not confirmed yet, often because it was checked from memory and not from the law's current text." },
      { term: "Critical", meaning: "A gap serious enough to stop a release until it is fixed or the owner overrides it with a reason." },
    ],
  };
}

/** What goes to Pulse as compliance.result: counts and law names only. */
export const compliancePulse = (rec) => ({ scope: rec.scope, places: rec.places, met: rec.items.filter((i) => i.status === "Met").length, gaps: rec.items.filter((i) => i.status === "Gap").length, unclear: rec.items.filter((i) => i.status === "Unclear").length, critical: rec.items.filter((i) => i.status === "Gap" && i.severity === "Critical").map((i) => ({ title: i.law })) });
