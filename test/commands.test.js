// Chunk 2.9: every command and skill file is well formed (PRD §9). Commands
// call the Syno CLI by its plugin path and only name subcommands that exist;
// skills have a name and a short description, so all of them together stay
// within the session budget.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CHRONICLE, FUNCTIONS } from "../scripts/syno.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const COMMANDS = join(ROOT, "commands");
const SKILLS = join(ROOT, "skills");
const KNOWN = new Set([...CHRONICLE, ...Object.keys(FUNCTIONS), "chronicle", "5s", "help", "version"]);
// About 3,000 tokens for every skill description together (PRD §12), at roughly 4 characters a token.
const DESCRIPTION_BUDGET = 12000;

const frontmatter = (text) => {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  return m ? Object.fromEntries(m[1].split("\n").map((l) => /^([\w-]+):\s*(.*)$/.exec(l)).filter(Boolean).map((x) => [x[1], x[2].replace(/^"|"$/g, "")])) : null;
};

const commandFiles = () => readdirSync(COMMANDS).filter((f) => f.endsWith(".md")).sort();
const skillFiles = () => (existsSync(SKILLS) ? readdirSync(SKILLS).map((d) => join(SKILLS, d, "SKILL.md")).filter(existsSync) : []);

test("§9 every command has a description and calls the CLI by its plugin path", () => {
  for (const f of commandFiles()) {
    const text = readFileSync(join(COMMANDS, f), "utf8");
    const fm = frontmatter(text);
    assert.ok(fm?.description?.length >= 20, `${f}: description`);
    if (/`syno /.test(text) || /syno\.js/.test(text)) assert.match(text, /node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/syno\.js"/, `${f}: CLI path`);
  }
});

test("§9 commands only name subcommands the CLI has", () => {
  for (const f of commandFiles()) {
    const text = readFileSync(join(COMMANDS, f), "utf8");
    const unknown = [...text.matchAll(/`syno ([a-z0-9]+)/g)].map((m) => m[1]).filter((s) => !KNOWN.has(s));
    assert.deepEqual(unknown, [], f);
  }
});

test("§5.1 every command that writes asks first and passes --confirm only on a yes", () => {
  for (const f of commandFiles()) {
    const text = readFileSync(join(COMMANDS, f), "utf8");
    if (!text.includes("--confirm")) continue;
    assert.match(text, /AskUserQuestion/, `${f} asks with AskUserQuestion`);
    assert.match(text, /only (on|after)/i, `${f} confirms only on a yes`);
  }
});

test("§12 skills are named, described, and fit the session budget together", () => {
  let total = 0;
  for (const file of skillFiles()) {
    const fm = frontmatter(readFileSync(file, "utf8"));
    assert.ok(fm?.name && /^[a-z0-9-]+$/.test(fm.name), `${file}: name`);
    assert.ok(fm?.description?.length >= 40 && fm.description.length <= 1024, `${file}: description length`);
    total += fm.description.length;
  }
  assert.ok(total <= DESCRIPTION_BUDGET, `all skill descriptions: ${total} characters`);
});

test("AC-CH-14.1 the capture skill offers one entry, with Record, Edit and Skip, and Skip writes nothing", () => {
  const text = readFileSync(join(SKILLS, "chronicle", "SKILL.md"), "utf8");
  assert.match(text, /at most one entry per finished task/i);
  assert.match(text, /Record, Edit and Skip/);
  assert.match(text, /On Skip, write nothing/);
});
