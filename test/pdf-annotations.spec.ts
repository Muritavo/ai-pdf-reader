import type { Page } from '@playwright/test';
import { test, expect } from './utils/fixtures';
import { articleCard, attachValidPdf, byId, openPreview, startWithReferences } from './utils/app';
import { buildCsv, sampleArticles, STANDARD_COLUMNS } from './utils/csv';
import { SAMPLE_PAGES, SAMPLE_WORD, SAMPLE_WORD_OCCURRENCES, samplePdf } from './utils/pdf';
import { centerOf, selectWord } from './utils/pdf-interactions';
import { TestIds } from '../src/testids';

const ids = TestIds.annotations;

test.beforeEach(async ({ page }) => {
    await startWithReferences(page, buildCsv(STANDARD_COLUMNS, sampleArticles(2)));
    const card = articleCard(page, 'Article 1');
    await attachValidPdf(card, samplePdf());
    await openPreview(page, card, SAMPLE_PAGES.length);
});

async function highlight(page: Page, word: string, occurrence = 0) {
    await selectWord(page, word, occurrence);
    await byId(page, TestIds.menu.highlight).click();
}

async function mark(page: Page, word: string) {
    await selectWord(page, word);
    await byId(page, TestIds.menu.markLocation).click();
}

const highlightsButton = (page: Page) => byId(page, ids.highlightsButton);
const markersButton = (page: Page) => byId(page, ids.markersButton);
const highlightItems = (page: Page) => byId(page, ids.highlightItem);
const markerItems = (page: Page) => byId(page, ids.markerItem);
const closeButton = (page: Page) => page.locator('[class*="closeBtn"]');
const scrollToTop = (page: Page) => byId(page, TestIds.preview.box).evaluate(box => box.scrollTo(0, 0));

async function openHighlights(page: Page) {
    await highlightsButton(page).click();
    await expect(byId(page, ids.highlightsPanel)).toBeVisible();
}

async function openMarkers(page: Page) {
    await markersButton(page).click();
    await expect(byId(page, ids.markersPanel)).toBeVisible();
}

/** Which of the highlights of a word, in the order of the document, is the closest to the middle of the screen */
const highlightInTheMiddle = (page: Page, normalizedWord: string) =>
    byId(page, TestIds.preview.box).evaluate((box, word) => {
        const boxRect = box.getBoundingClientRect();
        const middle = boxRect.top + boxRect.height / 2;
        // An occurrence can be in more than one piece, so they are told apart by the occurrence
        const occurrences = new Map<string, number>();
        for (const mark of box.querySelectorAll<HTMLElement>('mark')) {
            for (const token of (mark.dataset.occurrences ?? '').split(' ')) {
                if (decodeURIComponent(token.split('~')[0]) !== word) continue;
                const top = mark.getBoundingClientRect().top - boxRect.top + box.scrollTop;
                occurrences.set(token, Math.min(top, occurrences.get(token) ?? Infinity));
            }
        }
        const ordered = [...occurrences.entries()].sort((a, b) => a[1] - b[1]);
        const distances = ordered.map(([, top]) => Math.abs(top - box.scrollTop - middle + boxRect.top));
        return distances.indexOf(Math.min(...distances));
    }, normalizedWord);

test.describe('the annotation buttons', () => {
    test('are placed by the side of the close button, highlights first', async ({ page }) => {
        const [highlights, markers, close] = await Promise.all([
            highlightsButton(page).boundingBox(),
            markersButton(page).boundingBox(),
            closeButton(page).boundingBox(),
        ]);

        expect(highlights!.x + highlights!.width).toBeLessThanOrEqual(markers!.x);
        expect(markers!.x + markers!.width).toBeLessThanOrEqual(close!.x);
        // Close to it, and on the same line
        expect(close!.x - (markers!.x + markers!.width)).toBeLessThan(24);
        expect(markers!.y + markers!.height / 2).toBeCloseTo(close!.y + close!.height / 2, 0);
        expect(highlights!.y + highlights!.height / 2).toBeCloseTo(close!.y + close!.height / 2, 0);
    });

    test('show how many highlights and markers there are', async ({ page }) => {
        await expect(highlightsButton(page)).toHaveAttribute('data-count', '0');
        await expect(markersButton(page)).toHaveAttribute('data-count', '0');

        await highlight(page, SAMPLE_WORD);
        await mark(page, 'Conclusion');
        await mark(page, 'Plasma');

        await expect(highlightsButton(page)).toHaveAttribute('data-count', '1');
        await expect(highlightsButton(page)).toContainText('1');
        await expect(markersButton(page)).toHaveAttribute('data-count', '2');
        await expect(markersButton(page)).toContainText('2');
    });

    test('open one list at a time, and close it when clicked again', async ({ page }) => {
        await openHighlights(page);
        await expect(byId(page, ids.markersPanel)).toHaveCount(0);

        await openMarkers(page);
        await expect(byId(page, ids.highlightsPanel)).toHaveCount(0);

        await markersButton(page).click();
        await expect(byId(page, ids.markersPanel)).toHaveCount(0);
    });
});

