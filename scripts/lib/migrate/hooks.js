// Migration's line in the session-start brief (PRD X-03): one line while the
// old standalone plugins are still enabled. Reads only.
import { oldPlugins } from "./cli.js";

export function handle(event) {
  if (event !== "SessionStart") return null;
  const old = oldPlugins().map((id) => id.split("@")[0]);
  return old.length ? { lines: [`Migrate: the old ${old.join(", ")} plugin${old.length === 1 ? " is" : "s are"} still installed. Run /syno:migrate to move to Syno.`] } : null;
}
