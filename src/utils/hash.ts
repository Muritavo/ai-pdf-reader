export async function sha256(message: string): Promise<string> {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    return Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

const CACHE_PREFIX = 'cache-';

/** Caches the (expensive) AI answers on localStorage, keyed by the hash of the arguments */
export async function withCache(args: string[], produce: () => Promise<string>) {
    const cacheKey = `${CACHE_PREFIX}${await sha256(args.join(''))}`;
    const cached = window.localStorage.getItem(cacheKey);
    if (cached) return cached;

    const response = await produce();
    window.localStorage.setItem(cacheKey, response);
    return response;
}

export function wrapFunction<F extends (...args: string[]) => Promise<string>>(func: F) {
    return ((...args: string[]) => withCache(args, () => func(...args))) as F;
}
