#!/usr/bin/env python3
"""Build the web app and copy it into each shell, the way app-sync.json says.

Usage: sync_web.py [PROJECT] [--skip-build] [--platform desktop|android|ios ...]
                   [--cap-sync] [--dry-run]

What lands in each shell's www/ folder:
  desktop live        boot page as index.html + offline.html (no web build)
  desktop bundled     web build + offline.html
  mobile (any mode)   web build + offline.html + app-sync-ready.js
                      (live platforms load the live URL; offline.html is their
                      error page; the bundle is still shipped as a fallback)

Chrome pages come from <project>/app-sync/chrome/ when present (the bespoke,
per-app design) and fall back to the plugin template. Tokens like
{{APP_NAME}} are filled from app-sync.json.

--cap-sync runs `npx cap sync <platform>` once per enabled mobile platform with
APP_SYNC_PLATFORM set, so capacitor.config.ts can apply that platform's mode.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from appsync_common import (CHROME_FILES, SKILL_DIR, STAMP_NAME, desktop_dir,  # noqa: E402
                            enabled_platforms, find_project_root, load_config, mobile_dir,
                            platform_cfg, rel, save_json, tree_hash, web_output, web_root)

READY_JS = """/* Confirms a bundled update booted correctly so the updater keeps it. Safe on the web. */
(function () {
  try {
    var cap = window.Capacitor;
    if (cap && cap.isNativePlatform && cap.isNativePlatform() && cap.Plugins && cap.Plugins.CapacitorUpdater) {
      cap.Plugins.CapacitorUpdater.notifyAppReady();
    }
  } catch (e) { /* not running in the mobile shell */ }
})();
"""


def tokens(cfg: dict) -> dict[str, str]:
    app = cfg.get("app") or {}
    brand = cfg.get("brand") or {}
    credit = cfg.get("credit") or {}
    web = cfg.get("web") or {}
    ctext = credit.get("text", "Designed & Developed by Synopus")
    lead, _, name = ctext.rpartition(" by ")
    return {
        "CREDIT_LEAD": (lead + " by") if lead else "Designed & Developed by",
        "CREDIT_NAME": name or ctext,
        "APP_NAME": app.get("name", "App"),
        "APP_SHORT": app.get("shortName", app.get("name", "App")),
        "APP_INITIAL": (app.get("shortName") or app.get("name") or "A")[:1].upper(),
        "TAGLINE": app.get("tagline", ""),
        "LIVE_URL": web.get("liveUrl", ""),
        "VERSION": cfg.get("version", "0.1.0"),
        "BUILD": str(cfg.get("build", 1)),
        "PRIMARY": brand.get("primary", "#6C5CE7"),
        "ACCENT": brand.get("accent", "#00D1B2"),
        "BG": brand.get("background", "#0B0B12"),
        "INK": brand.get("ink", "#F5F4FA"),
        "CREDIT_TEXT": credit.get("text", "Designed & Developed by Synopus"),
        "CREDIT_URL": credit.get("url", "https://www.synopus.in"),
        "YEAR": str(datetime.now().year),
    }


def render(src: Path, toks: dict[str, str]) -> str:
    t = src.read_text(encoding="utf-8")
    return re.sub(r"\{\{([A-Z_]+)\}\}", lambda m: toks.get(m.group(1), m.group(0)), t)


def chrome_source(root: Path, name: str) -> Path:
    own = root / "app-sync" / "chrome" / name
    if own.is_file():
        return own
    fallback = SKILL_DIR / "templates" / "chrome" / name
    if fallback.is_file():
        return fallback
    raise SystemExit(f"Missing chrome page {name}: expected {own}")


def inject_ready(index: Path) -> None:
    if not index.is_file():
        return
    t = index.read_text(encoding="utf-8")
    if "app-sync-ready.js" in t:
        return
    tag = '<script src="./app-sync-ready.js"></script>'
    t = t.replace("</head>", f"  {tag}\n</head>", 1) if "</head>" in t else tag + "\n" + t
    index.write_text(t, encoding="utf-8")


def git_commit(root: Path) -> str | None:
    try:
        r = subprocess.run(["git", "-C", str(root), "rev-parse", "--short", "HEAD"],
                           capture_output=True, text=True, timeout=10)
        return r.stdout.strip() or None
    except (OSError, subprocess.SubprocessError):
        return None


def fill(dest: Path, web_out: Path | None, chrome: dict[str, str], dry: bool) -> None:
    if dry:
        return
    if dest.exists():
        shutil.rmtree(dest)
    if web_out is not None:
        shutil.copytree(web_out, dest)
    else:
        dest.mkdir(parents=True)
    for name, content in chrome.items():
        (dest / name).write_text(content, encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("project", nargs="?", default=None)
    ap.add_argument("--skip-build", action="store_true")
    ap.add_argument("--platform", action="append", choices=["desktop", "android", "ios"])
    ap.add_argument("--cap-sync", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    root = find_project_root(a.project)
    cfg = load_config(root)
    if not cfg:
        print("No app-sync.json found.", file=sys.stderr)
        return 2
    plats = [p for p in enabled_platforms(cfg) if not a.platform or p in a.platform]
    web = cfg.get("web") or {}
    toks = tokens(cfg)
    needs_build = any(platform_cfg(cfg, p).get("mode", "live") != "live" for p in plats) or \
        any(p in plats for p in ("android", "ios"))

    out = web_output(root, cfg)
    if needs_build and web.get("bundleable", True):
        if not a.skip_build:
            cmd = web.get("buildCommand")
            if not cmd:
                print("web.buildCommand is empty in app-sync.json.", file=sys.stderr)
                return 2
            print(f"Building web app: {cmd}")
            if not a.dry_run:
                r = subprocess.run(cmd, shell=True, cwd=web_root(root, cfg))
                if r.returncode != 0:
                    print("Web build failed; shells left unchanged.", file=sys.stderr)
                    return r.returncode
        if not out.is_dir() and not a.dry_run:
            print(f"Web build output not found at {rel(root, out)}.", file=sys.stderr)
            return 2
    web_hash = tree_hash(out) if out.is_dir() else None
    offline = render(chrome_source(root, "offline.html"), toks)
    boot = render(chrome_source(root, "boot.html"), toks)
    stamp = {"version": cfg.get("version"), "build": cfg.get("build"), "webHash": web_hash,
             "gitCommit": git_commit(root), "syncedAt": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    report = []

    if "desktop" in plats:
        mode = platform_cfg(cfg, "desktop").get("mode", "live")
        dest = desktop_dir(root, cfg) / "www"
        if mode == "live" or not web.get("bundleable", True):
            fill(dest, None, {"index.html": boot, "offline.html": offline,
                              STAMP_NAME: json.dumps({**stamp, "mode": "live", "webHash": None}, indent=2)}, a.dry_run)
        else:
            fill(dest, out, {"offline.html": offline,
                             STAMP_NAME: json.dumps({**stamp, "mode": mode}, indent=2)}, a.dry_run)
        report.append(f"desktop ({mode}) -> {rel(root, dest)}")

    mob = [p for p in plats if p in ("android", "ios")]
    if mob:
        dest = mobile_dir(root, cfg) / "www"
        modes = {p: platform_cfg(cfg, p).get("mode", "live") for p in mob}
        if web.get("bundleable", True) and (out.is_dir() or a.dry_run):
            fill(dest, out if out.is_dir() else None,
                 {"offline.html": offline, "app-sync-ready.js": READY_JS,
                  STAMP_NAME: json.dumps({**stamp, "modes": modes}, indent=2)}, a.dry_run)
            if not a.dry_run:
                inject_ready(dest / "index.html")
        else:
            # server-rendered web: ship the boot page so the app still opens with no network
            fill(dest, None, {"index.html": boot, "offline.html": offline,
                              STAMP_NAME: json.dumps({**stamp, "modes": modes, "webHash": None}, indent=2)}, a.dry_run)
        report.append(f"mobile {modes} -> {rel(root, dest)}")
        if a.cap_sync and not a.dry_run:
            for p in mob:
                if not (mobile_dir(root, cfg) / p).is_dir():
                    print(f"  skip cap sync {p}: platform folder not added yet (npx cap add {p})")
                    continue
                env = {**os.environ, "APP_SYNC_PLATFORM": p}
                print(f"npx cap sync {p}  (APP_SYNC_PLATFORM={p})")
                r = subprocess.run(["npx", "cap", "sync", p], cwd=mobile_dir(root, cfg), env=env)
                if r.returncode != 0:
                    return r.returncode

    cfg.setdefault("state", {})["lastWebSync"] = stamp
    if not a.dry_run:
        save_json(root / "app-sync.json", cfg)
    print("Synced:" if not a.dry_run else "Would sync:")
    for line in report:
        print(f"  {line}")
    print(f"  web build hash: {web_hash or 'n/a (live only)'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
