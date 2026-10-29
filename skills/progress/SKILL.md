---
name: progress
description: Syno Progress. An at-a-glance project progress report at any point in a project: an overall bar and per-phase bars, plus tables of what is Completed, In Progress, and Yet to Start, the git commit / push / merged-to-main status of every branch and work item, and a list of manual actions only the process owner can do (secrets, accounts, approvals, PR merges, deploys, sign-offs). Saves Syno's shared-look report (HTML and Markdown) and tracks the trend between reports. Use this whenever the user asks "where are we", "what's the status", "how much is done", "progress report", "status update", "what's pending", "what's left", "what do I need to do", "is it merged", "show progress", "summarise progress so far", or wants a checkpoint before a handoff, standup, review, or end of session — even if they don't say "report".
---

# Syno Progress

**DMAIC step: Measure.** The report every reader understands in one look: a verdict first, then a plain summary, what the owner has to do, and the detail.

Produce an honest, evidence-backed snapshot of a project: how far along it is, what is done, in flight, and not started, whether the work has actually reached the main branch, and exactly what the human owner has to do by hand.

The report's value comes from being **trustworthy**. A checked box in a plan is a claim; a commit merged to main is evidence. Always cross-check claims against git and the code, and say so when you can't verify something rather than rounding up.

## Outputs

| File | Purpose |
|---|---|
| `.syno/reports/progress/<date>.html` and `latest.html` | The shared-look report in Synopus Sky Glass: verdict, summary, what you need to do, phase bars, tables, glossary. Works offline, light and dark, prints on A4 |
| `.syno/reports/progress/<date>.md` and `latest.md` | The same report as Markdown, for PRs, chat or email |
| `.syno/local/progress/history.json` | One snapshot per day, for "N points up since the last report" |
| `.syno/local/progress/facts.json`, `report.json` | The collected facts and your classified report (the inputs) |

All of these are git-ignored (`.syno/local/` and `.syno/reports/`), so the report never makes the repo look dirty.

## Workflow

### 1. Collect facts (deterministic)

