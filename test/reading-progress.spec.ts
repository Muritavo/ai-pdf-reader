import { test, expect } from './utils/fixtures';
import { articleCard, attachPdf, attachValidPdf, byId, openPreview, startWithReferences } from './utils/app';
import { buildCsv, sampleArticles, STANDARD_COLUMNS } from './utils/csv';
import { pdfFile, SAMPLE_PAGES, samplePdf } from './utils/pdf';
import { TestIds } from '../src/testids';
import type { Page } from '@playwright/test';

const readProgress = (page: Page, title = 'Article 1') => articleCard(page, title).getByTestId(TestIds.fullTexts.readProgress);
const lastOpening = (page: Page, title = 'Article 1') => articleCard(page, title).getByTestId(TestIds.fullTexts.lastOpening);
const lastOpeningPercent = async (page: Page) => Number(await lastOpening(page).getAttribute('data-progress'));

/** Leaves the document by clicking outside it, and waits for it to be gone */
async function closePreview(page: Page) {
    await page.mouse.click(2, 2);
    await expect(byId(page, TestIds.preview.box)).toHaveCount(0);
}

const shownPercent = async (page: Page) => Number(await readProgress(page).getAttribute('data-progress'));

/** Scrolls the document like a reader, to a point from 0 (top) to 1 (bottom) */
const scrollTo = (page: Page, point: number) =>
    byId(page, TestIds.preview.box).evaluate((box, point) => {
        box.scrollTo(0, (box.scrollHeight - box.clientHeight) * point);
    }, point);

/** How much the reader has reached, as the box shows it right now */
const reached = (page: Page) =>
    byId(page, TestIds.preview.box).evaluate(box => ((box.scrollTop + box.clientHeight) / box.scrollHeight) * 100);

test.beforeEach(async ({ page }) => {
    await startWithReferences(page, buildCsv(STANDARD_COLUMNS, sampleArticles(2)));
    await attachValidPdf(articleCard(page, 'Article 1'), samplePdf());
});

test.describe('reading progress', () => {
    test('is not shown before the document is opened', async ({ page }) => {
        await expect(readProgress(page)).toHaveCount(0);
    });

    test('shows what was reached just by opening the document', async ({ page }) => {
        await openPreview(page, articleCard(page, 'Article 1'), SAMPLE_PAGES.length);

        await expect(readProgress(page)).toHaveAttribute('data-complete', 'false');
        await expect(readProgress(page)).toContainText('% lido');
        // Only the start of the first page is on the screen
        expect(await shownPercent(page)).toBeGreaterThan(0);
        expect(await shownPercent(page)).toBeLessThan(50);
    });

    test('follows the scrolling', async ({ page }) => {
        await openPreview(page, articleCard(page, 'Article 1'), SAMPLE_PAGES.length);

        await scrollTo(page, 0.5);

        const expected = await reached(page);
        await expect.poll(() => shownPercent(page)).toBeGreaterThanOrEqual(Math.round(expected) - 1);
        await expect.poll(() => shownPercent(page)).toBeLessThanOrEqual(Math.round(expected) + 1);
        await expect(readProgress(page)).toHaveAttribute('data-complete', 'false');
    });

    test('shows the document was read to the end', async ({ page }) => {
        await openPreview(page, articleCard(page, 'Article 1'), SAMPLE_PAGES.length);

        await scrollTo(page, 1);

        await expect(readProgress(page)).toHaveAttribute('data-complete', 'true');
        await expect(readProgress(page)).toHaveText('✓ Lido até o fim');
    });

    test('keeps the furthest point when scrolling back', async ({ page }) => {
        await openPreview(page, articleCard(page, 'Article 1'), SAMPLE_PAGES.length);
        await scrollTo(page, 0.6);
        // Reaching 60% of the scroll, plus the screen that is shown, is past the middle of the document
        await expect.poll(() => shownPercent(page)).toBeGreaterThan(55);
        const furthest = await shownPercent(page);

        await scrollTo(page, 0);
        await page.waitForTimeout(300);

        expect(await shownPercent(page)).toBe(furthest);
    });

    test('keeps that the document was read to the end after scrolling back and reloading', async ({ page }) => {
        await openPreview(page, articleCard(page, 'Article 1'), SAMPLE_PAGES.length);
        await scrollTo(page, 1);
        await expect(readProgress(page)).toHaveAttribute('data-complete', 'true');
        await scrollTo(page, 0);

        await page.reload();

        await expect(readProgress(page)).toHaveAttribute('data-complete', 'true');
    });

    test('keeps the progress of each document on its own', async ({ page }) => {
        await openPreview(page, articleCard(page, 'Article 1'), SAMPLE_PAGES.length);
        await scrollTo(page, 1);
        await expect(readProgress(page)).toHaveAttribute('data-complete', 'true');
        await page.mouse.click(2, 2);
        const second = articleCard(page, 'Article 2');
        await attachValidPdf(second, pdfFile('other.pdf', [['Another document'], ['With two pages']]));

        await expect(readProgress(page, 'Article 2')).toHaveCount(0);
        await openPreview(page, second, 2);

        await expect(readProgress(page, 'Article 2')).toHaveAttribute('data-complete', 'false');
        await expect(readProgress(page, 'Article 1')).toHaveAttribute('data-complete', 'true');
    });

    test('is not shown for an article without a PDF', async ({ page }) => {
        await expect(readProgress(page, 'Article 2')).toHaveCount(0);
    });

    test('does not count a PDF that was replaced by another document as read', async ({ page }) => {
        const card = articleCard(page, 'Article 1');
        await openPreview(page, card, SAMPLE_PAGES.length);
        await scrollTo(page, 1);
        await expect(readProgress(page)).toHaveAttribute('data-complete', 'true');
        await page.mouse.click(2, 2);

        await attachPdf(card, pdfFile('replacement.pdf', [['A new document'], ['Not read yet']]));

        await expect(card).toContainText('replacement.pdf');
        await expect(readProgress(page)).toHaveCount(0);
    });
});

