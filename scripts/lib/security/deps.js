// Syno Security's dependency scan (PRD S-16 rule 5): the project's own audit
// tool, run through Syno Governor after a yes. Syno never contacts a
// vulnerability database itself; it only reads the tool's JSON.
import { existsSync } from "node:fs";
import { join } from "node:path";

const LEVEL = { critical: "Critical", high: "High", moderate: "Medium", medium: "Medium", low: "Low", info: "Low" };

/** The audit tool for this project, or null. */
export function auditCommand(root) {
  const has = (f) => existsSync(join(root, f));
  if (has("pnpm-lock.yaml")) return { tool: "pnpm", command: "pnpm audit --json" };
  if (has("package-lock.json")) return { tool: "npm", command: "npm audit --json" };
  if (has("requirements.txt") || has("pyproject.toml")) return { tool: "pip-audit", command: "pip-audit -f json" };
  if (has("Cargo.lock")) return { tool: "cargo", command: "cargo audit --json" };
  return null;
}

const finding = (pkg, title, severity, fix) => ({ category: "dependency", severity, title: `${pkg}: ${title}`, reason: "A library the project uses has a known security hole.", evidence: [{ file: "dependencies", command: "audit tool" }], fix });

/** Findings from the tool's JSON output. */
export function parseAudit(tool, output) {
  let data;
  try {
    data = JSON.parse(output);
  } catch {
    return [];
  }
  if (tool === "npm" || tool === "pnpm") {
    if (data.vulnerabilities) {
      return Object.entries(data.vulnerabilities).map(([name, v]) => {
        const via = v.via?.find((x) => typeof x === "object");
        return finding(name, via?.title ?? "known vulnerability", LEVEL[v.severity] ?? "High", v.fixAvailable ? "Update it (npm audit fix, or the version the advisory names)." : "No fix yet: check whether the risky part is used, or replace the library.");
      });
    }
    return Object.values(data.advisories ?? {}).map((a) => finding(a.module_name, a.title, LEVEL[a.severity] ?? "High", a.patched_versions ? `Update to ${a.patched_versions}.` : "No fix yet."));
  }
  if (tool === "pip-audit") {
    return (data.dependencies ?? []).flatMap((d) => (d.vulns ?? []).map((v) => finding(`${d.name} ${d.version}`, v.id, "High", v.fix_versions?.length ? `Update to ${v.fix_versions[0]}.` : "No fix yet.")));
  }
  if (tool === "cargo") {
    return (data.vulnerabilities?.list ?? []).map((v) => finding(v.advisory?.package ?? "crate", v.advisory?.title ?? v.advisory?.id, "High", v.versions?.patched?.length ? `Update to ${v.versions.patched[0]}.` : "No fix yet."));
  }
  return [];
}
