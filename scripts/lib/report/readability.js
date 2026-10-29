// Checks that a report reads easily for anyone (PRD §5.3, AC-XR.2): every
// summary sentence under 25 words, the summary at Flesch-Kincaid grade 8 or
// lower, and every technical word in the top of the report explained in the
// glossary. Pure functions: no file system, no clock.

const MAX_WORDS = 25;
const MAX_GRADE = 8;

/** Splits text into sentences on . ! ? followed by a space or the end. */
export function sentences(text) {
  return String(text)
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export const words = (text) => String(text).match(/[A-Za-z0-9][A-Za-z0-9'’-]*/g) ?? [];

/** Vowel-group syllable count with the usual silent-e rule; numbers count as one. */
export function syllables(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 1;
  if (w.length <= 3) return 1;
  const trimmed = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  return Math.max(1, (trimmed.match(/[aeiouy]{1,2}/g) ?? []).length);
}

/** Flesch-Kincaid grade level of a block of text; 0 for empty text. */
export function fkGrade(text) {
  const all = words(text);
  const count = sentences(text).length;
  if (!all.length || !count) return 0;
  const syl = all.reduce((n, w) => n + syllables(w), 0);
  return 0.39 * (all.length / count) + 11.8 * (syl / all.length) - 15.59;
}

const mentions = (text, term) => new RegExp(`(^|[^A-Za-z])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z]|$)`, "i").test(text);

/**
 * Returns a list of plain-language problems in a report's top part (verdict,
 * summary, actions). An empty list means it passes.
 */
export function checkReport(report, jargon = []) {
  const problems = [];
  const summary = report.summary ?? [];
  if (summary.length < 3 || summary.length > 5) problems.push(`Summary has ${summary.length} bullets; it needs 3 to 5.`);
  for (const line of summary) {
    for (const s of sentences(line)) {
      const n = words(s).length;
      if (n >= MAX_WORDS) problems.push(`Sentence has ${n} words (limit ${MAX_WORDS - 1}): "${s}"`);
    }
  }
  const grade = fkGrade(summary.map((l) => l.replace(/([^.!?])$/, "$1.")).join(" "));
  if (grade > MAX_GRADE) problems.push(`Summary reads at grade ${grade.toFixed(1)}; it needs ${MAX_GRADE} or lower.`);
  const top = [report.verdict?.text ?? "", ...summary, ...(report.actions ?? []).map((a) => a.text ?? a)].join(" ");
  const explained = new Set((report.glossary ?? []).map((g) => g.term.toLowerCase()));
  for (const term of jargon) {
    if (mentions(top, term) && !explained.has(term.toLowerCase())) problems.push(`"${term}" needs a glossary entry.`);
  }
  return problems;
}
