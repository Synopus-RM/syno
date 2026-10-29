---
name: parallel
description: Syno Parallel. Finish every remaining item of a project at once — rebuild the full list of pending work, fan it out to parallel agents, verify each result, and hand over each deliverable the moment it is ready to publish. Use whenever the user says things like "proceed with all the remaining ones", "complete everything", "do the rest in parallel", "use multiple agents", "finish all pending items", "no timeline / no rush", "publish as and when ready", "go ahead with everything left", or just "do all of it" after a plan or progress report — even when they don't restate the list, because the list is the open work in the conversation, task list or project files.
---

# Syno Parallel

**DMAIC step: Improve.** Finish the remaining work in parallel, without lowering the bar.

## Syno rules for this skill

- **The ledger comes from Syno Tasks when it exists.** If `.syno/tasks/breakdown.json` is there, the remaining work is its open tasks (`node "${CLAUDE_PLUGIN_ROOT}/scripts/syno.js" tasks status`, then the tasks skill), each with its acceptance criteria as "Done when".
- **The device sets the width.** Run `gov advise` before launching. Agents' builds and tests take turns in the Syno Governor queue; never launch more heavy work at once than the budget allows.
- **Done means the done gate passed.** Before releasing a result, mark its task done with `syno tasks set <id> done`; if the gate refuses (acceptance not met, a failing test guide, a Critical audit or security finding), the result isn't done: fix it or report it as not done.

The user has handed off the rest of a project. They want every open item finished, worked on concurrently, and each piece handed back the moment it's usable — not a plan, not the next step followed by "shall I continue?".

## What the instruction actually means

Read the request as a short contract. Each phrase rules something in and something out:

| They say | It means | Common failure to avoid |
|---|---|---|
| "all the remaining ones" | Every open item, not just the next one | Missing items that were mentioned earlier in the conversation or sit in a task file |
| "multiple agents in parallel" | Independent items run at the same time, launched together | Doing items one by one, or launching one agent and waiting |
| "complete everything" | Each item ends as a finished, usable deliverable | Outlines, stubs, "TODO: fill in", plans instead of output |
| "without any timeline" | No deadline: favour quality and completeness; no schedules, phases or ETAs; they may be away, so don't stall on questions | Cutting scope "to save time", or writing a dated roadmap instead of doing the work |
| "publish as and when ready" | Stream results: each deliverable goes to the user as soon as it passes its check, in a state they can publish straight away | Holding everything for one big dump at the end; claiming something is "published" when it is only ready |

On "publish": Claude makes each item publish-ready and delivers it where the user can open it straight away — web pages, apps and documents as a published artifact (a private link they can view and share), other files via a file card. A file sitting in Claude's workspace is not delivered. Actions that put something in front of the public or real people — posting, sending emails/messages, deploying to production, submitting to an app store or a government portal — stay the user's act unless they explicitly asked Claude to do that specific action and a tool for it exists. Prepare everything up to the final click and list that click for them.

## Workflow

### 1. Rebuild the remaining-work ledger

Before launching anything, assemble the full list. Look in this order, because each source catches items the others miss:

1. The conversation — the latest plan, "next steps", items the user listed, and things Claude offered to do but hadn't done yet.
2. The task-list widget (TaskList), if one exists.
3. Project files: `TASKS.md`, `PROGRESS.md`, `TODO`, a progress report, README checklists, issue lists.
4. Memory files for the project area, if memory is available.

Write one row per item:

| # | Item | Deliverable (concrete output + format) | Depends on | Owner | Done when |
|---|---|---|---|---|---|

