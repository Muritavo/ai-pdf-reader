import type { Page } from '@playwright/test';
import { test, expect } from './utils/fixtures';
import { articleCard, attachValidPdf, byId, openPreview, startWithReferences } from './utils/app';
import { buildCsv, sampleArticles, STANDARD_COLUMNS } from './utils/csv';
import { brokenLinePdf, pdfFile, SAMPLE_PAGES, SAMPLE_WORD, SAMPLE_WORD_OCCURRENCES, samplePdf } from './utils/pdf';
import { centerOf, selectAcross, selectWord } from './utils/pdf-interactions';
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
/** The item of a highlighted text, given in lowercase as the list keeps it */
const highlightItem = (page: Page, normalizedWord: string) => highlightItems(page).and(page.locator(`[data-word="${normalizedWord}"]`));
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

/** Which occurrence of a text, in the order of the document, is outlined by the go to. -1 if none is */
const outlinedOccurrence = (page: Page, normalizedWord: string) =>
    byId(page, TestIds.preview.box).evaluate((box, word) => {
        const boxRect = box.getBoundingClientRect();
        // An occurrence can be in more than one piece, so they are told apart by the occurrence
        const occurrences = new Map<string, { top: number; outlined: boolean }>();
        for (const mark of box.querySelectorAll<HTMLElement>('mark')) {
            for (const token of (mark.dataset.occurrences ?? '').split(' ')) {
                if (decodeURIComponent(token.split('~')[0]) !== word) continue;
                const top = mark.getBoundingClientRect().top - boxRect.top + box.scrollTop;
                const known = occurrences.get(token);
                occurrences.set(token, {
                    top: Math.min(top, known?.top ?? Infinity),
                    outlined: (known?.outlined ?? false) || mark.className.includes('wordPulse'),
                });
            }
        }
        const ordered = [...occurrences.values()].sort((a, b) => a.top - b.top);
        return ordered.findIndex(occurrence => occurrence.outlined);
    }, normalizedWord);

