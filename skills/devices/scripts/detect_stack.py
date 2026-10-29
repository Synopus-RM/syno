#!/usr/bin/env python3
"""Inspect a web-app repository and report what the native shells need to know.

Usage: detect_stack.py [PROJECT_DIR] [--json]

Reports: web framework, package manager, build command, build output folder,
whether the web build can be bundled into an app (static output) or only
opened live (server-rendered), backend type, existing desktop/mobile shells,
PRD candidates, and the GitHub remote.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from appsync_common import CONFIG_NAME, SKIP_DIRS, load_config, load_json, rel  # noqa: E402

WEB_SUBDIRS = ["", "frontend", "web", "client", "app", "ui", "apps/web", "packages/web"]


def detect_pm(d: Path) -> str:
    for lock, pm in (("pnpm-lock.yaml", "pnpm"), ("yarn.lock", "yarn"), ("bun.lockb", "bun"),
                     ("bun.lock", "bun"), ("package-lock.json", "npm")):
        if (d / lock).exists():
            return pm
    return "npm"


def read(p: Path) -> str:
    try:
        return p.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return ""


def first_existing(d: Path, names: list[str]) -> Path | None:
    for n in names:
        if (d / n).exists():
            return d / n
    return None


def detect_web(root: Path) -> dict | None:
    for sub in WEB_SUBDIRS:
        d = root / sub if sub else root
        pkg = load_json(d / "package.json")
        if not pkg:
            continue
        deps = {**(pkg.get("dependencies") or {}), **(pkg.get("devDependencies") or {})}
        if not any(k in deps for k in ("react", "vue", "svelte", "@angular/core", "next", "nuxt",
                                        "astro", "solid-js", "vite", "react-scripts", "preact",
                                        "@sveltejs/kit", "@remix-run/react", "lit")):
            continue
        scripts = pkg.get("scripts") or {}
        pm = detect_pm(d)
        run = {"npm": "npm run", "pnpm": "pnpm", "yarn": "yarn", "bun": "bun run"}[pm]
        info = {
            "root": sub or ".",
            "packageName": pkg.get("name"),
            "version": pkg.get("version"),
            "packageManager": pm,
            "buildCommand": f"{run} build" if "build" in scripts else None,
            "framework": "unknown",
            "outputDir": "dist",
            "bundleable": True,
            "notes": [],
        }
        if "next" in deps:
            info["framework"] = "next"
            cfg = read(first_existing(d, ["next.config.ts", "next.config.mjs", "next.config.js"]) or d / "_")
            if re.search(r"output\s*:\s*['\"]export['\"]", cfg):
                info["outputDir"] = "out"
            else:
                info["bundleable"] = False
                info["outputDir"] = None
                info["notes"].append("Next.js without output:'export' is server-rendered; apps must open it live.")
        elif "nuxt" in deps:
            info["framework"] = "nuxt"
            gen = "generate" in scripts and "nuxt generate" in str(scripts.get("generate", ""))
            info["outputDir"] = ".output/public"
            if gen:
                info["buildCommand"] = f"{run} generate"
            else:
                info["bundleable"] = False
                info["notes"].append("Nuxt without `nuxt generate` is server-rendered; apps must open it live.")
        elif "@sveltejs/kit" in deps:
            info["framework"] = "sveltekit"
            info["outputDir"] = "build"
            if "@sveltejs/adapter-static" not in deps:
                info["bundleable"] = False
                info["notes"].append("SvelteKit without adapter-static is server-rendered; apps must open it live.")
        elif "@remix-run/react" in deps:
            info["framework"] = "remix"
            info["bundleable"] = False
            info["outputDir"] = None
            info["notes"].append("Remix is server-rendered; apps must open it live.")
        elif "@angular/core" in deps:
            info["framework"] = "angular"
            ang = load_json(d / "angular.json") or {}
            out = None
            for proj in (ang.get("projects") or {}).values():
                opts = (((proj.get("architect") or {}).get("build") or {}).get("options") or {})
                op = opts.get("outputPath")
                if isinstance(op, dict):
                    op = op.get("base")
                if op:
                    out = op
                    break
            out = out or "dist"
            # Angular 17+ application builder writes into <outputPath>/browser
            builder = json.dumps(ang)
            if "@angular-devkit/build-angular:application" in builder or "@angular/build:application" in builder:
                out = f"{out.rstrip('/')}/browser"
            info["outputDir"] = out
        elif "astro" in deps:
            info["framework"] = "astro"
            cfg = read(first_existing(d, ["astro.config.mjs", "astro.config.ts"]) or d / "_")
            if re.search(r"output\s*:\s*['\"]server['\"]", cfg):
                info["bundleable"] = False
                info["notes"].append("Astro output:'server' is server-rendered; apps must open it live.")
        elif "react-scripts" in deps:
            info["framework"] = "create-react-app"
            info["outputDir"] = "build"
        elif "vite" in deps:
            fw = "vue" if "vue" in deps else "svelte" if "svelte" in deps else "react" if "react" in deps else "solid" if "solid-js" in deps else "vanilla"
            info["framework"] = f"vite-{fw}"
            cfg = read(first_existing(d, ["vite.config.ts", "vite.config.mts", "vite.config.js", "vite.config.mjs"]) or d / "_")
            m = re.search(r"outDir\s*:\s*['\"]([^'\"]+)['\"]", cfg)
            if m:
                info["outputDir"] = m.group(1)
            if re.search(r"base\s*:\s*['\"]/[^'\"]+['\"]", cfg):
                info["notes"].append("vite `base` is a sub-path; bundled apps need base './' or '/' for local assets.")
        elif "vue" in deps:
            info["framework"] = "vue-cli"
        if not info["buildCommand"]:
            info["notes"].append("No `build` script in package.json; set web.buildCommand in app-sync.json.")
        return info
    return None


def detect_backend(root: Path) -> dict:
    out: dict = {"type": None, "serverRenderedHtml": False, "evidence": []}
    composer = load_json(root / "composer.json")
    if composer:
        req = json.dumps(composer.get("require") or {})
        if "slim/slim" in req:
            out["type"] = "php-slim"
        elif "laravel/framework" in req:
            out["type"] = "php-laravel"
        else:
            out["type"] = "php"
        out["evidence"].append("composer.json")
        if (root / "templates").is_dir() or (root / "resources" / "views").is_dir() or "twig" in req:
            out["serverRenderedHtml"] = True
    py = read(root / "requirements.txt") + read(root / "pyproject.toml")
    if py:
        for k, name in (("fastapi", "python-fastapi"), ("django", "python-django"), ("flask", "python-flask")):
            if re.search(rf"\b{k}\b", py, re.I):
                out["type"] = out["type"] or name
                out["evidence"].append("requirements.txt/pyproject.toml")
                break
        if re.search(r"\bjinja2\b", py, re.I) and (root / "templates").is_dir():
            out["serverRenderedHtml"] = True
    if (root / "serverless.yml").exists() or (root / "template.yaml").exists():
        out["evidence"].append("AWS Lambda/serverless config present")
    return out


def detect_shells(root: Path, cfg: dict | None) -> dict:
    res: dict = {"desktop": None, "mobile": None}
    cands_d = []
    if cfg:
        cands_d.append(root / ((cfg.get("platforms") or {}).get("desktop") or {}).get("path", "apps/desktop"))
    cands_d += [root / "apps/desktop", root / "desktop", root]
    for d in cands_d:
        conf = d / "src-tauri" / "tauri.conf.json"
        if conf.is_file():
            c = load_json(conf) or {}
            res["desktop"] = {"engine": "tauri", "path": rel(root, d), "version": c.get("version"),
                              "identifier": c.get("identifier"), "productName": c.get("productName")}
            break
        if (d / "package.json").is_file() and "electron" in read(d / "package.json"):
            res["desktop"] = {"engine": "electron", "path": rel(root, d),
                              "note": "Electron shell found; plugin standard is Tauri 2. Migrate or keep consistent."}
            break
    cands_m = []
    if cfg:
        cands_m.append(root / (cfg.get("mobile") or {}).get("path", "apps/mobile"))
    cands_m += [root / "apps/mobile", root / "mobile", root]
    for d in cands_m:
        conf = first_existing(d, ["capacitor.config.ts", "capacitor.config.json", "capacitor.config.js"])
        if conf:
            pkg = load_json(d / "package.json") or {}
            deps = {**(pkg.get("dependencies") or {}), **(pkg.get("devDependencies") or {})}
            res["mobile"] = {"engine": "capacitor", "path": rel(root, d), "config": conf.name,
                             "capacitorCore": deps.get("@capacitor/core"),
                             "android": (d / "android").is_dir(), "ios": (d / "ios").is_dir()}
            break
    return res


def find_prd(root: Path) -> list[str]:
    hits: list[tuple[int, str]] = []
    name_re = re.compile(r"(^|[^a-z])(prd|product[-_ ]?requirements?|requirements?[-_ ]?doc|brd|srs)([^a-z]|$)", re.I)
    for p in root.rglob("*"):
        if any(part in SKIP_DIRS or part.startswith(".") for part in p.relative_to(root).parts[:-1]):
            continue
        if not p.is_file() or p.suffix.lower() not in {".md", ".txt", ".docx", ".pdf", ".mdx"}:
            continue
        score = 0
        if name_re.search(p.stem):
            score += 10
        if p.suffix.lower() in {".md", ".mdx", ".txt"}:
            head = read(p)[:4000]
            if re.search(r"product requirements? document|\bPRD\b", head, re.I):
                score += 5
        if score:
            hits.append((score, rel(root, p)))
    return [h for _, h in sorted(hits, key=lambda x: (-x[0], x[1]))][:10]


def git_remote(root: Path) -> str | None:
    try:
        out = subprocess.run(["git", "-C", str(root), "remote", "get-url", "origin"],
                             capture_output=True, text=True, timeout=10)
        url = out.stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return None
    m = re.search(r"github\.com[:/]([^/]+/[^/.]+)", url)
    return m.group(1) if m else (url or None)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("project", nargs="?", default=".")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    root = Path(a.project).resolve()
    cfg = load_config(root)
    report = {
        "projectRoot": str(root),
        "appSyncConfig": CONFIG_NAME if cfg else None,
        "web": detect_web(root),
        "backend": detect_backend(root),
        "shells": detect_shells(root, cfg),
        "prdCandidates": find_prd(root),
        "githubRepo": git_remote(root),
        "workflows": sorted(p.name for p in (root / ".github" / "workflows").glob("app-sync-*.yml")),
    }
    web = report["web"]
    if web is None and report["backend"]["serverRenderedHtml"]:
        report["bundleable"] = False
        report["bundleableReason"] = "Server-rendered HTML backend with no separate SPA build: live mode only."
    elif web is None:
        report["bundleable"] = False
        report["bundleableReason"] = "No JavaScript front end found; confirm how the web UI is produced."
    else:
        report["bundleable"] = web["bundleable"]
        report["bundleableReason"] = "; ".join(web["notes"]) or "Static build output available."

    if a.json:
        print(json.dumps(report, indent=2))
        return 0
    print(f"Project: {root}")
    print(f"app-sync.json: {'present' if cfg else 'not yet created'}")
    if web:
        print(f"Web: {web['framework']} ({web['packageManager']}) in '{web['root']}', build: {web['buildCommand']}, output: {web['outputDir']}")
    else:
        print("Web: no SPA front end detected")
    b = report["backend"]
    print(f"Backend: {b['type'] or 'none detected'}{' (server-rendered HTML)' if b['serverRenderedHtml'] else ''}")
    print(f"Bundleable into apps: {report['bundleable']} - {report['bundleableReason']}")
    sh = report["shells"]
    print(f"Desktop shell: {sh['desktop'] or 'none'}")
    print(f"Mobile shell: {sh['mobile'] or 'none'}")
    print(f"PRD candidates: {', '.join(report['prdCandidates']) or 'none found'}")
    print(f"GitHub repo: {report['githubRepo'] or 'unknown'}")
    print(f"app-sync workflows: {', '.join(report['workflows']) or 'none'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
