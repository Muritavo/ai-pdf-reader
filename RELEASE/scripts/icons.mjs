// Renders the app icon (src/assets/icon.svg) for every packaged target:
// - build/icon.png, from which electron-builder derives the mac .icns, windows .ico and linux icons
// - the Android launcher mipmaps (legacy, round and adaptive foreground)
// - the visionOS layered icon: background, brush strokes and symbols apart, which visionOS stacks with depth
//   (parallax, shadows) and masks to a circle
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = await readFile(join(root, '../src/assets/icon.svg'), 'utf8');

const BACKGROUND = '<rect width="512" height="512" rx="96" fill="url(#bg)"/>';
if (!svg.includes(BACKGROUND)) throw new Error('icon.svg background rect not found');

// The visionOS layers are cut out of the svg by its sections
const DEFS_END = '</defs>';
const STROKES = '<!-- Brush strokes';
const SYMBOLS = '<g fill="none" stroke="#eef5f0"';
for (const marker of [DEFS_END, STROKES, SYMBOLS]) if (!svg.includes(marker)) throw new Error(`icon.svg section not found: ${marker}`);
const head = svg.slice(0, svg.indexOf(DEFS_END) + DEFS_END.length);

const variants = {
    full: svg,
    round: svg.replace(BACKGROUND, '<circle cx="256" cy="256" r="256" fill="url(#bg)"/>'),
    // Adaptive icons draw the background from ic_launcher_background, so only the symbols are kept
    foreground: svg.replace(BACKGROUND, ''),
    // visionOS layers: the background squared (visionOS masks it), then the strokes, then the symbols and brain
    background: `${head}<rect width="512" height="512" fill="url(#bg)"/></svg>`,
    strokes: `${head}${svg.slice(svg.indexOf(STROKES), svg.indexOf(SYMBOLS))}</svg>`,
    symbols: `${head}${svg.slice(svg.indexOf(SYMBOLS))}`,
};

async function render(variant, size, out) {
    await mkdir(dirname(out), { recursive: true });
    const image = sharp(Buffer.from(variants[variant]), { density: (72 * size) / 512 }).resize(size, size);
    // visionOS wants its background layer opaque
    await (variant === 'background' ? image.removeAlpha() : image).png().toFile(out);
}

/** Renders the foreground scaled to `fraction` of the canvas, centered (the adaptive icon safe zone is 66dp of 108dp) */
async function renderForeground(size, out, fraction = 66 / 108, variant = 'foreground') {
    const inner = Math.round(size * fraction);
    const symbols = await sharp(Buffer.from(variants[variant]), { density: (72 * inner) / 512 })
        .resize(inner, inner)
        .png()
        .toBuffer();
    await sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: symbols, gravity: 'center' }])
        .png()
        .toFile(out);
}

await render('full', 1024, join(root, 'build/icon.png'));

const res = join(root, 'android/app/src/main/res');
const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [density, scale] of Object.entries(densities)) {
    const dir = join(res, `mipmap-${density}`);
    await render('full', 48 * scale, join(dir, 'ic_launcher.png'));
    await render('round', 48 * scale, join(dir, 'ic_launcher_round.png'));
    await renderForeground(108 * scale, join(dir, 'ic_launcher_foreground.png'));
}

// visionOS: the circle mask clips the corners, so the symbols are kept within it
const vision = join(root, '../visionos/ResearchToolkit/Assets.xcassets/AppIcon.solidimagestack');
await render('background', 1024, join(vision, 'Back.solidimagestacklayer/Content.imageset/back.png'));
await renderForeground(1024, join(vision, 'Middle.solidimagestacklayer/Content.imageset/middle.png'), 0.88, 'strokes');
await renderForeground(1024, join(vision, 'Front.solidimagestacklayer/Content.imageset/front.png'), 0.88, 'symbols');

console.log('Icons rendered');
