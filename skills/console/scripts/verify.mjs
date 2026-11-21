// Syno Console's check before a merge (PRD S-17, design 5.7 step 3). It reads
// git only, after Claude has fetched the child's branch, and answers Green,
// Amber or Red with reasons: is the fetched head the reported one, does the
// child hold its parent's latest work, are the changes inside its lane, and
// did it leave the Console's records and other parts of the tree alone.
import { gitRead, isAncestor, tryGitRead } from "./gitread.mjs";
import { matchGlob } from "./model.mjs";

const PROTECTED = /^\.syno\/console\/(decisions|rules|questions|numbers)\//;
const COPY = ".claude/skills/syno-console/";

function parse(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

/** True when a settings file runs the Syno Console guard before tools. */
const hasGuard = (settings) =>
  (settings?.hooks?.PreToolUse ?? []).some((e) => (e?.hooks ?? []).some((h) => /syno-console\/scripts\/console\.mjs"?\s+guard$/.test(String(h?.command ?? ""))));

/** Red reasons for a child that would switch the guard off or change the Console's own settings. */
function guardChanges(files, root, parentHead, childHead) {
  const red = [];
  const at = (rev, path) => parse(tryGitRead(["show", `${rev}:${path}`], { cwd: root }));
  const copy = files.filter((f) => f.startsWith(COPY));
  if (copy.length) red.push(`Changes the Syno Console guard's own files: ${copy.join(", ")}.`);
  if (files.includes(".claude/settings.json") && hasGuard(at(parentHead, ".claude/settings.json")) && !hasGuard(at(childHead, ".claude/settings.json"))) {
    red.push("Removes the Syno Console guard hook from .claude/settings.json.");
  }
  if (files.includes(".syno/config.json") && JSON.stringify(at(parentHead, ".syno/config.json")?.console ?? null) !== JSON.stringify(at(childHead, ".syno/config.json")?.console ?? null)) {
    red.push("Changes the console group of .syno/config.json, which only the Console sets.");
  }
  return red;
}
const RECORD = /^\.syno\/console\/(nodes|reports)\/(.+)\.(json|md)$/;

/** Every path named in `git diff --name-status` output (both sides of a rename). */
export const parseNameStatus = (text) =>
  [...new Set(String(text ?? "").split("\n").filter(Boolean).flatMap((line) => line.split("\t").slice(1)))].sort();

function check(files, { childId, lane, shared }) {
  const red = [];
  const amber = [];
  const prot = files.filter((f) => PROTECTED.test(f));
  if (prot.length) red.push(`Changes records only the Console writes: ${prot.join(", ")}.`);
  const foreign = files.filter((f) => {
    const m = RECORD.exec(f);
    return m && !m[2].startsWith(`${childId}.`);
  });
  if (foreign.length) red.push(`Changes records outside ${childId}'s own part of the tree: ${foreign.join(", ")}.`);
  if (lane.length) {
    const out = files.filter((f) => !f.startsWith(".syno/console/") && !lane.some((g) => matchGlob(f, g)) && !shared.some((g) => matchGlob(f, g)));
    if (out.length) amber.push(`Outside the lane: ${out.join(", ")}.`);
  }
  return { red, amber };
}

/**
 * Checks a child's fetched branch against this branch (`parentRef`, default HEAD).
 * Returns { verdict: "green"|"amber"|"red", reasons, files, alreadyMerged, childHead }. Never writes.
 */
export function verifyChild(root, { childId, childBranch, childRef, parentRef = "HEAD", reportedHead, lane = [], shared = [] }) {
  const ref = childRef ?? `origin/${childBranch}`;
  const opts = { cwd: root };
  const childHead = tryGitRead(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], opts);
  if (!childHead) {
    return { verdict: "red", reasons: [`${ref} isn't here. Run git fetch origin ${childBranch} first, then verify again.`], files: [], alreadyMerged: false, childHead: null };
  }
  const parentHead = gitRead(["rev-parse", "--verify", `${parentRef}^{commit}`], opts);
  const amber = [];
  if (reportedHead && !childHead.startsWith(String(reportedHead).toLowerCase())) {
    amber.push(`The branch head (${childHead.slice(0, 7)}) differs from the report (${reportedHead}). Ask the child whether it pushed after reporting.`);
  }
  if (isAncestor(childHead, parentHead, opts)) {
    return { verdict: amber.length ? "amber" : "green", reasons: [`Already merged: ${childBranch} has nothing new.`, ...amber], files: [], alreadyMerged: true, childHead };
  }
  if (!tryGitRead(["merge-base", parentHead, childHead], opts)) {
    return { verdict: "red", reasons: [`${childBranch} has no history in common with this branch: it was rewritten or started from elsewhere. Ask the child to start again from this branch and redo its work.`, ...amber], files: [], alreadyMerged: false, childHead };
  }
  if (!isAncestor(parentHead, childHead, opts)) {
    amber.push(`Needs sync: ${childBranch} doesn't hold this branch's latest commit yet. Ask the child to merge its parent's branch first (R-0009), or merge and resolve here.`);
  }
  const files = parseNameStatus(gitRead(["diff", "--name-status", `${parentHead}...${childHead}`], opts));
  const found = check(files, { childId, lane, shared });
  found.red.push(...guardChanges(files, root, parentHead, childHead));
  amber.push(...found.amber);
  const verdict = found.red.length ? "red" : amber.length ? "amber" : "green";
  return { verdict, reasons: [...found.red, ...amber], files, alreadyMerged: false, childHead };
}
