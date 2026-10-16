import { test, expect } from './utils/fixtures';
import {
    ARTICLES_FIXTURE,
    ARTICLES_FIXTURE_SIZE,
    articleCard,
    articleCards,
    attachPdf,
    byId,
    goToFullTexts,
    openApp,
    startWithReferences,
    stepButtons,
    uploadReferences,
} from './utils/app';
import { buildCsv, sampleArticles, STANDARD_COLUMNS } from './utils/csv';
import { samplePdf } from './utils/pdf';
import { TestIds } from '../src/testids';

test.describe('upload of the references', () => {
    test('starts empty, with only the first step available', async ({ page }) => {
        await openApp(page);

        await expect(stepButtons(page)).toHaveCount(3);
        await expect(stepButtons(page).nth(0)).toBeEnabled();
        await expect(stepButtons(page).nth(1)).toBeDisabled();
        await expect(stepButtons(page).nth(2)).toBeDisabled();
        await expect(byId(page, TestIds.references.loadedCount)).toHaveCount(0);
    });

    test('lists every article of the source file on the full text step', async ({ page }) => {
        await openApp(page);
        await uploadReferences(page, ARTICLES_FIXTURE);

        await expect(byId(page, TestIds.references.loadedCount)).toContainText(`${ARTICLES_FIXTURE_SIZE} referências`);
        await expect(stepButtons(page).nth(1)).toBeEnabled();

        await byId(page, TestIds.references.next).click();
        await expect(articleCards(page)).toHaveCount(ARTICLES_FIXTURE_SIZE);
        // Without any PDF yet, every article is listed as missing it
        await expect(articleCards(page).and(page.locator('[data-state="missing-pdf"]'))).toHaveCount(ARTICLES_FIXTURE_SIZE);
        await expect(articleCards(page).first()).toContainText('Differential analysis of quantitative proteome');
    });

    test('clearing the references goes back to the empty state', async ({ page }) => {
        await startWithReferences(page, ARTICLES_FIXTURE);
        await stepButtons(page).nth(0).click();

        await byId(page, TestIds.references.clear).click();

        await expect(byId(page, TestIds.references.loadedCount)).toHaveCount(0);
        await expect(stepButtons(page).nth(1)).toBeDisabled();
    });
});

test.describe('recovery of the uploaded data', () => {
    test('restores the references after reloading the page, landing on the full text step', async ({ page }) => {
        await startWithReferences(page, ARTICLES_FIXTURE);

        await page.reload();

        await expect(byId(page, TestIds.fullTexts.list)).toBeVisible();
        await expect(articleCards(page)).toHaveCount(ARTICLES_FIXTURE_SIZE);
    });

    test('restores the associated PDFs after reloading the page', async ({ page }) => {
        await startWithReferences(page, buildCsv(STANDARD_COLUMNS, sampleArticles(3)));
        await attachPdf(articleCard(page, 'Article 2'), samplePdf());
        await expect(articleCard(page, 'Article 2')).toHaveAttribute('data-state', 'with-pdf');

        await page.reload();

        await expect(articleCards(page)).toHaveCount(3);
        const restored = articleCard(page, 'Article 2');
        await expect(restored).toHaveAttribute('data-state', 'with-pdf');
        await expect(restored).toContainText('sample.pdf');
        await expect(articleCard(page, 'Article 1')).toHaveAttribute('data-state', 'missing-pdf');
    });

    test('starts clean after the references are cleared', async ({ page }) => {
        await startWithReferences(page, buildCsv(STANDARD_COLUMNS, sampleArticles(2)));
        await attachPdf(articleCard(page, 'Article 1'), samplePdf());
        await stepButtons(page).nth(0).click();
        await byId(page, TestIds.references.clear).click();

        await page.reload();

        await expect(byId(page, TestIds.references.fileInput)).toBeAttached();
        await expect(stepButtons(page).nth(1)).toBeDisabled();
    });
});

