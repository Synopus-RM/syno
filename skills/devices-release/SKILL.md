---
name: devices-release
description: Syno Devices. Sets up and runs the GitHub Actions pipelines that build, sign and release the desktop (Windows, macOS, Linux) and mobile (Android, iOS) apps of an app-sync project, and push web changes to bundled apps automatically. Use when asked to add CI/CD for the apps, release a new app version, ship to Play Store / App Store / GitHub releases, set up signing secrets, publish an OTA update, or find out why an app build failed. Requires app-sync.json.
---

# Release Pipeline (GitHub Actions)

## Syno rules for this skill

- **The owner decides.** Builds and pushes happen only after a yes. Any push, tag push, store upload or workflow run needs its own yes, asked as a separate question.
- **Heavy work goes through Syno Governor.** Run builds (Tauri, Gradle, Xcode, Capacitor sync) with `gov run --label "<what>" -- '<command>'` and `run_in_background: true`, sized with `gov advise`.
- **Report in plain words.** `syno devices status` says, per platform, whether the app matches the web app; `syno devices report --confirm` saves the shared-look report. Both send a devices.parity event to Syno Pulse when it is enabled.
- **DMAIC step: Improve.**

Each platform has its own workflow, tag and secrets so one platform's problem never blocks another. `$S` = `${CLAUDE_PLUGIN_ROOT}/skills/devices/scripts`.

| Workflow | Runs on | Does |
|---|---|---|
| `app-sync-parity.yml` | every push to main and every PR | builds the web app into the shells and runs `parity_check.py`; report in the job summary |
| `app-sync-web-update.yml` | push to main touching the web app (only created when some platform is bundled) | bumps patch, publishes the OTA bundle (bundled-ota mobile) and/or calls the desktop release (bundled desktop) |
| `app-sync-desktop.yml` | tags `v*`, `desktop-v*`; manual; called by web-update | Windows, macOS (Apple Silicon + Intel), Linux installers + `latest.json` as a **draft** GitHub release |
| `app-sync-android.yml` | tags `v*`, `android-v*`; manual (choose Play track) | signed AAB; uploads to Play as a **draft** when the service-account secret exists |
| `app-sync-ios.yml` | tags `v*`, `ios-v*`; manual | Xcode 26+ archive, App Store signing, TestFlight upload |

Release jobs record the release back into `app-sync.json` (`record_release.py`) with a plain commit message and the `app-sync` bot identity. Commit messages, release notes and tags carry no AI or tool attribution.

## Set up

1. `python3 $S/scaffold.py <root> workflows` — writes the workflows for enabled platforms only and vendors the scripts into `app-sync/tools/` (CI runs that copy). Re-run after plugin upgrades.
2. Replace any remaining `{{…}}` placeholder; `parity_check.py` and a quick grep catch them.
3. Check each third-party action for a newer major version on its GitHub releases page before the first run (`tauri-apps/tauri-action`, `r0adkll/upload-google-play`, `apple-actions/*`, `maxim-lobanov/setup-xcode`, `aws-actions/configure-aws-credentials`). Bump the `@vN` tags if needed.
4. Give the person the secrets list for their enabled platforms from `references/secrets.md`. Never ask them to paste secret values into chat; they add them in GitHub → Settings → Secrets and variables → Actions. If the `gh` CLI is authenticated on their machine, `gh secret set NAME < file` is fine to suggest.
5. Repository settings: Actions → General → Workflow permissions "Read and write" (release recording and the version bump push to main). If main is protected, allow the GitHub Actions bot to push, or switch the record steps to open a PR.
6. Commit the workflows on a branch and open a PR; the parity workflow runs on it. Show the person the result.

## Release a version

Follow `references/release-runbook.md`. In short:
1. `sync_versions.py --bump <part>` (or `--from-web`), `sync_web.py --cap-sync`, `parity_check.py` must have no FAIL.
2. Re-verify store floors if the baseline is older than 60 days (app-sync `references/platform-baseline.md`).
3. Commit, then tag: `vX.Y.Z` for every platform, or `desktop-vX.Y.Z` / `android-vX.Y.Z` / `ios-vX.Y.Z` for one. **Pushing a tag starts store builds: confirm with the person first.**
4. Watch the runs (`gh run watch` or the Actions tab). On failure, read the log, fix, and re-run; do not delete published tags.
5. Finishing steps that stay with the person (irreversible, need their accounts): publish the desktop draft release, promote the Play draft to production, submit the TestFlight build for App Review.

## Web change only (bundled apps)

Merging to main runs `app-sync-web-update.yml` automatically. Live platforms need nothing. If OTA is refused because the native layer changed, run a store release for the mobile platforms first; the next web change then flows by OTA again.

## Troubleshooting

`references/troubleshooting.md` lists the common failures (signing, provisioning, target SDK rejection, notarization, updater signature mismatch, OTA not applying) with fixes.
