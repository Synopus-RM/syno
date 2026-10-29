# Over-the-air (OTA) web updates

Used by mobile platforms in `bundled-ota` mode. The app ships the web build; when the web app changes on `main`, CI publishes a new web bundle that installed apps download in the background and apply on next launch. Native code never travels over the air.

## Pieces

| Piece | Where | Role |
|---|---|---|
| `@capgo/capacitor-updater` | `apps/mobile` dependency | checks `updateUrl`, downloads, verifies checksum, swaps bundle, rolls back if not confirmed |
| `app-sync-ready.js` | injected into `www/index.html` by `sync_web.py` | calls `notifyAppReady()` so a bundle that boots is kept |
| `package_ota.py` | CI | zips `www/` with the Capgo CLI, writes `manifest.json` (`version`, `url`, `checksum`, `platforms`, `minNativeBuild`) |
| S3 (or any HTTPS static host) | `ota.baseUrl` | serves `<version>/bundle.zip` |
| Lambda endpoint | `app-sync/ota-endpoint/lambda_function.py`, URL in `ota.updateUrl` | compares the app's version with the manifest and answers |
| `app-sync-web-update.yml` | CI | bump patch → package → upload bundle → upload manifest (manifest last) |

## Endpoint contract

The app POSTs JSON including `app_id`, `platform`, `version_name` (current bundle), `version_build` (native build number). The endpoint answers:
- update available: `{"version": "1.4.2", "url": "https://…/1.4.2/bundle.zip", "checksum": "<sha256>"}`
- no update: `{"message": "…", "error": "no_new_version_available"}`

The Lambda refuses bundles to native builds older than `minNativeBuild` (the last store release), so new web code never reaches an app whose native layer is too old.

## Setting up the self-hosted endpoint (AWS)

1. S3 bucket with a public-read (or CloudFront) prefix for `<prefix>/<version>/bundle.zip`; `manifest.json` can stay private (only the Lambda reads it).
2. Lambda (Python 3.12+) from `app-sync/ota-endpoint/lambda_function.py`; env `OTA_BUCKET`, `OTA_PREFIX`, `APP_ID`; IAM `s3:GetObject` on the manifest; a Function URL (HTTPS). Put that URL in `ota.updateUrl` and the public folder in `ota.baseUrl`.
3. GitHub OIDC role allowed to `s3:PutObject` on the prefix; secrets `OTA_AWS_ROLE_ARN`, `OTA_AWS_REGION`, `OTA_BUCKET`, `OTA_PREFIX`.
4. `sync_web.py --cap-sync` so the updater config reaches the native projects, then ship one store release that contains the updater. OTA works from that build onward.

## Alternative: hosted service

Capgo Cloud (or Capawesome Cloud) replaces the S3 + Lambda pieces with a managed channel, rollouts and dashboards. Switch `ota.provider` to `capgo`, follow the provider's current docs for `updateUrl`/API key, and replace the upload step in `app-sync-web-update.yml` with the provider's CLI upload. Ionic Appflow is being discontinued in 2026; do not adopt it.

## Rules

- OTA carries HTML, CSS, JS and assets only. Apple allows downloaded interpreted code only when it does not change the app's primary purpose or add a new storefront; keep OTA for the same app the reviewer approved.
- Never `--force` `package_ota.py` past a native-change refusal.
- Test every OTA on a real device with the oldest supported native build before merging large web changes.
- Rollback: publish the previous version's bundle as a new higher patch version (the updater only moves forward); the built-in rollback covers bundles that fail to boot.
