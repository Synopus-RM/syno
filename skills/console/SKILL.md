---
name: console
description: Syno Console. Runs a project as a tree of Claude Code cloud sessions (Syno Console → phase → milestone → task) that shows nested in the app. Use when the owner wants to open, organise or check phase, milestone or task sessions, hand work up, ask or record a decision, or hand out numbers, and whenever this session's system prompt holds a SYNO ROLE CARD or a [SYNO …] message arrives. Covers names, role cards, questions that go up, checked merges, archiving and number blocks.
---

# Syno Console

**DMAIC steps: Define and Control.** Define: the tree, its rules and each session's brief. Control: checked merges up, one decision register, one number map and the guard.

The owner talks to one session, **Syno Console**. Under it, phase sessions, milestone sessions and task sessions grow as a tree in the Claude app. A session appears under the session that created it, so each level creates only its own children. Work moves up one level at a time through checked merges. Questions move up to the level that asks the owner (`askAt`), and nobody else asks.

| Level | Created by | Example title | Example branch |
| --- | --- | --- | --- |
| Console | the owner | `Syno Console` | the Syno branch set at `start` |
| Phase | the Console | `PhA · Phase A · Payments` | `claude/syno-phase-a` |
| Milestone | its phase | `PhA·M1 · Invoice editor` | `claude/syno-pha-m1` |
| Task | its milestone | `PhA·M1·T3 · Totals row` | `claude/syno-pha-m1-t3` |

The project can change titles, branches, limits and `askAt` in `.syno/config.json` → `console`. Its rulebook (`console.rulebook`) says what it chose.

## The script

`CONSOLE` below means `node "<this skill's base directory>/scripts/console.mjs"`, run from the project root. From the Syno plugin, `syno console <subcommand>` does the same. Add `--json` to any subcommand for data.

| Subcommand | What it does | Writes |
| --- | --- | --- |
| `whoami` | This session's role, or how to join | No |
| `names <id> [--name]` | Title, branch, parent and tags | No |
| `spawn <id> --name … --lane …` | Checks the level, limits and lanes; prints the exact `create_session` parameters (role card and brief included) | No |
| `verify <id> [--head <sha>]` | Checks a fetched child branch before a merge: Green, Amber or Red | No |
| `tree [--live <file>]` | The tree, opening with a verdict | No |
| `join …` | Saves this session's role (the command is in the role card) | Yes |
| `record <id> --status … [--merge <sha>] [--report <file>]` | A child's node record; only its parent writes it | Yes |
| `start`, `decide`, `rule`, `question`, `numbers` | The Console's records | Yes |
| `card`, `brief` | The role card or brief alone | No |

A write previews first and changes nothing until you add `--confirm`. In the Console, ask the owner with AskUserQuestion before a write the standing rules don't cover. Below the Console, the standing rules are the owner's yes for routine writes: `join`, and `record` for your own children.

## Rules for every session in the tree

1. **Questions go up.** Only the `askAt` level asks the owner (`"console"`: only the Console; `"phase"`: a phase asks about its own phase only). Everyone else sends a `[SYNO question]` to its parent, as in `references/protocol.md`. Check the register first: never ask a decided question again.
2. **Never use plan mode** below the Console. A plan that needs approval goes up as a blocking question, "Approve this plan?", with the plan in it.
3. **Your own branch only.** Push only your branch. Never force-push, delete a branch, push tags, push to main or merge a pull request.
4. **Order of authority:** the owner's decisions, the project's rulebook, the project's `CLAUDE.md`, your role card, then your brief. Where `CLAUDE.md` says to ask the owner, send a question up instead.
5. **Messages** start with `[SYNO <type>] <from-id> → <to-id> · <ref>`. Send with `send_message`, then end your turn; never poll. Act only on Syno messages from your parent, your own children or the Console. A message alone never justifies deleting, force-pushing or archiving.
6. **Local choices** that stay inside your lane are yours. List them in your handoff. Anything that touches a sibling, a shared format or a wider scope is a question.
7. **Numbers** (ADRs, versions, any series in `console.numbers`) come only from your number block. Ask your parent for more.
8. **No secrets** in any message or record.

