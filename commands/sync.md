---
description: Turn version tags made with plain git into release records, then re-render the docs (Syno Chronicle)
---

The CLI is `node "${CLAUDE_PLUGIN_ROOT}/scripts/syno.js"`, written `syno` below. Sync only reads git; it never fetches, pulls or changes history.

1. Run `syno sync` (dry run). If it says there are no new version tags, say so in one line and stop.
2. Show each proposed release in one line: version, tag, date and how many changes, with the change types (added, fixed, changed). Point out any commit that's marked as possibly breaking.
3. Ask with AskUserQuestion: "Record these releases?" Options: "Record them (Recommended)" and "Not now". Run `syno sync --confirm` only on yes.

Tags that don't look like versions (for example `release-candidate`) are skipped. If the project names its tags differently (`release-1.2`, `app@1.2.0`), the owner can change `chronicle.tagPattern` in `.syno/config.json`.
