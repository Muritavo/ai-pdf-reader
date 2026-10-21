export type Rgba = { r: number; g: number; b: number; a: number };

/** Reads a computed color, as "rgb(1, 2, 3)" or "rgba(1, 2, 3, 0.5)". Undefined for anything else, as "none" */
export function parseColor(value: string | null | undefined): Rgba | undefined {
    const match = value?.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/);
    if (!match) return undefined;
    const alpha = match[4] === undefined ? 1 : match[4].endsWith('%') ? Number.parseFloat(match[4]) / 100 : Number(match[4]);
    return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: alpha };
}

/** The relative luminance of WCAG, from 0 (black) to 1 (white) */
export function luminance({ r, g, b }: Rgba) {
    const channel = (value: number) => {
        const v = value / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

const contrastRatio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/** Black or white, whichever reads better over the background */
export function readableTextOn(background: Rgba) {
    const behind = luminance(background);
    return contrastRatio(behind, 0) >= contrastRatio(behind, 1) ? '#000000' : '#ffffff';
}

/** Puts a translucent color over what is behind it, as the eye sees it */
export function blend(front: Rgba, back: Rgba): Rgba {
    const mix = (f: number, b: number) => f * front.a + b * (1 - front.a);
    return { r: mix(front.r, back.r), g: mix(front.g, back.g), b: mix(front.b, back.b), a: 1 };
}

const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };

/** The background an element is drawn over on the page: the first one, going up, that is not transparent */
export function pageBackgroundOf(element: Element): Rgba {
    for (let current: Element | null = element; current; current = current.parentElement) {
        const color = parseColor(getComputedStyle(current).backgroundColor);
        if (color && color.a > 0) return color.a < 1 && current.parentElement ? blend(color, pageBackgroundOf(current.parentElement)) : color;
    }
    return WHITE;
}
