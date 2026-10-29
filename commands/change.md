---
description: Record a finished change that isn't released yet; it shows under [Unreleased] in CHANGELOG.md at once (Syno Chronicle)
argument-hint: "<what changed, in one line>"
---

The CLI is `node "${CLAUDE_PLUGIN_ROOT}/scripts/syno.js"`, written `syno` below.

1. Turn $ARGUMENTS (or the work just finished) into one plain line of at most 200 characters that a client would understand: what changed for the user, not how the code changed.
2. Pick the type: Added (something new), Changed (works differently), Deprecated (will be removed later), Removed, Fixed (a bug), Security (a security fix). If it isn't obvious, ask with AskUserQuestion and put your best guess first, marked "(Recommended)".
3. If it could break something people rely on, add `--breaking`. If it delivers an idea, add `--ideas IDEA-0001`.
4. Run `syno change add <summary> --type <Type>` with those flags (dry run) and show the line as it will appear: "<Type>: <summary>".
5. Ask: "Record this change?" Options: "Record (Recommended)", "Edit" and "Skip". Run with `--confirm` only on Record.

At most one suggestion per finished task. Nothing is written without a yes.
