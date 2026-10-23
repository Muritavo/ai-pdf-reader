import { useSyncExternalStore } from 'react';
import { scoped } from './projects';

/** How much of the document must have been reached to count it as read to the end */
export const READ_TO_THE_END = 0.99;

const CHANGED_EVENT = 'reading-progress-changed';
const keyOf = (hash: string) => scoped(`reading-progress/${hash}`);
const lastOpeningKeyOf = (hash: string) => scoped(`reading-last-opening/${hash}`);

/** The furthest point of the document that was reached, from 0 to 1 */
export function getReadingProgress(hash?: string): number {
    if (!hash) return 0;
    const stored = Number(window.localStorage.getItem(keyOf(hash)));
    return Number.isFinite(stored) ? stored : 0;
}

export const isReadToTheEnd = (progress: number) => progress >= READ_TO_THE_END;

/**
 * Keeps the furthest point the reader stopped at, so a shorter reading later does not lose what was already read.
 * It is recorded when leaving the document, so looking ahead and scrolling back is not counted
 */
export function recordReadingProgress(hash: string, progress: number) {
    const rounded = Math.round(Math.min(1, Math.max(0, progress)) * 10000) / 10000;
    if (rounded <= getReadingProgress(hash)) return;
    window.localStorage.setItem(keyOf(hash), String(rounded));
    window.dispatchEvent(new Event(CHANGED_EVENT));
}

/** How far the document had been read when it was left, the last time it was opened. Undefined if it never was */
export function getLastOpening(hash?: string): number | undefined {
    if (!hash) return undefined;
    const stored = window.localStorage.getItem(lastOpeningKeyOf(hash));
    return stored === null ? undefined : Number(stored);
}

/** Unlike the furthest point, this one goes back, as it is where the reader stopped */
export function saveLastOpening(hash: string, progress: number) {
    const rounded = Math.round(Math.min(1, Math.max(0, progress)) * 10000) / 10000;
    window.localStorage.setItem(lastOpeningKeyOf(hash), String(rounded));
    window.dispatchEvent(new Event(CHANGED_EVENT));
}

/** Forgets how far the document was read, both the furthest point and where it stopped the last time */
export function resetReadingProgress(hash: string) {
    window.localStorage.removeItem(keyOf(hash));
    window.localStorage.removeItem(lastOpeningKeyOf(hash));
    window.dispatchEvent(new Event(CHANGED_EVENT));
}

function subscribe(onChange: () => void) {
    window.addEventListener(CHANGED_EVENT, onChange);
    window.addEventListener('storage', onChange);
    return () => {
        window.removeEventListener(CHANGED_EVENT, onChange);
        window.removeEventListener('storage', onChange);
    };
}

export function useReadingProgress(hash?: string) {
    return useSyncExternalStore(subscribe, () => getReadingProgress(hash));
}

export function useLastOpening(hash?: string) {
    return useSyncExternalStore(subscribe, () => getLastOpening(hash));
}
