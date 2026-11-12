import type { Page } from '@playwright/test';
import { test, expect } from './utils/fixtures';
import { articleCard, attachPdf, byId, openApp, openPreview, startWithReferences } from './utils/app';
import { buildCsv, sampleArticles, STANDARD_COLUMNS } from './utils/csv';
import { pdfFile, SAMPLE_PAGES, SAMPLE_WORD, samplePdf } from './utils/pdf';
import { selectWord } from './utils/pdf-interactions';
import { TestIds } from '../src/testids';

const warmUpButton = (page: Page) => byId(page, TestIds.ai.warmUp);
const promptInput = (page: Page) => byId(page, TestIds.ai.promptInput);

/** Fills the context the manual way: references, a PDF on the first article, and its preview open */
async function openSamplePreview(page: Page) {
    await startWithReferences(page, buildCsv(STANDARD_COLUMNS, sampleArticles(2)));
    const card = articleCard(page, 'Article 1');
    await attachPdf(card, samplePdf());
    await openPreview(page, card, SAMPLE_PAGES.length);
}

async function warmUp(page: Page) {
    // The status starts offline until the first check of the server finishes
    await expect(byId(page, TestIds.ai.statusButton)).toHaveAttribute('data-status', 'online');
    await warmUpButton(page).click();
    await expect(warmUpButton(page)).toHaveAttribute('data-state', 'ready');
}

async function ask(page: Page, prompt: string) {
    await promptInput(page).fill(prompt);
    await byId(page, TestIds.ai.promptSend).click();
    await expect(byId(page, TestIds.ai.answer)).toContainText(`Resposta mock para: ${prompt}`);
}

/** Closes the preview by clicking its backdrop */
const closePreview = (page: Page) => page.mouse.click(2, 2);

test.describe('the AI status', () => {
    test('shows it is being checked, instead of offline, until the server answers', async ({ page, ai }) => {
        ai.statusDelayMs = 1500;
        await openApp(page);

        await expect(byId(page, TestIds.ai.statusButton)).toHaveAttribute('data-checking', 'true');
        await expect(byId(page, TestIds.ai.statusButton)).toHaveAttribute('title', 'Verificando...');

        await expect(byId(page, TestIds.ai.statusButton)).toHaveAttribute('data-checking', 'false');
        await expect(byId(page, TestIds.ai.statusButton)).toHaveAttribute('data-status', 'online');
    });

    test('is online when the server answers with a loaded model', async ({ page, ai }) => {
        await openApp(page);

        await expect(byId(page, TestIds.ai.statusButton)).toHaveAttribute('data-status', 'online');
        await byId(page, TestIds.ai.statusButton).click();
        await expect(byId(page, TestIds.ai.statusValue)).toHaveText('Online');
        await expect(byId(page, TestIds.ai.provider)).toHaveValue(ai.endpoint);
        await expect(byId(page, TestIds.ai.model)).toHaveText('mock-model');
        await expect(byId(page, TestIds.ai.reconnect)).toHaveCount(0);
    });

    test('handles the offline state, and reconnects once the server is back', async ({ page, ai }) => {
        await ai.stop();
        await openApp(page);

        await expect(byId(page, TestIds.ai.statusButton)).toHaveAttribute('data-status', 'offline');
        await byId(page, TestIds.ai.statusButton).click();
        await expect(byId(page, TestIds.ai.statusValue)).toHaveText('Offline');
        await expect(byId(page, TestIds.ai.provider)).toHaveValue(ai.endpoint);

        // Still offline: reconnecting does not change anything
        await byId(page, TestIds.ai.reconnect).click();
        await expect(byId(page, TestIds.ai.statusValue)).toHaveText('Offline');

        await ai.start();
        await byId(page, TestIds.ai.reconnect).click();

        await expect(byId(page, TestIds.ai.statusValue)).toHaveText('Online');
        await expect(byId(page, TestIds.ai.reconnect)).toHaveCount(0);
        await expect(byId(page, TestIds.ai.statusButton)).toHaveAttribute('data-status', 'online');
    });

    test('does not ping the server when it reports its models', async ({ page, ai }) => {
        await openApp(page);

        await expect(byId(page, TestIds.ai.statusButton)).toHaveAttribute('data-status', 'online');
        expect(ai.pings).toBe(0);
    });

    test('falls back to a single ping when the models can not be read', async ({ page, ai }) => {
        ai.modelsStatusAvailable = false;
        await openApp(page);

        await expect(byId(page, TestIds.ai.statusButton)).toHaveAttribute('data-status', 'online');
        expect(ai.pings).toBe(1);
        await byId(page, TestIds.ai.statusButton).click();
        await expect(byId(page, TestIds.ai.statusValue)).toHaveText('Online');
        // The model is unknown, so none is shown
        await expect(byId(page, TestIds.ai.model)).toHaveCount(0);
    });

    test('is still usable when only the ping works', async ({ page, ai }) => {
        ai.modelsStatusAvailable = false;
        await openSamplePreview(page);

        await warmUp(page);
        await ask(page, 'Funciona sem o modelo carregado?');

        expect(ai.requestsOfKind('ask')).toHaveLength(1);
    });

    test('is offline when neither the models nor the ping answer', async ({ page, ai }) => {
        await ai.stop();
        await openApp(page);

        await expect(byId(page, TestIds.ai.statusButton)).toHaveAttribute('data-status', 'offline');
        await expect(byId(page, TestIds.ai.statusButton)).toHaveAttribute('data-checking', 'false');
    });

    test('is offline when the server is up but has no model loaded', async ({ page, ai }) => {
        ai.loadedModel = null;
        await openApp(page);

        await expect(byId(page, TestIds.ai.statusButton)).toHaveAttribute('data-status', 'offline');
        await byId(page, TestIds.ai.statusButton).click();
        await expect(byId(page, TestIds.ai.model)).toHaveCount(0);
        await expect(byId(page, TestIds.ai.reconnect)).toBeVisible();
        // The server answered about the models, so there is no need to ping it
        expect(ai.pings).toBe(0);
    });
});

