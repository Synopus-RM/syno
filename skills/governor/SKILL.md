---
name: governor
description: Syno Governor. Use before running tests, e2e suites, builds, installs, docker or mobile builds on this local machine, and before starting any large multi-step coding task. Keeps work within the device's owner-confirmed CPU, RAM and temperature budget - queues heavy commands across all sessions and projects with the gov CLI, sizes workers and shards to the device, and breaks big tasks into small chunks with quality gates. Priorities, queue order, task breakdowns and quality control are always the device owner's decision - this skill proposes and asks, never decides.
---

# Syno Governor: device-aware work

**DMAIC step: Measure.** The Governor measures what this device can take and keeps every heavy run within it.

Several Claude sessions, across several projects, share one laptop or desktop. When they all run e2e suites and builds at once, the CPU sits at 98%, the machine overheats, and commands time out. Syno Governor gives the device a budget, puts heavy commands from every session into a single queue, and keeps each task small enough for the device to finish.

The CLI is `gov` in Bash. If it is not found, use `node "${CLAUDE_PLUGIN_ROOT}/scripts/governor/gov.js"`.

## 1. The owner decides. You propose.

These decisions belong to the device owner, the person in this session:
- the device budget and preset, the queue mode, and any thresholds
- which project's jobs go first (priorities)
- queue order: moving, pausing or cancelling a job, including another session's job
- how a task is broken down, how big the chunks are, and the quality-control gate for each chunk
- running a heavy job while the device is busy, and what to do about pending governor decisions

For each one, show the facts in a few lines and ask with AskUserQuestion. Put your recommended option first, labelled "(Recommended)". Then run the matching `gov` command. Claude Code shows the owner a permission prompt before any `gov` command that changes state, so tell them to expect it. Never answer a governor decision yourself. Never go above a limit the owner chose. Never edit files under `~/.claude/workload-governor/` directly (Syno Governor keeps the Workload Governor's state folder, so the owner's budget carries over).

## 2. Before heavy work

Run `gov status`. It is cheap and shows the budget, live load, the Claude sessions running on this device, the queue and any decisions waiting for the owner. For the full list of sessions, run `gov sessions`. Never search the computer for sessions yourself.
- If the budget says PROPOSAL, tell the owner once and suggest `/syno:governor setup`. You may continue meanwhile; the proposal applies.
- If decisions are pending, ask the owner about them before you start anything heavy.

## 3. Running heavy and medium commands

Use this form:

```
gov run --label "<short what>" -- '<command>'
```

- Always set `run_in_background: true`. Time spent in the queue plus the run itself can exceed the Bash timeout. You are notified when it ends.
- Wrap the whole command in single quotes, including any `cd x &&` part, so it all runs inside the queue.
- Use worker counts within the budget. Run `gov advise` for the numbers and examples. The flags for each tool are in `references/runner-flags.md`.
- Prefer targeted runs: the spec or test files for what changed, rather than the full suite. Run full suites only when the owner's QC level calls for it.
- A session has at most one heavy job queued or running at a time. While it waits, do light work such as reading, editing or planning. Never start a second heavy command to get around the queue.
- Never use watch or UI modes (`--watch`, `--ui`) in agent runs.
- Exit codes: 130 means the owner cancelled the job and it did not run. 75 means it waited past the owner's maximum and did not run. In both cases tell the owner and ask before you retry. Any other code is the command's own result.

When the PreToolUse hook blocks a heavy command:
- **Queue mode** denies the command and gives you the exact `gov run ...` line. Run that line in the background.
- **Ask mode** shows the owner a "device busy" prompt. If they deny it, queue the command with `gov run` instead. Do not retry it directly.

## 4. Size every run to the device

Each verification run should finish within the owner's chunk target, which is `chunk.targetMinutes` (shown by `gov status` and `gov advise`).
- If `gov advise` shows a median duration above the target, or the run was stopped or timed out before, propose splitting it with `--shard=i/N` or by folder or file. Each part runs as its own `gov run`, one after another. Ask the owner before you split.
- On a hot device (the brief shows high °C or throttling), suggest fewer workers. The owner decides.

## 5. Break big tasks into small chunks

Propose a breakdown before you start when any of these is true:
- the task touches more files than `chunk.maxFilesPerChunk`
- the task needs more than one heavy verification run
- verifying it would take longer than the chunk target
- the owner asks (`/syno:governor breakdown`)

Each chunk has:
- **Goal**: one sentence.
- **Files**: the files it touches, no more than the file limit.
- **Verify**: a command sized per section 4, with its load class and an estimate in minutes.
- **QC gate**: the owner's default unless the chunk is risky. If you propose something stricter, give the reason in one line.
- **Done when**: a pass/fail condition.

Order the chunks so the project still builds and runs after each one. Keep e2e and full builds at milestones (every `qc.milestoneEvery` chunks) unless the QC level is strict.

Show the plan as a compact table with no more than 12 rows. For anything larger, group the work into phases and detail only phase 1. Then ask with AskUserQuestion: approve, smaller chunks, bigger chunks, or change the QC gates. Start chunk 1 only after the owner approves.

## 6. Executing chunks

- Track the chunks in the session task list. Work one chunk at a time.
- After each chunk, run its QC gate and report: `✅ Chunk i/N: <result> (<verify command>, <duration>)`.
- QC levels:
  - **targeted**: affected tests plus typecheck or lint of the changed files.
  - **standard**: targeted, plus the full unit suite at milestones.
  - **strict**: targeted, plus full suites including e2e at every chunk.
  - **manual**: stop for the owner's review after every chunk.
- Stop and ask the owner when any of these happens:
  - a gate fails twice; do not keep looping, since that burns CPU
  - a chunk grows beyond its plan
  - you reach a review point the owner chose
  - the next step would be heavier than the plan said

## 7. Commands the owner can use

- `/syno:governor setup`: confirm the budget, mode, QC level and chunk size.
- `/syno:governor status`: see the device, the queue and pending decisions.
- `/syno:governor queue`: reorder, pause or cancel jobs.
- `/syno:governor priorities`: choose which projects go first.
- `/syno:governor breakdown <task>`: plan device-sized chunks for a task.
- `/syno:governor decide`: answer pending governor decisions.
