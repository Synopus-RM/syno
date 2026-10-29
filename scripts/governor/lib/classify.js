'use strict';
// Decides whether a shell command is heavy (e2e, builds), medium (unit tests, installs, typecheck) or light.
// Each pattern is [regex anchored at the start of a normalized command segment, label, kind].

const HEAVY = [
  [/^playwright\s+test\b/, 'playwright test', 'e2e'],
  [/^cypress\s+run\b/, 'cypress run', 'e2e'],
  [/^(wdio|testcafe)\b/, 'browser e2e', 'e2e'],
  [/^detox\s+test\b/, 'detox test', 'e2e'],
  [/^flutter\s+drive\b/, 'flutter drive', 'e2e'],
  [/^firebase\s+emulators:exec\b/, 'firebase emulators:exec', 'e2e'],
  [/^(lighthouse|lhci)\b/, 'lighthouse', 'e2e'],
  [/^k6\s+run\b/, 'k6 load test', 'e2e'],
  [/^(npm|pnpm|yarn|bun)\s+(run\s+)?[\w:.-]*(e2e|integration)[\w:.-]*(\s|$)/, 'e2e script', 'e2e'],
  [/^(npm|pnpm|yarn|bun)\s+(run\s+)?[\w:.-]*(build|bundle|compile|dist)[\w:.-]*(\s|$)/, 'build script', 'build'],
  [/^(next|nuxt|nuxi|vite|astro|remix|ng|gatsby|react-scripts|vue-cli-service|svelte-kit|tauri|electron-forge)\s+(build|generate|export|make|package)\b/, 'framework build', 'build'],
  [/^electron-builder\b/, 'electron-builder', 'build'],
  [/^(turbo|nx)\s+(run|run-many|affected|build)\b/, 'monorepo tasks', 'build'],
  [/^docker(\s+compose|-compose)\s+up\b.*\s--build\b/, 'docker compose build', 'build'],
  [/^docker(\s+compose|-compose)?\s+build\b/, 'docker build', 'build'],
  [/^docker\s+buildx\s+build\b/, 'docker build', 'build'],
  [/^cargo\s+(build|test|bench)\b/, 'cargo', 'build'],
  [/^gradlew?(\.bat)?(\s|$)/, 'gradle', 'build'],
  [/^mvnw?(\s|$)/, 'maven', 'build'],
  [/^xcodebuild\b/, 'xcodebuild', 'build'],
  [/^flutter\s+build\b/, 'flutter build', 'build'],
  [/^eas\s+build\b.*\s--local\b/, 'eas local build', 'build'],
  [/^expo\s+(run:|export|prebuild)/, 'expo native build', 'build'],
  [/^webpack(\s|$)/, 'webpack', 'build'],
];

const MEDIUM = [
  [/^(jest|vitest|mocha|ava|karma|jasmine)(\s|$)/, 'unit tests', 'tests'],
  [/^(npm|pnpm|yarn|bun)\s+(run\s+)?(test|t)\b[\w:.-]*/, 'test script', 'tests'],
  [/^(pytest|tox|nox|phpunit|rspec)(\s|$)/, 'tests', 'tests'],
  [/^python3?\s+-m\s+pytest\b/, 'pytest', 'tests'],
  [/^go\s+test\b/, 'go test', 'tests'],
  [/^flutter\s+test\b/, 'flutter test', 'tests'],
  [/^dotnet\s+test\b/, 'dotnet test', 'tests'],
  [/^swift\s+test\b/, 'swift test', 'tests'],
  [/^(npm|pnpm|yarn|bun)\s+(run\s+)?(typecheck|type-check|tsc|lint|check|validate)[\w:.-]*(\s|$)/, 'typecheck/lint script', 'check'],
  [/^(tsc|vue-tsc)(\s|$)/, 'tsc', 'check'],
  [/^(eslint|biome\s+(check|lint)|next\s+lint)(\s|$)/, 'lint', 'check'],
  [/^go\s+vet\b/, 'go vet', 'check'],
  [/^(npm|pnpm|bun)\s+(install|i|ci|add)(\s|$)/, 'package install', 'install'],
  [/^yarn(\s+(install|add)\b|\s*$)/, 'package install', 'install'],
  [/^(pip3?|uv\s+pip)\s+install\b/, 'pip install', 'install'],
  [/^(uv\s+sync|poetry\s+install)\b/, 'python install', 'install'],
  [/^go\s+build\b/, 'go build', 'build'],
  [/^(make|ninja)(\s|$)/, 'make', 'build'],
  [/^cmake\s+--build\b/, 'cmake build', 'build'],
  [/^dotnet\s+(build|publish)\b/, 'dotnet build', 'build'],
  [/^swift\s+build\b/, 'swift build', 'build'],
];

