// Syno Console's model (PRD S-17): config defaults, IDs, session names and
// branches, lanes, spawn limits and the standing rules. Pure: no file system,
// process or clock, so the plugin and the cloud copy share it unchanged.

export const LEVELS = ["console", "phase", "milestone", "task"];
const errorWith = (exit) => (message) => Object.assign(new Error(message), { exit });
/** A malformed request (exit 2). */
export const usage = errorWith(2);
/** Understood but not allowed (exit 3). */
export const refusal = errorWith(3);

const defaults = () => ({
  askAt: "console",
  rolling: true,
  autoMode: true,
  label: null,
  project: null,
  syno: { branch: null },
  names: { console: "Syno Console", phase: "Ph{P} · Phase {P}", milestone: "Ph{P}·{M}", task: "Ph{P}·{M}·{T}" },
  branches: { phase: "claude/syno-phase-{p}", milestone: "claude/syno-ph{p}-{m}", task: "claude/syno-ph{p}-{m}-{t}" },
  limits: { maxTasks: 3, maxMilestones: 2 },
  sharedFiles: [],
  mergeRecipe: null,
  rulebook: "docs/syno/sessions.md",
  register: "docs/syno/decisions.md",
  checks: { task: [], milestone: [], phase: [], console: [] },
  numbers: [],
});

const isPlain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
function deepFreeze(v) {
  if (isPlain(v) || Array.isArray(v)) {
    Object.values(v).forEach(deepFreeze);
    Object.freeze(v);
  }
  return v;
}

export const DEFAULTS = deepFreeze(defaults());

function merge(base, extra) {
  for (const [key, value] of Object.entries(extra)) base[key] = isPlain(value) && isPlain(base[key]) ? merge(base[key], value) : value;
  return base;
}

/** The `console` config group with every default filled in. Objects merge; arrays and scalars replace. */
export const withDefaults = (raw) => merge(defaults(), isPlain(raw) ? structuredClone(raw) : {});

const SEGMENT = { phase: /^[A-Z][A-Z0-9]{0,5}$/, milestone: /^M[A-Z0-9]{1,8}$/, task: /^T[A-Z0-9]{1,8}$/ };
const DEPTH = ["phase", "milestone", "task"];

/** Parses `A`, `A.M1` or `A.M1.T1` (any case) or `console`; null when it isn't a Syno Console ID. */
export function parseId(text) {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (trimmed.toLowerCase() === "console") return { id: "console", level: "console", segments: {}, parentId: null };
  const parts = trimmed.toUpperCase().split(".");
  if (!trimmed || parts.length > 3 || parts.some((p, i) => !SEGMENT[DEPTH[i]].test(p))) return null;
  return {
    id: parts.join("."),
    level: DEPTH[parts.length - 1],
    segments: { P: parts[0], M: parts[1], T: parts[2] },
    parentId: parts.length === 1 ? "console" : parts.slice(0, -1).join("."),
  };
}

/** The level a session of `level` may create, or null for a task. */
export const childLevel = (level) => LEVELS[LEVELS.indexOf(level) + 1] ?? null;

const fillTemplate = (template, seg) =>
  String(template).replace(/\{([PMTpmt])\}/g, (_, k) => {
    const value = seg[k.toUpperCase()] ?? "";
    return k === k.toLowerCase() ? value.toLowerCase() : value;
  });

