// Syno Security's own scans (PRD S-16 rules 3 and 4). Read-only: tracked files,
// and git history only with --history. Secrets are only ever kept masked
// (first 4 characters), and with their file and line in the local report only.
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { tryGit } from "../git.js";
import { projectFiles } from "../fives/scan.js";

const SECRET_PATTERNS = [
  { name: "Private key", re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/, severity: "Critical" },
  { name: "AWS access key", re: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/, severity: "Critical" },
  { name: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/, severity: "Critical" },
  { name: "Stripe live key", re: /\b(sk|rk)_live_[0-9a-zA-Z]{16,}\b/, severity: "Critical" },
  { name: "Stripe test key", re: /\b(sk|rk)_test_[0-9a-zA-Z]{16,}\b/, severity: "Medium" },
  { name: "Razorpay key", re: /\brzp_(live|test)_[0-9a-zA-Z]{10,}\b/, severity: "High" },
  { name: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/, severity: "High" },
  { name: "Slack token", re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/, severity: "High" },
  { name: "JSON Web Token", re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, severity: "High" },
];
const ASSIGNED = /\b(api[_-]?key|secret|password|passwd|token|auth[_-]?key|private[_-]?key)\b\s*[:=]\s*["'`]([^"'`\s]{12,})["'`]/i;
const SKIP = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|poetry\.lock)$|\.min\.(js|css)$|\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|woff2?|ttf|mp4|mp3)$/i;
// Keys on these variables are sent to the browser on purpose (a Firebase web key, a Maps key), so they are
// not secrets; the risk is a key that isn't restricted to the app's own domains.
const PUBLIC_VAR = /\b(NEXT_PUBLIC|VITE|EXPO_PUBLIC|REACT_APP|PUBLIC|NUXT_PUBLIC)_\w+\s*[:=]/;
const BROWSER_KEYS = new Set(["Google API key"]);
const PLACEHOLDER = /^(x{4,}|\*{4,}|your[_-]|changeme|example|placeholder|dummy|test1234|<.*>|\$\{.*\})/i;

export const mask = (value) => `${value.slice(0, 4)}…`;

/** Shannon entropy in bits per character. */
export function entropy(s) {
  const counts = {};
  for (const ch of s) counts[ch] = (counts[ch] ?? 0) + 1;
  return -Object.values(counts).reduce((sum, n) => sum + (n / s.length) * Math.log2(n / s.length), 0);
}

/** Secrets in one line of text: [{ name, severity, masked }]. */
export function secretsIn(line) {
  const out = [];
  for (const p of SECRET_PATTERNS) {
    const m = p.re.exec(line);
    if (m && BROWSER_KEYS.has(p.name) && PUBLIC_VAR.test(line)) out.push({ name: `Public ${p.name}`, severity: "Low", masked: mask(m[0]), public: true });
    else if (m) out.push({ name: p.name, severity: p.severity, masked: mask(m[0]) });
  }
  const a = ASSIGNED.exec(line);
  if (!out.length && a && !PLACEHOLDER.test(a[2]) && entropy(a[2]) >= 3.5) out.push({ name: `Hard-coded ${a[1].toLowerCase()}`, severity: "High", masked: mask(a[2]) });
  return out;
}

export function scanSecrets(root, { history = false } = {}) {
  const findings = [];
  for (const f of projectFiles(root).filter((x) => !SKIP.test(x))) {
    if (statSync(join(root, f)).size > 1_000_000) continue;
    readFileSync(join(root, f), "utf8").split("\n").forEach((line, i) => {
      for (const s of secretsIn(line)) findings.push(s.public
        ? { category: "secret", severity: "Low", title: `${s.name} in a tracked file`, reason: "This key reaches the browser by design, so it isn't secret, but anyone can reuse it if it isn't restricted.", evidence: [{ file: f, line: i + 1, masked: s.masked }], fix: "In Google Cloud, restrict the key to your own domains and only the APIs the app uses. In an example file, a placeholder is enough." }
        : { category: "secret", severity: s.severity, title: `${s.name} in a tracked file`, reason: "Anyone with the code can use it. Revoke it, then move it to an environment variable.", evidence: [{ file: f, line: i + 1, masked: s.masked }], fix: "Revoke the key, load it from an environment variable, and keep the real value out of git." });
    });
  }
  if (history) {
    let commit = null;
    for (const line of (tryGit(["log", "-p", "--all", "--no-color", "--format=commit %h"], { cwd: root }) ?? "").split("\n")) {
      if (line.startsWith("commit ")) commit = line.slice(7);
      else if (line.startsWith("+") && !line.startsWith("+++")) for (const s of secretsIn(line)) findings.push({ category: "secret", severity: s.severity, title: `${s.name} in git history`, reason: "It stays in every clone of the repository, even after the file changes.", evidence: [{ commit, masked: s.masked }], fix: "Revoke the key. Removing it from history needs a history rewrite, which only you can decide on." });
    }
  }
  return findings;
}

const ROUTE_FILE = /(^|\/)(app\/(.*\/)?route\.(js|ts)|pages\/api\/.+\.(js|ts))$/;
const EXPRESS_ROUTE = /\b(app|router)\.(get|post|put|patch|delete|all)\(\s*["'`]([^"'`]+)["'`]/;
const AUTH = /\b\w*(auth|session|currentuser|requireuser|verifytoken|verifyidtoken|jwt|isauthenticated|ensureloggedin|passport|clerk|getuser|protect|authori[sz]e|permission|role|isadmin|guard)\w*\b/i;
const PUBLIC = /syno:\s*public/;

/** Routes with no server-side permission check (AC-SE.3): High, unless marked `syno: public`. */
export function scanRoutes(root) {
  const findings = [];
  const add = (file, line, what) => findings.push({ category: "access", severity: "High", title: `${what} has no server-side permission check`, reason: "Anyone who finds the address can call it.", evidence: [{ file, line }], fix: "Check the user's session and role on the server before doing anything, or mark it `// syno: public` if it is meant to be open." });
  for (const f of projectFiles(root).filter((x) => /\.(js|ts|mjs|cjs)$/.test(x))) {
    const text = readFileSync(join(root, f), "utf8");
    const lines = text.split("\n");
    if (ROUTE_FILE.test(f)) {
      if (AUTH.test(text) || PUBLIC.test(text)) continue;
      const at = lines.findIndex((l) => /export\s+(async\s+)?(function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b|export\s+default/.test(l));
      add(f, at + 1 || 1, `The route ${f}`);
      continue;
    }
    const guardedFile = lines.some((l) => /\b(app|router)\.use\(/.test(l) && AUTH.test(l));
    lines.forEach((l, i) => {
      const m = EXPRESS_ROUTE.exec(l);
      if (m && !guardedFile && !AUTH.test(l.replace(m[0], "")) && !PUBLIC.test(l) && !PUBLIC.test(lines[i - 1] ?? "")) add(f, i + 1, `The route ${m[2].toUpperCase()} ${m[3]}`);
    });
  }
  return findings;
}
