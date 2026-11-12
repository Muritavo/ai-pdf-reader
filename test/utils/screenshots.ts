import { expect, type Locator, type Page } from '@playwright/test';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Where every run keeps its screenshots, replacing the ones of the run before */
export const SCREENSHOTS_DIR = fileURLToPath(new URL('../screenshots/', import.meta.url));

/**
 * Saves a screenshot of the state the spec reached, at test/screenshots/<name>.png.
 * With a target, only it is captured (as the dialog); otherwise the whole page
 */
export async function capture(page: Page, name: string, target?: Locator) {
    if (target) await expect(target).toBeVisible();
    // Lets the dialogs finish opening, so the screenshot is not taken mid animation
    await page.waitForTimeout(400);
    const path = `${SCREENSHOTS_DIR}${name}.png`;
    removeOtherNumberings(path);
    await (target ?? page).screenshot({ path, animations: 'disabled' });
}

/** The same screenshot under another number ("09-x.png" once it became "10-x.png"), so the folder keeps only the current order */
function removeOtherNumberings(path: string) {
    const folder = dirname(path);
    const unnumbered = (file: string) => file.replace(/^\d+-/, '');
    const file = path.slice(folder.length + 1);
    mkdirSync(folder, { recursive: true });
    for (const other of readdirSync(folder)) {
        if (other !== file && unnumbered(other) === unnumbered(file)) rmSync(join(folder, other));
    }
}