function branchOf(parsed, cfg) {
  if (parsed.level === "console") return cfg.syno?.branch ?? null;
  return fillTemplate(cfg.branches[parsed.level], parsed.segments);
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const GROUP = { p: "([a-z][a-z0-9]{0,5})", m: "(m[a-z0-9]{1,8})", t: "(t[a-z0-9]{1,8})", P: "([A-Z][A-Z0-9]{0,5})", M: "(M[A-Z0-9]{1,8})", T: "(T[A-Z0-9]{1,8})" };

function templateRegex(template) {
  const keys = [];
  const source = String(template)
    .split(/(\{[PMTpmt]\})/)
    .map((part) => {
      const m = /^\{([PMTpmt])\}$/.exec(part);
      if (!m) return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      keys.push(m[1].toUpperCase());
      return GROUP[m[1]];
    })
    .join("");
  return { re: new RegExp(`^${source}$`), keys };
}

/** Every ID a branch name could stand for, most specific first. */
export function idsFromBranch(branch, cfg) {
  const found = [];
  for (const level of ["task", "milestone", "phase"]) {
    const { re, keys } = templateRegex(cfg.branches[level]);
    const m = re.exec(String(branch ?? ""));
    if (!m) continue;
    const seg = {};
    keys.forEach((k, i) => (seg[k] = m[i + 1].toUpperCase()));
    const parsed = parseId([seg.P, seg.M, seg.T].slice(0, DEPTH.indexOf(level) + 1).join("."));
    if (parsed?.level === level && !found.includes(parsed.id)) found.push(parsed.id);
  }
  if (cfg.syno?.branch && branch === cfg.syno.branch) found.push("console");
  return found;
}

/** The ID a branch belongs to (task, then milestone, then phase, then the Console), or null. */
export const idFromBranch = (branch, cfg) => idsFromBranch(branch, cfg)[0] ?? null;

/** True when the ID's branch name can only be read back as that ID. */
export function branchIsUnambiguous(id, cfg) {
  const parsed = parseId(id);
  if (!parsed) return false;
  const ids = idsFromBranch(branchOf(parsed, cfg), cfg);
  return ids.length === 1 && ids[0] === parsed.id;
}

/** Title, branch, parent and tags for one session of the tree (design 5.1). */
export function namesFor(id, name, cfg) {
  const parsed = parseId(id);
  if (!parsed) throw usage(`"${id}" isn't a Syno Console ID. Use a phase like A, a milestone like A.M1 or a task like A.M1.T1.`);
  const clean = String(name ?? "").trim();
  if (clean.length > 48) throw usage(`Session names are 48 characters at most; "${clean}" has ${clean.length}.`);
  const branch = branchOf(parsed, cfg);
  if (parsed.level !== "console" && !branchIsUnambiguous(parsed.id, cfg)) {
    throw usage(`The branch for ${parsed.id} (${branch}) is ambiguous: another ID would get the same branch. Rename the ID or change console.branches.`);
  }
  const titlePrefix = parsed.level === "console" ? `${cfg.names.console}${cfg.label ? ` · ${cfg.label}` : ""}` : fillTemplate(cfg.names[parsed.level], parsed.segments);
  const parent = parsed.parentId ? parseId(parsed.parentId) : null;
  return {
    id: parsed.id,
    level: parsed.level,
    name: clean,
    title: clean && parsed.level !== "console" ? `${titlePrefix} · ${clean}` : titlePrefix,
    titlePrefix,
    branch,
    parentId: parsed.parentId,
    parentBranch: parent ? branchOf(parent, cfg) : null,
    tags: ["syno", `syno-level:${parsed.level}`, `syno-id:${parsed.id}`, ...(cfg.project ? [`syno-project:${slug(cfg.project)}`] : [])],
  };
}

const WILD = /[*?[]/;
const hasWild = (pattern) => WILD.test(pattern);

function globToRegex(glob) {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      const slash = glob[i + 2] === "/";
      out += slash ? "(?:.*/)?" : ".*";
      i += slash ? 2 : 1;
    } else if (c === "*") out += "[^/]*";
    else if (c === "?") out += "[^/]";
    else out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`);
}

/** True when `path` matches the glob: `*` stays inside one folder, `**` crosses folders. */
export const matchGlob = (path, glob) => globToRegex(glob).test(path);

const fixedPrefix = (p) => p.slice(0, p.search(WILD));
const fixedSuffix = (p) => p.slice(Math.max(p.lastIndexOf("*"), p.lastIndexOf("?"), p.lastIndexOf("]")) + 1);

function patternsOverlap(x, y) {
  if (!hasWild(x) && !hasWild(y)) return x === y;
  if (!hasWild(x)) return matchGlob(x, y);
  if (!hasWild(y)) return matchGlob(y, x);
  const [px, py] = [fixedPrefix(x), fixedPrefix(y)];
  if (!px.startsWith(py) && !py.startsWith(px)) return false;
  if (!x.includes("**") && !y.includes("**") && x.split("/").length !== y.split("/").length) return false;
  const [sx, sy] = [fixedSuffix(x), fixedSuffix(y)];
  return sx.endsWith(sy) || sy.endsWith(sx);
}

/** Pattern pairs that two lanes share, leaving out the project's shared files. A cautious check: it may over-report. */
export function lanesOverlap(laneA, laneB, shared = []) {
  const isShared = (p) => shared.includes(p) || (!hasWild(p) && shared.some((s) => matchGlob(p, s)));
  const a = (laneA ?? []).filter((p) => !isShared(p));
  const b = (laneB ?? []).filter((p) => !isShared(p));
  const pairs = [];
  for (const x of a) for (const y of b) if (patternsOverlap(x, y)) pairs.push(`${x} ↔ ${y}`);
  return pairs;
}

export const RUNNING = new Set(["running", "handed-off", "rework"]);

function laneReasons(childId, lane, running, cfg) {
  const reasons = [];
  if (running.length && !lane.length) reasons.push(`${childId} needs a lane (the files it may change), because other tasks are running beside it.`);
  for (const sibling of running) {
    const pairs = sibling.lane?.length ? lanesOverlap(lane, sibling.lane, cfg.sharedFiles) : ["(no lane recorded)"];
    if (lane.length && pairs.length) reasons.push(`The lane overlaps with ${sibling.id}: ${pairs.join(", ")}. Wait for it to merge, or narrow the lane.`);
  }
  return reasons;
}

/** True when `id` lies in `role`'s part of the tree, below it: its children, or deeper on a child's behalf. */
const inSubtree = (role, child) => (role.level === "console" ? child.level !== "console" : child.id.startsWith(`${role.id}.`));

/** Whether `role` may create `childId` now (design 5.2, 5.3). Read-only. */
export function checkSpawn({ role, childId, lane = [], nodes = [], cfg }) {
  if (!role) return { ok: false, reasons: ["This session has no Syno Console role yet. Run join first."] };
  const child = parseId(childId);
  const next = childLevel(role.level);
  if (!child || !next || !inSubtree(role, child)) {
    return { ok: false, reasons: [`${role.id} can create only its next level (${next ?? "none"}) under it, or deeper on a child's behalf; not ${childId}.`] };
  }
  const reasons = [];
  const direct = child.parentId === role.id || (role.level === "console" && child.level === "phase");
  const parentNode = nodes.find((n) => n.id === child.parentId);
  if (!direct && !RUNNING.has(parentNode?.status)) reasons.push(`${child.parentId} isn't running, so ${child.id} has no parent to report to.`);
  const existing = nodes.find((n) => n.id === child.id);
  if (existing && existing.status !== "planned") reasons.push(`${child.id} already exists (${existing.status}).`);
  const running = nodes.filter((n) => n.parentId === child.parentId && n.id !== child.id && RUNNING.has(n.status));
  if (child.level === "task" && running.length >= cfg.limits.maxTasks) reasons.push(`${child.parentId} already has ${running.length} tasks running; at most ${cfg.limits.maxTasks} tasks run at once.`);
  if (child.level === "milestone" && running.length >= cfg.limits.maxMilestones) reasons.push(`${child.parentId} already has ${running.length} milestones running; at most ${cfg.limits.maxMilestones} milestones run at once.`);
  if (child.level === "task") reasons.push(...laneReasons(child.id, lane, running, cfg));
  return { ok: reasons.length === 0, reasons };
}

