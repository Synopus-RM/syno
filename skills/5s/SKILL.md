---
name: 5s
description: Syno 5S. Keeps the project and its files tidy with the five steps of 5S (Sort, Set in Order, Shine, Standardize, Sustain), working on the project folder only and moving anything it removes to a restorable trash. Use when the user asks to tidy, clean up or organise the project or its files, or for its 5S score.
---

# Syno 5S

**DMAIC steps: Improve (Sort, Set in Order, Shine) and Control (Standardize, Sustain).** 5S keeps the project's files sorted, in place, clean, consistent, and that way over time.

The CLI is `node "${CLAUDE_PLUGIN_ROOT}/scripts/syno.js"`, written `syno` below. Every command previews first; nothing changes until the owner says yes and you pass `--confirm`.

## Rules

- Project folder only. Never `.git`, ignored folders, or anything outside the project.
- **Nothing is hard-deleted.** Every move or removal goes to `.syno/trash/<id>/` with a manifest. `syno 5s restore <id>` puts files back exactly. Never empty the trash; the owner deletes a trash folder themselves when sure.
- Branches are only listed. Never delete one.

## The five steps

1. **Sort** — `syno 5s sort`. Show the findings. Ask with AskUserQuestion (multiSelect) which to move to the trash: the ticked ones (files named as copies, temp files, empty folders) are the recommended picks; other same-bytes files, probably-unused files and large files are only picked if the owner chooses them, because something may use them by name. Run `syno 5s sort --items <ids> --confirm` only after the yes.
2. **Set in Order** — `syno 5s set`. Needs standards (step 4). Show each move with its reason and every import change it needs, then ask "Make these moves?" Options: "Make them (Recommended)" and "Not now". Only on yes, pass `--confirm`.
3. **Shine** — `syno 5s shine` lists the project's own formatter, linter and type checker. Ask before running them. Only on yes, run `syno 5s shine --confirm` with `run_in_background: true`: each check waits in Syno Governor's queue. Report the error counts.
4. **Standardize** — `syno 5s standardize` proposes `.syno/5s/standards.json` from what the project already does most (naming, a 300-line limit, required files). Ask before saving it. Once it exists, the same command checks the project against it. Follow it whenever you create files.
5. **Sustain** — `syno 5s` (or `syno 5s sustain`) scores each step from 0 to 100 and shows the trend. Ask "Save this 5S check and its report?" Only on yes, pass `--confirm`. The brief reminds the owner when the last check is more than 7 days old.

`/syno:5s` with no step runs Sustain first, then offers the steps with the lowest scores, one at a time.
