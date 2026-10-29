---
name: pulse
description: Syno Pulse reports a project's progress, quality and effort to the Synopus PM panel as titles and counts. Use it when Pulse is active in a project to report milestones, progress against the plan, and blockers with the report_update tool; and when someone asks to enable, join, leave or check Syno Pulse, or to move a project from Synopus Insider.
---

# Syno Pulse

**DMAIC step: Measure.** Pulse is how the Synopus PM sees every project's status, quality and effort in one place. The panel only watches: nothing it does can change what happens in a session.

## When Pulse is active

The session brief says so ("Syno Pulse is active in this project"). Then use the `report_update` tool (server `syno-pulse`):

| When | type | What to send |
| --- | --- | --- |
| A task from the plan is finished | `milestone` | One-line title, e.g. "Invoice export done", and a short detail if useful |
| You can count progress against the plan or PRD | `progress` | `done` and `total` |
| You're blocked, or waiting on someone | `blocker` | One-line title; keep the `blockerId` it returns |
| The blocker is cleared | `blocker_resolved` | The `blockerId` |

Report what changed for the project, in plain words a client would understand. **Never** put code, secrets, prompts, file paths or file contents in a report. Anything that looks like a key or password is redacted before it is queued, but don't rely on that.

The other Syno functions send their own results (releases, tasks, audit, tests, quality, 5S, compliance, security) when they finish. You don't need to report those again.

## Setting it up

Everything goes through /syno:pulse, and every step is the person's own choice:
- **enable** marks the project (`.syno/pulse.json`, committed so teammates and cloud sessions follow).
- **join** is consent under the DPDP Act. Show the notice exactly as printed and recommend neither answer.
- **leave** withdraws consent on this machine and deletes Pulse's local data.
- **migrate** moves a project from Synopus Insider, keeping its project key.

Never ask for the team enrolment key in the chat: the person types it into their own terminal with `set-key`.

## Control step

Events wait in a local queue and are sent in the background, so a session never waits on the network. If the panel can't take something yet, it waits up to 7 days. If this machine's key is revoked, Pulse stops and says so once.
