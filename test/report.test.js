// Chunk 1.3: the shared report look and language (PRD §5.3, X-01, AC-XR.1 to XR.3).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { STYLES_PATH, STRINGS, readerDate, renderReport } from "../scripts/lib/report/render.js";
import { checkReport, fkGrade, sentences } from "../scripts/lib/report/readability.js";

const css = readFileSync(STYLES_PATH, "utf8");
const render = (report) => renderReport(report, { css, version: "0.1.0" });

export const SAMPLE = {
  title: "Project progress",
  project: "Synopus website",
  date: "2026-10-30",
  eyebrow: "Syno Progress",
  verdict: { level: "amber", text: "On track, but 2 tasks are late." },
  summary: [
    "The site is 64% done.",
    "The home page and blog are finished.",
    "Two tasks on the contact form are late.",
    "The launch date of 20 Nov 2026 still holds.",
  ],
  actions: [{ text: "Send the final logo files", who: "Client", by: "2026-11-03" }],
  sections: [
    {
      heading: "Progress by phase",
      bars: [
        { label: "Design", value: 100, tone: "good" },
        { label: "Build", value: 58, note: "2 tasks late" },
        { label: "Launch", value: 0 },
      ],
    },
    {
      heading: "Late tasks",
      table: { columns: [{ label: "Task" }, { label: "Days late", num: true }], rows: [["Contact form | spam filter", "3"], ["Map embed", "1"]] },
    },
  ],
  glossary: [{ term: "Phase", meaning: "A stage of the project, such as Design or Build." }],
};

const order = (text, marks) => marks.map((m) => text.indexOf(m));

test("AC-XR.1 every report has Verdict, Summary, What you need to do, Detail and Glossary, in that order", () => {
  const { html, markdown } = render(SAMPLE);
  const mdAt = order(markdown, ["> **Amber:**", "## Summary", "## What you need to do", "## Detail", "## Glossary"]);
  const htmlAt = order(html, ['aria-label="Verdict"', ">Summary</h2>", ">What you need to do</h2>", ">Detail</h2>", ">Glossary</h2>"]);
  for (const at of [mdAt, htmlAt]) {
    assert.ok(at.every((i) => i >= 0), `all parts present: ${at}`);
    assert.deepEqual([...at].sort((a, b) => a - b), at);
  }
});

test("AC-XR.2 a plain summary passes; long sentences, hard words and unexplained jargon fail", () => {
  assert.deepEqual(render(SAMPLE).problems, []);
  const long = { ...SAMPLE, summary: [...SAMPLE.summary.slice(0, 3), "This sentence keeps going on and on with more and more words so that it is far longer than anyone would want to read in a summary line."] };
  assert.match(checkReport(long, STRINGS.jargon).join("\n"), /words \(limit 24\)/);
  const hard = { ...SAMPLE, summary: ["Interoperability considerations necessitate comprehensive architectural reconsideration.", "Organisational responsibilities remain undetermined.", "Implementation methodologies require standardisation."] };
  assert.match(checkReport(hard, STRINGS.jargon).join("\n"), /grade/);
  const jargon = { ...SAMPLE, verdict: { level: "red", text: "The CI check fails on every pull request." } };
  assert.match(checkReport(jargon, STRINGS.jargon).join("\n"), /"CI" needs a glossary entry/);
  assert.equal(checkReport({ ...SAMPLE, summary: ["One."] }, []).length, 1);
});

test("AC-XR.2 readability helpers behave on plain text", () => {
  assert.equal(sentences("One. Two! Three?").length, 3);
  assert.ok(fkGrade("The cat sat on the mat. It was happy.") < 3);
  assert.ok(fkGrade("Interoperability necessitates comprehensive standardisation.") > 12);
});

test("AC-XR.3 a report page loads nothing from the network", () => {
  const { html } = render(SAMPLE);
  assert.match(html, /default-src 'none'/);
  assert.doesNotMatch(html, /\ssrc=|<link|@import|url\(\s*['"]?https?:/i);
  assert.doesNotMatch(css, /@import|url\(\s*['"]?https?:/i);
});

test("X-01 two renders of the same report are byte-identical", () => {
  const a = render(SAMPLE);
  const b = render(structuredClone(SAMPLE));
  assert.equal(a.html, b.html);
  assert.equal(a.markdown, b.markdown);
});

test("X-01 user text is escaped in HTML and in Markdown tables", () => {
  const evil = { ...SAMPLE, title: "<script>alert(1)</script>" };
  const { html, markdown } = render(evil);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(markdown, /<script>/);
  assert.match(render(SAMPLE).markdown, /Contact form \\\| spam filter/);
});

test("X-01 reader dates read like 30 Oct 2026, and broken reports are refused", () => {
  assert.equal(readerDate("2026-10-30"), "30 Oct 2026");
  assert.equal(readerDate("2026-01-05"), "5 Jan 2026");
  assert.throws(() => render({ ...SAMPLE, verdict: { level: "blue", text: "x" } }), { exit: 2 });
  assert.throws(() => render({ ...SAMPLE, date: "30/10/2026" }), /date/);
});

test("X-01 an empty action list says so in plain words", () => {
  const { html, markdown } = render({ ...SAMPLE, actions: [] });
  assert.match(html, /Nothing right now\./);
  assert.match(markdown, /## What you need to do\n\nNothing right now\./);
});
