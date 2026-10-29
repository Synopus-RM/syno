// The one Syno brief Claude sees at session start (PRD X-02, CH-12): at most 8
// lines from Syno's functions, then the Governor's own device brief. Silent when
// no function has anything to say. Pure: handlers pass their lines in.

export const MAX_LINES = 8;

/**
 * parts: [{ source, lines?: string[], context?: string }] in dispatch order.
 * Returns the text to add to Claude's context, or "" for nothing.
 */
export function composeBrief(parts) {
  const lines = [];
  for (const part of parts) {
    for (const line of part.lines ?? []) {
      const text = String(line).trim();
      if (text && lines.length < MAX_LINES) lines.push(`- ${text}`);
    }
  }
  const contexts = parts.map((p) => String(p.context ?? "").trim()).filter(Boolean);
  const blocks = [];
  if (lines.length) blocks.push(["Syno brief for this project:", ...lines].join("\n"));
  blocks.push(...contexts);
  return blocks.join("\n\n");
}

const RANK = { deny: 3, ask: 2, allow: 1 };

/** The strictest permission decision wins (deny over ask over allow); null when none was given. */
export function strictestDecision(parts) {
  let best = null;
  for (const { decision } of parts) {
    if (!decision?.permissionDecision) continue;
    if (!best || (RANK[decision.permissionDecision] ?? 0) > (RANK[best.permissionDecision] ?? 0)) best = decision;
  }
  return best;
}
