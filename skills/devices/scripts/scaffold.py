#!/usr/bin/env python3
"""Create the app-sync config or a shell from the plugin templates.

Usage:
  scaffold.py [PROJECT] config  --name "Demo Desk" --id in.synopus.desk --live-url https://desk.example.com
  scaffold.py [PROJECT] desktop [--force]
  scaffold.py [PROJECT] mobile  [--force]
  scaffold.py [PROJECT] workflows [--force]

Fills {{TOKENS}} from app-sync.json. Never overwrites an existing file unless
--force is given; reports what it skipped instead.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from appsync_common import (CONFIG_NAME, SKILL_DIR, desktop_dir, find_project_root,  # noqa: E402
                            load_config, mobile_dir, rel, save_json, slugify)

PLUGIN_SKILLS = SKILL_DIR.parent
TEXT_SUFFIXES = {".json", ".toml", ".rs", ".ts", ".js", ".yml", ".yaml", ".md", ".html", ".py", ".txt", ""}


def tokens(root: Path, cfg: dict) -> dict[str, str]:
    app = cfg.get("app") or {}
    name = app.get("name", "App")
    slug = slugify(app.get("shortName") or name)
    gh = (cfg.get("github") or {}).get("repo", "OWNER/REPO")
    return {
        "APP_NAME": name,
        "APP_SHORT": app.get("shortName", name),
        "APP_ID": app.get("id", f"in.synopus.{slug.replace('-', '')}"),
        "TAGLINE": app.get("tagline", ""),
        "VERSION": cfg.get("version", "1.0.0"),
        "SLUG": slug,
        "CRATE": slug.replace("-", "_") + "_desktop",
        "BG": (cfg.get("brand") or {}).get("background", "#0E1222"),
        "YEAR": str(datetime.now().year),
        "GITHUB_REPO": gh,
        "UPDATER_PUBKEY": ((cfg.get("platforms") or {}).get("desktop") or {}).get("updaterPubkey", "REPLACE_WITH_TAURI_SIGNER_PUBLIC_KEY"),
        "MOBILE_PATH": (cfg.get("mobile") or {}).get("path", "apps/mobile"),
        "DESKTOP_PATH": ((cfg.get("platforms") or {}).get("desktop") or {}).get("path", "apps/desktop"),
        "WEB_ROOT": (cfg.get("web") or {}).get("root", "."),
    }


def fill(text: str, toks: dict[str, str]) -> str:
    return re.sub(r"\{\{([A-Z_]+)\}\}", lambda m: toks.get(m.group(1), m.group(0)), text)


def copy_tree(src: Path, dst: Path, toks: dict[str, str], force: bool, root: Path, skip: set[str] = frozenset()) -> list[str]:
    log = []
    for f in sorted(src.rglob("*")):
        if not f.is_file() or f.name in skip:
            continue
        target = dst / f.relative_to(src)
        if target.exists() and not force:
            log.append(f"kept     {rel(root, target)}")
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        if f.suffix in TEXT_SUFFIXES:
            target.write_text(fill(f.read_text(encoding="utf-8"), toks), encoding="utf-8")
        else:
            shutil.copy2(f, target)
        log.append(f"wrote    {rel(root, target)}")
    return log


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("project", nargs="?", default=".")
    ap.add_argument("what", choices=["config", "desktop", "mobile", "workflows"])
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--name")
    ap.add_argument("--id")
    ap.add_argument("--live-url")
    a = ap.parse_args()
    root = Path(a.project).resolve()

    if a.what == "config":
        if (root / CONFIG_NAME).exists() and not a.force:
            print(f"{CONFIG_NAME} already exists; edit it instead (or --force).")
            return 1
        if not (a.name and a.id):
            print("config needs --name and --id", file=sys.stderr)
            return 2
        tpl = json.loads((SKILL_DIR / "templates" / "app-sync.json").read_text(encoding="utf-8"))
        slug = slugify(a.name)
        tpl["app"].update({"name": a.name, "shortName": a.name, "id": a.id, "tagline": ""})
        tpl["web"]["liveUrl"] = a.live_url or ""
        tpl["ota"] = {"provider": "self-hosted", "baseUrl": "", "updateUrl": ""}
        tpl["decision"]["source"] = ""
        save_json(root / CONFIG_NAME, tpl)
        print(f"wrote    {CONFIG_NAME} (slug {slug}); fill web, brand, platforms and decision next")
        # The project owns its chrome pages; start them from the baseline and make them bespoke.
        for f in sorted((SKILL_DIR / "templates" / "chrome").glob("*.html")):
            t = root / "app-sync" / "chrome" / f.name
            if not t.exists():
                t.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(f, t)
                print(f"wrote    {rel(root, t)} (baseline; restyle for this app)")
        return 0

    cfg = load_config(root)
    if not cfg:
        print("Create app-sync.json first: scaffold.py PROJECT config ...", file=sys.stderr)
        return 2
    root = find_project_root(root)
    toks = tokens(root, cfg)
    if a.what == "desktop":
        log = copy_tree(PLUGIN_SKILLS / "devices-desktop" / "templates", desktop_dir(root, cfg), toks, a.force, root)
    elif a.what == "mobile":
        log = copy_tree(PLUGIN_SKILLS / "devices-mobile" / "templates", mobile_dir(root, cfg), toks, a.force, root,
                        skip={"ota_update_lambda.py"})
        lam = root / "app-sync" / "ota-endpoint" / "lambda_function.py"
        if not lam.exists() or a.force:
            lam.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(PLUGIN_SKILLS / "devices-mobile" / "templates" / "ota_update_lambda.py", lam)
            log.append(f"wrote    {rel(root, lam)}")
    else:
        log = copy_tree(PLUGIN_SKILLS / "devices-release" / "templates" / "workflows", root / ".github" / "workflows",
                        toks, a.force, root)
        plats = {k for k, v in (cfg.get("platforms") or {}).items() if v.get("enabled", True)}
        bundled = any((cfg["platforms"].get(p) or {}).get("mode", "live") != "live" for p in plats)
        for p, fname in (("desktop", "app-sync-desktop.yml"), ("android", "app-sync-android.yml"), ("ios", "app-sync-ios.yml")):
            f = root / ".github" / "workflows" / fname
            if p not in plats and f.exists() and f"wrote    {rel(root, f)}" in log:
                f.unlink()
                log.append(f"removed  {rel(root, f)} (platform disabled)")
        f = root / ".github" / "workflows" / "app-sync-web-update.yml"
        if not bundled and f.exists() and f"wrote    {rel(root, f)}" in log:
            f.unlink()
            log.append(f"removed  {rel(root, f)} (every platform is live; nothing to push on web changes)")
        # Workflows call the plugin scripts from a vendored copy inside the repo.
        vend = root / "app-sync" / "tools"
        for s in sorted((SKILL_DIR / "scripts").glob("*")):
            if s.suffix in {".py", ".json"}:
                t = vend / s.name
                if not t.exists() or a.force or s.read_bytes() != t.read_bytes():
                    t.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(s, t)
                    log.append(f"vendored {rel(root, t)}")
    print("\n".join(log))
    return 0


if __name__ == "__main__":
    sys.exit(main())
