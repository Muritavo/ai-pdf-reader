// The sync server of the desktop app (see SyncHost on src/utils/nativeBridge.ts, which documents the routes).
// It only relays: what arrives waits on the inbox until the web app takes it
const { execFileSync } = require('node:child_process');
const http = require('node:http');
const os = require('node:os');
const { Bonjour } = require('bonjour-service');

/** Must match SYNC_PORT of src/features/Sync/network.ts */
const SYNC_PORT = 47816;
/** Must match the one the other native shells announce and browse */
const SERVICE_TYPE = 'researchsync';
const APP = 'research-toolkit';
const MAX_BODY = 64 * 1024 * 1024;

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Private-Network': 'true',
};

let state;

/** The name of this computer, as set on it: macOS keeps it apart from the host name, which may be just its address */
function deviceName() {
    if (process.platform === 'darwin') {
        try {
            const name = execFileSync('scutil', ['--get', 'ComputerName'], { encoding: 'utf8', timeout: 2000 }).trim();
            if (name) return name;
        } catch {
            // Falls back to the host name
        }
    }
    return os.hostname().replace(/\.local$/, '');
}

const ipOf = request => (request.socket.remoteAddress || '').replace(/^::ffff:/, '');

function readBody(request) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        request.on('data', chunk => {
            size += chunk.length;
            if (size > MAX_BODY) {
                reject(new Error('Too large'));
                request.destroy();
            } else chunks.push(chunk);
        });
        request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        request.on('error', reject);
    });
}

async function handle(request, response) {
    const send = (status, body) => {
        response.writeHead(status, { ...CORS, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) });
        response.end(body === undefined ? undefined : JSON.stringify(body));
    };
    const url = new URL(request.url, 'http://localhost');
    const hello = { app: APP, id: state.id, name: state.name };
    if (request.method === 'OPTIONS') return send(204);
    if (request.method === 'GET' && url.pathname === '/sync/hello') return send(200, hello);
    if (request.method === 'GET' && url.pathname === '/sync/messages') {
        const to = url.searchParams.get('for') || '';
        const held = state.held.get(to) || [];
        state.held.delete(to);
        return send(200, held);
    }
    if (request.method === 'POST' && (url.pathname === '/sync/announce' || url.pathname === '/sync/message')) {
        const body = await readBody(request);
        const route = url.pathname === '/sync/announce' ? 'announce' : 'message';
        state.inbox.push({ route, ip: ipOf(request), body });
        return route === 'announce' ? send(200, hello) : send(204);
    }
    send(404, { error: 'Not found' });
}

/** The first private IPv4 address the service was announced with */
const ipv4Of = service => (service.addresses || []).find(address => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address));

async function syncStart(id) {
    await syncStop();
    const name = deviceName();
    const server = http.createServer((request, response) =>
        handle(request, response).catch(() => {
            if (!response.headersSent) response.writeHead(400, CORS);
            response.end();
        }),
    );
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(SYNC_PORT, '0.0.0.0', resolve);
    });
    const bonjour = new Bonjour();
    bonjour.publish({ name, type: SERVICE_TYPE, port: SYNC_PORT, txt: { id } });
    const peers = new Map();
    const browser = bonjour.find({ type: SERVICE_TYPE });
    browser.on('up', service => {
        const peerId = service.txt && service.txt.id;
        const ip = ipv4Of(service);
        if (!peerId || peerId === id || !ip) return;
        peers.set(service.fqdn, { id: String(peerId), name: service.name, ip, port: service.port });
    });
    browser.on('down', service => peers.delete(service.fqdn));
    state = { id, name, server, bonjour, browser, peers, inbox: [], held: new Map() };
    return { name };
}

async function syncStop() {
    if (!state) return;
    const { server, bonjour, browser } = state;
    state = undefined;
    browser.stop();
    await new Promise(resolve => bonjour.unpublishAll(() => resolve()));
    bonjour.destroy();
    // The browsers polling keep their connections open, which would hold the close
    server.closeAllConnections();
    await new Promise(resolve => server.close(() => resolve()));
}

const syncPeers = () => (state ? [...state.peers.values()] : []);

function syncInbox() {
    if (!state) return [];
    const taken = state.inbox;
    state.inbox = [];
    return taken;
}

function syncHold(to, body) {
    if (!state) return;
    state.held.set(to, [...(state.held.get(to) || []), body]);
}

/** POSTs to another device, which the page can't do from its secure origin */
async function syncPost(url, body) {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body, signal: AbortSignal.timeout(30_000) });
    return { status: response.status, body: await response.text() };
}

module.exports = { syncStart, syncStop, syncPeers, syncInbox, syncHold, syncPost };