// Help, listing, dry-run and watch/UI modes are not batch work: never gate them.
const NOT_BATCH = /(^|\s)(--help|--version|--list|--listTests|--dry-run|--watch|--watchAll|--ui|--headed-debug)(\s|=|$)/;

const LAUNCHER = new RegExp('^(?:' + [
  '[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|\'[^\']*\'|\\S*)\\s+',
  '(?:npx|bunx|exec|command|time|sudo|env|nohup)\\s+(?:-{1,2}[\\w-]+(?:=\\S+)?\\s+)*',
  '(?:pnpm|yarn)\\s+(?:exec|dlx)\\s+',
  'npm\\s+exec\\s+(?:--\\s+)?',
  'nice\\s+(?:-n\\s*)?-?\\d+\\s+',
  'nice\\s+',
  'ionice\\s+(?:-c\\s*\\d\\s+)?(?:-n\\s*\\d\\s+)?',
  'timeout\\s+(?:-{1,2}[\\w-]+(?:=\\S+)?\\s+)*\\d+[smhd]?\\s+',
].join('|') + ')');

function normalize(segment) {
  let s = segment.trim().replace(/^[({]\s*/, '');
  for (let i = 0; i < 10; i++) {
    const next = s.replace(LAUNCHER, '');
    if (next === s) break;
    s = next;
  }
  // ./node_modules/.bin/playwright test → playwright test
  return s.replace(/^\S*[/\\]([^\s/\\]+)/, '$1');
}

function segments(command) {
  const out = [];
  for (const raw of String(command).split(/&&|\|\||;|\||\n/)) {
    const seg = normalize(raw);
    if (!seg) continue;
    const inner = /^(?:ba|z)?sh\s+-c\s+(["'])([\s\S]*)\1\s*$/.exec(seg);
    if (inner) out.push(...segments(inner[2]));
    else out.push(seg);
  }
  return out;
}

function compile(list) {
  return (list || []).map(s => { try { return new RegExp(s, 'i'); } catch { return null; } }).filter(Boolean);
}

const RANK = { light: 0, medium: 1, heavy: 2 };

function classify(command, policy = {}) {
  const custom = policy.patterns || {};
  const ownerLight = compile(custom.light), ownerHeavy = compile(custom.heavy), ownerMedium = compile(custom.medium);
  let best = { cls: 'light', reason: null, kind: null, segment: null };
  for (const seg of segments(command)) {
    if (NOT_BATCH.test(seg) || ownerLight.some(r => r.test(seg))) continue;
    let hit = null;
    if (ownerHeavy.some(r => r.test(seg))) hit = { cls: 'heavy', reason: 'owner pattern', kind: 'build' };
    else if (ownerMedium.some(r => r.test(seg))) hit = { cls: 'medium', reason: 'owner pattern', kind: 'tests' };
    else {
      const h = HEAVY.find(([r]) => r.test(seg));
      const m = !h && MEDIUM.find(([r]) => r.test(seg));
      if (h) hit = { cls: 'heavy', reason: h[1], kind: h[2] };
      else if (m) hit = { cls: 'medium', reason: m[1], kind: m[2] };
    }
    if (hit && RANK[hit.cls] > RANK[best.cls]) best = { ...hit, segment: seg };
  }
  return best;
}

// `gov run ...` (or `node .../gov.js run ...`) is already queued.
const GOV = String.raw`(?:^|[\s;&|("'/\\])gov(?:\.js)?["']?\s+`;
const isGovRun = cmd => new RegExp(GOV + String.raw`run(?:\s|$)`).test(cmd);

const MUTATIONS = [
  [/budget\s+set\b/, 'confirm or change the device budget'],
  [/budget\s+reset\b/, 'withdraw the confirmed device budget'],
  [/policy\s+set\b/, 'change the governor policy'],
  [/priority\s+(set|clear)\b/, 'change project priorities'],
  [/queue\s+move\b/, 'reorder the queue'],
  [/queue\s+pause\b/, 'pause a queued job'],
  [/queue\s+resume\b/, 'resume a paused job'],
  [/queue\s+cancel\b/, 'cancel a job'],
  [/decide\b/, 'answer a pending owner decision'],
];

function govMutation(cmd) {
  const m = new RegExp(GOV + '(.*)$', 's').exec(cmd);
  if (!m) return null;
  const hit = MUTATIONS.find(([r]) => new RegExp('^' + r.source).test(m[1]));
  if (!hit) return null;
  return `${hit[1]} — \`gov ${m[1].split('\n')[0].trim().slice(0, 160)}\``;
}

module.exports = { classify, segments, isGovRun, govMutation, RANK };
