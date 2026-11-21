# Syno

**Every Synopus project tool in one Claude Code plugin, measured for quality the same way and reported in plain English.**

Syno keeps a project's record, plans and tasks, checks its quality, law and security, keeps its files tidy, and tells the Synopus PM panel how it is going. Six Sigma (measure, then control) and 5S (sort, then keep it tidy) shape every part. The full specification is [PRD.md](PRD.md).

## Install

```bash
claude plugin marketplace add Synopus-RM/syno
claude plugin install syno@synopus
```

To try a local copy without installing: `claude --plugin-dir ./syno`.

**Needs:** Node.js 18 or later and git. Syno Devices and Syno Test also need Python 3.9 or later. It works on Linux, macOS and Windows, with no npm packages and no build step.

## Your first five minutes

1. Open a project in Claude Code and run `/syno:init`. Syno reads the history, shows what it found, and writes its record only after you say yes.
2. Run `/syno:status`. It opens with one verdict (green, amber or red) and lists what to do next.
3. Planning something new? Run `/syno:plan`. It asks questions in batches, checks the law and misuse first, then writes the PRD.
4. Finished a piece of work? Syno offers one changelog entry. `/syno:release` cuts a release once the quality gate passes.

## What's inside

| Function | What it does for you | Command |
| --- | --- | --- |
| Syno Chronicle | Keeps a readable record of ideas, changes, releases and where they shipped | `/syno:init`, `/syno:release` |
| Syno Pulse | Sends titles and counts to the Synopus PM panel, after you consent | `/syno:pulse` |
| Syno Progress | Shows how far the project has come, phase by phase | `/syno:progress` |
| Syno Tasks | Breaks the work into tasks and tracks each one to done | `/syno:tasks` |
| Syno Audit | Finds bugs and errors without changing code | `/syno:audit` |
| Syno Devices | Keeps desktop and mobile apps matched to the web app | `/syno:devices` |
| Syno Test | Writes a test guide anyone can follow, with Pass and Fail buttons | `/syno:test` |
| Syno Parallel | Finishes the remaining work with several agents at once | `/syno:parallel` |
| Syno Console | Runs a big project as a tree of cloud sessions (phases, milestones, tasks) that hand work up through checked merges, with one place for your questions. `/syno:console install` gives a project's cloud sessions the same rules | `/syno:console` |
| Syno Plan | Brainstorms an idea and writes the PRD | `/syno:plan` |
| Syno Prompt | Writes better prompts for AI tools | `/syno:prompt` |
| Syno Governor | Keeps heavy work within what this computer can handle | `/syno:governor` |
| Syno Pause | Saves where a session stopped, and picks it up later | `/syno:pause`, `/syno:resume` |
| Syno Sigma | Measures quality and stops work that isn't ready | `/syno:sigma` |
| Syno 5S | Keeps the project's files sorted, clean and consistent | `/syno:5s` |
| Syno Compliance | Checks the idea, PRD and each release against the laws that apply (India always) | `/syno:compliance` |
| Syno Security | Designs out misuse and checks the code for weaknesses | `/syno:security` |

`/syno:status` shows everything on one screen, and `/syno:doctor` checks Syno's own records.

## How quality works

- **Measured the same way everywhere.** Each acceptance criterion, test run, test guide step, audit, security and compliance check is a check. A failure is a problem. Syno Sigma turns them into a sigma level (target 4σ) and shows where problems come from.
- **Gates.** A task isn't done until its acceptance criteria are met, its tests pass and no Critical audit or Critical/High security finding is open. A release also needs no Critical compliance gap and a compliance check newer than the last PRD change.
- **Overrides are yours.** You can let work through a failing gate, but only with a written reason. Every override shows in the Sigma report, the release record and on the panel.

## The rules Syno follows

- **You decide.** Syno proposes; nothing is written, moved, built or pushed without your yes.
- **Nothing leaves your machine** except Syno Pulse's titles and counts, and only after you join and consent. Attack tests reach this machine only.
- **Nothing is hard-deleted.** Clean-ups go to a restorable trash in `.syno/trash/`.
- **Heavy work waits its turn.** Builds, tests and audit tools run through Syno Governor's queue, sized to this computer.
- **Every report opens with a verdict** a non-technical reader understands in one read, then a short summary, what you need to do, the detail and a glossary.

## Where things are kept

| Folder | What | In git? |
| --- | --- | --- |
| `.syno/` | The project's record: config, ideas, changes, releases, tasks, sigma, 5S, compliance, abuse cases | Yes |
| `.syno/local/`, `.syno/reports/` | Test runs, audits, security findings, reports | No, this machine only |
| `.syno/sessions/`, `.syno/trash/` | Paused sessions and the restorable trash | No |
| `CHANGELOG.md`, `docs/syno/` | The readable record | Yes |

## Moving from the old plugins

If you used Synopus Insider, Workload Governor, akmo-app-sync or the separate skills (project-progress-report, task-breakdown-progress-report, codebase-audit, easy-test-guide, parallel-finish, prd-brainstorm, prompt-master), run `/syno:migrate`. It moves Insider's settings after a yes, keeps the Governor's state where it is, and prints the exact steps to uninstall the old ones. It shows those steps only after Syno's self-test has passed on your machine.

## Developing Syno

```bash
node test/selftest.js
```

It runs every test, the Governor's own checks and `claude plugin validate`. Add `--perf` for the 10,000-commit scale test.

## Licence

MIT, copyright Synopus. Syno Prompt is built from prompt-master by Nidhin Joseph Nelson; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
