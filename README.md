# Syno

**Every Synopus project tool in one Claude Code plugin, measured for quality the same way and reported in plain English.**

> Status: v0.1.0 is being built. This page grows as each function lands. The full specification is [PRD.md](PRD.md).

## Install

```bash
claude plugin marketplace add rishimurugan-synopus/syno
claude plugin install syno@synopus
```

To try a local copy without installing: `claude --plugin-dir ./syno`.

## What's inside

| Function | What it does for you | Command |
| --- | --- | --- |
| Syno Chronicle | Keeps a readable record of ideas, changes, releases and where they shipped | `/syno:init`, `/syno:release` |
| Syno Pulse | Sends titles and counts to the Synopus PM panel, after you consent | `/syno:pulse` |
| Syno Progress | Shows how far the project has come, phase by phase | `/syno:progress` |
| Syno Tasks | Breaks the work into tasks and tracks each one to done | `/syno:tasks` |
| Syno Audit | Finds bugs and errors without changing code | `/syno:audit` |
| Syno Devices | Keeps desktop and mobile apps matched to the web app | `/syno:devices` |
| Syno Test | Writes a test guide anyone can follow | `/syno:test` |
| Syno Parallel | Finishes the remaining work with several agents at once | `/syno:parallel` |
| Syno Plan | Brainstorms an idea and writes the PRD | `/syno:plan` |
| Syno Prompt | Writes better prompts for AI tools | `/syno:prompt` |
| Syno Governor | Keeps heavy work within what this computer can handle | `/syno:governor` |
| Syno Pause | Saves where a session stopped, and picks it up later | `/syno:pause`, `/syno:resume` |
| Syno Sigma | Measures quality and stops work that isn't ready | `/syno:sigma` |
| Syno 5S | Keeps the project's files sorted, clean and consistent | `/syno:5s` |
| Syno Compliance | Checks the idea and PRD against the laws that apply | `/syno:compliance` |
| Syno Security | Designs out misuse and checks the code for weaknesses | `/syno:security` |

## The rules Syno follows

- **You decide.** Syno proposes; nothing is written, moved, built or pushed without your yes.
- **Nothing leaves your machine** except Syno Pulse's titles and counts, and only after you join and consent.
- **Nothing is hard-deleted.** Clean-ups go to a restorable trash.
- **Every report opens with a verdict** a non-technical reader understands in one read.

## Licence

MIT, copyright Synopus. Syno Prompt is built from prompt-master by Nidhin Joseph Nelson; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
