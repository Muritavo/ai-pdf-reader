/** Where an image is on a page, as fractions (0 to 1) of the width and the height of the page */
export type ImageBox = { left: number; top: number; width: number; height: number };

/** Smaller than this (on either side) is a logo or an icon, not a figure */
const MIN_SIDE = 0.04;
/** Covering almost all the page is a scanned page, not a figure, and would cover its text */
const MAX_AREA = 0.9;

/**
 * The images pdf.js recorded while drawing a page (`recordImages`): 6 numbers for each one,
 * three of its corners (top left, bottom left and top right) as fractions of the page
 */
export function imageBoxesOf(coordinates: ArrayLike<number> | null | undefined): ImageBox[] {
    if (!coordinates) return [];
    const boxes: ImageBox[] = [];
    const seen = new Set<string>();
    for (let i = 0; i + 5 < coordinates.length; i += 6) {
        const [x1, y1, x2, y2, x3, y3] = Array.from({ length: 6 }, (_, j) => coordinates[i + j]);
        // The fourth corner closes the parallelogram, as the image may be rotated
        const xs = [x1, x2, x3, x2 + x3 - x1];
        const ys = [y1, y2, y3, y2 + y3 - y1];
        const left = Math.max(0, Math.min(...xs));
        const top = Math.max(0, Math.min(...ys));
        const width = Math.min(1, Math.max(...xs)) - left;
        const height = Math.min(1, Math.max(...ys)) - top;
        if (width < MIN_SIDE || height < MIN_SIDE || width * height > MAX_AREA) continue;
        // The same image can be drawn more than once at the same place
        const key = [left, top, width, height].map(value => value.toFixed(3)).join();
        if (seen.has(key)) continue;
        seen.add(key);
        boxes.push({ left, top, width, height });
    }
    return boxes;
}

/** The longest side the image is sent to the AI with, so it is sharp but not huge */
const MAX_SIDE = 1280;

/** Cuts the image out of the page already drawn on the canvas, as a PNG data URL */
export function cropImage(canvas: HTMLCanvasElement, box: ImageBox) {
    const sx = box.left * canvas.width;
    const sy = box.top * canvas.height;
    const sw = box.width * canvas.width;
    const sh = box.height * canvas.height;
    const scale = Math.min(1, MAX_SIDE / Math.max(sw, sh));
    const crop = document.createElement('canvas');
    crop.width = Math.max(1, Math.round(sw * scale));
    crop.height = Math.max(1, Math.round(sh * scale));
    crop.getContext('2d')!.drawImage(canvas, sx, sy, sw, sh, 0, 0, crop.width, crop.height);
    return crop.toDataURL('image/png');
}
