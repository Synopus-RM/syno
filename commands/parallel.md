---
description: Syno Parallel — finish every remaining item at once with parallel agents, sized to this device and checked by the done gate
argument-hint: "[what to finish, or nothing for everything pending]"
---

Follow the **parallel** skill (`${CLAUDE_PLUGIN_ROOT}/skills/parallel/SKILL.md`).

- Build the ledger from Syno Tasks when `.syno/tasks/breakdown.json` exists: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/syno.js" tasks status` and take its open tasks.
- Run `gov advise` before launching, and never run more agents with builds or tests at once than it allows.
- Before you call a piece done, ask with AskUserQuestion: "Mark <task> done?" Options: "Mark it done (Recommended)" and "Not yet". Only on yes, run `syno tasks set <id> done --confirm`. If the done gate refuses, report the piece as not done, with the reasons.
