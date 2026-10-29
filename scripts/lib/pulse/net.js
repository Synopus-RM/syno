// The only module in Syno that opens a network connection (PRD §5.2, S-02). A
// thin client for /api/reporter/* on synopus.in. It never throws: network
// trouble comes back as { status: 0 } so callers can back off quietly. There is
// no call whose answer can change what a session does: the panel only watches.
import { apiBase } from "./config.js";

const TIMEOUT_MS = 5000;

async function call(path, { method = "GET", token, body } = {}) {
  try {
    const res = await fetch(`${apiBase()}/api/reporter${path}`, {
      method,
      headers: {
        ...(body ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    let json = null;
    try {
      json = await res.json();
    } catch {}
    return { status: res.status, json };
  } catch {
    return { status: 0, json: null };
  }
}

export const registerDevice = (body) => call("/register", { method: "POST", body: { kind: "device", ...body } });

export const registerProject = (token, body) => call("/register", { method: "POST", token, body: { kind: "project", ...body } });

/** Whether the device is active or revoked, and which event types the site accepts. */
export const getStatus = (token, projectKey) => call(`/status?projectKey=${encodeURIComponent(projectKey)}`, { token });

export const postEvents = (token, events) => call("/events", { method: "POST", token, body: { events } });

export const leaveDevice = (token) => call("/leave", { method: "POST", token, body: {} });
