const { app, BrowserWindow, net, protocol, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

/** The web build sits next to this file once packaged, and on the project's dist/ while running from source */
const WEB_ROOT = app.isPackaged ? path.join(__dirname, 'web') : path.join(__dirname, '..', 'dist');

/**
 * The app is served from app://local/ instead of file://, so the absolute /assets/ paths of the build resolve,
 * and it gets a secure origin of its own for localStorage, IndexedDB and the browser file storage
 */
const SCHEME = 'app';
const ORIGIN = `${SCHEME}://local`;

protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.wasm': 'application/wasm' };

async function serve(request) {
    const { pathname } = new URL(request.url);
    const file = path.normalize(path.join(WEB_ROOT, decodeURIComponent(pathname)));
    // Nothing outside of the build is served
    if (!file.startsWith(WEB_ROOT + path.sep)) return new Response('Not found', { status: 404 });
    const target = pathname === '/' ? path.join(WEB_ROOT, 'index.html') : file;
    const response = await net.fetch(pathToFileURL(target).toString());
    const type = MIME[path.extname(target).toLowerCase()];
    if (!type) return response;
    const headers = new Headers(response.headers);
    headers.set('Content-Type', type);
    return new Response(response.body, { status: response.status, headers });
}

function createWindow() {
    const window = new BrowserWindow({
        width: 1400,
        height: 900,
        backgroundColor: '#0f1115',
        autoHideMenuBar: true,
        webPreferences: { contextIsolation: true, sandbox: true },
    });
    // Web pages (Google, DOIs, ChEMBL...) open on the default browser; the app's own pages, as the diagrams, stay in the app
    window.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('http:') || url.startsWith('https:')) {
            shell.openExternal(url);
            return { action: 'deny' };
        }
        return { action: 'allow' };
    });
    window.loadURL(`${ORIGIN}/`);
}

app.whenReady().then(() => {
    protocol.handle(SCHEME, serve);
    createWindow();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
