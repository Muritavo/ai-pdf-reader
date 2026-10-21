import { test, expect } from './utils/fixtures';
import { articleCard, articleCards, attachPdf, attachValidPdf, byId, openPreview, startWithReferences } from './utils/app';
import { buildCsv, sampleArticles, STANDARD_COLUMNS } from './utils/csv';
import { corruptedPdfFile, pdfFile, SAMPLE_PAGES, samplePdf, sampleWordCount, textFile } from './utils/pdf';
import { TestIds } from '../src/testids';

test.beforeEach(async ({ page }) => {
    await startWithReferences(page, buildCsv(STANDARD_COLUMNS, sampleArticles(3)));
});

test.describe('associating the full text', () => {
    test('marks the article as having its PDF, showing the file name and the word count', async ({ page }) => {
        const card = articleCard(page, 'Article 1');
        await expect(card).toHaveAttribute('data-state', 'missing-pdf');

        await attachPdf(card, samplePdf());

        await expect(card).toHaveAttribute('data-state', 'with-pdf');
        await expect(card).toContainText('sample.pdf');
        await expect(card).toContainText(`${sampleWordCount} palavras`);
        await expect(byId(page, TestIds.fullTexts.progressCount)).toContainText('1 de 3');
    });

    test('lists the articles with a PDF first, and the ones still without it last, below a divider', async ({ page }) => {
        await expect(byId(page, TestIds.fullTexts.pendingDivider)).toHaveCount(0);

        await attachValidPdf(articleCard(page, 'Article 2'), samplePdf());

        await expect(byId(page, TestIds.fullTexts.pendingDivider)).toBeVisible();
        await expect(byId(page, TestIds.fullTexts.pendingDivider)).toContainText('Sem texto completo · 2');
        await expect(articleCards(page).first()).toContainText('Article 2');
        await expect(articleCards(page).first()).toHaveAttribute('data-state', 'with-pdf');
        await expect(articleCards(page).nth(1)).toContainText('Article 1');
        await expect(articleCards(page).last()).toContainText('Article 3');
        // The divider is between the two sections
        const [firstBox, dividerBox, lastBox] = await Promise.all([
            articleCards(page).first().boundingBox(),
            byId(page, TestIds.fullTexts.pendingDivider).boundingBox(),
            articleCards(page).last().boundingBox(),
        ]);
        expect(firstBox!.y).toBeLessThan(dividerBox!.y);
        expect(dividerBox!.y).toBeLessThan(lastBox!.y);
    });

    test('has no divider when every article has its PDF', async ({ page }) => {
        for (const title of ['Article 1', 'Article 2', 'Article 3']) {
            await attachValidPdf(articleCard(page, title), samplePdf());
        }

        await expect(articleCards(page).and(page.locator('[data-state="with-pdf"]'))).toHaveCount(3);
        await expect(byId(page, TestIds.fullTexts.pendingDivider)).toHaveCount(0);
    });

    test('puts an article back among the ones without a PDF when its PDF is removed', async ({ page }) => {
        const card = articleCard(page, 'Article 1');
        await attachValidPdf(card, samplePdf());
        await expect(articleCards(page).first()).toContainText('Article 1');

        await card.getByRole('button', { name: 'Remover' }).click();

        await expect(card).toHaveAttribute('data-state', 'missing-pdf');
        await expect(byId(page, TestIds.fullTexts.pendingDivider)).toHaveCount(0);
        await expect(articleCards(page).first()).toContainText('Article 1');
    });

    test('can replace and remove the PDF of an article', async ({ page }) => {
        const card = articleCard(page, 'Article 1');
        await attachValidPdf(card, samplePdf());

        await attachPdf(card, pdfFile('replacement.pdf', [['Another document']]));
        await expect(card).toContainText('replacement.pdf');

        await card.getByRole('button', { name: 'Remover' }).click();
        await expect(card).toHaveAttribute('data-state', 'missing-pdf');
    });
});

