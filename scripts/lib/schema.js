// A small JSON Schema checker for Syno's own records (PRD CH-13, §8), so no
// validator library is needed. It covers the subset Syno's schemas use: type,
// required, properties, additionalProperties, items, enum, const, pattern,
// minLength, maxLength, minimum, maximum, minItems, maxItems, format (date,
// date-time, uri-http) and local $ref ("#/$defs/name"). Errors name the field.

const FORMATS = {
  date: (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)),
  "date-time": (s) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(s) && !Number.isNaN(Date.parse(s)),
  "uri-http": (s) => /^https?:\/\/[^\s/$.?#][^\s]*$/i.test(s),
};

function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
}

const typeMatches = (want, got) => want === got || (want === "number" && got === "integer");

const fieldPath = (path) => path.replace(/^\./, "") || "(record)";

function resolveRef(root, ref) {
  const m = /^#\/\$defs\/([\w-]+)$/.exec(ref);
  if (!m || !root.$defs?.[m[1]]) throw new Error(`Schema error: unknown $ref ${ref}`);
  return root.$defs[m[1]];
}

function checkScalar(schema, value, path, errors) {
  const at = fieldPath(path);
  if (schema.enum && !schema.enum.some((e) => e === value)) errors.push({ path: at, message: `must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(", ")}` });
  if ("const" in schema && schema.const !== value) errors.push({ path: at, message: `must be ${JSON.stringify(schema.const)}` });
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push({ path: at, message: `must have at least ${schema.minLength} characters` });
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push({ path: at, message: `must have at most ${schema.maxLength} characters` });
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push({ path: at, message: `must match ${schema.pattern}` });
    if (schema.format && FORMATS[schema.format] && !FORMATS[schema.format](value)) errors.push({ path: at, message: `must be a valid ${schema.format}` });
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push({ path: at, message: `must be at least ${schema.minimum}` });
    if (schema.maximum !== undefined && value > schema.maximum) errors.push({ path: at, message: `must be at most ${schema.maximum}` });
  }
}

function checkObject(schema, value, path, errors, root) {
  for (const key of schema.required ?? []) {
    if (!(key in value)) errors.push({ path: fieldPath(`${path}.${key}`), message: "is required" });
  }
  for (const [key, child] of Object.entries(value)) {
    const sub = schema.properties?.[key];
    if (sub) walk(sub, child, `${path}.${key}`, errors, root);
    else if (schema.additionalProperties === false) errors.push({ path: fieldPath(`${path}.${key}`), message: "is not a known field" });
    else if (typeof schema.additionalProperties === "object") walk(schema.additionalProperties, child, `${path}.${key}`, errors, root);
  }
}

function checkArray(schema, value, path, errors, root) {
  const at = fieldPath(path);
  if (schema.minItems !== undefined && value.length < schema.minItems) errors.push({ path: at, message: `must have at least ${schema.minItems} items` });
  if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push({ path: at, message: `must have at most ${schema.maxItems} items` });
  if (schema.items) value.forEach((item, i) => walk(schema.items, item, `${path}[${i}]`, errors, root));
}

function walk(schema, value, path, errors, root) {
  if (schema.$ref) return walk(resolveRef(root, schema.$ref), value, path, errors, root);
  const got = typeOf(value);
  if (schema.type) {
    const wants = [].concat(schema.type);
    if (!wants.some((w) => typeMatches(w, got))) {
      errors.push({ path: fieldPath(path), message: `must be ${wants.join(" or ")}, not ${got}` });
      return;
    }
  }
  checkScalar(schema, value, path, errors);
  if (got === "object") checkObject(schema, value, path, errors, root);
  if (got === "array") checkArray(schema, value, path, errors, root);
}

/** Checks `value` against `schema`. Returns [] when valid, else [{ path, message }]. */
export function validate(schema, value) {
  const errors = [];
  walk(schema, value, "", errors, schema);
  return errors;
}

/** One line per error, for people: "<file>: <field> <reason>". */
export const describeErrors = (file, errors) => errors.map((e) => `${file}: ${e.path} ${e.message}`);
