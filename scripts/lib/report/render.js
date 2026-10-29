// The shared report renderer for every Syno function (PRD §5.3, X-01). One
// report object becomes a styled HTML page and a Markdown copy, in a fixed
// order: Verdict, Summary, What you need to do, Detail, Glossary. Render
// functions are pure (no file system, git or clock), so two renders of the same
// report are byte-identical. The strings table is static data loaded once.
//
// A report:
//   { title, project, date: "YYYY-MM-DD", eyebrow?, notice?,
//     verdict: { level: "green"|"amber"|"red", text },
//     summary: [3 to 5 strings],
//     actions: [{ text, who?, by?: "YYYY-MM-DD" }],
//     sections: [{ heading, intro?, text?, list?, note?,
//                  table?: { columns: [{ label, num? }], rows: [[cell, …]] },
//                  bars?: [{ label, value: 0-100, display?, tone?: "good"|"warn"|"bad", note? }] }],
//     glossary: [{ term, meaning }] }
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { usage } from "../fsutil.js";
import { toHtml } from "./html.js";
import { checkReport } from "./readability.js";

export const STRINGS = createRequire(import.meta.url)("../strings/en.json");

/** Where the Sky Glass stylesheet lives; the caller reads it and passes the text in. */
export const STYLES_PATH = fileURLToPath(new URL("./sky-glass.css", import.meta.url));

const LEVELS = new Set(["green", "amber", "red"]);

/** "2026-10-30" → "30 Oct 2026". Anything that isn't an ISO date is shown as it is. */
export function readerDate(iso, t = STRINGS) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  if (!m) return String(iso ?? "");
  return `${Number(m[3])} ${t.months.at(Number(m[2]) - 1)} ${m[1]}`;
}

/** Throws a usage error when a report is missing a part every report must have. */
export function assertReport(report) {
  const missing = [];
  if (!report?.title) missing.push("title");
  if (!report?.project) missing.push("project");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(report?.date ?? "")) missing.push("date (YYYY-MM-DD)");
  if (!LEVELS.has(report?.verdict?.level) || !report?.verdict?.text) missing.push("verdict { level, text }");
  if (!Array.isArray(report?.summary)) missing.push("summary");
  if (missing.length) throw usage(`A report needs: ${missing.join(", ")}.`);
}

// Markdown text is shown on GitHub, which renders raw HTML: escape it.
const mdText = (s) => String(s ?? "").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const mdCell = (s) => mdText(s).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

function mdTable({ columns, rows }) {
  const head = `| ${columns.map((c) => mdCell(c.label)).join(" | ")} |`;
  const rule = `| ${columns.map((c) => (c.num ? "---:" : "---")).join(" | ")} |`;
  return [head, rule, ...rows.map((r) => `| ${r.map(mdCell).join(" | ")} |`)].join("\n");
}

function mdBars(items) {
  const rows = items.map((b) => {
    const pct = Math.max(0, Math.min(100, Number(b.value) || 0));
    const filled = Math.round(pct / 10);
    const bar = `${"█".repeat(filled)}${"░".repeat(10 - filled)}`;
    return [b.label, `${bar} ${b.display ?? `${Math.round(pct)}%`}`, b.note ?? ""];
  });
  const hasNotes = rows.some((r) => r[2]);
  const columns = [{ label: "Item" }, { label: "Progress" }, ...(hasNotes ? [{ label: "Note" }] : [])];
  return mdTable({ columns, rows: rows.map((r) => (hasNotes ? r : r.slice(0, 2))) });
}

function mdSection(s) {
  const out = [`### ${mdText(s.heading)}`];
  if (s.intro) out.push(mdText(s.intro));
  if (s.text) out.push(...[].concat(s.text).map(mdText));
  if (s.bars?.length) out.push(mdBars(s.bars));
  if (s.table?.rows?.length) out.push(mdTable(s.table));
  if (s.list?.length) out.push(s.list.map((li) => `- ${mdText(li)}`).join("\n"));
  if (s.note) out.push(`*${mdText(s.note)}*`);
  return out.join("\n\n");
}

function mdActions(items, t) {
  if (!items?.length) return t.report.nothing;
  return items
    .map((a, i) => {
      const when = [a.who && `${t.report.who}: ${a.who}`, a.by && `${t.report.by}: ${readerDate(a.by, t)}`].filter(Boolean).join(" · ");
      return `${i + 1}. **${mdText(a.text)}**${when ? ` — ${mdText(when)}` : ""}`;
    })
    .join("\n");
}

export function toMarkdown(report, { t = STRINGS, version }) {
  const parts = [
    `# ${mdText(report.title)}`,
    `${mdText(report.eyebrow ?? "Syno")} · ${mdText(report.project)} · ${readerDate(report.date, t)}`,
    `> **${t.verdict[report.verdict.level]}:** ${mdText(report.verdict.text)}`,
  ];
  if (report.notice) parts.push(`*${mdText(report.notice)}*`);
  parts.push(`## ${t.report.summary}`, report.summary.map((s) => `- ${mdText(s)}`).join("\n"));
  parts.push(`## ${t.report.actions}`, mdActions(report.actions, t));
  if (report.sections?.length) parts.push(`## ${t.report.detail}`, ...report.sections.map(mdSection));
  if (report.glossary?.length) {
    parts.push(`## ${t.report.glossary}`, report.glossary.map((g) => `- **${mdText(g.term)}**: ${mdText(g.meaning)}`).join("\n"));
  }
  parts.push("---", t.report.generated.replace("{version}", version).replace("{date}", readerDate(report.date, t)));
  return `${parts.join("\n\n")}\n`;
}

/**
 * Renders one report to { html, markdown, problems }. `problems` lists any
 * plain-language rule the top of the report breaks; callers show them to Claude
 * so the wording can be fixed before the report is saved.
 */
export function renderReport(report, { css, version, t = STRINGS }) {
  assertReport(report);
  const date = (iso) => readerDate(iso, t);
  return {
    html: toHtml(report, { css, t, date, version }),
    markdown: toMarkdown(report, { t, version }),
    problems: checkReport(report, t.jargon),
  };
}
