# Syno Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add S-17 Syno Console to the Syno plugin. It runs a project as a tree of cloud sessions (Console → Phase → Milestone → Task), with checked merges up, one decision register and number map, guards, and a cloud copy for projects.

**Architecture:** All logic lives in `skills/console/scripts/*.mjs`, using Node built-ins only, so `install` can copy the folder into a project's `.claude/skills/syno-console/`. The Syno CLI (`syno console …`) and the hook dispatcher wrap that code. Only `gitread.mjs` starts a process, and it runs read-only git. Claude calls the session tools (`create_session`, `send_message`, `archive_session`). The code only prepares their parameters and checks them in a PreToolUse guard.

**Tech Stack:** Node.js 18+ (standard library only), `node:test`, git ≥ 2.25, Claude Code plugin (commands, skills, hooks).

**Spec:** `docs/superpowers/specs/2026-11-21-syno-console-design.md` (approved by the owner on 21 Nov 2026).

## Global Constraints

- Node 18+ standard library only; no npm dependencies; no network modules anywhere in `skills/console/`.
- Only `skills/console/scripts/gitread.mjs` may import `child_process`, and only for read-only git. Add it to `PROCESS_ALLOWED` in `test/guards.test.js` with a reason.
- Files stay under 300 lines and functions under 60, including `skills/console/scripts/`.
- Every write needs `--confirm`. Without it, a write prints its plan and exits 0. Writes are atomic (a temp file, then a rename), stay inside the project root, and are skipped when the content is unchanged.
- Exit codes: 0 done, 1 a check failed, 2 a usage error, 3 refused. Every subcommand takes `--json`.
- Hooks fail open: on any error they exit 0 and print nothing. Each must take under 200 ms.
- The skill description is 300 to 600 characters. All descriptions together stay ≤ 12,000 (currently 9,527).
- Records: one JSON file per record, 2-space indent, LF, a trailing newline, `schemaVersion: 1`, and forward-slash paths.
- IDs: the phase is `[A-Z][A-Z0-9]{0,5}`, the milestone `M[A-Z0-9]{1,8}`, the task `T[A-Z0-9]{1,8}`. The ID path uses `.` (`A.M100.T04`) and input is upper-cased. `console` is reserved. Segments have no hyphens (a deviation from the design, so branch names parse unambiguously).
- Default names: Console `Syno Console`. Phase `Ph{P} · Phase {P}`, milestone `Ph{P}·{M}`, task `Ph{P}·{M}·{T}`, then ` · <name>` when a name is given (48 characters at most).
- Default branches: `claude/syno-phase-{p}`, `claude/syno-ph{p}-{m}` and `claude/syno-ph{p}-{m}-{t}`, all lower case.
- Tags: `syno`, `syno-level:<level>`, `syno-id:<id>`, `syno-project:<slug>`.
- Defaults: `askAt: "console"`, `rolling: true`, `limits.maxTasks: 3`, `limits.maxMilestones: 2`, `autoMode: true`, `rulebook: "docs/syno/sessions.md"`, `register: "docs/syno/decisions.md"`.
- The role-card marker is the first line, `SYNO ROLE CARD`. A card is at most 6,144 bytes.
- The message envelope is `[SYNO <type>] <from-id> → <to-id> · <ref>`.
- Record numbers: `D-0001`, `R-0001`, `Q-<origin-id>-01` (`Q-A.M100.T04-01`).
- Branding is Synopus. The ported-skills test forbids "akmo" only in `skills/parallel|plan|prompt`, but keep project names out of `skills/console/` too.

## Review Focus