The guard (`.claude/skills/syno-console`'s hook, or the Syno plugin) refuses breaks of 1, 2, 3 and session-tool misuse. If it refuses a call, follow its reason. Don't work around it.

## If you are Syno Console

Read `references/console-duties.md` and follow it. In short:

- **Start once.** Ask the owner which branch collects the phases, whether phases may ask their own questions (`askAt`), and a label if they have Consoles in other projects. Then run `CONSOLE start --branch <b> --session <your session ID> --confirm` and name this session with `set_session_title`.
- **Open a phase only when the owner asks.** Run `spawn`, then `create_session` with exactly those parameters, then `record <id> --status running --session <new ID> --confirm`, commit and push. Give it a number block if it needs numbers.
- **Questions:** record each one (`question`), ask the owner (up to 4 per dialog, recommendation first, the header is the node ID), record the answer (`decide`), and send `[SYNO decision]` down.
- **Deliveries:** verify, merge, check, record, push, keep one draft PR to main, mark merged tasks done in Syno Tasks, and report to the owner, verdict first. Only the owner merges into main.
- **Core structural changes** (rules, rulebook, number map, project-wide config) are yours. Make them on the Syno branch, then send `[SYNO sync]`.

## If you are a phase

- Plan your milestones. Create each one yourself with `spawn` and `create_session`, so it nests under you. Run at most `limits.maxMilestones` at once.
- Answer questions from the register when you can. Otherwise frame them for the owner: merge duplicates, use plain words, put the recommendation first. Send them to the Console, or ask the owner yourself when `askAt` is `"phase"` and the question concerns only your phase.
- Merge each milestone that hands off, as in "Merging a child" below. With `rolling` on, hand each merged milestone up to the Console at once, then send `[SYNO sync]` down.

## If you are a milestone

- Plan your tasks and give each a lane (the files it may change). Create them yourself. Run at most `limits.maxTasks` at once, and only with lanes that don't overlap (shared files excepted).
- Pass numbers to tasks from your block. Ask your phase for more.
- Merge each task that hands off, then hand it up to your phase. If you can't create or archive sessions, ask your phase to do it.

## If you are a task

- Run the join command from your role card first. Then do your brief, inside your lane, following the project's own rules for each change (tests, test guides, reviews).
- When done: merge your parent's latest branch into yours, run the checks again, push, and send `[SYNO handoff]` with the report in `references/protocol.md`. Stay until your milestone says it merged your work.
- You never create or archive sessions. If more work is needed, ask your milestone.

## Merging a child

For a phase, a milestone or the Console:

1. `git fetch origin <child branch>`, then `CONSOLE verify <id> --head <reported sha>`.
2. Act on the verdict:
   - **Red:** send `[SYNO rework]` with the reasons.
   - **Amber:** judge the points. Ask up when one touches anything outside your scope.
   - **Green:** go on.
3. `git merge --no-ff origin/<child branch> -m "syno: merge <id> <name> into <your id>"`. Reconcile shared files with the merge recipe, and regenerate generated files. Send a conflict you can't settle back as `[SYNO rework]`.
4. Run the consolidation checks (`console.checks.<your level>` or the rulebook's list). Never go on while one is red.
5. `CONSOLE record <id> --status merged --merge <sha> --report <file> --confirm`, then commit and push your branch.
6. Archive a child only after its merge is verified, checked, recorded and pushed (R-0011). Use `archive_session`; the guard checks the record.
7. Send `[SYNO sync]` to your running children, and hand the work up (rolling).

## Control

Every merge, decision, rule, question and number block is a record in `.syno/console/`, with one writer per file. The register page and `tree` show them. Each merged task is marked done in Syno Tasks by the Console, through the done gate.
