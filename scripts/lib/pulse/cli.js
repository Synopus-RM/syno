// Syno Pulse's commands (PRD S-02), ported from Insider's cli.mjs:
//   syno pulse enable [--name N] [--confirm]   select this project (.syno/pulse.json)
//   syno pulse disable [--confirm]             unselect it
//   syno pulse notice                          the consent notice, version 2
//   syno pulse join --accept [--name N] [--email E] [--label L]   join, with no approval step
//   syno pulse leave [--confirm]               revoke this machine and delete its Pulse data
//   syno pulse set-key                         store the team enrolment key (read from stdin)
//   syno pulse status                          what Pulse knows about this project and machine
import { randomBytes } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { hostname } from "node:os";
import { basename, join } from "node:path";
import { WritePlan, jsonText, readJson as readProjectJson, usage } from "../fsutil.js";
import { tryGit } from "../git.js";
import { CONSENT_VERSION, MARKER, configDir, deviceCredentials, findEnabledProject, findLegacyProject, legacyDirs, normaliseRemote, paths, projectKeyFor, readJson, sha256, stateDir, writeJson } from "./config.js";
import { segments, readSegment } from "./queue.js";
import { acceptedTypes, cachedStatus, clearRevoked, isRevoked } from "./state.js";

export const PLUGIN_ID = "syno@synopus";
export const MARKETPLACE = { source: { source: "github", repo: "rishimurugan-synopus/syno" } };

export const NOTICE = `Syno Pulse — what this machine will send (notice version 2)

Sent, only for projects enabled with /syno:pulse enable:
  • your name and git email, and a label for this machine
  • which project, session start and end times, and activity timestamps
  • commit SHAs and subjects; test and build pass/fail counts
  • short summaries Claude writes for milestones, progress and blockers
  • results of Syno functions, as titles and counts only: releases, tasks,
    progress, audit, device parity, test results, quality, 5S, compliance
    and security

Never sent: code, diffs, file contents, file paths, prompts, Claude's
replies, transcripts. Anything that looks like a key or password is
replaced with [redacted] first.

Why: project status, quality and effort tracking for Synopus. The panel
can only view this data; it cannot send anything back to your sessions.
Where: Synopus's Firebase project, Mumbai (asia-south1). Kept 12 months.
Withdraw any time: /syno:pulse leave revokes this machine and deletes
local data. Ask the PM to delete what is already stored.`;

const projectRoot = (cwd) => tryGit(["rev-parse", "--show-toplevel"], { cwd }) || cwd;
const result = (text, data = {}, code = 0) => ({ code, text, data });

function enable(ctx) {
  const root = projectRoot(ctx.repo);
  const remote = normaliseRemote(tryGit(["config", "--get", "remote.origin.url"], { cwd: root }));
  const [repoHost, ...rest] = remote ? remote.split("/") : [];
  const name = typeof ctx.flags.name === "string" ? ctx.flags.name : basename(root);
  const project = { projectKey: projectKeyFor({ remoteUrl: remote ? `https://${remote}` : null, root }), displayName: name.slice(0, 120), ...(remote ? { repoHost, repoPath: rest.join("/") } : {}) };
  const settings = readProjectJson(join(root, ".claude", "settings.json"), {});
  settings.enabledPlugins = { ...(settings.enabledPlugins ?? {}), [PLUGIN_ID]: true };
  settings.extraKnownMarketplaces = { ...(settings.extraKnownMarketplaces ?? {}), synopus: MARKETPLACE };
  const plan = new WritePlan(root).write(MARKER, jsonText(project)).write(".claude/settings.json", jsonText(settings));
  const applied = plan.apply({ confirm: ctx.confirm });
  const lines = applied.applied
    ? [`Enabled Syno Pulse for "${project.displayName}".`, "Commit .syno/pulse.json and .claude/settings.json so teammates and cloud sessions follow.", "Each person's machine must also join with /syno:pulse join. There is no approval step."]
    : [`Syno Pulse would report "${project.displayName}" to the Synopus panel.`, ...plan.describe().map((l) => `  ${l}`), "Run again with --confirm to enable it."];
  return result(lines.join("\n"), { applied: applied.applied, ops: applied.ops, project });
}

function disable(ctx) {
  const root = projectRoot(ctx.repo);
  if (!findEnabledProject(root)) return result("Syno Pulse isn't enabled in this project.", { applied: false });
  const plan = new WritePlan(root).remove(MARKER);
  const applied = plan.apply({ confirm: ctx.confirm });
  return result(applied.applied ? "Disabled Syno Pulse here: removed .syno/pulse.json. Commit the change." : "Syno Pulse would stop reporting this project (removes .syno/pulse.json). Run again with --confirm.", { applied: applied.applied });
}

/** The team enrolment key, from Pulse's config or, once, from Insider's old one. */
function enrolmentKey() {
  const own = readJson(paths.config())?.enrolmentKey;
  if (own) return own;
  const legacy = readJson(join(legacyDirs().config, "config.json"))?.enrolmentKey;
  if (legacy) writeJson(paths.config(), { ...readJson(paths.config(), {}), enrolmentKey: legacy });
  return legacy ?? null;
}