/** Goes through the occurrences with the button of the list, checking the one that is outlined each time */
async function goThroughOccurrences(page: Page, goTo: ReturnType<typeof byId>, normalizedWord: string, expected: number[]) {
    for (const [step, expectedIndex] of expected.entries()) {
        // The outline of the previous one fades away before the next
        if (step > 0) await expect(page.locator('mark[class*="wordPulse"]')).toHaveCount(0, { timeout: 4000 });
        await goTo.click();
        await expect.poll(() => outlinedOccurrence(page, normalizedWord), { timeout: 5000 }).toBe(expectedIndex);
    }
}

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

    test('open lists that are 30% transparent, so the document behind them can be seen', async ({ page }) => {
        await highlight(page, SAMPLE_WORD);
        await mark(page, 'Plasma');

        await openHighlights(page);
        await expect(byId(page, ids.highlightsPanel)).toHaveCSS('background-color', 'rgba(23, 26, 33, 0.7)');

        await openMarkers(page);
        await expect(byId(page, ids.markersPanel)).toHaveCSS('background-color', 'rgba(23, 26, 33, 0.7)');
        // Nothing blurs what is behind them
        await expect(byId(page, ids.markersPanel)).toHaveCSS('backdrop-filter', 'none');
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
        test.setTimeout(45_000);
        await highlight(page, SAMPLE_WORD);
        await scrollToTop(page);
        await openHighlights(page);

        await goThroughOccurrences(page, byId(page, ids.highlightGoTo), 'proteome', [0, 1, 2, 3, 0]);
    });

    test('outlines the occurrence in red when going to it, as white would not be seen on the pages', async ({ page }) => {
        await highlight(page, SAMPLE_WORD);
        await scrollToTop(page);
        await openHighlights(page);

        await byId(page, ids.highlightGoTo).click();

        const pulsing = page.locator('mark[class*="wordPulse"]');
        await expect(pulsing.first()).toBeVisible();
        const { color, width, style } = await pulsing.first().evaluate(mark => {
            const { outlineColor, outlineWidth, outlineStyle } = getComputedStyle(mark);
            const [r, g, b] = outlineColor.match(/[\d.]+/g)!.map(Number);
            return { color: { r, g, b }, width: outlineWidth, style: outlineStyle };
        });
        // Red, and not white
        expect(color.r).toBeGreaterThan(150);
        expect(color.g).toBeLessThan(110);
        expect(color.b).toBeLessThan(110);
        expect(style).toBe('solid');
        expect(Number.parseFloat(width)).toBeGreaterThanOrEqual(3);
    });

    test('stops outlining the occurrence after a moment', async ({ page }) => {
        await highlight(page, SAMPLE_WORD);
        await openHighlights(page);
        await byId(page, ids.highlightGoTo).click();
        await expect(page.locator('mark[class*="wordPulse"]').first()).toBeVisible();

        await expect(page.locator('mark[class*="wordPulse"]')).toHaveCount(0, { timeout: 4000 });
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

        await highlightItem(page, 'proteome').getByTestId(ids.highlightRemove).click();

        await expect(highlightItems(page)).toHaveCount(1);
        await expect(highlightItems(page)).toContainText('group');
        await expect(byId(page, TestIds.preview.highlight)).toHaveCount(1);
    });

    test('keeps the highlight removed after reloading', async ({ page }) => {
        await highlight(page, SAMPLE_WORD);
        await highlight(page, 'group');
        await openHighlights(page);
        await highlightItem(page, 'proteome').getByTestId(ids.highlightRemove).click();

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
        const box = (await byId(page, TestIds.preview.box).boundingBox())!;
        const onTheScreen = async () => {
            const marker = await centerOf(page, TestIds.preview.pointOfInterest);
            return marker.y >= box.y && marker.y <= box.y + box.height;
        };
        // Far down on the last page, so it starts out of the screen
        expect(await onTheScreen()).toBe(false);

        await byId(page, ids.markerGoTo).click();

        // The document scrolls to it, it is not there right away
        await expect.poll(onTheScreen, { timeout: 5000 }).toBe(true);
        await expect.poll(() => byId(page, TestIds.preview.box).evaluate(box => box.scrollTop)).toBeGreaterThan(1000);
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
        const phrase = highlightItem(page, PHRASE.toLowerCase());
        const word = highlightItem(page, 'collected');
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

        await expect(highlightItem(page, 'proteome analysis')).toHaveAttribute('data-count', '1');
        const word = highlightItem(page, 'proteome');
        await expect(word).toHaveAttribute('data-count', String(SAMPLE_WORD_OCCURRENCES));
        await expect(word).toHaveAttribute('data-pages', '1,2,3');
    });

    test('finds the same occurrences when the longer text is highlighted last', async ({ page }) => {
        await highlight(page, SAMPLE_WORD);
        await highlight(page, 'Proteome analysis');

        await openHighlights(page);

        await expect(highlightItem(page, 'proteome analysis')).toHaveAttribute('data-count', '1');
        await expect(highlightItem(page, 'proteome')).toHaveAttribute('data-count', String(SAMPLE_WORD_OCCURRENCES));
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
        test.setTimeout(45_000);
        await highlight(page, 'Proteome analysis');
        await highlight(page, SAMPLE_WORD);
        await scrollToTop(page);
        await openHighlights(page);

        await goThroughOccurrences(page, highlightItem(page, 'proteome').getByTestId(ids.highlightGoTo), 'proteome', [0, 1, 2, 3, 0]);
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
        await expect(highlightItem(page, PHRASE.toLowerCase())).toHaveAttribute('data-count', '1');
    });

    test('keeps the word highlighted when the longer text is removed', async ({ page }) => {
        await highlight(page, PHRASE);
        await highlight(page, 'collected');
        await openHighlights(page);

        await highlightItem(page, PHRASE.toLowerCase()).getByTestId(ids.highlightRemove).click();

        await expect(highlightItems(page)).toHaveCount(1);
        await expect(byId(page, TestIds.preview.highlight)).toHaveCount(1);
        await expect(byId(page, TestIds.preview.highlight)).toHaveText('collected');
    });

    test('keeps the longer text highlighted when the word inside it is removed', async ({ page }) => {
        await highlight(page, PHRASE);
        await highlight(page, 'collected');
        await openHighlights(page);

        await highlightItem(page, 'collected').getByTestId(ids.highlightRemove).click();

        await expect(highlightItems(page)).toHaveCount(1);
        await expect(byId(page, TestIds.preview.highlight)).toHaveCount(1);
        await expect(byId(page, TestIds.preview.highlight)).toHaveText(PHRASE);
    });
});

