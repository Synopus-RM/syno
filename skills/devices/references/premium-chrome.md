# Premium native chrome

"Chrome" is every screen the shells own rather than the web app: the boot screen, the offline screen, the update prompt, the splash, the app icon, and the desktop About panel. People see them on every launch and every network drop, so they decide whether the app feels premium. Each app gets its own design; never ship the baseline templates unchanged, and never reuse another app's chrome.

## Process (once per app, before the first release)

1. **Ground it in the product.** Open the web app (live URL or source). Take its real colours, type, corner radii and icon. Note what the product does and who uses it: a tax filing tool for Tamil Nadu businesses and a temple finder should not share a look.
2. **Write a short plan**: 4–6 named colours from the brand, one or two typefaces and their roles, the one memorable element (a signature motion on the boot screen, a distinctive mark treatment, an illustrated offline state drawn in SVG), and the layout in a sentence. Check the plan against generic defaults (cream background with terracotta, black with acid green, identical rounded cards, ALL-CAPS eyebrow labels, arrows on buttons) and change anything that reads like one.
3. **Build** `app-sync/chrome/boot.html` and `app-sync/chrome/offline.html`. Keep the scripts and tokens from the baseline; replace the design.
4. **Check** both screens at 360×780 (phone) and 1280×820 (desktop), light and dark system themes, with reduced motion on, and with keyboard focus. Take screenshots and look at them. Remove one decorative element before calling it done.

## Hard requirements

- **Zero network assets.** These pages show when the network is down. Inline all CSS, SVG and script. Fonts: system stacks, or a font file shipped inside `www/` (referenced relatively) when the brand typeface matters.
- **Tokens kept.** `{{APP_NAME}}`, `{{LIVE_URL}}`, `{{VERSION}}`, `{{CREDIT_LEAD}}`, `{{CREDIT_NAME}}`, `{{CREDIT_URL}}` and the colour tokens are filled by `sync_web.py`. Hard-coding them breaks parity when the config changes.
- **Credit footer**: `{{CREDIT_LEAD}} <a href="{{CREDIT_URL}}">{{CREDIT_NAME}}</a>`, i.e. "Designed & Developed by **Synopus**" linking to https://www.synopus.in. Keep the Tauri opener handler so the link opens in the system browser on desktop.
- **States** (boot page): connecting, update available, updating with progress, update failed, offline. Offline page: offline, retrying. Every state says what happened and what to do, in plain words, with one primary action. Errors never apologise and never blame the user.
- **Behaviour kept**: the connectivity probe with timeout, auto-retry on the `online` event, `location.replace` (no back-stack entry to the boot page), the 4-second cap on the update check so launch is never held hostage by a slow network.
- **Accessibility**: WCAG AA contrast in both themes, visible focus, `role="status"` live region, `prefers-reduced-motion` honoured, tap targets ≥ 44 px, safe-area insets on notched phones.
- **Motion**: one orchestrated moment (the boot signature), nothing decorative elsewhere.
- **No attribution** other than the Synopus credit. No "powered by", no tool names.

## Other chrome

- **Icon**: 1024×1024 `app-sync/brand/icon.png`, opaque for iOS. Desktop: `npm run icons` in `apps/desktop`. Mobile: `npm run assets` in `apps/mobile` (Capacitor Assets) reads `app-sync/brand/`: `icon-only.png`, `icon-foreground.png`, `icon-background.png`, `splash.png`, `splash-dark.png` for full control, or just `logo.png` (+ `logo-dark.png`) for the simple mode with `--iconBackgroundColor` and `--splashBackgroundColor` set to the brand background.
- **Splash**: brand background with the mark centred; same colour as the boot page background so the hand-off is seamless.
- **Desktop About panel**: set in `src-tauri/src/main.rs` with the credit and website. Keep it.
- **Window background**: `tauri.conf.json → app.windows[0].backgroundColor` matches the boot background to avoid a white flash.
