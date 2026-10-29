---
description: Syno Sigma — measure quality with Six Sigma (DPMO, sigma level, first-pass yield) and see the gates
argument-hint: "[status | measure | gate | override]"
---

Follow the **sigma** skill (`${CLAUDE_PLUGIN_ROOT}/skills/sigma/SKILL.md`).

- **status** (or nothing): run `node "${CLAUDE_PLUGIN_ROOT}/scripts/syno.js" sigma status` and relay the verdict and summary.
- **measure**: run `syno sigma measure`, show the result, and ask with AskUserQuestion: "Save this measurement and its report?" Options: "Save it (Recommended)" and "Not now". Only on yes, run it again with `--confirm`.
- **gate**: run `syno sigma gate --task <id>` or `syno sigma gate --release` and relay each failing item.
- **override**: follow the skill's Override steps. Ask with AskUserQuestion first, and pass `--confirm` only after the owner says yes and gives the reason.
