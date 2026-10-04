# Nex Pi Control (Android app)

Expo SDK 57, React Native 0.86, TypeScript (strict) and Expo Router. This is the mobile client for [`../agent`](../agent).

## Try it without a Pi

The app has a built-in demo with realistic sample data. Tap **Try the demo first** on the welcome screen. No network, no server.

## Develop

```bash
npm ci
bash scripts/dev-mock.sh disk     # mock agent + mock shell on your computer, scenario ok | demo | disk | busy, plus adb reverse
npx expo run:android              # debug build on a connected phone or emulator
```

In the app, connect to `http://127.0.0.1:8120` with the mock token printed by the script (plain http is allowed for local and private addresses).

## Quality

```bash
npx tsc --noEmit    # types
npx eslint .        # lint, including the React Compiler rules
npx jest            # API client, error mapping, URL policy, QR import, alerts, charts, demo mode, a smoke test per screen in Dutch and English
```

The screen tests use `__tests__/fixtures/mock-api.json`, real responses from the mock agent. Regenerate after an API change:

```bash
cd ../agent && SCENARIO=disk python scripts/export_demo.py /tmp/fx && cp /tmp/fx/demo-nl.json ../app/__tests__/fixtures/mock-api.json
python scripts/export_demo.py ../app/src/demo     # demo data built into the app
```

## Release builds (Linux)

```bash
bash scripts/kali-bootstrap.sh     # once: JDK 17, Android SDK, adb, npm ci, upload keystore in ../keys
bash scripts/install-usb.sh        # signed release APK, installed on your phone over USB
bash scripts/install-usb.sh --aab  # Android App Bundle for Google Play, in ../releases
```

Builds run in `~/nex-pi-control-build`, a copy without spaces in the path (the NDK does not handle spaces). Signing comes from `../keys/signing.env` through `plugins/withReleaseSigning.js`; without it, release builds fall back to the debug key. Back up `../keys/`: it is your upload key for Google Play.

Bump `expo.android.versionCode` in `app.json` for every upload to Google Play.

## Structure

```
src/app/            screens (Expo Router): (tabs)/ overview, statistics, system, terminal, more + detail and tool screens, about
src/api/            client (headers, error mapping, demo routing), hooks (polling, offline cache), types
src/components/     primitives, layout (header, disk banner), overlays (sheet, hold-to-confirm, toasts)
src/features/       charts, terminal (xterm.js in a WebView), lock (biometrics), onboarding (QR), shell
src/demo/           built-in demo: sample data from the mock agent and a small simulated terminal
src/background/     alerts via expo-background-task, no push server
src/i18n/           en.ts and nl.ts, language follows the phone
src/theme/tokens.ts all colors, fonts and spacing
plugins/            config plugins: release signing, floating icon, live widgets, Flex Window widget
```

## Galaxy Z Flip cover screen (Flex Window)

Two parts, both optional:

- **Flex Window widget** (`PiCover`, 352 x 339 dp). Samsung lists it under Settings > Cover screen > Widgets as "Nex Pi Control · Flex Window", no extra apps needed (`plugins/withFlexWindow.js` adds the `keyguard` category, Samsung's `sub_screen` meta-data and its own receiver class). On the cover screen everything is a native Android layout (`modules/widget-live`: `nex_cover_intro`, `nex_cover_spin`, `nex_cover_data`), not the bitmap that react-native-android-widget draws: Samsung's cover host passes no usable widget size, so a bitmap stays empty there. The JS task (`src/widget/task.tsx`) only fetches the data and hands formatted values to `CoverScreen.renderData` (`src/widget/coverModel.ts`). Every time the cover screen turns on: the Nex AI logo for 3 s, the spinning Pi case as a loading screen (at least 1.8 s, until the data is in), then the full board; every 15 s a refresh while the cover screen stays on (Live widgets must be on). The bottom-right notch of the cover screen stays empty.
- **Full cover screen** (`src/app/cover.tsx`). Tapping the widget opens `nexpicontrol://cover`. With Good Lock MultiStar ("Launcher Widget" / apps on the cover screen) the app runs on the cover screen itself and switches to this screen automatically: logo, spinning case, then every parameter with the charts of the last hour. Without MultiStar, Samsung asks to unfold and the normal app opens.

The spinner frames come from `scripts/pi-case/render_frames.py` (same model and camera as the in-app spinner).

## Security in the app

- **Secrets:** all tokens live in the Android Keystore (SecureStore) with `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, and the app opts out of backups (`allowBackup=false`).
- **Lock:** fingerprint (or screen lock) at start and after the chosen time in the background. Opening the terminal and viewing tokens ask again.
- **Screenshots:** blocked in the terminal, files, editor, settings and onboarding, and hidden in the app switcher.
- **Network:** `https://` everywhere. Plain `http://` is only accepted for private addresses in your home network (RFC 1918 and `.local`), with a warning. No cookies (`credentials: omit`). The terminal WebView loads nothing from the internet.
- **Permissions:** microphone, storage and overlay permissions are explicitly blocked in the manifest.
- **No tracking:** no analytics, crash reporting or ad SDKs.