test.describe('warming up a document', () => {
    test('is not automatic, offering to start it instead', async ({ page, ai }) => {
        await openSamplePreview(page);
        await page.waitForTimeout(1000);

        await expect(warmUpButton(page)).toHaveAttribute('data-state', 'idle');
        await expect(warmUpButton(page).locator('svg.lucide-play')).toBeVisible();
        expect(ai.requestsOfKind('organize')).toHaveLength(0);
        // Asking prepares the document then, so it is not locked
        await expect(promptInput(page)).toBeEnabled();
    });

    test('sends the extracted text to be organized, then unlocks the AI features', async ({ page, ai }) => {
        ai.chunkDelayMs = 80;
        await openSamplePreview(page);
        await expect(byId(page, TestIds.ai.statusButton)).toHaveAttribute('data-status', 'online');

        await warmUpButton(page).click();

        await expect(warmUpButton(page)).toHaveAttribute('data-state', 'running');
        await expect(warmUpButton(page)).toHaveAttribute('title', /\d+%/);
        await expect(byId(page, TestIds.ai.generatedWords)).toContainText('palavras geradas');
        await expect(warmUpButton(page).locator('svg.lucide-play')).toHaveCount(0);

        await expect(warmUpButton(page)).toHaveAttribute('data-state', 'ready');
        await expect(warmUpButton(page).locator('svg.lucide-check')).toBeVisible();
        await expect(byId(page, TestIds.ai.generatedWords)).toHaveCount(0);
        await expect(promptInput(page)).toBeEnabled();

        const [organize] = ai.requestsOfKind('organize');
        expect(ai.requestsOfKind('organize')).toHaveLength(1);
        expect(organize.text).toContain('Proteome analysis of ovarian tissue');
        expect(organize.text).toContain('Conclusion of the study');
    });

    test('asks a stub question once processed, starting like the questions so the server reuses it', async ({ page, ai }) => {
        await openSamplePreview(page);
        await warmUp(page);

        await expect.poll(() => ai.requestsOfKind('warmUp').length).toBe(1);
        const [stub] = ai.requestsOfKind('warmUp');
        expect(stub.context).toContain('# Texto organizado');
        // It is not a definition asked by the user
        expect(ai.requestsOfKind('define')).toHaveLength(0);

        await ask(page, 'Pergunta para comparar');
        const [question] = ai.requestsOfKind('ask');
        expect(stub.messages.slice(0, 2)).toEqual(question.messages.slice(0, 2));
    });

    test('keeps the text of the page hidden under the scan of the page being read', async ({ page, ai }) => {
        ai.chunkDelayMs = 150;
        await openSamplePreview(page);
        await expect(byId(page, TestIds.ai.statusButton)).toHaveAttribute('data-status', 'online');

        await warmUpButton(page).click();
        const scanned = byId(page, TestIds.preview.page).filter({ has: page.locator('[class*="readingPage"]') });
        await expect(scanned).toHaveCount(1);

        // The text layer stays over the page, with its text not drawn, as it is only there to be selected
        const layer = scanned.getByTestId(TestIds.preview.textLayer);
        await expect(layer).toHaveCSS('position', 'absolute');
        await expect(layer.locator('span').first()).toHaveCSS('color', 'rgba(0, 0, 0, 0)');
    });

    test('reports how many words were generated while it runs', async ({ page, ai }) => {
        ai.chunkDelayMs = 80;
        await openSamplePreview(page);
        await expect(byId(page, TestIds.ai.statusButton)).toHaveAttribute('data-status', 'online');
        await warmUpButton(page).click();

        const count = async () => Number((await byId(page, TestIds.ai.generatedWords).textContent())!.match(/\d+/)![0]);
        await expect(byId(page, TestIds.ai.generatedWords)).toBeVisible();
        const first = await count();
        await expect.poll(count).toBeGreaterThan(first);
    });

    test('recognizes a document warmed up before, without asking the AI again', async ({ page, ai }) => {
        await openSamplePreview(page);
        await warmUp(page);

        await page.reload();
        await openPreview(page, articleCard(page, 'Article 1'), SAMPLE_PAGES.length);

        // No click needed, it is found on what was kept from the first time
        await expect(warmUpButton(page)).toHaveAttribute('data-state', 'ready');
        await expect(promptInput(page)).toBeEnabled();
        expect(ai.requestsOfKind('organize')).toHaveLength(1);
    });

    test('can ask about a document warmed up before, using what was kept', async ({ page, ai }) => {
        await openSamplePreview(page);
        await warmUp(page);
        await page.reload();
        await openPreview(page, articleCard(page, 'Article 1'), SAMPLE_PAGES.length);
        await expect(warmUpButton(page)).toHaveAttribute('data-state', 'ready');

        await ask(page, 'Pergunta depois de recarregar');

        const [question] = ai.requestsOfKind('ask');
        expect(question.context).toContain('# Texto organizado');
        expect(ai.requestsOfKind('organize')).toHaveLength(1);
    });

    test('keeps a document that was not warmed up before waiting to be started', async ({ page, ai }) => {
        await openSamplePreview(page);
        await warmUp(page);
        await closePreview(page);
        const other = articleCard(page, 'Article 2');
        await attachPdf(other, pdfWithOtherText());

        await openPreview(page, other, 1);
        await page.waitForTimeout(500);

        await expect(warmUpButton(page)).toHaveAttribute('data-state', 'idle');
        expect(ai.requestsOfKind('organize')).toHaveLength(1);
    });

    test('starts from scratch when what was kept is gone', async ({ page, ai }) => {
        await openSamplePreview(page);
        await warmUp(page);
        await page.evaluate(() => {
            Object.keys(localStorage)
                .filter(key => /^project\/[^/]+\/cache-/.test(key))
                .forEach(key => localStorage.removeItem(key));
        });

        await page.reload();
        await openPreview(page, articleCard(page, 'Article 1'), SAMPLE_PAGES.length);
        await page.waitForTimeout(500);

        await expect(warmUpButton(page)).toHaveAttribute('data-state', 'idle');
        await warmUp(page);
        expect(ai.requestsOfKind('organize')).toHaveLength(2);
    });

    test('is ready as soon as the AI is back, for a document warmed up before', async ({ page, ai }) => {
        await openSamplePreview(page);
        await warmUp(page);
        await ai.stop();
        await page.reload();
        const card = articleCard(page, 'Article 1');
        await openPreview(page, card, SAMPLE_PAGES.length);
        await expect(warmUpButton(page)).toHaveAttribute('data-state', 'offline');
        await closePreview(page);

        await ai.start();
        await byId(page, TestIds.ai.statusButton).click();
        await byId(page, TestIds.ai.reconnect).click();
        await expect(byId(page, TestIds.ai.statusValue)).toHaveText('Online');
        await closePreview(page);
        await openPreview(page, card, SAMPLE_PAGES.length);

        await expect(warmUpButton(page)).toHaveAttribute('data-state', 'ready');
        // Only the first warm up reached the AI
        expect(ai.requestsOfKind('organize')).toHaveLength(1);
    });

    test('warms up each document on its own', async ({ page, ai }) => {
        await openSamplePreview(page);
        await warmUp(page);
        await closePreview(page);
        const second = articleCard(page, 'Article 2');
        await attachPdf(second, pdfWithOtherText());

        await openPreview(page, second, 1);

        await expect(warmUpButton(page)).toHaveAttribute('data-state', 'idle');
        expect(ai.requestsOfKind('organize')).toHaveLength(1);
    });

    test('shows the offline state, opening the AI configuration instead of starting', async ({ page, ai }) => {
        await ai.stop();
        await openSamplePreview(page);

        await expect(warmUpButton(page)).toHaveAttribute('data-state', 'offline');
        await expect(warmUpButton(page).locator('svg.lucide-x')).toBeVisible();
        await expect(promptInput(page)).toBeDisabled();

        await warmUpButton(page).click();
        await expect(byId(page, TestIds.aiWizard.root)).toBeVisible();
        expect(ai.requestsOfKind('organize')).toHaveLength(0);
    });

    test('fails when the AI errors, and can be retried', async ({ page, ai }) => {
        ai.chatStatus = 500;
        await openSamplePreview(page);
        await expect(byId(page, TestIds.ai.statusButton)).toHaveAttribute('data-status', 'online');

        await warmUpButton(page).click();
        await expect(warmUpButton(page)).toHaveAttribute('data-state', 'error');
        // Still online, so asking can try to prepare it again
        await expect(promptInput(page)).toBeEnabled();

        ai.chatStatus = 200;
        await warmUpButton(page).click();

        await expect(warmUpButton(page)).toHaveAttribute('data-state', 'ready');
        await expect(promptInput(page)).toBeEnabled();
    });
});

