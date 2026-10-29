// Syno Devices' commands (PRD S-06). The four skills (devices, devices-desktop,
// devices-mobile, devices-release) do the building, with the Python scripts in
// skills/devices/scripts/. This reads the project's app-sync.json and says, per
// platform, whether the app matches the web app: as text, as a report, and as
// a devices.parity event for Syno Pulse. It reads files only.
import { join } from "node:path";
import { WritePlan, readJson, usage } from "../fsutil.js";
import { describePlan, nowOf, notifyPulse } from "../chronicle/docs.js";
import { today } from "../chronicle/records.js";
import { compare, parse } from "../chronicle/semver.js";
import { planReport } from "../reports.js";

export const CONFIG = "app-sync.json";
const PLATFORMS = [["desktop", "Desktop (Windows, macOS, Linux)"], ["android", "Android"], ["ios", "iPhone and iPad (iOS)"]];
const MODE = { live: "Opens the live website", bundled: "Carries its own copy", "bundled-ota": "Carries a copy, updated over the air" };
const PLAIN = { desktop: "desktop app", android: "Android app", ios: "iPhone app" };

function webVersion(root, cfg) {
  if (cfg.versionSource === "web") return readJson(join(root, cfg.web?.root ?? ".", "package.json"))?.version ?? cfg.version ?? null;
  return cfg.version ?? null;
}

function appVersion(cfg, name) {
  const state = cfg.state ?? {};
  if (name === "desktop") return state.lastDesktopRelease?.version ?? null;
  const native = state.lastNativeRelease ?? {};
  return (native.platforms ?? []).includes(name) ? native.version ?? null : null;
}

function statusOf(mode, app, web) {
  if (!app) return "Not released yet";
  if (mode === "live" || mode === "bundled-ota") return "In sync";
  return parse(app) && parse(web) && compare(app, web) < 0 ? "Behind" : "In sync";
}

/** Each platform's state: { configured, app, webVersion, platforms: [{ name, label, mode, appVersion, webVersion, status }] }. */
export function parity(root) {
  const cfg = readJson(join(root, CONFIG));
  if (!cfg) return { configured: false, app: null, webVersion: null, platforms: PLATFORMS.map(([name, label]) => ({ name, label, mode: null, appVersion: null, webVersion: null, status: "Not set up" })) };
  const web = webVersion(root, cfg);
  const platforms = PLATFORMS.map(([name, label]) => {
    const p = cfg.platforms?.[name];
    if (!p?.enabled) return { name, label, mode: null, appVersion: null, webVersion: web, status: "Not set up" };
    const app = appVersion(cfg, name);
    return { name, label, mode: p.mode ?? null, appVersion: app, webVersion: web, status: statusOf(p.mode, app, web) };
  });
  return { configured: true, app: cfg.app?.name ?? null, webVersion: web, platforms };
}

/** The shared-look report for the owner and the client. */
export function devicesReport(state, { project, date }) {
  const used = state.platforms.filter((p) => p.status !== "Not set up");
  const late = used.filter((p) => p.status !== "In sync");
  const verdict = !used.length
    ? { level: "amber", text: "There are no desktop or mobile apps for this project yet." }
    : late.length
      ? { level: "amber", text: `${late.length} of ${used.length} apps don't match the web app yet.` }
      : { level: "green", text: `Every app matches the web app (version ${state.webVersion}).` };
  const summary = [
    state.configured ? `The web app is at version ${state.webVersion ?? "unknown"}.` : "Syno Devices isn't set up here yet.",
    `${used.length - late.length} of ${used.length} apps match the web app.`,
    ...late.map((p) => (p.status === "Behind" ? `The ${PLAIN[p.name]} is behind: it has ${p.appVersion}, the web has ${p.webVersion}.` : `The ${PLAIN[p.name]} hasn't been released yet.`)),
    "Apps that open the live website always show the latest web app.",
  ].slice(0, 5);
  while (summary.length < 3) summary.push("Run /syno:devices to set up or update the apps.");
  return {
    title: "Device apps",
    project,
    date,
    eyebrow: "Syno Devices",
    verdict,
    summary,
    actions: late.map((p) => ({ text: p.status === "Behind" ? `Release the ${PLAIN[p.name]} at version ${p.webVersion}` : `Make the first release of the ${PLAIN[p.name]}`, who: "Owner" })),
    sections: [{ heading: "Apps by platform", table: { columns: [{ label: "Platform" }, { label: "How it shows the web app" }, { label: "App version" }, { label: "Web version" }, { label: "Status" }], rows: state.platforms.map((p) => [p.label, MODE[p.mode] ?? "—", p.appVersion ?? "—", p.webVersion ?? "—", p.status]) } }],
    glossary: [
      { term: "Live app", meaning: "An app that opens the website itself, so it always shows the latest version." },
      { term: "Bundled app", meaning: "An app that carries its own copy of the website, updated with each app release." },
      { term: "Over the air", meaning: "Updating an app's copy of the website without a new store release." },
    ],
  };
}

const pulseData = (state) => ({ platforms: state.platforms.map(({ name, appVersion, webVersion, status }) => ({ name, appVersion, webVersion, status })) });

export async function run(ctx) {
  const [sub = "status"] = ctx.args;
  if (!["status", "report"].includes(sub)) throw usage("devices takes: status, report. Building and releasing the apps is done by the devices skills (/syno:devices).");
  const state = parity(ctx.repo);
  await notifyPulse(ctx.repo, "devices.parity", pulseData(state));
  const lines = state.platforms.map((p) => `${p.label.padEnd(32)} ${p.status}${p.appVersion ? ` (app ${p.appVersion}, web ${p.webVersion})` : ""}`);
  if (sub === "status") return { code: 0, text: lines.join("\n"), data: state };
  const project = readJson(join(ctx.repo, ".syno/config.json"))?.project?.name ?? state.app ?? "This project";
  const plan = new WritePlan(ctx.repo);
  const out = planReport(plan, "devices", devicesReport(state, { project, date: today(nowOf(ctx)) }));
  const applied = plan.apply({ confirm: ctx.confirm });
  return { code: 0, text: [...lines, "", describePlan(plan, applied.applied)].join("\n"), data: { ...state, applied: applied.applied, problems: out.problems, paths: out.paths } };
}
