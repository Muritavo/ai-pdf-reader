import { localSubnets } from '../AIIntegrationWizard/discovery';
import { getNativeBridge, type NativeBridge } from '../../utils/nativeBridge';
import type { Sealed } from './crypto';

/**
 * How the devices with the sync radar open find and talk to each other.
 * Only the native apps can receive connections, so each runs a small server (see SyncHost on nativeBridge.ts):
 * - native apps find each other over mDNS, and register on each other at /sync/announce
 * - browsers scan the network for the servers, register on them, and poll them for their messages
 * Browsers never talk to each other, having no server
 */

/** The port of the sync server. Must match the one of the native shells (Android, Electron, visionOS) */
export const SYNC_PORT = 47816;
const APP = 'research-toolkit';

export type DeviceKind = 'native' | 'browser';

export type SyncDevice = { id: string; name: string; kind: DeviceKind; ip: string; port?: number };

export type SyncMessage =
    /** Asks the device to send its projects to the one asking */
    | { type: 'request'; from: string; session: string }
    /** The projects, sealed with the code the sending device shows */
    | { type: 'payload'; from: string; session: string; sealed: Sealed }
    /** The projects were opened and added, so the sending device can leave the code */
    | { type: 'done'; from: string; session: string }
    | { type: 'cancel'; from: string; session: string };

type Announce = { app: typeof APP; id: string; name: string; kind: DeviceKind; port?: number };

export type SyncNetwork = {
    self: { id: string; name: string };
    send: (to: SyncDevice, message: SyncMessage) => Promise<void>;
    stop: () => void;
};

type Listeners = { onDevices: (devices: SyncDevice[]) => void; onMessage: (message: SyncMessage) => void };

/** A device is gone once nothing is heard from it for this long */
const EXPIRES_MS = 12_000;
const ANNOUNCE_MS = 4000;
const POLL_MS = 1500;
const INBOX_MS = 1000;
const PEERS_MS = 3000;
/** Between the scans of the network a browser keeps doing while open */
const RESCAN_MS = 5000;
const HELLO_TIMEOUT_MS = 1500;
const CONCURRENT_CHECKS = 64;

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

const urlOf = (ip: string, port = SYNC_PORT, route: string) => `http://${ip}:${port}/sync/${route}`;

function parse<T>(text: string): T | undefined {
    try {
        return JSON.parse(text) as T;
    } catch {
        return undefined;
    }
}

const isMessage = (value: unknown): value is SyncMessage => {
    const message = value as Partial<SyncMessage> | undefined;
    return typeof message?.type === 'string' && typeof message.from === 'string' && typeof message.session === 'string';
};

/** The devices heard from, forgetting the ones silent for too long */
class Roster {
    private devices = new Map<string, SyncDevice & { seenAt: number }>();

    constructor(
        private selfId: string,
        private onChange: (devices: SyncDevice[]) => void,
    ) {}

    seen(device: SyncDevice) {
        if (device.id === this.selfId) return;
        const known = this.devices.get(device.id);
        this.devices.set(device.id, { ...known, ...device, seenAt: Date.now() });
        if (!known || known.name !== device.name || known.ip !== device.ip) this.emit();
    }

    /** Hearing from a device already known keeps it */
    touch(id: string) {
        const known = this.devices.get(id);
        if (known) known.seenAt = Date.now();
    }

    get(id: string) {
        return this.devices.get(id);
    }

    list() {
        return [...this.devices.values()];
    }

    prune() {
        let changed = false;
        for (const [id, device] of this.devices) {
            if (Date.now() - device.seenAt > EXPIRES_MS) changed = this.devices.delete(id);
        }
        if (changed) this.emit();
    }

    private emit() {
        this.onChange(this.list().map(({ seenAt: _, ...device }) => device));
    }
}

/** Runs the task now and then every interval, never two at once, until stopped */
function every(intervalMs: number, task: () => Promise<void> | void, stopped: () => boolean) {
    const run = async () => {
        if (stopped()) return;
        try {
            await task();
        } catch (e) {
            console.error('Sync task failed', e);
        }
        if (!stopped()) setTimeout(run, intervalMs);
    };
    run();
}

/** As "Safari · Mac", from what the browser tells of itself */
function browserName() {
    const agent = navigator.userAgent;
    const browser = /Edg\//.test(agent)
        ? 'Edge'
        : /Firefox\//.test(agent)
          ? 'Firefox'
          : /Chrome\//.test(agent)
            ? 'Chrome'
            : /Safari\//.test(agent)
              ? 'Safari'
              : 'Navegador';
    const system = /Android/.test(agent)
        ? 'Android'
        : /iPhone|iPad/.test(agent)
          ? 'iOS'
          : /Mac OS X/.test(agent)
            ? 'Mac'
            : /Windows/.test(agent)
              ? 'Windows'
              : /Linux/.test(agent)
                ? 'Linux'
                : '';
    return system ? `${browser} · ${system}` : browser;
}

/**
 * Ends once the last native session has stopped. The native shell keeps a single server, so a session only starts
 * after the previous one stopped, or that stop, arriving late, would close the server of the new one
 */
let lastNativeSession: Promise<void> = Promise.resolve();

