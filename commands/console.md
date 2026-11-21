---
description: Syno Console — run this project as a tree of cloud sessions (Console → phase → milestone → task), with checked merges up and one place for the owner's questions
argument-hint: "[start | phase <id> <name> | status | install]"
---

Follow the **console** skill (`${CLAUDE_PLUGIN_ROOT}/skills/console/SKILL.md`), section "If you are Syno Console", and its `references/console-duties.md`, for: $ARGUMENTS

Run the skill's script through the Syno CLI: `node "${CLAUDE_PLUGIN_ROOT}/scripts/syno.js" console <subcommand>`. Every write previews first. Ask with AskUserQuestion, recommended option first, and pass `--confirm` only on a yes.

- **start:** ask which branch collects the phases, and who asks the owner questions (`askAt`).
  1. Preview `syno console start --branch <branch> --session <this session's ID>`.
  2. Ask, and pass `--confirm` only on a yes.
  3. Name this session with `set_session_title`.
- **phase `<id>` `<name>`:** the owner asked for it, which counts as the yes for the phase's records.
  1. `syno console spawn <id> --name "<name>"`.
  2. `create_session` with exactly the printed parameters.
  3. `syno console record <id> --status running --session <new ID> --confirm`.
  4. Commit and push.
- **status:**
  1. Read live states with `list_sessions` (children) or `get_session`.
  2. Save them as JSON, then run `syno console tree --live <file>`.
  3. Show the tree, opening with its verdict.
- **install:** puts the cloud copy into this project, so cloud sessions get the skill and its guard.
  1. Preview `syno console install`.
  2. Ask, and pass `--confirm` only on a yes.
  3. `syno console install --check` reports a stale or edited copy.

With no argument, show the status and offer the next step.
