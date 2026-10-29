---
description: Show how the project's folders changed since the last release, and optionally save a snapshot (Syno Chronicle)
---

The CLI is `node "${CLAUDE_PLUGIN_ROOT}/scripts/syno.js"`, written `syno` below.

1. Run `syno structure` (dry run). It counts files and sizes per folder now (with git, the last commit's tracked files) and compares them with the last release.
2. Tell the owner in a few plain lines: how many files and folders there are now, and what changed since the last release (folders added, removed or renamed, and which top-level folders grew or shrank). If nothing changed, say "No structure changes since <release>."
3. Ask with AskUserQuestion: "Save this snapshot to the project record?" Options: "Just show it (Recommended)" and "Save it". Run `syno structure --confirm` only on "Save it".

Releases take their own snapshot automatically, so saving one here is only for a check-point between releases.
