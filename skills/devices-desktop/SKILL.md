---
name: devices-desktop
description: Syno Devices. Creates, updates and builds the Windows, macOS and Linux desktop app (Tauri 2) that mirrors a web application under app-sync. Use when asked to make a desktop app from the web app, upgrade or fix the desktop shell, set up desktop auto-updates, sign or notarize installers, or build Windows/macOS/Linux installers. Requires app-sync.json; run the devices skill (/syno:devices) first if it is missing.
---

# Desktop Shell (Tauri 2)

## Syno rules for this skill

- **The owner decides.** Builds and pushes happen only after a yes. Any push, tag push, store upload or workflow run needs its own yes, asked as a separate question.
- **Heavy work goes through Syno Governor.** Run builds (Tauri, Gradle, Xcode, Capacitor sync) with `gov run --label "<what>" -- '<command>'` and `run_in_background: true`, sized with `gov advise`.
- **Report in plain words.** `syno devices status` says, per platform, whether the app matches the web app; `syno devices report --confirm` saves the shared-look report. Both send a devices.parity event to Syno Pulse when it is enabled.
- **DMAIC step: Improve.**

The desktop app is a thin Tauri 2 shell in `apps/desktop/` (path from `app-sync.json → platforms.desktop.path`). It shows the web app either live (boot page → live URL) or bundled (web build inside), adds a native menu with an About panel carrying the Synopus credit, single-instance focus, remembered window size, and signed self-updates.

`$S` = `${CLAUDE_PLUGIN_ROOT}/skills/devices/scripts`. Templates: `${CLAUDE_PLUGIN_ROOT}/skills/devices-desktop/templates/`. Details: `references/tauri.md`.

The standing rules in the devices skill apply (no AI attribution, credit footer, bespoke chrome, separate platforms, current versions, no secrets in the repo).

## Create

1. `python3 $S/scaffold.py <root> desktop` — writes `package.json`, `src-tauri/{tauri.conf.json, Cargo.toml, build.rs, src/main.rs, capabilities/default.json}` with the app's name, id, version and colours. It never overwrites existing files without `--force`.
2. `cd apps/desktop && npm install`, then `npm install -D @tauri-apps/cli@latest` so the CLI is the newest release today. In `src-tauri`, `cargo update` picks up the latest 2.x crates.
3. Icons: put a 1024×1024 PNG at `app-sync/brand/icon.png`, then `npm run icons`.
4. Updater keys: `npx tauri signer generate -w ~/.tauri/<slug>.key` **outside the repo**. Put the public key in `tauri.conf.json → plugins.updater.pubkey` and in `app-sync.json → platforms.desktop.updaterPubkey`. Tell the person to add the private key and its password as GitHub secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, and to back the key up: losing it means installed apps can never update again.
5. Set `github.repo` in app-sync.json so the updater endpoint points at `https://github.com/<repo>/releases/latest/download/latest.json`, or replace the endpoint with the person's own HTTPS host.
6. `python3 $S/sync_web.py <root> --platform desktop`, then `python3 $S/sync_versions.py <root> --check`.
7. Verify it compiles: `cd apps/desktop/src-tauri && cargo check` (Linux needs `libwebkit2gtk-4.1-dev librsvg2-dev`). Run `npm run dev` when a display is available to see the boot screen.

## Modes

- **live**: `www/` holds only the boot page (as `index.html`) and `offline.html`. The boot page checks for a shell update (capped at 4 s), checks the connection, then hands the window to the live URL. Remote pages get no native permissions; keep it that way.
- **bundled**: `www/` holds the web build plus `offline.html`. Every web change needs a desktop release; `app-sync-web-update.yml` does this automatically on merge to main.

Switching mode: change `platforms.desktop.mode`, run `sync_web.py --platform desktop`, ship a desktop release.

## Update (web app changed, or toolchain moved)

1. `python3 $S/check_toolchain.py <root>`. If `@tauri-apps/cli` is behind: `npm install -D @tauri-apps/cli@latest`; then `cargo update` in `src-tauri`. Read the Tauri release notes for any breaking config change before building.
2. `sync_versions.py` then `sync_web.py --platform desktop`, then `parity_check.py`.
3. Live mode needs no release unless the shell changed (menu, plugins, icons, boot page, Tauri upgrade). Bundled mode always needs one.

## Release

Hand over to the `release-pipeline` skill. Desktop releases come from `app-sync-desktop.yml` on a `desktop-vX.Y.Z` or `vX.Y.Z` tag. The workflow creates a **draft** GitHub release with installers for Windows (NSIS/MSI), macOS (Apple Silicon and Intel DMG/app), Linux (AppImage, deb, rpm) and `latest.json`. Installed apps see it only after the draft is published; confirm with the person before publishing.

## Signing (explain what each gives; all optional for a first internal build)

- **macOS**: Developer ID Application certificate + notarization (secrets `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD` app-specific, `APPLE_TEAM_ID`). Without it Gatekeeper blocks the app.
- **Windows**: an OV/EV code-signing certificate or Azure Trusted Signing; without it SmartScreen warns on install. See `references/tauri.md`.
- **Linux**: AppImage needs no signing; the updater signature still protects updates.

## Do not

- Grant the live site IPC/native permissions (no `remote` entry in capabilities) unless the person explicitly asks and understands the risk.
- Put the updater private key, Apple passwords or certificates in the repo.
- Change `identifier` after the first public release; it is the app's identity for updates and OS settings.
