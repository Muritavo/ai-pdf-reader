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

export type NativeBridge = {
    /** The devices of the local network, with their names */
    getDevices: () => Promise<NativeDevice[]>;
};

declare global {
    interface Window {
        nativeBridge?: NativeBridge;
        /** Set by Capacitor on Android, with the plugins of the app */
        Capacitor?: { Plugins?: { NativeBridge?: { getDevices: () => Promise<{ devices: NativeDevice[] }> } } };
    }
}

/** The bridge of the shell the app is running on, if any */
export function getNativeBridge(): NativeBridge | undefined {
    if (window.nativeBridge) return window.nativeBridge;
    const android = window.Capacitor?.Plugins?.NativeBridge;
    if (android) return { getDevices: () => android.getDevices().then(({ devices }) => devices) };
    return undefined;
}