- **Owner** is `Claude` or `Owner-only`. Owner-only covers anything needing the user's identity or authority: passwords, API keys and secrets, account creation, payments, legal sign-off, government/regulatory submissions, app-store submissions, production deploys, messages to real people, public posts. Claude still does all the preparation for these (filled-in copy, exact values to paste, a step checklist) and the row's deliverable is that prep pack.
- If an item is only usable together with something nobody listed (a page that links to a privacy policy that doesn't exist), add the missing piece and mark it "added — needed for #N" so the user can veto it. Don't otherwise expand scope.
- Already-finished items stay off the ledger; don't redo them.

Send the ledger to the user in one short message (use SendUserMessage when narration between tool calls would otherwise be summarised), then carry straight on. Don't wait for approval — the instruction already gave it. The one exception: a decision that can't be undone and could reasonably go either way. Prepare everything around it, set the choice out, and keep working on the rest.

Also create one task-list entry per ledger row (TaskCreate) so the user can see progress at a glance while away.

### 2. Plan the waves

Arrange the ledger by dependencies:

- **Wave 0 — shared foundation (only if needed).** When several items must look or read consistently — same brand palette, product name, pricing, terminology, data model — produce that foundation first as a small file (e.g. `foundation/brand.md`, `foundation/facts.md`). Parallel agents can't see each other; without a shared source each invents its own colours, prices and wording, and the set comes back inconsistent.
- **Wave 1** — every item with no unmet dependency, all launched together.
- **Later items** start the moment their own dependencies are delivered, not when the whole previous wave ends.

Sizing: usually one agent per deliverable. Bundle tiny, closely related items into one agent (three short WhatsApp templates are one job); split a huge item into parts with a clear seam. Up to roughly 8–10 agents per launch works well; beyond that, bundle. On this device, size the launch with `gov advise` (Syno Governor): no more agents running builds or tests at once than the owner's budget allows, and every agent runs its heavy commands through `gov run`.

### 3. Write self-contained briefs

A subagent starts with nothing — it hasn't seen the conversation, the user's preferences, memory, or the other agents. Everything it needs must be in the brief. Use the template in `references/agent-brief.md`. A good brief contains:

- the goal and who the deliverable is for (so the agent can make sensible calls),
- every relevant fact: product names, numbers, audience, language, brand, decisions already made,
- absolute paths to input files and to the wave-0 foundation files,
- the exact output path and format,
- the "done when" checks from the ledger, which the agent runs on its own output before reporting,
- the user's standing rules, copied in word for word (see "House rules" below),
- limits: don't post, send, deploy to production, submit or spend; never ask for or handle secrets,
- the report format: what was made, file paths, assumptions taken, anything the owner must do.

A brief that says "build the landing page as discussed" fails — the agent didn't hear the discussion.

### 4. Launch

Put every brief for the wave in a **single message with one Agent call each**, so they run concurrently in the background. Then don't duplicate their work yourself; use the time to prepare the next items' briefs or owner-action packs.

You are the orchestrator, and you stay the orchestrator. Subagents generally can't launch agents of their own, so never hand the whole backlog to one agent and ask it to "parallelise" — it will quietly do everything in sequence. Each brief covers one deliverable (or one small bundle) and tells the agent it works alone.

### 5. Verify, then release each result as it lands

As each agent reports back:

1. Open the actual output — render the page, open the document, run the code, recompute the numbers. Check it against the ledger's "done when" and the house rules. An agent saying "done" is a claim, not evidence.
2. **Passes** → deliver it immediately in its natural form (an artifact of the fitting type, or the file via SendUserFile) with one line of context, and mark its task completed. This is the "publish as and when ready" part: the user can act on it now. One handover per item, at the moment it passes — don't save up two or three for a combined update, and don't let the last items arrive only inside the close-out message. Owner-action packs count as deliverables too and are handed over the same way.
3. **Falls short** → send it back to the same agent (SendMessage, so it keeps its context) with the specific gaps. After two unsuccessful rounds, record the blocker on the ledger and move on — one stuck item must not hold up the others.
4. Start any item whose dependencies are now met.

For deliverables where a mistake costs money or legal standing (tax figures, financial statements, contracts, regulatory filings), have a fresh agent that didn't produce the work do the check.

### 6. Close out

When nothing is left running, send one final message:

- the ledger with a status per row: ✅ delivered · ⚠️ delivered with caveat · ⛔ blocked (why) · 🔒 owner action pending,
- **Owner actions**: a separate numbered list of the remaining steps only the user can do, in the order they should happen (e.g. roll out the build before emailing testers), each with where to click and what to paste — not mixed in with general caveats,
- assumptions taken while working unattended (prices, policies, URLs, feature claims the source didn't state), so they can be reversed. Inside the deliverables, mark such assumed facts and unfilled values as visible placeholders (`{{GRIEVANCE_OFFICER_NAME}}`) rather than inventing them silently,
- no recap of how the work was done — the user wants the results, not the process.

## House rules

Subagents don't receive the user's preferences, so copy them into every brief. Take them from the user's stated preferences in the conversation and settings. For Synopus, the standing rules for anything built — apps, sites, pages, dashboards — are in `references/house-rules.md`; include that block verbatim in any brief that produces a user-facing interface, and check every UI deliverable against it before releasing. If the user states something different in the current conversation, the current conversation wins.

## When there's no Agent tool

Some sessions can't spawn agents. Keep everything else — the ledger, wave order, verification, releasing each item as soon as it's done, the close-out — and work through the items yourself. Say in one line that they ran in sequence.

## Reusable prompt

`references/enhanced-prompt.md` holds a polished version of the instruction this skill implements, for the user to paste into future sessions or other tools. Offer it only if they ask how to phrase the request better.
