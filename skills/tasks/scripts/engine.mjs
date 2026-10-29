// Breakdown engine: turns a hierarchical breakdown.json (+ facts.json from
// collect.mjs, + history.json) into a fully computed model — rolled-up progress
// at every level, dependency graph, critical path, resource-levelled forecast,
// ready queue, overdue / due-soon lists, owner workload, health and warnings.
//
// Pure functions only; render.mjs does the file I/O.

const STATUSES = ["done", "in_progress", "blocked", "todo"];
const TYPE_BY_DEPTH = ["phase", "epic", "task", "subtask", "step", "step", "step"];
const DAY = 86400000;

export function normStatus(s) {
  const v = String(s ?? "todo").toLowerCase().trim().replace(/[\s-]+/g, "_");
  if (["done", "complete", "completed", "finished", "shipped", "closed", "x"].includes(v)) return "done";
  if (["in_progress", "wip", "doing", "started", "ongoing", "partial", "active", "review", "in_review", "testing", "qa"].includes(v)) return "in_progress";
  if (["blocked", "on_hold", "waiting", "stuck", "paused"].includes(v)) return "blocked";
  if (["cancelled", "canceled", "dropped", "wont_do", "won't_do", "descoped"].includes(v)) return "cancelled";
  return "todo";
}

export const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Number(n) || 0));
const prioRank = (p) => ({ critical: -1, urgent: -1, high: 0, medium: 1, low: 2 }[String(p || "medium").toLowerCase()] ?? 1);
const round1 = (n) => Math.round(n * 10) / 10;

// ---------- Calendar ----------

function parseDate(d) {
  if (!d) return null;
  const t = new Date(/^\d{4}-\d{2}-\d{2}$/.test(d) ? d + "T00:00:00" : d);
  return isNaN(t) ? null : t;
}
const iso = (t) => (t ? `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}` : null);
const startOfDay = (t) => new Date(t.getFullYear(), t.getMonth(), t.getDate());

function makeCalendar(asOf, workingDays) {
  const wd = new Set(workingDays?.length ? workingDays : [1, 2, 3, 4, 5]);
  const base = startOfDay(asOf);
  const isWork = (t) => wd.has(t.getDay());
  // Working-day offset (can be fractional) from base → calendar date.
  const at = (offset) => {
    let t = new Date(base);
    let n = Math.max(0, Math.floor(offset + 1e-9));
    while (!isWork(t)) t = new Date(t.getTime() + DAY);
    while (n > 0) {
      t = new Date(t.getTime() + DAY);
      if (isWork(t)) n--;
    }
    return t;
  };
  // Signed working days between base and a date.
  const between = (date) => {
    const d = startOfDay(date);
    if (d.getTime() === base.getTime()) return 0;
    const sign = d > base ? 1 : -1;
    let n = 0, t = new Date(base);
    while (t.getTime() !== d.getTime()) {
      t = new Date(t.getTime() + sign * DAY);
      if (isWork(t)) n += sign;
      if (Math.abs(n) > 3650) break;
    }
    return n;
  };
  // Last working day touched by work that ends at a fractional offset.
  const endAt = (off) => at(Math.max(0, Math.ceil(off - 1e-9) - 1));
  return { at, endAt, between, base };
}

// ---------- Main ----------

