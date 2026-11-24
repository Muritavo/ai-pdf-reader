/**
 * What the native shells (visionOS, Electron, Android) offer the web app beyond the browser.
 * Each shell puts its implementation on window.nativeBridge, except Android, where Capacitor exposes it as a plugin.
 * On the plain browser there is none, and the app falls back to what the browser can do
 */

/** A device on the local network */
export type NativeDevice = {
    ip: string;
    /** As the network tells it (mDNS, DNS or NetBIOS). Missing when the device has none */
    name?: string;
};

/** Another native app with its sync server open, as announced over mDNS (_researchsync._tcp) */
export type SyncPeer = { id: string; name: string; ip: string; port: number };

/** What reached the sync server of this device: a POST to /sync/announce or to /sync/message, with its raw body */
export type SyncEnvelope = { route: 'announce' | 'message'; ip: string; body: string };

/**
 * The sync server every native shell runs while the sync radar is open (see src/features/Sync).
 * It only relays: what it receives waits on its inbox for the web app, which decides everything.
 * Routes, all answering CORS to any origin:
 * - GET /sync/hello: { app: 'research-toolkit', id, name }, how browsers recognize it while scanning
 * - POST /sync/announce: a device registering itself, answered with the hello
 * - POST /sync/message: a message for this device
 * - GET /sync/messages?for=<id>: the messages held for that browser, which has no server to receive them
 */
export type SyncHost = {
    /** Serves on SYNC_PORT and announces it over mDNS. Resolves with the name of this device */
    syncStart: (id: string) => Promise<{ name: string }>;
    syncStop: () => Promise<void>;
    /** The native apps found over mDNS, but this one */
    syncPeers: () => Promise<SyncPeer[]>;
    /** Takes what arrived since the last call */
    syncInbox: () => Promise<SyncEnvelope[]>;
    /** Holds a message until the browser polls /sync/messages for it */
    syncHold: (to: string, body: string) => Promise<void>;
    /** POSTs from the native side, which has none of the mixed content limits of the page */
    syncPost: (url: string, body: string) => Promise<{ status: number; body: string }>;
};

export type NativeBridge = SyncHost & {
    /** The devices of the local network, with their names */
    getDevices: () => Promise<NativeDevice[]>;
};

/** The plugin Capacitor exposes on Android, whose calls take and resolve objects */
type AndroidPlugin = {
    getDevices: () => Promise<{ devices: NativeDevice[] }>;
    syncStart: (options: { id: string }) => Promise<{ name: string }>;
    syncStop: () => Promise<void>;
    syncPeers: () => Promise<{ peers: SyncPeer[] }>;
    syncInbox: () => Promise<{ envelopes: SyncEnvelope[] }>;
    syncHold: (options: { to: string; body: string }) => Promise<void>;
    syncPost: (options: { url: string; body: string }) => Promise<{ status: number; body: string }>;
};

declare global {
    interface Window {
        nativeBridge?: NativeBridge;
        /** Set by Capacitor on Android, with the plugins of the app */
        Capacitor?: { Plugins?: { NativeBridge?: AndroidPlugin } };
    }
}

/** The bridge of the shell the app is running on, if any */
export function getNativeBridge(): NativeBridge | undefined {
    // Android first: Capacitor declares a global nativeBridge of its own, which is not this one
    const android = window.Capacitor?.Plugins?.NativeBridge;
    if (android)
        return {
            getDevices: () => android.getDevices().then(({ devices }) => devices),
            syncStart: id => android.syncStart({ id }),
            syncStop: () => android.syncStop(),
            syncPeers: () => android.syncPeers().then(({ peers }) => peers),
            syncInbox: () => android.syncInbox().then(({ envelopes }) => envelopes),
            syncHold: (to, body) => android.syncHold({ to, body }),
            syncPost: (url, body) => android.syncPost({ url, body }),
        };
    return window.nativeBridge;
}
