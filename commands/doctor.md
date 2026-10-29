---
description: Syno doctor — find broken records, duplicate IDs, stale checks and missing .gitignore lines, and fix the safe ones after a yes
argument-hint: ""
---

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/syno.js" doctor` and explain each problem in one plain line. If it lists fixes, ask with AskUserQuestion: "Apply these fixes?" Options: "Apply them (Recommended)" and "Not now". Only on yes, run it again with `--confirm`. Broken records are fixed by hand; point to each file.
