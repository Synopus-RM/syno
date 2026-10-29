---
description: Syno Progress — an at-a-glance progress report anyone can read, with a verdict first, phase bars, what is done and left, and what only the owner can do
argument-hint: "[status]"
---

Follow the **progress** skill (`${CLAUDE_PLUGIN_ROOT}/skills/progress/SKILL.md`).

With `status` in $ARGUMENTS and an existing `.syno/local/progress/report.json`, just run `node "${CLAUDE_PLUGIN_ROOT}/scripts/syno.js" progress status` and relay the verdict and summary.

Otherwise run the full workflow: collect the facts, classify the work honestly, write report.json, then preview with `node "${CLAUDE_PLUGIN_ROOT}/scripts/syno.js" progress render`. Ask with AskUserQuestion: "Save the progress report?" Options: "Save it (Recommended)" and "Not now". Run it again with `--confirm` only on yes, and link `.syno/reports/progress/latest.html`.
