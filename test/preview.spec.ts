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

    test('moves the articles with a PDF to the end, below a divider', async ({ page }) => {
        await expect(byId(page, TestIds.fullTexts.withPdfDivider)).toHaveCount(0);

        await attachPdf(articleCard(page, 'Article 1'), samplePdf());

        await expect(byId(page, TestIds.fullTexts.withPdfDivider)).toBeVisible();
        await expect(articleCards(page).last()).toContainText('Article 1');
        await expect(articleCards(page).first()).toContainText('Article 2');
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