test.describe('the list of highlights', () => {
    test('is empty at first', async ({ page }) => {
        await openHighlights(page);

        await expect(byId(page, ids.highlightsPanel)).toContainText('Nenhum destaque ainda');
        await expect(highlightItems(page)).toHaveCount(0);
    });

    test('lists the highlighted text with the pages it is on and how many times', async ({ page }) => {
        await highlight(page, SAMPLE_WORD);

        await openHighlights(page);

        const item = highlightItems(page);
        await expect(item).toHaveCount(1);
        await expect(item).toContainText('Proteome');
        await expect(item).toContainText('p. 1, 2, 3');
        await expect(item).toContainText(`${SAMPLE_WORD_OCCURRENCES} ocorrências`);
        await expect(item).toHaveAttribute('data-pages', '1,2,3');
        await expect(item).toHaveAttribute('data-count', String(SAMPLE_WORD_OCCURRENCES));
    });

    test('lists a text that is on a single page', async ({ page }) => {
        await highlight(page, 'group');

        await openHighlights(page);

        await expect(highlightItems(page)).toHaveAttribute('data-pages', '2');
        await expect(highlightItems(page)).toContainText('p. 2');
        await expect(highlightItems(page)).toContainText('1 ocorrência');
        await expect(highlightItems(page)).not.toContainText('1 ocorrências');
    });

    test('lists every highlighted text, with the color it has on the document', async ({ page }) => {
        await highlight(page, SAMPLE_WORD);
        await highlight(page, 'group');

        await openHighlights(page);

        await expect(highlightItems(page)).toHaveCount(2);
        const swatchColors = await highlightItems(page).evaluateAll(items =>
            items.map(item => (item.firstElementChild as HTMLElement).style.backgroundColor),
        );
        const markColors = await Promise.all(
            ['proteome', 'group'].map(word =>
                byId(page, TestIds.preview.highlight).evaluateAll(
                    (marks, word) =>
                        (marks.find(mark => (mark as HTMLElement).dataset.occurrences?.startsWith(`${word}~`)) as HTMLElement).style.backgroundColor,
                    word,
                ),
            ),
        );
        expect(swatchColors).toEqual(markColors);
    });

    test('goes to the occurrences one by one, coming back to the first after the last', async ({ page }) => {
        await highlight(page, SAMPLE_WORD);
        await scrollToTop(page);
        await openHighlights(page);

        for (const expectedIndex of [0, 1, 2, 3, 0]) {
            await byId(page, ids.highlightGoTo).click();
            await expect.poll(() => highlightInTheMiddle(page, SAMPLE_WORD), { timeout: 5000 }).toBe(expectedIndex);
        }
    });

    test('brings the occurrence into the screen', async ({ page }) => {
        await highlight(page, 'group');
        await scrollToTop(page);
        await openHighlights(page);

        await byId(page, ids.highlightGoTo).click();

        // It is on the second page, so the document has to scroll down to it
        await expect.poll(() => byId(page, TestIds.preview.box).evaluate(box => box.scrollTop)).toBeGreaterThan(500);
        const [box, markBox] = await Promise.all([
            byId(page, TestIds.preview.box).boundingBox(),
            byId(page, TestIds.preview.highlight).first().boundingBox(),
        ]);
        expect(markBox!.y).toBeGreaterThanOrEqual(box!.y);
        expect(markBox!.y + markBox!.height).toBeLessThanOrEqual(box!.y + box!.height);
    });

    test('removes the highlight from the list and from the document', async ({ page }) => {
        await highlight(page, SAMPLE_WORD);
        await openHighlights(page);
        await expect(byId(page, TestIds.preview.highlight)).toHaveCount(SAMPLE_WORD_OCCURRENCES);

        await byId(page, ids.highlightRemove).click();

        await expect(highlightItems(page)).toHaveCount(0);
        await expect(byId(page, ids.highlightsPanel)).toContainText('Nenhum destaque ainda');
        await expect(byId(page, TestIds.preview.highlight)).toHaveCount(0);
        await expect(highlightsButton(page)).toHaveAttribute('data-count', '0');
        // The text is back as it was
        await expect(byId(page, TestIds.preview.textLayer).first()).toContainText('Proteome analysis of ovarian tissue');
    });

    test('removes only the chosen highlight', async ({ page }) => {
        await highlight(page, SAMPLE_WORD);
        await highlight(page, 'group');
        await openHighlights(page);

        await highlightItems(page).filter({ hasText: 'Proteome' }).getByTestId(ids.highlightRemove).click();

        await expect(highlightItems(page)).toHaveCount(1);
        await expect(highlightItems(page)).toContainText('group');
        await expect(byId(page, TestIds.preview.highlight)).toHaveCount(1);
    });

    test('keeps the highlight removed after reloading', async ({ page }) => {
        await highlight(page, SAMPLE_WORD);
        await highlight(page, 'group');
        await openHighlights(page);
        await highlightItems(page).filter({ hasText: 'Proteome' }).getByTestId(ids.highlightRemove).click();

        await page.reload();
        await openPreview(page, articleCard(page, 'Article 1'), SAMPLE_PAGES.length);
        await openHighlights(page);

        await expect(highlightItems(page)).toHaveCount(1);
        await expect(highlightItems(page)).toContainText('group');
        await expect(byId(page, TestIds.preview.highlight)).toHaveCount(1);
    });

    test('can highlight the text again after removing it', async ({ page }) => {
        await highlight(page, SAMPLE_WORD);
        await openHighlights(page);
        await byId(page, ids.highlightRemove).click();
        await expect(byId(page, TestIds.preview.highlight)).toHaveCount(0);

        await highlight(page, SAMPLE_WORD);

        await expect(byId(page, TestIds.preview.highlight)).toHaveCount(SAMPLE_WORD_OCCURRENCES);
        await expect(highlightItems(page)).toHaveCount(1);
    });
});

