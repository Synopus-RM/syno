'use strict';
// What this machine is (profile) and how busy it is right now (live). Node stdlib only, Linux/macOS/Windows.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

function read(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
}

function list(dir) {
  try { return fs.readdirSync(dir); } catch { return []; }
}

function run(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  } catch { return null; }
}

function physicalCores() {
  if (process.platform === 'linux') {
    const info = read('/proc/cpuinfo') || '';
    const cores = new Set();
    let socket = '0';
    for (const line of info.split('\n')) {
      const [k, v] = line.split(':').map(s => (s || '').trim());
      if (k === 'physical id') socket = v;
      if (k === 'core id') cores.add(`${socket}:${v}`);
    }
    if (cores.size) return cores.size;
  } else if (process.platform === 'darwin') {
    const n = parseInt(run('sysctl', ['-n', 'hw.physicalcpu']), 10);
    if (n > 0) return n;
  } else if (process.platform === 'win32') {
    const n = parseInt(run('powershell', ['-NoProfile', '-Command',
      '(Get-CimInstance Win32_Processor | Measure-Object -Property NumberOfCores -Sum).Sum']), 10);
    if (n > 0) return n;
  }
  return null;
}

function memory() {
  const totalMB = Math.round(os.totalmem() / 1048576);
  let availMB = Math.round(os.freemem() / 1048576);
  let swapUsedMB = null;
  if (process.platform === 'linux') {
    const m = read('/proc/meminfo') || '';
    const kb = key => { const r = new RegExp(`^${key}:\\s+(\\d+)`, 'm').exec(m); return r ? Number(r[1]) : null; };
    if (kb('MemAvailable') != null) availMB = Math.round(kb('MemAvailable') / 1024);
    if (kb('SwapTotal') != null) swapUsedMB = Math.round((kb('SwapTotal') - kb('SwapFree')) / 1024);
  } else if (process.platform === 'darwin') {
    // os.freemem() only counts free pages on macOS; inactive and speculative pages are reclaimable too.
    const v = run('vm_stat', []);
    if (v) {
      const page = Number((/page size of (\d+)/.exec(v) || [0, 4096])[1]);
      const pages = k => Number((new RegExp(`${k}:\\s+(\\d+)`).exec(v) || [0, 0])[1]);
      availMB = Math.round((pages('Pages free') + pages('Pages inactive') + pages('Pages speculative')) * page / 1048576);
    }
  }
  return { totalMB, availMB, swapUsedMB };
}

const CPU_ZONE = /^(x86_pkg_temp|tcpu|cpu|coretemp|k10temp|zenpower|soc)/i;
const CPU_HWMON = /^(coretemp|k10temp|zenpower|cpu_thermal)$/;

// Linux reads sysfs; macOS only exposes a throttle percentage without sudo; Windows needs admin, so null.
function thermal() {
  if (process.platform === 'linux') {
    const vals = [];
    const zones = '/sys/class/thermal';
    for (const z of list(zones)) {
      if (!z.startsWith('thermal_zone')) continue;
      const type = (read(path.join(zones, z, 'type')) || '').trim();
      const milli = parseInt(read(path.join(zones, z, 'temp')), 10);
      if (CPU_ZONE.test(type) && milli > 0) vals.push(milli / 1000);
    }
    const hw = '/sys/class/hwmon';
    for (const h of list(hw)) {
      if (!CPU_HWMON.test((read(path.join(hw, h, 'name')) || '').trim())) continue;
      const milli = parseInt(read(path.join(hw, h, 'temp1_input')), 10);
      if (milli > 0) vals.push(milli / 1000);
    }
    const ok = vals.filter(v => v > 5 && v < 125);
    return { tempC: ok.length ? Math.round(Math.max(...ok)) : null, speedLimitPct: null, sensor: ok.length ? 'sysfs' : null };
  }
  if (process.platform === 'darwin') {
    const lim = /CPU_Speed_Limit\s*=\s*(\d+)/.exec(run('pmset', ['-g', 'therm']) || '');
    return { tempC: null, speedLimitPct: lim ? Number(lim[1]) : null, sensor: lim ? 'pmset' : null };
  }
  return { tempC: null, speedLimitPct: null, sensor: null };
}

function onBattery() {
  if (process.platform === 'linux') {
    const base = '/sys/class/power_supply';
    let hasBattery = false;
    for (const p of list(base)) {
      const type = (read(path.join(base, p, 'type')) || '').trim();
      if (type === 'Battery') { hasBattery = true; continue; }
      if ((read(path.join(base, p, 'online')) || '').trim() === '1') return false;
    }
    return hasBattery ? true : null;
  }
  if (process.platform === 'darwin') {
    const out = run('pmset', ['-g', 'batt']);
    if (out) return /Battery Power/.test(out);
  }
  return null;
}

function profile() {
  const cpus = os.cpus();
  const mem = memory();
  const t = thermal();
  return {
    host: os.hostname(),
    platform: process.platform,
    release: os.release(),
    arch: os.arch(),
    cpu: {
      model: ((cpus[0] && cpus[0].model) || 'unknown CPU').replace(/\s+/g, ' ').trim(),
      logical: cpus.length,
      physical: physicalCores(),
    },
    memory: { totalMB: mem.totalMB },
    thermal: { sensor: t.sensor, tempAtProfileC: t.tempC },
    power: { onBattery: onBattery() },
    measuredAt: new Date().toISOString(),
  };
}

function cpuTimes() {
  return os.cpus().map(c => c.times);
}

async function cpuBusyPct(ms) {
  const a = cpuTimes();
  await new Promise(r => setTimeout(r, ms));
  const b = cpuTimes();
  let busy = 0, total = 0;
  b.forEach((t, i) => {
    const p = a[i];
    if (!p) return;
    const dt = (t.user + t.nice + t.sys + t.idle + t.irq) - (p.user + p.nice + p.sys + p.idle + p.irq);
    busy += dt - (t.idle - p.idle);
    total += dt;
  });
  return total > 0 ? Math.round((busy / total) * 100) : null;
}

async function live(sampleMs = 400) {
  const cpuPct = await cpuBusyPct(sampleMs);
  const mem = memory();
  const t = thermal();
  return {
    cpuPct,
    load1: process.platform === 'win32' ? null : Number(os.loadavg()[0].toFixed(2)),
    memAvailMB: mem.availMB,
    memTotalMB: mem.totalMB,
    swapUsedMB: mem.swapUsedMB,
    tempC: t.tempC,
    speedLimitPct: t.speedLimitPct,
    onBattery: onBattery(),
    at: new Date().toISOString(),
  };
}

module.exports = { profile, live };
