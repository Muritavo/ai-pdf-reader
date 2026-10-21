import { test, expect } from './utils/fixtures';
import { articleCard, byId, openPreview, startWithReferences } from './utils/app';
import { buildCsv, sampleArticles, STANDARD_COLUMNS } from './utils/csv';
import { attachPdf } from './utils/app';
import { SAMPLE_PAGES, SAMPLE_WORD, SAMPLE_WORD_OCCURRENCES, samplePdf } from './utils/pdf';
import { boxRect, centerOf, readStored, selectionRect, selectWord } from './utils/pdf-interactions';
import { TestIds } from '../src/testids';

type StoredMarker = { x: number; y: number; key: number; word?: string };

test.beforeEach(async ({ page }) => {
    await startWithReferences(page, buildCsv(STANDARD_COLUMNS, sampleArticles(2)));
    const card = articleCard(page, 'Article 1');
    await attachPdf(card, samplePdf());
    await openPreview(page, card, SAMPLE_PAGES.length);
});

const highlights = (page: Parameters<typeof byId>[0]) => byId(page, TestIds.preview.highlight);

test.describe('searching a word on Google', () => {
    test('opens a search for the selected word in a new tab', async ({ page, context }) => {
        await selectWord(page, SAMPLE_WORD);

        const [search] = await Promise.all([context.waitForEvent('page'), byId(page, TestIds.menu.searchOnGoogle).click()]);

        const url = new URL(search.url());
        expect(url.hostname).toBe('www.google.com');
        expect(url.pathname).toBe('/search');
        // The first occurrence is capitalized on the document, and the search keeps what was selected
        expect(url.searchParams.get('q')).toBe('O que significa Proteome?');
        await expect(byId(page, TestIds.menu.root)).toHaveCount(0);
    });
});

test.describe('marking a location', () => {
    test('marks where the selected word is, saving and showing the marker at that position', async ({ page }) => {
        await selectWord(page, SAMPLE_WORD, 1);
        const selection = await selectionRect(page);
        const box = await boxRect(page);

        await byId(page, TestIds.menu.markLocation).click();

        const marker = byId(page, TestIds.preview.pointOfInterest);
        await expect(marker).toHaveCount(1);

        // The position is saved as a percentage of the scrollable document
        const [stored] = (await readStored<StoredMarker[]>(page, 'poi-'))!;
        const expectedX = ((selection.left - box.left) / box.width) * 100;
        const expectedY = ((box.scrollTop + ((selection.top - box.top) / box.height) * box.clientHeight) / box.scrollHeight) * 100;
        expect(stored.x).toBeCloseTo(expectedX, 0);
        expect(stored.y).toBeCloseTo(expectedY, 0);
        expect(stored.word).toBe(SAMPLE_WORD);

        // And the marker is drawn by the line of the selected word
        const center = await centerOf(page, TestIds.preview.pointOfInterest);
        expect(Math.abs(center.y - selection.top)).toBeLessThan(5);
        // Centered on the start of the selection, not beside it
        expect(Math.abs(center.x - selection.left)).toBeLessThan(3);
    });

    test('marks every word on its own place', async ({ page }) => {
        await selectWord(page, SAMPLE_WORD, 0);
        await byId(page, TestIds.menu.markLocation).click();
        await selectWord(page, 'Conclusion');
        await byId(page, TestIds.menu.markLocation).click();

        await expect(byId(page, TestIds.preview.pointOfInterest)).toHaveCount(2);
        const [first, second] = await Promise.all([0, 1].map(i => centerOf(page, TestIds.preview.pointOfInterest, i)));
        // The conclusion is on the last page, way below the first line
        expect(second.y).toBeGreaterThan(first.y + 400);
    });

    test('closes the menu after marking', async ({ page }) => {
        await selectWord(page, SAMPLE_WORD);
        await byId(page, TestIds.menu.markLocation).click();

        await expect(byId(page, TestIds.menu.root)).toHaveCount(0);
    });
});

