# Syno Console messages

Every message between sessions of the tree starts with one envelope line:

```
[SYNO <type>] <from-id> → <to-id> · <ref>
```

Send it with `send_message` to the session ID in your role card, then end your turn. Replies arrive as new turns, so never poll. One message per event, in plain words, at most 64 KiB, and no secrets: transcripts keep everything.

| Type | Direction | Ref | Purpose |
| --- | --- | --- | --- |
| `brief` | down | node ID or project ID | Start work. It is the `create_session` prompt |
| `question` | up | `Q-<origin-id>-<nn>` | A question that needs a decision; plan approvals too |
| `decision` | down | `D-nnnn` | The owner's recorded answer |
| `rule` | down | `R-nnnn` | A new or replaced standing rule |
| `numbers` | down | series | A number block |
| `handoff` | up | node ID | Finished work and its report |
| `rework` | down | node ID | What to fix before the merge |
| `sync` | down | branch | Merge your parent's branch into yours now |
| `hold` / `resume` | down | node ID | Pause or continue a part of the tree; pass it on to your children |
| `status` | up | node ID | A short state report, only when asked |

## Question

```
[SYNO question] A.M1.T3 → A.M1 · Q-A.M1.T3-01
Blocking: yes (paused) | no (working on other parts)
Scope: A.M1.T3 | A.M1 | A | project
Question: <one sentence>
Why it matters: <one line>
Options:
1. <label> (Recommended): <what happens; the trade-off>
2. <label>: <what happens>
Checked: D-0004, D-0009, R-0005 (none settles it)
Seen by: A.M1 (no decision covers it)
```

- **Each level on the way up** checks the register and answers from it if it can. It cites the D-number, and nobody asks the owner. Otherwise it adds a "Seen by" line and forwards the question.
- **The phase frames it:** it merges duplicates, keeps 2 to 4 options in plain words, and puts the recommendation first.
- **The Console asks the owner** with AskUserQuestion: up to 4 questions per dialog, the header is the node ID (12 characters at most), and each question names its path, for example "Phase A › A.M1 › A.M1.T3". The Console records the question and the answer (`question`, then `decide`).
- **With `askAt: "phase"`**, a phase asks questions that concern only its phase itself. It then sends the Console one line: `DECISION <phase-id> <YYYY-MM-DD>: <question> → <answer>`. The Console records it.

## Decision

```
[SYNO decision] console → A.M1.T3 · D-0012 (answers Q-A.M1.T3-01)
Scope: A.M1
Question: <as asked>
Answer: <the owner's choice>
Replaces: D-0007 (if any)
```

The Console sends it to the session that asked, to every level in between, and to every running session in the decision's scope. Decisions are never edited: a newer one replaces an older one.

## Handoff

```
[SYNO handoff] A.M1.T3 → A.M1 · T-M1-03
Result: done | partly done | blocked
Branch: claude/syno-pha-m1-t3 at <full sha> (pushed)
Synced: merged origin/claude/syno-pha-m1 at <sha> before this report
What changed: <plain bullets>
Files: <count>, <list or summary>
Lane check: all inside the lane | outside: <files, why>
Checks: <command> → passed (<numbers>)
Decisions used: D-0004, D-0012
Local choices: <each, one line>
Numbers used: ADR-0437
Open questions: Q-… | none
Follow-ups: <each> | none
```

The parent answers with `[SYNO rework]` (what to fix) or tells the child it merged the work. It then archives the child.

## Sync, hold and resume

- **`sync`** means: `git fetch origin <parent branch>`, `git merge origin/<parent branch>`, run your checks, push, and pass the sync on to your running children.
- **`hold`** means: finish the current step, commit and push, send `[SYNO status]`, and start nothing new until `resume`. Pass it on to your children.
