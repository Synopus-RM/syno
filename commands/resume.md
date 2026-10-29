---
description: Syno Pause — list paused sessions and carry one on, with a warning if the branch or files changed
argument-hint: "[session file]"
---

Follow the **pause** skill (`${CLAUDE_PLUGIN_ROOT}/skills/pause/SKILL.md`), Resume steps, for: $ARGUMENTS

Start with `node "${CLAUDE_PLUGIN_ROOT}/scripts/syno.js" resume list`. Record the resume only after the owner goes ahead: ask with AskUserQuestion, and pass `--confirm` only on a yes.
