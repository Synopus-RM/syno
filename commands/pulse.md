---
description: Syno Pulse — report this project to the Synopus PM panel as titles and counts. Subcommands: enable, disable, join, leave, status, migrate
argument-hint: "enable [display name] | disable | join | leave | status | migrate"
---

The CLI is `node "${CLAUDE_PLUGIN_ROOT}/scripts/syno.js"`, written `syno` below. The first word of $ARGUMENTS picks the subcommand; with none, do **status**. The panel only watches: nothing it does reaches a session.

## status

Run `syno pulse status` and relay it in 3 or 4 lines: is the project enabled, has this machine joined (or was its key revoked), and how many events are waiting to send.

## enable

Only when the owner asked for this project to report to the Synopus panel.
1. Run `syno pulse enable` (add `--name "<display name>"` if given). Show what it would write: `.syno/pulse.json` and the project's `.claude/settings.json`.
2. Ask with AskUserQuestion: "Report this project to the Synopus PM panel?" Options: "Enable Pulse" and "Not now". Recommend neither: this shares data, so it's the owner's call.
3. Only on "Enable Pulse", run `syno pulse enable --confirm`. Remind them to commit both files, and that each person's machine also has to join. There is no approval step.

## join

This is consent under the DPDP Act, so the person must agree themselves.
1. Run `syno pulse notice` and show the notice exactly as printed.
2. Ask with AskUserQuestion whether they accept it. Options: "Accept and join" and "Don't join". Do not pre-select or recommend either.
3. Only on "Accept and join", run `syno pulse join --accept`. It uses `git config user.name` and `user.email`; pass `--name` or `--email` only if the person gives different ones.
4. Relay the result in one or two lines.

If it says there's no team enrolment key, give the printed `set-key` command in its own `bash` code block for them to run in their own terminal, and tell them to get the key from the project manager. Never ask for the key in the chat, and never run `set-key` yourself.

## leave

1. Explain in one line: leaving revokes this machine on the panel and deletes Pulse's secret, queue and cached status here.
2. Ask: "Leave Syno Pulse on this machine?" Options: "Leave" and "Stay". Run `syno pulse leave --confirm` only on "Leave".

## disable

Run `syno pulse disable` to preview, ask "Stop reporting this project?" (options "Stop reporting" and "Keep reporting"), and run it with `--confirm` only on yes. Remind them to commit the change.

## migrate

For a project Synopus Insider was reporting.
1. Run `syno pulse migrate` and show what moves: the project marker (same project key, so the panel keeps its history), the project settings, and this machine's team key.
2. Ask: "Move this project from Synopus Insider to Syno Pulse?" Options: "Move it (Recommended)" and "Not now". Run `syno pulse migrate --confirm` only on yes.
3. Then offer **join**, because the notice changed and each person agrees again.
