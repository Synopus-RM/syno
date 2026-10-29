---
name: devices-mobile
description: Syno Devices. Creates, updates and builds the Android and iOS apps (Capacitor 8) that mirror a web application under app-sync, including over-the-air web updates. Use when asked to make Android or iOS apps from the web app, upgrade Capacitor, add native features like push notifications or camera to the apps, set up OTA updates, raise the Android target SDK, or prepare Play Store / App Store builds. Requires app-sync.json; run the devices skill (/syno:devices) first if it is missing.
---

# Mobile Shell (Capacitor 8)

## Syno rules for this skill

- **The owner decides.** Builds and pushes happen only after a yes. Any push, tag push, store upload or workflow run needs its own yes, asked as a separate question.
- **Heavy work goes through Syno Governor.** Run builds (Tauri, Gradle, Xcode, Capacitor sync) with `gov run --label "<what>" -- '<command>'` and `run_in_background: true`, sized with `gov advise`.
- **Report in plain words.** `syno devices status` says, per platform, whether the app matches the web app; `syno devices report --confirm` saves the shared-look report. Both send a devices.parity event to Syno Pulse when it is enabled.
- **DMAIC step: Improve.**

Android and iOS share one Capacitor project in `apps/mobile/` (path from `app-sync.json → mobile.path`) but are configured and released separately: `capacitor.config.ts` reads each platform's mode from app-sync.json through the `APP_SYNC_PLATFORM` variable, so Android can open the live web app while iOS ships the bundled build with OTA updates (or any mix the PRD decided).

`$S` = `${CLAUDE_PLUGIN_ROOT}/skills/devices/scripts`. References: `references/capacitor.md`, `references/ota.md`, `references/store-compliance.md`.

The standing rules in the devices skill apply (no AI attribution, credit footer, bespoke chrome, separate platforms, current versions, no secrets in the repo).

## Create

1. `python3 $S/scaffold.py <root> mobile` — writes `package.json`, `capacitor.config.ts`, and (for OTA) `app-sync/ota-endpoint/lambda_function.py`.
2. `cd apps/mobile && npm install`, then bring every Capacitor package to today's latest of the current major: `npm i @capacitor/core@latest @capacitor/android@latest @capacitor/ios@latest @capacitor/app@latest @capacitor/splash-screen@latest && npm i -D @capacitor/cli@latest @capacitor/assets@latest`.
3. If any mobile platform is `bundled-ota`: `npm i @capgo/capacitor-updater@latest`.
4. `python3 $S/sync_web.py <root> --platform android --platform ios` (fills `www/`; needed before adding platforms).
5. Add only the enabled platforms, each with its own mode: `APP_SYNC_PLATFORM=android npx cap add android`, `APP_SYNC_PLATFORM=ios npx cap add ios`. iOS projects can be created anywhere but build only on macOS with Xcode 26+.
6. Brand assets in `app-sync/brand/` (see app-sync `references/premium-chrome.md`), then `npm run assets`.
7. `python3 $S/sync_versions.py <root>` (writes versionName/versionCode and MARKETING_VERSION/CURRENT_PROJECT_VERSION), then `python3 $S/sync_web.py <root> --cap-sync`, then `parity_check.py`.
8. Confirm `android/variables.gradle` meets the baseline (`targetSdkVersion`/`compileSdkVersion` ≥ 36 as of Oct 2026, `minSdkVersion` ≥ 24).
9. Commit `android/` and `ios/`; they are real native projects the stores build from. `www/` stays gitignored.

## Modes

- **live**: `server.url` = live URL, `errorPath: offline.html`, navigation limited to the live host. Web changes appear instantly. iOS: only with real native value (see `references/store-compliance.md`).
- **bundled-ota**: web build inside; `app-sync-ready.js` (injected by `sync_web.py`) confirms each update booted so the updater keeps it; the updater fetches newer bundles from `ota.updateUrl`. See `references/ota.md` for the endpoint and the Capgo-cloud alternative.
- **bundled-store**: web build inside, every change through the stores.

Changing a platform's mode changes native config: run `sync_web.py --platform <p> --cap-sync` and ship a store release for that platform.

## Native features

Adding a plugin (push, camera, biometrics, share, haptics…) is a native change:
1. `npm i @capacitor/<plugin>@latest` (or the community plugin) and follow its Android manifest / iOS Info.plist steps (usage-description strings must be written in plain words for the reviewer and user).
2. `sync_web.py --cap-sync`.
3. The web app calls it only when `Capacitor.isNativePlatform()` is true, so the website keeps working in browsers.
4. Store release required; `parity_check.py` warns and `package_ota.py` refuses OTA until `record_release.py` logs the new native release (CI does this).

## Update (web app changed, or toolchain moved)

1. `python3 $S/check_toolchain.py <root>`. Minor/patch behind: `npm i <pkg>@latest` for every `@capacitor/*` package together, then `npx cap sync`. Major behind (e.g. Capacitor 9 stable): read the upgrade guide, `npx cap migrate`, rebuild both platforms, full test, store release.
2. Store floor rose (Android target API, Xcode): see `references/store-compliance.md`.
3. `sync_versions.py`, `sync_web.py --cap-sync`, `parity_check.py`.
4. What ships: live → nothing; bundled-ota → OTA on merge to main (automatic via CI) unless native changed; bundled-store → store release.

## Release

Hand over to the `release-pipeline` skill: `app-sync-android.yml` (signed AAB, optional Play upload as draft) and `app-sync-ios.yml` (archive with Xcode 26+, TestFlight upload). Store submission and production rollout are irreversible steps: confirm with the person first.

## Do not

- Put keystores, `.p12` files, App Store Connect keys or Play service-account JSON in the repo.
- Enable WebView debugging in release builds (template sets `webContentsDebuggingEnabled: false`).
- Push an OTA that needs native code users do not have (the scripts block this; do not `--force` it).
- Change `app.id` after the first store release.
