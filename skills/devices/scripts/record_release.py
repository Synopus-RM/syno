#!/usr/bin/env python3
"""Record that a native store build went out, so OTA packaging knows which
native layer users have.

Usage: record_release.py [PROJECT] --platform android|ios|desktop [--platform ...]

Writes app-sync.json state.lastNativeRelease (mobile) or state.lastDesktopRelease.
Run it after a successful store upload; the release workflows call it.
"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from appsync_common import find_project_root, load_config, native_fingerprint, save_json  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("project", nargs="?", default=None)
    ap.add_argument("--platform", action="append", required=True, choices=["android", "ios", "desktop"])
    a = ap.parse_args()
    root = find_project_root(a.project)
    cfg = load_config(root)
    if not cfg:
        print("No app-sync.json found.", file=sys.stderr)
        return 2
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    state = cfg.setdefault("state", {})
    mob = [p for p in a.platform if p in ("android", "ios")]
    if mob:
        prev = state.get("lastNativeRelease") or {}
        plats = sorted(set(prev.get("platforms", [])) | set(mob)) if prev.get("version") == cfg["version"] else mob
        state["lastNativeRelease"] = {"version": cfg["version"], "build": cfg.get("build"),
                                      "fingerprint": native_fingerprint(root, cfg), "platforms": plats, "at": now}
    if "desktop" in a.platform:
        state["lastDesktopRelease"] = {"version": cfg["version"], "build": cfg.get("build"), "at": now}
    save_json(root / "app-sync.json", cfg)
    print(f"Recorded release {cfg['version']} (build {cfg.get('build')}) for {', '.join(a.platform)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
