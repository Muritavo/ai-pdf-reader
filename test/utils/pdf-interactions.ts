import { expect, type Page } from '@playwright/test';
import { TestIds } from '../../src/testids';
import { byId } from './app';

/**
 * Selects a word (or any part of it when `whole` is false) inside the text layer and releases the mouse over the preview,
 * which is what opens the features menu for a real selection.
 */
export async function selectWord(page: Page, word: string, occurrence = 0, whole = true) {
    await page.evaluate(
        ({ word, occurrence, whole, ids }) => {
            const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const expression = new RegExp(whole ? `(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])` : escaped, 'giu');
            let seen = 0;
            for (const layer of document.querySelectorAll(`[data-testid="${ids.textLayer}"]`)) {
                const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
                for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
                    expression.lastIndex = 0;
                    for (let match = expression.exec(node.data); match; match = expression.exec(node.data)) {
                        if (seen++ !== occurrence) continue;
                        // Like a user, scrolls to the word before selecting it, so its menu appears on screen
                        node.parentElement!.scrollIntoView({ block: 'center' });
                        const range = document.createRange();
                        range.setStart(node, match.index);
                        range.setEnd(node, match.index + word.length);
                        const selection = window.getSelection()!;
                        selection.removeAllRanges();
                        selection.addRange(range);
                        document.querySelector(`[data-testid="${ids.box}"]`)!.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                        return;
                    }
                }
            }
            throw new Error(`Could not find the word "${word}" (occurrence ${occurrence})`);
        },
        { word, occurrence, whole, ids: { textLayer: TestIds.preview.textLayer, box: TestIds.preview.box } },
    );
    await expect(byId(page, TestIds.menu.root)).toBeVisible();
}

/** The page rectangle of the current selection */
export const selectionRect = (page: Page) =>
    page.evaluate(() => {
        const { left, top, width, height } = window.getSelection()!.getRangeAt(0).getBoundingClientRect();
        return { left, top, width, height };
    });

export const boxRect = (page: Page) =>
    byId(page, TestIds.preview.box).evaluate(box => {
        const { left, top, width, height } = box.getBoundingClientRect();
        return { left, top, width, height, scrollTop: box.scrollTop, scrollHeight: box.scrollHeight, clientHeight: box.clientHeight };
    });

/** The marker position as the page coordinates of its center */
export const centerOf = (page: Page, testId: string, index = 0) =>
    byId(page, testId)
        .nth(index)
        .evaluate(marker => {
            const { left, top, width, height } = marker.getBoundingClientRect();
            return { x: left + width / 2, y: top + height / 2, width, height };
        });

/** Reads a value saved by the preview for the document, like the last click or the points of interest */
export const readStored = <T>(page: Page, prefix: string): Promise<T | undefined> =>
    page.evaluate(prefix => {
        const key = Object.keys(localStorage).find(k => k.startsWith(prefix));
        return key ? JSON.parse(localStorage.getItem(key)!) : undefined;
    }, prefix);

export const menuItem = (page: Page, testId: string) => byId(page, testId);
