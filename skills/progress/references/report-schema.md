# report.json schema

`render.mjs` reads this file. Only `items` is required; everything else is optional.

```json
{
  "project": { "name": "cric-mind", "owner": "Process owner name", "description": "..." },
  "asOf": "2026-10-22T10:30:00+05:30",
  "headline": "Core scoring engine is merged; payments and deploy are waiting on the owner.",
  "targetDate": "2026-11-15",
  "overallPercent": null,
  "phases": ["Foundation", "Core features", "Polish & launch"],
  "items": [
    {
      "title": "User authentication (email + Google)",
      "phase": "Foundation",
      "status": "done",
      "weight": 2,
      "evidence": "src/auth/*, tests pass; PR #12 merged",
      "source": "PLAN.md:14",
      "verified": true,
      "git": { "state": "merged", "branch": "feat/auth", "ref": "a1b2c3d" }
    },
    {
      "title": "Live score dashboard",
      "phase": "Core features",
      "status": "in_progress",
      "percent": 60,
      "next": "Wire websocket updates into the scoreboard component",
      "git": { "state": "pushed", "branch": "feat/live-dashboard" }
    },
    {
      "title": "Razorpay checkout",
      "phase": "Core features",
      "status": "blocked",
      "blocker": "Needs live Razorpay keys from the owner",
      "git": { "state": "not_started" }
    },
    {
      "title": "Production deploy on Vercel",
      "phase": "Polish & launch",
      "status": "todo",
      "priority": "high",
      "dependsOn": "Razorpay checkout; domain DNS"
    }
  ],
  "manual": [
    {
      "action": "Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to Vercel (Production)",
      "why": "Checkout cannot be built or tested without live keys",
      "how": "Vercel → Project → Settings → Environment Variables",
      "priority": "high",
      "blocking": true,
      "blocks": "Razorpay checkout",
      "category": "Secrets & config",
      "owner": "Process owner"
    }
  ],
  "risks": [{ "text": "No automated tests for payment flow", "severity": "medium" }],
  "sources": ["PLAN.md", "PRD.md", "git", "this conversation"]
}
```

## Field notes

| Field | Values | Notes |
|---|---|---|
| `items[].status` | `done`, `in_progress`, `blocked`, `todo`, `cancelled` | Synonyms like `wip`, `completed`, `on_hold` are normalised. `cancelled` is excluded from all maths. |
| `items[].percent` | 0–100 | Used for `in_progress` (default 50) and `blocked` (default 0). Ignored for `done`/`todo`. |
| `items[].weight` | number, default 1 | Use for items that are much bigger than others (e.g. 3 for a whole module). Keep it simple — only weight when sizes clearly differ. |
| `items[].git.state` | `merged`, `pushed`, `committed`, `uncommitted`, `not_started`, `n/a`, `unknown` | `merged` = reachable from the default branch. `n/a` for non-code items (docs sign-off, meetings). |
| `items[].verified` | bool | Set `false` when a checklist says done but you found no code/commit evidence. Shows an "unverified" tag. |
| `items[].priority` | `high`, `medium`, `low` | Shown for `todo` items; sorts the table. |
| `manual[].blocking` | bool | Blocking items are sorted first and highlighted. |
| `overallPercent` | number or null | Leave null so it's computed from items. Override only if the owner defines progress differently (e.g. by budget or milestones). |
| `phases` | array of names | Sets phase order. Omit to use the order phases first appear in `items`. |

Git facts (branches, merged/pushed state, working tree) come from `facts.json` automatically — don't copy them into report.json.