test.describe('opening the preview', () => {
    test('renders every page of the PDF with its text', async ({ page }) => {
        const card = articleCard(page, 'Article 1');
        await attachPdf(card, samplePdf());

        await openPreview(page, card, SAMPLE_PAGES.length);

        for (const canvas of await byId(page, TestIds.preview.canvas).all()) {
            const { width, height } = await canvas.evaluate((c: HTMLCanvasElement) => ({ width: c.width, height: c.height }));
            expect(width).toBeGreaterThan(0);
            expect(height).toBeGreaterThan(width);
        }
        await expect(byId(page, TestIds.preview.textLayer).first()).toContainText('Proteome analysis of ovarian tissue');
        await expect(byId(page, TestIds.preview.textLayer).last()).toContainText('Conclusion of the study');
    });

    test('takes 90% of the height of the screen, without a limit for big screens', async ({ page }) => {
        const card = articleCard(page, 'Article 1');
        await attachPdf(card, samplePdf());

        for (const height of [720, 1200]) {
            await page.setViewportSize({ width: 1280, height });
            if (height === 720) await openPreview(page, card, SAMPLE_PAGES.length);
            await expect
                .poll(async () => (await page.locator('.dialog-surface').boundingBox())!.height)
                .toBeCloseTo(height * 0.9, 0);
        }
    });

    test('opens the PDF of the clicked article only', async ({ page }) => {
        await attachValidPdf(articleCard(page, 'Article 1'), pdfFile('one.pdf', [['First document text']]));
        await attachValidPdf(articleCard(page, 'Article 2'), pdfFile('two.pdf', [['Second document text']]));

        await openPreview(page, articleCard(page, 'Article 2'), 1);

        await expect(byId(page, TestIds.preview.textLayer)).toContainText('Second document text');
        await expect(byId(page, TestIds.preview.textLayer)).not.toContainText('First document text');
    });

    test('does not open the preview of an article without a PDF', async ({ page }) => {
        await articleCard(page, 'Article 3').click();

        await expect(byId(page, TestIds.preview.box)).toHaveCount(0);
    });
});

test.describe('sad paths of the PDF upload', () => {
    test('rejects a corrupted PDF, keeping the article without it', async ({ page }) => {
        const card = articleCard(page, 'Article 1');

        await attachPdf(card, corruptedPdfFile());

        await expect(card.getByTestId(TestIds.fullTexts.articleError)).toBeVisible();
        await expect(card).toHaveAttribute('data-state', 'missing-pdf');
        await expect(byId(page, TestIds.fullTexts.progressCount)).toContainText('0 de 3');
    });

    test('rejects a file that is not a PDF', async ({ page }) => {
        const card = articleCard(page, 'Article 1');

        await attachPdf(card, textFile());

        await expect(card.getByTestId(TestIds.fullTexts.articleError)).toBeVisible();
        await expect(card).toHaveAttribute('data-state', 'missing-pdf');
    });

    test('keeps the previous PDF when a bad file is sent to replace it', async ({ page }) => {
        const card = articleCard(page, 'Article 1');
        await attachValidPdf(card, samplePdf());

        await attachPdf(card, corruptedPdfFile());

        await expect(card.getByTestId(TestIds.fullTexts.articleError)).toBeVisible();
        await expect(card).toHaveAttribute('data-state', 'with-pdf');
        await expect(card).toContainText('sample.pdf');
    });

    test('does not keep a rejected file after reloading', async ({ page }) => {
        await attachPdf(articleCard(page, 'Article 1'), textFile());

        await page.reload();

        await expect(articleCards(page)).toHaveCount(3);
        await expect(articleCard(page, 'Article 1')).toHaveAttribute('data-state', 'missing-pdf');
    });

    test('clears the error once a valid PDF is sent', async ({ page }) => {
        const card = articleCard(page, 'Article 1');
        await attachPdf(card, textFile());
        await expect(card.getByTestId(TestIds.fullTexts.articleError)).toBeVisible();

        await attachPdf(card, samplePdf());

        await expect(card.getByTestId(TestIds.fullTexts.articleError)).toHaveCount(0);
        await expect(card).toHaveAttribute('data-state', 'with-pdf');
    });
});
