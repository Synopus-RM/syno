#!/usr/bin/env python3
"""Package the mobile web bundle for an over-the-air update.

Usage: package_ota.py [PROJECT] [--out DIR] [--base-url URL] [--allow-plain-zip]

Creates <out>/<version>/bundle.zip and <out>/manifest.json:
  {"version": "1.4.2", "url": "<base-url>/1.4.2/bundle.zip", "checksum": "<sha256>",
   "platforms": ["ios"], "nativeFingerprint": "...", "minNativeBuild": 37}

The zip is made with the Capgo CLI (`npx @capgo/cli bundle zip --json`), which
the updater plugin expects. --allow-plain-zip falls back to a standard zip of
www/ when the CLI is unavailable (test use only).

Refuses to package when the native layer has changed since the last store
release: an OTA bundle must only carry HTML/CSS/JS that runs on the native
build already in users' hands.
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from appsync_common import (enabled_platforms, file_sha256, find_project_root, load_config,  # noqa: E402
                            mobile_dir, native_fingerprint, platform_cfg, save_json)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("project", nargs="?", default=None)
    ap.add_argument("--out", default="ota-dist")
    ap.add_argument("--base-url", default=None, help="public HTTPS folder the bundles are served from")
    ap.add_argument("--allow-plain-zip", action="store_true")
    ap.add_argument("--force", action="store_true", help="package even if the native layer changed")
    a = ap.parse_args()

    root = find_project_root(a.project)
    cfg = load_config(root)
    if not cfg:
        print("No app-sync.json found.", file=sys.stderr)
        return 2
    ota_plats = [p for p in enabled_platforms(cfg) if p in ("android", "ios") and platform_cfg(cfg, p).get("mode") == "bundled-ota"]
    if not ota_plats:
        print("No mobile platform is in bundled-ota mode; nothing to package.")
        return 0
    m = mobile_dir(root, cfg)
    www = m / "www"
    if not (www / "index.html").is_file():
        print("mobile www/ is empty; run sync_web.py first.", file=sys.stderr)
        return 2

    fp = native_fingerprint(root, cfg)
    last = (cfg.get("state") or {}).get("lastNativeRelease") or {}
    if last.get("fingerprint") and fp != last["fingerprint"] and not a.force:
        print("Native layer changed since the last store release. Ship a store build first; "
              "an OTA bundle would reach apps without the native code it needs.", file=sys.stderr)
        return 3

    version = cfg["version"]
    out = (root / a.out).resolve()
    vdir = out / version
    vdir.mkdir(parents=True, exist_ok=True)
    bundle = vdir / "bundle.zip"
    checksum = None

    if shutil.which("npx"):
        cmd = ["npx", "--yes", "@capgo/cli@latest", "bundle", "zip", (cfg.get("app") or {}).get("id", ""),
               "--path", str(www), "--bundle", version, "--name", str(bundle), "--json"]
        r = subprocess.run(cmd, capture_output=True, text=True, cwd=m)
        if r.returncode == 0:
            try:
                data = json.loads(r.stdout[r.stdout.find("{"):])
                checksum = data.get("checksum")
                produced = Path(data.get("filename") or data.get("name") or bundle)
                if not produced.is_absolute():
                    produced = m / produced
                if produced.is_file() and produced != bundle:
                    shutil.move(str(produced), bundle)
            except (ValueError, KeyError):
                checksum = None
        if not checksum:
            print("Capgo CLI zip did not return a checksum:\n" + (r.stdout + r.stderr)[-1500:], file=sys.stderr)
    if not checksum:
        if not a.allow_plain_zip:
            print("Could not create the bundle with the Capgo CLI. Fix the CLI error above, "
                  "or pass --allow-plain-zip for a test-only bundle.", file=sys.stderr)
            return 4
        with zipfile.ZipFile(bundle, "w", zipfile.ZIP_DEFLATED) as z:
            for f in sorted(www.rglob("*")):
                if f.is_file():
                    z.write(f, f.relative_to(www).as_posix())
        checksum = file_sha256(bundle)
        print("Warning: plain zip used (test only).", file=sys.stderr)

    base_url = (a.base_url or (cfg.get("ota") or {}).get("baseUrl") or "").rstrip("/")
    manifest = {
        "version": version,
        "url": f"{base_url}/{version}/bundle.zip" if base_url else f"{version}/bundle.zip",
        "checksum": checksum,
        "platforms": ota_plats,
        "nativeFingerprint": fp,
        "minNativeBuild": last.get("build"),
    }
    save_json(out / "manifest.json", manifest)
    print(json.dumps({"bundle": str(bundle), "manifest": str(out / "manifest.json"), **manifest}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
