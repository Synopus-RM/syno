// 5S Sustain (PRD S-14 rule 6): a score from 0 to 100 for each S, saved in
// .syno/5s/<YYYY-MM-DD>.json (committed) so the trend survives across
// machines, and the shared-look report. A score is null when that S hasn't
// been set up or run yet; the overall score averages the rest.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { readJson } from "../fsutil.js";

export const DIR = ".syno/5s";
const STALE_DAYS = 7;
const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));
const daysBetween = (a, b) => Math.floor((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86_400_000);

export function history(root) {
  let names = [];
  try {
    names = readdirSync(join(root, DIR)).filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort();
  } catch {}
  return names.map((n) => readJson(join(root, DIR, n))).filter(Boolean);
}

/** Days since the last 5S check, or null when there has never been one. */
export function daysSinceLast(root, today) {
  const last = history(root).at(-1);
  return last ? daysBetween(last.date, today) : null;
}

/**
 * The five scores. Sort loses 10 a ticked finding and 2 a probably-unused file;
 * Set in Order is the share of files where the standards say; Shine loses 5 an
 * error and counts only if run in the last 7 days; Standardize is the share of
 * checks that pass; Sustain is how many of the last 4 weeks had a 5S check.
 */
export function scores({ sort, moves, filesInRules, shine, standards, past, date }) {
  const sortScore = clamp(100 - 10 * sort.filter((f) => f.pick).length - 2 * sort.filter((f) => f.kind === "unused").length);
  const set = standards ? (filesInRules ? clamp(100 * (1 - moves / filesInRules)) : 100) : null;
  const fresh = shine && daysBetween(shine.date, date) <= STALE_DAYS;
  const shineScore = fresh ? clamp(100 - 5 * shine.results.reduce((n, r) => n + r.errors, 0)) : null;
  const std = standards ? clamp(100 * (1 - (standards.issues / Math.max(1, standards.checked)) * 10)) : null;
  const weeks = new Set([...past.map((p) => p.date), date].filter((d) => daysBetween(d, date) < 28).map((d) => Math.floor(daysBetween(d, date) / 7)));
  const sustain = clamp((weeks.size / 4) * 100);
  const all = { sort: sortScore, set, shine: shineScore, standardize: std, sustain };
  const known = Object.values(all).filter((v) => v !== null);
  return { ...all, overall: clamp(known.reduce((a, b) => a + b, 0) / known.length) };
}

const NAMES = { sort: "Sort", set: "Set in Order", shine: "Shine", standardize: "Standardize", sustain: "Sustain" };
const NOT_YET = { set: "No standards yet, so there is nothing to check the layout against.", shine: "Not run in the last 7 days.", standardize: "No standards file yet." };

/** The shared-look report for one 5S check. */
export function fivesReport(rec, { project, past }) {
  const s = rec.scores;
  const level = s.overall >= 80 ? "green" : s.overall >= 50 ? "amber" : "red";
  const weakest = Object.keys(NAMES).filter((k) => s[k] !== null).sort((a, b) => s[a] - s[b])[0];
  const summary = [
    `The project scores ${s.overall} out of 100 across the five steps of 5S.`,
    `Sort found ${rec.counts.sort} thing(s) that may not be needed.`,
    rec.counts.moves !== null ? `${rec.counts.moves} file(s) are not where the standards say.` : "There are no standards yet, so layout and naming aren't checked.",
    s.shine !== null ? `Shine found ${rec.counts.shine} error(s) from the project's own checks.` : "Shine hasn't been run this week.",
    `The weakest step is ${NAMES[weakest]} (${s[weakest]}).`,
  ];
  const trend = [...past, rec].slice(-8);
  return {
    title: "5S: a tidy project",
    project,
    date: rec.date,
    eyebrow: "Syno 5S",
    verdict: { level, text: level === "green" ? `The project is in good order (${s.overall} out of 100).` : level === "amber" ? `The project is mostly in order (${s.overall} out of 100). ${NAMES[weakest]} needs attention.` : `The project needs tidying (${s.overall} out of 100). Start with ${NAMES[weakest]}.` },
    summary,
    actions: rec.next.map((text) => ({ text, who: "Team" })),
    sections: [
      { heading: "Score for each step", bars: Object.keys(NAMES).map((k) => ({ label: NAMES[k], value: s[k] ?? 0, display: s[k] === null ? "Not yet" : String(s[k]), tone: s[k] === null ? undefined : s[k] >= 80 ? "good" : s[k] >= 50 ? "warn" : "bad", note: s[k] === null ? NOT_YET[k] : undefined })) },
      trend.length > 1 && { heading: "Trend", table: { columns: [{ label: "Date" }, { label: "Overall", num: true }, ...Object.values(NAMES).map((label) => ({ label, num: true }))], rows: trend.map((r) => [r.date, String(r.scores.overall), ...Object.keys(NAMES).map((k) => (r.scores[k] === null ? "–" : String(r.scores[k])))]) } },
      rec.details.length && { heading: "What was found", list: rec.details },
    ].filter(Boolean),
    glossary: [
      { term: "5S", meaning: "Five steps that keep a workplace tidy: Sort, Set in Order, Shine, Standardize and Sustain." },
      { term: "Trash", meaning: "Where 5S puts files it moves. Nothing in it is deleted, and restore puts files back." },
      { term: "Lint", meaning: "An automatic check that reads the code and points out mistakes and untidy spots." },
      { term: "Standards", meaning: "The project's own rules for names, places and file sizes, in .syno/5s/standards.json." },
    ],
  };
}

export const fivesPulse = (rec) => ({ ...rec.scores });
