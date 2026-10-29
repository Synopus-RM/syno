// Classifies a commit by its Conventional Commits prefix (PRD CH-02.2):
//   feat → Added · fix → Fixed · perf, refactor → Changed · revert → Removed
//   "!" or a BREAKING CHANGE footer → breaking · anything else → Changed
// Merge commits are skipped by the caller (git log --no-merges). Pure.

const PREFIX = /^([a-zA-Z]+)(\([^)]*\))?(!)?:\s*(.+)$/;
const TYPES = { feat: "Added", fix: "Fixed", perf: "Changed", refactor: "Changed", revert: "Removed" };
const BREAKING_FOOTER = /^BREAKING[ -]CHANGE:/m;

/** { type, breaking, summary } for one commit's subject and body. */
export function classifyCommit(subject, body = "") {
  const text = String(subject ?? "").trim();
  const m = PREFIX.exec(text);
  const breaking = Boolean(m?.[3]) || BREAKING_FOOTER.test(body ?? "");
  if (m) {
    const kind = m[1].toLowerCase();
    return { type: TYPES[kind] ?? "Changed", breaking, summary: clip(m[4]) };
  }
  if (/^Revert "/.test(text)) return { type: "Removed", breaking, summary: clip(text) };
  return { type: "Changed", breaking, summary: clip(text) };
}

/** Summaries are one line of at most 200 characters (CH-04.1). */
function clip(text) {
  const line = String(text).split(/\r?\n/)[0].trim() || "(no message)";
  return line.length > 200 ? `${line.slice(0, 197)}...` : line;
}
