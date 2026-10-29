---
name: pause
description: Syno Pause. Saves where a session stopped (goal, done, next steps, owner decisions, branch, uncommitted files, tests and queued jobs) so any later session can carry on, and resumes a paused session. Use only when the user asks to pause, stop for now, hand over, or resume.
---

# Syno Pause

**DMAIC step: Control.** A paused session keeps the work's state, so nothing is redone or lost between sessions.

The CLI is `node "${CLAUDE_PLUGIN_ROOT}/scripts/syno.js"`, written `syno` below. Pause runs only when asked. Nothing is written at session end on its own, and nothing goes to Pulse.

## Pause

1. From this conversation, write a JSON file in your scratchpad with: `title` (a few words), `goal`, `note` (the user's note, if they gave one), `done`, `inProgress`, `next` (in order, each one a step someone could start on), `decisions` (only the ones the owner must make) and `files` (the key files touched). Plain words, short lines. Never put secrets, keys or passwords in it; Syno redacts anything that looks like one, but don't rely on that.
2. Run `syno pause --file <that file>` and show the preview.
3. Ask with AskUserQuestion: "Save this pause?" Options: "Save it (Recommended)" and "Not now". Only on yes, run it again with `--confirm`.
4. Give the owner the one line to paste to resume.

## Resume

1. Run `syno resume list`. With more than one, ask which with AskUserQuestion, newest first (Recommended).
2. Run `syno resume <file>`. If it starts with a warning (another branch, or files changed since the pause), show the warning first and ask before any next step.
3. Summarise in 5 lines: the goal, what is done, what is in progress, the decisions waiting for the owner, and the first next step. Propose that first step.
4. Once the owner goes ahead, run it again with `--confirm` to record that it was resumed.
