---
description: Syno migrate — move from Synopus Insider, Workload Governor, akmo-app-sync and the old skills to Syno, then show the exact steps to retire them
argument-hint: ""
---

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/syno.js" migrate` and explain, in plain lines, what was found and what would move. Nothing moves yet.
2. If it says the self-test hasn't passed, offer to run `node "${CLAUDE_PLUGIN_ROOT}/test/selftest.js"` (through Syno Governor, in the background) and stop until it passes.
3. Ask with AskUserQuestion: "Move the Insider settings to Syno Pulse?" Options: "Move them (Recommended)" and "Not now". Only on yes, run it again with `--confirm`.
4. Show the uninstall steps as a numbered list for the owner to do themselves. Syno never uninstalls anything, and skills synced from claude.ai are removed in claude.ai's settings.
