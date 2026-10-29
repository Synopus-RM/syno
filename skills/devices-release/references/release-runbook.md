# Release runbook

## Before tagging

1. Working tree clean, on `main`, pulled.
2. `python3 app-sync/tools/check_toolchain.py` — upgrade anything behind (platform skills' upgrade sections).
3. Baseline older than 60 days or a store release coming → re-verify store rules on the web, update `app-sync/baseline.json`.
4. Version: `sync_versions.py --bump patch|minor|major` (or `--from-web`). Patch: fixes. Minor: new features. Major: breaking or redesign.
5. `sync_web.py --cap-sync` and `parity_check.py` — zero FAIL. Explain any WARN to the person.
6. Release notes: write what changed for users in plain words (no internal ticket jargon, no tool or AI mentions). Store "What's new" ≤ 500 characters on Play; 4000 on App Store.
7. Commit: `release: <App> <version>`.

## Tag (confirm with the person first)

```bash
git tag -a v1.4.0 -m "<App> 1.4.0"        # all platforms
git tag -a android-v1.4.0 -m "<App> 1.4.0 Android"   # one platform
git push origin <tag>
```

## After CI

| Platform | Where the build lands | Person's finishing step |
|---|---|---|
| Desktop | draft GitHub release with installers + `latest.json` | review assets for all OSes, then **Publish**; installed apps update on next launch |
| Android | artifact `android-aab`; Play track as draft (if service account set) | Play Console → review release → roll out (staged % recommended) |
| iOS | TestFlight | test on device → App Store Connect → submit for review → release |

Then `parity_check.py` on main: the record jobs will have committed `state.lastNativeRelease` / `lastDesktopRelease`.

## Hotfix

Branch from the release tag only if main has unreleased work; otherwise fix on main. Bump patch, release the affected platform with its own tag. For bundled-ota mobile apps a web-only fix ships by OTA on merge, no store release.

## Rollback

- Desktop: publish a new higher version containing the old code (the updater only moves forward). Unpublishing the latest release makes the previous one "latest" again for apps that have not updated yet.
- Android: halt the staged rollout in Play Console; ship a higher versionCode with the fix.
- iOS: remove the version from sale or expedite a fix release.
- OTA: publish the previous bundle as a new higher patch version.
