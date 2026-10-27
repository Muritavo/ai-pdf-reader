export async function sha256(message: string): Promise<string> {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    return Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

import { scoped } from './projects';

const CACHE_PREFIX = 'cache-';

const cacheKeyOf = async (args: string[]) => scoped(`${CACHE_PREFIX}${await sha256(args.join(''))}`);

/** Whether the answer for these arguments was already cached, so the AI is not needed */
export async function isCached(args: string[]) {
    return window.localStorage.getItem(await cacheKeyOf(args)) !== null;
}

/** Forgets the cached answer for these arguments, so the AI is asked again next time */
export async function clearCached(args: string[]) {
    window.localStorage.removeItem(await cacheKeyOf(args));
}

/** Caches the (expensive) AI answers on localStorage, keyed by the hash of the arguments */
export async function withCache(args: string[], produce: () => Promise<string>) {
    const cacheKey = await cacheKeyOf(args);
    const cached = window.localStorage.getItem(cacheKey);
    if (cached) return cached;

    const response = await produce();
    window.localStorage.setItem(cacheKey, response);
    return response;
}

export function wrapFunction<F extends (...args: string[]) => Promise<string>>(func: F) {
    return ((...args: string[]) => withCache(args, () => func(...args))) as F;
}
