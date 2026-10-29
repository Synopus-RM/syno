---
description: Set up Syno Chronicle in this project, a new one or one with years of history, and write its record after you approve
argument-hint: "[project name]"
---

The CLI is `node "${CLAUDE_PLUGIN_ROOT}/scripts/syno.js"`, written `syno` below. Run it from the project folder. Syno writes nothing until you pass `--confirm`, and only after the owner says yes.

1. Run `syno init` (add `--name "<name>"` if the owner gave one in $ARGUMENTS). This is a dry run.
2. If it says Syno is already set up, say so in one line and stop.
3. Tell the owner, in 3 to 6 plain lines: is this a new project or one with history, how many releases and changes Syno found, what happens to an existing CHANGELOG.md (the text before the first version stays exactly as it is), and that the record goes in `.syno/`, `CHANGELOG.md` and `docs/syno/`. Don't paste the whole file list unless they ask.
4. If the output lists possible ideas from ROADMAP, IDEAS or BACKLOG files, ask which to import with AskUserQuestion (multiSelect; for more than 4, offer "All of them", "None" and "I'll list the numbers").
5. Ask with AskUserQuestion: "Write Syno's record for this project?" Options: "Write it (Recommended)" and "Not now".
6. Only on "Write it", run `syno init --confirm`, adding `--ideas all` or `--ideas 1,3` for the ideas they picked, and `--all` if they asked for every tag rather than the last 50.
7. Then run `syno ignore`. If lines are missing, ask: "Keep Syno's local files (sessions, reports, trash) out of git?" Options: "Add the .gitignore lines (Recommended)" and "Leave .gitignore alone". Run `syno ignore --confirm` only on yes.
8. Then ask, as its own question: "Report this project to the Synopus PM panel with Syno Pulse?" Options: "Not now" and "Set up Pulse". Recommend neither: this shares data, so it is the owner's call. On "Set up Pulse", follow /syno:pulse.
9. Finish with two lines: the record's front page is `docs/syno/README.md` (or `docs/syno/html/README.html` in a browser), and they should commit `.syno/`, `CHANGELOG.md` and `docs/syno/`.

Never run this unless the owner asked to set Syno up here.
