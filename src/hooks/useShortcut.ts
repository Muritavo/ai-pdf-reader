import { useEffect, useRef } from 'react';

/** `mod` is Cmd on macOS and Ctrl elsewhere, the other modifiers are taken as they are */
type Modifier = 'mod' | 'ctrl' | 'meta' | 'shift' | 'alt';

const MODIFIERS: Modifier[] = ['mod', 'ctrl', 'meta', 'shift', 'alt'];
const isMac = typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform);

/**
 * Calls `onPressed` when exactly the given keys are pressed together, as `useShortcut(focus, 'mod', 'f')`,
 * keeping the browser from doing its own thing with them. Pass `null` to stop listening for a while
 */
export default function useShortcut(onPressed: ((e: KeyboardEvent) => void) | null, ...keysPressed: Array<Modifier | (string & {})>) {
    // Kept on a ref, so a new function on every render doesn't listen again
    const handlerRef = useRef(onPressed);
    handlerRef.current = onPressed;
    const enabled = onPressed !== null;
    const combination = keysPressed.map(k => k.toLowerCase()).join('+');

    useEffect(() => {
        if (!enabled) return;
        const keys = combination.split('+');
        const wanted = (modifier: Modifier) => keys.includes(modifier);
        const ctrl = wanted('ctrl') || (wanted('mod') && !isMac);
        const meta = wanted('meta') || (wanted('mod') && isMac);
        const key = keys.find(k => !MODIFIERS.includes(k as Modifier));

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.ctrlKey !== ctrl || e.metaKey !== meta || e.shiftKey !== wanted('shift') || e.altKey !== wanted('alt')) return;
            if (key && e.key.toLowerCase() !== key) return;
            e.preventDefault();
            handlerRef.current?.(e);
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [enabled, combination]);
}
