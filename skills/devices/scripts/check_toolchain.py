#!/usr/bin/env python3
"""Compare installed tools and project dependencies with what is current today.

Usage: check_toolchain.py [PROJECT] [--json] [--offline]

Reads the latest published versions from the npm registry (`npm view`) so the
answer reflects the day it runs, not the day the plugin was written. Store
rules (Android target API, Xcode/SDK floor) cannot be read from a registry:
re-verify those on the web and record them in <project>/app-sync/baseline.json.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from appsync_common import (clean_range, desktop_dir, find_project_root, load_baseline,  # noqa: E402
                            load_config, load_json, mobile_dir, parse_semver, version_ge)

LOCAL_TOOLS = {
    "node": (["node", "--version"], "node"),
    "npm": (["npm", "--version"], None),
    "rustc": (["rustc", "--version"], "rust"),
    "cargo": (["cargo", "--version"], None),
    "java": (["java", "-version"], "java"),
    "xcodebuild": (["xcodebuild", "-version"], None),
    "gh": (["gh", "--version"], None),
}


def run(cmd: list[str], timeout: int = 25) -> str | None:
    if not shutil.which(cmd[0]):
        return None
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return (r.stdout + r.stderr).strip() or None
    except (OSError, subprocess.SubprocessError):
        return None


def first_version(s: str | None) -> str | None:
    if not s:
        return None
    # Skip noise such as "Picked up JAVA_TOOL_OPTIONS: ... 127.0.0.1"; prefer a line naming a version.
    lines = [l for l in s.splitlines() if not l.startswith("Picked up")]
    named = [l for l in lines if re.search(r"version|^v?\d|rustc|cargo|xcode|gh ", l, re.I)]
    s = "\n".join(named or lines)
    m = re.search(r"(\d+)\.(\d+)(?:\.(\d+))?", s)
    if not m:
        return None
    return f"{m.group(1)}.{m.group(2)}.{m.group(3) or 0}"


def npm_latest(pkg: str) -> str | None:
    out = run(["npm", "view", pkg, "version"])
    if out and parse_semver(out.splitlines()[-1].strip()):
        return out.splitlines()[-1].strip()
    return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("project", nargs="?", default=None)
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--offline", action="store_true", help="skip registry lookups")
    a = ap.parse_args()
    root = find_project_root(a.project)
    cfg = load_config(root) or {}
    base = load_baseline(root)

    local = []
    for name, (cmd, key) in LOCAL_TOOLS.items():
        v = first_version(run(cmd))
        floor = (base.get(key) or {}).get("min") if key else None
        if name == "xcodebuild":
            floor = (base.get("ios") or {}).get("xcodeMin")
            floor = clean_range(floor) if floor else None
        status = "missing" if not v else ("ok" if not floor or version_ge(v, floor) else "too old")
        local.append({"tool": name, "installed": v, "floor": floor, "status": status})

    project: dict[str, str] = {}
    for d in (desktop_dir(root, cfg), mobile_dir(root, cfg)):
        pkg = load_json(d / "package.json") or {}
        for k, v in ((pkg.get("dependencies") or {}) | (pkg.get("devDependencies") or {})).items():
            installed = (load_json(d / "node_modules" / k / "package.json") or {}).get("version")
            project[k] = installed or clean_range(v)

    registry = []
    if not a.offline:
        for pkg in base.get("registryWatch", []):
            latest = npm_latest(pkg)
            have = project.get(pkg)
            st = "n/a" if not have else ("unknown" if not latest else ("current" if version_ge(have, latest) else
                 ("major behind" if parse_semver(latest)[0] > parse_semver(have)[0] else "update available")))
            registry.append({"package": pkg, "project": have, "latest": latest, "status": st})

    res = {"baseline": {"asOf": base.get("asOf"), "source": base.get("_source")},
           "local": local, "registry": registry,
           "storeRules": {"android": (base.get("android") or {}).get("rule"), "ios": (base.get("ios") or {}).get("rule")}}
    if a.json:
        print(json.dumps(res, indent=2))
        return 0
    print(f"Baseline as of {res['baseline']['asOf']} ({res['baseline']['source']})\n")
    print("Local tools:")
    for r in local:
        print(f"  {r['tool']:10} {r['installed'] or '-':12} floor {r['floor'] or '-':10} {r['status']}")
    if registry:
        print("\nPackages (project vs latest published today):")
        for r in registry:
            print(f"  {r['package']:28} {r['project'] or '-':10} {r['latest'] or '?':10} {r['status']}")
    print("\nStore rules to re-verify before release:")
    for k, v in res["storeRules"].items():
        print(f"  {k}: {v}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
