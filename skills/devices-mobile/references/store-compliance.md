# Store compliance for web-based apps

Verified 25 Oct 2026. Re-check before each store release (app-sync `references/platform-baseline.md`).

## Google Play

- **Target API**: new apps and updates must target API 36 since 31 Aug 2026. Raise `targetSdkVersion` and `compileSdkVersion` in `android/variables.gradle`, then read the Android 16 behaviour changes (edge-to-edge, predictive back, large-screen orientation and resizability) and test.
- **Data safety form**: declare everything the web app and plugins collect (account, contact, financial, location, photos). For KYC/finance apps this is reviewed closely.
- **Payments**: digital goods/features unlocked inside the app fall under Google Play's billing policy; physical goods, services and loan repayments do not. Decide per app with the person; record it in `decision.flags`.
- **Developer account**: Synopus publishes under its own developer account unless the client has one. Use the existing package naming pattern (`in.synopus.<app>`) unless the app already has an id.

## Apple App Store

- **Build floor**: Xcode 26 / iOS 26 SDK since 28 Apr 2026.
- **4.2 Minimum functionality**: an app that is just a website in a frame is rejected. Live mode on iOS needs real native value: push notifications, biometrics login, share sheet, deep/universal links, widgets, offline cache. Bundled-ota with at least one or two of these is the safer default.
- **Interpreted code / OTA**: allowed when downloaded code does not change the app's primary purpose, add features that bypass review, or create a storefront. Keep OTA to the reviewed app's evolution.
- **3.1.1 In-app purchase**: digital features or content unlocked in the app must use Apple's purchase system, with the exceptions Apple lists (reader apps, physical goods and services, person-to-person services, certain business tools). Check the current guideline text and any regional entitlements before deciding.
- **Sign in with Apple**: required if the app offers third-party social sign-in (Google, Facebook) as the primary login, subject to Apple's exceptions.
- **Privacy**: App Privacy "nutrition label" answers, privacy manifest for required-reason APIs, usage strings for every permission.
- **Account deletion**: apps that let users create accounts must offer in-app account deletion.

## Desktop distribution

- macOS outside the Mac App Store: Developer ID signing + notarization.
- Windows: code signing to avoid SmartScreen warnings; Microsoft Store submission is optional and separate.
- Linux: AppImage/deb/rpm from CI; no store needed.
