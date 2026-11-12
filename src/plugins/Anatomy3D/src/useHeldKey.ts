import { useEffect, useState } from 'react';

/**
 * Whether the key is being held, as "h" to hide the outlines or "alt" to name them.
 * Not while typing or with another modifier (as a shortcut), and let go when the window loses the focus
 */
export default function useHeldKey(key: string) {
    const [held, setHeld] = useState(false);

    useEffect(() => {
        const isTyping = (e: KeyboardEvent) => e.target instanceof HTMLElement && !!e.target.closest('input, textarea, [contenteditable="true"]');
        const onKeyDown = (e: KeyboardEvent) => {
            const modified = key !== 'alt' && (e.metaKey || e.ctrlKey || e.altKey);
            if (e.key.toLowerCase() === key && !modified && !isTyping(e)) setHeld(true);
        };
        const onKeyUp = (e: KeyboardEvent) => {
            if (e.key.toLowerCase() === key) setHeld(false);
        };
        const release = () => setHeld(false);
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);
        window.addEventListener('blur', release);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp);
            window.removeEventListener('blur', release);
        };
    }, [key]);

    return held;
}
