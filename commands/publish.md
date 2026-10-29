---
description: Record where a release went (npm, Play Store, website, ...), with its status, date and link (Syno Chronicle)
argument-hint: "<version> <channel> <planned|published|yanked> [https://link]"
---

The CLI is `node "${CLAUDE_PLUGIN_ROOT}/scripts/syno.js"`, written `syno` below. Recording a publish only writes Syno's record; it never publishes anything.

1. From $ARGUMENTS (or what was just published), work out the version, the channel (for example GitHub Release, npm, PyPI, Play Store, App Store, Microsoft Store, Docker image, web deploy, desktop download, or a custom name), the status and the link. Ask with AskUserQuestion for anything missing.
2. Run `syno publish <version> "<channel>" <status> [url]` (dry run) and show the row it adds: version, channel, status, date, link.
3. Ask: "Record this?" Options: "Record (Recommended)" and "Skip". Run with `--confirm` only on yes. Add `--date YYYY-MM-DD` if it happened on another day.

Links must start with http:// or https://; anything else is refused.
