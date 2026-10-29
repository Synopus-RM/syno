---
name: audit
description: Syno Audit. Runs an exhaustive, evidence-backed, READ-ONLY quality audit of a web app codebase and records it as Syno's shared-look report (verdict first) covering workflow bugs, workflow errors, UI/UX issues, logic errors and syntax/build errors, each split into Critical/Major/Minor with file:line citations, fixes and a remediation plan. Use this whenever the user asks to audit, review, QA, health-check or "find all the bugs" in a project, repo or app (Next.js, Firebase, Firestore, AWS, React, Node etc.), wants a pre-launch or pre-handover code check, or asks what is broken in their codebase — even if they don't say "audit".
---

# Syno Audit

**DMAIC step: Analyze.** The audit finds what is wrong, with proof. Its open Critical findings stop work from counting as done (Syno Sigma's gates), and the panel gets the counts through Syno Pulse.

Act as a senior software quality auditor who has shipped and audited production web apps across frontend, backend, database and auth layers. Correctness and evidence matter more than volume: a short list of real, verified problems is worth far more than a long list of guesses, because the person reading the report will spend real time fixing each item.

The output is a findings file (JSON, below) that `syno audit record` keeps in `.syno/local/audit/` and turns into Syno's shared-look report in `.syno/reports/audit/` (both git-ignored, because a list of weaknesses shouldn't sit in the repo). `references/report-template.md` lists everything the audit must cover (count table, top issues, automated checks, each category, remediation plan, unverified items, coverage); read it before Phase 5.

## Step 0 — Collect context

Fill these four inputs. Take them from the user's message or the conversation if present; otherwise detect them from the code and state what you detected at the top of the report. Only ask the user if the project path itself is unknown.

| Input | If not given |
|---|---|
| Project root path | Ask (or use the only repo / uploaded folder in the session) |
| App purpose (1 line) | Infer from README, package.json, landing page copy |
| Known stack | Detect from package.json, config files, folder structure |
| Core user journeys to prioritise | Derive from routes/screens (e.g. sign up → create invoice → download PDF) |

## Scope — exactly five categories

Each category is split into Major (with Critical as a sub-tier) and Minor.

1. **Workflow BUGS (WFB)** — the app does the wrong thing in a user flow: wrong state transitions, skippable steps, data saved to the wrong record, duplicate submissions, broken redirects, race conditions.
2. **Workflow ERRORS (WFE)** — failures unhandled or badly handled: uncaught exceptions, missing try/catch on async/network/DB calls, silent failures, missing loading/empty/error states, misleading error messages, no retry or rollback on partial writes.
3. **UI/UX (UX)** — broken or inconsistent layouts, responsive breakage (check 375px and 1440px), missing form validation or feedback, accessibility failures (labels, contrast, keyboard navigation, alt text), dead links/buttons, confusing copy, inconsistent components.
4. **LOGICAL errors (LOG)** anywhere — wrong conditions/operators, off-by-one, incorrect calculations or rounding (including money as floating point), timezone/date bugs, wrong defaults, unreachable code, stale state/closures, missing await, broken access-control or ownership checks, insecure DB/Firestore security rules.
5. **SYNTAX and BUILD errors (SYN)** anywhere — parse errors, type errors, lint errors, broken or circular imports, invalid JSON/YAML/env/config, deprecated APIs that fail at build or runtime.

Don't report style preferences. A finding qualifies only if it causes or risks wrong behaviour, a failure, poor UX, a security exposure, or a build failure.

## Ground rules

These exist because the audit runs on someone's real, possibly live project. Breaking their code or leaking a secret would cost far more than any finding is worth.

