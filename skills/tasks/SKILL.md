---
name: tasks
description: Syno Tasks. Build and maintain a dynamic, structured task breakdown (phases, epics, tasks, subtasks with IDs, owners, estimates, dependencies, acceptance criteria, due dates) and turn it into a living progress report with roll-up % at every level, critical path, forecast vs target date, ready-to-start queue, overdue and slipping work, owner workload, burn-up trend, git commit/push/merge status, and manual actions only the process owner can do. It outputs an interactive dashboard (overview, tree, Kanban, timeline, dependency map) plus BREAKDOWN.md and PROGRESS.md. Use when the user wants to plan or break down a project, feature, PRD or sprint into tasks, asks for a WBS or plan with estimates, or asks "where are we", "status update", "progress report", "what's left", "what's next", "are we on track", "when will it finish", "what's blocking", "what do I need to do". Upgraded companion to project-progress-report.
---

# Syno Tasks

**DMAIC steps: Define and Measure.** Tasks define the work and how each piece is known to be done (its acceptance criteria), then measure it to the finish.

## Syno rules for this skill

- **Every task gets at least one acceptance criterion before it starts.** They are how we know it's done, and Syno Sigma counts them as its quality checks. `syno tasks check` flags any task that's in progress without one.
- **Change a task's status with `syno tasks set <id> <status>`**, not by editing the file: moving to in progress needs an acceptance criterion; moving to done runs the done gate (acceptance met, plus Syno Sigma's tests, audit and security checks) and leaves the task in progress if it fails. Reopening a done task counts as a defect. Tick criteria with `syno tasks tick <id> <n|all>`.
- **Every write asks first.** Run without `--confirm`, show the change, ask with AskUserQuestion, and only on a yes run it with `--confirm`.
- The CLI is `node "${CLAUDE_PLUGIN_ROOT}/scripts/syno.js"`, written `syno`.

Turn a project into a structured, hierarchical breakdown and keep it honest over time. Every run produces the same three things: **the plan** (what the work is and in what order), **the truth** (what is actually done, backed by evidence), and **the forecast** (when it will finish and what is in the way).

The breakdown is the single source of truth. It lives in `<project-root>/.syno/tasks/breakdown.json` (committed, so the whole team shares it), is updated — never rebuilt — on each run, and everything else is rendered from it.

## Outputs

| File | What it is |
|---|---|
| `.syno/tasks/breakdown.json` | The source of truth (you write and maintain it). Committed. |
| `.syno/reports/tasks/<date>.html`, `latest.html` and `.md` | Syno's shared-look report: verdict, summary, what you need to do, phase bars, up next, in progress, blocked, past due, critical path, who is doing what, glossary. |
| `.syno/reports/tasks/BOARD.html` | The interactive board in Synopus Sky Glass: task loom, breakdown tree, Kanban, forecast timeline, dependencies, your actions, git. |
| `.syno/reports/tasks/BREAKDOWN.md`, `PROGRESS.md` | The checklist with stable IDs, and the at-a-glance status, as Markdown. |
| `.syno/local/tasks/facts.json`, `.syno/reports/tasks/model.json`, `history.json` | Collected facts, the computed model, and one snapshot per run (trend, burn-up, pace forecast). |

Everything except the breakdown is git-ignored.

## Voice and branding

Write every title, headline, next step and note in plain, neutral, owner-facing language. Don't credit an AI or assistant as the author anywhere in the outputs. The board and PROGRESS.md carry a fixed footer, "Designed & Developed by Synopus" linking to https://www.synopus.in; leave it as is.

## Workflow

### 1. Collect facts

