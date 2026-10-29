// Saving a report (PRD §5.3). Every function's report is written twice under
// .syno/reports/<function>/ — once dated, once as latest — as a styled HTML
// page and a Markdown copy. .syno/reports/ is git-ignored, so reports stay on
// this machine. Saving is a write, so it goes through the caller's plan.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readText } from "./fsutil.js";
import { STYLES_PATH, renderReport } from "./report/render.js";

let version = null;
export function pluginVersion() {
  version ??= JSON.parse(readFileSync(fileURLToPath(new URL("../../.claude-plugin/plugin.json", import.meta.url)), "utf8")).version;
  return version;
}

/** Renders `report` and adds its four files to `plan`. Returns { html, markdown, problems, paths }. */
export function planReport(plan, fn, report) {
  const out = renderReport(report, { css: readText(STYLES_PATH, ""), version: pluginVersion() });
  const dir = `.syno/reports/${fn}`;
  const paths = [];
  for (const name of [report.date, "latest"]) {
    plan.write(`${dir}/${name}.html`, out.html);
    plan.write(`${dir}/${name}.md`, out.markdown);
    paths.push(`${dir}/${name}.html`, `${dir}/${name}.md`);
  }
  return { ...out, paths };
}
