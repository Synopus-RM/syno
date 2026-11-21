# Syno Console: design

Design for a new Syno function, **S-17 Syno Console**. Date: 21 Nov 2026. Status: draft for the owner's approval (v2, after the builder check and the Akmo Books rulebook).

**In one line:** the owner talks to one session, **Syno Console**. Under it, Phase, Milestone and Task sessions grow as a visible tree in the Claude app. Work flows up one level at a time through checked merges, and decisions are made once.

## 1. Intent

The owner builds large projects with many Claude Code cloud sessions at once. On 21 Nov 2026 they set up this structure by hand for Akmo Books (ADR-0435 and `docs/syno/README.md` on that project's Syno branch). They then asked for it as a reusable Syno function for any project. Here are the owner's prompts, combined:

1. One main session, **Syno Console**, for organising, setting rules, core structural changes and final consolidation.
2. A second level of sessions, one per **phase**.
3. A third level, one per **milestone**.
4. A fourth level, one per **task**.
5. Changes moving up: Task → Milestone (then the task session is archived) → Phase → Console.
6. No leakage of changes, and no clash between sessions or phases in taking decisions.
7. **Auto mode** on by default for every session.
8. Questions asked in the question dialog, as choices with a recommendation.
9. Clear names, and a visible tree like the Claude app's sidebar: Syno Console › Phase › Milestone › Task.

The owner's answers on 21 Nov 2026, in the plugin session:

- **Home:** inside the Syno plugin, plus a cloud copy installed into each project.
- **Questions:** they climb Task → Milestone → Phase. The Phase turns each one into choices with a recommendation, and only the Console asks the owner.
- **Parallel work:** at most 3 task sessions per milestone, only when they touch separate files.

**Akmo Books does it differently today.** Its rulebook lets each phase session ask the owner its own phase's questions. The plugin supports both ways through one setting (`console.askAt`, 5.6). Akmo keeps its own setting until its Syno Console changes it.

## 2. Goals, non-goals, anti-goals

**Goals**

- G1. One tree: Console → Phase → Milestone → Task, nested in the Claude app's session list.
- G2. Questions reach the owner in one agreed place, always as 2 to 4 choices with the recommended one first, and never twice.
- G3. One decision register and one number map. No two sessions decide the same thing differently or take the same number.
- G4. Changes move up only through checked merges. Every merge is recorded with its commit. No session pushes anywhere but its own branch.
- G5. Auto mode in every session Syno creates.
- G6. It works in cloud sessions that don't have the Syno plugin, and in any project.

**Non-goals**

- It does not merge into the main branch: the owner does.
- It is not a CI system. It runs the project's own checks.
- It does not replace Syno Tasks. It reads from Syno Tasks and marks tasks done there (5.13).

**Anti-goals** (it has failed if any of these happen, even if it runs)

- The owner is asked the same question twice, or by the wrong session.
- A session is archived while its work is not yet merged.
- A child session pushes to its parent's branch, or to main.
- The sidebar shows a flat list instead of a tree.
- Session count grows unchecked and eats the plan's usage allowance.

## 3. Constraints

- **Syno's own rules** (PRD §5, §10, §12) apply:
  - The owner decides.
  - CLI writes need `--confirm`.
  - Syno code reads git and never writes it.
  - Only listed modules start processes, and none open a connection.
  - Files stay under 300 lines and functions under 60.
  - Labels live in `strings/en.json`.
  - Node 18+ standard library only.
  - Hooks fail open within 200 ms.
  - About 2,470 characters of skill-description budget are left.
- **Session tools belong to Claude, not Syno.** These are `create_session`, `send_message`, `archive_session`, `set_session_title`, `list_sessions` and `get_session`. Syno code never calls them. Syno's skill tells Claude when to call them, and the CLI prepares their exact parameters.
- **What cloud sessions can and can't do:**
  - They don't load the owner's user plugins.
  - A child can't be more permissive than its creator.
  - Session nesting is limited to 8 levels.
  - A message holds at most 64 KiB, and arrives as peer data.
  - Some sessions may lack the session tools.
- **The sidebar tree** comes from session lineage: a session appears under the session that created it.
- **A project's own rules still apply.** For example, Akmo Books' `CLAUDE.md` and its Syno rulebook stay in force.

## 4. Approaches considered

| Approach | Trade-off | Outcome |
| --- | --- | --- |
| A. Syno module + cloud copy | One master in Syno. `install` copies the skill, a small script and a guard hook into a project's `.claude/`, so cloud sessions get it. `install --check` catches a stale copy. | **Chosen by the owner** |
| B. Syno plugin only | Cleanest, but cloud sessions can't see it until Syno is in the claude.ai plugin catalog | Not chosen |
| C. One project only | Works in cloud at once, but no other project gets it | Not chosen (Akmo's hand-made version is this) |

Choices inside A:

- **Questions climb one level at a time** (owner's answer), so each level can answer from decisions already made.
- **One Syno branch** collects the phases, with one combined PR to main. This follows ADR-0435.

## 5. Design

### 5.1 Levels, IDs and names

The defaults follow the names the owner approved for Akmo Books (ADR-0435). A project can change them in `.syno/config.json` → `console.names`.

| Level | Created by | ID (records) | Session title | Branch (default template) |
| --- | --- | --- | --- | --- |
| Console | the owner | `console` | `Syno Console` | `console.syno.branch` (set at `start`) |
| Phase | the Console | `A` | `PhA · Phase A` or `PhA · Phase A · <name>` | `claude/syno-phase-{p}` → `claude/syno-phase-a` |
| Milestone | its Phase | `A.M100` | `PhA·M100 · <name>` | `claude/syno-ph{p}-{m}` → `claude/syno-pha-m100` |
| Task | its Milestone | `A.M100.T04` | `PhA·M100·T04 · <name>` | `claude/syno-ph{p}-{m}-{t}` → `claude/syno-pha-m100-t04` |

- **ID grammar:**
  - A phase segment is 1 to 6 capital letters or digits, starting with a letter.
  - A milestone segment is `M` plus 1 to 8 letters, digits or hyphens.
  - A task segment is `T` plus the same.
  - `console` is reserved.
  - Branch names use the lower-case segments.
  - A project's own ID (for example `T-M100-04`) goes in the node's `ref`.
- **Titles** start with the short ID path, so a cut-off title in the sidebar still says what it is. Names are at most 48 characters. When `console.label` is set (an owner with Consoles in several projects), the Console's title becomes `Syno Console · <label>`.
- **Tags:** `syno`, `syno-level:<level>`, `syno-id:<id>`, `syno-project:<slug>`.

### 5.2 Creating the tree

- Each level creates **only its direct children**, from its own session, so the Claude app nests them. If a session can't create or archive sessions, it sends the request to its parent. The parent creates the session one level higher in the tree, and tells it whom to report to (ADR-0435).
- **Lazy creation.** A child is created only when what it depends on is already in the parent's branch, so it starts from the parent's latest work.
- **Steps for the parent:**
  1. Push its own branch.
  2. Run `syno console spawn <id> --name … --lane …`. This read-only check validates the ID, the limits and the lanes, then prints the exact `create_session` parameters.
  3. Call `create_session`.
  4. Run `record <id> --status running --session <sid> --confirm`, commit and push.
- **create_session parameters:**

  | Parameter | Value |
  | --- | --- |
  | `title` | From 5.1 |
  | `tags` | From 5.1 |
  | `permission_mode` | `"auto"`. If the platform refuses, `"default"`, and the parent says so in its next report (ADR-0435) |
  | `source_url` | The repository URL |
  | `source_revision` | The parent's branch |
  | `outcome_branch` | The child's branch |
  | `append_system_prompt` | The role card |
  | `prompt` | The brief |

  The model is inherited and no effort level is set.
- **Limits** (`console.limits`):
  - Running tasks per milestone: at most `maxTasks` (default **3**, owner's answer), and only when their lanes don't overlap.
  - Running milestones per phase: at most `maxMilestones`, default **2** (my call).
  - Phases are opened only when the owner asks.

### 5.3 Lanes, shared files and numbers

- **A lane** is the list of file patterns a task may change (`*` and `**` globs).
- **Shared files** are listed in `console.sharedFiles`: the PRD, handover notes, registries, the lockfile and generated files. They don't count as overlap. Any task may add its own row or bullet to them. The consolidating level reconciles them at merge using the project's merge recipe (`console.mergeRecipe`, a path; Akmo's is the table in its rulebook) and regenerates generated files.
- **Overlap rule:** lanes must not overlap between running sibling tasks. Milestones and phases may overlap, because merging down after each consolidation (5.7) keeps them close.
- **Numbers.** The Console owns every number series a project names in `console.numbers` (for example ADR, schema version, privacy version). It hands them out **in blocks, in advance**, so nobody waits:
  - The record is `.syno/console/numbers/<series>.json`.
  - A milestone passes numbers on to its tasks in order, and asks its phase for spares.
  - Only the Console changes the project's number map.

### 5.4 The role card and the brief

**The role card** goes in `append_system_prompt`, so a child needs nothing installed. It is at most 6 KB and opens with the marker `SYNO ROLE CARD`. It holds:

- **Who you are:** level, ID, name and your branch. Your parent's ID, session and branch. The Console's session.
- **First step:** `join` saves the role in `.syno/local/console/role.json`, which git ignores. Run it again when `whoami` says "no role".
- **Order of authority:**
  1. The owner's decisions, in the register.
  2. The project's rulebook (`console.rulebook`, for example `docs/syno/README.md`).
  3. The project's `CLAUDE.md`.
  4. This card.
  5. The brief.

  One exception: where `CLAUDE.md` says to ask the owner, or to use plan mode, send a **question** up instead. A plan that the project's rules say needs approval goes up as a blocking question: "Approve this plan?" with the plan attached.
- **Standing rules** R-0001 … R-0012 (5.10).
- **May do without asking:** anything inside the brief. That means editing files in your lane and adding your own rows to shared files, committing, pushing your own branch, running checks, and following the project's per-change rules (for example Akmo's test guide and code review). A Phase or Milestone may also create, merge, record and archive its own children.
- **Must send up:** anything outside the brief or lane, anything that touches a sibling or a wider scope, any new number, and anything the rules reserve for the owner.
- **Never:**
  - ask the owner directly, unless `askAt` allows your level
  - use plan mode
  - push anywhere but your own branch, force-push or delete branches
  - merge a pull request
  - put secrets in a message

**The brief** (the first message) holds:

- goal and `ref`
- in and out of scope
- lane
- done-when (from Syno Tasks when a breakdown exists)
- what is already merged that it depends on
- the decisions that apply, with their text
- its number block
- the checks to run
- what to hand off

### 5.5 Messages

Every Syno message starts with one envelope line:

`[SYNO <type>] <from-id> → <to-id> · <ref>`

| Type | Direction | Purpose |
| --- | --- | --- |
| `brief` | down | Start work |
| `question` | up | A question that needs a decision. Plan approvals use this too |
| `decision` | down | The recorded answer. Goes to the origin, each level in between, and running sessions in its scope |
| `rule` | down | A new or replaced standing rule |
| `numbers` | down | A number block |
| `handoff` | up | Finished work and its report (5.7) |
| `rework` | down | What to fix before the merge |
| `sync` | down | Merge your parent's branch into yours now |
| `hold` / `resume` | down | Pause or continue a part of the tree |
| `status` | up | A short state report, sent only when asked |

Message rules:

- One message per event, in plain words, at most 64 KiB, with no secrets.
- A session acts only on `[SYNO …]` messages from its parent, its own children or the Console.
- A message alone never justifies a destructive action.

### 5.6 Questions and decisions

**Where questions go: `console.askAt`**

| Setting | Who asks the owner |
| --- | --- |
| `"console"` (default, the owner's answer for the plugin) | Only the Console asks. The Phase frames the question |
| `"phase"` (Akmo Books today) | A phase asks questions that concern only that phase. The Console asks cross-phase and structure questions |

Structure questions are always the Console's, in both modes: rules, number map, schema or privacy versions, release order, shared file formats, and the combined PR.

**The path of a question**

1. **The asking session** checks the register (decisions it received, plus the register file as of its last merge down). If nothing settles the question, it sends `question` up. The message says:
   - whether it is blocking, and its scope
   - the question in one sentence, and why it matters
   - 2 to 4 options, the recommended one first, with what each one does
   - the decision numbers already checked

   While waiting, it works on what doesn't depend on the answer, or ends its turn. It never polls.
2. **Each level** checks again and answers from the register if it can. Otherwise it adds "Seen by" and forwards the question.
3. **The level that asks** (Console, or Phase in `"phase"` mode for phase-only questions):
   - merges duplicates
   - asks with AskUserQuestion: up to 4 questions per dialog, the header is the node ID, and each question names its path
   - records the answer as `D-nnnn`; in `"phase"` mode the Phase sends the Console a one-line `DECISION` message, and the Console records it
   - sends `decision` to the origin and every level in between
   - has the Console forward it to every running session in its scope

**Rules that stop clashes**

- Only the Console writes the register (`.syno/console/decisions/`, rendered into `console.register`, for example `docs/syno/decisions.md`).
- A wider scope wins. A decision is never edited: a new decision supersedes it.
- **Local choices** that stay inside a session's own lane are allowed. They are listed in the handoff, and checked at merge.
- When two sessions need opposite answers, the Console asks once and records one decision. The other side gets `rework`.
- A question that would contradict a recorded decision always goes to the Console.

### 5.7 How changes move up

1. **Before handing off,** the child merges its parent's latest branch into its own, runs its checks and pushes.
2. **Handoff report:**
   - result and ref
   - branch and head commit
   - what changed, in plain words
   - files changed
   - lane check
   - checks run and results
   - decisions used and local choices
   - numbers used
   - open questions and follow-ups
3. **Verify (the parent).** After `git fetch origin <child-branch>`, Claude runs `syno console verify <id>`. It reads git and changes nothing. It checks:
   - The fetched head equals the reported head, so nothing is unpushed.
   - The child contains the parent's head. If not: Amber, needs sync.
   - Changed files are inside the lane or the shared files. If not: Amber, listed.
   - The register, rules, questions and number records are untouched. If not: Red.
   - No records outside the child's subtree changed. If any did: Red.
   - Whether it is already merged.

   The verdict is Green, Amber or Red with reasons.
4. **Merge** `--no-ff`, with the message `syno: merge <id> <name> into <parent-id>`. Reconcile shared files using the merge recipe, and regenerate generated files.
5. **Run the consolidation checks** (`console.checks.<level>`, for example Akmo's list in its rulebook). Never move on while a check is red.
6. **Record:** `record <id> --status merged --merge <sha> --report <file> --confirm` writes `nodes/<id>.json` and `reports/<id>.md`. Commit and push.
7. **Archive** the child with `archive_session`. The guard allows it only when the node says merged and names this parent, and `verify` has proved the child's head is in the pushed parent branch.
8. **Merge down.** Send `sync` to the running children. Each one merges and passes it on, so every branch stays close to the Syno branch.

**Rolling consolidation** (`console.rolling`, default true, as in ADR-0435):

- Each finished task goes up the whole chain as soon as it passes.
- A milestone or phase is archived after its last child is merged up and its own done-when holds.
- At the top, the Console merges each phase delivery into the Syno branch and keeps one combined PR to main as a draft. It reports to the owner, verdict first.
- Only the owner merges into main.
- With `rolling: false`, a milestone hands off only when all its tasks are merged.

### 5.8 Guards (hard checks)

These checks run in the plugin's hook dispatcher and in the cloud copy's hook. A session's role comes from `.syno/local/console/role.json`, or else from its branch name. Outside a Syno tree they do nothing, and on any error they allow the call.

| Guard | Rule |
| --- | --- |
| G-ASK | `AskUserQuestion`, `EnterPlanMode` and `ExitPlanMode` are refused below the Console. With `askAt: "phase"`, `AskUserQuestion` is allowed in Phase sessions |
| G-PUSH | `git push` only to the session's own branch. Refused: force (`-f`, `--force*`, a `+` refspec), delete, `--all`, `--mirror` and `--tags`. A push with no branch named, from another branch, is refused too |
| G-SPAWN | A Task can't create sessions. Others create only their next level, with a matching title, an ID under their own, the right `outcome_branch`, `permission_mode` "auto" or "default", and the role-card marker |
| G-ARCHIVE | `archive_session` only for a child whose node record says merged (or stopped by the owner) and names this session as its parent |
| G-MERGE-PR | `merge_pull_request` is refused at every level. The owner merges |
| G-RECORDS | Below the Console, Edit and Write are refused on the register, rules, questions and number records (cloud copy only) |

### 5.9 What the Console does

- **`start`:** after a yes:
  - names the session "Syno Console"
  - sets the Syno branch
  - writes the config group and R-0001 … R-0012
  - writes the rulebook and the register page when the project has none
- **Phases:** opened only when the owner asks, each with a brief and a number block.
- **Questions:** asked in batches of up to 4, recorded, sent down.
- **Deliveries:** verified, merged, checked, recorded, PR kept as a draft, then a plain report to the owner.
- **Core structural changes** (rule 6 of the owner's prompts): rules, rulebook, number map and project-wide config. The Console makes these itself, on the Syno branch, then sends `sync`.
- **Status:** `/syno:console status` shows the tree with a verdict line, from node records and live session states.

### 5.10 Standing rules

`start` writes these as R-0001 … R-0012. They are the owner's standing approvals, so routine steps need no question.

1. **R-0001 Tree:** each level creates only its next level, from its own session.
2. **R-0002 Names:** titles, IDs and branches follow the naming rules.
3. **R-0003 Auto mode:** for every session Syno creates, where the platform allows it.
4. **R-0004 Questions:** asked only at the `askAt` level, as choices with a recommendation. Everyone else sends questions up.
5. **R-0005 Decisions:** recorded once by the Console. A wider scope wins. A decision is replaced, never edited.
6. **R-0006 Own branch:** no pushes to other branches or main, no force-pushes and no deleted branches.
7. **R-0007 Checked merges:** verify, merge, check, record and push, in that order.
8. **R-0008 Parallel:** at most 3 tasks per milestone, with separate lanes. Shared files follow the merge recipe.
9. **R-0009 Merge down:** after every consolidation, and before every handoff.
10. **R-0010 Main:** only the owner merges, from one combined draft PR.
11. **R-0011 Archive:** only after the work is proven merged up. This is the owner's standing yes for archiving.
12. **R-0012 Numbers:** only from the Console's blocks.

### 5.11 Records

There is one JSON file per record, each with `schemaVersion` and a schema in `schemas/`. Each file has one writer.

| Path | Written by |
| --- | --- |
| `.syno/config.json` → `console` | The owner, via `start` |
| `.syno/console/nodes/<id>.json` | The node's parent |
| `.syno/console/reports/<id>.md` | The node's parent, at merge |
| `.syno/console/decisions/D-nnnn.json` | The Console |
| `.syno/console/rules/R-nnnn.json` | The Console |
| `.syno/console/questions/Q-<origin>-<nn>.json` | The Console |
| `.syno/console/numbers/<series>.json` | The Console |
| `.syno/local/console/role.json` | `join` (git-ignored) |

The `console` config group holds `askAt`, `rolling`, `names`, `branches`, `limits`, `sharedFiles`, `mergeRecipe`, `rulebook`, `register`, `checks`, `numbers`, `label` and `syno.branch`.

- **Node statuses:** planned → running → handed-off → merged → archived, plus `rework` and `stopped`. A phase in rolling mode stays "running", with a list of its deliveries (merge commits).
- **The register page** (`console.register`) is generated from the decision records, the way Chronicle's docs are.

### 5.12 CLI, command, skill, hooks and the cloud copy

- **CLI** `syno console <sub>`. The pure logic sits in `skills/console/scripts/`, so the cloud copy runs the same code.

  | Subcommand | Writes? |
  | --- | --- |
  | `start`, `record`, `decide`, `rule`, `question`, `numbers`, `join` | After a yes (`--confirm`) |
  | `names`, `card`, `brief`, `spawn`, `verify`, `tree`, `whoami` | No, read-only |
  | `guard`, `brief-hook` | No, hook modes |
  | `install [--check]` | After a yes (plugin only) |

  Every subcommand takes `--json`, and exit codes follow Syno's.
- **Command:** `/syno:console [start | phase <id> <name> | status | install]`.
- **Skill:** `skills/console/SKILL.md`, with DMAIC steps Define and Control. It has one section per level, and references for the protocol, role card, brief, handoff and naming.
- **Hooks:**
  - The dispatcher gains a `console` handler: one brief line at session start, and the guard at PreToolUse.
  - `hooks.json` gains a PreToolUse entry for the question, plan and session tools.
  - The handler stays quiet when the cloud copy's hook is present.
  - The Governor ignores tools other than Bash.
- **The cloud copy.** `install --confirm` writes:
  - `.claude/skills/syno-console/`: the skill, renamed, with a version line.
  - Two hook entries merged into `.claude/settings.json`, keeping every other key.
  - The `console` config group.
  - The `.syno/local/` ignore line.

  Running it again changes nothing, and `install --check` reports a stale or edited copy.

### 5.13 Syno Tasks, Sigma and Pulse

- When the Console merges a delivery, it marks each merged task that has a `ref` done in Syno Tasks with `syno tasks set <ref> done`, which runs the done gate. Only the Console writes `breakdown.json`. If the gate refuses, the delivery report says why.
- Rework is not a new Sigma defect type in v1. A task reopened through Syno Tasks already counts.
- No new Pulse events in v1. The Console's task updates reach Pulse as the usual `tasks.snapshot`, where Pulse is set up. Cloud sessions without a Pulse token send nothing. PRD 0.3 notes this.

## 6. Tests and acceptance

| ID | Criterion |
| --- | --- |
| AC-CN.1 | IDs, titles, branches and tags follow 5.1 and the configured templates. Invalid or reserved IDs are refused |
| AC-CN.2 | A role card has the marker, the order of authority, every standing rule, the parent and the Console, and fits in 6 KB |
| AC-CN.3 | `spawn` refuses a wrong level, a fourth running task, an overlapping lane (shared files excepted) and a third running milestone |
| AC-CN.4 | G-ASK follows `askAt`. Outside a Syno tree it allows everything |
| AC-CN.5 | G-PUSH allows only the own branch, and refuses force, delete, `--all`, `--mirror`, `--tags`, other branches and a bare push from another branch |
| AC-CN.6 | G-SPAWN and G-ARCHIVE enforce 5.8 |
| AC-CN.7 | `verify` gives Green, Amber (needs sync, outside lane, head mismatch) and Red (protected records), and spots an already-merged child |
| AC-CN.8 | Decisions, rules and number blocks are numbered without gaps or overlaps. Only the Console role writes them |
| AC-CN.9 | `install` keeps other settings keys and is idempotent. `--check` spots an edited copy |
| AC-CN.10 | The dispatcher stays quiet when the cloud copy is present, and every guard fails open |

Existing checks keep passing: the description budget, the process and network guards (with the read-only git script listed), file sizes, and `claude plugin validate`.

## 7. Rollout

1. Build only in `Synopus-RM/syno`, on a branch: PRD 0.3 section S-17, code, schemas, tests and README. This session does not touch Akmo Books. The owner decided this in Akmo's register: this session must not touch the phase sessions or their branches, and Syno Console owns Akmo's rules and numbers.
2. Hand Syno Console a short adoption note: what the plugin does, and how Akmo's current settings map to it (`askAt: "phase"`, its branch names, checks and merge recipe). Akmo's Console decides whether and when to install it, for example after the combined PR.

## 8. Left to the builder

- Wording of strings, templates and reports, within Syno's language rules.
- How `git push` is parsed, and how far the guard covers.
- Glob matching.
- The file split inside `skills/console/scripts/`.

## 9. Calls I made (for the owner to check)

- **Defaults follow ADR-0435:**
  - `claude/syno-…` branches and `PhA·M100·T04` titles
  - rolling consolidation and merging down
  - number blocks
  - archive only after the merge is proven
  - fall back to the parent when a session can't create sessions
  - auto mode, else default
- **Default `askAt` is "console"** (your answer here). Akmo keeps "phase" until its Syno Console changes it.
- **At most 2 milestones per phase run at once.**
- **Plans that need approval** go up as blocking questions.
- **Project rules** (test guides, reviews) stay with each task.
- **The Console marks tasks done in Syno Tasks.** No new Pulse events or Sigma defect types in v1.
- **Branding stays Syno's** (Synopus). There is no page footer in this function.
