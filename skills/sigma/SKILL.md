---
name: sigma
description: Syno Sigma. Measures a project's quality with Six Sigma (defects, DPMO, sigma level, first-pass yield) from what Tasks, Test, Audit, Security and Compliance recorded, and runs the done and release gates. Use when the user asks how good the quality is, for the sigma level, or to override a failing gate.
---

# Syno Sigma

**DMAIC steps: Measure and Control.** Sigma counts problems the same way every time, so quality can be compared week to week.

## What it counts (PRD §4.2)

- **Unit:** one task in Syno Tasks; without a breakdown, one Chronicle change.
- **Check (opportunity):** each acceptance criterion, each answered test guide step, each logged test or build run, and each audit, security or compliance check.
- **Problem (defect):** an acceptance criterion that failed its first check, a reopened task, a failed test run or build, a test guide step that didn't match, a Critical or Major audit finding, a Critical or High security finding, or a Critical or Major compliance gap.

When a criterion fails its first check, record it: `node "${CLAUDE_PLUGIN_ROOT}/scripts/syno.js" tasks tick <id> <n> --failed`, after a yes from the owner. Test and build runs are logged by Syno's hook on their own.

## Measure

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/syno.js" sigma measure` and relay the verdict line and the summary.
2. Ask with AskUserQuestion: "Save this measurement and its report?" Options: "Save it (Recommended)" and "Not now". Only on yes, run it again with `--confirm`.
3. Point the owner to `.syno/reports/sigma/latest.html`.

## Control

The report's verdict is Green at or above the target (default 4σ) with every gate passing, Amber below the target, and Red when a gate fails. Never round a number up or leave out a problem to make the verdict look better.
