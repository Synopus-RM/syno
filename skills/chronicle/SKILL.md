---
name: chronicle
description: Syno Chronicle keeps a project's readable record of ideas, changes, releases and where they were published. Use it to offer ONE record entry when an idea is mentioned, a feature or fix is finished, a release is about to be cut, or something was just published; and when someone asks to set up the record, cut a release, write release notes, or see what changed or shipped.
---

# Syno Chronicle

**DMAIC step: Control.** Chronicle is the project's memory: what was planned, what changed, what shipped and where. It reads git and never changes it.

The CLI is `node "${CLAUDE_PLUGIN_ROOT}/scripts/syno.js"`, written `syno` below. The commands are /syno:init, /syno:idea, /syno:change, /syno:release, /syno:publish, /syno:notes, /syno:structure, /syno:timeline and /syno:sync.

## The owner decides

Every write previews first. Run the command without `--confirm`, explain the preview in plain words, ask with AskUserQuestion, and run it again with `--confirm` only after a yes. Answering No, or closing the question, writes nothing. Never pass `--confirm` on your own judgement, never pass `--overwrite-edits` without showing the hand edit first, and never push, tag or publish anything outside the commands above.

## When to suggest a record

Suggest at most one entry per finished task, and only when `.syno/config.json` exists in the project:

| Moment | Suggest |
| --- | --- |
| Someone mentions an idea for later | An idea: `syno idea add <one line>` |
| A feature or fix is finished and works | A change: `syno change add <one line> --type <Type>` |
| The owner talks about releasing or shipping | /syno:release |
| Something was just published (store, npm, website) | /syno:publish |
| A version tag was made with plain git | /syno:sync |

Phrase it as one line and a question, for example: *Record this? Fixed: invoice totals round to 2 decimals* — with the answers Record, Edit and Skip. On Skip, write nothing and don't ask again for that task.

## Writing entries people understand

- Say what changed for the person using the product, not how the code changed: "Invoices can be exported to Excel", not "Add xlsx writer to export service".
- One line, under 200 characters for a change, under 120 for an idea. No ticket numbers or file paths in the line.
- Pick the type honestly: Added, Changed, Deprecated, Removed, Fixed or Security. Add `--breaking` when existing users must do something different.

## Reports

The pages in `docs/syno/` (and `docs/syno/html/` for a browser) are Chronicle's reports. They follow Syno's shared look: a verdict first, then a short summary, what to do, the detail and a glossary. They are re-rendered after every write, so don't edit them by hand; Syno notices hand edits and leaves those pages alone.

## Control step

After every confirmed write: the record is in `.syno/`, the docs are re-rendered, and when Syno Pulse is enabled the event is sent to the Synopus panel as titles and counts only. At a release, Syno Sigma's release gate runs first (PRD §4.3).

Record formats, with one example each, are in [references/formats.md](references/formats.md).