export function compute(breakdown, facts = {}, history = []) {
  const warnings = [];
  const warn = (level, text, id) => warnings.push({ level, text, id: id || null });

  const settings = {
    estimateUnit: "h",
    hoursPerDay: 6,
    pointsPerDay: null,
    workingDays: [1, 2, 3, 4, 5, 6],
    unassignedLanes: 1,
    dueSoonDays: 3,
    ...(breakdown.settings || {}),
  };
  const unit = ["h", "d", "pts"].includes(settings.estimateUnit) ? settings.estimateUnit : "h";
  const asOfDate = parseDate(breakdown.asOf) || new Date(facts.collectedAt || Date.now());
  const asOf = asOfDate.toISOString();
  const cal = makeCalendar(asOfDate, settings.workingDays);
  const team = breakdown.team || [];
  const teamByName = Object.fromEntries(team.map((m) => [m.name, m]));

  const roots = breakdown.tree || breakdown.phases || breakdown.items || [];

  // ---- Flatten, assign IDs and types ----
  const nodes = [];
  const byId = new Map();
  const seen = new Set();
  function visit(raw, parent, index, depth) {
    let id = raw.id != null ? String(raw.id).trim() : parent ? `${parent.id}.${index + 1}` : `P${index + 1}`;
    if (seen.has(id)) {
      const fixed = `${id}~${index + 1}`;
      warn("error", `Duplicate id "${id}" — renamed to "${fixed}". Give every node a unique id.`, fixed);
      id = fixed;
    }
    seen.add(id);
    const kids = raw.children || raw.tasks || raw.subtasks || raw.items || [];
    const n = {
      id, title: raw.title || raw.name || "(untitled)", type: raw.type || TYPE_BY_DEPTH[depth] || "step",
      parentId: parent?.id || null, depth, children: [], leaf: kids.length === 0,
      rawStatus: raw.status != null ? normStatus(raw.status) : null,
      percent: raw.percent, estimate: raw.estimate != null ? Number(raw.estimate) : null, actual: raw.actual != null ? Number(raw.actual) : null,
      owner: raw.owner || null, priority: raw.priority ? String(raw.priority).toLowerCase() : null,
      start: raw.start || null, due: raw.due || null, completed: raw.completed || raw.doneDate || null,
      dependsOn: [].concat(raw.dependsOn || raw.depends || []).map(String).filter(Boolean),
      acceptance: (raw.acceptance || []).map((a) => (typeof a === "string" ? { text: a, done: false } : { text: a.text, done: !!a.done })),
      evidence: raw.evidence || null, source: raw.source || null, verified: raw.verified,
      git: raw.git || null, next: raw.next || null, blocker: raw.blocker || null,
      tags: raw.tags || [], notes: raw.notes || null, description: raw.description || null,
      phaseId: parent ? null : id,
    };
    if (parent) {
      n.phaseId = parent.phaseId;
      parent.children.push(id);
      if (!n.owner && (parent.owner || parent.inheritedOwner)) n.inheritedOwner = parent.owner || parent.inheritedOwner;
    }
    nodes.push(n);
    byId.set(id, n);
    kids.forEach((k, i) => visit(k, n, i, depth + 1));
  }
  roots.forEach((r, i) => visit(r, null, i, 0));

  if (!nodes.length) warn("error", "The breakdown has no nodes. Add phases with tasks under `tree`.");

  const leaves = nodes.filter((n) => n.leaf);
  const effOwner = (n) => n.owner || n.inheritedOwner || null;

  // ---- Estimates ----
  const given = leaves.map((l) => l.estimate).filter((e) => e > 0).sort((a, b) => a - b);
  const median = given.length ? given[Math.floor(given.length / 2)] : unit === "h" ? settings.hoursPerDay : 1;
  let missingEst = 0;
  for (const l of leaves) {
    l.estimated = l.estimate > 0;
    if (!l.estimated) { l.est = median; missingEst++; } else l.est = l.estimate;
  }
  if (missingEst) warn("info", `${missingEst} task(s) have no estimate — assumed ${median}${unit} (the median) for progress and forecast maths.`);

  // ---- Leaf status & percent ----
  for (const l of leaves) {
    l.status = l.rawStatus || "todo";
    const acc = l.acceptance.length ? (l.acceptance.filter((a) => a.done).length / l.acceptance.length) * 100 : null;
    if (l.status === "done") l.pct = 100;
    else if (l.status === "in_progress") l.pct = clamp(l.percent ?? acc ?? 50);
    else if (l.status === "blocked") l.pct = clamp(l.percent ?? acc ?? 0);
    else l.pct = 0;
    if (l.status === "in_progress" && l.pct >= 100) l.pct = 95;
    if (l.status === "in_progress" && !l.next) warn("info", `"${l.title}" is in progress but has no next step.`, l.id);
    if (l.status === "blocked" && !l.blocker) warn("warn", `"${l.title}" is blocked but the blocker isn't stated.`, l.id);
    if (l.status === "done" && l.verified === false) warn("info", `"${l.title}" is marked done in a checklist but has no code or commit evidence.`, l.id);
  }

  // ---- Roll-ups (post-order) ----
  function roll(id) {
    const n = byId.get(id);
    if (n.leaf) {
      const live = n.status !== "cancelled";
      n.weight = live ? n.est : 0;
      n.earned = live ? (n.est * n.pct) / 100 : 0;
      n.counts = Object.fromEntries(STATUSES.map((s) => [s, live && n.status === s ? 1 : 0]));
      n.leafCount = live ? 1 : 0;
      n.shareW = Object.fromEntries(STATUSES.map((s) => [s, live && n.status === s ? n.est : 0]));
      return n;
    }
    const kids = n.children.map(roll);
    n.weight = kids.reduce((a, k) => a + k.weight, 0);
    n.earned = kids.reduce((a, k) => a + k.earned, 0);
    n.counts = Object.fromEntries(STATUSES.map((s) => [s, kids.reduce((a, k) => a + k.counts[s], 0)]));
    n.shareW = Object.fromEntries(STATUSES.map((s) => [s, kids.reduce((a, k) => a + k.shareW[s], 0)]));
    n.leafCount = kids.reduce((a, k) => a + k.leafCount, 0);
    n.pct = n.weight ? (n.earned / n.weight) * 100 : 0;
    n.est = n.weight;
    const live = kids.filter((k) => k.status !== "cancelled");
    let derived;
    if (!live.length) derived = "cancelled";
    else if (live.every((k) => k.status === "done")) derived = "done";
    else if (live.every((k) => k.status === "todo")) derived = "todo";
    else if (live.filter((k) => k.status !== "done").every((k) => k.status === "blocked")) derived = "blocked";
    else if (live.every((k) => k.status === "todo" || k.status === "blocked")) derived = "todo";
    else derived = "in_progress";
    if (n.rawStatus && n.rawStatus !== derived && n.rawStatus !== "cancelled") {
      warn("info", `"${n.title}" says ${n.rawStatus.replace("_", " ")} but its children add up to ${derived.replace("_", " ")} — using the children.`, n.id);
    }
    n.status = n.rawStatus === "cancelled" ? "cancelled" : derived;
    return n;
  }
  const rootIds = nodes.filter((n) => !n.parentId).map((n) => n.id);
  rootIds.forEach(roll);
  for (const n of nodes) {
    n.pct = Math.round(n.pct * 10) / 10;
    n.remaining = n.weight - n.earned;
    n.share = Object.fromEntries(STATUSES.map((s) => [s, n.weight ? (n.shareW[s] / n.weight) * 100 : 0]));
  }

  // ---- Dependencies (resolved to leaf level, inherited from ancestors) ----
  const ancestors = (n) => { const a = []; let p = n.parentId && byId.get(n.parentId); while (p) { a.push(p); p = p.parentId && byId.get(p.parentId); } return a; };
  const leavesUnder = (n) => (n.leaf ? [n] : n.children.flatMap((c) => leavesUnder(byId.get(c))));
  for (const n of nodes) for (const d of n.dependsOn) if (!byId.has(d)) warn("warn", `"${n.title}" depends on unknown id "${d}".`, n.id);
  for (const l of leaves) {
    const ids = new Set([...l.dependsOn, ...ancestors(l).flatMap((a) => a.dependsOn)]);
    const deps = new Set();
    for (const d of ids) {
      const t = byId.get(d);
      if (!t) continue;
      for (const x of leavesUnder(t)) if (x.id !== l.id && !ancestors(l).includes(t)) deps.add(x.id);
    }
    l.depLeaves = [...deps];
    l.waitingOn = l.depLeaves.filter((d) => !["done", "cancelled"].includes(byId.get(d).status));
  }
  const dependents = new Map(leaves.map((l) => [l.id, []]));
  for (const l of leaves) for (const d of l.depLeaves) dependents.get(d)?.push(l.id);
  for (const l of leaves) l.unblocks = dependents.get(l.id) || [];

  // ---- Durations in working days ----
  const ownerHours = (o) => Number(teamByName[o]?.hoursPerDay) || settings.hoursPerDay;
  const histVelocityPts = paceFromHistory(history, cal).perDay;
  const toDays = (units, owner) => {
    if (unit === "d") return units;
    if (unit === "h") return units / ownerHours(owner);
    return units / (Number(settings.pointsPerDay) || histVelocityPts || 1);
  };
  const open = leaves.filter((l) => !["done", "cancelled"].includes(l.status));
  for (const l of leaves) {
    l.remainingUnits = l.status === "cancelled" ? 0 : (l.est * (100 - l.pct)) / 100;
    l.durDays = toDays(l.remainingUnits, effOwner(l));
  }

  // ---- Topological order (Kahn) over open leaves; break cycles ----
  const openSet = new Set(open.map((l) => l.id));
  const indeg = new Map(open.map((l) => [l.id, l.waitingOn.filter((d) => openSet.has(d)).length]));
  const order = [];
  const queue = open.filter((l) => indeg.get(l.id) === 0).map((l) => l.id);
  const byPrio = (a, b) => prioRank(byId.get(a).priority) - prioRank(byId.get(b).priority) || cmpId(a, b);
  queue.sort(byPrio);
  while (order.length < open.length) {
    if (!queue.length) {
      const stuck = open.find((l) => !order.includes(l.id));
      warn("error", `Dependency cycle detected around "${stuck.title}" — the cycle was broken for forecasting. Fix dependsOn.`, stuck.id);
      indeg.set(stuck.id, 0);
      queue.push(stuck.id);
      stuck.cycle = true;
    }
    const id = queue.shift();
    if (order.includes(id)) continue;
    order.push(id);
    for (const nxt of dependents.get(id) || []) {
      if (!openSet.has(nxt)) continue;
      indeg.set(nxt, indeg.get(nxt) - 1);
      if (indeg.get(nxt) === 0) { queue.push(nxt); queue.sort(byPrio); }
    }
  }

  // ---- CPM (unconstrained by people) → slack & critical path ----
  for (const id of order) {
    const l = byId.get(id);
    const startOff = l.start ? Math.max(0, cal.between(parseDate(l.start))) : 0;
    l.es = Math.max(startOff, ...l.waitingOn.filter((d) => openSet.has(d)).map((d) => byId.get(d).ef ?? 0), 0);
    l.ef = l.es + l.durDays;
  }
  const projectEnd = Math.max(0, ...order.map((id) => byId.get(id).ef));
  for (const id of [...order].reverse()) {
    const l = byId.get(id);
    const succ = (dependents.get(id) || []).filter((s) => openSet.has(s)).map((s) => byId.get(s));
    l.lf = succ.length ? Math.min(...succ.map((s) => s.ls ?? projectEnd)) : projectEnd;
    l.ls = l.lf - l.durDays;
    l.slack = round1(Math.max(0, l.ls - l.es));
    l.critical = l.slack <= 0.05 && open.length > 0;
  }
  // Order the critical chain by ES.
  const criticalPath = order.map((id) => byId.get(id)).filter((l) => l.critical).sort((a, b) => a.es - b.es).map((l) => l.id);

  // ---- Resource-levelled schedule → forecast dates ----
  const lanes = {};
  const laneFree = (owner) => {
    if (owner) return (lanes[owner] ??= [0]);
    return (lanes.__pool ??= Array(Math.max(1, Number(settings.unassignedLanes) || 1)).fill(0));
  };
  // Work already in progress goes first so it isn't pushed behind new work.
  const levelOrder = [...order].sort((a, b) => {
    const A = byId.get(a), B = byId.get(b);
    const depA = A.waitingOn.length, depB = B.waitingOn.length;
    return (A.status === "in_progress" ? 0 : 1) - (B.status === "in_progress" ? 0 : 1) || A.es - B.es || (B.critical - A.critical) || byPrio(a, b) || depA - depB;
  });
  // Re-run as a proper list scheduler honouring dependencies.
  const scheduled = new Set();
  const pending = [...levelOrder];
  let guard = 0;
  while (pending.length && guard++ < 100000) {
    const idx = pending.findIndex((id) => byId.get(id).waitingOn.filter((d) => openSet.has(d)).every((d) => scheduled.has(d)) || byId.get(id).cycle);
    const id = pending.splice(idx === -1 ? 0 : idx, 1)[0];
    const l = byId.get(id);
    const lane = laneFree(effOwner(l));
    const li = lane.indexOf(Math.min(...lane));
    const depReady = Math.max(0, ...l.waitingOn.filter((d) => openSet.has(d)).map((d) => byId.get(d).fEndOff ?? 0));
    const startOff = l.start ? Math.max(0, cal.between(parseDate(l.start))) : 0;
    l.fStartOff = Math.max(lane[li], depReady, startOff);
    l.fEndOff = l.fStartOff + l.durDays;
    lane[li] = l.fEndOff;
    l.fStart = iso(cal.at(Math.floor(l.fStartOff + 1e-9)));
    l.fEnd = iso(l.durDays > 0 ? cal.endAt(l.fEndOff) : cal.at(l.fStartOff));
    scheduled.add(id);
  }
  const finishOff = Math.max(0, ...open.map((l) => l.fEndOff || 0));

  // ---- Dates: overdue / due soon / parent windows ----
  const today = startOfDay(asOfDate);
  for (const n of nodes) {
    const due = parseDate(n.due);
    const live = !["done", "cancelled"].includes(n.status);
    n.overdue = !!(due && live && startOfDay(due) < today);
    n.dueIn = due ? cal.between(due) : null;
    n.dueSoon = !!(due && live && !n.overdue && n.dueIn <= settings.dueSoonDays);
    if (n.leaf && due && live && n.fEnd && parseDate(n.fEnd) > due) n.slipping = true;
  }
  for (const n of [...nodes].reverse()) {
    if (n.leaf) continue;
    const kids = n.children.map((c) => byId.get(c));
    const starts = kids.map((k) => k.fStart || k.start).filter(Boolean).sort();
    const ends = kids.map((k) => k.fEnd || k.due || k.completed).filter(Boolean).sort();
    n.fStart = starts[0] || null;
    n.fEnd = ends.at(-1) || null;
    n.critical = kids.some((k) => k.critical);
    n.slipping = kids.some((k) => k.slipping) || !!(n.due && n.fEnd && n.fEnd > n.due && !["done", "cancelled"].includes(n.status));
  }
  for (const n of nodes) if (n.overdue) warn("warn", `"${n.title}" was due ${n.due} and isn't done.`, n.id);

  // ---- Ready queue: open, nothing to wait on, not blocked ----
  const ready = open
    .filter((l) => l.status === "todo" && l.waitingOn.length === 0)
    .sort((a, b) => (b.critical - a.critical) || prioRank(a.priority) - prioRank(b.priority) || (a.dueIn ?? 1e9) - (b.dueIn ?? 1e9) || cmpId(a.id, b.id))
    .map((l) => l.id);
  const waiting = open.filter((l) => l.status === "todo" && l.waitingOn.length > 0).map((l) => l.id);

  // ---- Totals ----
  const totalW = rootIds.reduce((a, id) => a + byId.get(id).weight, 0);
  const totalE = rootIds.reduce((a, id) => a + byId.get(id).earned, 0);
  const counts = Object.fromEntries(STATUSES.map((s) => [s, rootIds.reduce((a, id) => a + byId.get(id).counts[s], 0)]));
  const shareW = Object.fromEntries(STATUSES.map((s) => [s, rootIds.reduce((a, id) => a + byId.get(id).shareW[s], 0)]));
  let pct = totalW ? (totalE / totalW) * 100 : 0;
  if (breakdown.overallPercent != null) pct = clamp(breakdown.overallPercent);
  const totals = {
    pct: Math.round(pct), pctExact: round1(pct), counts, leafCount: leaves.filter((l) => l.status !== "cancelled").length,
    cancelled: leaves.filter((l) => l.status === "cancelled").length,
    estimate: round1(totalW), earned: round1(totalE), remaining: round1(totalW - totalE), unit,
    share: Object.fromEntries(STATUSES.map((s) => [s, totalW ? (shareW[s] / totalW) * 100 : 0])),
    actualLogged: round1(leaves.reduce((a, l) => a + (l.actual || 0), 0)),
  };

  // ---- Estimate accuracy on finished work ----
  const doneWithActual = leaves.filter((l) => l.status === "done" && l.actual > 0 && l.estimated);
  const accuracy = doneWithActual.length
    ? { tasks: doneWithActual.length, estimate: round1(doneWithActual.reduce((a, l) => a + l.est, 0)), actual: round1(doneWithActual.reduce((a, l) => a + l.actual, 0)) }
    : null;
  if (accuracy) accuracy.ratio = round1(accuracy.actual / accuracy.estimate * 100) / 100;

  // ---- Forecast ----
  const pace = paceFromHistory(history, cal, totalE, asOfDate);
  const target = parseDate(breakdown.project?.targetDate || breakdown.targetDate);
  const planFinish = open.length ? cal.endAt(finishOff) : null;
  let paceFinish = null;
  if (pace.perDay > 0 && totals.remaining > 0) paceFinish = cal.endAt(totals.remaining / pace.perDay);
  const forecast = {
    planFinish: iso(planFinish), paceFinish: iso(paceFinish), target: iso(target),
    workingDaysLeft: round1(finishOff), pacePerDay: pace.perDay ? round1(pace.perDay) : null, paceWindowDays: pace.window,
    criticalDays: round1(projectEnd), unit,
    assumesUnblocked: open.filter((l) => l.status === "blocked").length,
  };
  if (!open.length) forecast.status = leaves.some((l) => l.status !== "cancelled") ? "complete" : "empty";
  else if (!target) forecast.status = "no_target";
  else {
    const slack = cal.between(target) - cal.between(planFinish);
    forecast.slackDays = slack;
    const paceLate = paceFinish && paceFinish > target;
    forecast.status = slack < 0 ? "late" : slack <= 2 || paceLate ? "at_risk" : "on_track";
  }

  // ---- Phases summary ----
  const phases = rootIds.map((id) => {
    const p = byId.get(id);
    const tasks = leavesUnder(p);
    const overdue = tasks.filter((t) => t.overdue).length;
    const blocked = tasks.filter((t) => t.status === "blocked").length;
    const health = p.status === "done" ? "done" : p.overdue || (p.slipping && tasks.some((t) => t.critical)) ? "red" : overdue || blocked || p.slipping ? "amber" : "green";
    return { id, title: p.title, pct: Math.round(p.pct), status: p.status, counts: p.counts, share: p.share, due: p.due, fEnd: p.fEnd, health, leafCount: p.leafCount, remaining: round1(p.remaining), owner: p.owner };
  });

  // ---- Owners ----
  const ownerMap = {};
  for (const l of leaves) {
    if (l.status === "cancelled") continue;
    const o = effOwner(l) || "Unassigned";
    const r = (ownerMap[o] ??= { name: o, role: teamByName[o]?.role || null, open: 0, inProgress: 0, blocked: 0, done: 0, overdue: 0, remaining: 0, finish: null });
    if (l.status === "done") r.done++;
    else { r.open++; r.remaining += l.remainingUnits; }
    if (l.status === "in_progress") r.inProgress++;
    if (l.status === "blocked") r.blocked++;
    if (l.overdue) r.overdue++;
    if (l.fEnd && (!r.finish || l.fEnd > r.finish)) r.finish = l.fEnd;
  }
  const owners = Object.values(ownerMap).map((o) => ({ ...o, remaining: round1(o.remaining) })).sort((a, b) => b.remaining - a.remaining);

  // ---- Manual actions ----
  const manual = (breakdown.manual || []).map((m, i) => ({ id: m.id || `M${i + 1}`, ...m, relatesTo: [].concat(m.relatesTo || []) }))
    .filter((m) => !m.done)
    .sort((a, b) => (b.blocking === true) - (a.blocking === true) || prioRank(a.priority) - prioRank(b.priority));
  const manualDone = (breakdown.manual || []).filter((m) => m.done).length;

  // ---- Git summary ----
  const g = facts.git || { isRepo: false };
  const branches = g.isRepo ? g.branches || [] : [];
  const unmerged = branches.filter((b) => !b.isDefault && !b.mergedIntoDefault);
  const unpushed = branches.filter((b) => b.aheadOfUpstream > 0 || (!b.upstream && b.aheadOfDefault > 0));
  const doneNotShipped = leaves.filter((l) => l.status === "done" && ["pushed", "committed", "uncommitted"].includes(l.git?.state)).map((l) => l.id);

  // ---- Health ----
  const overdueIds = nodes.filter((n) => n.leaf && n.overdue).map((n) => n.id);
  const dueSoonIds = nodes.filter((n) => n.leaf && n.dueSoon).map((n) => n.id);
  const blockedCritical = leaves.filter((l) => l.status === "blocked" && l.critical).length;
  const blockingManual = manual.filter((m) => m.blocking).length;
  let health = "green";
  const reasons = [];
  if (forecast.status === "late") { health = "red"; reasons.push(`Forecast finishes ${Math.abs(forecast.slackDays)} working day(s) after the target`); }
  if (blockedCritical) { health = "red"; reasons.push(`${blockedCritical} task(s) on the critical path are blocked`); }
  if (health !== "red") {
    if (forecast.status === "at_risk") { health = "amber"; reasons.push(forecast.slackDays <= 2 ? "Little or no slack before the target date" : "At the recent pace the work finishes after the target date"); }
    if (overdueIds.length) { health = "amber"; reasons.push(`${overdueIds.length} task(s) overdue`); }
    if (counts.blocked) { health = "amber"; reasons.push(`${counts.blocked} task(s) blocked`); }
    if (blockingManual) { health = "amber"; reasons.push(`${blockingManual} owner action(s) blocking work`); }
  }
  if (forecast.status === "complete") health = "done";
  if (forecast.status === "empty") health = "empty";

  // ---- History snapshot ----
  const snapshot = {
    date: asOf, percent: totals.pct, earned: totals.earned, total: totals.estimate, unit,
    done: counts.done, inProgress: counts.in_progress, blocked: counts.blocked, todo: counts.todo,
    manualOpen: manual.length, unmergedBranches: unmerged.length, planFinish: forecast.planFinish,
    phases: Object.fromEntries(phases.map((p) => [p.id, p.pct])),
  };

  // ---- Clean nodes for output ----
  const outNodes = nodes.map((n) => ({
    id: n.id, title: n.title, type: n.type, parentId: n.parentId, phaseId: n.phaseId, depth: n.depth, leaf: n.leaf, children: n.children,
    status: n.status, pct: Math.round(n.pct), est: round1(n.est), estimated: n.leaf ? n.estimated : undefined, remaining: round1(n.remaining),
    actual: n.actual, owner: effOwner(n), ownerInherited: !n.owner && !!n.inheritedOwner, priority: n.priority,
    start: n.start, due: n.due, completed: n.completed, fStart: n.fStart || null, fEnd: n.fEnd || null,
    overdue: n.overdue, dueSoon: n.dueSoon, dueIn: n.dueIn, slipping: !!n.slipping,
    critical: !!n.critical, slack: n.slack ?? null, cycle: !!n.cycle,
    dependsOn: n.dependsOn, waitingOn: n.waitingOn || [], unblocks: n.unblocks || [],
    acceptance: n.acceptance, evidence: n.evidence, source: n.source, verified: n.verified,
    git: n.git, next: n.next, blocker: n.blocker, tags: n.tags, notes: n.notes, description: n.description,
    counts: n.counts, share: n.share, leafCount: n.leafCount,
  }));

  return {
    generatedAt: new Date().toISOString(), asOf, today: iso(today),
    project: { name: facts.project?.name || "Project", ...(breakdown.project || {}), targetDate: iso(target) },
    headline: breakdown.headline || null, settings: { ...settings, estimateUnit: unit },
    totals, forecast, health, healthReasons: reasons, accuracy,
    phases, nodes: outNodes, rootIds, ready, waiting, criticalPath, overdue: overdueIds, dueSoon: dueSoonIds,
    owners, team, milestones: (breakdown.milestones || []).map((m, i) => ({ id: m.id || `MS${i + 1}`, ...m })),
    manual, manualDone, risks: breakdown.risks || [], decisions: breakdown.decisions || [], sources: breakdown.sources || [],
    git: g.isRepo ? {
      isRepo: true, currentBranch: g.currentBranch, defaultBranch: g.defaultBranch, baseRef: g.baseRef, remote: g.remote, remoteUrl: g.remoteUrl,
      lastFetch: g.lastFetch, working: g.working, stashCount: g.stashCount, branches, remoteOnlyBranches: g.remoteOnlyBranches || [],
      recentOnDefault: g.recentOnDefault || [], totalCommitsOnDefault: g.totalCommitsOnDefault, firstCommitDate: g.firstCommitDate,
      latestTag: g.latestTag, activity: g.activity || null,
      unmerged: unmerged.map((b) => b.name), unpushed: unpushed.map((b) => b.name), doneNotShipped,
    } : { isRepo: false, doneNotShipped: [] },
    env: facts.env || null,
    warnings, snapshot,
  };
}

// Earned-value pace from history: units earned per working day over the last ~3 weeks.
function paceFromHistory(history, cal, currentEarned, asOfDate) {
  const pts = (history || []).filter((h) => h.earned != null && h.date);
  if (!pts.length) return { perDay: null, window: null };
  const now = asOfDate || new Date(pts.at(-1).date);
  const nowEarned = currentEarned ?? pts.at(-1).earned;
  const windowStart = new Date(now.getTime() - 21 * DAY);
  const base = pts.find((h) => new Date(h.date) >= windowStart) || pts[0];
  const days = -cal.between(new Date(base.date)) + (asOfDate ? 0 : cal.between(now));
  if (days < 1) return { perDay: null, window: null };
  const per = (nowEarned - base.earned) / days;
  return { perDay: per > 0 ? per : null, window: days };
}

export function cmpId(a, b) {
  const pa = String(a).split(/[.\-]/), pb = String(b).split(/[.\-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? "", y = pb[i] ?? "";
    const nx = parseFloat(x.replace(/^\D+/, "")), ny = parseFloat(y.replace(/^\D+/, ""));
    if (!isNaN(nx) && !isNaN(ny) && nx !== ny) return nx - ny;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}
