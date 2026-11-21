// Syno Console's texts (PRD S-17, design 5.4): the role card every child
// carries in its system prompt, the brief that starts its work, and the
// create_session parameters. Pure: templates come in as text.
import { MARKER } from "./guard.mjs";
import { usage } from "./model.mjs";

const JOIN_SCRIPT = ".claude/skills/syno-console/scripts/console.mjs";

/** Replaces each {{KEY}}; throws when the template needs a missing key or a key goes unused. */
export function fill(template, values) {
  const used = new Set();
  const out = String(template).replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => {
    if (!(key in values)) throw usage(`The template needs {{${key}}}, but no value was given.`);
    used.add(key);
    return String(values[key]);
  });
  const unused = Object.keys(values).filter((k) => !used.has(k));
  if (unused.length) throw usage(`The template doesn't use: ${unused.join(", ")}.`);
  return out;
}

const bullets = (items) => (items?.length ? items.map((i) => `- ${i}`).join("\n") : "- none");

function askRule(level, id, parentId, cfg) {
  if (cfg.askAt === "phase" && level === "phase") {
    return [
      "You ask the owner questions that concern only your phase, with AskUserQuestion: 2 to 4 options, your recommendation first, each question naming its path.",
      `Then send the Console one line, DECISION ${id} <date>: <question> → <answer>, and send the answer down. The Console records it.`,
      "Questions that touch another phase or the structure (rules, numbers, versions, release order, shared file formats, the combined PR) go to the Console.",
    ].join(" ");
  }
  const who = cfg.askAt === "phase" ? "Your phase asks the owner questions about the phase; the Console asks the rest." : "Only Syno Console asks the owner.";
  const relay = level === "task" ? "" : ` When a question reaches you from below, answer it from the register if you can. Otherwise add "Seen by ${id}" and forward it.`;
  const frame = level === "phase" ? " You frame it for the owner: merge duplicates, plain words, recommendation first." : "";
  return `${who} Check the register first, and never ask a decided question again. Otherwise send [SYNO question] ${id} → ${parentId} · Q-${id}-<nn> with: blocking yes or no, scope, the question in one sentence, why it matters, 2 to 4 options with your recommendation first, and the decision numbers you checked.${relay}${frame}`;
}

function duties(level, cfg) {
  if (level === "task") {
    return "Do your brief inside your lane. Commit often and push only your branch. Follow the project's own rules for each change (tests, test guides, reviews). You can't create or archive sessions: if more work is needed, send a [SYNO question] to your milestone.";
  }
  const kids = level === "phase" ? "milestones" : "tasks";
  const limit = level === "phase" ? `at most ${cfg.limits.maxMilestones} run at once` : `at most ${cfg.limits.maxTasks} run at once, only with separate lanes`;
  const up = level === "phase" ? "the Console" : "your phase";
  const pace = cfg.rolling ? `Hand each merged child up to ${up} at once (rolling); don't wait for the rest.` : `Hand off to ${up} when all your ${kids} are merged.`;
  return [
    `Plan your ${kids} and run them. Create each one yourself, so it nests under you in the app: \`console spawn <id> --name … --lane … --parent-session <your own session ID>\` (get_session with no ID shows it), then create_session with exactly the printed parameters, then \`console record <id> --status running --session <its ID> --confirm\`; ${limit}. If you can't create sessions, send the request to your parent.`,
    `When a child hands off: git fetch origin <its branch>, \`console verify <id>\`, merge --no-ff, reconcile shared files with the merge recipe, run the checks, \`console record <id> --status merged --merge <sha> --confirm\`, commit, push. Archive the child only after that, then send [SYNO sync] to your running children.`,
    pace,
  ].join("\n");
}

function joinCommand(id, parentSession, consoleSession, lane) {
  const laneFlag = lane?.length ? ` --lane "${lane.join(",")}"` : "";
  return `node "${JOIN_SCRIPT}" join --id ${id} --parent-session ${parentSession} --console-session ${consoleSession}${laneFlag} --confirm`;
}

/** The role card for one child (design 5.4). It always opens with the marker line. */
export function roleCard({ cfg, names, parent, consoleSession, lane = [], rules, template }) {
  const text = fill(template, {
    TITLE: names.title,
    LEVEL: names.level,
    ID: names.id,
    BRANCH: names.branch,
    PARENT_ID: parent.id,
    PARENT_SESSION: parent.session,
    PARENT_BRANCH: parent.branch,
    CONSOLE_SESSION: consoleSession,
    LANE: lane.length ? lane.join(", ") : "the whole repository (no lane set)",
    JOIN: joinCommand(names.id, parent.session, consoleSession, lane),
    REGISTER: cfg.register,
    RULEBOOK: cfg.rulebook,
    ASK_RULE: askRule(names.level, names.id, parent.id, cfg),
    DUTIES: duties(names.level, cfg),
    RULES: rules.map((r) => `- ${r.id} ${r.text}`).join("\n"),
  });
  if (!text.startsWith(MARKER)) throw usage(`The role-card template must start with "${MARKER}".`);
  return text;
}

/** The brief: the child's first message (design 5.4). */
export function briefText({ template, names, parentId, brief = {} }) {
  return fill(template, {
    PARENT_ID: parentId,
    ID: names.id,
    REF: brief.ref || names.id,
    TITLE: names.title,
    GOAL: brief.goal || "(not given)",
    IN_SCOPE: bullets(brief.inScope),
    OUT_SCOPE: bullets(brief.outScope),
    LANE: bullets(brief.lane),
    DONE_WHEN: bullets(brief.doneWhen),
    DEPENDS_ON: bullets(brief.dependsOn),
    DECISIONS: bullets((brief.decisions ?? []).map((d) => `${d.id}: ${d.text}`)),
    NUMBERS: bullets(brief.numbers),
    CHECKS: bullets(brief.checks),
    HANDOFF: bullets(brief.handoff ?? ["A [SYNO handoff] message to your parent, as your role card says."]),
  });
}

/** The exact create_session parameters for one child (design 5.2). */
export const spawnParams = ({ names, repoUrl, card, brief, cfg }) => ({
  title: names.title,
  tags: names.tags,
  permission_mode: cfg.autoMode ? "auto" : "default",
  source_url: repoUrl,
  source_revision: names.parentBranch,
  outcome_branch: names.branch,
  append_system_prompt: card,
  prompt: brief,
});
