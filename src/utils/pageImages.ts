import { OPS, type PageViewport } from 'pdfjs-dist';
import type { PDFOperatorList, TextContent } from 'pdfjs-dist/types/src/display/api';

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

/** Paths closer than this (in points of the page) are drawn as parts of the same figure */
const FIGURE_GAP = 6;
/** Fewer paths than this together are a rule, a box or an underline, not a figure */
const MIN_FIGURE_PATHS = 10;
/** Thinner than this (in points) is a line, as the rules of a table */
const LINE_WIDTH = 1.5;
/** Made almost only of lines is a table, not a figure */
const MAX_LINES_SHARE = 0.9;
/** Text at least this long (without spaces) is a line of the body or of a caption; shorter, the label of a figure */
const MIN_BODY_TEXT = 30;

type Rect = { x0: number; y0: number; x1: number; y1: number; paths: number; lines: number };

const near = (a: Rect, b: Rect) =>
    b.x0 <= a.x1 + FIGURE_GAP && a.x0 <= b.x1 + FIGURE_GAP && b.y0 <= a.y1 + FIGURE_GAP && a.y0 <= b.y1 + FIGURE_GAP;

const join = (a: Rect, b: Rect): Rect => ({
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
    paths: a.paths + b.paths,
    lines: a.lines + b.lines,
});

type Matrix = [number, number, number, number, number, number];
const multiply = (m: Matrix, n: ArrayLike<number>): Matrix => [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
];

/**
 * The figures drawn as vectors (lines, curves and fills), which pdf.js doesn't record as images:
 * the paths painted close to each other, or with no text between them, grouped, as fractions of the page like {@link imageBoxesOf}
 */
