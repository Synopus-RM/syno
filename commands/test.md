---
description: Syno Test — turn a finished change into a plain-language test guide with Pass and Fail buttons, then record what the tester saw
argument-hint: "[status | record]"
---

Follow the **test** skill (`${CLAUDE_PLUGIN_ROOT}/skills/test/SKILL.md`).

- **status**: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/syno.js" test status` and relay it in one line.
- **record**: read the answers from the guide's page, save them in your scratchpad, run `syno test record --guide … --answers …` (with `--task <id>` if the change belongs to a task), show the preview, and ask with AskUserQuestion: "Record these test results?" Options: "Record them (Recommended)" and "Not now". Only on yes, run it again with `--confirm`.
- With nothing else, write and publish a new guide for the change just finished, as the skill describes.