test.describe('the list of markers', () => {
    test('is empty at first', async ({ page }) => {
        await openMarkers(page);

        await expect(byId(page, ids.markersPanel)).toContainText('Nenhum marcador ainda');
        await expect(markerItems(page)).toHaveCount(0);
    });

    test('lists the markers in the order of the document, with the page they are on', async ({ page }) => {
        await mark(page, 'Conclusion');
        await mark(page, 'Plasma');
        await mark(page, 'Proteome');

        await openMarkers(page);

        await expect(markerItems(page)).toHaveCount(3);
        // Not in the order they were created
        await expect(markerItems(page).nth(0)).toContainText('Proteome');
        await expect(markerItems(page).nth(0)).toHaveAttribute('data-page', '1');
        await expect(markerItems(page).nth(0)).toContainText('p. 1');
        await expect(markerItems(page).nth(1)).toContainText('Plasma');
        await expect(markerItems(page).nth(1)).toHaveAttribute('data-page', '2');
        await expect(markerItems(page).nth(2)).toContainText('Conclusion');
        await expect(markerItems(page).nth(2)).toHaveAttribute('data-page', '3');
    });

    test('goes to the marker, bringing it into the screen', async ({ page }) => {
        await mark(page, 'Conclusion');
        await scrollToTop(page);
        await expect.poll(() => byId(page, TestIds.preview.box).evaluate(box => box.scrollTop)).toBe(0);
        await openMarkers(page);

        await byId(page, ids.markerGoTo).click();

        await expect.poll(() => byId(page, TestIds.preview.box).evaluate(box => box.scrollTop)).toBeGreaterThan(1000);
        const [box, marker] = await Promise.all([byId(page, TestIds.preview.box).boundingBox(), centerOf(page, TestIds.preview.pointOfInterest)]);
        const middle = box!.y + box!.height / 2;
        // In the middle of the screen
        expect(Math.abs(marker.y - middle)).toBeLessThan(box!.height / 4);
    });

    test('goes to each marker on its own', async ({ page }) => {
        await mark(page, 'Plasma');
        await mark(page, 'Conclusion');
        await scrollToTop(page);
        await openMarkers(page);

        await markerItems(page).nth(1).getByTestId(ids.markerGoTo).click();
        await expect.poll(() => byId(page, TestIds.preview.box).evaluate(box => box.scrollTop)).toBeGreaterThan(1000);
        const farScroll = await byId(page, TestIds.preview.box).evaluate(box => box.scrollTop);

        await markerItems(page).nth(0).getByTestId(ids.markerGoTo).click();
        await expect.poll(() => byId(page, TestIds.preview.box).evaluate(box => box.scrollTop)).toBeLessThan(farScroll - 500);
    });

    test('removes the marker from the list and from the document', async ({ page }) => {
        await mark(page, 'Plasma');
        await openMarkers(page);
        await expect(byId(page, TestIds.preview.pointOfInterest)).toHaveCount(1);

        await byId(page, ids.markerRemove).click();

        await expect(markerItems(page)).toHaveCount(0);
        await expect(byId(page, ids.markersPanel)).toContainText('Nenhum marcador ainda');
        await expect(byId(page, TestIds.preview.pointOfInterest)).toHaveCount(0);
        await expect(markersButton(page)).toHaveAttribute('data-count', '0');
    });

    test('removes only the chosen marker', async ({ page }) => {
        await mark(page, 'Proteome');
        await mark(page, 'Plasma');
        await mark(page, 'Conclusion');
        await openMarkers(page);

        await markerItems(page).filter({ hasText: 'Plasma' }).getByTestId(ids.markerRemove).click();

        await expect(markerItems(page)).toHaveCount(2);
        await expect(markerItems(page).nth(0)).toContainText('Proteome');
        await expect(markerItems(page).nth(1)).toContainText('Conclusion');
        await expect(byId(page, TestIds.preview.pointOfInterest)).toHaveCount(2);
    });

    test('keeps the marker removed after reloading', async ({ page }) => {
        await mark(page, 'Plasma');
        await mark(page, 'Conclusion');
        await openMarkers(page);
        await markerItems(page).filter({ hasText: 'Plasma' }).getByTestId(ids.markerRemove).click();

        await page.reload();
        await openPreview(page, articleCard(page, 'Article 1'), SAMPLE_PAGES.length);
        await openMarkers(page);

        await expect(markerItems(page)).toHaveCount(1);
        await expect(markerItems(page)).toContainText('Conclusion');
    });

    test('removes only the chosen marker among the ones from before a reload', async ({ page }) => {
        await mark(page, 'Plasma');
        await mark(page, 'Conclusion');
        await page.reload();
        await openPreview(page, articleCard(page, 'Article 1'), SAMPLE_PAGES.length);

        await mark(page, 'Proteome');
        await openMarkers(page);
        await expect(markerItems(page)).toHaveCount(3);
        await markerItems(page).filter({ hasText: 'Proteome' }).getByTestId(ids.markerRemove).click();

        // The new marker does not take its key from an old one, so only it is removed
        await expect(markerItems(page)).toHaveCount(2);
        await expect(markerItems(page).nth(0)).toContainText('Plasma');
        await expect(markerItems(page).nth(1)).toContainText('Conclusion');
    });

    test('lists a marker without a text', async ({ page }) => {
        await mark(page, 'Plasma');
        await page.evaluate(() => {
            const key = Object.keys(localStorage).find(k => k.startsWith('poi-'))!;
            const markers = JSON.parse(localStorage.getItem(key)!) as Array<{ word?: string }>;
            localStorage.setItem(key, JSON.stringify(markers.map(({ word, ...rest }) => rest)));
        });
        await page.reload();
        await openPreview(page, articleCard(page, 'Article 1'), SAMPLE_PAGES.length);

        await openMarkers(page);

        await expect(markerItems(page)).toHaveCount(1);
        await expect(markerItems(page)).toContainText('Marcador');
    });
});

