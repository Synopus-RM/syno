// The styled HTML page for a report (PRD §5.3): Sky Glass, light and dark,
// offline. A Content-Security-Policy forbids loading anything, so a report can
// never fetch a font, script or image. Pure: the caller passes the CSS text.

export const esc = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:";
const clamp = (n) => Math.max(0, Math.min(100, Number(n) || 0));

function table({ columns, rows }) {
  const head = columns.map((c) => `<th scope="col"${c.num ? ' class="num"' : ""}>${esc(c.label)}</th>`).join("");
  const body = rows
    .map((row) => `<tr>${row.map((cell, i) => `<td${columns[i]?.num ? ' class="num"' : ""}>${esc(cell)}</td>`).join("")}</tr>`)
    .join("");
  return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function bars(items) {
  const rows = items.map((b) => {
    const pct = clamp(b.value);
    const shown = b.display ?? `${Math.round(pct)}%`;
    const tone = ["good", "warn", "bad"].includes(b.tone) ? ` ${b.tone}` : "";
    const note = b.note ? `<span class="bar-note">${esc(b.note)}</span>` : "";
    return `<div class="bar-row"><span>${esc(b.label)}</span><span class="bar-track" role="img" aria-label="${esc(`${b.label}: ${shown}`)}"><span class="bar-fill${tone}" style="width:${pct}%"></span></span><span class="bar-value">${esc(shown)}</span>${note}</div>`;
  });
  return `<div class="bars">${rows.join("")}</div>`;
}

function section(s) {
  const parts = [`<h3>${esc(s.heading)}</h3>`];
  if (s.intro) parts.push(`<p class="intro">${esc(s.intro)}</p>`);
  if (s.text) parts.push(...[].concat(s.text).map((t) => `<p>${esc(t)}</p>`));
  if (s.list?.length) parts.push(`<ul>${s.list.map((li) => `<li>${esc(li)}</li>`).join("")}</ul>`);
  if (s.bars?.length) parts.push(bars(s.bars));
  if (s.table?.rows?.length) parts.push(table(s.table));
  if (s.note) parts.push(`<p class="note">${esc(s.note)}</p>`);
  return `<section class="card">${parts.join("")}</section>`;
}

function actions(items, t, date) {
  if (!items?.length) return `<p class="nothing">${esc(t.report.nothing)}</p>`;
  const li = items.map((a) => {
    const when = [a.who && `${t.report.who}: ${a.who}`, a.by && `${t.report.by}: ${date(a.by)}`].filter(Boolean).join(" · ");
    return `<li><strong>${esc(a.text)}</strong>${when ? ` <span class="when">${esc(when)}</span>` : ""}</li>`;
  });
  return `<ol>${li.join("")}</ol>`;
}

/** The whole page. `t` is the strings table, `date` formats an ISO date for readers. */
export function toHtml(report, { css, t, date, version }) {
  const level = report.verdict.level;
  const glossary = report.glossary?.length
    ? `<section class="card"><h2>${esc(t.report.glossary)}</h2><dl>${report.glossary.map((g) => `<dt>${esc(g.term)}</dt><dd>${esc(g.meaning)}</dd>`).join("")}</dl></section>`
    : "";
  const detail = (report.sections ?? []).length
    ? `<h2 class="detail-title">${esc(t.report.detail)}</h2>${report.sections.map(section).join("")}`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<title>${esc(report.title)} · ${esc(report.project)}</title>
<style>${css}</style>
</head>
<body>
<main>
${report.banner ? `<p class="note">${esc(report.banner)}</p>` : ""}
<p class="eyebrow">${esc(report.eyebrow ?? "Syno")}</p>
<h1>${esc(report.title)}</h1>
<p class="meta">${esc(report.project)} · ${esc(date(report.date))}</p>
<section class="card verdict level-${level}" aria-label="Verdict"><span class="pill">${esc(t.verdict[level])}</span><p>${esc(report.verdict.text)}</p></section>
${report.howToRead ? `<p class="intro"><strong>How to read this page.</strong> ${esc(report.howToRead)}</p>` : ""}
${report.notice ? `<p class="note">${esc(report.notice)}</p>` : ""}
<section class="card"><h2>${esc(t.report.summary)}</h2><ul>${report.summary.map((s) => `<li>${esc(s)}</li>`).join("")}</ul></section>
<section class="card actions"><h2>${esc(t.report.actions)}</h2>${actions(report.actions, t, date)}</section>
${detail}
${glossary}
<footer>${esc(report.footer ?? t.report.generated.replace("{version}", version).replace("{date}", date(report.date)))}</footer>
</main>
</body>
</html>
`;
}
