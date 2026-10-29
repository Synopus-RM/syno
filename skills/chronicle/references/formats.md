# Chronicle record formats

Each record is one JSON file under `.syno/`, so branches merge cleanly. Syno writes them; you rarely need to edit one by hand. `syno validate` checks them all. Dates are `YYYY-MM-DD`.

## Idea — `.syno/ideas/IDEA-0001.json`

Statuses: proposed → accepted → planned → in-progress → shipped. Any open idea can be parked or rejected; a parked idea can return to proposed. Only a release sets shipped.

```json
{
  "schemaVersion": 1,
  "id": "IDEA-0001",
  "title": "Dark mode for exported PDFs",
  "status": "accepted",
  "statusHistory": [{ "status": "proposed", "date": "2026-10-28" }, { "status": "accepted", "date": "2026-10-30" }],
  "shippedIn": null,
  "created": "2026-10-28",
  "updated": "2026-10-30",
  "author": "Asha Dev",
  "links": [{ "label": "Client request", "url": "https://example.com/thread/42" }],
  "tags": ["exports"]
}
```

## Change — `.syno/changes/20261030-101500-invoice-totals-round.json`

Waiting for the next release. Types: Added, Changed, Deprecated, Removed, Fixed, Security.

```json
{
  "schemaVersion": 1,
  "id": "20261030-101500-invoice-totals-round",
  "type": "Fixed",
  "summary": "Invoice totals round to 2 decimals",
  "breaking": false,
  "ideas": [],
  "links": [],
  "author": "Asha Dev",
  "created": "2026-10-30",
  "commit": null
}
```

## Release — `.syno/releases/1.2.0.json`

A release embeds its changes (their pending files are removed at the cut) and owns its publishes. `source` is syno, adopted-tag, adopted-changelog or synced-tag.

```json
{
  "schemaVersion": 1,
  "version": "1.2.0",
  "date": "2026-10-30",
  "status": "released",
  "summary": "Exports and faster totals.",
  "changes": [{ "schemaVersion": 1, "id": "20261030-101500-invoice-totals-round", "type": "Fixed", "summary": "Invoice totals round to 2 decimals", "breaking": false, "ideas": [], "links": [], "author": "Asha Dev", "created": "2026-10-30", "commit": null }],
  "ideas": ["IDEA-0001"],
  "channels": [{ "channel": "npm", "status": "published", "date": "2026-10-31", "url": "https://www.npmjs.com/package/demo" }],
  "git": { "tag": "v1.2.0", "commit": "3f2a9c1e5b7d4e8a9c217d4e5f6a8b90c1d2e3f4" },
  "source": "syno",
  "yanked": null,
  "overrides": []
}
```

A withdrawn release has `"status": "yanked"` and `"yanked": { "date": "2026-11-02", "reason": "Wrong tax rate" }`; CHANGELOG.md shows `[YANKED]`.

## Snapshot — `.syno/snapshots/1.2.0.json`

Folder totals to the configured depth (default 3), taken at every release and on demand. The diff against the previous snapshot is stored inside, so the pages never need git.

```json
{
  "schemaVersion": 1,
  "id": "1.2.0",
  "date": "2026-10-30",
  "source": "git-tree",
  "ref": "3f2a9c1e5b7d4e8a9c217d4e5f6a8b90c1d2e3f4",
  "depth": 3,
  "totals": { "files": 42, "bytes": 81234 },
  "folders": [{ "path": "src", "files": 30, "bytes": 70210 }, { "path": "src/billing", "files": 3, "bytes": 1840 }],
  "diffFromPrevious": {
    "previous": "1.1.0",
    "added": ["src/reports"],
    "removed": [],
    "renamed": [{ "from": "src/invoices", "to": "src/billing" }],
    "topLevel": [{ "path": "src", "filesDelta": 1, "bytesDelta": 512 }],
    "moves": [{ "from": "src/invoices/list.js", "to": "src/billing/list.js", "bytes": 620 }]
  }
}
```

## Config — `.syno/config.json`

Edited by the owner. The Chronicle settings live under `chronicle`: `tagPattern`, `tagPrefix`, `snapshot.depth`, `snapshot.ignore`, `channels`, `docsDir`, `changelogPath`, `nudges` (off, tags or commits) and `recordAuthors` (false stores no names).
