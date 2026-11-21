// Syno Console's status view (PRD S-17, design 5.9): the session tree drawn
// from node records, opening with a verdict a non-technical reader gets in one
// read. Pure: records and live session states come in as data.
import { namesFor } from "./model.mjs";

const WORDS = { planned: "Planned", running: "Running", "handed-off": "Handed off, waiting for merge", merged: "Merged", archived: "Archived", rework: "Rework", stopped: "Stopped" };
const LIVE = { working: "Working", blocked: "Blocked", review_ready: "Idle", completed: "Done", failed: "Failed" };
const ACTIVE = new Set(["running", "handed-off", "rework"]);

const liveWord = (bucket) => LIVE[String(bucket ?? "").toLowerCase().replace(/^session_status_bucket_/, "")] ?? null;
const byId = (a, b) => a.id.localeCompare(b.id, "en", { numeric: true });
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function title(node, cfg) {
  try {
    return namesFor(node.id, node.name ?? "", cfg).title;
  } catch {
    return node.id;
  }
}

function label(node, cfg, live, openQs) {
  const bucket = node.sessionId && ACTIVE.has(node.status) ? liveWord(live?.[node.sessionId]) : null;
  const waiting = openQs.filter((q) => q.from === node.id || String(q.from ?? "").startsWith(`${node.id}.`)).map((q) => q.id);
  return `${title(node, cfg)} — ${bucket ?? WORDS[node.status] ?? node.status}${waiting.length ? ` · waiting for your answer: ${waiting.join(", ")}` : ""}`;
}

function verdictOf(nodes, openQs, live) {
  const failing = nodes.filter((n) => n.status === "rework" || (n.sessionId && liveWord(live?.[n.sessionId]) === "Failed")).map((n) => n.id);
  if (failing.length) return `Red: ${failing.join(", ")} ${failing.length === 1 ? "needs" : "need"} rework or attention`;
  if (openQs.length) return `Amber: ${plural(openQs.length, "question")} ${openQs.length === 1 ? "waits" : "wait"} for you`;
  const running = nodes.filter((n) => ACTIVE.has(n.status)).length;
  return `Green: ${plural(running, "session")} running; nothing waits for you`;
}

/** { verdict, text } for /syno:console status. `live` maps session IDs to status buckets. */
export function renderTree({ nodes = [], questions = [], cfg, live = {} }) {
  const openQs = questions.filter((q) => q.status === "open");
  const shown = nodes.filter((n) => n.status !== "archived");
  const children = (parentId) => shown.filter((n) => n.parentId === parentId).sort(byId);
  const lines = [];
  const draw = (parentId, prefix) => {
    const kids = children(parentId);
    kids.forEach((node, i) => {
      const last = i === kids.length - 1;
      lines.push(`${prefix}${last ? "└─ " : "├─ "}${label(node, cfg, live, openQs)}`);
      draw(node.id, `${prefix}${last ? "   " : "│  "}`);
    });
  };
  draw("console", "");
  const verdict = verdictOf(nodes, openQs, live);
  const archived = nodes.length - shown.length;
  const consoleTitle = namesFor("console", "", cfg).title;
  return { verdict, text: [verdict, consoleTitle, ...lines, ...(archived ? [`(${archived} archived)`] : [])].join("\n") };
}
