// 5S's line in the session-start brief (PRD S-14 rule 6): a reminder when the
// last 5S check is more than 7 days old. Silent in projects that never ran one.
import { today } from "../chronicle/records.js";
import { projectRoot } from "../sigma/hooks.js";
import { daysSinceLast } from "./score.js";

export function handle(event, input, env) {
  if (event !== "SessionStart") return null;
  const root = projectRoot(env.cwd);
  const days = root ? daysSinceLast(root, today(env.now ? new Date(env.now) : new Date())) : null;
  return days !== null && days > 7 ? { lines: [`5S: the last check was ${days} days ago. Run /syno:5s to keep the project tidy.`] } : null;
}