test.describe('highlights across lines', () => {
    /** Leaves the sample document and opens another one, on the second article */
    async function openOther(page: Page, file: Parameters<typeof attachValidPdf>[1], pages: number) {
        await page.mouse.click(2, 2);
        await expect(byId(page, TestIds.preview.box)).toHaveCount(0);
        const card = articleCard(page, 'Article 2');
        await attachValidPdf(card, file);
        await openPreview(page, card, pages);
    }

    /** The pieces of each occurrence of a highlighted text, in the order of the document */
    const piecesOf = (page: Page, normalizedWord: string) =>
        byId(page, TestIds.preview.highlight).evaluateAll((marks, word) => {
            const occurrences = new Map<string, string[]>();
            for (const mark of marks as HTMLElement[]) {
                for (const token of mark.dataset.occurrences!.split(' ')) {
                    if (decodeURIComponent(token.split('~')[0]) !== word) continue;
                    occurrences.set(token, [...(occurrences.get(token) ?? []), mark.textContent!]);
                }
            }
            return [...occurrences.values()];
        }, normalizedWord);

    test('highlights a text that goes on to the next line', async ({ page }) => {
        await openOther(page, brokenLinePdf(), 1);

        await selectAcross(page, { line: 'This document has a', word: 'a' }, { line: 'broken line', word: 'line' });
        await byId(page, TestIds.menu.highlight).click();

        // One occurrence, in a piece on each line
        expect(await piecesOf(page, 'a broken line')).toEqual([['a', 'broken line']]);
        await openHighlights(page);
        await expect(highlightItem(page, 'a broken line')).toHaveAttribute('data-count', '1');
        await expect(highlightItem(page, 'a broken line')).toHaveAttribute('data-pages', '1');
    });

    test('highlights a text that goes on after an empty line', async ({ page }) => {
        await openOther(page, brokenLinePdf(), 1);

        await selectAcross(page, { line: 'And even', word: 'even' }, { line: 'a line that breaks', word: 'line' });
        await byId(page, TestIds.menu.highlight).click();

        expect(await piecesOf(page, 'even a line')).toEqual([['even', 'a line']]);
    });

    test('finds a word cut by a hyphen at the end of a line', async ({ page }) => {
        await openOther(page, brokenLinePdf(), 1);

        await selectWord(page, 'broken');
        await byId(page, TestIds.menu.highlight).click();

        // Once whole, and once as "bro-" at the end of a line with "ken" on the next one
        expect(await piecesOf(page, 'broken')).toEqual([['broken'], ['bro-', 'ken']]);
        await openHighlights(page);
        await expect(highlightItem(page, 'broken')).toHaveAttribute('data-count', '2');
    });

    test('highlights a word cut by a hyphen when it is selected across the lines', async ({ page }) => {
        await openOther(page, brokenLinePdf(), 1);

        await selectAcross(page, { line: 'the text is bro-', word: 'bro' }, { line: 'ken with', word: 'ken' });
        await byId(page, TestIds.menu.highlight).click();

        // It is the word without the hyphen, so the whole one is found too
        expect(await piecesOf(page, 'broken')).toEqual([['broken'], ['bro-', 'ken']]);
    });

    test('finds a text written on a single line also where it goes on to the next one', async ({ page }) => {
        await openOther(page, pdfFile('quick.pdf', [['The quick brown', 'fox jumps over', 'and the quick brown fox runs']]), 1);

        await selectWord(page, 'quick brown fox');
        await byId(page, TestIds.menu.highlight).click();

        expect(await piecesOf(page, 'quick brown fox')).toEqual([['quick brown', 'fox'], ['quick brown fox']]);
        await openHighlights(page);
        await expect(highlightItem(page, 'quick brown fox')).toHaveAttribute('data-count', '2');
    });

    test('goes to a text across lines outlining every piece of it', async ({ page }) => {
        await openOther(page, brokenLinePdf(), 1);
        await selectAcross(page, { line: 'This document has a', word: 'a' }, { line: 'broken line', word: 'line' });
        await byId(page, TestIds.menu.highlight).click();
        await openHighlights(page);

        await byId(page, ids.highlightGoTo).click();

        await expect(page.locator('mark[class*="wordPulse"]')).toHaveText(['a', 'broken line']);
    });

    test('removes every piece of a text across lines', async ({ page }) => {
        await openOther(page, brokenLinePdf(), 1);
        await selectAcross(page, { line: 'This document has a', word: 'a' }, { line: 'broken line', word: 'line' });
        await byId(page, TestIds.menu.highlight).click();
        await openHighlights(page);

        await byId(page, ids.highlightRemove).click();

        await expect(byId(page, TestIds.preview.highlight)).toHaveCount(0);
        await expect(byId(page, TestIds.preview.textLayer)).toContainText('This document has a');
    });

    test('keeps the lines as they are, without joining their words', async ({ page }) => {
        await openOther(page, brokenLinePdf(), 1);

        // "a" ends a line and "broken" starts the next one, they are not the word "abroken"
        await selectAcross(page, { line: 'This document has a', word: 'a' }, { line: 'broken line', word: 'broken' });
        await byId(page, TestIds.menu.highlight).click();

        expect(await piecesOf(page, 'a broken')).toEqual([['a', 'broken']]);
        await expect(byId(page, TestIds.preview.textLayer)).toContainText('This document has a');
        await expect(byId(page, TestIds.preview.textLayer)).toContainText('broken line');
    });

    test('does not find a text that only goes on in the next page', async ({ page }) => {
        await openOther(page, pdfFile('pages.pdf', [['the quick brown dog', 'and a quick'], ['brown cat']]), 2);

        await selectWord(page, 'quick brown');
        await byId(page, TestIds.menu.highlight).click();

        // Each page is a text of its own
        expect(await piecesOf(page, 'quick brown')).toEqual([['quick brown']]);
    });
});