async function join_(ctx) {
  if (ctx.flags.accept !== true) return result(`${NOTICE}\n\nNot joined: run again with --accept once the person has agreed.`, { joined: false });
  const key = enrolmentKey();
  if (!key) return result(["This machine has no team enrolment key yet. Ask the PM for it, then run this in your own terminal (it reads the key without showing it in the chat):", `  node "${join(ctx.pluginRoot, "scripts", "syno.js")}" pulse set-key`].join("\n"), { joined: false, needsKey: true });
  const name = (typeof ctx.flags.name === "string" && ctx.flags.name) || tryGit(["config", "--get", "user.name"], { cwd: ctx.repo }) || "Unknown";
  const email = String((typeof ctx.flags.email === "string" && ctx.flags.email) || tryGit(["config", "--get", "user.email"], { cwd: ctx.repo }) || "").toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw usage("No valid email: pass --email or set git config user.email.");
  const label = String((typeof ctx.flags.label === "string" && ctx.flags.label) || hostname()).slice(0, 80);
  const token = randomBytes(32).toString("base64url");
  const consentAt = new Date().toISOString();
  const { registerDevice } = await import("./net.js");
  const { status } = await registerDevice({ enrolmentKey: key, tokenHash: sha256(token), label, member: { name, email }, consent: { version: CONSENT_VERSION, at: consentAt } });
  if (status === 401) return result("The team enrolment key was refused. Ask the PM for the current key and run set-key again.", { joined: false }, 1);
  if (status === 400) return result("The Synopus panel hasn't been updated for Syno Pulse yet, so it can't accept the new notice. Nothing was saved; try again after the update.", { joined: false }, 1);
  if (status !== 200 && status !== 201) return result(`Couldn't reach the Synopus panel (status ${status || "offline"}). Nothing was saved; try again later.`, { joined: false }, 1);
  writeJson(paths.device(), { token, memberName: name, memberEmail: email, label, consentVersion: CONSENT_VERSION, consentAt });
  clearRevoked();
  return result(`Joined as ${name} <${email}> on "${label}". Projects enabled with Syno Pulse report from now on.`, { joined: true, label });
}

async function leave(ctx) {
  const creds = deviceCredentials();
  if (!ctx.confirm) return result("Leaving revokes this machine on the panel and deletes Pulse's secret, queue and cached status here. Run again with --confirm.", { applied: false });
  let revoked = false;
  if (creds && !creds.cloud) {
    const { leaveDevice } = await import("./net.js");
    revoked = (await leaveDevice(creds.token)).status === 200;
  }
  rmSync(paths.device(), { force: true });
  rmSync(stateDir(), { recursive: true, force: true });
  return result(["Left Syno Pulse on this machine: deleted the device secret, queue and cached status.", revoked ? "The panel revoked this machine." : "The panel couldn't be reached; ask the PM to revoke this machine.", "Ask the PM if you also want your stored data deleted."].join("\n"), { applied: true, revoked });
}

function setKey(text) {
  const trimmed = String(text ?? "").trim();
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(trimmed)) throw usage("That doesn't look like an enrolment key.");
  writeJson(paths.config(), { ...readJson(paths.config(), {}), enrolmentKey: trimmed });
  return result(`Saved the team enrolment key to ${configDir()}.`, { saved: true });
}

function status(ctx) {
  const project = findEnabledProject(ctx.repo);
  const creds = deviceCredentials();
  const cache = project ? cachedStatus(project.projectKey) : null;
  const waiting = segments().reduce((n, f) => n + readSegment(f).length, 0);
  const lines = [
    `Project: ${project ? `enabled ("${project.displayName}")` : findLegacyProject(ctx.repo) ? "Synopus Insider was enabled here; run /syno:migrate" : "not enabled"}`,
    `This machine: ${isRevoked() ? "its key was revoked; join again" : creds ? (creds.cloud ? "cloud environment key" : `joined as ${creds.memberEmail}`) : "not joined"}`,
    `Panel: ${cache ? `device ${cache.device}, accepts ${[...acceptedTypes()].length} event types` : "not checked yet"}`,
    `Waiting to send: ${waiting} events`,
  ];
  return result(lines.join("\n"), { enabled: Boolean(project), joined: Boolean(creds), revoked: isRevoked(), device: cache?.device ?? null, waiting });
}

export async function run(ctx) {
  const [sub = "status"] = ctx.args;
  switch (sub) {
    case "enable":
      return enable(ctx);
    case "disable":
      return disable(ctx);
    case "notice":
      return result(NOTICE, { notice: NOTICE, version: CONSENT_VERSION });
    case "join":
      return join_(ctx);
    case "leave":
      return leave(ctx);
    case "set-key":
      return setKey(readFileSync(0, "utf8"));
    case "status":
      return status(ctx);
    default:
      throw usage("pulse takes: enable, disable, notice, join, leave, set-key, status.");
  }
}