1. **A `git push` written in an unusual way** (`git -C dir push`, `HEAD:refs/heads/x`, `--force-with-lease=…`, a variable branch `"$B"`, several commands joined with `&&`). The guard must judge each push target, and refuse a target it can't name literally.
2. **A machine replaced mid-run** (the role file is gone). The guard must still work out the role from the branch name and not open everything up. `whoami` must say "no role" and print how to join again.
3. **Settings that already have hooks** (Akmo's `.claude/settings.json` has PreToolUse and PostToolUse entries, and `enabledPlugins`). `install` must keep every key and entry. Running it a second time must change nothing.
4. **Records written by hand or from an older version**, with bad JSON or missing fields in `nodes/`. Listing must skip them with a warning. The guard must treat an unreadable node as "not merged", so an archive is refused.
5. **A child branch that was rewritten or never fetched.** `verify` must say Red, "not fetched", with the fix (`git fetch origin <branch>`), and must not throw.

---

### Task 1: Model: config, IDs, names, lanes, spawn check

**Files:**
- Create: `skills/console/scripts/model.mjs`
- Test: `test/console-model.test.js`

**Interfaces:**
- Produces:
  - `DEFAULTS`: the config defaults above, plus `numbers: []`, `sharedFiles: []`, `mergeRecipe: null`, `checks: {task:[],milestone:[],phase:[],console:[]}`, `label: null`, `syno: {branch: null}`.
  - `withDefaults(raw) -> cfg`: a deep merge of objects; arrays are replaced, not merged.
  - `LEVELS = ["console","phase","milestone","task"]`.
  - `parseId(text) -> {id, level, segments:{P,M,T}, parentId} | null`. `parentId` is `"console"` for a phase.
  - `childLevel(level) -> level|null`.
  - `namesFor(id, name, cfg) -> {id, level, title, titlePrefix, branch, parentId, parentBranch, tags}`. For a phase, `parentBranch` is `cfg.syno.branch`. It throws `usage` on a bad ID or a name over 48 characters.
  - `idFromBranch(branch, cfg) -> id|null`: tries task, then milestone, then phase, then the console branch.
  - `branchIsUnambiguous(id, cfg) -> boolean`: the branch parses back to the same ID.
  - `matchGlob(path, glob) -> boolean`: `*` matches within a path segment, and `**` matches across segments.
  - `lanesOverlap(laneA, laneB, shared) -> string[]`: the overlapping pattern pairs, ignoring shared files.
  - `checkSpawn({role, childId, lane, nodes, cfg}) -> {ok, reasons[]}`.
  - `STANDING_RULES`: 12 `{id:"R-0001", text}` entries, copied from design 5.10.
  - `usage(msg)` and `refusal(msg)`: errors carrying `exit` 2 and 3.

- [ ] **Step 1: Write failing tests** `AC-CN.1 ids, titles, branches and tags`:
  - `namesFor("A.M100.T04","Totals row",withDefaults({}))` gives:
    - title `PhA·M100·T04 · Totals row`
    - branch `claude/syno-pha-m100-t04`
    - parentBranch `claude/syno-pha-m100`
    - tags that include `syno-id:A.M100.T04`
  - A phase without a name has the title `PhA · Phase A`.
  - `parseId("a.m1")` gives the ID `A.M1`.
  - `parseId("console")` is the Console, and `parseId` returns null for `A.M1-2`, `A.X1`, `A.M1.T1.T2` and `""`.
  - `idFromBranch("claude/syno-phase-n", cfg)` gives `N`.
  - A name of 49 characters throws exit 2.
  - Two more tests:
    - `AC-CN.1 ambiguous branch templates are refused`: a template pair that makes phase `M1` and milestone `ASE.M1` share a branch.
    - `withDefaults keeps unknown keys and replaces arrays`.
- [ ] **Step 2: Write failing tests** `AC-CN.3 spawn limits and lanes`. `checkSpawn` refuses each of these, with reason text matching `/next level/`, `/3 tasks/`, `/overlap/` and `/2 milestones/`:
  - a milestone role creating a phase
  - a 4th running task
  - a lane `src/a/**` against a running sibling's `src/**`
  - a 3rd running milestone

  It allows a lane that overlaps only on a `sharedFiles` entry (`docs/PRD.md`). "Running" means a status of `running`, `handed-off` or `rework`.
- [ ] **Step 3: Run** `node --test test/console-model.test.js`. Expect: FAIL, because the module is missing.
- [ ] **Step 4: Implement `model.mjs`.** The templates use `{P}{M}{T}` (as written) and `{p}{m}{t}` (lower case). `idFromBranch` builds an anchored regex from each template.
- [ ] **Step 5: Run the tests.** Expect: PASS.
- [ ] **Step 6: Commit** `feat(console): ids, names, lanes and spawn limits [S-17, AC-CN.1, AC-CN.3]`.

### Task 2: Store: root, branch, role, config, records, write plan

**Files:**
- Create: `skills/console/scripts/store.mjs`
- Test: `test/console-store.test.js`

**Interfaces:**
- Consumes: `withDefaults`, `usage`, `refusal` from Task 1.
- Produces:
  - `findRoot(cwd) -> string|null`: walks up to `.git` (a folder or a `gitdir:` file).
  - `currentBranch(root) -> string|null`: reads HEAD through fs and handles worktrees.
  - `loadConfig(root) -> cfg`: `withDefaults(.syno/config.json → console)`.
  - `ROLE_PATH = ".syno/local/console/role.json"`, `loadRole(root) -> role|null`.
  - `resolveRole(root, cfg) -> role|null`: the role file wins. Otherwise it works the role out from the branch and sets `{inferred:true}`.
  - `KINDS = {nodes:"nodes", decisions:"decisions", rules:"rules", questions:"questions", numbers:"numbers"}`, all under `.syno/console/`.
  - `listRecords(root, kind) -> {records[], skipped[]}`: bad JSON goes into `skipped`.
  - `nextNumber(records, prefix) -> "D-0003"`: gaps are never filled. It returns max + 1.
  - `class Plan { constructor(root); write(rel, text); get empty; describe() -> string[]; apply({confirm}) -> {applied, ops} }`. It refuses paths that leave the root, including through a symlink.
  - `jsonText(value)`.
  - `mergeConsoleConfig(existingText|null, group) -> text`: keeps every other top-level key.

- [ ] **Step 1: Write failing tests:**
  - `Plan writes only with confirm and skips unchanged files`
  - `Plan refuses ../ and symlinks out of the root` (exit 3)
  - `listRecords skips bad JSON and reports it` (Review Focus 4)
  - `resolveRole infers from the branch when the role file is missing` (Review Focus 2): a temp repo on `claude/syno-pha-m100` gives `{level:"milestone", id:"A.M100", inferred:true}`
  - `mergeConsoleConfig keeps the compliance group`
  - `AC-CN.8 nextNumber never reuses a number`: records D-0001 and D-0003 give D-0004
- [ ] **Step 2: Run them.** Expect: FAIL.
- [ ] **Step 3: Implement `store.mjs`.**
- [ ] **Step 4: Run them.** Expect: PASS.
- [ ] **Step 5: Commit** `feat(console): records, role and write plan [S-17, AC-CN.8]`.

### Task 3: Guard

**Files:**
- Create: `skills/console/scripts/guard.mjs`
- Test: `test/console-guard.test.js`

**Interfaces:**
- Consumes: `namesFor`, `parseId`, `idFromBranch`, `childLevel` (Task 1).
- Produces:
  - `parsePushes(command) -> [{force, del, all, mirror, tags, prune, refspecs[], dynamic}]`. It splits on `&&`, `||`, `;`, `|` and newlines, and skips env assignments and git's global options (`-C x`, `-c k=v`, `--git-dir=…`, `--work-tree=…`, `--no-pager`).
  - `judge(input, ctx) -> {permissionDecision:"deny", permissionDecisionReason} | null`.
    - `input` is the hook's `{tool_name, tool_input}`.
    - `ctx` is `{role, cfg, nodes, currentBranch}`.
  - `MARKER = "SYNO ROLE CARD"`.
  - `GUARD_MATCHER`. The cloud copy uses the full string, and the plugin uses it without `Bash|Edit|Write|MultiEdit`. Full string: `"Bash|Edit|Write|MultiEdit|AskUserQuestion|EnterPlanMode|ExitPlanMode|mcp__.*__create_session|mcp__.*__archive_session|mcp__.*__merge_pull_request"`.

Each deny reason starts `Syno Console:` and names the fix (for example "send a [SYNO question] to your parent").

- [ ] **Step 1: Write failing tests** `AC-CN.4 G-ASK follows askAt`:
  - With a task role, `AskUserQuestion` is denied.
  - With a phase role, it is denied when `askAt:"console"` and allowed when `askAt:"phase"`.
  - `EnterPlanMode` is denied for a phase.
  - Everything is allowed for the console role and for `role:null`.
- [ ] **Step 2: Write failing tests** `AC-CN.5 G-PUSH`. Own branch `claude/syno-pha-m100-t04`.

  | Command | Expected |
  | --- | --- |
  | `git push -u origin claude/syno-pha-m100-t04` | Allowed |
  | `git -C /x push origin HEAD:refs/heads/claude/syno-pha-m100-t04` | Allowed |
  | `git push origin claude/syno-pha-m100` | Denied |
  | `git push --force origin <own>` | Denied |
  | `git push origin +<own>` | Denied |
  | `git push --force-with-lease=<own> origin <own>` | Denied |
  | `git push origin :<own>` | Denied |
  | `git push --delete origin <own>` | Denied |
  | `git push --all` | Denied |
  | `git push --tags` | Denied |
  | `git push origin "$B"` | Denied (dynamic) |
  | `npm test && git push origin main` | Denied |
  | `git push`, current branch is own | Allowed |
  | `git push`, current branch is the parent's | Denied |

  `gh pr merge 5` is denied too.
- [ ] **Step 3: Write failing tests** `AC-CN.6 G-SPAWN and G-ARCHIVE`:
  - **G-SPAWN.** A task calling `mcp__claude-code-remote__create_session` is denied. A milestone `A.M100` creating `A.M100.T05` is allowed when all of these hold:
    - the title starts with `PhA·M100·T05`
    - `outcome_branch` is `claude/syno-pha-m100-t05`
    - `permission_mode` is `auto` or `default`
    - `append_system_prompt` starts with the marker

    Each of these is denied: the wrong title, the wrong branch, `permission_mode` `bypassPermissions`, no marker, and a grandchild ID.
  - **G-ARCHIVE.** `archive_session` is allowed only when `nodes` holds a node with that `sessionId`, a status of `merged` or `stopped`, and `parentId === role.id`. A node with a status of `running`, or none at all, is denied.
  - **G-MERGE-PR.** `mcp__github__merge_pull_request` is denied for the console role.
- [ ] **Step 4: Write failing tests:**
  - `G-RECORDS` denies a task `Write` to `.syno/console/decisions/D-0001.json` and allows the console role.
  - `judge fails open` returns null for `input` `{}` or for a `tool_input` that is not an object.
- [ ] **Step 5: Run.** Expect: FAIL.
- [ ] **Step 6: Implement `guard.mjs`.** It holds no fs or process code: `ctx` is passed in.
- [ ] **Step 7: Run.** Expect: PASS. Then commit `feat(console): guards for questions, pushes, sessions and records [S-17, AC-CN.4–6]`.

### Task 4: Read-only git and verify

**Files:**
- Create: `skills/console/scripts/gitread.mjs`, `skills/console/scripts/verify.mjs`
- Modify: `test/guards.test.js` (`PROCESS_ALLOWED`: `"skills/console/scripts/gitread.mjs": "Syno Console reads git (read-only) to check merges"`)
- Test: `test/console-verify.test.js`

**Interfaces:**
- Produces:
  - `gitRead(args, {cwd}) -> string`.
  - `isAncestor(a, b, {cwd}) -> boolean`: git's exit 1 means false, and any other failure throws.
  - Allowed git commands: `rev-parse`, `merge-base`, `log`, `for-each-ref`, `remote get-url origin`, and `diff` only together with `--name-status`. Forbidden arguments are the same as in `scripts/lib/git.js`.
  - `repoUrl(root) -> string|null`: normalised to `https://github.com/<owner>/<repo>`, with credentials, proxy hosts and `.git` stripped.
  - `verifyChild(root, {childId, childBranch, childRef?, parentRef?, reportedHead?, lane, shared}) -> {verdict:"green"|"amber"|"red", reasons[], files[], alreadyMerged, childHead}`.

- [ ] **Step 1: Write failing tests**, on a temp repo built with `test/fixtures.js` helpers. Make a parent branch and a child branch, then a bare clone, so `origin/<child>` exists.
  - `AC-CN.7` **Green:** synced, in lane.
  - `AC-CN.7` **Amber:**
    - "needs sync": the parent moved after the branch
    - "outside lane": a file outside the lane
    - "differs from the report": a reported head that doesn't match
  - `AC-CN.7` **Red:**
    - a change to `.syno/console/decisions/D-0001.json`
    - a change to `.syno/console/nodes/A.M2.json`, which is outside the subtree of `A.M1`
  - `AC-CN.7 already merged`: after merging, `alreadyMerged` is true and the verdict is green.
  - Review Focus 5: an unknown branch gives red, with a reason matching `/git fetch origin/`, and doesn't throw.
- [ ] **Step 2: Write a failing test** `gitRead refuses push, fetch and diff without --name-status` (exit 3).
- [ ] **Step 3: Run.** Expect: FAIL.
- [ ] **Step 4: Implement.** `verifyChild` uses `diff --name-status <parent>...<child>`. A rename gives both paths.
- [ ] **Step 5: Run these tests and `test/guards.test.js`.** Expect: PASS. Then commit `feat(console): read-only verify before a merge [S-17, AC-CN.7]`.

### Task 5: Cards, brief, spawn parameters and tree

**Files:**
- Create:
  - `skills/console/scripts/cards.mjs`
  - `skills/console/scripts/tree.mjs`
  - `skills/console/references/role-card.md`
  - `skills/console/references/brief.md`
- Test: `test/console-cards.test.js`

**Interfaces:**
- Consumes: `namesFor`, `STANDING_RULES`, `MARKER`.
- Produces:
  - `fill(template, values) -> string`: replaces `{{KEY}}` and throws `usage` when a key is missing or unused.
  - `roleCard({cfg, names, parent:{id,session,branch}, consoleSession, lane, rules, template}) -> string`. It includes a one-line join command: `node "<skill dir>/scripts/console.mjs" join --id <id> --parent-session <s> --console-session <s> [--lane a,b] --confirm`.
  - `briefText({template, names, brief}) -> string`. `brief` is `{goal, ref?, inScope[], outScope[], lane[], doneWhen[], dependsOn[], decisions[{id,text}], numbers[], checks[], handoff[]}`.
  - `spawnParams({names, repoUrl, card, brief, cfg}) -> {title, tags, permission_mode, source_url, source_revision, outcome_branch, append_system_prompt, prompt}`.
  - `renderTree({nodes, questions, cfg, live?}) -> {verdict, text}`. `live` maps sessionId → status bucket.

- [ ] **Step 1: Write failing tests:**
  - `AC-CN.2 role card`:
    - its first line is `SYNO ROLE CARD`
    - it contains each `R-0001`…`R-0012`, the words "Order of authority", the parent session and the console session
    - it is ≤ 6,144 bytes for a 48-character name and a 10-pattern lane
  - `fill throws on a missing key`
  - `spawnParams`: `permission_mode` is `"auto"`, and `source_revision` is the parent branch
  - `renderTree` with one open question gives a verdict line that starts `Amber:` and a `├─` line per node
- [ ] **Step 2: Run.** Expect: FAIL.
- [ ] **Step 3: Write the two templates in plain words** (design 5.4).
  - `role-card.md` has these keys: `TITLE`, `LEVEL`, `ID`, `BRANCH`, `PARENT_ID`, `PARENT_SESSION`, `PARENT_BRANCH`, `CONSOLE_SESSION`, `JOIN`, `ASK_RULE`, `LANE`, `RULES`.
  - `brief.md` has one key per brief field.
- [ ] **Step 4: Implement `cards.mjs` and `tree.mjs`** (pure).
- [ ] **Step 5: Run.** Expect: PASS. Then commit `feat(console): role card, brief, spawn parameters and tree [S-17, AC-CN.2]`.

### Task 6: Pocket CLI `console.mjs`

**Files:**
- Create: `skills/console/scripts/console.mjs`, `skills/console/scripts/commands.mjs` (record writers, to keep files under 300 lines)
- Test: `test/console-cli.test.js`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `runConsole(argv, {cwd, now?}) -> Promise<{code, text, data}>`.
  - When it is run directly, it prints the result (`--json` prints `data`) and exits with `code`.
  - Subcommands and their flags:
    - `whoami`
    - `join --id --parent-session --console-session [--session] [--name] [--lane] [--confirm]`
    - `names <id> [--name]`
    - `card <id> --name --parent-session --console-session [--lane]`
    - `brief <id> --file <brief.json>`
    - `spawn <id> --name --lane --parent-session --console-session [--brief-file]`
    - `verify <id> [--head] [--ref] [--lane]`
    - `record <id> --status [--session --merge --head --report --name --lane --ref] [--confirm]`
    - `decide --file [--confirm]`
    - `rule --text [--scope --supersedes] [--confirm]`
    - `question --file [--confirm]`
    - `numbers [<series> --to <id> --count <n>] [--confirm]`
    - `start [--branch --ask-at --label] [--confirm]`
    - `tree [--live <file>]`
    - `guard` (reads stdin, always exits 0)
    - `brief-hook` (SessionStart: prints a JSON `{hookSpecificOutput:{hookEventName:"SessionStart", additionalContext}}` only when a role is known)
  - Record shapes, as in design 5.11:
    - node `{schemaVersion, id, level, name, ref, parentId, sessionId, branch, parentBranch, lane, status, createdAt, mergedAt, mergeCommit, headCommit, archivedAt, deliveries[]}`
    - decision `{schemaVersion, id, scope, question, options[], chosen, reason, questionId, askedBy, decidedAt, supersedes, by:"owner"}`
    - rule `{schemaVersion, id, text, scope, since, supersedes}`
    - question `{schemaVersion, id, from, path[], text, options[], blocking, status, decision}`
    - numbers `{schemaVersion, series, next, blocks[{to, from, until, at}]}`
  - The register page (`cfg.register`) is rebuilt on every `decide`: a table of Date | Scope | Question | Answer | ID, with superseded rows marked "replaced by D-nnnn".

- [ ] **Step 1: Write failing tests**, on a temp repo:
  - `AC-CN.8 decide, rule and numbers are Console-only`: a task role gets exit 3
  - `decide numbers in order and never edits an old decision`: superseding D-0001 leaves its file byte-identical
  - `numbers hands out non-overlapping blocks`: ADR 3 to A.M1, then 2 to A.M2, gives 1–3 and 4–5
  - `record is written only by the node's parent`
  - `writes need --confirm`: without it, exit 0 and no file
  - `start writes R-0001…R-0012, the config group and .gitignore once`: a second run says "No files would change."
  - `spawn prints create_session parameters`
  - `guard prints a deny for a task AskUserQuestion and nothing for bad stdin`
  - `whoami without a role says how to join` (Review Focus 2)
- [ ] **Step 2: Run.** Expect: FAIL.
- [ ] **Step 3: Implement.** Write `start`'s rulebook (`cfg.rulebook`) only when that file is missing. It holds: the levels table with the project's templates, R-0001…R-0012, the `askAt` sentence and where the register is.
- [ ] **Step 4: Run.** Expect: PASS. Then commit `feat(console): pocket CLI for cloud sessions [S-17]`.

### Task 7: Plugin integration: CLI, install, hooks

**Files:**
- Create: `scripts/lib/console/cli.js`, `scripts/lib/console/install.js`, `scripts/lib/console/hooks.js`
- Modify:
  - `scripts/syno.js`: add `console` to `FUNCTIONS`
  - `scripts/hooks/run.js`: a console handler after the governor, `budgetMs: 200`
  - `scripts/lib/governor/hooks.js`: return null for PreToolUse when `input.tool_name` is set and isn't `Bash`
  - `hooks/hooks.json`: a second PreToolUse entry with the plugin matcher
  - `scripts/lib/strings/en.json`: `functions.console: "Syno Console"`
- Test: `test/console-install.test.js`

**Interfaces:**
- Produces:
  - `run(ctx)` for `syno console …`: calls `runConsole`, except for `install`.
  - `planInstall(root, pluginRoot, {version}) -> WritePlan`, using Syno's `WritePlan`.
  - `checkInstall(root, pluginRoot) -> {ok, missing[], edited[], hooks:boolean}`.
  - `handle(event, input, env)`:
    - SessionStart gives `{lines:[…]}`.
    - PreToolUse gives `{decision}` from `judge`.
    - It is silent when `.claude/settings.json` already names `syno-console/scripts/console.mjs`.
  - The copied `SKILL.md` gets `name: syno-console` and, after its front matter, the line `<!-- Copied from Syno <version> by /syno:console install. Update with the same command; don't edit by hand. -->`.
  - The hook command strings are:
    - `node "$CLAUDE_PROJECT_DIR/.claude/skills/syno-console/scripts/console.mjs" guard` (timeout 10)
    - `… brief-hook` (timeout 10)

- [ ] **Step 1: Write failing tests:**
  - `AC-CN.9 install keeps other settings`: a settings file with `enabledPlugins`, a PreToolUse Bash hook and a PostToolUse hook keeps all three and gains both entries (Review Focus 3)
  - `AC-CN.9 install is idempotent`
  - `AC-CN.9 install --check spots an edited copy`
  - `AC-CN.10 the dispatcher's console handler is quiet when the cloud copy is installed`
  - `AC-CN.10 the PreToolUse hook denies a task AskUserQuestion through run.js`: spawn `scripts/hooks/run.js PreToolUse` in a temp repo with a task role file
  - `Governor ignores non-Bash tools`
- [ ] **Step 2: Run.** Expect: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `node --test test/*.test.js`. Expect: all pass. Then commit `feat(console): syno console CLI, install and hooks [S-17, AC-CN.9, AC-CN.10]`.

### Task 8: Skill, command, schemas, PRD and README

**Files:**
- Create:
  - `skills/console/SKILL.md`
  - `skills/console/references/protocol.md` (envelopes, question format, handoff format, sync)
  - `skills/console/references/console-duties.md` (start, phases, questions, deliveries, status, the owner's report)
  - `commands/console.md`
  - `schemas/console-node.schema.json`, `console-decision.schema.json`, `console-rule.schema.json`, `console-question.schema.json`, `console-numbers.schema.json`
- Modify:
  - `PRD.md`: the At a glance and scope tables, a new section 6.18 S-17 with AC-CN.1–10, §8 data model rows, a §9 command row, a §12 layout line, and a changelog row for PRD 0.3 on 2026-11-21
  - `README.md`: a function row
- Test: `test/console-docs.test.js`

**Interfaces:**
- `SKILL.md` has front matter `name: console` and a description of 300 to 600 characters that starts "Syno Console." Its body:
  - **DMAIC steps:** Define and Control.
  - `CONSOLE` means `node "<this skill's base directory>/scripts/console.mjs"`.
  - One section each for the Console, Phase, Milestone and Task.
  - Explicit text on: never ask the owner except at the `askAt` level, never use plan mode, and archive only after a verified, recorded and pushed merge.
- `commands/console.md` calls `node "${CLAUDE_PLUGIN_ROOT}/scripts/syno.js" console …`. It asks with AskUserQuestion before `--confirm`, and passes it only on a yes.

- [ ] **Step 1: Write failing tests:**
  - `S-17 the console skill names its DMAIC steps and the askAt rule`
  - `S-17 records written by the CLI validate against the schemas`, using `scripts/lib/schema.js` on records from a temp run of `start`, `decide`, `numbers` and `record`
  - `S-17 the PRD lists AC-CN.1 to AC-CN.10`
- [ ] **Step 2: Run.** Expect: FAIL.
- [ ] **Step 3: Write the files.**
- [ ] **Step 4: Run** `node --test test/*.test.js`. Expect: all pass, including `commands.test.js` (description budget). Then commit `docs(console): skill, command, schemas, PRD 0.3 S-17 [S-17]`.

### Task 9: Whole-branch verification and the adoption note

- [ ] **Step 1: Run** `node test/selftest.js`. Expect: every test passes, and `claude plugin validate` reports no errors.
- [ ] **Step 2: Dry run in a temp copy of a project.**
  - Run `syno console install --confirm`, then `start --branch claude/syno-console --confirm`, then `spawn A --name Foundations …`.
  - Read the printed role card as a child would. Check that every instruction in it can be followed with the cloud copy alone.
- [ ] **Step 3: Write `docs/superpowers/notes/2026-11-21-console-adoption-akmo.md`.** For Akmo's Syno Console, it holds:
  - Akmo's settings mapped to the plugin: `askAt: "phase"`, `syno.branch: "claude/phase-a-m100-02-schema"`, the branch names in its README (`claude/syno-phase-a`, `claude/syno-pha-m100`), and its checks list and merge recipe path.
  - The ADR number to ask for.
  - The order of steps, after the combined PR.

  It changes nothing in Akmo.
- [ ] **Step 4: Commit and push** `claude/console-function` to `Synopus-RM/syno` (`git push -u origin claude/console-function`). Open no PR unless the owner asks.
