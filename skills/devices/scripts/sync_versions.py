#!/usr/bin/env python3
"""Keep one version and one build number across the web app and every shell.

Usage:
  sync_versions.py [PROJECT] --check            report drift, exit 1 if any
  sync_versions.py [PROJECT]                    propagate app-sync.json version/build
  sync_versions.py [PROJECT] --from-web         take the version from the web package.json
  sync_versions.py [PROJECT] --bump patch|minor|major
  sync_versions.py [PROJECT] --set 2.4.0

Every write also increments nothing unless --bump/--set/--from-web changed the
version; those three always add 1 to the build number, so Android versionCode
and iOS CURRENT_PROJECT_VERSION only ever go up.

Targets: tauri.conf.json, Cargo.toml [package], desktop + mobile package.json,
android/app/build.gradle(.kts) versionName/versionCode, iOS project.pbxproj
MARKETING_VERSION / CURRENT_PROJECT_VERSION.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from appsync_common import (bump, desktop_dir, find_project_root, load_config, load_json,  # noqa: E402
                            mobile_dir, parse_semver, rel, save_json, web_root)

ANDROID_MAX_CODE = 2_100_000_000


class Target:
    def __init__(self, path: Path, kind: str):
        self.path, self.kind = path, kind

    def read(self) -> tuple[str | None, int | None]:
        t = self.path.read_text(encoding="utf-8")
        if self.kind in ("tauri", "package"):
            d = json.loads(t)
            return d.get("version"), None
        if self.kind == "cargo":
            m = re.search(r"(?ms)^\[package\][^\[]*?^version\s*=\s*\"([^\"]+)\"", t)
            return (m.group(1) if m else None), None
        if self.kind == "gradle":
            vn = re.search(r"versionName\s*=?\s*\"([^\"]+)\"", t)
            vc = re.search(r"versionCode\s*=?\s*(\d+)", t)
            return (vn.group(1) if vn else None), (int(vc.group(1)) if vc else None)
        if self.kind == "pbxproj":
            mv = set(re.findall(r"MARKETING_VERSION = ([^;]+);", t))
            cv = set(re.findall(r"CURRENT_PROJECT_VERSION = ([^;]+);", t))
            v = mv.pop() if len(mv) == 1 else (",".join(sorted(mv)) or None)
            b = None
            if len(cv) == 1:
                try:
                    b = int(next(iter(cv)).strip('"'))
                except ValueError:
                    b = None
            return v, b
        return None, None

    def write(self, version: str, build: int) -> bool:
        t = self.path.read_text(encoding="utf-8")
        new = t
        if self.kind in ("tauri", "package"):
            d = json.loads(t)
            if d.get("version") == version:
                return False
            d["version"] = version
            indent = 2 if '\n  "' in t else 4 if '\n    "' in t else 2
            new = json.dumps(d, indent=indent, ensure_ascii=False) + "\n"
        elif self.kind == "cargo":
            new = re.sub(r"(?ms)(^\[package\][^\[]*?^version\s*=\s*\")[^\"]+(\")", rf"\g<1>{version}\g<2>", t, count=1)
        elif self.kind == "gradle":
            new = re.sub(r"(versionName\s*=?\s*\")[^\"]+(\")", rf"\g<1>{version}\g<2>", t)
            new = re.sub(r"(versionCode\s*=?\s*)\d+", rf"\g<1>{build}", new)
        elif self.kind == "pbxproj":
            new = re.sub(r"MARKETING_VERSION = [^;]+;", f"MARKETING_VERSION = {version};", t)
            new = re.sub(r"CURRENT_PROJECT_VERSION = [^;]+;", f"CURRENT_PROJECT_VERSION = {build};", new)
        if new != t:
            self.path.write_text(new, encoding="utf-8")
            return True
        return False


def targets(root: Path, cfg: dict) -> list[Target]:
    out: list[Target] = []
    d = desktop_dir(root, cfg)
    m = mobile_dir(root, cfg)
    for path, kind in (
        (d / "src-tauri" / "tauri.conf.json", "tauri"),
        (d / "src-tauri" / "Cargo.toml", "cargo"),
        (d / "package.json", "package"),
        (m / "package.json", "package"),
        (m / "android" / "app" / "build.gradle", "gradle"),
        (m / "android" / "app" / "build.gradle.kts", "gradle"),
        (m / "ios" / "App" / "App.xcodeproj" / "project.pbxproj", "pbxproj"),
    ):
        if path.is_file():
            out.append(Target(path, kind))
    return out


def windows_ok(v: str) -> bool:
    """MSI ProductVersion: major<=255, minor<=255, patch<=65535."""
    sv = parse_semver(v)
    return bool(sv) and sv[0] <= 255 and sv[1] <= 255 and sv[2] <= 65535


def check(root: Path, cfg: dict) -> list[dict]:
    want_v, want_b = cfg["version"], int(cfg.get("build", 1))
    rows = []
    for t in targets(root, cfg):
        v, b = t.read()
        ok_v = v == want_v
        ok_b = b is None or t.kind not in ("gradle", "pbxproj") or b == want_b
        rows.append({"file": rel(root, t.path), "version": v, "build": b, "ok": ok_v and ok_b})
    return rows


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("project", nargs="?", default=None)
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--check", action="store_true")
    g.add_argument("--bump", choices=["patch", "minor", "major"])
    g.add_argument("--set", metavar="VERSION")
    g.add_argument("--from-web", action="store_true")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()

    root = find_project_root(a.project)
    cfg = load_config(root)
    if not cfg:
        print(f"No app-sync.json under {root}. Run the app-sync setup first.", file=sys.stderr)
        return 2
    cfg.setdefault("version", "0.1.0")
    cfg.setdefault("build", 1)

    if a.check:
        rows = check(root, cfg)
        drift = [r for r in rows if not r["ok"]]
        if a.json:
            print(json.dumps({"version": cfg["version"], "build": cfg["build"], "targets": rows,
                              "drift": len(drift)}, indent=2))
        else:
            print(f"Source of truth: {cfg['version']} (build {cfg['build']})")
            for r in rows:
                print(f"  {'OK   ' if r['ok'] else 'DRIFT'} {r['file']}: {r['version']}"
                      + (f" (build {r['build']})" if r['build'] is not None else ""))
        return 1 if drift else 0

    old_v = cfg["version"]
    new_v = old_v
    if a.bump:
        new_v = bump(old_v, a.bump)
    elif a.set:
        if not parse_semver(a.set):
            print(f"--set needs MAJOR.MINOR.PATCH, got {a.set}", file=sys.stderr)
            return 2
        new_v = a.set.lstrip("v")
    elif a.from_web:
        pkg = load_json(web_root(root, cfg) / "package.json") or {}
        wv = pkg.get("version")
        if not wv or not parse_semver(wv):
            print("Web package.json has no semver version; use --set or --bump.", file=sys.stderr)
            return 2
        new_v = wv
    changed_version = new_v != old_v
    if a.bump or a.set or (a.from_web and changed_version):
        cfg["build"] = int(cfg["build"]) + 1
    if cfg["build"] > ANDROID_MAX_CODE:
        print("Build number exceeds Android's versionCode limit.", file=sys.stderr)
        return 2
    cfg["version"] = new_v
    if not windows_ok(new_v):
        print(f"Warning: {new_v} is outside Windows installer limits (255.255.65535).", file=sys.stderr)
    save_json(root / "app-sync.json", cfg)

    written = []
    for t in targets(root, cfg):
        if t.write(cfg["version"], int(cfg["build"])):
            written.append(rel(root, t.path))
    if (cfg.get("versionSource") == "web") and not a.from_web:
        pkgp = web_root(root, cfg) / "package.json"
        if pkgp.is_file():
            if Target(pkgp, "package").write(cfg["version"], cfg["build"]):
                written.append(rel(root, pkgp))
    res = {"from": old_v, "to": cfg["version"], "build": cfg["build"], "updated": written}
    if a.json:
        print(json.dumps(res, indent=2))
    else:
        print(f"Version {old_v} -> {cfg['version']} (build {cfg['build']})")
        for w in written:
            print(f"  updated {w}")
        if not written:
            print("  all targets already in step")
    return 0


if __name__ == "__main__":
    sys.exit(main())