test.describe('the last click marker', () => {
    test('shows where the document was last clicked, at the click position', async ({ page }) => {
        const line = byId(page, TestIds.preview.textLayer).first().locator('span', { hasText: 'Proteome analysis' });
        const lineBox = (await line.boundingBox())!;
        const click = { x: lineBox.x + 30, y: lineBox.y + lineBox.height / 2 };

        await page.mouse.click(click.x, click.y);

        await expect(byId(page, TestIds.preview.lastClickMarker)).toHaveCount(1);
        const box = await boxRect(page);
        const stored = (await readStored<StoredMarker>(page, 'lastClick-'))!;
        expect(stored.x).toBeCloseTo(((click.x - box.left) / box.width) * 100, 0);
        expect(stored.y).toBeCloseTo(((box.scrollTop + ((click.y - box.top) / box.height) * box.clientHeight) / box.scrollHeight) * 100, 0);

        const center = await centerOf(page, TestIds.preview.lastClickMarker);
        // Centered on the click, not beside it
        expect(Math.abs(center.y - click.y)).toBeLessThan(5);
        expect(Math.abs(center.x - click.x)).toBeLessThan(3);
    });

    test('keeps only the last click', async ({ page }) => {
        const first = byId(page, TestIds.preview.textLayer).first().locator('span', { hasText: 'Proteome analysis' });
        const last = byId(page, TestIds.preview.textLayer).last().locator('span', { hasText: 'Conclusion' });

        await first.click({ position: { x: 5, y: 5 } });
        const firstMarker = await centerOf(page, TestIds.preview.lastClickMarker);
        await last.scrollIntoViewIfNeeded();
        await last.click({ position: { x: 5, y: 5 } });

        await expect(byId(page, TestIds.preview.lastClickMarker)).toHaveCount(1);
        const lastMarker = await centerOf(page, TestIds.preview.lastClickMarker);
        expect(lastMarker.y).not.toBeCloseTo(firstMarker.y, -1);
    });
});

test.describe('highlighting a word', () => {
    test('highlights every instance of the word, counting only the whole words', async ({ page }) => {
        await expect(highlights(page)).toHaveCount(0);

        await selectWord(page, SAMPLE_WORD);
        await byId(page, TestIds.menu.highlight).click();

        // "proteomes" and "acetyl-proteomic" are different words, so they are not highlighted
        await expect(highlights(page)).toHaveCount(SAMPLE_WORD_OCCURRENCES);
        for (const highlight of await highlights(page).all()) {
            expect((await highlight.textContent())!.toLowerCase()).toBe(SAMPLE_WORD);
        }
    });

    test('gives each highlighted word its own color', async ({ page }) => {
        await selectWord(page, SAMPLE_WORD);
        await byId(page, TestIds.menu.highlight).click();
        await selectWord(page, 'group', 0);
        await byId(page, TestIds.menu.highlight).click();

        // "group" is a whole word once, ("groups" is another word)
        await expect(highlights(page)).toHaveCount(SAMPLE_WORD_OCCURRENCES + 1);
        const colors = await highlights(page).evaluateAll(marks => marks.map(m => (m as HTMLElement).style.backgroundColor));
        expect(new Set(colors).size).toBe(2);
    });

    test('keeps the highlights after reloading the page', async ({ page }) => {
        await selectWord(page, SAMPLE_WORD);
        await byId(page, TestIds.menu.highlight).click();
        await expect(highlights(page)).toHaveCount(SAMPLE_WORD_OCCURRENCES);

        await page.reload();
        await openPreview(page, articleCard(page, 'Article 1'), SAMPLE_PAGES.length);

        await expect(highlights(page)).toHaveCount(SAMPLE_WORD_OCCURRENCES);
    });
});

test.describe('sad paths of the marking', () => {
    test('does not open the menu when nothing is selected', async ({ page }) => {
        await byId(page, TestIds.preview.textLayer).first().locator('span').first().click({ position: { x: 5, y: 5 } });

        await expect(byId(page, TestIds.menu.root)).toHaveCount(0);
    });

    test('highlighting the same word twice does not duplicate the highlights', async ({ page }) => {
        await selectWord(page, SAMPLE_WORD);
        await byId(page, TestIds.menu.highlight).click();
        await selectWord(page, SAMPLE_WORD);
        await byId(page, TestIds.menu.highlight).click();

        await expect(highlights(page)).toHaveCount(SAMPLE_WORD_OCCURRENCES);
    });

    test('closes the menu when the mouse is released elsewhere', async ({ page }) => {
        await selectWord(page, SAMPLE_WORD);
        await expect(byId(page, TestIds.menu.root)).toBeVisible();

        // The text layer covers the page, so the click is made by position on a blank corner of it
        const corner = (await byId(page, TestIds.preview.canvas).first().boundingBox())!;
        await page.mouse.click(corner.x + 5, corner.y + 5);

        await expect(byId(page, TestIds.menu.root)).toHaveCount(0);
    });

    test('does not highlight a word that is only part of other words', async ({ page }) => {
        await selectWord(page, 'proteom', 0, false);
        await byId(page, TestIds.menu.highlight).click();

        // "proteom" is a prefix of the words, never a whole word
        await expect(highlights(page)).toHaveCount(0);
    });
});
