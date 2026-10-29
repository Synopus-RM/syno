#!/usr/bin/env node
// Syno Pulse's report_update MCP server (PRD S-02), ported from Synopus Insider (F-05). Dependency-free on purpose: Claude Code
// doesn't run `npm install` for plugins it installs from a repo, so this
// speaks MCP's stdio transport (newline-delimited JSON-RPC 2.0) directly.
import { createInterface } from "node:readline";
import { DETAIL_MAX, TITLE_MAX, deviceCredentials, findEnabledProject } from "../scripts/lib/pulse/config.js";
import { enqueue, newEventId } from "../scripts/lib/pulse/queue.js";
import { redactEvent } from "../scripts/lib/pulse/redact.js";
import { flushInBackground } from "../scripts/lib/pulse/sender.js";
import { currentSession, isRevoked, recordInSession } from "../scripts/lib/pulse/state.js";

const SERVER_INFO = { name: "syno-pulse", version: "0.1.0" };
const DEFAULT_PROTOCOL = "2025-06-18";
const TYPES = ["milestone", "progress", "blocker", "blocker_resolved", "note"];

const TOOL = {
  name: "report_update",
  description:
    "Report project progress to the Synopus PM panel (Syno Pulse). Use after finishing a task from the plan (milestone), with done/total against the plan or PRD checklist (progress), when blocked or waiting on the project manager (blocker), and when unblocked (blocker_resolved with the blockerId you were given). Never include code, secrets, prompts, file paths or file contents.",
  inputSchema: {
    type: "object",
    properties: {
      type: { type: "string", enum: TYPES },
      title: { type: "string", maxLength: TITLE_MAX, description: "One line, e.g. 'Ingest API endpoints done'." },
      detail: { type: "string", maxLength: DETAIL_MAX, description: "Optional short context." },
      done: { type: "integer", minimum: 0, description: "progress: tasks done." },
      total: { type: "integer", minimum: 1, description: "progress: tasks in the plan." },
      blockerId: { type: "string", description: "blocker_resolved: the id returned when the blocker was reported." },
    },
    required: ["type"],
    additionalProperties: false,
  },
};

const text = (message, isError = false) => ({ content: [{ type: "text", text: message }], ...(isError ? { isError } : {}) });

/** Validates, redacts and queues one update. Exported for tests. */
export function reportUpdate(args, cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd()) {
  const project = findEnabledProject(cwd);
  if (!project) return text("Syno Pulse isn't enabled in this project; nothing was sent.");
  const creds = deviceCredentials();
  if (!creds) return text("This machine hasn't joined Syno Pulse (/syno:pulse join); nothing was sent.");
  if (isRevoked()) return text("This machine's Pulse key was revoked (/syno:pulse join to rejoin); nothing was sent.");

  const { type, title, detail, done, total, blockerId } = args ?? {};
  if (!TYPES.includes(type)) return text(`type must be one of: ${TYPES.join(", ")}.`, true);
  if (type !== "progress" && (typeof title !== "string" || !title.trim())) return text("title is required.", true);
  const hasProgress = Number.isInteger(done) && Number.isInteger(total) && done >= 0 && total >= 1 && done <= total;
  if (type === "progress" && !hasProgress) return text("progress needs integers done and total, with 0 ≤ done ≤ total.", true);
  if (type === "blocker_resolved" && !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(blockerId ?? "")) return text("blocker_resolved needs the blockerId you were given.", true);

  const id = newEventId();
  const sessionId = currentSession(project.projectKey) ?? "unknown";
  const data = {
    ...(hasProgress ? { done, total } : {}),
    ...(type === "blocker_resolved" ? { blockerId } : {}),
  };
  const event = redactEvent(
    {
      id,
      type,
      projectKey: project.projectKey,
      sessionId,
      at: new Date().toISOString(),
      title: type === "progress" && !title ? `Progress: ${done}/${total}` : title,
      detail,
      ...(Object.keys(data).length ? { data } : {}),
    },
    creds.memberEmail,
  );
  if (!enqueue(event)) return text("The update was too large to send; shorten the detail.", true);
  if (type === "milestone") recordInSession(sessionId, { milestone: true });
  flushInBackground();
  return text(type === "blocker" ? `Reported blocker. blockerId: ${id} (use it with blocker_resolved).` : `Reported ${type}.`);
}

function handle(message) {
  const { id, method, params } = message;
  switch (method) {
    case "initialize":
      return { protocolVersion: params?.protocolVersion ?? DEFAULT_PROTOCOL, capabilities: { tools: {} }, serverInfo: SERVER_INFO };
    case "ping":
      return {};
    case "tools/list":
      return { tools: [TOOL] };
    case "tools/call":
      if (params?.name !== TOOL.name) throw Object.assign(new Error(`Unknown tool: ${params?.name}`), { code: -32602 });
      return reportUpdate(params.arguments);
    default:
      if (id === undefined) return undefined; // notifications need no reply
      throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 });
  }
}

function serve() {
  const send = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);
  createInterface({ input: process.stdin }).on("line", (line) => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    }
    try {
      const result = handle(message);
      if (message.id !== undefined && result !== undefined) send({ jsonrpc: "2.0", id: message.id, result });
    } catch (err) {
      if (message.id !== undefined) send({ jsonrpc: "2.0", id: message.id, error: { code: err.code ?? -32603, message: err.message } });
    }
  });
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) serve();