test.describe('progress at the last opening', () => {
    test('is not shown before the document was left', async ({ page }) => {
        await expect(lastOpening(page)).toHaveCount(0);

        await openPreview(page, articleCard(page, 'Article 1'), SAMPLE_PAGES.length);
        await scrollTo(page, 0.5);

        // It is the end of an opening, so it waits for the document to be left
        await expect(lastOpening(page)).toHaveCount(0);
    });

    test('shows where the reader stopped when the document is left', async ({ page }) => {
        await openPreview(page, articleCard(page, 'Article 1'), SAMPLE_PAGES.length);
        await scrollTo(page, 0.5);
        await expect.poll(() => shownPercent(page)).toBeGreaterThan(40);
        const stoppedAt = Math.round(await reached(page));

        await closePreview(page);

        await expect(lastOpening(page)).toContainText('% na última abertura');
        expect(Math.abs((await lastOpeningPercent(page)) - stoppedAt)).toBeLessThanOrEqual(1);
    });

    test('goes back when the reader stops earlier, while the furthest point stays', async ({ page }) => {
        const card = articleCard(page, 'Article 1');
        await openPreview(page, card, SAMPLE_PAGES.length);
        await scrollTo(page, 1);
        await expect(readProgress(page)).toHaveAttribute('data-complete', 'true');
        await closePreview(page);
        expect(await lastOpeningPercent(page)).toBeGreaterThanOrEqual(99);

        await openPreview(page, card, SAMPLE_PAGES.length);
        await scrollTo(page, 0);
        await closePreview(page);

        // Stopped near the top this time, and yet the document was read to the end before
        expect(await lastOpeningPercent(page)).toBeLessThan(50);
        await expect(readProgress(page)).toHaveAttribute('data-complete', 'true');
    });

    test('keeps the previous value while the document is open again', async ({ page }) => {
        const card = articleCard(page, 'Article 1');
        await openPreview(page, card, SAMPLE_PAGES.length);
        await scrollTo(page, 0.4);
        await closePreview(page);
        const previous = await lastOpeningPercent(page);

        await openPreview(page, card, SAMPLE_PAGES.length);
        await scrollTo(page, 1);
        await expect(readProgress(page)).toHaveAttribute('data-complete', 'true');

        expect(await lastOpeningPercent(page)).toBe(previous);
    });

    test('is kept after reloading', async ({ page }) => {
        await openPreview(page, articleCard(page, 'Article 1'), SAMPLE_PAGES.length);
        await scrollTo(page, 0.5);
        await closePreview(page);
        const stoppedAt = await lastOpeningPercent(page);

        await page.reload();

        expect(await lastOpeningPercent(page)).toBe(stoppedAt);
    });

    test('saves where the reader stopped when the page is left with the document open', async ({ page }) => {
        await openPreview(page, articleCard(page, 'Article 1'), SAMPLE_PAGES.length);
        await scrollTo(page, 0.5);
        await expect.poll(() => shownPercent(page)).toBeGreaterThan(40);
        const stoppedAt = Math.round(await reached(page));

        await page.reload();

        expect(Math.abs((await lastOpeningPercent(page)) - stoppedAt)).toBeLessThanOrEqual(1);
    });

    test('is not shown for a PDF that was replaced', async ({ page }) => {
        const card = articleCard(page, 'Article 1');
        await openPreview(page, card, SAMPLE_PAGES.length);
        await closePreview(page);
        await expect(lastOpening(page)).toBeVisible();

        await attachPdf(card, pdfFile('replacement.pdf', [['A new document'], ['Not read yet']]));

        await expect(card).toContainText('replacement.pdf');
        await expect(lastOpening(page)).toHaveCount(0);
    });
});

