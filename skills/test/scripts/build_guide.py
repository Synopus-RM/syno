#!/usr/bin/env python3
"""Build a test guide's checklist page (HTML) and its Markdown copy from one guide.json.

Usage:
  python3 build_guide.py guide.json --html out/test-guide.html --md out/test-guide.md

The JSON shape is described in ../references/guide-format.md. The script checks it first and
stops with a plain list of problems, so a broken guide never reaches the tester.
"""
import argparse
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
TEMPLATE = HERE.parent / "assets" / "test-guide.html"
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,40}$")


def problems_in(guide):
    out = []
    for key in ("title", "summary", "minutes", "devices", "scenarios"):
        if key not in guide:
            out.append(f"missing '{key}'")
    if not isinstance(guide.get("devices", []), list) or not guide.get("devices"):
        out.append("'devices' needs at least one device")
    seen = set()
    for si, sc in enumerate(guide.get("scenarios", [])):
        where = f"scenario {si + 1}"
        for key in ("id", "kind", "title", "story", "steps"):
            if key not in sc:
                out.append(f"{where}: missing '{key}'")
        if sc.get("kind") not in ("story", "whatif"):
            out.append(f"{where}: 'kind' must be 'story' or 'whatif'")
        steps = sc.get("steps", [])
        if not steps:
            out.append(f"{where}: no steps")
        if len(steps) > 8:
            out.append(f"{where}: {len(steps)} steps; keep it to 8 or fewer (split it)")
        for ti, st in enumerate(steps):
            sid = st.get("id", "")
            if not ID_RE.match(sid):
                out.append(f"{where} step {ti + 1}: id '{sid}' must be lowercase letters, digits and dashes")
            if sid in seen:
                out.append(f"{where} step {ti + 1}: id '{sid}' is used twice")
            seen.add(sid)
            for key in ("do", "see"):
                if not str(st.get(key, "")).strip():
                    out.append(f"{where} step {ti + 1}: missing '{key}'")
    if not guide.get("scenarios"):
        out.append("no scenarios")
    return out


def md_inline(text):
    return str(text).strip()


def to_markdown(g):
    lines = [f"# {g['title']}", ""]
    meta = [f"About {g['minutes']} minutes"]
    if g.get("changeRef"):
        meta.append(g["changeRef"])
    if g.get("date"):
        meta.append(g["date"])
    lines += [" · ".join(meta), "", md_inline(g["summary"]), ""]
    if g.get("whyItMatters"):
        lines += [f"**Why it matters:** {md_inline(g['whyItMatters'])}", ""]
    lines += ["## Where to test", ""]
    for d in g["devices"]:
        lines.append(f"- **{d['name']}:** {md_inline(d.get('how', ''))}".rstrip())
    lines.append("")
    if g.get("before"):
        lines += ["## Before you start", ""]
        lines += [f"- [ ] {md_inline(b)}" for b in g["before"]]
        lines.append("")
    if g.get("sampleData"):
        lines += ["## Sample details to type", "", "| What | Type this |", "|---|---|"]
        lines += [f"| {s['label']} | `{s['value']}` |" for s in g["sampleData"]]
        lines.append("")
    for n, sc in enumerate(g["scenarios"], 1):
        label = "Everyday story" if sc["kind"] == "story" else "What if…"
        lines += [f"## {n}. {label}: {sc['title']}", "", f"_{md_inline(sc['story'])}_", ""]
        for i, st in enumerate(sc["steps"], 1):
            lines.append(f"{n}.{i} [ ] **Do:** {md_inline(st['do'])}  ")
            lines.append(f"      **You should see:** {md_inline(st['see'])}")
            if st.get("caution"):
                lines.append(f"      ⚠ {md_inline(st['caution'])}")
            lines.append("")
    if g.get("afterwards"):
        lines += ["## When you finish", "", md_inline(g["afterwards"]), ""]
    lines += ["If a step does not match, write down the step number and what you saw instead (a screenshot helps).", ""]
    return "\n".join(lines)


def to_html(g):
    page = TEMPLATE.read_text(encoding="utf-8")
    data = json.dumps(g, ensure_ascii=False, indent=1)
    # Keep the JSON inert inside <script type="application/json">.
    data = data.replace("</", "<\\/").replace("<!--", "<\\!--")
    title = re.sub(r"[<>&\"]", "", g["title"])[:80]
    if "__GUIDE_JSON__" not in page or "__GUIDE_TITLE__" not in page:
        sys.exit("template is missing its placeholders")
    return page.replace("__GUIDE_TITLE__", title).replace("__GUIDE_JSON__", data)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("guide")
    ap.add_argument("--html", required=True)
    ap.add_argument("--md")
    args = ap.parse_args()
    guide = json.loads(Path(args.guide).read_text(encoding="utf-8"))
    found = problems_in(guide)
    if found:
        print("The guide needs fixing before it can be built:")
        for p in found:
            print(f"  - {p}")
        sys.exit(1)
    Path(args.html).parent.mkdir(parents=True, exist_ok=True)
    Path(args.html).write_text(to_html(guide), encoding="utf-8")
    steps = sum(len(s["steps"]) for s in guide["scenarios"])
    print(f"page: {args.html} ({len(guide['scenarios'])} scenarios, {steps} steps)")
    if args.md:
        Path(args.md).parent.mkdir(parents=True, exist_ok=True)
        Path(args.md).write_text(to_markdown(guide), encoding="utf-8")
        print(f"markdown: {args.md}")


if __name__ == "__main__":
    main()
