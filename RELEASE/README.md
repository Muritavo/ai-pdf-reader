# Release

Packages Research Workflow as a desktop app for macOS, Windows and Linux with [Electron](https://www.electronjs.org/) and [electron-builder](https://www.electron.build/), and as an Android app with [Capacitor](https://capacitorjs.com/).

This folder is self-contained: it has its own dependencies and reads only the web build of the project (`../dist`). Nothing in the project depends on it.

## How it works

- `main.cjs` opens a window and serves `../dist` (bundled as `web/` once packaged) from an `app://local` origin, so the build's absolute `/assets/` paths resolve and the page gets a secure origin for its storage.
- Web links (Google, DOIs, ChEMBL...) open in the default browser. The app's own pages, such as diagrams, open in a new app window.
- `electron-builder.yml` lists the packages built for each OS.

## Usage

```bash
npm install
```

| Command | What it does |
|---|---|
| `npm start` | Builds the web app and runs it in Electron |
| `npm run dist` | Builds the packages for the current OS |
| `npm run dist:mac` | macOS `.dmg` (Apple Silicon and Intel) |
| `npm run dist:win` | Windows installer `.exe` (x64) |
| `npm run dist:linux` | Linux `.AppImage` (x64) |

Every command first runs the project's `npm run build`. The packages are written to `out/`.

All three targets build from macOS. Building the Windows installer from Linux or macOS may need [Wine](https://www.electron.build/multi-platform-build) on some setups.

## Android

`capacitor.config.json` copies `../dist` into the Android project of `android/`, served from `https://localhost` inside the app. Plain-`http` AI endpoints (e.g. a computer on the local network) are allowed.

| Command | What it does |
|---|---|
| `npm run android` | Builds the web app and copies it into `android/` |
| `npm run dist:android` | Also builds an unsigned release APK (needs the [Android SDK](https://developer.android.com/studio) and Java 21) |

Open `android/` in Android Studio to run it on a device or emulator.

On a phone, `127.0.0.1` is the phone itself: point the AI status to a server the phone can reach, as your computer's address on the network (e.g. `http://192.168.0.10:8000`).

### Signing

Updates only install over the previous version when every APK is signed with the same key. Create one once, and keep it safe (losing it means users have to uninstall to update):

```bash
keytool -genkeypair -v -keystore release.keystore -alias research-workflow -keyalg RSA -keysize 2048 -validity 10000
```

Then add these secrets on GitHub (**Settings → Secrets and variables → Actions**):

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | Output of `base64 -i release.keystore` |
| `ANDROID_KEYSTORE_PASSWORD` | The keystore password |
| `ANDROID_KEY_ALIAS` | `research-workflow` |
| `ANDROID_KEY_PASSWORD` | The key password (same as the keystore's unless you chose another) |

Without them, the workflow signs the APK with a throwaway debug key: it installs, but every new release has to replace the previous one by uninstalling it first (losing the app's data).

## Automatic releases

[`.github/workflows/release.yml`](../.github/workflows/release.yml) runs whenever a pull request is merged on GitHub:

1. Builds the packages on macOS, Windows and Linux runners, and the Android APK on Linux, with the scripts above.
2. Publishes them as a GitHub release tagged `v<version>-build.<run number>` (e.g. `v0.0.0-build.12`), with notes listing the merged pull requests.

The version comes from `version` in this folder's `package.json`; bump it to start a new series. GitHub Actions is free for public repositories.

## Notes

- **Code signing:** the packages are unsigned. On macOS, open the app the first time with right-click → **Open** (or allow it in System Settings → Privacy & Security). On Windows, SmartScreen asks for confirmation. See [electron-builder code signing](https://www.electron.build/code-signing) to sign them.
- **Data:** the desktop app keeps its own storage, apart from the browser's. Use **Export** in the browser and **Import** in the app to move projects over.
- **AI endpoint:** set `VITE_AI_ENDPOINT` while building to change the default, as in the web app. Plain-`http` endpoints other than `localhost`/`127.0.0.1` may be blocked as mixed content; prefer `https` for remote servers.
- **Icon:** the default Electron icon is used. Add `build/icon.png` (1024×1024) to replace it.
- **Version:** the app version comes from `version` in this folder's `package.json`.
