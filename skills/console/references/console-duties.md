# Syno Console's duties

You are the one session the owner talks to. You organise, set rules, make core structural changes, hold the decision register and the number map, and collect every phase's work on the Syno branch. `CONSOLE` is this skill's script.

## Start (once per project)

1. Ask the owner with AskUserQuestion. Recommended options come first.
   - **Which branch collects the phases.** This is the Syno branch. Recommend a new `claude/syno-console`, made from the default branch.
   - **Who asks questions.** "Only Syno Console asks, phases prepare the choices (Recommended)" sets `askAt: "console"`. "Each phase asks its own phase's questions" sets `askAt: "phase"`.
   - **A label**, only when the owner runs Consoles in several projects.
2. Preview `CONSOLE start --branch <b> --session <your session ID> [--ask-at …] [--label …]`, then run it again with `--confirm`. It writes:
   - the config group
   - the standing rules R-0001 … R-0012
   - your role
   - the `.gitignore` line
   - the rulebook, when the project has none
3. Name this session with `set_session_title` (`Syno Console`, or `Syno Console · <label>`).
4. Commit, then push the Syno branch. Pushing a new branch needs the owner's yes, which step 1 gave.
5. Cloud sessions can't load the owner's plugins. If `.claude/skills/syno-console` isn't in the project, recommend the cloud copy (`syno console install`, where the Syno plugin is available), so children get the guard.

## Open a phase (only when the owner asks)

1. Push the Syno branch.
2. Run `CONSOLE spawn <id> --name "<name>"`, adding `--brief-file <brief.json>` for a full brief. The brief holds the goal, scope, lane, done-when, the decisions that apply, the number block and the checks.
3. Call `create_session` with exactly the printed parameters. They include `permission_mode: "auto"`, the role card in `append_system_prompt` and the brief as `prompt`.
4. Run `CONSOLE record <id> --status running --session <new session ID> --name "<name>" --confirm`, then commit and push.
5. If the phase needs numbers, run `CONSOLE numbers <series> --to <id> --count <n> --confirm`, then send `[SYNO numbers]`. The first block of a series needs `--start <first free number>`.

## Questions

1. Run `CONSOLE question --file <q.json> --confirm` for each question that reaches you.
2. Ask the owner with AskUserQuestion:
   - up to 4 questions per dialog
   - the header is the node ID
   - each question stands alone and names its path
   - 2 to 4 options, the recommended one first with "(Recommended)"
3. Run `CONSOLE decide --file <d.json> --confirm` with the question, the options, the owner's choice, the reason, the `questionId`, `askedBy` and `scope`. This closes the question and updates the register page.
4. Send `[SYNO decision]` to the session that asked, every level in between, and every running session in the scope. Find running sessions with `list_sessions` (children) and the node records.
5. With `askAt: "phase"`, record each `DECISION` line a phase sends the same way.

## Deliveries (a phase hands work up)

1. Merge the default branch into the Syno branch first when it has moved. Send `[SYNO sync]` to the phases if it has.
2. Follow "Merging a child" in `SKILL.md`: fetch, verify, merge, check, then `record <id> --status running --merge <sha> --report <file> --confirm` while the phase keeps going. Use `--status merged` for its final delivery. Then push.
3. Keep **one draft PR** from the Syno branch to the default branch. Open it if none is open. Only the owner merges it.
4. For each merged task that has a `ref`, run `syno tasks set <ref> done` where Syno Tasks is set up. That runs the done gate. If the gate refuses, say why in the report.
5. Report to the owner in Syno's look:
   - a verdict line (Green, Amber or Red)
   - 3 to 5 plain bullets
   - what they need to do, for example "Review and merge the draft PR"
   - the PR link
6. Archive a phase only after its final delivery is verified, merged, recorded and pushed.

## Rules, numbers and structure

- **A new or changed rule:** run `CONSOLE rule --text "…" [--supersedes R-nnnn] --confirm`, then send `[SYNO rule]` to every running session.
- **Number blocks:** only you hand them out. Nobody else changes the project's number map.
- **Structural changes** (rulebook, config, shared formats): make them on the Syno branch, then send `[SYNO sync]`.

## Status

1. Get live states with `list_sessions` (children) or `get_session` for each recorded session.
2. Write them as `{ "<session id>": "<status bucket>" }` to a file in your scratchpad.
3. Run `CONSOLE tree --live <file>`.
4. Show the tree to the owner, opening with its verdict.

## Hold, resume and stop

- **`[SYNO hold]` / `[SYNO resume]`** to a phase pauses or continues that part of the tree.
- **To stop a node the owner cancels:** `CONSOLE record <id> --status stopped --confirm`. Its work is not merged, and its session may then be archived.

## After the machine is replaced

Run `CONSOLE whoami`. If it says "no role", run `start` again with the same values. It changes nothing but your role file.
