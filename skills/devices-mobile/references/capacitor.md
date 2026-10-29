# Capacitor shell reference

## Per-platform configuration

`capacitor.config.ts` finds `app-sync.json` by walking up from the working directory, reads `APP_SYNC_PLATFORM` (`android` | `ios`), and builds the config for that platform's mode:

| Mode | `server` | `plugins.CapacitorUpdater` |
|---|---|---|
| `live` | `url` = live URL, `errorPath: 'offline.html'`, `allowNavigation: [liveHost]` | not set |
| `bundled-ota` | `allowNavigation: [liveHost]` (API calls / links to the live host stay in-app) | `autoUpdate`, `updateUrl`, stats and channel URLs blank (no third-party telemetry), `appReadyTimeout: 10000`, `resetWhenUpdate: true` |
| `bundled-store` | as bundled-ota | not set |

Without `APP_SYNC_PLATFORM` (for example `npx cap open` typed by hand) it warns and uses bundled settings, the safe choice. Use the package scripts (`npm run sync:android`, `npm run open:ios`) or `sync_web.py --cap-sync`, which set it. On Windows shells use `set APP_SYNC_PLATFORM=android&& npx cap sync android`.

`npx cap sync <platform>` writes the evaluated config to `android/app/src/main/assets/capacitor.config.json` and `ios/App/App/capacitor.config.json`; inspect those to confirm what each platform got.

Release hygiene already in the template: `cleartext: false`, `androidScheme: 'https'`, WebView debugging off, splash colour = brand background.

## Versions

`sync_versions.py` writes:
- Android `app/build.gradle`: `versionName` = app version, `versionCode` = build number
- iOS `project.pbxproj`: `MARKETING_VERSION` = app version, `CURRENT_PROJECT_VERSION` = build number

Both stores reject a build number that is not higher than the last upload; the build number only increases (`--bump`, `--set` and a changed `--from-web` add 1).

## Android notes (Capacitor 8)

- `variables.gradle`: `minSdkVersion 24`, `compileSdkVersion 36`, `targetSdkVersion 36` by default. Raise target/compile when Google Play's floor rises.
- Edge-to-edge is enforced for apps targeting recent Android versions; Capacitor 8's SystemBars handling covers status/navigation bars. Check the web app's fixed headers and bottom bars on a gesture-navigation device; add `env(safe-area-inset-*)` padding in the web CSS if content sits under the bars.
- Predictive back: targeting API 36 changes back handling. With no `backButton` listener Capacitor navigates WebView history, then exits. Test that the hardware back never exits from an inner screen.
- Signing: Play App Signing is recommended; CI signs the AAB with the **upload key** (`ANDROID_KEYSTORE_BASE64` etc.).

## iOS notes (Capacitor 8)

- New iOS projects use Swift Package Manager (no CocoaPods); existing CocoaPods projects keep working. The iOS workflow handles both (`App.xcworkspace` or `App.xcodeproj`).
- Build with Xcode 26+ (App Store floor since 28 Apr 2026).
- Usage-description strings in `Info.plist` for every permission a plugin needs (camera, photos, location, Face ID). Missing ones crash the app at first use and fail review.
- Privacy manifest: plugins ship their own `PrivacyInfo.xcprivacy`; the app's own manifest must list any required-reason APIs the app uses.

## Assets

`@capacitor/assets` generates every icon and splash size from `app-sync/brand/` (`npm run assets`). Re-run after any brand change; it rewrites files inside `android/` and `ios/`.
