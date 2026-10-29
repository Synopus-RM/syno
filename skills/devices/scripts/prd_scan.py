#!/usr/bin/env python3
"""First-pass scan of a project's PRD for signals that decide how each native
app stays in sync with the web app (live, bundled-ota, or bundled-store).

Usage: prd_scan.py PRD_FILE [PRD_FILE ...] [--bundleable true|false] [--json]

Reads .md/.txt/.mdx directly, .docx via its XML, and .pdf via `pdftotext`
when installed. The output is evidence plus a suggested mode per platform.
It is a starting point: read the PRD yourself and make the final call.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

SIGNALS: dict[str, dict] = {
    "offline_required": {
        "label": "Works offline / poor connectivity",
        "patterns": [r"\boffline\b", r"without (an )?internet", r"no (network|connectivity)",
                     r"low[- ]connectivity", r"poor (network|connectivity)", r"local[- ]first",
                     r"sync when (back )?online"],
        "negations": [r"offline (is )?not (required|needed|in scope)", r"no offline", r"online[- ]only"],
    },
    "online_only": {
        "label": "Explicitly online-only",
        "patterns": [r"online[- ]only", r"always[- ]online", r"requires (an )?(active )?internet",
                     r"offline (is )?not (required|needed|in scope)", r"no offline"],
    },
    "native_device": {
        "label": "Native device features",
        "patterns": [r"\bcamera\b", r"barcode|qr[- ]?code scan", r"biometric|fingerprint|face ?id|touch ?id",
                     r"\bbluetooth\b|\bble\b", r"\bnfc\b", r"\bgps\b|geolocation|location tracking",
                     r"contacts? (access|picker|sync)", r"file system|local files|document scanner",
                     r"background (sync|task|location)", r"\bsms (read|auto[- ]?read|retriever)"],
    },
    "push_notifications": {
        "label": "Push notifications",
        "patterns": [r"push notifications?", r"\bfcm\b|firebase cloud messaging", r"\bapns\b",
                     r"notify (the )?users? (on|when)"],
    },
    "digital_payments": {
        "label": "Selling digital goods / subscriptions in-app",
        "patterns": [r"in[- ]app purchases?", r"subscription(s| plan| tier)", r"premium (tier|plan|features?)",
                     r"paid (tier|plan|version)", r"\bunlock(s|ing)? (features?|content)", r"free (and|&) paid"],
    },
    "physical_payments": {
        "label": "Payments for real-world goods/services or loans",
        "patterns": [r"\bupi\b", r"razorpay|cashfree|payu|stripe|paytm|phonepe", r"payment gateway",
                     r"\bemis?\b|\binstal+ments?\b|\brepayments?\b", r"chit|loan disburs"],
    },
    "sensitive_data": {
        "label": "Sensitive financial / identity data",
        "patterns": [r"\bkyc\b", r"\bpan\b|aadhaar|aadhar", r"bank (account|statement)", r"\bgst(in)?\b",
                     r"income tax|\bitr\b", r"\bpii\b|personal data|dpdp", r"\brbi\b|\bnbfc\b"],
    },
    "frequent_releases": {
        "label": "Frequent web releases",
        "patterns": [r"(daily|weekly) (releases?|deploy(ment)?s?)", r"continuous (deployment|delivery)",
                     r"ship (fast|often|daily)", r"rapid iteration", r"\bci/cd\b"],
    },
    "app_store_presence": {
        "label": "Store listing required",
        "patterns": [r"app store", r"play store|google play", r"\bios\b", r"\biphone\b|\bipad\b",
                     r"\bandroid\b", r"windows|macos|mac os|linux|desktop app"],
    },
    "seo_public_web": {
        "label": "Public marketing/SEO pages in the same app",
        "patterns": [r"\bseo\b", r"landing pages?", r"blog", r"public (pages|website)"],
    },
}


def extract_text(path: Path) -> str:
    suf = path.suffix.lower()
    if suf in {".md", ".mdx", ".txt"}:
        return path.read_text(encoding="utf-8", errors="ignore")
    if suf == ".docx":
        with zipfile.ZipFile(path) as z:
            xml = z.read("word/document.xml").decode("utf-8", errors="ignore")
        xml = re.sub(r"</w:p>", "\n", xml)
        return re.sub(r"<[^>]+>", "", xml)
    if suf == ".pdf":
        if shutil.which("pdftotext"):
            out = subprocess.run(["pdftotext", "-layout", str(path), "-"], capture_output=True, text=True)
            return out.stdout
        raise SystemExit(f"{path}: install poppler (pdftotext) or convert the PDF to text first")
    return path.read_text(encoding="utf-8", errors="ignore")


def scan(text: str) -> dict:
    lines = text.splitlines()
    found: dict[str, dict] = {}
    for key, spec in SIGNALS.items():
        hits = []
        for i, line in enumerate(lines, 1):
            low = line.lower()
            if any(re.search(p, low) for p in spec.get("negations", [])):
                continue
            for p in spec["patterns"]:
                m = re.search(p, low)
                if m:
                    snippet = line.strip()
                    if len(snippet) > 160:
                        s = max(0, m.start() - 60)
                        snippet = "…" + line[s:s + 150].strip() + "…"
                    hits.append({"line": i, "match": m.group(0), "text": snippet})
                    break
        found[key] = {"label": spec["label"], "count": len(hits), "evidence": hits[:6]}
    return found


def mentions(text: str, *pats: str) -> bool:
    return any(re.search(p, text, re.I) for p in pats)


def suggest(found: dict, text: str, bundleable: bool | None) -> dict:
    on = {k: v["count"] > 0 for k, v in found.items()}
    offline = on["offline_required"] and not on["online_only"]
    native_heavy = found["native_device"]["count"] >= 2
    platforms = {
        "desktop": mentions(text, r"\bdesktop\b", r"windows", r"mac ?os", r"\blinux\b") or None,
        "android": mentions(text, r"android", r"play store", r"google play", r"mobile app") or None,
        "ios": mentions(text, r"\bios\b", r"iphone", r"app store", r"mobile app") or None,
    }
    why: dict[str, list[str]] = {"desktop": [], "android": [], "ios": []}
    mode = {"desktop": "live", "android": "live", "ios": "bundled-ota"}
    why["desktop"].append("Default: live web app gives instant parity on desktop; shell only changes for native features.")
    why["android"].append("Default: live web app gives instant parity; offline fallback page covers network loss.")
    why["ios"].append("Default: bundled web build + OTA updates; a thin live wrapper risks App Store guideline 4.2 (minimum functionality).")

    if offline:
        for p in mode:
            mode[p] = "bundled-ota" if p != "desktop" else "bundled"
            why[p].insert(0, "PRD requires offline use, so the web build must ship inside the app.")
    if native_heavy:
        for p in ("android", "ios"):
            if mode[p] == "live":
                mode[p] = "bundled-ota"
            why[p].insert(0, "Several native device features; keep web code versioned with the native layer (bundled + OTA).")
    if on["frequent_releases"] and not offline:
        why["desktop"].append("Frequent web releases favour live mode where allowed.")
        why["android"].append("Frequent web releases favour live mode where allowed.")
    if bundleable is False:
        for p in mode:
            if mode[p] != "live":
                why[p].insert(0, f"Web app is server-rendered, so it cannot be bundled; forced to live (wanted {mode[p]}).")
            mode[p] = "live"
        why["ios"].append("Live on iOS needs real native value (push, biometrics, share, deep links) to pass review.")

    flags = []
    if on["digital_payments"]:
        flags.append("PRD sells digital features/subscriptions: iOS and Google Play billing rules apply to in-app unlocks. Decide the payment flow per store before release.")
    if on["sensitive_data"]:
        flags.append("Sensitive financial/identity data: enable certificate pinning or strict HTTPS-only navigation, disable WebView debugging in release, and complete the Play Data safety and App Store privacy forms carefully.")
    if on["push_notifications"]:
        flags.append("Push notifications: add @capacitor/push-notifications (FCM + APNs keys) to the mobile shell; this is a native change and needs a store release.")
    if on["physical_payments"]:
        flags.append("Payment gateway flows: test the gateway's redirect/intent handling (UPI apps) inside the WebView on Android and iOS.")
    return {"modes": mode, "platformsMentioned": platforms, "rationale": why, "flags": flags,
            "offline": offline, "nativeHeavy": native_heavy}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", nargs="+")
    ap.add_argument("--bundleable", choices=["true", "false"], help="from detect_stack.py")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    texts, digests = [], []
    for f in a.files:
        p = Path(f)
        t = extract_text(p)
        texts.append(t)
        digests.append(hashlib.sha256(t.encode()).hexdigest())
    text = "\n".join(texts)
    found = scan(text)
    bundleable = None if a.bundleable is None else a.bundleable == "true"
    sug = suggest(found, text, bundleable)
    result = {"files": a.files, "prdHash": hashlib.sha256("".join(digests).encode()).hexdigest()[:16],
              "words": len(text.split()), "signals": found, "suggestion": sug}
    if a.json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return 0
    print(f"PRD: {', '.join(a.files)} ({result['words']} words, hash {result['prdHash']})\n")
    print("Signals:")
    for k, v in found.items():
        if v["count"]:
            ev = v["evidence"][0]
            print(f"  - {v['label']}: {v['count']} hit(s), e.g. line {ev['line']}: {ev['text']}")
    print("\nSuggested modes:")
    for p, m in sug["modes"].items():
        print(f"  {p:8} {m:12} {sug['rationale'][p][0]}")
    if sug["flags"]:
        print("\nFlags:")
        for f in sug["flags"]:
            print(f"  - {f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
