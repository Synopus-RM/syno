---
name: plan
description: Syno Plan. Brainstorm a project in depth through batched clarifying questions before drafting a build-ready PRD (or a project brief for non-software work). Use when the user explicitly asks to brainstorm, discuss, scope or plan a project or feature before building, or asks for a PRD, requirements doc, spec or brief — at the start of a new project or mid-session in an existing one (new feature, module or change of direction). Triggers on phrases like "let's brainstorm", "ask me questions first", "draft a PRD", "scope this out", "requirements for X".
---

# Syno Plan

**DMAIC step: Define.** Plan turns an idea into a build-ready PRD, with the law and misuse checked before anything is built.

## Syno rules for this skill

- **Check the idea first.** Before the first question batch, run Syno Compliance on the idea (/syno:compliance idea) and Syno Security's design pass (/syno:security design). Bring what they find into the questions: a law that applies, a role that must never be able to do something.
- **The PRD has four more sections:** At a glance (a verdict and a 3–5 line summary), Quality (the critical-to-quality requirements, each with how it is measured), Compliance (each requirement from Syno Compliance, with its feature) and Security (the abuse cases from Syno Security, with their features). The template below includes them.
- **Check the PRD after writing it.** Once PRD.md is written or updated, run /syno:compliance prd. A PRD changed after its last check makes the release gate wait for a new one.
- **Write for anyone.** Summary first, plain words, short sentences, and a glossary for every technical term.

Turn a rough idea into a build-ready PRD by questioning the user in batches until every area is clear — then draft only after they say go.

The point of this skill is to stop Claude from guessing. Building on unclear requirements wastes far more time than a few rounds of questions, so the questioning phase is the main work, not a formality.

## 1. Orient before asking

- **New project:** start from what the user has said; do not ask for things they already told you.
- **Existing project / mid-session:** first read what exists — PRD.md, README, the codebase structure, key models and routes, prior conversation. Ask only about the new feature or change and the gaps around it. Open with a 2–3 line summary of what you understood from the project so the user can correct it.
- **Decide the track:** software (web, mobile, SaaS, API, internal tool) → PRD. Non-software (marketing campaign, reel/video, event, client deliverable, process) → Project Brief. Same questioning process, different sections.

## 2. Ask in batches with the question widget

Use the `AskUserQuestion` tool for every question — the user prefers tapping answers over typing. Each call holds up to 4 questions; a batch may span 2–3 consecutive calls on one theme.

- **Every question offers options with a recommended default**, listed first with "(Recommended)" in the label. Options must be concrete and mutually exclusive; add a one-line description where the label alone is ambiguous. Use `multiSelect` when choices can combine (e.g. which roles exist, which integrations).
- **Keep headers short** (≤12 characters) and questions specific to this project — "Who approves a chit auction payout?" beats "What are the user roles?".
- **Batch size is your call**, scaled to complexity: a small feature may need one batch; a new SaaS may need five or six.
- **Order batches from foundation to detail**, so later questions build on earlier answers:
  1. Problem, goals, users and roles
  2. Core features and MVP scope
  3. User flows and data / entities
  4. Integrations, tech stack, hosting, auth and security
  5. Compliance, languages, pricing and monetisation
  6. UI/UX direction, timeline/phases, success metrics, out-of-scope
  Skip or merge areas that clearly do not apply; split an area that turns out complex.
- **Don't re-ask** anything already answered, in this conversation or in files you read.

### After each batch
Give a **short recap** (3–6 bullets) of what's now settled, then move to the next batch. If an answer opened a new question or conflicts with an earlier one, raise it in the next batch.

### "You decide", "Other" left blank, or skipped
Pick a sensible default, say which one in the recap, and log it under **Assumptions** in the PRD. Don't re-ask.

## 3. Areas that must always be covered

Beyond the standard areas above, always cover these — they are easy to forget and costly to retrofit:

- **Indian compliance where relevant:** DPDP Act (personal data, consent), GST (invoicing, tax fields), RBI rules (lending, payments, KYC), SMS DLT (sender ID, templates) for any SMS/OTP.
- **Languages:** Tamil / English / bilingual — UI, notifications, documents.
- **Pricing & monetisation:** free vs paid, plans, trial, payment gateway, who pays.

## 4. Keep going until clear, then confirm

Continue batches until no area has a material unknown. Then post a **final summary** (key decisions per area + the list of assumptions) and ask with the widget whether to draft the PRD now or adjust something first. Do not draft until the user confirms.

**If the user says "just start building" mid-brainstorm:** fill remaining gaps with recommended defaults, log them all as assumptions, draft a quick PRD, then proceed to build. Tell them in one line which areas were assumed.

## 5. Draft the deliverable

Read the matching template before writing:
- Software → `references/prd-template.md`
- Non-software → `references/brief-template.md`

The PRD is **build-ready**: a developer should be able to start without coming back with basic questions. That means concrete user flows, entities with key fields, role permissions, and acceptance criteria per feature — not marketing prose.

Deliver it in **both** forms:
1. A **Claude Doc** (the Docs artifact type) — editable and shareable.
2. **`PRD.md`** in the project root (or `BRIEF.md` for non-software). For an existing project with a PRD, update the existing file — add a dated changelog entry and mark changed sections — rather than replacing it.

Finish with a 1–2 line wrap-up and one natural next step (e.g. "Ready to break this into tasks and start the build?").
