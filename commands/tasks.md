---
description: Syno Tasks — break the work into phases and tasks with acceptance criteria, and keep a living board, forecast and report anyone can read
argument-hint: "[status | check | set <id> <status> | tick <id> <n|all>]"
---

The CLI is `node "${CLAUDE_PLUGIN_ROOT}/scripts/syno.js"`, written `syno` below. Follow the **tasks** skill (`${CLAUDE_PLUGIN_ROOT}/skills/tasks/SKILL.md`).

- **status**: run `syno tasks status` and relay the verdict and summary.
- **check**: run `syno tasks check` and explain each warning in plain words.
- **set** / **tick**: run the command from $ARGUMENTS without `--confirm`, show the change, and ask with AskUserQuestion: "Make this change?" Options: "Make it (Recommended)" and "Not now". Run it with `--confirm` only on yes. If the done gate refuses, show its reasons and offer to fix them.
- With nothing else, run the full workflow in the skill: collect facts, build or update `.syno/tasks/breakdown.json`, check, then save the board and report after the owner's yes.
