/**
 * The data of a sync travels encrypted with a key derived from the 6 digit code, which never travels itself:
 * the device that sends shows the code, and only the one typing it can open what was sent.
 * It keeps the data from whoever is on the network without the code, but 6 digits can be guessed offline by
 * someone who recorded the traffic, so it is not meant to stand against a determined attacker
 */

const ITERATIONS = 250_000;

/** A code of 6 digits, from the secure random source */
export function newCode() {
    const [value] = crypto.getRandomValues(new Uint32Array(1));
    return String(value % 1_000_000).padStart(6, '0');
}

export type Sealed = { salt: string; iv: string; data: string };

function toBase64(bytes: Uint8Array) {
    let binary = '';
    // In chunks, as spreading megabytes at once overflows the arguments of fromCharCode
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
}

function fromBase64(text: string) {
    return Uint8Array.from(atob(text), char => char.charCodeAt(0));
}

async function keyOf(code: string, salt: Uint8Array<ArrayBuffer>) {
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS },
        material,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
    );
}

export async function seal(code: string, text: string): Promise<Sealed> {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyOf(code, salt), new TextEncoder().encode(text));
    return { salt: toBase64(salt), iv: toBase64(iv), data: toBase64(new Uint8Array(data)) };
}

/** The text sealed, or undefined when the code is not the one it was sealed with */
export async function open(code: string, sealed: Sealed): Promise<string | undefined> {
    try {
        const key = await keyOf(code, fromBase64(sealed.salt));
        const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(sealed.iv) }, key, fromBase64(sealed.data));
        return new TextDecoder().decode(data);
    } catch {
        return undefined;
    }
}
