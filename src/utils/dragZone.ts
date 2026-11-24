import type { MouseEvent } from 'react';
import type { ImageBox } from './pageImages';

/** The smallest side (in pixels of the screen) a zone drawn by hand has to be a zone */
const MIN_ZONE_SIDE = 12;
/** How close (in pixels) to the top or the bottom of what is seen the mouse starts scrolling while drawing a zone */
const ZONE_SCROLL_EDGE = 60;
/** The most pixels scrolled at each frame while drawing a zone, with the mouse on (or past) the edge */
const ZONE_SCROLL_SPEED = 24;

type Point = { clientX: number; clientY: number };

/**
 * Alt + drag on an element draws a zone over it, given as fractions of its size.
 * `onChange` follows the mouse; `onDrop` gets the zone, or nothing when it was too small (an Alt + click, not a drag).
 * With a `scroller`, held near its top or its bottom (or past it) it scrolls, faster the closer to the edge,
 * so a zone can be taller than what is seen. Returns false when it was not an Alt + drag.
 */
export function dragZone(
    e: MouseEvent<HTMLElement>,
    { scroller, onChange, onDrop }: { scroller?: HTMLElement | null; onChange: (box: ImageBox) => void; onDrop: (box?: ImageBox) => void },
) {
    if (!e.altKey || e.button !== 0) return false;
    // Draws instead of selecting text
    e.preventDefault();
    const wrapper = e.currentTarget;
    (wrapper.ownerDocument.defaultView ?? window).getSelection()?.removeAllRanges();
    const at = (event: Point) => {
        const rect = wrapper.getBoundingClientRect();
        return {
            x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
            y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
        };
    };
    const start = at(e);
    const boxTo = (event: Point): ImageBox => {
        const end = at(event);
        return {
            left: Math.min(start.x, end.x),
            top: Math.min(start.y, end.y),
            width: Math.abs(end.x - start.x),
            height: Math.abs(end.y - start.y),
        };
    };
    // Where the mouse is, kept for when the element scrolls under it without the mouse moving
    let pointer: Point = { clientX: e.clientX, clientY: e.clientY };
    const update = () => onChange(boxTo(pointer));
    const move = (event: globalThis.MouseEvent) => {
        pointer = { clientX: event.clientX, clientY: event.clientY };
        update();
    };
    let frame = 0;
    const autoScroll = () => {
        if (scroller) {
            const { top, bottom } = scroller.getBoundingClientRect();
            const into = (distance: number) => Math.min(1, Math.max(0, 1 - distance / ZONE_SCROLL_EDGE));
            const speed = ZONE_SCROLL_SPEED * (into(bottom - pointer.clientY) - into(pointer.clientY - top));
            if (speed) scroller.scrollTop += speed;
        }
        frame = requestAnimationFrame(autoScroll);
    };
    if (scroller) {
        frame = requestAnimationFrame(autoScroll);
        scroller.addEventListener('scroll', update, { passive: true });
    }
    const drop = (event: globalThis.MouseEvent) => {
        window.removeEventListener('mousemove', move);
        cancelAnimationFrame(frame);
        scroller?.removeEventListener('scroll', update);
        const box = boxTo(event);
        const { width, height } = wrapper.getBoundingClientRect();
        const isZone = box.width * width >= MIN_ZONE_SIDE && box.height * height >= MIN_ZONE_SIDE;
        onDrop(isZone ? box : undefined);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', drop, { once: true });
    return true;
}
