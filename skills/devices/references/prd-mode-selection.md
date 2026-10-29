# Deciding each platform's mode from the PRD

The PRD decides. Read all of it, not just the scan output. Record the decision in `app-sync.json → decision` with a one-line rationale per platform that cites the PRD section, so the next person (or the next run) can see why.

## Order of questions

Answer these in order; the first that applies settles the mode for that platform.

1. **Is the web app bundleable?** (`detect_stack.py`) If it is server-rendered (SSR Next.js/Nuxt/Remix/SvelteKit without static export, PHP/Jinja templates), every platform is `live`. If the PRD also requires offline use, flag the conflict: the web app needs a static/SPA build before offline apps are possible. Do not fake offline.
2. **Does the PRD require offline use?** (field work, low connectivity, "works without internet", sync-when-online) → desktop `bundled`, mobile `bundled-ota`.
3. **Does the app depend on several native device features?** (camera/QR scanning, biometrics, Bluetooth, NFC, background location, file system, contacts) → mobile `bundled-ota`, so the web code that calls native plugins is versioned with the native layer and guarded by the native fingerprint.
4. **Is the iOS app a thin view of the website?** A live wrapper with nothing native risks App Store guideline 4.2 (minimum functionality). For iOS prefer `bundled-ota`; choose `live` only if the PRD gives the iOS app real native value (push, biometrics, share sheet, deep links, widgets) and you add it.
5. **Must every change be reviewed by the stores?** (regulated content, contractual review, the PRD says so) → `bundled-store` for that platform.
6. **Otherwise** → desktop `live`, Android `live`, iOS `bundled-ota`. This gives instant parity where it is safe and review-friendly behaviour on iOS.

Frequent web releases (weekly or faster) push toward `live` or `bundled-ota`, never `bundled-store`.

## Flags to raise with the person (and record in `decision.flags`)

- **Digital goods or subscriptions unlocked in the app** → Apple and Google billing rules apply to in-app unlocks of digital features. Decide per store before release: store billing, reader-style flows, or hiding purchase UI in the apps. Do not decide this silently.
- **Payments for physical goods/services, loans, chit funds, UPI** → test the gateway's redirect and UPI-intent hand-off inside the WebView on both platforms.
- **Sensitive data (KYC, PAN, Aadhaar, bank, GST, tax)** → HTTPS-only navigation (`allowNavigation` restricted to the live host), WebView debugging off in release builds, no secrets in the bundle, accurate Play Data safety and App Store privacy answers.
- **Push notifications** → add `@capacitor/push-notifications` with FCM and APNs keys. This is a native change: store release required.
- **Store presence not mentioned for a platform** → ask whether that platform is wanted before building it; set `enabled: false` otherwise.

## Re-deciding

`parity_check.py` warns when the PRD file's hash changes. Re-read the changed sections; if a mode changes, update `decision` (new hash, date, rationale), re-run `sync_web.py --cap-sync`, and tell the person what changes for users. Moving a mobile platform between `live` and bundled modes changes native config, so it needs a store release.
