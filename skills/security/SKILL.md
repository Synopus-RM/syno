---
name: security
description: Syno Security. Makes misuse impossible by design and checks the code keeps it so - an abuse-case register of what each role must never do, a read-only code review, secrets and dependency scans, and attack tests on localhost only. A Critical or High finding or a failing abuse case blocks done and release. Use when planning, reviewing, before a release, or when the user asks about security.
---

# Syno Security

**DMAIC steps: Define (abuse cases at the idea and PRD) and Analyze (review, scans and attack tests).** Security is designed in first, then checked.

The CLI is `node "${CLAUDE_PLUGIN_ROOT}/scripts/syno.js"`, written `syno` below. Every write previews first; pass `--confirm` only after the owner's yes.

## 1. Design: abuse cases (idea and PRD)

For each role, write what it must never be able to do ("A student must never see another student's marks"), plus system-wide rules ("No secret key reaches the browser"). Each case: `role`, `rule`, `why`, `control` (what enforces it), `test` (how it is proved), `feature`. Save with `syno security design --file <cases.json>`, then `--confirm` after a yes. Syno Plan puts them in the PRD's Security section.

## 2. Code review (read-only)

Check the current OWASP Top 10, logins and sessions, a permission check on the server for every route and action, database rules (Firestore rules, row-level security), input checks, output escaping, file uploads, outbound requests, CORS, security headers, rate limits and security logging. Change nothing. Each finding: `severity` (Critical, High, Medium or Low), `title`, `reason` (one line), `evidence` (file and line), `fix`. Record with `syno security record --file <review.json>`.

## 3. Scans

- `syno security scan` finds routes with no server-side permission check (High) and keys or passwords in tracked files, shown masked. `--history` also reads git history. Mark a route that is meant to be open with `// syno: public`, only if the owner agrees.
- `syno security deps` runs the project's own audit tool. Ask first; with `--confirm` it waits in Syno Governor's queue, so run it with `run_in_background: true`.

## 4. Attack tests (this machine only)

For each abuse case, write requests that try to break it against the app running locally, using the project's seed or test accounts, never real ones. A plan is `{ "base": "http://localhost:3000", "cases": [{ "id": "SEC-0001", "requests": [{ "method": "GET", "url": "/api/marks?student=2", "headers": {…}, "expect": { "status": [401, 403] } }] }] }`. Only localhost, 127.0.0.1, [::1], *.localhost and *.test are allowed; anything else is refused before any request. Preview with `syno security attack --plan <plan.json>`, ask, then `--confirm`. Results set each case to Tested or Failing.

## The gate and the report

An open Critical or High finding, or a Failing abuse case, blocks done and release; only the owner can override, with a reason (/syno:sigma). The report stays on this machine (`.syno/reports/security/`, git-ignored) because it shows where each problem is. Pulse gets counts and titles only. Never paste a secret into chat, even masked ones beyond the first 4 characters.