test.describe('asking questions', () => {
    test('warms the document up first when it was not yet', async ({ page, ai }) => {
        await openSamplePreview(page);
        await expect(byId(page, TestIds.ai.statusButton)).toHaveAttribute('data-status', 'online');

        await ask(page, 'Sem preparar antes?');

        await expect(warmUpButton(page)).toHaveAttribute('data-state', 'ready');
        expect(ai.requestsOfKind('organize')).toHaveLength(1);
        const [question] = ai.requestsOfKind('ask');
        expect(question.context).toContain('# Texto organizado');
    });

    test('answers a question using the organized text of the document', async ({ page, ai }) => {
        await openSamplePreview(page);
        await warmUp(page);

        await ask(page, 'Qual é o objetivo do estudo?');

        const [question] = ai.requestsOfKind('ask');
        expect(question.prompt).toBe('Qual é o objetivo do estudo?');
        expect(question.context).toContain('# Texto organizado');
        expect(question.context).toContain('Plasma samples were collected from women');
    });

    const MARKDOWN_ANSWER = [
        '# Resumo',
        '',
        'Texto com **negrito** e `código`.',
        '',
        '- item um',
        '- item dois',
        '',
        '| a | b |',
        '|---|---|',
        '| 1 | 2 |',
        '',
        '[um link](https://example.com)',
        '',
        '<script>window.__injected = true</script>',
    ].join('\n');

    test('formats the answer as markdown', async ({ page, ai }) => {
        ai.askAnswer = () => MARKDOWN_ANSWER;
        await openSamplePreview(page);
        await warmUp(page);

        await promptInput(page).fill('Resuma o documento');
        await byId(page, TestIds.ai.promptSend).click();

        const answer = byId(page, TestIds.ai.answer);
        await expect(answer.locator('h1')).toHaveText('Resumo');
        await expect(answer.locator('strong')).toHaveText('negrito');
        await expect(answer.locator('code')).toHaveText('código');
        await expect(answer.locator('li')).toHaveText(['item um', 'item dois']);
        await expect(answer.locator('table td')).toHaveText(['1', '2']);
        const link = answer.getByRole('link', { name: 'um link' });
        await expect(link).toHaveAttribute('href', 'https://example.com');
        await expect(link).toHaveAttribute('target', '_blank');
        // The markdown symbols are not shown as text
        await expect(answer).not.toContainText('**');
        await expect(answer).not.toContainText('# Resumo');
    });

    test('does not run the HTML that comes in an answer', async ({ page, ai }) => {
        ai.askAnswer = () => MARKDOWN_ANSWER;
        await openSamplePreview(page);
        await warmUp(page);

        await promptInput(page).fill('Resuma o documento');
        await byId(page, TestIds.ai.promptSend).click();
        await expect(byId(page, TestIds.ai.answer).locator('h1')).toBeVisible();

        await expect(byId(page, TestIds.ai.answer).locator('script')).toHaveCount(0);
        expect(await page.evaluate(() => (window as unknown as { __injected?: boolean }).__injected)).toBeUndefined();
    });

    test('formats the answer on the response window too', async ({ page, ai }) => {
        ai.askAnswer = () => MARKDOWN_ANSWER;
        await openSamplePreview(page);
        await warmUp(page);
        await promptInput(page).fill('Resuma o documento');
        await byId(page, TestIds.ai.promptSend).click();
        await expect(byId(page, TestIds.ai.answer).locator('h1')).toBeVisible();

        await byId(page, TestIds.ai.openResponseModal).click();

        const modalAnswer = byId(page, TestIds.ai.responseModalAnswer);
        await expect(modalAnswer.locator('h1')).toHaveText('Resumo');
        await expect(modalAnswer.locator('li')).toHaveCount(2);
        await expect(modalAnswer.locator('table')).toBeVisible();
    });

    /** Asks a question answered with `answer`, and returns where the answer is shown */
    async function askAnswered(page: Page, ai: Parameters<Parameters<typeof test>[2]>[0]['ai'], answer: string) {
        ai.askAnswer = () => answer;
        await openSamplePreview(page);
        await warmUp(page);
        await promptInput(page).fill('Qual a concentração?');
        await byId(page, TestIds.ai.promptSend).click();
        const shown = byId(page, TestIds.ai.answer);
        await expect(shown).toBeVisible();
        return shown;
    }

    /** The text a reader sees, without the copy of the formula kept for screen readers */
    const visibleText = (answer: ReturnType<typeof byId>) =>
        answer.evaluate(element => {
            const copy = element.cloneNode(true) as HTMLElement;
            copy.querySelectorAll('.katex-mathml').forEach(hidden => hidden.remove());
            return copy.textContent!.replace(/\s+/g, ' ').trim();
        });

    test('renders an inline formula in LaTeX', async ({ page, ai }) => {
        const answer = await askAnswered(page, ai, 'A média foi de $24.9\\,\\mu g/m^3$ no período.');

        const formula = answer.locator('.katex');
        await expect(formula).toHaveCount(1);
        // The source of the formula is kept as it was written, with its thin space
        await expect(formula.locator('annotation')).toHaveText('24.9\\,\\mu g/m^3');
        await expect(formula.locator('.msupsub')).toHaveCount(1);
        const text = await visibleText(answer);
        expect(text).toContain('μ');
        expect(text).toContain('24.9');
        // None of the LaTeX is shown as text, and the thin space is not a comma
        expect(text).not.toContain('$');
        expect(text).not.toContain('\\mu');
        expect(text).not.toContain(',');
        expect(text).toMatch(/^A média foi de .+ no período\.$/);
    });

    test('renders a formula block in LaTeX, on a line of its own', async ({ page, ai }) => {
        const answer = await askAnswered(page, ai, 'A integral é:\n\n$$\n\\int_0^1 x^2\\,dx = \\frac{1}{3}\n$$\n\nComo esperado.');

        const block = answer.locator('.katex-display');
        await expect(block).toHaveCount(1);
        await expect(block.locator('annotation')).toHaveText('\\int_0^1 x^2\\,dx = \\frac{1}{3}');
        await expect(block.locator('.mfrac')).toHaveCount(1);
        const text = await visibleText(answer);
        expect(text).toContain('A integral é:');
        expect(text).toContain('Como esperado.');
        expect(text).not.toContain('$$');
        expect(text).not.toContain('\\frac');
    });

    test('keeps money amounts with dollars as text', async ({ page, ai }) => {
        const answer = await askAnswered(page, ai, 'O kit custa $5 e o frete $10, total de $15.');

        await expect(answer.locator('.katex')).toHaveCount(0);
        expect(await visibleText(answer)).toBe('O kit custa $5 e o frete $10, total de $15.');
    });

    test('renders formulas and money amounts in the same answer', async ({ page, ai }) => {
        const answer = await askAnswered(page, ai, 'Custa $5 por amostra de $x^2$ gramas.');

        await expect(answer.locator('.katex')).toHaveCount(1);
        await expect(answer.locator('.katex annotation')).toHaveText('x^2');
        expect(await visibleText(answer)).toContain('Custa $5 por amostra de');
    });

    test('keeps dollars inside code as they are', async ({ page, ai }) => {
        const answer = await askAnswered(page, ai, 'Use `$x^2$` para escrever.');

        await expect(answer.locator('.katex')).toHaveCount(0);
        await expect(answer.locator('code')).toHaveText('$x^2$');
    });

    test('shows a formula that can not be read without breaking the rest of the answer', async ({ page, ai }) => {
        const answer = await askAnswered(page, ai, 'Antes $\\frac{1}{$ e depois.');

        expect(await visibleText(answer)).toContain('Antes');
        expect(await visibleText(answer)).toContain('e depois.');
        await expect(answer.locator('.katex-error')).toHaveCount(1);
    });

    test('renders the formulas on the response window too', async ({ page, ai }) => {
        await askAnswered(page, ai, 'A média foi de $24.9\\,\\mu g/m^3$.');

        await byId(page, TestIds.ai.openResponseModal).click();

        await expect(byId(page, TestIds.ai.responseModalAnswer).locator('.katex annotation')).toHaveText('24.9\\,\\mu g/m^3');
    });

    test('keeps showing plain text answers as they are', async ({ page }) => {
        await openSamplePreview(page);
        await warmUp(page);

        await ask(page, 'Pergunta simples');

        await expect(byId(page, TestIds.ai.answer).locator('p')).toHaveText('Resposta mock para: Pergunta simples');
    });

    test('sends the question with Enter', async ({ page }) => {
        await openSamplePreview(page);
        await warmUp(page);

        await promptInput(page).fill('Pergunta com enter');
        await promptInput(page).press('Enter');

        await expect(byId(page, TestIds.ai.answer)).toContainText('Resposta mock para: Pergunta com enter');
    });

    test('breaks the line with Shift+Enter, without sending the question', async ({ page, ai }) => {
        await openSamplePreview(page);
        await warmUp(page);
        const height = (await promptInput(page).boundingBox())!.height;

        await promptInput(page).fill('Primeira linha');
        await promptInput(page).press('Shift+Enter');
        await promptInput(page).pressSequentially('Segunda linha');

        await expect(promptInput(page)).toHaveValue('Primeira linha\nSegunda linha');
        expect(ai.requestsOfKind('ask')).toHaveLength(0);
        await expect(byId(page, TestIds.ai.answer)).toHaveCount(0);
        // The field grows to show the new line
        await expect.poll(async () => (await promptInput(page).boundingBox())!.height).toBeGreaterThan(height);
    });

    test('sends the question with its lines with Enter', async ({ page, ai }) => {
        await openSamplePreview(page);
        await warmUp(page);
        await promptInput(page).fill('Primeira linha');
        await promptInput(page).press('Shift+Enter');
        await promptInput(page).pressSequentially('Segunda linha');

        await promptInput(page).press('Enter');

        await expect(byId(page, TestIds.ai.answer)).toContainText('Resposta mock para: Primeira linha');
        const [question] = ai.requestsOfKind('ask');
        expect(question.prompt).toBe('Primeira linha\nSegunda linha');
        // Enter does not leave a line break behind in the field
        await expect(promptInput(page)).toHaveValue('Primeira linha\nSegunda linha');
    });

    test('shrinks the field back when the lines are erased', async ({ page }) => {
        await openSamplePreview(page);
        await warmUp(page);
        const height = (await promptInput(page).boundingBox())!.height;
        await promptInput(page).fill('Um\nDois\nTrês');
        await expect.poll(async () => (await promptInput(page).boundingBox())!.height).toBeGreaterThan(height);

        await promptInput(page).fill('Um');

        await expect.poll(async () => (await promptInput(page).boundingBox())!.height).toBeCloseTo(height, 0);
    });

    test('lists the previous questions, newest first', async ({ page }) => {
        await openSamplePreview(page);
        await warmUp(page);
        await ask(page, 'Primeira pergunta');
        await ask(page, 'Segunda pergunta');

        await byId(page, TestIds.ai.historyToggle).click();

        const items = byId(page, TestIds.ai.historyItem);
        await expect(items).toHaveCount(2);
        await expect(items.nth(0)).toContainText('Segunda pergunta');
        await expect(items.nth(1)).toContainText('Primeira pergunta');
    });

    test('shows the remove button over the entry that is hovered', async ({ page }) => {
        await openSamplePreview(page);
        await warmUp(page);
        await ask(page, 'Primeira pergunta');
        await ask(page, 'Segunda pergunta');
        await byId(page, TestIds.ai.historyToggle).click();
        const [newest, oldest] = await byId(page, TestIds.ai.historyItem).all();

        await expect(newest.getByTestId(TestIds.ai.historyRemove)).toHaveCSS('opacity', '0');
        await newest.hover();

        await expect(newest.getByTestId(TestIds.ai.historyRemove)).toHaveCSS('opacity', '1');
        // Only the hovered entry shows it
        await expect(oldest.getByTestId(TestIds.ai.historyRemove)).toHaveCSS('opacity', '0');
    });

    test('shows the remove button at the top right of the entry', async ({ page }) => {
        await openSamplePreview(page);
        await warmUp(page);
        await ask(page, 'Primeira pergunta');
        await byId(page, TestIds.ai.historyToggle).click();
        const entry = byId(page, TestIds.ai.historyItem).first();
        await entry.hover();

        const entryBox = (await entry.boundingBox())!;
        const removeBox = (await entry.getByTestId(TestIds.ai.historyRemove).boundingBox())!;

        expect(entryBox.x + entryBox.width - (removeBox.x + removeBox.width)).toBeLessThan(12);
        expect(removeBox.y - entryBox.y).toBeLessThan(12);
    });

    test('removes only that entry from the history', async ({ page }) => {
        await openSamplePreview(page);
        await warmUp(page);
        await ask(page, 'Primeira pergunta');
        await ask(page, 'Segunda pergunta');
        await ask(page, 'Terceira pergunta');
        await byId(page, TestIds.ai.historyToggle).click();
        const items = byId(page, TestIds.ai.historyItem);
        await expect(items).toHaveCount(3);

        await items.filter({ hasText: 'Segunda pergunta' }).hover();
        await items.filter({ hasText: 'Segunda pergunta' }).getByTestId(TestIds.ai.historyRemove).click();

        await expect(items).toHaveCount(2);
        await expect(items.nth(0)).toContainText('Terceira pergunta');
        await expect(items.nth(1)).toContainText('Primeira pergunta');
        // It does not bring the removed entry to the prompt, and the history stays open
        await expect(promptInput(page)).toHaveValue('Terceira pergunta');
        await expect(items.first()).toBeVisible();
    });

    test('keeps the entry removed after reloading', async ({ page }) => {
        await openSamplePreview(page);
        await warmUp(page);
        await ask(page, 'Primeira pergunta');
        await ask(page, 'Segunda pergunta');
        await byId(page, TestIds.ai.historyToggle).click();
        await byId(page, TestIds.ai.historyItem).filter({ hasText: 'Primeira pergunta' }).hover();
        await byId(page, TestIds.ai.historyItem).filter({ hasText: 'Primeira pergunta' }).getByTestId(TestIds.ai.historyRemove).click();

        await page.reload();
        await openPreview(page, articleCard(page, 'Article 1'), SAMPLE_PAGES.length);
        await byId(page, TestIds.ai.historyToggle).click();

        await expect(byId(page, TestIds.ai.historyItem)).toHaveCount(1);
        await expect(byId(page, TestIds.ai.historyItem)).toContainText('Segunda pergunta');
    });

    test('shows the empty history after removing the last entry', async ({ page }) => {
        await openSamplePreview(page);
        await warmUp(page);
        await ask(page, 'Única pergunta');
        await byId(page, TestIds.ai.historyToggle).click();
        await byId(page, TestIds.ai.historyItem).hover();

        await byId(page, TestIds.ai.historyRemove).click();

        await expect(byId(page, TestIds.ai.historyItem)).toHaveCount(0);
        await expect(page.getByText('Nenhuma pergunta ainda')).toBeVisible();
    });

    test('can be removed with the keyboard', async ({ page }) => {
        await openSamplePreview(page);
        await warmUp(page);
        await ask(page, 'Pergunta do teclado');
        await byId(page, TestIds.ai.historyToggle).click();

        await byId(page, TestIds.ai.historyRemove).focus();
        await expect(byId(page, TestIds.ai.historyRemove)).toHaveCSS('opacity', '1');
        await page.keyboard.press('Enter');

        await expect(byId(page, TestIds.ai.historyItem)).toHaveCount(0);
    });

    test('does not repeat a question asked again with the same wording', async ({ page, ai }) => {
        await openSamplePreview(page);
        await warmUp(page);
        await ask(page, 'Qual é o objetivo?');
        await ask(page, 'Outra pergunta');

        // Same wording, only the case, accents, punctuation and spacing change
        await ask(page, '  qual e o  OBJETIVO ');

        await byId(page, TestIds.ai.historyToggle).click();
        const items = byId(page, TestIds.ai.historyItem);
        await expect(items).toHaveCount(2);
        // The question asked again goes to the top, as it was asked last
        await expect(items.nth(0)).toContainText('qual e o OBJETIVO');
        await expect(items.nth(1)).toContainText('Outra pergunta');
        expect(ai.requestsOfKind('ask')).toHaveLength(3);
    });

    test('keeps a different wording as another question', async ({ page }) => {
        await openSamplePreview(page);
        await warmUp(page);
        await ask(page, 'Qual é o objetivo?');
        await ask(page, 'Qual é o objetivo principal?');

        await byId(page, TestIds.ai.historyToggle).click();

        await expect(byId(page, TestIds.ai.historyItem)).toHaveCount(2);
    });

    test('does not send the question twice while it is being answered', async ({ page, ai }) => {
        await openSamplePreview(page);
        await warmUp(page);
        ai.chunkDelayMs = 300;
        await promptInput(page).fill('Pergunta lenta');

        await promptInput(page).press('Enter');
        await promptInput(page).press('Enter');
        await promptInput(page).press('Enter');

        await expect(byId(page, TestIds.ai.answer)).toContainText('Resposta mock para: Pergunta lenta');
        expect(ai.requestsOfKind('ask')).toHaveLength(1);
        await byId(page, TestIds.ai.historyToggle).click();
        await expect(byId(page, TestIds.ai.historyItem)).toHaveCount(1);
    });

    test('brings back a previous question and its answer', async ({ page }) => {
        await openSamplePreview(page);
        await warmUp(page);
        await ask(page, 'Primeira pergunta');
        await ask(page, 'Segunda pergunta');

        await byId(page, TestIds.ai.historyToggle).click();
        await byId(page, TestIds.ai.historyItem).nth(1).click();

        await expect(promptInput(page)).toHaveValue('Primeira pergunta');
        await expect(byId(page, TestIds.ai.answer)).toContainText('Resposta mock para: Primeira pergunta');
    });

    test('keeps the history after reloading', async ({ page }) => {
        await openSamplePreview(page);
        await warmUp(page);
        await ask(page, 'Pergunta guardada');

        await page.reload();
        await openPreview(page, articleCard(page, 'Article 1'), SAMPLE_PAGES.length);
        await byId(page, TestIds.ai.historyToggle).click();

        await expect(byId(page, TestIds.ai.historyItem)).toHaveCount(1);
        await expect(byId(page, TestIds.ai.historyItem)).toContainText('Pergunta guardada');
    });

    test('has no button to clear the whole history', async ({ page }) => {
        await openSamplePreview(page);
        await warmUp(page);
        await ask(page, 'Pergunta qualquer');

        await byId(page, TestIds.ai.historyToggle).click();

        await expect(byId(page, TestIds.ai.historyPanel)).toBeVisible();
        await expect(byId(page, TestIds.ai.historyPanel).getByText('Limpar histórico')).toHaveCount(0);
    });

    test('keeps a separate history for each document', async ({ page }) => {
        await openSamplePreview(page);
        await warmUp(page);
        await ask(page, 'Pergunta do primeiro');
        await closePreview(page);
        const second = articleCard(page, 'Article 2');
        await attachPdf(second, pdfWithOtherText());
        await openPreview(page, second, 1);
        await warmUp(page);

        await byId(page, TestIds.ai.historyToggle).click();

        await expect(byId(page, TestIds.ai.historyItem)).toHaveCount(0);
    });

    test('shows an error, without saving it to the history, when the AI fails', async ({ page, ai }) => {
        await openSamplePreview(page);
        await warmUp(page);
        ai.chatStatus = 500;

        await promptInput(page).fill('Isso vai falhar');
        await byId(page, TestIds.ai.promptSend).click();

        await expect(byId(page, TestIds.ai.promptError)).toBeVisible();
        await byId(page, TestIds.ai.historyToggle).click();
        await expect(byId(page, TestIds.ai.historyItem)).toHaveCount(0);
    });

    test('shows an error when the AI goes offline after the warm up', async ({ page, ai }) => {
        await openSamplePreview(page);
        await warmUp(page);
        await ai.stop();

        await promptInput(page).fill('Ninguém para responder');
        await byId(page, TestIds.ai.promptSend).click();

        await expect(byId(page, TestIds.ai.promptError)).toBeVisible();
    });

    test('does not send an empty question', async ({ page }) => {
        await openSamplePreview(page);
        await warmUp(page);

        await promptInput(page).fill('   ');

        await expect(byId(page, TestIds.ai.promptSend)).toBeDisabled();
    });
});

