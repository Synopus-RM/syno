# AUDIT_REPORT.md template

Follow this structure exactly. Section numbers and headings stay fixed so reports from different audits can be compared side by side.

ID prefixes: **WFB** (workflow bug), **WFE** (workflow error), **UX**, **LOG** (logic), **SYN** (syntax/build). Number each prefix separately: WFB-001, WFB-002, LOG-001 …

If a category or subsection has no findings, keep the heading and write "No findings." so the reader knows it was checked.

---

```markdown
# Codebase Audit Report – [App Name]
Date | Commit/branch | Stack | Auditor scope

## 1. Executive Summary
- 5-line overall health verdict
- Count table:

| Category | Critical | Major | Minor | Total |
|---|---|---|---|---|
| 1. Workflow Bugs (WFB) | | | | |
| 2. Workflow Errors (WFE) | | | | |
| 3. UI/UX (UX) | | | | |
| 4. Logic (LOG) | | | | |
| 5. Syntax/Build (SYN) | | | | |
| **Total** | | | | |

(Major column excludes Critical, so Critical + Major + Minor = Total.)

- Top 10 issues to fix first (by ID, one line each with why)

## 2. Automated Check Results
| Command | Result (pass/fail) | Error count | Notes |
|---|---|---|---|

## 3. Workflow Bugs
### Major
### Minor

## 4. Workflow Errors
### Major
### Minor

## 5. UI/UX Bugs and Errors
### Major
### Minor

## 6. Logical Errors
### Major
### Minor

## 7. Syntax and Build Errors
### Major
### Minor

## 8. Remediation Plan
- **Fix Now (Critical)** → **Next Sprint (Major)** → **Backlog (Minor)**
- Order by impact versus effort; note dependencies between fixes (e.g. "fix SYN-001 first — the build must pass before LOG-003 can be verified").

## 9. Unverified / Needs Manual Testing
| # | Suspected issue | Why it couldn't be confirmed | Manual test to run |
|---|---|---|---|

## 10. Coverage Log
| File | Lines | Categories checked |
|---|---|---|

**Skipped paths**
| Path | Reason |
|---|---|
```

---

## Inside each Major / Minor subsection

Start with a summary table:

```markdown
| ID | Severity | Title | File:Line | Effort (S/M/L) |
|---|---|---|---|---|
```

Then one detail block per finding:

```markdown
#### [ID] Title
- **Severity:** Critical / Major / Minor
- **Location:** path/to/file.ext:L10-L24
- **Evidence:** code excerpt of up to 10 lines, or command output
- **Steps to reproduce / Trigger:** (workflow and UI items)
- **Expected vs Actual:**
- **Impact:** who is affected and how
- **Root cause:**
- **Recommended fix:** concrete change, with a corrected code snippet where useful
- **Verification:** how to confirm the fix works
```
