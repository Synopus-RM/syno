// The local-only rule for attack tests (PRD S-16 rule 6, §10). A test may reach
// only localhost, 127.0.0.1, [::1] and hosts ending in .localhost or .test.
// Every URL in a plan is checked before any request is made (AC-SE.1). Pure.

const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** True for an http(s) URL on a local host. */
export function isLocalUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return LOCAL.has(host) || host.endsWith(".localhost") || host.endsWith(".test");
}

/** Every request URL in an attack plan (with its base applied). */
export function planUrls(plan) {
  return (plan?.cases ?? []).flatMap((c) => (c.requests ?? []).map((r) => {
    try {
      return new URL(r.url, plan.base).href;
    } catch {
      return String(r.url);
    }
  }));
}

/** Throws before anything runs if any URL in the plan isn't local. */
export function assertLocalPlan(plan) {
  const bad = planUrls(plan).filter((u) => !isLocalUrl(u));
  if (bad.length) throw Object.assign(new Error(`Refused: attack tests may reach only localhost, 127.0.0.1, [::1], *.localhost and *.test. Not local: ${[...new Set(bad)].join(", ")}`), { exit: 3 });
  if (!planUrls(plan).length) throw Object.assign(new Error("The attack plan has no requests."), { exit: 2 });
}
