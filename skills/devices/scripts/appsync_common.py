"""Shared helpers for the app-sync scripts. Standard library only."""
from __future__ import annotations

import hashlib
import json
import os
import re
from pathlib import Path

CONFIG_NAME = "app-sync.json"
SCRIPT_DIR = Path(__file__).resolve().parent
SKILL_DIR = SCRIPT_DIR.parent

SKIP_DIRS = {
    "node_modules", ".git", "target", "build", "dist", ".gradle", "Pods",
    ".next", ".nuxt", ".output", "DerivedData", "gen", ".svelte-kit", "vendor",
    "__pycache__", ".venv", "venv",
}

# Files the plugin writes into a shell's www folder. They are excluded from the
# web-build hash so that parity compares only what came from the web app.
CHROME_FILES = {"offline.html", "app-sync-boot.html", "app-sync-ready.js", ".app-sync-stamp.json"}
# In desktop live mode the boot page is served as index.html.
STAMP_NAME = ".app-sync-stamp.json"

SEMVER_RE = re.compile(r"^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$")


# ---------------------------------------------------------------- config
def find_project_root(start: str | os.PathLike | None = None) -> Path:
    p = Path(start or os.getcwd()).resolve()
    for cand in [p, *p.parents]:
        if (cand / CONFIG_NAME).is_file():
            return cand
    return p


def load_config(root: Path) -> dict | None:
    f = root / CONFIG_NAME
    if not f.is_file():
        return None
    return json.loads(f.read_text(encoding="utf-8"))


def save_json(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def load_json(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def load_baseline(root: Path | None = None) -> dict:
    """Project override (app-sync/baseline.json) wins over the plugin default."""
    if root is not None:
        override = root / "app-sync" / "baseline.json"
        data = load_json(override)
        if data:
            data["_source"] = str(override)
            return data
    data = load_json(SCRIPT_DIR / "baseline.json") or {}
    data["_source"] = "plugin default"
    return data


def platform_cfg(cfg: dict, name: str) -> dict:
    return (cfg.get("platforms") or {}).get(name) or {}


def enabled_platforms(cfg: dict) -> list[str]:
    return [k for k, v in (cfg.get("platforms") or {}).items() if v.get("enabled", True)]


def desktop_dir(root: Path, cfg: dict) -> Path:
    return root / platform_cfg(cfg, "desktop").get("path", "apps/desktop")


def mobile_dir(root: Path, cfg: dict) -> Path:
    return root / (cfg.get("mobile") or {}).get("path", "apps/mobile")


def web_root(root: Path, cfg: dict) -> Path:
    return (root / (cfg.get("web") or {}).get("root", ".")).resolve()


def web_output(root: Path, cfg: dict) -> Path:
    return web_root(root, cfg) / ((cfg.get("web") or {}).get("outputDir") or "dist")


# ---------------------------------------------------------------- semver
def parse_semver(v: str) -> tuple[int, int, int] | None:
    m = SEMVER_RE.match(str(v).strip().lstrip("v"))
    return (int(m.group(1)), int(m.group(2)), int(m.group(3))) if m else None


def bump(v: str, part: str) -> str:
    sv = parse_semver(v)
    if not sv:
        raise ValueError(f"not a semver version: {v}")
    ma, mi, pa = sv
    if part == "major":
        return f"{ma + 1}.0.0"
    if part == "minor":
        return f"{ma}.{mi + 1}.0"
    return f"{ma}.{mi}.{pa + 1}"


def version_ge(a: str, b: str) -> bool:
    pa, pb = parse_semver(a), parse_semver(b)
    if not pa or not pb:
        return False
    return pa >= pb


def clean_range(v: str) -> str:
    """'^8.5.0' -> '8.5.0'"""
    m = re.search(r"\d+\.\d+\.\d+", str(v))
    if m:
        return m.group(0)
    m = re.search(r"\d+(?:\.\d+)?", str(v))
    if not m:
        return ""
    parts = m.group(0).split(".")
    while len(parts) < 3:
        parts.append("0")
    return ".".join(parts)


# ---------------------------------------------------------------- hashing
def iter_files(base: Path, exclude_names: set[str] | None = None):
    exclude_names = exclude_names or set()
    for dirpath, dirnames, filenames in os.walk(base):
        dirnames[:] = sorted(d for d in dirnames if not d.startswith(".DS_"))
        for fn in sorted(filenames):
            if fn in exclude_names or fn == ".DS_Store":
                continue
            yield Path(dirpath) / fn


def tree_hash(base: Path, exclude_names: set[str] | None = None) -> str | None:
    if not base.is_dir():
        return None
    h = hashlib.sha256()
    for f in iter_files(base, exclude_names):
        rel = f.relative_to(base).as_posix()
        h.update(rel.encode())
        h.update(b"\0")
        h.update(hashlib.sha256(f.read_bytes()).digest())
    return h.hexdigest()


def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def native_fingerprint(root: Path, cfg: dict) -> str | None:
    """Hash of everything that forces a store release rather than an OTA update:
    native plugin dependencies plus the shell configs."""
    mdir = mobile_dir(root, cfg)
    pkg = load_json(mdir / "package.json")
    if not pkg:
        return None
    deps = {**(pkg.get("dependencies") or {})}
    native = {k: v for k, v in deps.items() if k.startswith("@capacitor") or "capacitor" in k or k.startswith("@capgo")}
    h = hashlib.sha256(json.dumps(native, sort_keys=True).encode())
    for rel in ("capacitor.config.ts", "capacitor.config.json",
                "android/app/build.gradle", "android/variables.gradle",
                "ios/App/App/Info.plist"):
        f = mdir / rel
        if f.is_file():
            h.update(rel.encode())
            h.update(f.read_bytes())
    return h.hexdigest()


# ---------------------------------------------------------------- misc
def slugify(name: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9]+", "-", name).strip("-").lower()
    return s or "app"


def rel(root: Path, p: Path) -> str:
    try:
        return p.relative_to(root).as_posix()
    except ValueError:
        return str(p)


def walk_text_files(base: Path, exts: tuple[str, ...]):
    for dirpath, dirnames, filenames in os.walk(base):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".")]
        for fn in filenames:
            if fn.endswith(exts):
                yield Path(dirpath) / fn