Find the project root (git top-level, else the working directory) and run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/tasks/scripts/collect.mjs" --root "<project-root>" --out "<project-root>/.syno/local/tasks/facts.json"
```

It gathers, read-only: git state (branches ahead/behind, merged, pushed, working tree, stashes, recent commits with PR numbers), 30-day commit activity and hot folders, every markdown checklist item (`[ ]`, `[x]`, `[~]`, `[!]`) with its heading, `TODO/FIXME/MANUAL/ACTION REQUIRED` markers, `.env.example` keys missing locally (names only), and whether a previous `breakdown.json` exists.

If the repo has a remote and the last fetch is more than a day old, ask the owner before running `git fetch --prune` so merged/pushed states are accurate. If node is missing, gather the same facts with git commands directly.

### 2. Build or update the breakdown

**If `facts.previousBreakdown` exists — update mode.** Read it and change only what changed: statuses, percents, next steps, blockers, evidence, git states, dates, new owner actions. Add newly discovered work with **new** IDs. Never renumber existing IDs; mark dropped work `cancelled` instead of deleting it so history stays comparable. Note scope changes in `decisions`.

**Otherwise — plan mode.** Read the PRD / PLAN / TODO / README the facts point to, the code layout, branches, and this conversation. Decompose:

- **Phases** (3–6) are the big sequential stages: Foundation, Core features, Integrations, Polish & launch — or the plan's own milestones/sprints.
- **Epics** group a feature or area inside a phase.
- **Tasks** are the unit of tracking: one outcome, one owner, roughly **2–16 hours (≤ 2 days)**. Split anything larger; merge anything trivially small into its sibling.
- **Subtasks** only when a task genuinely has separately-trackable parts.
- Aim for **15–80 tasks** total. Very granular plans: group checkboxes under a task and turn them into `acceptance` items.
- Give every task: a verb-first title, an `estimate`, an `owner` when known, `dependsOn` where order matters, and 1–4 `acceptance` criteria (at least one for every task: Syno requires it before the task starts).
- Add `due` only for real deadlines. Put the project's target in `project.targetDate`.
- Don't invent people. If the team is unknown, leave owners empty and ask once at the end.

If there is no plan and no PRD, derive tasks from the README feature list, branches and commit history, say in the headline that the breakdown is inferred, and offer to refine it with the owner.

Write `breakdown.json` following `references/breakdown-schema.md` (read it the first time; `references/example-breakdown.json` is a full worked example).

### 3. Classify honestly

| Status | Use when |
|---|---|
| `done` | Implemented and you can point at evidence: files, passing tests, a commit, a merged PR. Fill `evidence`. |
| `in_progress` | Started: partial code, an open branch, `[~]`. Set `percent` from evidence (acceptance ticks or sub-steps done ÷ total) and a concrete `next`. |
| `blocked` | Can't move until something outside the work happens. Fill `blocker`, and add a matching `manual` action if a person must act. |
| `todo` | Not started. Set `priority` and `dependsOn` where known. |
| `cancelled` | Dropped or descoped. Excluded from all maths. |

For every code task set `git.state` by checking where its commits live — `merged` (reachable from the default branch), `pushed` (remote branch, unmerged), `committed` (local only), `uncommitted`, `not_started`, `n/a`, `unknown`. Useful checks: `git log --oneline <default> -- <path>`, `git branch --contains <sha>`, `git log --all --grep "<keyword>"`.

Honesty rules — these are what make the report worth reading:
- A checklist `[x]` with no code or commit evidence stays `done` with `verified: false`.
- Work that exists but isn't on the default branch is **done but not shipped**; the board flags it from `git.state`.
- Don't inflate percents. When unsure between two values, take the lower one.
- Don't pad estimates to make dates look good, and don't trim them to hit a target. If the forecast misses the target, that's the finding.

### 4. Find the owner's manual actions

Things that need a person with access, money or authority. Look actively — this is often the most useful part:

- **Secrets & config**: env keys missing locally (`facts.env.missingLocally`), keys for the hosting provider, API keys to obtain.
- **Accounts & access**: sign-ups, OAuth apps, repo/cloud access, billing.
- **Review & merge**: pushed-but-unmerged branches need a PR merge; unpushed branches need pushing (offer to push).
- **Deploy & release**: production deploys, DNS, store submissions, prod migrations.
- **Client input / data & content**: decisions, copy, logos, real data, legal text.
- **Testing & sign-off**: UAT, device testing, approvals.
- Code markers tagged `MANUAL` / `ACTION REQUIRED`, and anything the user said they'd handle.

Each gets a verb-first `action`, `why`, `how` (where to click / what to run), `priority`, `blocking` + `blocks`, and `relatesTo` task IDs. Don't list things you could simply do now — offer to do those instead.

### 5. Validate, then render

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/tasks/scripts/render.mjs" --breakdown "<root>/.syno/tasks/breakdown.json" --facts "<root>/.syno/local/tasks/facts.json" --out-dir "<root>/.syno/reports/tasks" --check
node "${CLAUDE_PLUGIN_ROOT}/scripts/syno.js" tasks check
```

