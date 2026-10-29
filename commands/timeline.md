---
description: Show the project's recent events, newest first: ideas, releases, publishes and folder changes (Syno Chronicle, writes nothing)
argument-hint: "[how many, default 20]"
---

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/syno.js" timeline --limit <n>` (n from $ARGUMENTS, default 20).

Show it as a two-column table, Date and What happened, newest first. Add one line pointing to `docs/syno/TIMELINE.md` (or `docs/syno/html/TIMELINE.html` in a browser) for the full history with the 12-month release chart. This writes nothing.
