# breakdown.json schema

`render.mjs` reads this file. Only `tree` is required. A complete worked example is in `example-breakdown.json` — copy its shape.

## Top level

| Field | Type | Notes |
|---|---|---|
| `project` | object | `name`, `owner`, `client`, `description`, `startDate`, `targetDate` (YYYY-MM-DD). `targetDate` drives the on-track / at-risk / late verdict. |
| `asOf` | ISO datetime | When the snapshot is true. Defaults to now. Use the owner's timezone offset (e.g. `+05:30`). |
| `headline` | string | One or two sentences: where things stand and the single biggest thing in the way. Shown in the hero. |
| `settings` | object | See below. |
| `team` | array | `{ name, role, hoursPerDay }`. Capacity per person for the forecast. Optional. |
| `milestones` | array | `{ title, date }`. Drawn on the timeline. |
| `tree` | array | Phases (top-level nodes), each with `children`. Any depth works; four levels is plenty. |
| `manual` | array | Owner actions — see below. |
| `risks` | array | `{ text, severity: high|medium|low, mitigation }` or plain strings. |
| `decisions` | array | `{ date, text }` — a short decision log. |
| `sources` | array | Where the facts came from (`PLAN.md`, `git`, `conversation`…). |
| `overallPercent` | number | Override only if the owner measures progress differently. Normally leave out. |

### settings

| Key | Default | Meaning |
|---|---|---|
| `estimateUnit` | `"h"` | `h` hours, `d` days, or `pts` story points. Pick one for the whole tree. |
| `hoursPerDay` | `6` | Focused hours per person per working day (used when unit is `h`). |
| `pointsPerDay` | — | Points one person finishes per day (unit `pts`). Falls back to the pace in history, then 1. |
| `workingDays` | `[1,2,3,4,5,6]` | 0 = Sunday … 6 = Saturday. Default is a six-day week (common in India); set `[1,2,3,4,5]` for Mon–Fri. |
| `unassignedLanes` | `1` | How many unassigned tasks can run in parallel. |
| `dueSoonDays` | `3` | Working days ahead that count as "due soon". |

## Nodes (phases, epics, tasks, subtasks)

A node with `children` is a **group**: its status, percent, estimate, dates and critical flag are computed from its children — don't set them by hand (a stated status that disagrees is reported in the data checks). A node without children is a **task** and carries the real data.

| Field | Applies to | Notes |
|---|---|---|
| `id` | all | Stable, hierarchical: `P1`, `P1.2`, `P1.2.3`. Auto-generated from position if missing, but **always set ids** so dependencies, commits and history stay stable across runs. Never renumber existing ids; append new ones. |
| `title` | all | Verb-first for tasks ("Add pagination to job list"), noun for groups ("Job list"). |
| `type` | all | Optional label; defaults by depth: phase, epic, task, subtask. |
| `owner` | all | Inherited by descendants that don't set their own. |
| `description` | all | One or two lines of context. |
| `dependsOn` | all | Array of ids. A dependency on a group means "after every task in that group". Dependencies on a group are inherited by everything inside it. |
| `due` | all | YYYY-MM-DD. A real deadline only — leave out when there isn't one; the forecast fills dates in. |
| `status` | task | `todo`, `in_progress`, `blocked`, `done`, `cancelled` (synonyms like `wip`, `review`, `on_hold` are normalised). |
| `estimate` | task | Number in `settings.estimateUnit`. Missing estimates fall back to the median and are flagged. |
| `percent` | task | 0–100 for `in_progress` / `blocked`. If omitted, computed from `acceptance` ticks, else 50 for in progress. |
| `acceptance` | task | Array of strings or `{ text, done }`. Definition of done; ticks feed `percent`. |
| `actual` | task | Time actually spent (same unit). Enables estimate-accuracy tracking. |
| `start` | task | Earliest date the task can start (e.g. waiting for a person to join). |
| `completed` | task | Date finished. Used on the timeline for done work. |
| `priority` | task | `high`, `medium`, `low` (also `critical`). Orders the ready queue. |
| `next` | task | The very next concrete step for in-progress work. |
| `blocker` | task | What it is waiting on, for blocked work. Pair it with a `manual` entry when a person must act. |
| `evidence` | task | Files, tests, PR or commit that prove it's done. |
| `verified` | task | `false` when a checklist says done but nothing in code or git backs it up. |
| `source` | task | Where the item came from, e.g. `PLAN.md:14`. |
| `git` | task | `{ state, branch, ref, pr }`. `state`: `merged`, `pushed`, `committed`, `uncommitted`, `not_started`, `n/a`, `unknown`. |
| `tags`, `notes` | task | Free-form. Tags are searchable in the dashboard. |

## Owner actions (`manual`)

```json
{ "action": "Add RAZORPAY_KEY_ID to Vercel (Production)", "why": "Checkout can't be tested without it",
  "how": "Vercel → Project → Settings → Environment Variables", "priority": "high",
  "blocking": true, "blocks": "P3.2 Razorpay checkout", "relatesTo": ["P3.2"],
  "category": "Secrets & config", "owner": "Ak", "due": "2026-10-28", "done": false }
```

Set `done: true` instead of deleting an action once it's handled — the dashboard counts completed actions. Categories in use: Secrets & config, Accounts & access, Review & merge, Deploy & release, Data & content, Client input, Testing & sign-off, Payments & billing.

## What the engine computes

- **Roll-ups** at every level, weighted by estimate (done = 100%, in progress = its %, blocked = its % or 0).
- **Dependencies** resolved to task level, inherited from parents; unknown ids and cycles are reported.
- **Critical path** — the longest chain of unfinished work by remaining effort; any delay on it moves the finish date. Each task gets its **slack** in working days.
- **Forecast** — a resource-levelled schedule from `asOf`: tasks start when their dependencies finish and their owner is free (one task at a time per person, `unassignedLanes` for the rest). Blocked tasks are scheduled as though freed today, and the dashboard says so.
- **Pace forecast** — earned work per working day over the last ~3 weeks of history; if it lands after the target the verdict becomes at-risk even when the plan has slack.
- **Ready queue** — to-do tasks with every dependency done, critical path first, then priority, then due date.
- **Overdue / due soon / slipping** (forecast end after the due date), owner workload, estimate accuracy, health (green / amber / red with reasons).

Git facts (branches, working tree, activity) come from `facts.json`; don't copy them into the breakdown.
