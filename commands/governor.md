---
description: Syno Governor — the device, the shared queue and the owner's decisions. Subcommands: status, setup, queue, priorities, breakdown, decide
argument-hint: "status | setup | queue | priorities | breakdown <task> | decide"
---

The first word of $ARGUMENTS picks the subcommand below; the rest of $ARGUMENTS are its arguments (written `$ARGUMENTS` inside each section). With no subcommand, do **status**.

The CLI is `node "${CLAUDE_PLUGIN_ROOT}/scripts/governor/gov.js"`, written `gov` below. Session start also puts `gov` on PATH in Bash. The Governor keeps its state in `~/.claude/workload-governor/`, shared with the standalone Workload Governor, so a budget the owner already confirmed still applies.

## status

1. Run `gov status`, `gov sessions` and `gov history --limit 5`.
2. Report in 12 lines or fewer:
   - live load: CPU %, free RAM, temperature
   - whether the budget is confirmed, and its key limits
   - Claude sessions running on this device, by project. Show which have the governor and which don't. Sessions without it were started before install or have it disabled; restarting them (quit and reopen the Claude app) brings them under the governor. Cowork runs in its own VM and is not governed.
   - what is running and what is waiting in the queue: project, label and duration for each
   - any recent run that failed, or was stopped or timed out
3. If decisions are pending, ask the owner about them with AskUserQuestion. Use one question per decision, with the decision's options as the choices. Record each answer with `gov decide <id> <option>`. Never choose for the owner.
4. If the budget is not confirmed, suggest `/syno:governor setup`.

Do not search the computer for sessions yourself: `gov sessions` is the source of truth.

## setup

Set up Syno Governor for this device. You measure, explain and apply. The owner makes every choice.

1. Run `gov profile --json`.
2. Show the owner, in 10 lines or fewer:
   - the device: CPU model, physical cores and threads, RAM, temperature sensor, AC or battery
   - the three presets side by side in a small table: heavy jobs at once, jobs in total, e2e workers, test workers, build jobs, the CPU % below which new jobs start, and the pause temperature
   - one line from `rationale` on why the balanced preset fits
   - the currently confirmed budget, if there is one
3. Ask with one AskUserQuestion call containing these four questions. Put the recommended option first:
   - **Budget**:
     - Balanced (Recommended)
     - Conservative: cooler and quieter, slower
     - Performance: faster, hotter

     If `$ARGUMENTS` names a preset, recommend that preset instead. If the owner types their own numbers, use them.
   - **Queue mode**:
     - Queue (Recommended): heavy commands from every session wait their turn
     - Ask: run directly, but ask me whenever the device is busy
     - Advise: never block, only inform
   - **Quality control after each task chunk**:
     - Standard (Recommended): targeted tests each chunk, full unit suite at milestones
     - Targeted: only the tests for what changed
     - Strict: full suites including e2e every chunk
     - Manual: stop for my review after every chunk
   - **Longest single verification run**:
     - 8 minutes (Recommended)
     - 5 minutes
     - 15 minutes
4. Apply exactly what the owner chose. Each command shows a permission prompt; tell the owner that is expected.
   - `gov budget set --preset <preset>`. Add custom numbers as `key=value`, e.g. `slots.heavy=1 workers.e2e=2 thresholds.tempPauseC=80`.
   - `gov policy set mode=<queue|ask|advise> qc.default=<standard|targeted|strict|manual> chunk.targetMinutes=<n>`
5. Run `gov status` and show the confirmed setup in 6 lines or fewer. If more than one project uses this device, offer `/syno:governor priorities`.

Never choose an option for the owner. Never set a value higher than the one they chose.

## queue

If `$ARGUMENTS` is not empty, it is the owner's own instruction. Run `gov queue $ARGUMENTS`; the owner confirms it in the permission prompt. Then show `gov queue`.

Otherwise:
1. Run `gov status` and show the queue: running jobs first, then waiting jobs in order, each with its id, project, label, class and how long it has been there.
2. If the queue is empty, say so in one line and stop.
3. Ask with AskUserQuestion: "What should change in the queue?"
   - Leave it as it is (Recommended)
   - Move a job to the front
   - Pause a waiting job
   - Cancel a job
