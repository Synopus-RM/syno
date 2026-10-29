# Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Parity job fails "DRIFT" | a shell file edited by hand or a version bump not propagated | `sync_versions.py`, commit |
| Parity fails "AI/tool attribution found" | a comment, About text or workflow line names a tool/AI | remove the line |
| Desktop: "signature verification failed" on update | `pubkey` in tauri.conf.json does not match `TAURI_SIGNING_PRIVATE_KEY` | regenerate pair only if the old private key is lost (then users must reinstall); otherwise fix the secret |
| Desktop: updater never sees new version | release still a draft, or `latest.json` missing a platform | publish the release; re-run failed matrix jobs before publishing |
| macOS: "app is damaged / can't be opened" | not signed or not notarized | set the Apple secrets; check notarization log in the job |
| Windows: SmartScreen warning | unsigned installer | add Windows signing (desktop-shell `references/tauri.md`) |
| Linux build: webkit2gtk not found | runner image older than 22.04 or missing apt step | keep `ubuntu-22.04`+ and the apt install step |
| Android: Play rejects target API | `targetSdkVersion` below the current floor | raise in `android/variables.gradle`, test, rebuild |
| Android: "version code already used" | build number not bumped | `sync_versions.py --bump patch` |
| Android: `cap build` keystore error | base64 secret has line breaks or wrong alias | re-encode with `base64 -w0`; check alias with `keytool -list -keystore upload.jks` |
| iOS: "No profiles for … were found" | profile name/bundle id mismatch or expired | check `IOS_PROFILE_NAME`; regenerate the App Store profile |
| iOS: upload rejected for SDK | Xcode below 26 on the runner | the workflow's Xcode check fails first; pin a runner image with Xcode 26+ |
| iOS: crash at first camera/photo use | missing usage-description string | add `NSCameraUsageDescription` etc. in Info.plist, store release |
| OTA never applies | `updateUrl` wrong, endpoint answers "no update", or `notifyAppReady` missing so the update rolls back | call the endpoint with curl using the app's version; confirm `app-sync-ready.js` is in `www/index.html` |
| OTA refused in CI | native layer changed since last store release | ship Android/iOS store builds; OTA resumes after `record_release.py` runs |
| Web-update workflow didn't run | change was only under ignored paths, or every platform is live | expected; live apps already show the change |
