export async function sha256(message: string): Promise<string> {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    return Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

import { del, get, set, setMany } from 'idb-keyval';
import { scoped } from './projects';

const CACHE_PREFIX = 'cache-';

const cacheKeyOf = async (args: string[]) => scoped(`${CACHE_PREFIX}${await sha256(args.join(''))}`);

/** Whether the answer for these arguments was already cached, so the AI is not needed */
export async function isCached(args: string[]) {
    return (await get<string>(await cacheKeyOf(args))) !== undefined;
}

/** Forgets the cached answer for these arguments, so the AI is asked again next time */
export async function clearCached(args: string[]) {
    await del(await cacheKeyOf(args));
}

/** Caches the (expensive) AI answers on IndexedDB, keyed by the hash of the arguments, since they don't fit the quota of localStorage */
export async function withCache(args: string[], produce: () => Promise<string>) {
    const cacheKey = await cacheKeyOf(args);
    const cached = await get<string>(cacheKey);
    if (cached) return cached;

    const response = await produce();
    await set(cacheKey, response);
    return response;
}

/** The answers cached on localStorage before they moved to IndexedDB, as project/<id>/cache-<sha256> */
const LEGACY_CACHE_KEY = new RegExp(`^project/[^/]+/${CACHE_PREFIX}[0-9a-f]{64}$`);

/** Moves the answers of every project cached on localStorage to IndexedDB, freeing the quota of localStorage */
export async function migrateCacheFromLocalStorage() {
    const legacyKeys = Object.keys(localStorage).filter(key => LEGACY_CACHE_KEY.test(key));
    if (!legacyKeys.length) return;
    await setMany(legacyKeys.map(key => [key, localStorage.getItem(key)!]));
    legacyKeys.forEach(key => localStorage.removeItem(key));
}

export function wrapFunction<F extends (...args: string[]) => Promise<string>>(func: F) {
    return ((...args: string[]) => withCache(args, () => func(...args))) as F;
}
