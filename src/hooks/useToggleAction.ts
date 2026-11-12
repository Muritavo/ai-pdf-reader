import { useEffect, useState, type RefObject } from 'react';

/** The modifier keys a toggle action stands for */
export type ToggleAction = 'ctrl' | 'alt' | 'shift' | 'meta';

/** The window, with the messages to the native app of the Vision Pro */
type BridgeWindow = Window & { webkit?: { messageHandlers?: Record<string, { postMessage: (body: unknown) => void } | undefined> } };

/**
 * Whether a modifier key is on, wherever it comes from:
 * - the keyboard, while the key is held on the window the element is in
 * - on the Vision Pro, a toggle under the element's AR window, as there may be no keyboard
 */
export default function useToggleAction(action: ToggleAction, elementRef?: RefObject<HTMLElement | null>) {
    const [held, setHeld] = useState(false);
    const [toggled, setToggled] = useState(false);

    useEffect(() => {
        // The window the element is in, which on AR may be a window of its own
        const view = elementRef?.current?.ownerDocument.defaultView ?? window;
        const follow = (e: KeyboardEvent) => setHeld(e[`${action}Key`]);
        // Released out of the window, as by changing to another one, it would stay held
        const release = () => setHeld(false);
        const toggle = (e: Event) => {
            const { detail } = e as CustomEvent<{ action: ToggleAction; on: boolean }>;
            if (detail.action === action) setToggled(detail.on);
        };
        view.addEventListener('keydown', follow);
        view.addEventListener('keyup', follow);
        view.addEventListener('blur', release);
        view.addEventListener('artoggleaction', toggle);
        // On AR, asks for the toggle under the element's window, which dispatches `artoggleaction` on it
        if (view !== window) (window as BridgeWindow).webkit?.messageHandlers?.onARToggleAction?.postMessage({ window: view.name, action });
        return () => {
            view.removeEventListener('keydown', follow);
            view.removeEventListener('keyup', follow);
            view.removeEventListener('blur', release);
            view.removeEventListener('artoggleaction', toggle);
        };
    }, [action, elementRef]);

    return held || toggled;
}