/** The sync server of the native app, finding the other native apps over mDNS and receiving the browsers */
async function startNative(bridge: NativeBridge, { onDevices, onMessage }: Listeners): Promise<SyncNetwork> {
    const id = newId();
    const previous = lastNativeSession;
    let ended!: () => void;
    lastNativeSession = new Promise(resolve => (ended = resolve));
    await previous;
    let name: string;
    try {
        ({ name } = await bridge.syncStart(id));
    } catch (e) {
        ended();
        throw e;
    }
    let stopped = false;
    const roster = new Roster(id, onDevices);
    const announce: Announce = { app: APP, id, name, kind: 'native', port: SYNC_PORT };

    every(
        INBOX_MS,
        async () => {
            for (const envelope of await bridge.syncInbox()) {
                if (envelope.route === 'announce') {
                    const device = parse<Announce>(envelope.body);
                    if (device?.app !== APP || typeof device.id !== 'string') continue;
                    roster.seen({ id: device.id, name: String(device.name), kind: device.kind, ip: envelope.ip, port: device.port });
                } else {
                    const message = parse<unknown>(envelope.body);
                    if (!isMessage(message) || stopped) continue;
                    roster.touch(message.from);
                    onMessage(message);
                }
            }
            roster.prune();
        },
        () => stopped,
    );

    every(
        PEERS_MS,
        async () => {
            const peers = await bridge.syncPeers();
            for (const peer of peers) roster.seen({ ...peer, kind: 'native' });
            // Registers on each, so it shows this one even when its mDNS missed it
            await Promise.all(peers.map(peer => bridge.syncPost(urlOf(peer.ip, peer.port, 'announce'), JSON.stringify(announce)).catch(() => undefined)));
        },
        () => stopped,
    );

    return {
        self: { id, name },
        send: async (to, message) => {
            const body = JSON.stringify(message);
            // A browser has no server, so the message waits here until it polls
            if (to.kind === 'browser') return bridge.syncHold(to.id, body);
            const { status } = await bridge.syncPost(urlOf(to.ip, to.port, 'message'), body);
            if (status >= 300) throw new Error(`The device refused the message (${status})`);
        },
        stop: () => {
            if (stopped) return;
            stopped = true;
            bridge
                .syncStop()
                .catch(e => console.error('Could not stop the sync server', e))
                .finally(ended);
        },
    };
}

/** The sync server on the address, if there is one */
async function hello(ip: string, signal: AbortSignal): Promise<Announce | undefined> {
    try {
        const response = await fetch(urlOf(ip, SYNC_PORT, 'hello'), { signal: AbortSignal.any([AbortSignal.timeout(HELLO_TIMEOUT_MS), signal]) });
        const body = (await response.json()) as Partial<Announce>;
        return body.app === APP && typeof body.id === 'string' ? (body as Announce) : undefined;
    } catch {
        return undefined;
    }
}

/** The browser scans the network for the sync servers, registering on them and polling them for its messages */
function startBrowser({ onDevices, onMessage }: Listeners): SyncNetwork {
    const id = newId();
    const name = browserName();
    const aborter = new AbortController();
    const stopped = () => aborter.signal.aborted;
    const roster = new Roster(id, onDevices);
    const announce: Announce = { app: APP, id, name, kind: 'browser' };

    // text/plain keeps the requests simple, without the CORS preflight
    const post = (device: SyncDevice, route: string, body: string) =>
        fetch(urlOf(device.ip, device.port, route), { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body, signal: aborter.signal });

    const register = async (device: SyncDevice) => {
        const response = await post(device, 'announce', JSON.stringify(announce));
        if (response.ok) roster.touch(device.id);
    };

    every(
        RESCAN_MS,
        async () => {
            const subnets = await localSubnets();
            const addresses = subnets.flatMap(subnet => Array.from({ length: 254 }, (_, i) => `${subnet}.${i + 1}`));
            let next = 0;
            const worker = async () => {
                while (next < addresses.length && !stopped()) {
                    const ip = addresses[next++];
                    const found = await hello(ip, aborter.signal);
                    if (!found) continue;
                    const device: SyncDevice = { id: found.id, name: String(found.name), kind: 'native', ip, port: SYNC_PORT };
                    const known = roster.get(device.id);
                    roster.seen(device);
                    if (!known) await register(device).catch(() => undefined);
                }
            };
            await Promise.all(Array.from({ length: CONCURRENT_CHECKS }, worker));
        },
        stopped,
    );

    every(ANNOUNCE_MS, () => Promise.all(roster.list().map(device => register(device).catch(() => undefined))).then(() => roster.prune()), stopped);

    every(
        POLL_MS,
        () =>
            Promise.all(
                roster.list().map(async device => {
                    try {
                        const response = await fetch(`${urlOf(device.ip, device.port, 'messages')}?for=${encodeURIComponent(id)}`, { signal: aborter.signal });
                        if (!response.ok) return;
                        roster.touch(device.id);
                        for (const body of (await response.json()) as string[]) {
                            const message = parse<unknown>(body);
                            if (isMessage(message) && !stopped()) onMessage(message);
                        }
                    } catch {
                        // Polled again on the next round, or forgotten once silent for long
                    }
                }),
            ).then(() => undefined),
        stopped,
    );

    return {
        self: { id, name },
        send: async (to, message) => {
            const response = await post(to, 'message', JSON.stringify(message));
            if (!response.ok) throw new Error(`The device refused the message (${response.status})`);
        },
        stop: () => aborter.abort(),
    };
}

/** Starts finding the other devices, as a native app when running on one */
export function startSyncNetwork(listeners: Listeners): Promise<SyncNetwork> {
    const bridge = getNativeBridge();
    return bridge ? startNative(bridge, listeners) : Promise.resolve(startBrowser(listeners));
}
