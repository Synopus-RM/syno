# PRD Template (software)

Use these sections in order. Omit a section only if it truly doesn't apply, and say so in one line rather than silently dropping it. Prefer tables and lists over paragraphs.

```
# <Product / Feature Name> — PRD
Version · Date · Owner · Status (Draft / Approved)

## At a glance
One-line verdict, then 3–5 plain-language bullets: what this is, who it's for, what ships first.

## 1. Overview
Problem statement (2–3 lines), goals, non-goals.

## 2. Users & Roles
Table: Role | Description | Key permissions

## 3. Scope
### MVP (Phase 1)  ### Later phases  ### Out of scope

## 4. Features & Requirements
Per feature:
- **F-01 <Name>** — what it does, who uses it
  - Requirements (numbered)
  - Acceptance criteria (Given/When/Then or checklist)
  - Priority: Must / Should / Could

## 5. User Flows
Step-by-step for each main flow (numbered steps; note branches and error states).

## 6. Data Model
Table per entity: Field | Type | Notes. Plus relationships.

## 7. Integrations
Table: Service | Purpose | Notes (e.g. SMS via DLT, WhatsApp, payment gateway, GST/e-invoice).

## 8. Tech Stack & Architecture
Frontend, backend, database, hosting, environments, key libraries.

## Quality (critical to quality)
Table: Requirement | Why it matters to the user | How it is measured | Target. These become Syno Sigma's opportunities and the tasks' acceptance criteria.

## 9. Security & Auth
Login, sessions, role enforcement, data protection, audit logging, plus the abuse-case register from Syno Security: Role | Must never be able to | Control | Test.
Login method, sessions, role enforcement, data protection, audit logging.

## 10. Compliance
The requirements from Syno Compliance: Law and section | Why it applies | What it requires | Status | Feature. Then the specifics below.
DPDP (consent, retention, deletion), GST, RBI/KYC, SMS DLT — only what applies, with concrete requirements.

## 11. Localisation
Languages, where each applies (UI, SMS, PDFs), date/currency formats (₹, DD-MM-YYYY).

## 12. UI/UX Direction
Visual style, key screens, platform (web/mobile/both), accessibility.

## 13. Pricing & Monetisation
Plans, pricing, trial, billing cycle, payment collection.

## 14. Non-functional Requirements
Performance, scale, availability, backups.

## 15. Timeline & Phases
Table: Phase | Scope | Target date

## 16. Success Metrics
Measurable KPIs with targets.

## 17. Assumptions
Every default chosen on the user's behalf, marked "(assumed)".

## 18. Open Questions & Risks
Anything still unresolved, with an owner.

## Changelog
Date | Change
```