test.describe('non standard tables', () => {
    test('reads only the required columns, ignoring the ones it does not know', async ({ page }) => {
        const file = buildCsv(
            ['notes', 'title', 'something_else', 'key'],
            [
                { notes: 'x', title: 'First paper', something_else: 'y', key: 'a' },
                { notes: 'x', title: 'Second paper', something_else: 'y', key: 'b' },
            ],
        );
        await startWithReferences(page, file);

        await expect(articleCards(page)).toHaveCount(2);
        await expect(articleCards(page).nth(0)).toContainText('First paper');
        await expect(articleCards(page).nth(1)).toContainText('Second paper');
    });

    test('reads a table with the optional columns missing', async ({ page }) => {
        await startWithReferences(page, buildCsv(['key', 'title'], [{ key: 'a', title: 'Only a title' }]));

        await expect(articleCards(page)).toHaveCount(1);
        await expect(articleCards(page).first()).toContainText('Only a title');
    });

    test('reads titles with commas, quotes and line breaks', async ({ page }) => {
        const title = 'Proteome, "acetyl" profiling:\na tricky title';
        await startWithReferences(page, buildCsv(['key', 'title', 'abstract'], [{ key: 'a', title, abstract: 'with, commas' }]));

        await expect(articleCards(page)).toHaveCount(1);
        await expect(articleCards(page).first()).toContainText('Proteome, "acetyl" profiling:');
    });

    test('reads a semicolon separated table with Windows line breaks and the Excel BOM', async ({ page }) => {
        const file = buildCsv(['key', 'title', 'year'], [{ key: 'a', title: 'Excel paper', year: '2020' }, { key: 'b', title: 'Second excel paper', year: '2021' }], {
            delimiter: ';',
            lineBreak: '\r\n',
            bom: true,
        });
        await startWithReferences(page, file);

        await expect(articleCards(page)).toHaveCount(2);
        await expect(articleCards(page).first()).toContainText('Excel paper');
        await expect(articleCards(page).first()).toContainText('2020');
    });

    test('ignores the rows without a key or a title', async ({ page }) => {
        const file = buildCsv(
            ['key', 'title'],
            [
                { key: 'a', title: 'Valid paper' },
                { key: '', title: 'No key' },
                { key: 'c', title: '' },
            ],
        );
        await startWithReferences(page, file);

        await expect(articleCards(page)).toHaveCount(1);
        await expect(articleCards(page).first()).toContainText('Valid paper');
    });
});

test.describe('sad paths of the references upload', () => {
    test('rejects a table without the title column', async ({ page }) => {
        await openApp(page);
        await uploadReferences(page, buildCsv(['key', 'year'], [{ key: 'a', year: '2020' }]));

        await expect(byId(page, TestIds.references.error)).toContainText('title');
        await expect(byId(page, TestIds.references.loadedCount)).toHaveCount(0);
        await expect(stepButtons(page).nth(1)).toBeDisabled();
    });

    test('rejects a table without the key column', async ({ page }) => {
        await openApp(page);
        await uploadReferences(page, buildCsv(['title'], [{ title: 'No key column' }]));

        await expect(byId(page, TestIds.references.error)).toContainText('key');
        await expect(stepButtons(page).nth(1)).toBeDisabled();
    });

    test('rejects an empty file', async ({ page }) => {
        await openApp(page);
        await uploadReferences(page, { name: 'empty.csv', mimeType: 'text/csv', buffer: Buffer.alloc(0) });

        await expect(byId(page, TestIds.references.error)).toBeVisible();
        await expect(stepButtons(page).nth(1)).toBeDisabled();
    });

    test('rejects a table with the header only', async ({ page }) => {
        await openApp(page);
        await uploadReferences(page, buildCsv(['key', 'title'], []));

        await expect(byId(page, TestIds.references.error)).toContainText('Nenhuma referência');
        await expect(stepButtons(page).nth(1)).toBeDisabled();
    });

    test('keeps the previous references when a bad file is uploaded afterwards', async ({ page }) => {
        await startWithReferences(page, buildCsv(STANDARD_COLUMNS, sampleArticles(2)));
        await stepButtons(page).nth(0).click();

        await uploadReferences(page, buildCsv(['year'], [{ year: '2020' }]));
        await expect(byId(page, TestIds.references.error)).toBeVisible();

        await goToFullTexts(page);
        await expect(articleCards(page)).toHaveCount(2);
    });
});
