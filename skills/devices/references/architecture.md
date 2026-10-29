# Architecture

## Folder layout inside the web app's repository

```
<repo>/
├── app-sync.json                  single source of truth (committed)
├── app-sync/
│   ├── chrome/boot.html           bespoke boot screen for this app (committed)
│   ├── chrome/offline.html        bespoke offline screen (committed)
│   ├── brand/icon.png             1024×1024 master icon, square, no transparency for iOS
│   ├── baseline.json              project's verified store/toolchain floors (committed)
│   ├── ota-endpoint/              Lambda for the self-hosted OTA endpoint (if bundled-ota)
│   └── tools/                     vendored copy of the sync scripts used by CI
├── apps/
│   ├── desktop/                   Tauri 2 shell: Windows, macOS, Linux
│   │   ├── package.json
│   │   ├── www/                   generated (gitignored)
│   │   └── src-tauri/             tauri.conf.json, Cargo.toml, src/main.rs, capabilities/, icons/
│   └── mobile/                    Capacitor shell: Android, iOS
│       ├── package.json
│       ├── capacitor.config.ts    reads app-sync.json + APP_SYNC_PLATFORM
│       ├── www/                   generated (gitignored)
│       ├── android/               committed (native project)
│       └── ios/                   committed (native project)
├── .github/workflows/app-sync-*.yml
└── <the web app as it already is>
```

The web app's own folders are never restructured. If the repo is a monorepo, set `web.root` to the web package; the shells stay under `apps/`.

Desktop and mobile are separate on purpose: different engines, toolchains, release cadences and stores. Do not merge them into one Tauri-for-everything or Capacitor-for-everything project.

## Engines

| Platforms | Engine | Why |
|---|---|---|
| Windows, macOS, Linux | **Tauri 2** | Small installers (system WebView), signed self-updates, native menus, Rust core. Electron only if an existing shell already uses it. |
| Android, iOS | **Capacitor 8** | Mature store-ready native projects, per-platform config, large plugin ecosystem, OTA via `@capgo/capacitor-updater`. |

## Modes

| Mode | Platforms | What ships in the app | How a web change reaches users | Offline |
|---|---|---|---|---|
| `live` | any | boot page (desktop) or bundle as fallback (mobile) | instantly: the app opens the live URL | offline screen only |
| `bundled` | desktop | the web build | new signed desktop release; the app's updater installs it | full |
| `bundled-ota` | android, ios | the web build + OTA updater | OTA bundle on merge to main; store release only when native code changes | full |
| `bundled-store` | android, ios | the web build | store release for every change | full |

How each works:

- **Desktop live.** The window loads the local boot page (`www/index.html`). It checks for a signed shell update, checks the connection, then hands the window to `web.liveUrl`. The live site gets no native access (capabilities apply to local pages only). Offline: the bespoke offline screen, which retries by itself when the network returns.
- **Desktop bundled.** `www/` holds the web build. A web change means a new version, built by `app-sync-desktop.yml` (or `app-sync-web-update.yml`), published as a GitHub release with `latest.json`; installed apps update through the Tauri updater.
- **Mobile live.** `capacitor.config.ts` sets `server.url` to the live URL with `errorPath: offline.html` for that platform only. The web build still ships as a fallback bundle.
- **Mobile bundled-ota.** `www/` holds the web build plus `app-sync-ready.js` (injected into index.html) which calls `CapacitorUpdater.notifyAppReady()`; without that call the updater rolls a bad bundle back. On merge to main, `app-sync-web-update.yml` bumps the patch version, builds `bundle.zip` with the Capgo CLI, uploads bundle then `manifest.json` to S3; the Lambda endpoint serves the newer bundle to apps whose native build is new enough.
- **Native fingerprint.** A hash of Capacitor/plugin dependencies and native configs. `record_release.py` stores it after each store release; `package_ota.py` refuses to publish an OTA when it changed, because the new web code may call native code users do not have.

## app-sync.json

```jsonc
{
  "schema": 1,
  "app": {
    "name": "Demo Desk",            // productName / appName
    "shortName": "Desk",            // home-screen label, monogram letter
    "id": "in.synopus.desk",          // bundle id / applicationId / Tauri identifier — never change after first store release
    "tagline": "Every customer ticket, answered.",
    "publisher": "Synopus",
    "website": "https://www.synopus.in"
  },
  "version": "1.3.1",               // one version everywhere
  "build": 2,                       // monotonic: Android versionCode, iOS CURRENT_PROJECT_VERSION
  "versionSource": "web",           // "web": web package.json leads; "app-sync": this file leads
  "github": { "repo": "owner/repo" },
  "web": {
    "root": ".", "framework": "vite-react",
    "buildCommand": "npm run build", "outputDir": "dist",
    "bundleable": true,              // false for server-rendered apps: live mode only
    "liveUrl": "https://desk.example.com"
  },
  "brand": { "primary": "#3D5AFE", "accent": "#00BFA6", "background": "#0E1222", "ink": "#F3F5FB", "icon": "app-sync/brand/icon.png" },
  "platforms": {
    "desktop": { "enabled": true, "mode": "live", "path": "apps/desktop", "targets": ["windows", "macos", "linux"], "updaterPubkey": "..." },
    "android": { "enabled": true, "mode": "live" },
    "ios":     { "enabled": true, "mode": "bundled-ota" }
  },
  "mobile": { "path": "apps/mobile" },
  "ota": {
    "provider": "self-hosted",       // or "capgo" (hosted service)
    "baseUrl": "https://ota.example.com/demo-desk",       // public folder holding <version>/bundle.zip
    "updateUrl": "https://api.example.com/ota/demo-desk"  // the Lambda endpoint
  },
  "decision": {
    "source": "docs/PRD.md", "prdHash": "ea5c8099a80724a3", "decidedOn": "2026-10-25",
    "rationale": { "desktop": "...", "android": "...", "ios": "..." },
    "flags": ["..."]
  },
  "credit": { "text": "Designed & Developed by Synopus", "url": "https://www.synopus.in" },
  "state": { "lastWebSync": {}, "lastNativeRelease": {}, "lastDesktopRelease": {} }   // written by scripts
}
```

Rules:
- Change `app.id` only before the first store release. After that it identifies the app in both stores forever.
- Version must stay within `255.255.65535` (Windows installer limit).
- `state` is written by the scripts and CI; do not hand-edit it.
