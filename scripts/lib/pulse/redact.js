// Syno Pulse's redactor (ported from Synopus Insider, F-06): every text field passes through here before it is queued.
// Only summaries and metadata may leave the machine; anything that looks like a
// credential becomes [redacted]. Over-redacting a title is the cheap mistake.
import { DETAIL_MAX, TITLE_MAX } from "./config.js";

const R = "[redacted]";

const PATTERNS = [
  // Private key blocks (PEM, OpenSSH).
  [/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g, R],
  // JWTs.
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, R],
  // Provider keys by prefix.
  [/\bsk-(?:ant-|proj-|live-|test-)?[A-Za-z0-9_-]{16,}/g, R],
  [/\bAIza[0-9A-Za-z_-]{35}/g, R],
  [/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/g, R],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, R],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, R],
  [/\b[rsp]k_(?:live|test)_[A-Za-z0-9]{16,}/g, R],
  [/\bglpat-[A-Za-z0-9_-]{20,}/g, R],
  [/\bnpm_[A-Za-z0-9]{36}\b/g, R],
  // Authorization headers.
  [/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/-]{16,}=*/gi, `$1 ${R}`],
  // user:password@ inside URLs.
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s:@/]+:[^\s@/]+@/gi, `$1${R}@`],
  // KEY=value / KEY: value where the name says it is a secret.
  [
    /\b([A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|CREDENTIALS?|PRIVATE|AUTH)[A-Za-z0-9_]*)(\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;]+)/gi,
    `$1$2${R}`,
  ],
];

/** Long runs that mix digits and both letter cases look like keys, not words or paths. */
function redactHighEntropy(text) {
  return text
    .replace(/\b[a-f0-9]{32,}\b/gi, R)
    .replace(/[A-Za-z0-9+/_=-]{32,}/g, (run) => (/\d/.test(run) && /[a-z]/.test(run) && /[A-Z]/.test(run) ? R : run));
}

function redactEmails(text, keepEmail) {
  const keep = keepEmail?.toLowerCase();
  return text.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, (email) => (email.toLowerCase() === keep ? email : R));
}

export function redactText(text, { keepEmail, max } = {}) {
  if (typeof text !== "string" || text.length === 0) return undefined;
  let out = text;
  for (const [pattern, replacement] of PATTERNS) out = out.replace(pattern, replacement);
  out = redactHighEntropy(out);
  out = redactEmails(out, keepEmail);
  out = out.replace(/\s+/g, " ").trim();
  if (max && out.length > max) out = `${out.slice(0, max - 1)}…`;
  return out || undefined;
}

/** Redacts and caps an event's free-text fields; everything else is typed metadata. */
export function redactEvent(event, keepEmail) {
  const title = redactText(event.title, { keepEmail, max: TITLE_MAX });
  const detail = redactText(event.detail, { keepEmail, max: DETAIL_MAX });
  const out = { ...event };
  delete out.title;
  delete out.detail;
  if (title) out.title = title;
  if (detail) out.detail = detail;
  return out;
}