test.describe('defining words', () => {
    async function defineSelected(page: Page, word: string) {
        let message: string | undefined;
        page.once('dialog', dialog => {
            message = dialog.message();
            dialog.accept();
        });
        await selectWord(page, word);
        await byId(page, TestIds.menu.define).click();
        await expect.poll(() => message).toBeDefined();
        return message!;
    }

    test('defines the selected word using the organized text of the document', async ({ page, ai }) => {
        await openSamplePreview(page);
        await warmUp(page);

        const definition = await defineSelected(page, SAMPLE_WORD);

        // The first occurrence is capitalized on the document, and the definition keeps what was selected
        expect(definition).toBe('Definição mock de Proteome');
        const [request] = ai.requestsOfKind('define');
        expect(request.word).toBe('Proteome');
        expect(request.context).toContain('# Texto organizado');
        expect(request.context).toContain('Discussion about acetyl-proteomic profiles');
        await expect(byId(page, TestIds.menu.root)).toHaveCount(0);
    });

    test('starts with the same message as the questions, so the server can reuse its cache', async ({ page, ai }) => {
        await openSamplePreview(page);
        await warmUp(page);
        await ask(page, 'Pergunta para comparar');

        await defineSelected(page, SAMPLE_WORD);

        const [question] = ai.requestsOfKind('ask');
        const [definition] = ai.requestsOfKind('define');
        // The server only reuses what it processed before up to the first difference
        for (const request of [question, definition]) {
            expect(request.messages.map(message => message.role)).toEqual(['user', 'assistant', 'user']);
        }
        expect(definition.messages.slice(0, 2)).toEqual(question.messages.slice(0, 2));
        expect(definition.messages[0].content).toContain(question.context);
        expect(definition.messages[2].content).not.toBe(question.messages[2].content);
    });

    test('warms the document up first when it was not yet, showing its progress', async ({ page, ai }) => {
        ai.chunkDelayMs = 80;
        await openSamplePreview(page);
        await expect(byId(page, TestIds.ai.statusButton)).toHaveAttribute('data-status', 'online');

        const defined = defineSelected(page, SAMPLE_WORD);
        await expect(warmUpButton(page)).toHaveAttribute('data-state', 'running');

        expect(await defined).toBe('Definição mock de Proteome');
        await expect(warmUpButton(page)).toHaveAttribute('data-state', 'ready');
        expect(ai.requestsOfKind('organize')).toHaveLength(1);
        const [request] = ai.requestsOfKind('define');
        expect(request.context).toContain('# Texto organizado');
    });

    test('is locked when the AI is offline', async ({ page, ai }) => {
        await ai.stop();
        await openSamplePreview(page);

        await selectWord(page, SAMPLE_WORD);

        await expect(byId(page, TestIds.menu.define)).toBeDisabled();
        await expect(byId(page, TestIds.menu.highlight)).toBeEnabled();
    });

    test('tells the error when the AI fails', async ({ page, ai }) => {
        await openSamplePreview(page);
        await warmUp(page);
        ai.chatStatus = 500;

        const message = await defineSelected(page, SAMPLE_WORD);

        expect(message).toMatch(/^Error:/);
    });
});

