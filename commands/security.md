---
description: Syno Security — abuse cases, a read-only code review, secrets and dependency scans, and localhost-only attack tests; Critical or High findings block done and release
argument-hint: "[design | review | scan | deps | attack | status]"
---

Follow the **security** skill (`${CLAUDE_PLUGIN_ROOT}/skills/security/SKILL.md`) for: $ARGUMENTS

- **status** (or nothing): run `node "${CLAUDE_PLUGIN_ROOT}/scripts/syno.js" security status` and relay it.
- Every other step previews first. Ask with AskUserQuestion before recording anything or running a tool or an attack test, and pass `--confirm` only on a yes.
