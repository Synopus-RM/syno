'use strict';
// Turns a device profile into budget proposals. A proposal only takes effect once the owner confirms it.

const PRESETS = ['conservative', 'balanced', 'performance'];

function propose(profile, preset = 'balanced') {
  const logical = profile.cpu.logical;
  const physical = profile.cpu.physical || Math.max(1, Math.round(logical / 2));
  const memGB = profile.memory.totalMB / 1024;
  const hasTemp = profile.thermal && profile.thermal.sensor === 'sysfs';

  // One heavy job (e2e suite, production build, docker build) per 4 physical cores and per ~12 GB RAM:
  // browsers and bundlers each want several cores and 1.5–3 GB, and laptops throttle long before 100% CPU.
  const heavyByCpu = Math.max(1, Math.floor(physical / 4));
  const heavyByMem = Math.max(1, Math.floor(memGB / 12));
  const heavy = Math.min(heavyByCpu, heavyByMem, 4);

  let total = Math.min(heavy + 1, 8);
  let e2e = Math.max(1, Math.min(Math.floor(logical / 4), Math.floor(memGB / 4)));
  let tests = Math.max(1, Math.floor(logical / 2));
  let build = Math.max(1, logical - 2);
  let cpuStart = 80;
  let tempPause = hasTemp ? 85 : null;

  if (preset === 'conservative') {
    total = heavy;
    e2e = Math.max(1, Math.floor(e2e / 2));
    tests = Math.max(1, Math.floor(tests / 2));
    build = Math.max(1, Math.floor(logical / 2));
    cpuStart = 70;
    if (tempPause) tempPause -= 5;
  } else if (preset === 'performance') {
    total = Math.min(heavy + 2, 8);
    e2e += 1;
    tests = Math.max(1, logical - 1);
    build = logical;
    cpuStart = 90;
    if (tempPause) tempPause += 5;
  }

  const rationale = [
    `${physical} physical cores / ${logical} threads → ${heavyByCpu} heavy job(s) at once by CPU (one per 4 cores).`,
    `${memGB.toFixed(1)} GB RAM → ${heavyByMem} by memory (one per ~12 GB; browsers and bundlers are memory hungry).`,
    hasTemp ? 'CPU temperature sensor found: new jobs wait while the CPU is above the pause temperature.'
      : 'No readable CPU temperature sensor: CPU % and free RAM are used instead.',
  ];
  if (profile.power && profile.power.onBattery) rationale.push('Measured on battery: the conservative preset runs cooler while unplugged.');

  return {
    preset,
    slots: { heavy, total },
    workers: { e2e, tests, build },
    thresholds: {
      cpuStartBelowPct: cpuStart,
      memMinFreeMB: Math.max(1024, Math.round(profile.memory.totalMB * 0.1)),
      tempPauseC: tempPause,
    },
    nice: 10,
    rationale,
  };
}

function validate(b) {
  const errs = [];
  const posInt = v => Number.isInteger(v) && v >= 1;
  if (!posInt(b.slots && b.slots.heavy)) errs.push('slots.heavy must be a whole number ≥ 1');
  if (!posInt(b.slots && b.slots.total) || b.slots.total < b.slots.heavy) errs.push('slots.total must be a whole number ≥ slots.heavy');
  for (const k of ['e2e', 'tests', 'build']) if (!posInt(b.workers && b.workers[k])) errs.push(`workers.${k} must be a whole number ≥ 1`);
  const t = b.thresholds || {};
  if (!(t.cpuStartBelowPct >= 10 && t.cpuStartBelowPct <= 101)) errs.push('thresholds.cpuStartBelowPct must be 10–101');
  if (!(t.memMinFreeMB >= 0)) errs.push('thresholds.memMinFreeMB must be ≥ 0');
  if (t.tempPauseC != null && !(t.tempPauseC >= 40 && t.tempPauseC <= 110)) errs.push('thresholds.tempPauseC must be 40–110 or null');
  if (!(Number.isInteger(b.nice) && b.nice >= 0 && b.nice <= 19)) errs.push('nice must be 0–19');
  return errs;
}

module.exports = { PRESETS, propose, validate };
