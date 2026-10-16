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
        await expect(byId(page, TestIds.ai.endpoint)).toHaveText(ai.endpoint);
        await expect(byId(page, TestIds.ai.model)).toHaveText('mock-model');
        await expect(byId(page, TestIds.ai.reconnect)).toHaveCount(0);
    });

    test('handles the offline state, and reconnects once the server is back', async ({ page, ai }) => {
        await ai.stop();
        await openApp(page);

        await expect(byId(page, TestIds.ai.statusButton)).toHaveAttribute('data-status', 'offline');
        await byId(page, TestIds.ai.statusButton).click();
        await expect(byId(page, TestIds.ai.statusValue)).toHaveText('Offline');
        await expect(byId(page, TestIds.ai.endpoint)).toHaveText(ai.endpoint);

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
        await expect(promptInput(page)).toBeDisabled();
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
                .filter(key => key.startsWith('cache-'))
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

    test('shows the offline state, without being able to start', async ({ page, ai }) => {
        await ai.stop();
        await openSamplePreview(page);

        await expect(warmUpButton(page)).toHaveAttribute('data-state', 'offline');
        await expect(warmUpButton(page).locator('svg.lucide-x')).toBeVisible();
        await expect(warmUpButton(page)).toBeDisabled();
        await expect(promptInput(page)).toBeDisabled();
    });

    test('fails when the AI errors, and can be retried', async ({ page, ai }) => {
        ai.chatStatus = 500;
        await openSamplePreview(page);
        await expect(byId(page, TestIds.ai.statusButton)).toHaveAttribute('data-status', 'online');

        await warmUpButton(page).click();
        await expect(warmUpButton(page)).toHaveAttribute('data-state', 'error');
        await expect(promptInput(page)).toBeDisabled();

        ai.chatStatus = 200;
        await warmUpButton(page).click();

        await expect(warmUpButton(page)).toHaveAttribute('data-state', 'ready');
        await expect(promptInput(page)).toBeEnabled();
    });
});

test.describe('asking questions', () => {
    test('is locked until the document is warmed up', async ({ page }) => {
        await openSamplePreview(page);

        await expect(promptInput(page)).toBeDisabled();
        await expect(byId(page, TestIds.ai.promptSend)).toBeDisabled();
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

    test('keeps the history after reloading, and can clear it', async ({ page }) => {
        await openSamplePreview(page);
        await warmUp(page);
        await ask(page, 'Pergunta guardada');

        await page.reload();
        await openPreview(page, articleCard(page, 'Article 1'), SAMPLE_PAGES.length);
        await byId(page, TestIds.ai.historyToggle).click();
        await expect(byId(page, TestIds.ai.historyItem)).toHaveCount(1);

        await byId(page, TestIds.ai.historyClear).click();

        await expect(byId(page, TestIds.ai.historyItem)).toHaveCount(0);
        await expect(page.getByText('Nenhuma pergunta ainda')).toBeVisible();
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

    test('is locked until the document is warmed up, keeping the other actions', async ({ page }) => {
        await openSamplePreview(page);

        await selectWord(page, SAMPLE_WORD);

        await expect(byId(page, TestIds.menu.define)).toBeDisabled();
        await expect(byId(page, TestIds.menu.highlight)).toBeEnabled();
        await expect(byId(page, TestIds.menu.markLocation)).toBeEnabled();
        await expect(byId(page, TestIds.menu.searchOnGoogle)).toBeEnabled();
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