4. If the owner picks a change, ask a second AskUserQuestion naming the jobs it could apply to, then run the matching command:
   - `gov queue move <id> 1`
   - `gov queue pause <id>`
   - `gov queue cancel <id>`
   - for a running job only: `gov queue cancel <id> --kill`, after warning that this stops another session's run partway
5. Show the queue again.

Never reorder, pause or cancel a job unless the owner chose it.

## priorities

If `$ARGUMENTS` gives a project and a number, that is the owner's instruction. Run `gov priority set $ARGUMENTS`, then show `gov priority`.

Otherwise:
1. Run `gov priority`. It already lists every project that has a Claude Code session running on this device, in any folder, whether or not that session has the governor, plus any project the owner already ranked. Do not search the computer for sessions yourself; this list is the source of truth.
2. Show the list in 8 lines or fewer: project, current priority, and running sessions with and without the governor.
   - If some sessions run without the governor, say plainly that they were started before the plugin was installed (or have it disabled), that they ignore priorities and the queue until restarted, and that quitting and reopening the Claude app restarts them with the governor.
   - If Cowork is running, say that Cowork runs in its own virtual machine and is not governed.
3. Ask with AskUserQuestion: "When projects' heavy jobs compete, which should go first?"
   - Keep first come, first served (Recommended)
   - Up to three of the listed projects, each as "<project> first"

   The owner can type a full order under Other.
4. Turn the owner's order into numbers: first = 10, second = 5, and 0 for the rest. Show the mapping, then run `gov priority set <project> <n>` for each project that changes. Clear projects that move back to 0 with `gov priority clear <project>`.
5. Show `gov priority` again. Waiting jobs are re-ordered to match.

If the list is truly empty (no Claude sessions anywhere and nothing ranked), say there is nothing to order yet, and that priorities can be set by name at any time with `/syno:governor priorities <project> <number>`.

Never set or change a priority the owner did not choose.

## breakdown

Task: $ARGUMENTS

1. Run `gov advise` and `gov status`. Note the worker limits, the chunk target in minutes, the files-per-chunk limit, the owner's QC level, and the recent run times.
2. Inspect only what you need to size the task: the files involved and the tests that cover them. Do not change any files yet.
3. Draft the chunks. For each chunk give:
   - **Goal**: one sentence.
   - **Files**: no more than the files-per-chunk limit.
   - **Verify**: a command sized to the device, using worker flags or shards from `gov advise`, with its load class and an estimate in minutes.
   - **QC gate**: the owner's level by default. If a riskier chunk needs a stricter gate, say why in one line.
   - **Done when**: a pass/fail condition.

   Order the chunks so the project still builds after each one. Put e2e and full builds at milestones unless the QC level is strict.
4. Show the plan as one compact table with no more than 12 rows. For anything larger, group it into phases and detail only phase 1. Add one line with the total estimated heavy-run time and how many heavy runs the plan needs.
5. Ask with one AskUserQuestion call:
   - **Plan**:
     - Approve (Recommended)
     - Smaller chunks
     - Bigger chunks
     - Change the QC gates
   - **When should I stop for your review?**
     - At milestones and on any failure (Recommended)
     - After every chunk
     - Only when something fails
6. Revise the plan until the owner approves it. Then put the chunks in the session task list. Start chunk 1 only if the owner wants work to begin now.
7. During execution:
   - Run every heavy verification with `gov run ...` and `run_in_background: true`.
   - After each chunk, report `✅ Chunk i/N: <result> (<verify>, <duration>)`.
   - Stop at the review points the owner chose, when a gate fails twice, or when a chunk outgrows its plan.

Never start the work, merge chunks or skip a QC gate without the owner's approval.

## decide

1. Run `gov decisions --json`. If the list is empty, say so in one line and stop.
2. Ask the owner with AskUserQuestion. Use one question per decision, at most 4 per call. The question is the decision's `question` and the choices are its `options`, using each option's label. Do not mark any option as recommended unless the facts clearly favour it, and say why in the option's description.
3. Record each answer with `gov decide <id> <option-key>`. If the owner typed their own words, add `--note "<their words>"`. They confirm each one in the permission prompt.
4. If the answer to a `split` decision is `split`, follow the governor skill. Propose how to split that run (shards, folders or files) and get the owner's approval before anything runs.

Never answer a decision for the owner.
