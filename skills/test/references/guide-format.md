# guide.json format

`scripts/build_guide.py` turns one `guide.json` into the checklist page and its Markdown copy. It checks
the fields below and refuses a guide that breaks them.

| Field | Required | What it holds |
|---|---|---|
| `title` | yes | The change as the tester would name it, 3–8 words: "Practice mode keeps your real data safe" |
| `project` | no | The product name shown above the title |
| `date` | no | "27 Oct 2026" |
| `changeRef` | no | The ticket, PR or requirement ID, shown as a small chip ("PR #94") |
| `summary` | yes | 1–2 sentences: what is different now, in the tester's words |
| `whyItMatters` | no | 1 sentence: what went wrong before, or what this lets them do |
| `minutes` | yes | Honest estimate for the whole guide (5–10 for the default depth) |
| `devices` | yes | `[{ "name": "Android phone", "how": "how to get the right version, and how to tell you have it" }]` |
| `before` | no | Short setup checks the tester ticks: signed in to the test account, on the right version… |
| `sampleData` | no | `[{ "label": "Customer name", "value": "Lakshmi Traders" }]`: made-up values, each with a Copy button |
| `scenarios` | yes | One `story` and one `whatif` by default (see below) |
| `afterwards` | no | One line on what to do when finished (cleaning up test data, for example) |

Each scenario:

```json
{
  "id": "s1",
  "kind": "story",
  "title": "Meena sends her first invoice of the day",
  "story": "Meena runs Lakshmi Traders. A customer has just bought 10 kg of turmeric and wants the bill on WhatsApp.",
  "steps": [
    {
      "id": "s1-1",
      "do": "On the home screen, tap **New invoice** (the green button at the bottom).",
      "see": "A blank invoice opens, with today's date filled in.",
      "caution": "Optional. Only for a step that changes or removes something."
    }
  ]
}
```

- `kind` is `story` (the everyday use of the change) or `whatif` (the old problem is gone, or a tricky case is handled).
- Step `id`s are lowercase letters, digits and dashes, unique across the whole guide (`s1-1`, `s2-3`). Answers are stored under them, so keep an id fixed when you edit a step's wording; a reworded step that needs a fresh answer gets a new id.
- 8 steps at most per scenario. Split a longer one into two.
- Wrap on-screen names in `**double stars**`; the page shows them in bold. No other formatting is read.

## Where the answers go

The page saves each answer in the artifact's store, collection `results`, one document per step id:

```json
{ "status": "pass" | "fail", "note": "what they saw instead", "shot": "<asset id or empty>", "step": "1.3", "at": "2026-10-27T10:12:00Z" }
```

Read them with the `ArtifactData` tool: `action: "list"`, `collection: "results"`. A screenshot's asset id
is read with the Artifact tool: `action: "read"`, `url`, `path: "<asset id>"`.

When the page can't reach the store (for example, opened as a local file), answers stay in that browser
only, and the page tells the tester to report them in chat.
