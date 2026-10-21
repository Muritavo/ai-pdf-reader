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
            // Every piece of text of a line is looked at together, as highlights split a line in many nodes
            for (const line of document.querySelectorAll(`[data-testid="${ids.textLayer}"] span`)) {
                const nodes: Text[] = [];
                const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
                for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) nodes.push(node);
                const text = nodes.map(node => node.data).join('');
                expression.lastIndex = 0;
                for (let match = expression.exec(text); match; match = expression.exec(text)) {
                    if (seen++ !== occurrence) continue;
                    const pointAt = (offset: number, isEnd: boolean) => {
                        let passed = 0;
                        for (const node of nodes) {
                            const reaches = isEnd ? offset <= passed + node.length : offset < passed + node.length;
                            if (reaches) return { node, offset: offset - passed };
                            passed += node.length;
                        }
                        const last = nodes[nodes.length - 1];
                        return { node: last, offset: last.length };
                    };
                    const start = pointAt(match.index, false);
                    const end = pointAt(match.index + match[0].length, true);
                    // Like a user, scrolls to the word before selecting it, so its menu appears on screen
                    start.node.parentElement!.scrollIntoView({ block: 'center' });
                    const range = document.createRange();
                    range.setStart(start.node, start.offset);
                    range.setEnd(end.node, end.offset);
                    const selection = window.getSelection()!;
                    selection.removeAllRanges();
                    selection.addRange(range);
                    document.querySelector(`[data-testid="${ids.box}"]`)!.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                    return;
                }
            }
            throw new Error(`Could not find the word "${word}" (occurrence ${occurrence})`);
        },
        { word, occurrence, whole, ids: { textLayer: TestIds.preview.textLayer, box: TestIds.preview.box } },
    );
    await expect(byId(page, TestIds.menu.root)).toBeVisible();
}

/**
 * Selects from a word of one line to a word of another one, like dragging the mouse across lines,
 * and releases the mouse over the preview. The start is the last time `start.word` is on its line.
 */
export async function selectAcross(page: Page, start: { line: string; word: string }, end: { line: string; word: string }) {
    await page.evaluate(
        ({ start, end, ids }) => {
            const lines = [...document.querySelectorAll<HTMLElement>(`[data-testid="${ids.textLayer}"] span`)];
            const pointIn = (line: HTMLElement, offset: number) => {
                const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
                let passed = 0;
                for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
                    if (offset <= passed + node.length) return { node, offset: offset - passed };
                    passed += node.length;
                }
                throw new Error('Offset out of the line');
            };
            const startLine = lines.find(line => line.textContent!.includes(start.line));
            const endLine = lines.find(line => line !== startLine && line.textContent!.includes(end.line));
            if (!startLine || !endLine) throw new Error(`Could not find the lines "${start.line}" and "${end.line}"`);
            const from = pointIn(startLine, startLine.textContent!.lastIndexOf(start.word));
            const to = pointIn(endLine, endLine.textContent!.indexOf(end.word) + end.word.length);
            startLine.scrollIntoView({ block: 'center' });
            const range = document.createRange();
            range.setStart(from.node, from.offset);
            range.setEnd(to.node, to.offset);
            const selection = window.getSelection()!;
            selection.removeAllRanges();
            selection.addRange(range);
            document.querySelector(`[data-testid="${ids.box}"]`)!.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        },
        { start, end, ids: { textLayer: TestIds.preview.textLayer, box: TestIds.preview.box } },
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