const RULE_TEXT = [
  "Tree: Syno Console → Phase → Milestone → Task. Each level creates only its next level, from its own session, so the Claude app shows the tree.",
  "Names: session titles, IDs and branches follow this project's Syno Console naming rules.",
  "Auto mode: every session Syno creates runs in auto mode where the platform allows it, otherwise in default mode.",
  "Questions: only the level set by askAt asks the owner, always as 2 to 4 choices with the recommended one first. Every other session sends its question one level up.",
  "Decisions: only the Console records decisions. Everyone follows them, a wider scope wins, and a decision is replaced by a new one, never edited.",
  "Own branch: a session pushes only its own branch. No pushes to another branch or to main, no force-pushes and no deleted branches.",
  "Checked merges: work moves up only after the parent has verified it, merged it, run the checks, recorded it and pushed.",
  "Parallel: a milestone runs at most the configured number of tasks at once (3 by default), only with separate lanes. Shared files follow the merge recipe.",
  "Merge down: after every consolidation the parent's branch is merged down, and every child merges its parent's latest branch before it hands off.",
  "Main: only the owner merges into the default branch, from one combined draft pull request.",
  "Archive: a session is archived only after its work is proven merged up. This is the owner's standing yes for archiving.",
  "Numbers: new numbers (ADRs, versions and any other series the project names) come only from the blocks the Console hands out.",
];

/** R-0001 … R-0012, the owner's standing approvals (design 5.10). */
export const STANDING_RULES = deepFreeze(RULE_TEXT.map((text, i) => ({ id: `R-${String(i + 1).padStart(4, "0")}`, text })));
