---
description: Plan and cut a release (version, date, quality gate), then optionally bump the manifests and make a local tag (Syno Chronicle)
argument-hint: "[--pre alpha|beta|rc]"
---

The CLI is `node "${CLAUDE_PLUGIN_ROOT}/scripts/syno.js"`, written `syno` below. Syno never pushes, publishes or creates remote releases.

1. Run `syno release plan` (add `--pre <kind>` from $ARGUMENTS if given). Show the owner, in plain words: the proposed version and why, the date, the waiting changes, the ideas it ships, and the quality gate result.
2. Ask with AskUserQuestion: "Release as <version> on <date>?" Options: "<version> on <date> (Recommended)", "Change the version or date". For a 0.x project, mention that 1.0.0 is their choice whenever they're ready.
3. **If the gate failed**, show each reason in one line and ask: "Fix these first, or override?" Options: "Fix first (Recommended)" and "Override with a reason". To override, follow /syno:sigma to record the override, then pass `--override <override-id>`.
4. Run `syno release cut --version <v> --date <YYYY-MM-DD>` (dry run). Summarise the preview: the release file, the change files it embeds and removes, ideas marked shipped, the structure snapshot, the docs it re-renders.
5. Ask: "Cut release <v>?" Options: "Cut it (Recommended)" and "Not yet". Run with `--confirm` only on yes.
6. Then ask, one question at a time:
   - "Bump the version to <v> in the project's manifests?" Run `syno release bump <v>` to list them, ask which (multiSelect), then `syno release bump <v> --files <a,b> --confirm`.
   - "Make a local tag <prefix><v>?" Options: "Make the tag" and "No tag". Run `syno release tag <v> --confirm` on yes, and remind them to push it themselves.
7. Offer /syno:notes <v> for copy-ready release notes.

If there are no waiting changes, the cut is refused; offer `--empty` only if the owner really wants a release with no changes.