test.describe('both progress on the same bar', () => {
    const bar = (page: Page) => articleCard(page, 'Article 1').getByTestId(TestIds.fullTexts.readBar);
    const furthestFill = (page: Page) => articleCard(page, 'Article 1').getByTestId(TestIds.fullTexts.readBarProgress);
    const lastOpeningFill = (page: Page) => articleCard(page, 'Article 1').getByTestId(TestIds.fullTexts.readBarLastOpening);
    const readLine = (page: Page) => articleCard(page, 'Article 1').getByTestId(TestIds.fullTexts.readLine);

    test('draws the last opening in red over the furthest point in blue, on a single bar', async ({ page }) => {
        const card = articleCard(page, 'Article 1');
        await openPreview(page, card, SAMPLE_PAGES.length);
        await scrollTo(page, 0.8);
        await expect.poll(() => shownPercent(page)).toBeGreaterThan(70);
        await closePreview(page);
        await openPreview(page, card, SAMPLE_PAGES.length);
        await scrollTo(page, 0);
        await expect.poll(() => reached(page)).toBeLessThan(40);
        await closePreview(page);

        await expect(card.getByTestId(TestIds.fullTexts.readBar)).toHaveCount(1);
        const [track, blue, red] = await Promise.all([bar(page).boundingBox(), furthestFill(page).boundingBox(), lastOpeningFill(page).boundingBox()]);
        // Both start together at the same place, one over the other
        expect(red!.x).toBeCloseTo(blue!.x, 0);
        expect(red!.y).toBeCloseTo(blue!.y, 0);
        expect(red!.height).toBeCloseTo(blue!.height, 0);
        // The last opening is behind the furthest point, so the blue shows beyond the red
        await expect.poll(async () => (await lastOpeningFill(page).boundingBox())!.width).toBeLessThan(blue!.width);
        // The bars animate to their values, so they are measured once they get there
        await expect
            .poll(async () => (await furthestFill(page).boundingBox())!.width / track!.width)
            .toBeCloseTo((await shownPercent(page)) / 100, 1);
        await expect
            .poll(async () => (await lastOpeningFill(page).boundingBox())!.width / track!.width)
            .toBeCloseTo((await lastOpeningPercent(page)) / 100, 1);
    });

    test('has the red one on top, so it is seen where both are', async ({ page }) => {
        const card = articleCard(page, 'Article 1');
        await openPreview(page, card, SAMPLE_PAGES.length);
        await scrollTo(page, 1);
        await expect(readProgress(page)).toHaveAttribute('data-complete', 'true');
        await closePreview(page);
        await openPreview(page, card, SAMPLE_PAGES.length);
        await scrollTo(page, 0.3);
        await closePreview(page);

        const topmost = await lastOpeningFill(page).evaluate(red => {
            const { left, top, width, height } = red.getBoundingClientRect();
            return document.elementFromPoint(left + width / 2, top + height / 2)?.getAttribute('data-testid');
        });
        expect(topmost).toBe(TestIds.fullTexts.readBarLastOpening);
        // And the colors are the ones of each
        await expect(lastOpeningFill(page)).toHaveCSS('background-color', 'rgb(255, 107, 107)');
        await expect(furthestFill(page)).toHaveCSS('background-color', 'rgb(76, 195, 138)');
    });

    test('reads the last opening text, then the progress text, on the same line', async ({ page }) => {
        const card = articleCard(page, 'Article 1');
        await openPreview(page, card, SAMPLE_PAGES.length);
        await scrollTo(page, 0.5);
        await closePreview(page);
        await openPreview(page, card, SAMPLE_PAGES.length);
        await scrollTo(page, 0.9);
        await expect.poll(() => shownPercent(page)).toBeGreaterThan(80);
        await closePreview(page);

        await expect(readLine(page)).toHaveText(/^\d+% na última abertura\s*\/\s*\d+% lido$/);
        const [last, progress] = await Promise.all([lastOpening(page).boundingBox(), readProgress(page).boundingBox()]);
        expect(last!.x).toBeLessThan(progress!.x);
        expect(last!.y).toBeCloseTo(progress!.y, 0);
    });

    test('reads the last opening text with the end of the document when it was read to the end', async ({ page }) => {
        const card = articleCard(page, 'Article 1');
        await openPreview(page, card, SAMPLE_PAGES.length);
        await scrollTo(page, 1);
        await expect(readProgress(page)).toHaveAttribute('data-complete', 'true');
        await scrollTo(page, 0.2);
        await closePreview(page);

        await expect(readLine(page)).toHaveText(/^\d+% na última abertura\s*\/\s*✓ Lido até o fim$/);
    });

    test('shows only the progress, without the last opening, while the document is still on its first opening', async ({ page }) => {
        await openPreview(page, articleCard(page, 'Article 1'), SAMPLE_PAGES.length);
        await scrollTo(page, 0.5);

        await expect(readLine(page)).toHaveText(/^\d+% lido$/);
        await expect(lastOpeningFill(page)).toHaveCount(0);
        await expect(furthestFill(page)).toHaveCount(1);
    });
});