test.describe('highlights over each other', () => {
    const PHRASE = 'Plasma samples were collected from women';

    test('finds a word that is inside a text already highlighted', async ({ page }) => {
        await highlight(page, PHRASE);
        await highlight(page, 'collected');

        await openHighlights(page);

        await expect(highlightItems(page)).toHaveCount(2);
        const phrase = highlightItems(page).filter({ hasText: PHRASE });
        const word = highlightItems(page).filter({ hasText: 'collected' });
        await expect(phrase).toHaveAttribute('data-count', '1');
        await expect(word).toHaveAttribute('data-count', '1');
        await expect(word).toHaveAttribute('data-pages', '2');
        await expect(word).toContainText('p. 2');
        await expect(word).not.toContainText('Não encontrado');
        await expect(word.getByTestId(ids.highlightGoTo)).toBeEnabled();
    });

    test('counts the word inside a longer text together with the ones of the rest of the document', async ({ page }) => {
        await highlight(page, 'Proteome analysis');
        await highlight(page, SAMPLE_WORD);

        await openHighlights(page);

        await expect(highlightItems(page).filter({ hasText: 'Proteome analysis' })).toHaveAttribute('data-count', '1');
        const word = highlightItems(page).filter({ hasText: /^Proteome$|^Proteome\b(?! analysis)/ });
        await expect(word).toHaveAttribute('data-count', String(SAMPLE_WORD_OCCURRENCES));
        await expect(word).toHaveAttribute('data-pages', '1,2,3');
    });

    test('finds the same occurrences when the longer text is highlighted last', async ({ page }) => {
        await highlight(page, SAMPLE_WORD);
        await highlight(page, 'Proteome analysis');

        await openHighlights(page);

        await expect(highlightItems(page).filter({ hasText: 'Proteome analysis' })).toHaveAttribute('data-count', '1');
        await expect(highlightItems(page).first()).toHaveAttribute('data-count', String(SAMPLE_WORD_OCCURRENCES));
    });

    test('finds both texts when they only overlap partly', async ({ page }) => {
        await highlight(page, 'analysis of');
        await highlight(page, 'of ovarian');

        await openHighlights(page);

        await expect(highlightItems(page)).toHaveCount(2);
        await expect(highlightItems(page).nth(0)).toHaveAttribute('data-count', '1');
        await expect(highlightItems(page).nth(1)).toHaveAttribute('data-count', '1');
        await expect(highlightItems(page).nth(1)).not.toContainText('Não encontrado');
    });

    test('goes through the occurrences inside the longer text too', async ({ page }) => {
        await highlight(page, 'Proteome analysis');
        await highlight(page, SAMPLE_WORD);
        await scrollToTop(page);
        await openHighlights(page);
        const word = highlightItems(page).filter({ hasText: /^Proteome\b(?! analysis)/ });

        for (const expectedIndex of [0, 1, 2, 3, 0]) {
            await word.getByTestId(ids.highlightGoTo).click();
            await expect.poll(() => highlightInTheMiddle(page, SAMPLE_WORD), { timeout: 5000 }).toBe(expectedIndex);
        }
    });

    test('shows the colors of both where they are over each other', async ({ page }) => {
        await highlight(page, PHRASE);
        await highlight(page, 'collected');

        const [overlapped, alone] = await Promise.all([
            byId(page, TestIds.preview.highlight).filter({ hasText: 'collected' }).evaluate(mark => (mark as HTMLElement).style.background),
            byId(page, TestIds.preview.highlight).filter({ hasText: 'Plasma' }).evaluate(mark => (mark as HTMLElement).style.background),
        ]);
        expect(overlapped).toContain('linear-gradient');
        expect(alone).not.toContain('linear-gradient');
    });

    test('keeps the whole text highlighted, in pieces, when another highlight cuts it', async ({ page }) => {
        await highlight(page, PHRASE);
        await highlight(page, 'collected');

        const text = await byId(page, TestIds.preview.highlight).evaluateAll(
            (marks, phrase) =>
                marks
                    .filter(mark => (mark as HTMLElement).dataset.occurrences!.startsWith(`${phrase}~`))
                    .map(mark => mark.textContent)
                    .join(''),
            encodeURIComponent(PHRASE.toLowerCase()),
        );
        expect(text).toBe(PHRASE);
        // Counted once, although it is in more than one piece
        await openHighlights(page);
        await expect(highlightItems(page).filter({ hasText: PHRASE })).toHaveAttribute('data-count', '1');
    });

    test('keeps the word highlighted when the longer text is removed', async ({ page }) => {
        await highlight(page, PHRASE);
        await highlight(page, 'collected');
        await openHighlights(page);

        await highlightItems(page).filter({ hasText: PHRASE }).getByTestId(ids.highlightRemove).click();

        await expect(highlightItems(page)).toHaveCount(1);
        await expect(byId(page, TestIds.preview.highlight)).toHaveCount(1);
        await expect(byId(page, TestIds.preview.highlight)).toHaveText('collected');
    });

    test('keeps the longer text highlighted when the word inside it is removed', async ({ page }) => {
        await highlight(page, PHRASE);
        await highlight(page, 'collected');
        await openHighlights(page);

        await highlightItems(page).filter({ hasText: 'collected' }).getByTestId(ids.highlightRemove).click();

        await expect(highlightItems(page)).toHaveCount(1);
        await expect(byId(page, TestIds.preview.highlight)).toHaveCount(1);
        await expect(byId(page, TestIds.preview.highlight)).toHaveText(PHRASE);
    });
});
