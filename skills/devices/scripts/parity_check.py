#!/usr/bin/env python3
"""Check that every native shell matches the web app and current store rules.

Usage: parity_check.py [PROJECT] [--json] [--strict] [--markdown FILE]

Exit code 1 when any check FAILs (with --strict, WARNs fail too). Designed to
run locally and in CI (app-sync-parity.yml).
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from appsync_common import (CHROME_FILES, STAMP_NAME, clean_range, desktop_dir,  # noqa: E402
                            enabled_platforms, find_project_root, load_baseline, load_config,
                            load_json, mobile_dir, native_fingerprint, platform_cfg, rel,
                            tree_hash, version_ge, walk_text_files, web_output)
import sync_versions  # noqa: E402

MODES = {"live", "bundled", "bundled-ota", "bundled-store"}
ATTRIBUTION_RE = re.compile(
    r"(generated|built|made|written|created) (by|with) (claude|chatgpt|copilot|an? ai\b|gpt-?\d|gemini)"
    r"|co-authored-by:\s*(claude|copilot|chatgpt)|anthropic\.com|claude\.ai|🤖", re.I)
READY_TAG_RE = re.compile(r"\s*<script src=\"\./app-sync-ready\.js\"></script>\n?")


class Report:
    def __init__(self):
        self.rows: list[dict] = []

    def add(self, area: str, status: str, msg: str, fix: str = ""):
        self.rows.append({"area": area, "status": status, "message": msg, "fix": fix})

    def ok(self, a, m, f=""):
        self.add(a, "PASS", m)

    def warn(self, a, m, f=""):
        self.add(a, "WARN", m, f)

    def fail(self, a, m, f=""):
        self.add(a, "FAIL", m, f)


def www_matches_build(build: Path, www: Path) -> tuple[bool, str]:
    if not build.is_dir():
        return False, "web build output missing"
    if not www.is_dir():
        return False, "shell www/ missing"
    for f in build.rglob("*"):
        if not f.is_file() or f.name == ".DS_Store":
            continue
        r = f.relative_to(build)
        g = www / r
        if not g.is_file():
            return False, f"missing in shell: {r.as_posix()}"
        a, b = f.read_bytes(), g.read_bytes()
        if r.as_posix() == "index.html":
            b = READY_TAG_RE.sub("\n", b.decode("utf-8", "ignore")).encode()
            a = a.decode("utf-8", "ignore").encode()
            if re.sub(rb"\s+", b"", a) != re.sub(rb"\s+", b"", b):
                return False, "index.html differs"
        elif a != b:
            return False, f"differs: {r.as_posix()}"
    for g in www.rglob("*"):
        if g.is_file() and g.name not in CHROME_FILES and not (build / g.relative_to(www)).exists():
            return False, f"stale file in shell: {g.relative_to(www).as_posix()}"
    return True, "identical"


def gradle_int(text: str, key: str) -> int | None:
    m = re.search(rf"{key}\s*=?\s*(\d+)", text)
    return int(m.group(1)) if m else None


def run(root: Path) -> Report:
    R = Report()
    cfg = load_config(root)
    if not cfg:
        R.fail("config", "app-sync.json not found", "Run the app-sync setup to create it.")
        return R
    base = load_baseline(root)
    plats = enabled_platforms(cfg)

    # ---- config sanity
    app = cfg.get("app") or {}
    for k in ("name", "id"):
        (R.ok if app.get(k) else R.fail)("config", f"app.{k} = {app.get(k)!r}")
    live_url = (cfg.get("web") or {}).get("liveUrl", "")
    for p in plats:
        mode = platform_cfg(cfg, p).get("mode")
        if mode not in MODES:
            R.fail("config", f"{p}: mode {mode!r} is not one of {sorted(MODES)}")
        if mode == "live" and not live_url.startswith("https://"):
            R.fail("config", f"{p} is live but web.liveUrl is not https ({live_url!r})")
    dec = cfg.get("decision") or {}
    if dec.get("source"):
        R.ok("decision", f"modes decided from {dec['source']} on {dec.get('decidedOn', '?')}")
        src = root / dec["source"]
        if src.is_file() and dec.get("prdHash"):
            import prd_scan  # noqa: E402
            import hashlib
            text = prd_scan.extract_text(src)
            h = hashlib.sha256(hashlib.sha256(text.encode()).hexdigest().encode()).hexdigest()[:16]
            if h != dec["prdHash"]:
                R.warn("decision", "PRD changed since modes were decided", "Re-run the PRD review and confirm modes.")
    else:
        R.warn("decision", "no PRD-based decision recorded", "Read the PRD and record decision in app-sync.json.")

    # ---- baseline freshness
    try:
        age = (date.today() - date.fromisoformat(base.get("asOf", "1970-01-01"))).days
        lim = int(base.get("reverifyAfterDays", 60))
        (R.ok if age <= lim else R.warn)("baseline", f"store/toolchain baseline is {age} days old ({base['_source']})",
                                         "Re-verify store rules on the web and update app-sync/baseline.json.")
    except ValueError:
        R.warn("baseline", "baseline asOf unreadable")

    # ---- versions
    rows = sync_versions.check(root, cfg)
    if not rows:
        R.warn("versions", "no shell files found to compare yet")
    for r in rows:
        (R.ok if r["ok"] else R.fail)("versions", f"{r['file']}: {r['version']} (want {cfg['version']})",
                                      "python3 sync_versions.py")

    # ---- desktop
    if "desktop" in plats:
        d = desktop_dir(root, cfg)
        conf = load_json(d / "src-tauri" / "tauri.conf.json")
        if not conf:
            R.fail("desktop", "Tauri shell missing", "Use the devices-desktop skill to create it.")
        else:
            (R.ok if conf.get("identifier") == app.get("id") else R.fail)(
                "desktop", f"identifier {conf.get('identifier')} vs app.id {app.get('id')}")
            (R.ok if conf.get("productName") == app.get("name") else R.warn)(
                "desktop", f"productName {conf.get('productName')!r}")
            upd = ((conf.get("plugins") or {}).get("updater") or {})
            if not upd.get("pubkey") or "{{" in str(upd.get("pubkey")) or "REPLACE" in str(upd.get("pubkey")):
                R.warn("desktop", "updater public key not set", "Generate with `npx tauri signer generate` and store the private key as a GitHub secret.")
            pkg = load_json(d / "package.json") or {}
            cli = clean_range(((pkg.get("devDependencies") or {}) | (pkg.get("dependencies") or {})).get("@tauri-apps/cli", ""))
            if cli:
                (R.ok if version_ge(cli, base["tauri"]["min"]) else R.warn)(
                    "desktop", f"@tauri-apps/cli {cli} (floor {base['tauri']['min']})", "npm i -D @tauri-apps/cli@latest")
            mode = platform_cfg(cfg, "desktop").get("mode", "live")
            www = d / "www"
            stamp = load_json(www / STAMP_NAME)
            if not stamp:
                R.fail("desktop", "www/ not synced", "python3 sync_web.py")
            elif mode == "live":
                boot = (www / "index.html").read_text(encoding="utf-8", errors="ignore") if (www / "index.html").is_file() else ""
                (R.ok if live_url and live_url in boot else R.fail)("desktop", "boot page points at web.liveUrl", "python3 sync_web.py")
            else:
                ok, why = www_matches_build(web_output(root, cfg), www)
                (R.ok if ok else R.fail)("desktop", f"bundled web build: {why}", "python3 sync_web.py")

    # ---- mobile
    mob = [p for p in plats if p in ("android", "ios")]
    if mob:
        m = mobile_dir(root, cfg)
        cap_conf = next((m / n for n in ("capacitor.config.ts", "capacitor.config.json") if (m / n).is_file()), None)
        if not cap_conf:
            R.fail("mobile", "Capacitor shell missing", "Use the devices-mobile skill to create it.")
        else:
            txt = cap_conf.read_text(encoding="utf-8")
            (R.ok if "APP_SYNC_PLATFORM" in txt or cap_conf.suffix == ".json" else R.warn)(
                "mobile", "capacitor config reads per-platform mode")
            pkg = load_json(m / "package.json") or {}
            deps = (pkg.get("dependencies") or {}) | (pkg.get("devDependencies") or {})
            core = clean_range(deps.get("@capacitor/core", ""))
            (R.ok if core and version_ge(core, base["capacitor"]["min"]) else R.fail)(
                "mobile", f"@capacitor/core {core or 'missing'} (floor {base['capacitor']['min']})",
                "npm i @capacitor/core@latest @capacitor/cli@latest @capacitor/android@latest @capacitor/ios@latest && npx cap sync")
            if any(platform_cfg(cfg, p).get("mode") == "bundled-ota" for p in mob):
                (R.ok if "@capgo/capacitor-updater" in deps else R.fail)(
                    "mobile", "OTA updater plugin installed", "npm i @capgo/capacitor-updater@latest && npx cap sync")
            www = m / "www"
            if (cfg.get("web") or {}).get("bundleable", True):
                ok, why = www_matches_build(web_output(root, cfg), www)
                (R.ok if ok else R.fail)("mobile", f"bundled web build: {why}", "python3 sync_web.py --cap-sync")
                idx = www / "index.html"
                if idx.is_file():
                    (R.ok if "app-sync-ready.js" in idx.read_text(encoding="utf-8", errors="ignore") else R.warn)(
                        "mobile", "update-ready signal injected")
            fp = native_fingerprint(root, cfg)
            last = (cfg.get("state") or {}).get("lastNativeRelease") or {}
            if last.get("fingerprint") and fp and last["fingerprint"] != fp:
                R.warn("mobile", "native layer changed since last store release",
                       "OTA cannot deliver this. Ship a store release (android/ios workflows).")
        if "android" in plats:
            g = m / "android" / "variables.gradle"
            if g.is_file():
                t = g.read_text(encoding="utf-8")
                ts, cs, ms = gradle_int(t, "targetSdkVersion"), gradle_int(t, "compileSdkVersion"), gradle_int(t, "minSdkVersion")
                a = base["android"]
                (R.ok if ts and ts >= a["targetSdk"] else R.fail)("android", f"targetSdk {ts} (store floor {a['targetSdk']})", "Raise targetSdkVersion in android/variables.gradle")
                (R.ok if cs and cs >= a["compileSdk"] else R.fail)("android", f"compileSdk {cs} (floor {a['compileSdk']})")
                (R.ok if ms and ms >= a["minSdk"] else R.warn)("android", f"minSdk {ms} (Capacitor floor {a['minSdk']})")
            else:
                R.warn("android", "android/ platform not added yet", "npx cap add android")
            bg = m / "android" / "app" / "build.gradle"
            if bg.is_file():
                t = bg.read_text(encoding="utf-8")
                mm = re.search(r"applicationId\s+\"([^\"]+)\"", t)
                (R.ok if mm and mm.group(1) == app.get("id") else R.fail)("android", f"applicationId {mm.group(1) if mm else None}")
        if "ios" in plats:
            pbx = m / "ios" / "App" / "App.xcodeproj" / "project.pbxproj"
            if pbx.is_file():
                t = pbx.read_text(encoding="utf-8")
                ids = set(re.findall(r"PRODUCT_BUNDLE_IDENTIFIER = \"?([^;\"]+)\"?;", t))
                (R.ok if ids == {app.get("id")} else R.fail)("ios", f"bundle id {sorted(ids)}")
                dts = sorted(set(re.findall(r"IPHONEOS_DEPLOYMENT_TARGET = ([^;]+);", t)))
                R.ok("ios", f"deployment target {', '.join(dts) or 'default'}")
            else:
                R.warn("ios", "ios/ platform not added yet", "npx cap add ios (needs a Mac for builds)")

    # ---- chrome + attribution
    for shell in [desktop_dir(root, cfg) / "www", mobile_dir(root, cfg) / "www"]:
        off = shell / "offline.html"
        if off.is_file():
            t = off.read_text(encoding="utf-8", errors="ignore")
            credit = cfg.get("credit") or {}
            credit_ok = bool(credit.get("url")) and credit["url"] in t
            (R.ok if credit_ok else R.fail)("brand", f"{rel(root, off)} carries the credit link from app-sync.json")
            if "{{" in t:
                R.fail("brand", f"{rel(root, off)} has unfilled tokens", "python3 sync_web.py")
    hits = []
    for base_dir in {desktop_dir(root, cfg), mobile_dir(root, cfg), root / "app-sync", root / ".github" / "workflows"}:
        if not base_dir.is_dir():
            continue
        for f in walk_text_files(base_dir, (".html", ".js", ".ts", ".json", ".rs", ".toml", ".xml", ".plist", ".yml", ".yaml", ".md", ".kt", ".java", ".swift", ".gradle")):
            if "www" in f.parts and f.name not in CHROME_FILES:
                continue
            try:
                for i, line in enumerate(f.read_text(encoding="utf-8", errors="ignore").splitlines(), 1):
                    if ATTRIBUTION_RE.search(line):
                        hits.append(f"{rel(root, f)}:{i}")
            except OSError:
                pass
    (R.fail if hits else R.ok)("brand", "no AI/tool attribution in shells" if not hits else f"AI/tool attribution found: {', '.join(hits[:5])}",
                               "Remove the attribution lines.")

    # ---- CI
    wf = root / ".github" / "workflows"
    want = ["app-sync-parity.yml"] + [f"app-sync-{p}.yml" for p in plats]
    if any(platform_cfg(cfg, p).get("mode", "live") != "live" for p in plats):
        want.append("app-sync-web-update.yml")
    missing = [w for w in want if not (wf / w).is_file()]
    (R.warn if missing else R.ok)("ci", f"workflows missing: {', '.join(missing)}" if missing else "all workflows present",
                                  "Use the devices-release skill.")
    return R


def to_markdown(R: Report, root: Path) -> str:
    icon = {"PASS": "✅", "WARN": "⚠️", "FAIL": "❌"}
    lines = [f"# App parity report — {root.name}", "", f"Checked {date.today().isoformat()}", "",
             "| | Area | Check | Fix |", "|---|---|---|---|"]
    for r in R.rows:
        lines.append(f"| {icon[r['status']]} | {r['area']} | {r['message']} | {r['fix']} |")
    return "\n".join(lines) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("project", nargs="?", default=None)
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--strict", action="store_true")
    ap.add_argument("--markdown", metavar="FILE")
    a = ap.parse_args()
    root = find_project_root(a.project)
    R = run(root)
    fails = sum(r["status"] == "FAIL" for r in R.rows)
    warns = sum(r["status"] == "WARN" for r in R.rows)
    if a.markdown:
        Path(a.markdown).write_text(to_markdown(R, root), encoding="utf-8")
    if a.json:
        print(json.dumps({"fails": fails, "warns": warns, "checks": R.rows}, indent=2, ensure_ascii=False))
    else:
        for r in R.rows:
            print(f"{r['status']:4}  {r['area']:9} {r['message']}" + (f"\n      fix: {r['fix']}" if r["fix"] and r["status"] != "PASS" else ""))
        print(f"\n{fails} fail, {warns} warn, {len(R.rows) - fails - warns} pass")
    return 1 if fails or (a.strict and warns) else 0


if __name__ == "__main__":
    sys.exit(main())
