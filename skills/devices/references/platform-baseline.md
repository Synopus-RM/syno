# Platform baseline

These floors were verified on **25 October 2026** (latest published that day: Capacitor 8.5.3, `@capgo/capacitor-updater` 8.54.0, Tauri CLI 2.12.4). They are floors, not pins: always install the latest published versions, and re-verify store rules before any store release. `check_toolchain.py` reads today's latest package versions from npm; store rules must be checked on the web.

## Store rules

| Store | Rule in force | Source to re-check |
|---|---|---|
| Google Play | New apps and updates must target **Android 16 (API 36)** since 31 Aug 2026. Existing apps below API 35 become hidden from new users on newer devices. The next step (API 37) is expected around Aug 2027. | Google Play Console Help, "Target API level requirements for Google Play apps" |
| App Store | Uploads must be built with **Xcode 26 / iOS 26 SDK** or later since 28 Apr 2026. | developer.apple.com/news/upcoming-requirements |
| App Store | Guideline 4.2 (minimum functionality) applies to thin website wrappers. OTA updates may only change HTML/CSS/JS and must not change the app's primary purpose. | App Review Guidelines; Apple Developer Program License Agreement |
| Microsoft / macOS | Windows: sign installers to avoid SmartScreen warnings. macOS: sign with Developer ID and notarize, or Gatekeeper blocks the app. | Tauri distribution docs |

## Toolchain floors

| Tool | Floor | Notes |
|---|---|---|
| Node.js | 22 | Required by Capacitor 8 |
| Capacitor | 8.5.0 (`@capacitor/core`, `cli`, `android`, `ios`) | 8.x current; 9 was in alpha. New iOS projects use Swift Package Manager by default. Android minSdk 24, compile/target SDK 36. |
| Tauri | 2.11.0 (`@tauri-apps/cli`, `tauri` crate 2.x) | Updater plugin needs Rust ≥ 1.77.2 |
| Java | 21 | Android Gradle builds |
| Xcode | 26 | App Store floor |
| OTA | `@capgo/capacitor-updater` (self-hosted endpoint) | Ionic Appflow is being discontinued in 2026; do not build new release flows on it. Alternatives: Capgo Cloud, Capawesome Cloud. |

## Re-verifying (do this before every store release, and when the baseline is older than 60 days)

1. Run `check_toolchain.py <root>`. Upgrade any shell dependency marked "update available" or "major behind" (see the platform skill's upgrade section; a major Capacitor upgrade uses `npx cap migrate`).
2. Search the web for the current Google Play target API requirement and Apple's upcoming requirements page. Check the GitHub Actions used in the workflows for newer major versions.
3. Write the verified values to `<root>/app-sync/baseline.json` (same shape as the plugin's `scripts/baseline.json`) with today's `asOf`. Parity then checks against the project's file.
4. If a floor rose (for example Android API 37), raise `targetSdkVersion`/`compileSdkVersion` in `apps/mobile/android/variables.gradle`, read that Android version's behaviour changes, rebuild and test before releasing.
