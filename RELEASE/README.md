# Desktop release

Packages Research Workflow as a desktop app for macOS, Windows and Linux with [Electron](https://www.electronjs.org/) and [electron-builder](https://www.electron.build/).

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

## Notes

- **Code signing:** the packages are unsigned. On macOS, open the app the first time with right-click → **Open** (or allow it in System Settings → Privacy & Security). On Windows, SmartScreen asks for confirmation. See [electron-builder code signing](https://www.electron.build/code-signing) to sign them.
- **Data:** the desktop app keeps its own storage, apart from the browser's. Use **Export** in the browser and **Import** in the app to move projects over.
- **AI endpoint:** set `VITE_AI_ENDPOINT` while building to change the default, as in the web app. Plain-`http` endpoints other than `localhost`/`127.0.0.1` may be blocked as mixed content; prefer `https` for remote servers.
- **Icon:** the default Electron icon is used. Add `build/icon.png` (1024×1024) to replace it.
- **Version:** the app version comes from `version` in this folder's `package.json`.
