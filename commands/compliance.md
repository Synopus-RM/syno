---
description: Syno Compliance — check the idea, PRD or a release against the laws of every place the product serves (India always); a Critical gap blocks a release
argument-hint: "[idea | prd | release | status]"
---

Follow the **compliance** skill (`${CLAUDE_PLUGIN_ROOT}/skills/compliance/SKILL.md`) for: $ARGUMENTS

- **status** (or nothing): run `node "${CLAUDE_PLUGIN_ROOT}/scripts/syno.js" compliance status` and relay it, including "Compliance check out of date" if it says so.
- **idea | prd | release**: run that check. Ask with AskUserQuestion before recording it or changing the places, and pass `--confirm` only on a yes.
