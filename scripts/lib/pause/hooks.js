// Syno Pause's line in the session-start brief (PRD S-12 rule 6): one line
// while a paused session is waiting. Reads only.
import { readerDate } from "../report/render.js";
import { projectRoot } from "../sigma/hooks.js";
import { sessions } from "./cli.js";

export function handle(event, input, env) {
  if (event !== "SessionStart") return null;
  const root = projectRoot(env.cwd);
  const waiting = root ? sessions(root).find((s) => !s.meta.resumedAt) : null;
  return waiting ? { lines: [`Paused: ${waiting.meta.title} (${readerDate(waiting.meta.paused.slice(0, 10))}). Run /syno:resume to continue.`] } : null;
}