`--check` writes nothing; it prints totals, forecast, ready queue, critical path and **warnings** (duplicate or unknown IDs, dependency cycles, missing estimates, blocked without a blocker, in-progress without a next step, unverified done, overdue). Fix errors and anything misleading. Then ask with AskUserQuestion: "Save the task board and report?" Options: "Save them (Recommended)" and "Not now". Only on yes, render for real and save the shared-look report (which also sends a tasks.snapshot to Syno Pulse when it is enabled):

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/tasks/scripts/render.mjs" --breakdown "<root>/.syno/tasks/breakdown.json" --facts "<root>/.syno/local/tasks/facts.json" --out-dir "<root>/.syno/reports/tasks"
node "${CLAUDE_PLUGIN_ROOT}/scripts/syno.js" tasks report --confirm
```

Optional: `--plan-out "<root>/TASKS.md"` also writes the breakdown checklist into the project — only when the owner asks for it.

### 6. Present it

In chat, a compact summary — don't paste the whole report:

```
**FieldPro — 32% complete** (▲ 9 pts since 20 Oct) · Health: amber
`██████████░░░░░░░░░░░░░░░░░░░░`
✅ 4 done · 🔄 1 in progress · ⛔ 1 blocked · ⏳ 6 to do · 68h left
📅 Plan finishes 31 Oct (target 20 Nov) — but at the recent pace it lands 10 Dec.

**You need to:** (blocking first, max 3)
1. …

**Up next:** P2.2.1 Assign technician to job (Ravi, 8h) — unblocks 2 tasks
**Critical path:** P2.1.1 → P2.1.2 → P2.2.3
**Heads-up:** P3.1 Invoice PDF is done but only on a local branch.
```

Then share `.syno/reports/tasks/latest.html` and the board `.syno/reports/tasks/BOARD.html` (send it as a file, or open it in a browser/preview if one is available) and mention `PROGRESS.md` / `BREAKDOWN.md`. If the user wants to share it with others and a publish/artifact tool is available, offer that.

## Reading the forecast

- **Plan forecast** schedules remaining work from today: each task starts when its dependencies are done and its owner is free (one task at a time per person). It assumes blocked tasks are freed today — the board says so — so treat it as the best case while blockers persist.
- **Pace forecast** uses earned work per working day from history; it appears from the second report on. When it lands after the target, the verdict becomes at-risk even if the plan has slack — that gap usually means estimates are optimistic or capacity is lower than assumed. Say which in the headline.
- **Critical path** tasks have zero slack; protect them first. The ready queue already puts them on top.

## Edge cases

- **Not a git repo / non-software work** (a filing season, a migration, an event): everything works; set `git.state` to `n/a` and lean on checklists and the conversation.
- **Monorepo**: one board per app is usually clearer; or use phases per package. Ask if it isn't obvious.
- **Story points or days**: set `settings.estimateUnit` to `pts` or `d`. With points, set `pointsPerDay` or let the pace from history drive it.
- **Five-day week**: set `settings.workingDays` to `[1,2,3,4,5]` (default is Monday–Saturday).
- **Re-running the same day**: the history point for the same minute is replaced, not duplicated; the delta compares against the last earlier run.
- **The old project-progress-report**: its `progress-report/` folder is ignored by the collector. To migrate, turn its `report.json` items into tasks under phases, keeping titles, statuses and git states.
