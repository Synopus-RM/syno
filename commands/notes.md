---
description: Print copy-ready release notes for a version, to paste into a GitHub or GitLab release (writes nothing)
argument-hint: "<version>"
---

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/syno.js" notes <version>` with the version from $ARGUMENTS (the latest release if none is given; `syno release plan --json` shows it as `current`).

Show the output inside a ```markdown code block so it can be copied as it is. Add one line saying it's ready to paste. This writes no file and makes no network call.
