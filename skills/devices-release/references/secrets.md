# GitHub secrets by platform

Add in GitHub → repository → Settings → Secrets and variables → Actions. Only the platforms that are enabled need their secrets. Keep a copy of every key in the company password vault: lost signing keys cannot be recovered and block updates for installed apps.

## Desktop (app-sync-desktop.yml)

| Secret | What it is | How to get it |
|---|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | updater signing key (contents of the `.key` file) | `npx tauri signer generate -w ~/.tauri/<app>.key` — run outside the repo |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | its password | chosen at generation |
| `APPLE_CERTIFICATE` | Developer ID Application cert, `.p12` as base64 | Keychain export → `base64 -i cert.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | `.p12` password | chosen at export |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Synopus (TEAMID)` | `security find-identity -v -p codesigning` |
| `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` | notarization: Apple ID, app-specific password, team id | appleid.apple.com → App-Specific Passwords; developer.apple.com → Membership |

The Apple secrets are optional for internal builds (unsigned macOS apps need right-click → Open).

## Android (app-sync-android.yml)

| Secret | What it is | How to get it |
|---|---|---|
| `ANDROID_KEYSTORE_BASE64` | upload keystore, base64 | `keytool -genkeypair -v -keystore upload.jks -keyalg RSA -keysize 4096 -validity 10000 -alias upload` then `base64 -w0 upload.jks` |
| `ANDROID_KEYSTORE_PASSWORD` | keystore password | chosen above |
| `ANDROID_KEY_ALIAS` | `upload` (or the alias used) | |
| `ANDROID_KEY_PASSWORD` | key password | |
| `PLAY_SERVICE_ACCOUNT_JSON` | optional; enables upload to Play | Google Cloud service account with Play Console "Release manager" access, JSON key |

The first upload of a new app must be done once by hand in Play Console (app record, Play App Signing enrolment). After that CI uploads drafts.

## iOS (app-sync-ios.yml)

| Secret | What it is | How to get it |
|---|---|---|
| `IOS_DIST_CERT_P12_BASE64` | Apple Distribution certificate `.p12`, base64 | Keychain export |
| `IOS_DIST_CERT_PASSWORD` | its password | |
| `APPLE_TEAM_ID` | team id | developer.apple.com → Membership |
| `IOS_PROFILE_NAME` | App Store provisioning profile name for the bundle id | developer.apple.com → Profiles |
| `APPSTORE_ISSUER_ID` / `APPSTORE_KEY_ID` / `APPSTORE_PRIVATE_KEY` | App Store Connect API key (App Manager role); private key = `.p8` contents | App Store Connect → Users and Access → Integrations |

The app record must exist in App Store Connect with the same bundle id before the first upload.

## OTA (app-sync-web-update.yml)

| Secret | What it is |
|---|---|
| `OTA_AWS_ROLE_ARN` | IAM role trusted for GitHub OIDC (`token.actions.githubusercontent.com`) for this repo, allowed `s3:PutObject` on the OTA prefix |
| `OTA_AWS_REGION` | e.g. `ap-south-1` |
| `OTA_BUCKET` | bucket name |
| `OTA_PREFIX` | e.g. `demo-desk` (matches the Lambda's `OTA_PREFIX`) |