export function vectorFigureBoxesOf(operatorList: PDFOperatorList, textContent: TextContent, viewport: PageViewport): ImageBox[] {
    const { fnArray, argsArray } = operatorList;
    let matrix: Matrix = [1, 0, 0, 1, 0, 0];
    const saved: Matrix[] = [];
    const groups: Rect[] = [];
    let current: Rect | undefined;
    const pageArea = viewport.width * viewport.height;

    for (let i = 0; i < fnArray.length; i++) {
        const args = argsArray[i];
        switch (fnArray[i]) {
            case OPS.save:
                saved.push(matrix);
                break;
            case OPS.restore:
                matrix = saved.pop() ?? matrix;
                break;
            case OPS.transform:
                matrix = multiply(matrix, args);
                break;
            case OPS.paintFormXObjectBegin:
                saved.push(matrix);
                if (args?.[0]) matrix = multiply(matrix, args[0]);
                break;
            case OPS.paintFormXObjectEnd:
                matrix = saved.pop() ?? matrix;
                break;
            case OPS.constructPath: {
                // A clipping path paints nothing
                const [paint, , minMax] = args;
                if (paint === OPS.endPath || !minMax || !minMax.every(Number.isFinite)) break;
                const corners = [
                    [minMax[0], minMax[1]],
                    [minMax[2], minMax[1]],
                    [minMax[0], minMax[3]],
                    [minMax[2], minMax[3]],
                ].map(([x, y]) =>
                    viewport.convertToViewportPoint(
                        matrix[0] * x + matrix[2] * y + matrix[4],
                        matrix[1] * x + matrix[3] * y + matrix[5],
                    ),
                );
                const xs = corners.map(([x]) => x);
                const ys = corners.map(([, y]) => y);
                const path = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys), paths: 1, lines: 0 };
                if (path.x1 - path.x0 < LINE_WIDTH || path.y1 - path.y0 < LINE_WIDTH) path.lines = 1;
                // A background behind the whole page
                if ((path.x1 - path.x0) * (path.y1 - path.y0) > MAX_AREA * pageArea) break;
                // A figure is drawn in one go, so each path is first tried with the one before
                if (current && near(current, path)) current = join(current, path);
                else {
                    if (current) groups.push(current);
                    current = path;
                }
                break;
            }
        }
    }
    if (current) groups.push(current);

    const texts = textContent.items.flatMap(item => {
        if (!('transform' in item) || !item.str.trim()) return [];
        const [x0, y0] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
        const [x1, y1] = viewport.convertToViewportPoint(item.transform[4] + item.width, item.transform[5] + item.height);
        const rect = { x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1), paths: 0, lines: 0 };
        return [{ rect, body: item.str.replace(/\s/g, '').length >= MIN_BODY_TEXT }];
    });
    // A short piece on a line of the body (an italic word, the "Fig. 2." of a caption) is body text too
    const lineOf = (rect: Rect) => Math.round((rect.y0 + rect.y1) / 2);
    const bodyLines = new Set(texts.filter(text => text.body).map(({ rect }) => lineOf(rect)));
    for (const text of texts) if ([-1, 0, 1].some(offset => bodyLines.has(lineOf(text.rect) + offset))) text.body = true;
    // The body text (and the captions) between two groups is what keeps two figures (or a figure and a table) apart
    const body = texts.filter(text => text.body).map(({ rect }) => ({ x: (rect.x0 + rect.x1) / 2, y: (rect.y0 + rect.y1) / 2 }));
    const textBetween = (a: Rect, b: Rect) => {
        const box = join(a, b);
        return body.some(({ x, y }) => x > box.x0 && x < box.x1 && y > box.y0 && y < box.y1);
    };

    // The parts of a figure drawn apart, as the panels of a chart, put back together
    let merged = true;
    while (merged) {
        merged = false;
        for (let i = 0; i < groups.length; i++)
            for (let j = i + 1; j < groups.length; j++)
                if (near(groups[i], groups[j]) || !textBetween(groups[i], groups[j])) {
                    groups[i] = join(groups[i], groups[j]);
                    groups.splice(j, 1);
                    // The grown group is tried again with all the others
                    j = i;
                    merged = true;
                }
    }

    // The labels of a figure (its axes, its legend, the letters of its panels) are part of it
    const labels = texts.filter(text => !text.body).map(({ rect }) => rect);
    const figures: Rect[] = groups
        .filter(group => group.paths >= MIN_FIGURE_PATHS && group.lines < MAX_LINES_SHARE * group.paths)
        .map(group => {
            let figure = group;
            let grown = true;
            while (grown) {
                grown = false;
                for (let i = 0; i < labels.length; i++)
                    if (near(figure, labels[i])) {
                        figure = join(figure, labels[i]);
                        labels.splice(i--, 1);
                        grown = true;
                    }
            }
            return figure;
        });
    // Figures grown into each other, with their labels, are one
    for (let i = 0; i < figures.length; i++)
        for (let j = i + 1; j < figures.length; j++) {
            const [a, b] = [figures[i], figures[j]];
            if (a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1) {
                figures[i] = join(a, b);
                figures.splice(j, 1);
                j = i;
            }
        }

    return figures
        .map(group => ({
            left: Math.max(0, group.x0 / viewport.width),
            top: Math.max(0, group.y0 / viewport.height),
            width: Math.min(1, group.x1 / viewport.width) - Math.max(0, group.x0 / viewport.width),
            height: Math.min(1, group.y1 / viewport.height) - Math.max(0, group.y0 / viewport.height),
        }))
        .filter(box => box.width >= MIN_SIDE && box.height >= MIN_SIDE && box.width * box.height <= MAX_AREA);
}

const overlap = (a: ImageBox, b: ImageBox) =>
    a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;

/** The images and the vector figures of a page, as one box where a figure is drawn over (or around) an image */
export function figureBoxesOf(images: ImageBox[], figures: ImageBox[]): ImageBox[] {
    const boxes = [...images];
    for (const figure of figures) {
        const index = boxes.findIndex(box => overlap(box, figure));
        if (index < 0) {
            boxes.push(figure);
            continue;
        }
        const box = boxes[index];
        const left = Math.min(box.left, figure.left);
        const top = Math.min(box.top, figure.top);
        boxes[index] = {
            left,
            top,
            width: Math.max(box.left + box.width, figure.left + figure.width) - left,
            height: Math.max(box.top + box.height, figure.top + figure.height) - top,
        };
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

/** The longest side a whole page is sent to the AI with, larger so the small text of a table can be read */
export const PAGE_MAX_SIDE = 1600;