/** A different document, so it does not share the cache or the history with the sample one */
function pdfWithOtherText() {
    return pdfFile('other.pdf', [['A completely different document about lipids']]);
}

test.describe('finding the reference of a passage', () => {
    // More than 5 words, as the action is only offered for a passage
    const PASSAGE = 'Plasma samples were collected from women';
    const referenceModal = (page: Page) => byId(page, TestIds.ai.referenceModal);
    const referenceAnswer = (page: Page) => byId(page, TestIds.ai.referenceModalAnswer);

    async function findReference(page: Page, passage = PASSAGE) {
        await selectWord(page, passage);
        await byId(page, TestIds.menu.reference).click();
    }

    test('is available before the document is warmed up', async ({ page }) => {
        await openSamplePreview(page);
        await expect(byId(page, TestIds.ai.statusButton)).toHaveAttribute('data-status', 'online');

        await selectWord(page, PASSAGE);

        await expect(byId(page, TestIds.menu.reference)).toBeEnabled();
    });

    test('is locked when the AI is offline', async ({ page, ai }) => {
        await ai.stop();
        await openSamplePreview(page);

        await selectWord(page, PASSAGE);

        await expect(byId(page, TestIds.menu.reference)).toBeDisabled();
    });

    test('shows the reference found for the selected passage', async ({ page }) => {
        await openSamplePreview(page);
        await warmUp(page);

        await findReference(page);

        await expect(referenceModal(page)).toBeVisible();
        await expect(referenceModal(page)).toContainText('Referência');
        await expect(referenceModal(page)).toContainText('Trecho selecionado');
        await expect(referenceModal(page)).toContainText(PASSAGE);
        // Formatted as markdown, like the other answers
        await expect(referenceAnswer(page).locator('li')).toHaveText(`Referência mock para: ${PASSAGE}`);
        await expect(byId(page, TestIds.menu.root)).toHaveCount(0);
    });

    test('looks for it with the organized text of the document, after the same start as the other features', async ({ page, ai }) => {
        await openSamplePreview(page);
        await warmUp(page);
        await ask(page, 'Pergunta para comparar');

        await findReference(page);
        await expect(referenceModal(page)).toBeVisible();

        const [request] = ai.requestsOfKind('reference');
        const [question] = ai.requestsOfKind('ask');
        expect(request.passage).toBe(PASSAGE);
        expect(request.context).toContain('# Texto organizado');
        // The server can reuse what it processed for the question
        expect(request.messages.slice(0, 2)).toEqual(question.messages.slice(0, 2));
    });

    test('lists every reference found', async ({ page, ai }) => {
        ai.referenceAnswer = () => '- Smith J. Proteomics of aging. 2019.\n- Lee K. Menopause and plasma. 2021.';
        await openSamplePreview(page);
        await warmUp(page);

        await findReference(page);

        await expect(referenceAnswer(page).locator('li')).toHaveText(['Smith J. Proteomics of aging. 2019.', 'Lee K. Menopause and plasma. 2021.']);
    });

    test('tells when the passage cites no reference of the document', async ({ page, ai }) => {
        ai.referenceAnswer = () => 'NOT_FOUND';
        await openSamplePreview(page);
        await warmUp(page);

        await findReference(page);

        await expect(referenceAnswer(page)).toHaveText('Nenhuma referência encontrada para este trecho no documento.');
        await expect(referenceAnswer(page)).not.toContainText('NOT_FOUND');
    });

    test('closes with its button and by clicking out of it', async ({ page }) => {
        await openSamplePreview(page);
        await warmUp(page);
        await findReference(page);

        await referenceModal(page).getByRole('button', { name: 'Fechar' }).click();
        await expect(referenceModal(page)).toHaveCount(0);

        await findReference(page);
        await referenceModal(page).click({ position: { x: 5, y: 5 } });
        await expect(referenceModal(page)).toHaveCount(0);
        // The document stays open
        await expect(byId(page, TestIds.preview.box)).toBeVisible();
    });

    test('does not ask the AI again for the same passage', async ({ page, ai }) => {
        await openSamplePreview(page);
        await warmUp(page);
        await findReference(page);
        await referenceModal(page).getByRole('button', { name: 'Fechar' }).click();

        await findReference(page);

        await expect(referenceAnswer(page)).toContainText(PASSAGE);
        expect(ai.requestsOfKind('reference')).toHaveLength(1);
    });

    /** Clicks a search of the window and returns what was searched on Google */
    async function searchedFor(page: Page, button: ReturnType<typeof byId>) {
        const [tab] = await Promise.all([page.context().waitForEvent('page'), button.click()]);
        const url = new URL(tab.url());
        expect(url.hostname).toBe('www.google.com');
        expect(url.pathname).toBe('/search');
        return url.searchParams.get('q');
    }

    test('searches the reference found on Google', async ({ page }) => {
        await openSamplePreview(page);
        await warmUp(page);
        await findReference(page);

        const search = byId(page, TestIds.ai.referenceSearch);
        await expect(search).toHaveCount(1);
        await expect(search).toHaveText('Pesquisar no Google');

        expect(await searchedFor(page, search)).toBe(`Referência mock para: ${PASSAGE}`);
        // The window stays open, to search the others or read it again
        await expect(referenceModal(page)).toBeVisible();
    });

    test('offers a search for each reference found', async ({ page, ai }) => {
        ai.referenceAnswer = () => '- Smith J. Proteomics of aging. 2019.\n- Lee K. Menopause and plasma. 2021.';
        await openSamplePreview(page);
        await warmUp(page);
        await findReference(page);

        const searches = byId(page, TestIds.ai.referenceSearch);
        await expect(searches).toHaveCount(2);
        await expect(searches.nth(0)).toContainText('Smith J.');
        await expect(searches.nth(1)).toContainText('Lee K.');

        expect(await searchedFor(page, searches.nth(1))).toBe('Lee K. Menopause and plasma. 2021.');
    });

    test('searches the reference as plain text, without the formatting of the answer', async ({ page, ai }) => {
        ai.referenceAnswer = () => '1. **Smith J.** _Proteomics of aging_. [Cell](https://example.com). `2019`.';
        await openSamplePreview(page);
        await warmUp(page);
        await findReference(page);

        expect(await searchedFor(page, byId(page, TestIds.ai.referenceSearch))).toBe('Smith J. Proteomics of aging. Cell. 2019.');
    });

    test('does not offer a search when no reference was found', async ({ page, ai }) => {
        ai.referenceAnswer = () => 'NOT_FOUND';
        await openSamplePreview(page);
        await warmUp(page);

        await findReference(page);

        await expect(referenceAnswer(page)).toContainText('Nenhuma referência encontrada');
        await expect(byId(page, TestIds.ai.referenceSearch)).toHaveCount(0);
    });

    test('does not offer a search on the answers to the questions', async ({ page }) => {
        await openSamplePreview(page);
        await warmUp(page);
        await ask(page, 'Pergunta qualquer');

        await byId(page, TestIds.ai.openResponseModal).click();

        await expect(byId(page, TestIds.ai.responseModal)).toBeVisible();
        await expect(byId(page, TestIds.ai.referenceSearch)).toHaveCount(0);
    });

    test('offers to try again when the AI fails, keeping the passage selected', async ({ page, ai }) => {
        await openSamplePreview(page);
        await warmUp(page);
        ai.chatStatus = 500;

        await findReference(page);

        await expect(byId(page, TestIds.menu.reference)).toHaveText('Tentar novamente');
        await expect(referenceModal(page)).toHaveCount(0);

        ai.chatStatus = 200;
        await byId(page, TestIds.menu.reference).click();
        await expect(referenceModal(page)).toBeVisible();
    });
});

