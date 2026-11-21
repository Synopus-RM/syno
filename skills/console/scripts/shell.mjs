// Reading shell command lines for Syno Console's guard (PRD S-17, design 5.8).
// It finds every `git push` and every pull-request merge in a Bash command,
// wherever it sits: after `&&`, `;` or `|`, in a loop or `if`, in a subshell
// or `$( … )`, behind `timeout`, `env` or `sudo`, or inside `bash -c "…"`.
// Here-document bodies are text, not commands, so they are skipped. Pure.

const SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh"]);
const GIT_VALUE_OPTS = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--config-env"]);
const PUSH_VALUE_OPTS = new Set(["--push-option", "--repo", "--receive-pack", "--exec"]);

/** The heredoc delimiters a line opens, read outside quotes (`<<EOF`, `<<-'EOF'`; not `<<<`). */
function heredocsOpened(line) {
  const found = [];
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === "\\" && quote === '"') i++;
    } else if (c === "'" || c === '"') quote = c;
    else if (c === "\\") i++;
    else if (c === "<" && line[i + 1] === "<" && line[i + 2] !== "<") {
      const m = /^<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/.exec(line.slice(i));
      if (m) {
        found.push(m[2]);
        i += m[0].length - 1;
      }
    }
  }
  return found;
}

/** The command without here-document bodies. */
export function stripHeredocs(command) {
  const out = [];
  const waiting = [];
  for (const line of String(command).split("\n")) {
    if (waiting.length) {
      if (line.replace(/^\t+/, "").trim() === waiting[0]) waiting.shift();
      continue;
    }
    out.push(line);
    waiting.push(...heredocsOpened(line));
  }
  return out.join("\n");
}

function splitSegments(command) {
  const segs = [];
  let cur = "";
  let quote = null;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      cur += c;
      if (c === quote) quote = null;
      else if (c === "\\" && quote === '"') cur += command[++i] ?? "";
    } else if (c === "'" || c === '"') {
      quote = c;
      cur += c;
    } else if (c === "\\") cur += c + (command[++i] ?? "");
    else if (c === "&" && (/[<>]$/.test(cur) || command[i + 1] === ">")) cur += c;
    else if ("\n;|&".includes(c)) {
      segs.push(cur);
      cur = "";
      if ((c === "|" || c === "&") && command[i + 1] === c) i++;
    } else cur += c;
  }
  segs.push(cur);
  return segs.map((s) => s.trim()).filter(Boolean);
}

function dropRedirects(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i].text;
    if (/^\d*(>>?|<<?|&>)$/.test(t)) i++;
    else if (!/^\d*(>>?|<|&>)/.test(t)) out.push(tokens[i]);
  }
  return out;
}

/** Words of one segment. Quotes join, `( ) \`` separate, and `$` or a backtick marks a word as dynamic. */
function tokenize(segment) {
  const tokens = [];
  let cur = null;
  let quote = null;
  let dynamic = false;
  const flush = () => {
    if (cur !== null) tokens.push({ text: cur, dynamic });
    cur = null;
    dynamic = false;
  };
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (quote === '"' && c === "\\") cur += segment[++i] ?? "";
      else {
        if (quote === '"' && (c === "$" || c === "`")) dynamic = true;
        cur += c;
      }
    } else if (/\s/.test(c) || "()`".includes(c)) flush();
    else {
      cur ??= "";
      if (c === "'" || c === '"') quote = c;
      else if (c === "\\") cur += segment[++i] ?? "";
      else {
        if (c === "$") dynamic = true;
        cur += c;
      }
    }
  }
  flush();
  return dropRedirects(tokens);
}

const words = (command) => splitSegments(stripHeredocs(String(command))).map(tokenize);

function longFlag(p, text) {
  const name = text.split("=")[0];
  if (name === "--force" || name.startsWith("--force-with-lease") || name === "--force-if-includes") p.force = true;
  else if (name === "--delete") p.del = true;
  else if (name === "--prune") p.prune = true;
  else if (name === "--all" || name === "--branches") p.all = true;
  else if (name === "--mirror") p.mirror = true;
  else if (name === "--tags" || name === "--follow-tags") p.tags = true;
  return PUSH_VALUE_OPTS.has(name) && !text.includes("=");
}

function pushArgs(args) {
  const p = { force: false, del: false, all: false, mirror: false, tags: false, prune: false, remote: null, refspecs: [], dynamic: false };
  const pos = [];
  for (let i = 0; i < args.length; i++) {
    const { text } = args[i];
    if (text === "--") {
      pos.push(...args.slice(i + 1));
      break;
    }
    if (text.startsWith("--")) {
      if (longFlag(p, text)) i++;
    } else if (text === "-o") i++;
    else if (/^-[A-Za-z0-9]+$/.test(text)) {
      if (text.includes("f")) p.force = true;
      if (text.includes("d")) p.del = true;
    } else pos.push(args[i]);
  }
  p.remote = pos[0]?.text ?? null;
  p.refspecs = pos.slice(1).map((t) => t.text);
  p.dynamic = pos.some((t) => t.dynamic);
  return p;
}

/** Every git call in a segment, wherever `git` stands: { sub, args }. */
function gitCalls(tokens) {
  const calls = [];
  tokens.forEach((t, start) => {
    if (t.text !== "git" && !t.text.endsWith("/git")) return;
    let i = start + 1;
    for (; i < tokens.length && tokens[i].text.startsWith("-"); i++) if (GIT_VALUE_OPTS.has(tokens[i].text)) i++;
    calls.push({ sub: tokens[i]?.text, args: tokens.slice(i + 1) });
  });
  return calls;
}

/** Every `git push` in a command line, with its flags and refspecs (not counting `sh -c` strings). */
export const parsePushes = (command) =>
  words(command)
    .flatMap(gitCalls)
    .filter((g) => g.sub === "push")
    .map((g) => pushArgs(g.args));

/** The command strings run by `bash -c "…"` (also `-lc`, `-ec` and the like). */
export const shellStrings = (command) =>
  words(command).flatMap((tokens) =>
    tokens.flatMap((t, i) => {
      if (!SHELLS.has(t.text.split("/").pop())) return [];
      const c = tokens.slice(i + 1).findIndex((x) => /^-[a-z]*c[a-z]*$/.test(x.text));
      const inner = c >= 0 ? tokens[i + 1 + c + 1] : null;
      return inner ? [inner.text] : [];
    }),
  );

/** True when the command merges a pull request (`gh pr merge`, or the merge API through `gh api`). */
export const mergesPr = (command) =>
  words(command).some((tokens) => {
    const t = tokens.map((x) => x.text);
    return t.some((w, i) => w === "gh" && ((t[i + 1] === "pr" && t[i + 2] === "merge") || (t[i + 1] === "api" && t.slice(i + 2).some((x) => /\/pulls\/\d+\/merge\b/.test(x)))));
  });

/** True when the command pushes or merges anything, at any depth of `sh -c`. */
export function touchesRemote(command, depth = 0) {
  if (typeof command !== "string") return false;
  if (mergesPr(command) || parsePushes(command).length) return true;
  return depth < 3 && shellStrings(command).some((inner) => touchesRemote(inner, depth + 1));
}
