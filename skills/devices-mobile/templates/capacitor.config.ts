import type { CapacitorConfig } from '@capacitor/cli';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

// One shell, two platforms, each with its own sync mode from app-sync.json.
// sync_web.py runs `npx cap sync <platform>` with APP_SYNC_PLATFORM set, so
// Android can open the live web app while iOS ships the bundled build (or any
// other mix the project's PRD decided).

function findUp(name: string, from = process.cwd()): string {
  let dir = resolve(from);
  for (;;) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`${name} not found above ${from}`);
    dir = parent;
  }
}

type Mode = 'live' | 'bundled-ota' | 'bundled-store';
const sync = JSON.parse(readFileSync(findUp('app-sync.json'), 'utf8'));
const platform = (process.env.APP_SYNC_PLATFORM || '').toLowerCase();
const mode: Mode =
  (sync.platforms?.[platform]?.mode as Mode) ??
  // Unknown platform (e.g. `npx cap open`): fall back to the safest choice.
  'bundled-store';
if (!platform) {
  console.warn('[app-sync] APP_SYNC_PLATFORM not set; using bundled settings. Run sync_web.py --cap-sync.');
}

const liveUrl: string = sync.web?.liveUrl ?? '';
const liveHost = liveUrl ? new URL(liveUrl).host : '';
const brand = sync.brand ?? {};

const config: CapacitorConfig = {
  appId: sync.app.id,
  appName: sync.app.name,
  webDir: 'www',
  loggingBehavior: 'debug',
  server: {
    androidScheme: 'https',
    cleartext: false,
    ...(mode === 'live'
      ? { url: liveUrl, errorPath: 'offline.html', allowNavigation: [liveHost] }
      : liveHost
        ? { allowNavigation: [liveHost] }
        : {}),
  },
  android: {
    backgroundColor: brand.background,
    webContentsDebuggingEnabled: false,
  },
  ios: {
    backgroundColor: brand.background,
    contentInset: 'automatic',
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 900,
      launchAutoHide: true,
      backgroundColor: brand.background,
      showSpinner: false,
    },
    ...(mode === 'bundled-ota'
      ? {
          CapacitorUpdater: {
            autoUpdate: true,
            updateUrl: sync.ota?.updateUrl,
            statsUrl: '',
            channelUrl: '',
            appReadyTimeout: 10000,
            responseTimeout: 20,
            resetWhenUpdate: true,
          },
        }
      : {}),
  },
};

export default config;