Find the project root (the git top-level if it's a repo, else the working directory), then run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/progress/scripts/collect.mjs" --root "<project-root>" --out-dir .syno/local/progress --out "<project-root>/.syno/local/progress/facts.json"
```

It gathers, without changing anything:
- **Git**: current/default branch, working-tree changes, stashes, every local branch's ahead/behind vs the default branch, merged-or-not, pushed-or-not, unmerged commits, remote-only branches, recent commits on main (with PR numbers), last fetch time.
- **Checklists**: every `- [ ]` / `- [x]` / `- [~]` (in progress) / `- [!]` (blocked) item in markdown files, with the heading it sits under — PRD.md, PLAN.md, TODO.md, ROADMAP.md, AGENTS.md, docs/plans, etc.
- **Code markers**: `TODO`, `FIXME`, `MANUAL`, `ACTION REQUIRED` comments.
- **Env vars**: key names in `.env.example` that are missing from local `.env*` files (values are never read).

If remote data is stale (last fetch > 1 day) and the repo has a remote, ask the owner before running `git fetch --prune`, so "merged" and "pushed" are accurate. It only updates remote-tracking refs. If node is missing, gather the same facts with git commands directly.

### 2. Understand the work (judgement)

Read `facts.json`, then read the main plan sources it lists (the plan-like files with the most checklist items — usually PRD/PLAN/TODO). Also use what you already know from this conversation: work you did, decisions made, things the user said they'd handle.

Build the list of work items. Choose the right granularity — a report with 8–40 items is readable; 200 micro-tasks is not. Group sub-checkboxes under their parent feature when the plan is very granular, and use plan headings (milestones, phases, sprints) as `phase`.

If there's no plan at all, derive items from the PRD/README feature list, branches, and commit history, say in the headline that progress is inferred, and offer to create a `PLAN.md` checklist so future reports are precise.

### 3. Classify each item honestly

| Status | Use when |
|---|---|
| `done` | Implemented and you can point at evidence (files, tests, a commit, a merged PR). |
| `in_progress` | Started — partial code, an open branch, `[~]` in the plan. Estimate `percent` from the evidence (sub-tasks done ÷ total is a good default). |
| `blocked` | Can't move until something external happens — usually a manual action. Fill `blocker`. |
| `todo` | Not started. Set `priority` and `dependsOn` where you know them. |

For every code item set `git.state` by checking where its commits live:
- `merged` — reachable from the default branch (shipped).
- `pushed` — on a remote branch, not merged (needs PR/merge).
- `committed` — local commits only (needs push).
- `uncommitted` — only in the working tree (needs commit).
- `not_started` / `n/a` / `unknown` as appropriate.

Useful checks: `git log --oneline <default> -- <path>`, `git branch --contains <sha>`, `git log --all --grep "<keyword>"`.

Honesty rules (these are what make the report worth reading):
- A checklist `[x]` with no code or commit evidence → keep it `done` but set `verified: false`.
- Work that exists in code but isn't on the default branch is **done but not shipped** — the renderer calls this out automatically from `git.state`.
- Don't inflate percentages. If unsure between two values, take the lower and say why in `next` or `evidence`.

### 4. Identify manual actions for the process owner

These are tasks Claude can't or shouldn't do. Look actively — this table is often the most useful part of the report. Check for:

- **Secrets & config**: env keys missing locally (`facts.env.missingLocally`), keys that must be set in the hosting provider, API keys/tokens to obtain.
- **Accounts & access**: third-party sign-ups, OAuth app registration, granting repo/cloud access, billing/payment setup.
- **Review & merge**: branches that are pushed but unmerged need a PR review/merge; unpushed branches need pushing (or say Claude can push on request).
- **Deploy & release**: production deploys, DNS/domain changes, app-store submissions, DB migrations on prod.
- **Data & content**: copy, images, logos, real data, legal text the owner must supply.
- **Testing & sign-off**: UAT, testing on real devices, stakeholder approval.
- **Code markers** tagged `MANUAL` / `ACTION REQUIRED`, and anything the user said in this conversation they'd handle themselves.

For each: a concrete `action` (verb first), `why` it's needed, `how` (where to click / command to run), `priority`, and whether it is `blocking` (and what it blocks). Don't list things Claude could simply do now — offer to do those instead.

### 5. Write report.json and render

Write `<project-root>/.syno/local/progress/report.json` following `references/report-schema.md` (read it the first time). If Syno Tasks has a breakdown (`.syno/tasks/breakdown.json`), take the items from it so both reports show the same numbers. Then preview and save the report:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/syno.js" progress render
```

It prints the verdict and the files it would write, plus any wording the plain-language check flags. Fix flagged wording in report.json first. Then ask with AskUserQuestion: "Save the progress report?" Options: "Save it (Recommended)" and "Not now". Only on yes, run it again with `--confirm`. Saving also sends a progress.snapshot (titles and counts) to Syno Pulse when it is enabled.

### 6. Present it

In chat, give a compact summary — don't paste the whole report:

```
**cric-mind — 62% complete** (▲ 8 pts since 15 Oct)
`██████████████████░░░░░░░░░░░░` 
✅ 14 done · 🔄 5 in progress · ⛔ 1 blocked · ⏳ 9 to start · 🌿 2 branches not merged

**You need to:** (top 3 manual actions, blocking first)
1. …

**Heads-up:** 3 completed items are on `feat/payments`, not on main yet.
```

Then link `.syno/reports/progress/latest.html` and `latest.md`. If a browser pane or preview tool is available, offer to open the HTML. If the user wants to share it with others and an Artifact/publish tool is available, offer to publish it.

## Edge cases

- **Not a git repo**: render still works; the git section says so. Item `git.state` should be `n/a`.
- **No default branch on remote / detached HEAD**: the collector falls back to `main`/`master`; mention any ambiguity in `headline` or `risks`.
- **Monorepo**: one report per app is usually clearer — ask which part if it's not obvious, or use `phase` for each package.
- **Non-software projects** (documents, finance close, migrations): the same structure works; set `git.state` to `n/a` and lean on the checklists and conversation.
- **Re-running**: just run the workflow again; history accumulates and the delta appears automatically. Reuse the previous `report.json` as a starting point and update statuses rather than re-deriving everything.