test.describe('local and global questions', () => {
    const items = (page: Page) => byId(page, TestIds.ai.historyItem);
    const item = (page: Page, prompt: string) => items(page).filter({ hasText: prompt });
    const openHistory = async (page: Page) => {
        await byId(page, TestIds.ai.historyToggle).click();
        await expect(byId(page, TestIds.ai.historyPanel)).toBeVisible();
    };
    const showTab = async (page: Page, scope: 'local' | 'global') => {
        await byId(page, scope === 'local' ? TestIds.ai.historyTabLocal : TestIds.ai.historyTabGlobal).click();
        await expect(byId(page, TestIds.ai.historyPanel)).toHaveAttribute('data-scope', scope);
    };
    const switchOf = (page: Page, prompt: string) => item(page, prompt).getByTestId(TestIds.ai.historyScopeSwitch);

    /** Leaves the open document and opens another one, with another text, on the second article */
    async function openOtherDocument(page: Page) {
        await closePreview(page);
        const second = articleCard(page, 'Article 2');
        await attachPdf(second, pdfWithOtherText());
        await openPreview(page, second, 1);
        await warmUp(page);
    }

    test('shows the local questions first, with a tab for the global ones', async ({ page }) => {
        await openSamplePreview(page);
        await warmUp(page);
        await ask(page, 'Pergunta local');

        await openHistory(page);

        await expect(byId(page, TestIds.ai.historyPanel)).toHaveAttribute('data-scope', 'local');
        await expect(byId(page, TestIds.ai.historyTabLocal)).toHaveText('Local');
        await expect(byId(page, TestIds.ai.historyTabGlobal)).toHaveText('Global');
        await expect(item(page, 'Pergunta local')).toHaveCount(1);
    });

    test('makes every question local when it is asked', async ({ page }) => {
        await openSamplePreview(page);
        await warmUp(page);
        await openHistory(page);
        await showTab(page, 'global');
        await byId(page, TestIds.ai.historyToggle).click();

        await ask(page, 'Pergunta nova');
        await openHistory(page);

        // Even asked with the global tab chosen
        await showTab(page, 'global');
        await expect(items(page)).toHaveCount(0);
        await expect(byId(page, TestIds.ai.historyPanel)).toContainText('Nenhuma pergunta global ainda');
        await showTab(page, 'local');
        await expect(item(page, 'Pergunta nova')).toHaveCount(1);
        await expect(switchOf(page, 'Pergunta nova')).toHaveAttribute('aria-checked', 'false');
    });

    test('offers to move each question with a document icon, a switch and a globe icon, in that order', async ({ page }) => {
        await openSamplePreview(page);
        await warmUp(page);
        await ask(page, 'Pergunta qualquer');
        await openHistory(page);

        const toggle = item(page, 'Pergunta qualquer').getByTestId(TestIds.ai.historyScopeToggle);
        const [documentIcon, theSwitch, globeIcon] = await Promise.all([
            toggle.locator('svg.lucide-file-text').boundingBox(),
            toggle.getByTestId(TestIds.ai.historyScopeSwitch).boundingBox(),
            toggle.locator('svg.lucide-globe').boundingBox(),
        ]);
        expect(documentIcon!.x).toBeLessThan(theSwitch!.x);
        expect(theSwitch!.x).toBeLessThan(globeIcon!.x);
    });

    test('moves a question to the global ones with the switch', async ({ page }) => {
        await openSamplePreview(page);
        await warmUp(page);
        await ask(page, 'Pergunta para todos');
        await ask(page, 'Pergunta só daqui');
        await openHistory(page);

        await switchOf(page, 'Pergunta para todos').click();

        await expect(item(page, 'Pergunta para todos')).toHaveCount(0);
        await expect(item(page, 'Pergunta só daqui')).toHaveCount(1);
        await showTab(page, 'global');
        await expect(items(page)).toHaveCount(1);
        await expect(item(page, 'Pergunta para todos')).toHaveCount(1);
        await expect(switchOf(page, 'Pergunta para todos')).toHaveAttribute('aria-checked', 'true');
    });

    test('does not load the question on the prompt when the switch is used', async ({ page }) => {
        await openSamplePreview(page);
        await warmUp(page);
        await ask(page, 'Primeira pergunta');
        await ask(page, 'Segunda pergunta');
        await openHistory(page);

        await switchOf(page, 'Primeira pergunta').click();

        await expect(byId(page, TestIds.ai.historyPanel)).toBeVisible();
        await expect(promptInput(page)).toHaveValue('Segunda pergunta');
    });

    test('offers the global questions on every document, and not the local ones', async ({ page }) => {
        await openSamplePreview(page);
        await warmUp(page);
        await ask(page, 'Pergunta global');
        await ask(page, 'Pergunta local');
        await openHistory(page);
        await switchOf(page, 'Pergunta global').click();
        await expect(item(page, 'Pergunta global')).toHaveCount(0);

        await openOtherDocument(page);
        await openHistory(page);

        await expect(items(page)).toHaveCount(0);
        await showTab(page, 'global');
        await expect(item(page, 'Pergunta global')).toHaveCount(1);
        // It tells the document it was asked about
        await expect(item(page, 'Pergunta global')).toContainText('sample.pdf');
    });

    test('brings a global question to the prompt, without the answer about another document', async ({ page }) => {
        await openSamplePreview(page);
        await warmUp(page);
        await ask(page, 'Pergunta global');
        await openHistory(page);
        await switchOf(page, 'Pergunta global').click();
        await expect(item(page, 'Pergunta global')).toHaveCount(0);
        await openOtherDocument(page);
        await openHistory(page);
        await showTab(page, 'global');

        await item(page, 'Pergunta global').click();

        await expect(promptInput(page)).toHaveValue('Pergunta global');
        await expect(byId(page, TestIds.ai.answer)).toHaveCount(0);
        // It can be asked about this document then
        await promptInput(page).press('Enter');
        await expect(byId(page, TestIds.ai.answer)).toContainText('Resposta mock para: Pergunta global');
    });

    test('brings a global question with its answer on the document it was asked about', async ({ page }) => {
        await openSamplePreview(page);
        await warmUp(page);
        await ask(page, 'Pergunta global');
        await ask(page, 'Outra pergunta');
        await openHistory(page);
        await switchOf(page, 'Pergunta global').click();
        await showTab(page, 'global');

        await item(page, 'Pergunta global').click();

        await expect(promptInput(page)).toHaveValue('Pergunta global');
        await expect(byId(page, TestIds.ai.answer)).toContainText('Resposta mock para: Pergunta global');
    });

    test('moves a global question back to the local ones of the document that is open', async ({ page }) => {
        await openSamplePreview(page);
        await warmUp(page);
        await ask(page, 'Pergunta global');
        await openHistory(page);
        await switchOf(page, 'Pergunta global').click();
        await expect(item(page, 'Pergunta global')).toHaveCount(0);
        await openOtherDocument(page);
        await openHistory(page);
        await showTab(page, 'global');

        await switchOf(page, 'Pergunta global').click();

        await expect(items(page)).toHaveCount(0);
        await showTab(page, 'local');
        await expect(item(page, 'Pergunta global')).toHaveCount(1);
        await expect(switchOf(page, 'Pergunta global')).toHaveAttribute('aria-checked', 'false');
    });

    test('keeps where each question is after reloading', async ({ page }) => {
        await openSamplePreview(page);
        await warmUp(page);
        await ask(page, 'Pergunta global');
        await ask(page, 'Pergunta local');
        await openHistory(page);
        await switchOf(page, 'Pergunta global').click();
        await expect(item(page, 'Pergunta global')).toHaveCount(0);

        await page.reload();
        await openPreview(page, articleCard(page, 'Article 1'), SAMPLE_PAGES.length);
        await openHistory(page);

        await expect(items(page)).toHaveCount(1);
        await expect(item(page, 'Pergunta local')).toHaveCount(1);
        await showTab(page, 'global');
        await expect(items(page)).toHaveCount(1);
        await expect(item(page, 'Pergunta global')).toHaveCount(1);
    });

    test('does not repeat a global question with the same wording', async ({ page }) => {
        await openSamplePreview(page);
        await warmUp(page);
        await ask(page, 'Qual é o objetivo?');
        await openHistory(page);
        await switchOf(page, 'Qual é o objetivo?').click();
        await expect(items(page)).toHaveCount(0);
        await byId(page, TestIds.ai.historyToggle).click();

        await ask(page, 'qual e o OBJETIVO');
        await openHistory(page);
        await switchOf(page, 'qual e o OBJETIVO').click();
        await showTab(page, 'global');

        await expect(items(page)).toHaveCount(1);
        await expect(items(page)).toContainText('qual e o OBJETIVO');
    });

    test('removes a global question', async ({ page }) => {
        await openSamplePreview(page);
        await warmUp(page);
        await ask(page, 'Pergunta global');
        await openHistory(page);
        await switchOf(page, 'Pergunta global').click();
        await showTab(page, 'global');

        await item(page, 'Pergunta global').hover();
        await item(page, 'Pergunta global').getByTestId(TestIds.ai.historyRemove).click();

        await expect(items(page)).toHaveCount(0);
        await expect(byId(page, TestIds.ai.historyPanel)).toContainText('Nenhuma pergunta global ainda');
    });

    test('animates the questions that leave and enter the list', async ({ page }) => {
        await openSamplePreview(page);
        await warmUp(page);
        await ask(page, 'Primeira pergunta');
        await ask(page, 'Segunda pergunta');
        await openHistory(page);
        // Each question is wrapped by the animated list
        const wrapped = await items(page).evaluateAll(entries => entries.every(entry => entry.closest('[class*="resetHeight"]')));
        expect(wrapped).toBe(true);

        await switchOf(page, 'Primeira pergunta').click();

        // It stays a moment while it leaves, instead of vanishing at once
        const heights: number[] = [];
        for (let i = 0; i < 6; i++) {
            const leaving = item(page, 'Primeira pergunta');
            heights.push((await leaving.count()) ? ((await leaving.boundingBox())?.height ?? 0) : 0);
            await page.waitForTimeout(60);
        }
        expect(heights[0]).toBeGreaterThan(0);
        await expect(item(page, 'Primeira pergunta')).toHaveCount(0);
    });
});
