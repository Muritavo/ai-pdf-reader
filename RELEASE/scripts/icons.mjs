// Renders the app icon (src/assets/icon.svg) for every packaged target:
// - build/icon.png, from which electron-builder derives the mac .icns, windows .ico and linux icons
// - the Android launcher mipmaps (legacy, round and adaptive foreground)
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = await readFile(join(root, '../src/assets/icon.svg'), 'utf8');

const BACKGROUND = '<rect width="512" height="512" rx="96" fill="url(#bg)"/>';
if (!svg.includes(BACKGROUND)) throw new Error('icon.svg background rect not found');

const variants = {
    full: svg,
    round: svg.replace(BACKGROUND, '<circle cx="256" cy="256" r="256" fill="url(#bg)"/>'),
    // Adaptive icons draw the background from ic_launcher_background, so only the symbols are kept
    foreground: svg.replace(BACKGROUND, ''),
};

async function render(variant, size, out) {
    await mkdir(dirname(out), { recursive: true });
    await sharp(Buffer.from(variants[variant]), { density: (72 * size) / 512 })
        .resize(size, size)
        .png()
        .toFile(out);
}

/** Renders the foreground inside the adaptive icon safe zone (66dp of the 108dp canvas) */
async function renderForeground(size, out) {
    const inner = Math.round((size * 66) / 108);
    const symbols = await sharp(Buffer.from(variants.foreground), { density: (72 * inner) / 512 })
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

console.log('Icons rendered');
