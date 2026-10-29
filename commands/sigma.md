---
description: Syno Sigma — measure quality with Six Sigma (DPMO, sigma level, first-pass yield) and see the gates
argument-hint: "[status | measure]"
---

Follow the **sigma** skill (`${CLAUDE_PLUGIN_ROOT}/skills/sigma/SKILL.md`).

- **status** (or nothing): run `node "${CLAUDE_PLUGIN_ROOT}/scripts/syno.js" sigma status` and relay the verdict and summary.
- **measure**: run `syno sigma measure`, show the result, and ask with AskUserQuestion: "Save this measurement and its report?" Options: "Save it (Recommended)" and "Not now". Only on yes, run it again with `--confirm`.