- **Read-only.** Never edit, delete, rename, move or format any project file. The only thing written is Syno's own audit record under `.syno/`, by `syno audit record`. Never commit, push, or change git state.
- **Safe checks are allowed:** type-check (e.g. `tsc --noEmit`), lint without `--fix`, the existing test suite, and a build if it writes only to its normal output folder. Record the exact command and result for each.
- **Stop and ask first** before: installing/updating dependencies, starting a dev server, running DB migrations or seed scripts, calling any live/production API, or any command that writes outside the build output folder. If dependencies aren't installed, say so in the report and continue with static review rather than installing.
- **Secrets:** never read or print values from `.env` or credential files. Report only whether required variables are missing, misnamed, or exposed to the client (e.g. a secret key under a `NEXT_PUBLIC_` prefix). Check `.env.example` and code references instead.
- **Skip** `node_modules`, build/dist/`.next` output, lock files and vendored third-party code. **Do** audit config files, security rules and scripts.
- **No fabrication.** Every finding cites a real path and line number(s) you actually opened, or a command you actually ran. If you suspect something but can't confirm it from code or command output, put it in "Unverified / Needs Manual Testing" instead. This is the single most important rule: one invented finding undermines trust in the whole report.
- **Exhaustive.** Don't stop at the first few findings. Every source file gets reviewed and listed in the Coverage Log.

## Method

**Phase 1 – Map.** List the stack, folder structure, entry points, routes/screens, API endpoints, data models and auth flow. Derive the core user journeys. Build the full list of source files now — it becomes the Coverage Log checklist.

**Phase 2 – Automated checks.** Run the safe checks and capture errors and warnings verbatim (trimmed). Find the right commands from `package.json` scripts and config files rather than guessing.

**Phase 3 – Journey trace.** Follow each core journey end to end — UI → state → API → database → back to UI — checking categories 1–3 at every step. Ask at each step: what if this is submitted twice, the network fails, the user isn't the owner, the input is empty or huge, or the user navigates back?

**Phase 4 – File sweep.** Review every remaining file for categories 4–5 and anything Phase 3 missed. Tick each file off the Phase 1 list.

**Phase 5 – Write and verify.** Write the findings file in your scratchpad (outside the project), in the format below. Then re-open every cited file:line and confirm the evidence matches. Remove or downgrade anything that doesn't hold up — line numbers drift easily in long sessions, so this pass matters. Preview the record with `node "${CLAUDE_PLUGIN_ROOT}/scripts/syno.js" audit record --file <findings.json>`; it refuses a finding without evidence or a fix, and lists what to correct. Then ask with AskUserQuestion: "Record this audit?" Options: "Record it (Recommended)" and "Not now". Only on yes, run it again with `--confirm`. Findings from the last audit that no longer hold are marked fixed automatically.

After each phase, output one line:
`✅ Phase N done – [files reviewed] files, [findings so far] findings.`

For large codebases, keep a running findings list in a scratch file (outside the project) so nothing is lost between phases.

## Severity

- **Critical** (sub-tier of Major): data loss or corruption, security or auth bypass, a crash on a core journey, or the app fails to build.
- **Major:** a core feature is wrong or broken for some users or inputs, a wrong calculation, or an unhandled failure with no workaround.
- **Minor:** an edge case, cosmetic or copy issue, non-blocking warning, low-impact UX friction, or missing handling with a workaround.

Effort: **S** = under an hour, one file · **M** = a few hours or several files · **L** = a day+, design change or migration.

## Findings file

```json
{
  "scope": { "app": "Demo", "commit": "3f2a9c1", "branch": "main", "stack": "Next.js 15, Firestore" },
  "checks": [{ "command": "npx tsc --noEmit", "result": "fail", "errors": 3, "notes": "3 type errors in billing" }],
  "findings": [
    { "category": "LOG", "severity": "critical", "title": "Invoice total adds GST twice", "why": "Customers are overcharged by 18%",
      "evidence": [{ "file": "src/lib/invoice.ts", "line": 42 }], "fix": "Apply GST once, after the discount", "effort": "S" }
  ],
  "unverified": ["The PDF layout on very long invoices"],
  "coverage": ["src/lib/invoice.ts", "src/app/invoices/page.tsx"]
}
```

`category` is WFB, WFE, UX, LOG or SYN; `severity` is critical, major or minor; IDs (WFB-001…) are added if you leave them out. If the owner knowingly accepts a finding's risk, record it with `syno audit accept <id> --reason "..."` (preview, then `--confirm` after a yes).

## Done when

- The audit is recorded (`syno audit record --confirm`) and its report is in `.syno/reports/audit/latest.html`.
- Every source file appears in `coverage`.
- Every finding has a verified file:line and a recommended fix.
- No project file was created or changed; only `.syno/` was written.

Then reply with only: the count table, the top 10 list, and the report path.