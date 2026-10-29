// Reads an existing CHANGELOG.md (PRD CH-02.5, §7). Keep a Changelog headings
// (`## [1.2.0] - 2024-03-01`) and loose ones (`## v1.2.0 - 2024-03-01`) become
// release entries. The region Syno will manage starts at the first version
// heading and runs to the end of the file; everything before it is never
// touched. Text inside the region that can't be parsed is kept, verbatim, as
// "Earlier history"; old link references are dropped because Syno writes its
// own compare links. Pure.

export const START = "<!-- syno:start -->";
export const END = "<!-- syno:end -->";

const SEMVER = "\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?";
const VERSION_HEADING = new RegExp(`^##\\s+\\[?v?(${SEMVER}|Unreleased)\\]?(?:\\s*[-–—]\\s*(\\d{4}-\\d{2}-\\d{2}))?(\\s*\\[YANKED\\])?\\s*$`, "i");
const LINK_REF = /^\[[^\]]+\]:\s*\S+/;
const TYPE_NAMES = {
  added: ["Added"], features: ["Added"], "new features": ["Added"],
  fixed: ["Fixed"], fixes: ["Fixed"], "bug fixes": ["Fixed"],
  changed: ["Changed"], changes: ["Changed"], improvements: ["Changed"], performance: ["Changed"],
  deprecated: ["Deprecated"], removed: ["Removed"], security: ["Security"],
  "breaking changes": ["Changed", true], breaking: ["Changed", true],
};

/** Splits text into lines, keeping each line's start offset. */
function lines(text) {
  const out = [];
  let at = 0;
  for (const line of text.split("\n")) {
    out.push({ line: line.replace(/\r$/, ""), at });
    at += line.length + 1;
  }
  return out;
}

/** Bullets under a version heading: { type, breaking, summary }[] plus any text that isn't a bullet list. */
function parseEntries(body) {
  const entries = [];
  const leftover = [];
  let type = "Changed";
  let breaking = false;
  let known = true;
  for (const { line } of lines(body)) {
    const sub = /^###\s+(.+?)\s*$/.exec(line);
    if (sub) {
      const mapped = TYPE_NAMES[sub[1].toLowerCase()];
      known = Boolean(mapped);
      [type, breaking] = mapped ? [mapped[0], Boolean(mapped[1])] : ["Changed", false];
      if (!known) leftover.push(line);
      continue;
    }
    const bullet = /^\s*[-*]\s+(.+)$/.exec(line);
    if (bullet && known) entries.push({ type, breaking: breaking || /\bBREAKING\b/.test(bullet[1]), summary: bullet[1].trim().slice(0, 200) });
    else if (/^\s{2,}\S/.test(line) && known && entries.length) entries.at(-1).summary = `${entries.at(-1).summary} ${line.trim()}`.slice(0, 200);
    else if (line.trim()) leftover.push(line);
  }
  return { entries, leftover: leftover.join("\n") };
}

/** The managed region when Syno already wrote markers, or null. */
function markerRegion(text) {
  const s = text.indexOf(START);
  const e = text.indexOf(END);
  return s >= 0 && e > s ? { start: s, end: e + END.length, inner: text.slice(s + START.length, e) } : null;
}

function parseSections(all, from, to) {
  const releases = [];
  const earlier = [];
  let unreleased = [];
  for (let i = from; i < to; i++) {
    const head = VERSION_HEADING.exec(all[i].line);
    if (!head && !/^##\s/.test(all[i].line)) continue;
    let j = i + 1;
    while (j < to && !/^##\s/.test(all[j].line)) j++;
    const body = all.slice(i + 1, j).map((l) => l.line).filter((l) => !LINK_REF.test(l)).join("\n");
    if (!head) earlier.push(all.slice(i, j).map((l) => l.line).join("\n").trimEnd());
    else {
      const { entries, leftover } = parseEntries(body);
      if (head[1].toLowerCase() === "unreleased") unreleased = entries;
      else releases.push({ version: head[1], date: head[2] ?? null, yanked: Boolean(head[3]), entries, raw: all.slice(i, j).map((l) => l.line).join("\n").trimEnd() });
      if (leftover.trim()) earlier.push(`## ${head[1]}\n\n${leftover}`.trimEnd());
    }
    i = j - 1;
  }
  return { releases, unreleased, earlier: earlier.join("\n\n") };
}

/**
 * Parses CHANGELOG text. Returns { releases, unreleased, earlier, region }:
 * region = { start, end } byte offsets of the part Syno manages (null when the
 * file has no version headings), and `hasMarkers` when Syno wrote it before.
 */
export function parseChangelog(text) {
  const marked = markerRegion(text);
  if (marked) {
    const all = lines(marked.inner);
    return { ...parseSections(all, 0, all.length), region: { start: marked.start, end: marked.end }, hasMarkers: true };
  }
  const all = lines(text);
  const first = all.findIndex(({ line }) => VERSION_HEADING.test(line));
  if (first < 0) return { releases: [], unreleased: [], earlier: "", region: null, hasMarkers: false };
  // Every section after the first version heading belongs to the history, so
  // the region runs to the end of the file; non-version sections in it are
  // kept verbatim as "Earlier history".
  const parsed = parseSections(all, first, all.length);
  return { ...parsed, region: { start: all[first].at, end: text.length }, hasMarkers: false };
}
