---
description: Syno Audit — a read-only, evidence-backed audit of the codebase (workflow bugs and errors, screens, logic, build), recorded as a report anyone can read
argument-hint: "[status | report]"
---

Follow the **audit** skill (`${CLAUDE_PLUGIN_ROOT}/skills/audit/SKILL.md`). The audit only reads the project; the one thing it writes is Syno's own record under `.syno/`.

- **status**: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/syno.js" audit status` and relay the verdict and summary.
- **report**: run it with `report` to preview, ask with AskUserQuestion "Save the audit report again?" (options "Save it (Recommended)" and "Not now"), and only on yes add `--confirm`.
- With nothing else, run the full audit in the skill. Before installing anything, starting a dev server or calling a live service, ask first, as the skill says.
