---
name: compliance
description: Syno Compliance. Checks an idea, a PRD or a release against the acts, rules and regulations of every place the product's users and business are (India always), lists each requirement as Met, Gap or Unclear with its severity, and blocks a release on a Critical gap. Use when planning, after a PRD change, before a release, or when the user asks what laws apply.
---

# Syno Compliance

**DMAIC steps: Define (at the idea) and Analyze (the PRD and each release).** Compliance finds what the law asks of the product before it is built, and checks it again whenever the plan changes.

The CLI is `node "${CLAUDE_PLUGIN_ROOT}/scripts/syno.js"`, written `syno` below. Every report says: "This is not legal advice. Ask a qualified professional to confirm Critical items." Say the same to the owner.

## When

At idea formation (Syno Plan runs it), on the first PRD, after every PRD change, and before every release. `/syno:compliance idea|prd|release`.

## Steps

1. **Screen.** Run `syno compliance screen` (the PRD), or `--file <idea.md>` for an idea written to your scratchpad. It lists the places found, the areas that apply and the usual laws (`references/catalog.md`).
2. **Places.** Show the places and ask the owner to confirm or edit them with AskUserQuestion (multiSelect). India is always included, with the business's state. Save with `syno compliance places --set <codes>` and, only after a yes, `--confirm`.
3. **Check each law's current text.** Use your web tools on the official source (the catalog's links are starting points). For each requirement write one item: `law`, `ref` (section or rule), `place`, `why` it applies, what it `requires`, `status` (Met, Gap or Unclear), `severity` (Critical, Major or Minor), `action` (what to do, for a gap), `feature` (the PRD feature it belongs to), `source` (the link you read), `checked` (today) and `verified: "web"`. Without web access, set `verified: "memory"`: such an item can never be Met, and Syno marks it "From memory — verify". Add laws the catalog misses; the catalog is not complete.
4. **Severity.** Critical: the product would break the law in a way that brings penalties or harm (no consent for personal data, no DLT registration for OTPs, unlicensed lending or payments). Major: a duty that is missing but can be fixed soon. Minor: wording or paperwork.
5. **Record.** Write `{ "places": [...], "items": [...] }` to your scratchpad, run `syno compliance record --scope <idea|prd|release> --file <it>`, show the verdict, and ask with AskUserQuestion: "Record this compliance check?" Options: "Record it (Recommended)" and "Not now". Only on yes, run it again with `--confirm`.
6. **PRD edits.** For each gap, propose the PRD change (a requirement, a feature or an acceptance criterion) and write it only after a yes. A PRD edit makes the check out of date, so run the `prd` check again after it.

## The gate

An open Critical gap blocks a release, and so does a PRD changed after its last check. Only the owner can override, with a reason (/syno:sigma).
