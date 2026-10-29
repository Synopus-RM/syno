---
description: Capture an idea, move an idea to a new status, or list ideas (Syno Chronicle)
argument-hint: "<idea in one line> | set IDEA-0001 <status> | list"
---

The CLI is `node "${CLAUDE_PLUGIN_ROOT}/scripts/syno.js"`, written `syno` below.

**List** (`$ARGUMENTS` is `list`): run `syno idea list` and show it as a short table grouped by status.

**New idea** (any other text): it becomes one line of at most 120 characters.
1. Run `syno idea add <text>` (dry run) and show: "New idea IDEA-000N: <title>".
2. Ask with AskUserQuestion: "Record this idea?" Options: "Record (Recommended)", "Edit the wording" and "Skip".
3. On Record, run it again with `--confirm`. On Edit, take their words and go back to step 1.

**Status change** (`set IDEA-0001 <status>`): statuses are proposed, accepted, planned, in-progress, parked and rejected. Only a release marks an idea shipped.
1. Run `syno idea set <id> <status>` (dry run) and show "Old status → new status".
2. Ask: "Move <id> to <status>?" Options: "Move it (Recommended)" and "Leave it". Run with `--confirm` only on yes.
3. When an idea moves to accepted, offer /syno:plan to brainstorm it and check its compliance and security before any build.

If the command refuses a move, explain the allowed next steps in one line.
