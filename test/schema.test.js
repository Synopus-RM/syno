// Chunk 1.5: the record schema checker (PRD CH-13, AC-CH-13.1).
import { test } from "node:test";
import assert from "node:assert/strict";
import { describeErrors, validate } from "../scripts/lib/schema.js";

const CHANGE = {
  type: "object",
  required: ["id", "type", "summary"],
  additionalProperties: false,
  properties: {
    id: { type: "string", pattern: "^\\d{8}-\\d{6}-[a-z0-9-]+$" },
    type: { enum: ["Added", "Changed", "Deprecated", "Removed", "Fixed", "Security"] },
    summary: { type: "string", minLength: 1, maxLength: 200 },
    breaking: { type: "boolean" },
    ideas: { type: "array", items: { $ref: "#/$defs/ideaId" } },
    created: { type: "string", format: "date" },
    author: { type: ["string", "null"] },
    links: { type: "array", items: { type: "object", properties: { url: { type: "string", format: "uri-http" } } } },
  },
  $defs: { ideaId: { type: "string", pattern: "^IDEA-\\d{4,}$" } },
};

const ok = { id: "20261030-101500-round-totals", type: "Fixed", summary: "Invoice totals round to 2 decimals", created: "2026-10-30", ideas: ["IDEA-0001"], author: null };

test("CH-13 a valid record has no errors", () => {
  assert.deepEqual(validate(CHANGE, ok), []);
});

test("AC-CH-13.1 a malformed record names the field and the reason", () => {
  const errors = validate(CHANGE, { ...ok, type: "Improved", summary: "x".repeat(201), extra: 1, created: "2026-13-40", ideas: ["IDEA-7"], links: [{ url: "javascript:alert(1)" }] });
  const lines = describeErrors(".syno/changes/a.json", errors);
  assert.ok(lines.includes('.syno/changes/a.json: type must be one of "Added", "Changed", "Deprecated", "Removed", "Fixed", "Security"'), lines.join("\n"));
  assert.ok(lines.some((l) => l.endsWith("summary must have at most 200 characters")));
  assert.ok(lines.some((l) => l.endsWith("extra is not a known field")));
  assert.ok(lines.some((l) => l.endsWith("created must be a valid date")));
  assert.ok(lines.some((l) => l.includes("ideas[0] must match")));
  assert.ok(lines.some((l) => l.includes("links[0].url must be a valid uri-http")));
});

test("CH-13 missing required fields and wrong types are reported", () => {
  const errors = validate(CHANGE, { id: 7 });
  assert.deepEqual(
    errors.map((e) => `${e.path} ${e.message}`),
    ["type is required", "summary is required", "id must be string, not integer"],
  );
  assert.deepEqual(validate(CHANGE, "nope"), [{ path: "(record)", message: "must be object, not string" }]);
});

test("CH-13 numbers, integers, item counts and date-times are checked", () => {
  const schema = { type: "object", properties: { n: { type: "integer", minimum: 1, maximum: 3 }, list: { type: "array", minItems: 1, maxItems: 2 }, at: { type: "string", format: "date-time" } } };
  assert.deepEqual(validate(schema, { n: 2, list: [1], at: "2026-10-30T10:15:00Z" }), []);
  assert.equal(validate(schema, { n: 2.5 }).length, 1);
  assert.equal(validate(schema, { n: 9, list: [], at: "yesterday" }).length, 3);
});
