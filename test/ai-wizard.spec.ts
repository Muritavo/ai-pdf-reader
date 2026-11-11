import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { test, expect } from './utils/fixtures';
import { articleCard, attachPdf, byId, goToFullTexts, openApp, openPreview, startWithReferences, uploadReferences } from './utils/app';
import { buildCsv, sampleArticles, STANDARD_COLUMNS } from './utils/csv';
import { SAMPLE_PAGES, samplePdf } from './utils/pdf';
import {
    chooseKind,
    detectedPort,
    fakeNetwork,
    LOCALHOST,
    openWizardFromStatus,
    provider,
    routeHost,
    routeRemote,
    setProviders,
    storedProviders,
} from './utils/ai-providers';
import { capture } from './utils/screenshots';
import { TestIds } from '../src/testids';

const W = TestIds.aiWizard;
const wizard = (page: Page) => byId(page, W.root);
const statusButton = (page: Page) => byId(page, TestIds.ai.statusButton);
/** The screenshots, in the order the flow goes through them, which numbers their files */
const SHOTS = [
    'preview-offline-opens-wizard',
    'provider-choice',
    'local-detected-ports',
    'local-not-found',
    'local-custom-port-error',
    'api-key',
    'api-key-invalid',
    'network-devices',
    'network-devices-named',
    'network-device-ports',
    'network-no-devices',
    'network-invalid-ip',
    'network-not-found-at-ip',
    'remote-invalid-host',
    'remote-unreachable',
    'remote-invalid-key',
    'models-offered',
    'model-check-invalid',
    'model-check-valid',
    'models-added',
    'status-provider-added-auto-model',
    'status-provider-added-custom-models',
    'status-no-providers',
    'status-offline-reconnect',
] as const;

/** Captures the wizard (or the AI status dialog, or the whole page) at test/screenshots/ai-integration/NN-name.png */
const shot = (page: Page, name: (typeof SHOTS)[number], target: 'wizard' | 'status' | 'page' = 'wizard') =>
    capture(
        page,
        `ai-integration/${String(SHOTS.indexOf(name) + 1).padStart(2, '0')}-${name}`,
        target === 'page' ? undefined : target === 'wizard' ? wizard(page) : byId(page, TestIds.ai.statusDialog),
    );

/** On the project already open (keeping its providers): a PDF on the first article, and its preview open */
async function openSampleInOpenProject(page: Page) {
    await uploadReferences(page, buildCsv(STANDARD_COLUMNS, sampleArticles(1)));
    await expect(byId(page, TestIds.references.loadedCount)).toBeVisible();
    await goToFullTexts(page);
    const card = articleCard(page, 'Article 1');
    await attachPdf(card, samplePdf());
    await openPreview(page, card, SAMPLE_PAGES.length);
}

/** From the models step: keeps the automatic model, which adds the provider */
async function finishWithAutoModel(page: Page) {
    await expect(wizard(page)).toHaveAttribute('data-step', 'models');
    await byId(page, W.modelAuto).click();
    await expect(wizard(page)).toHaveCount(0);
}

test.describe('opening the AI configuration', () => {
    test('opens the wizard from the icon of the preview while the AI is offline', async ({ page, ai }) => {
        await ai.stop();
        await startWithReferences(page, buildCsv(STANDARD_COLUMNS, sampleArticles(1)));
        const card = articleCard(page, 'Article 1');
        await attachPdf(card, samplePdf());
        await openPreview(page, card, SAMPLE_PAGES.length);
        await expect(byId(page, TestIds.ai.warmUp)).toHaveAttribute('data-state', 'offline');

        await byId(page, TestIds.ai.warmUp).click();

        await expect(wizard(page)).toBeVisible();
        await expect(wizard(page)).toHaveAttribute('data-step', 'provider');
        await expect(wizard(page)).toContainText('Vamos integrar com a inteligência artificial');
        await shot(page, 'preview-offline-opens-wizard', 'page');
    });

    test('starts the warm up from the icon of the preview, instead of the wizard, while online', async ({ page }) => {
        await startWithReferences(page, buildCsv(STANDARD_COLUMNS, sampleArticles(1)));
        const card = articleCard(page, 'Article 1');
        await attachPdf(card, samplePdf());
        await openPreview(page, card, SAMPLE_PAGES.length);
        await expect(statusButton(page)).toHaveAttribute('data-status', 'online');

        await byId(page, TestIds.ai.warmUp).click();

        await expect(byId(page, TestIds.ai.warmUp)).toHaveAttribute('data-state', 'ready');
        await expect(wizard(page)).toHaveCount(0);
    });

    test('closes the wizard opened from the preview once the provider is added, back online', async ({ page, ai }) => {
        await ai.stop();
        await routeHost(page, LOCALHOST, { 8000: {} });
        await startWithReferences(page, buildCsv(STANDARD_COLUMNS, sampleArticles(1)));
        const card = articleCard(page, 'Article 1');
        await attachPdf(card, samplePdf());
        await openPreview(page, card, SAMPLE_PAGES.length);

        await byId(page, TestIds.ai.warmUp).click();
        await chooseKind(page, 'local');
        await detectedPort(page, 8000).click();
        await finishWithAutoModel(page);

        await expect(statusButton(page)).toHaveAttribute('data-status', 'online');
        await expect(byId(page, TestIds.ai.warmUp)).toHaveAttribute('data-state', 'idle');
    });

    test('opens the wizard from the AI status, adding a provider', async ({ page }) => {
        await openApp(page);
        await openWizardFromStatus(page);

        await expect(page.locator(`[data-testid="${W.provider}"]`)).toHaveCount(3);
        for (const kind of ['local', 'network', 'remote'])
            await expect(page.locator(`[data-testid="${W.provider}"][data-kind="${kind}"]`)).toBeVisible();
        await shot(page, 'provider-choice');
    });

    test('goes back to the step before, keeping the title', async ({ page }) => {
        await routeHost(page, LOCALHOST);
        await openApp(page);
        await openWizardFromStatus(page);
        await expect(wizard(page)).toContainText('Integração com IA');
        await expect(byId(page, W.back)).toHaveCount(0);

        await chooseKind(page, 'remote');
        await expect(wizard(page)).toHaveAttribute('data-step', 'remote');
        await expect(wizard(page)).toContainText('Integração com IA');
        // Only the arrow
        await expect(byId(page, W.back)).toHaveText('');
        await expect(byId(page, W.back)).toHaveAttribute('aria-label', 'Voltar');
        await byId(page, W.back).click();

        await expect(wizard(page)).toHaveAttribute('data-step', 'provider');
        await expect(byId(page, W.back)).toHaveCount(0);
    });
});

test.describe('the local provider', () => {
    test('lists the common ports that answer, with the provider usually on each', async ({ page }) => {
        await routeHost(page, LOCALHOST, { 8000: {}, 11434: {}, 1234: { apiKey: 'secret' } });
        await openApp(page);
        await openWizardFromStatus(page);

        await chooseKind(page, 'local');

        await expect(byId(page, W.detectedPort)).toHaveCount(3);
        await expect(detectedPort(page, 8000)).toContainText(`http://${LOCALHOST}:8000`);
        await expect(detectedPort(page, 8000).getByTestId(W.portProvider)).toContainText('oMLX');
        await expect(detectedPort(page, 11434).getByTestId(W.portProvider)).toContainText('Ollama');
        await expect(detectedPort(page, 1234).getByTestId(W.portProvider)).toContainText('LM Studio');
        await expect(detectedPort(page, 8000)).toHaveAttribute('data-result', 'available');
        // Answered 401, so it will ask for the key
        await expect(detectedPort(page, 1234)).toHaveAttribute('data-result', 'unauthorized');
        // Only the ports that answered
        await expect(detectedPort(page, 8080)).toHaveCount(0);
        await shot(page, 'local-detected-ports');
    });

    test('does not list a port where something else answers, without the completions route', async ({ page }) => {
        await routeHost(page, LOCALHOST, { 8000: {} });
        // A plain web server on 8080
        await page.route(`http://${LOCALHOST}:8080/**`, route =>
            route.fulfill({ status: 404, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } }),
        );
        await openApp(page);
        await openWizardFromStatus(page);

        await chooseKind(page, 'local');

        await expect(byId(page, W.detectedPort)).toHaveCount(1);
        await expect(detectedPort(page, 8000)).toBeVisible();
    });

    test('adds the chosen provider with the automatic model, and starts using it', async ({ page }) => {
        const routed = await routeHost(page, LOCALHOST, { 8000: { loadedModel: 'local-model' } });
        await openApp(page);
        await openWizardFromStatus(page);

        await chooseKind(page, 'local');
        await detectedPort(page, 8000).click();
        await finishWithAutoModel(page);

        const endpoint = `http://${LOCALHOST}:8000`;
        expect(await storedProviders(page)).toEqual({
            providers: [provider(`http://localhost:9877`), provider(endpoint)],
            current: endpoint,
        });
        // Back to the status, now of the new provider
        await expect(byId(page, TestIds.ai.statusDialog)).toBeVisible();
        await expect(byId(page, TestIds.ai.provider)).toHaveValue(endpoint);
        await expect(byId(page, TestIds.ai.statusValue)).toHaveText('Online');
        await expect(byId(page, TestIds.ai.model)).toHaveText('local-model');
        await expect(byId(page, TestIds.ai.defaultModel)).toHaveValue('');
        await expect(byId(page, TestIds.ai.defaultModel).locator('option')).toHaveText(['Automático']);
        await shot(page, 'status-provider-added-auto-model', 'status');
        expect(routed[8000].authorizations.length).toBeGreaterThan(0);
    });

    test('tells when no local provider is found, and finds it once reconnected', async ({ page }) => {
        await routeHost(page, LOCALHOST);
        await openApp(page);
        await openWizardFromStatus(page);

        await chooseKind(page, 'local');

        await expect(byId(page, W.notFound)).toContainText('Nenhum provedor local detectado, o provedor de IA está ativo?');
        await expect(byId(page, W.reconnect)).toHaveText('Verificar novamente');
        await expect(byId(page, W.notFound)).toContainText('Está executando em uma porta personalizada?');
        await expect(byId(page, W.customPort)).toHaveAttribute('placeholder', 'Porta personalizada');
        await shot(page, 'local-not-found');

        // Now it is running
        await routeHost(page, LOCALHOST, { 8080: {} });
        await byId(page, W.reconnect).click();

        await expect(byId(page, W.notFound)).toHaveCount(0);
        await expect(detectedPort(page, 8080)).toBeVisible();
    });

    test('checks a custom port, telling when nothing answers on it', async ({ page }) => {
        await routeHost(page, LOCALHOST, { 9999: {} });
        await openApp(page);
        await openWizardFromStatus(page);
        await chooseKind(page, 'local');
        await expect(byId(page, W.notFound)).toBeVisible();
        await expect(byId(page, W.customPortCheck)).toBeDisabled();

        await byId(page, W.customPort).fill('9998');
        await byId(page, W.customPortCheck).click();
        await expect(byId(page, W.customPortError)).toHaveText('Nada respondeu na porta 9998');
        await shot(page, 'local-custom-port-error');

        await byId(page, W.customPort).fill('9999');
        await expect(byId(page, W.customPortError)).toHaveCount(0);
        await byId(page, W.customPortCheck).click();

        await expect(wizard(page)).toHaveAttribute('data-step', 'models');
        await finishWithAutoModel(page);
        expect((await storedProviders(page)).current).toBe(`http://${LOCALHOST}:9999`);
    });

    test('asks for the API key of a custom port that answers 401', async ({ page }) => {
        await routeHost(page, LOCALHOST, { 9999: { apiKey: 'secret' } });
        await openApp(page);
        await openWizardFromStatus(page);
        await chooseKind(page, 'local');

        await byId(page, W.customPort).fill('9999');
        await byId(page, W.customPortCheck).click();

        await expect(wizard(page)).toHaveAttribute('data-step', 'apiKey');
    });
});

test.describe('the API key', () => {
    test('is asked when the provider answers 401, refusing a wrong one', async ({ page }) => {
        const routed = await routeHost(page, LOCALHOST, { 8000: { apiKey: 'secret' } });
        await openApp(page);
        await openWizardFromStatus(page);
        await chooseKind(page, 'local');

        await detectedPort(page, 8000).click();

        await expect(wizard(page)).toHaveAttribute('data-step', 'apiKey');
        await expect(wizard(page)).toContainText(`http://${LOCALHOST}:8000`);
        await expect(byId(page, W.apiKeyCheck)).toBeDisabled();
        await shot(page, 'api-key');

        await byId(page, W.apiKeyInput).fill('wrong');
        await byId(page, W.apiKeyCheck).click();
        await expect(byId(page, W.apiKeyError)).toHaveText('Chave de API inválida');
        await shot(page, 'api-key-invalid');
        await expect(wizard(page)).toHaveAttribute('data-step', 'apiKey');

        await byId(page, W.apiKeyInput).fill('secret');
        await expect(byId(page, W.apiKeyError)).toHaveCount(0);
        await byId(page, W.apiKeyCheck).click();
        await finishWithAutoModel(page);

        const { providers } = await storedProviders(page);
        expect(providers.at(-1)).toEqual(provider(`http://${LOCALHOST}:8000`, { apiKey: 'secret' }));
        // The status of the provider is checked with the key
        await expect(byId(page, TestIds.ai.statusValue)).toHaveText('Online');
        expect(routed[8000].authorizations.at(-1)).toBe('Bearer secret');
    });

    test('is sent on the requests of the provider', async ({ page, ai }) => {
        await openApp(page);
        await setProviders(page, [provider(ai.endpoint, { apiKey: 'my-key' })]);
        await openSampleInOpenProject(page);
        await expect(statusButton(page)).toHaveAttribute('data-status', 'online');

        await byId(page, TestIds.ai.warmUp).click();
        await expect(byId(page, TestIds.ai.warmUp)).toHaveAttribute('data-state', 'ready');

        expect(ai.sent.length).toBeGreaterThan(0);
        expect(ai.sent.every(sent => sent.authorization === 'Bearer my-key')).toBe(true);
    });
});

test.describe('the network provider', () => {
    test('lists the devices found on the network, scanning the ports of the one chosen', async ({ page }) => {
        await fakeNetwork(page, { '10.20.30.7': {}, '10.20.30.42': { 8000: {} } });
        await openApp(page);
        await openWizardFromStatus(page);

        await chooseKind(page, 'network');

        await expect(byId(page, W.devicesScanning)).toBeVisible();
        await expect(page.locator(`[data-testid="${W.device}"][data-ip="10.20.30.42"]`)).toBeVisible();
        await expect(page.locator(`[data-testid="${W.device}"][data-ip="10.20.30.7"]`)).toBeVisible();
        // Typing the IP is offered along with the list
        await expect(byId(page, W.ipInput)).toBeVisible();
        await expect(byId(page, W.devicesScanning)).toHaveCount(0, { timeout: 20_000 });
        await expect(byId(page, W.device)).toHaveCount(2);
        await shot(page, 'network-devices');

        await page.locator(`[data-testid="${W.device}"][data-ip="10.20.30.42"]`).click();

        await expect(detectedPort(page, 8000)).toContainText('http://10.20.30.42:8000');
        await shot(page, 'network-device-ports');
        await detectedPort(page, 8000).click();
        await finishWithAutoModel(page);
        expect((await storedProviders(page)).providers.at(-1)).toEqual(provider('http://10.20.30.42:8000', { kind: 'network' }));
    });

    test('lists the devices the native shell finds, with their names, instead of scanning on the browser', async ({ page }) => {
        await page.addInitScript(() => {
            (window as any).nativeBridge = {
                getDevices: async () => [{ ip: '10.20.30.42', name: 'Sala de estar' }, { ip: '10.20.30.7' }],
            };
        });
        await routeHost(page, '10.20.30.42', { 8000: {} });
        await openApp(page);
        await openWizardFromStatus(page);

        await chooseKind(page, 'network');

        const named = page.locator(`[data-testid="${W.device}"][data-ip="10.20.30.42"]`);
        await expect(named.getByTestId(W.deviceName)).toHaveText('Sala de estar');
        await expect(named).toContainText('10.20.30.42');
        // Without a name, only the IP
        await expect(page.locator(`[data-testid="${W.device}"][data-ip="10.20.30.7"]`).getByTestId(W.deviceName)).toHaveCount(0);
        await expect(byId(page, W.devicesScanning)).toHaveCount(0);
        await shot(page, 'network-devices-named');

        await named.click();
        await expect(detectedPort(page, 8000)).toBeVisible();
    });

    test('scans on the browser when the native shell fails to look', async ({ page }) => {
        await page.addInitScript(() => {
            (window as any).nativeBridge = { getDevices: async () => Promise.reject(new Error('denied')) };
        });
        await fakeNetwork(page, { '10.20.30.7': {} });
        await openApp(page);
        await openWizardFromStatus(page);

        await chooseKind(page, 'network');

        await expect(page.locator(`[data-testid="${W.device}"][data-ip="10.20.30.7"]`)).toBeVisible();
    });

    test('offers typing the IP when no device is found', async ({ page }) => {
        await fakeNetwork(page, {});
        await openApp(page);
        await openWizardFromStatus(page);

        await chooseKind(page, 'network');

        await expect(wizard(page)).toContainText('Nenhum dispositivo encontrado', { timeout: 20_000 });
        await expect(byId(page, W.device)).toHaveCount(0);
        await expect(byId(page, W.ipInput)).toBeVisible();
        await shot(page, 'network-no-devices');
    });

    test('refuses an invalid IP', async ({ page }) => {
        await fakeNetwork(page, {});
        await openApp(page);
        await openWizardFromStatus(page);
        await chooseKind(page, 'network');
        await expect(byId(page, W.ipContinue)).toBeDisabled();

        await byId(page, W.ipInput).fill('10.20.30.300');
        await byId(page, W.ipContinue).click();

        await expect(byId(page, W.ipError)).toHaveText('IP inválido');
        await shot(page, 'network-invalid-ip');
        await expect(wizard(page)).toHaveAttribute('data-step', 'devices');
        await byId(page, W.ipInput).fill('10.20.30.3');
        await expect(byId(page, W.ipError)).toHaveCount(0);
    });

    test('scans the typed IP, telling when no provider is found on it', async ({ page }) => {
        await fakeNetwork(page, { '10.20.30.9': {} });
        await openApp(page);
        await openWizardFromStatus(page);
        await chooseKind(page, 'network');

        await byId(page, W.ipInput).fill('10.20.30.9');
        await byId(page, W.ipContinue).click();

        await expect(byId(page, W.notFound)).toContainText('Nenhum provedor detectado em 10.20.30.9, o provedor de IA está ativo?');
        await shot(page, 'network-not-found-at-ip');
        await expect(byId(page, W.reconnect)).toBeVisible();
        await expect(byId(page, W.customPort)).toBeVisible();
    });

    test('asks for the API key of a device that answers 401', async ({ page }) => {
        await fakeNetwork(page, { '10.20.30.42': { 8080: { apiKey: 'lan-key' } } });
        await openApp(page);
        await openWizardFromStatus(page);
        await chooseKind(page, 'network');
        await byId(page, W.ipInput).fill('10.20.30.42');
        await byId(page, W.ipContinue).click();

        await expect(detectedPort(page, 8080)).toHaveAttribute('data-result', 'unauthorized');
        await detectedPort(page, 8080).click();
        await byId(page, W.apiKeyInput).fill('lan-key');
        await byId(page, W.apiKeyCheck).click();
        await finishWithAutoModel(page);

        expect((await storedProviders(page)).providers.at(-1)).toEqual(
            provider('http://10.20.30.42:8080', { kind: 'network', apiKey: 'lan-key' }),
        );
    });
});

test.describe('the remote provider', () => {
    const ORIGIN = 'https://ai.example.test';

    test('refuses a host that is not an http(s) address', async ({ page }) => {
        await openApp(page);
        await openWizardFromStatus(page);
        await chooseKind(page, 'remote');
        await expect(byId(page, W.remoteCheck)).toBeDisabled();

        await byId(page, W.remoteHost).fill('ai.example.test');
        await byId(page, W.remoteCheck).click();

        await expect(byId(page, W.remoteError)).toHaveText('Endereço inválido: use http:// ou https://');
        await shot(page, 'remote-invalid-host');
    });

    test('tells when the server can not be reached', async ({ page }) => {
        await page.route(`${ORIGIN}/**`, route => route.abort('connectionrefused'));
        await openApp(page);
        await openWizardFromStatus(page);
        await chooseKind(page, 'remote');

        await byId(page, W.remoteHost).fill(ORIGIN);
        await byId(page, W.remoteCheck).click();

        await expect(byId(page, W.remoteError)).toHaveText('Não foi possível conectar ao servidor');
        await shot(page, 'remote-unreachable');
    });

    test('refuses a wrong API key', async ({ page }) => {
        await routeRemote(page, ORIGIN, { apiKey: 'sk-right' });
        await openApp(page);
        await openWizardFromStatus(page);
        await chooseKind(page, 'remote');

        await byId(page, W.remoteHost).fill(ORIGIN);
        await byId(page, W.remoteApiKey).fill('sk-wrong');
        await byId(page, W.remoteCheck).click();

        await expect(byId(page, W.remoteError)).toHaveText('Chave de API inválida');
        await shot(page, 'remote-invalid-key');
        await expect(wizard(page)).toHaveAttribute('data-step', 'remote');
    });

    test('adds the server with its key, however its address was typed', async ({ page }) => {
        const routed = await routeRemote(page, ORIGIN, { apiKey: 'sk-right' });
        await openApp(page);
        await openWizardFromStatus(page);
        await chooseKind(page, 'remote');

        await byId(page, W.remoteHost).fill(`${ORIGIN}/v1/`);
        await byId(page, W.remoteApiKey).fill('sk-right');
        await byId(page, W.remoteCheck).click();
        await finishWithAutoModel(page);

        expect((await storedProviders(page)).providers.at(-1)).toEqual(provider(ORIGIN, { kind: 'remote', apiKey: 'sk-right' }));
        expect(routed.authorizations.every(sent => sent === 'Bearer sk-right')).toBe(true);
    });
});

test.describe('the model definition', () => {
    async function reachModels(page: Page, models: string[] = []) {
        await routeHost(page, LOCALHOST, { 8000: { models } });
        await openApp(page);
        await openWizardFromStatus(page);
        await chooseKind(page, 'local');
        await detectedPort(page, 8000).click();
        await expect(wizard(page)).toHaveAttribute('data-step', 'models');
    }

    test('offers the models the provider lists', async ({ page }) => {
        await reachModels(page, ['qwen-a', 'qwen-b']);

        await expect(byId(page, W.serverModel)).toHaveText(['qwen-a', 'qwen-b']);
        await expect(byId(page, W.modelAuto)).toBeVisible();
        await shot(page, 'models-offered');
    });

    test('only offers the automatic model and typing one when the provider lists none', async ({ page }) => {
        await reachModels(page);

        await expect(byId(page, W.modelsLoading)).toHaveCount(0);
        await expect(byId(page, W.serverModel)).toHaveCount(0);
        await expect(byId(page, W.modelAuto)).toBeVisible();
        await expect(byId(page, W.modelInput)).toBeVisible();
    });

    test('checks if the provider answers with the typed model name', async ({ page }) => {
        await routeHost(page, LOCALHOST, { 8000: { validModels: ['qwen-real'] } });
        await openApp(page);
        await openWizardFromStatus(page);
        await chooseKind(page, 'local');
        await detectedPort(page, 8000).click();
        await expect(byId(page, W.modelCheck)).toBeDisabled();

        await byId(page, W.modelInput).fill('qwen-typo');
        await byId(page, W.modelCheck).click();
        await expect(byId(page, W.modelCheckResult)).toHaveAttribute('data-result', 'invalid');
        await expect(byId(page, W.modelCheckResult)).toHaveText('O provedor não reconheceu qwen-typo');
        await shot(page, 'model-check-invalid');

        // Typing again clears the result
        await byId(page, W.modelInput).fill('qwen-real');
        await expect(byId(page, W.modelCheckResult)).toHaveCount(0);
        await byId(page, W.modelCheck).click();
        await expect(byId(page, W.modelCheckResult)).toHaveAttribute('data-result', 'valid');
        await expect(byId(page, W.modelCheckResult)).toHaveText('O provedor respondeu com qwen-real');
        await shot(page, 'model-check-valid');
        // Checking does not add it
        await expect(byId(page, W.modelItem)).toHaveCount(0);

        await byId(page, W.modelAdd).click();
        await expect(byId(page, W.modelItem)).toHaveText(['qwen-real']);
        await expect(byId(page, W.modelCheckResult)).toHaveCount(0);
    });

    test('hides the automatic model once one is added, showing it back when all are removed', async ({ page }) => {
        await reachModels(page, ['qwen-a']);

        await byId(page, W.serverModel).click();

        await expect(byId(page, W.modelAuto)).toHaveCount(0);
        await expect(byId(page, W.modelItem)).toHaveText(['qwen-a']);
        // Added, it is no longer offered
        await expect(byId(page, W.serverModel)).toHaveCount(0);
        await expect(byId(page, W.finish)).toBeVisible();

        await byId(page, W.modelRemove).click();

        await expect(byId(page, W.modelItem)).toHaveCount(0);
        await expect(byId(page, W.modelAuto)).toBeVisible();
        await expect(byId(page, W.serverModel)).toHaveText(['qwen-a']);
        await expect(byId(page, W.finish)).toHaveCount(0);
    });

    test('adds custom model names, once each', async ({ page }) => {
        await reachModels(page);
        await expect(byId(page, W.modelAdd)).toBeDisabled();

        await byId(page, W.modelInput).fill('custom-model');
        await byId(page, W.modelAdd).click();
        await byId(page, W.modelInput).fill('custom-model');
        await byId(page, W.modelInput).press('Enter');
        await byId(page, W.modelInput).fill('other-model');
        await byId(page, W.modelInput).press('Enter');

        await expect(byId(page, W.modelInput)).toHaveValue('');
        await expect(byId(page, W.modelItem)).toHaveText(['custom-model', 'other-model']);
        await expect(byId(page, W.modelAuto)).toHaveCount(0);
        await shot(page, 'models-added');
    });

    test('saves the models chosen, the first as the default', async ({ page }) => {
        await reachModels(page, ['qwen-a']);
        await byId(page, W.modelInput).fill('custom-model');
        await byId(page, W.modelAdd).click();
        await byId(page, W.serverModel).click();

        await byId(page, W.finish).click();

        await expect(wizard(page)).toHaveCount(0);
        expect((await storedProviders(page)).providers.at(-1)).toEqual(
            provider(`http://${LOCALHOST}:8000`, { models: ['custom-model', 'qwen-a'], defaultModel: 'custom-model' }),
        );
        await expect(byId(page, TestIds.ai.defaultModel)).toHaveValue('custom-model');
        await expect(byId(page, TestIds.ai.defaultModel).locator('option')).toHaveText(['custom-model', 'qwen-a']);
        await shot(page, 'status-provider-added-custom-models', 'status');
    });
});

test.describe('the providers on the AI status', () => {
    test('says when none is configured, offering to add one but not to reconnect', async ({ page }) => {
        await openApp(page);
        await setProviders(page, []);

        await expect(statusButton(page)).toHaveAttribute('data-status', 'offline');
        await expect(statusButton(page)).toHaveAttribute('data-checking', 'false');
        await statusButton(page).click();

        await expect(byId(page, TestIds.ai.noProviders)).toHaveText('Nenhum provedor configurado');
        await expect(byId(page, TestIds.ai.provider)).toHaveCount(0);
        await expect(byId(page, TestIds.ai.defaultModel)).toHaveCount(0);
        await expect(byId(page, TestIds.ai.reconnect)).toHaveCount(0);
        await expect(byId(page, TestIds.ai.addProvider)).toBeVisible();
        await shot(page, 'status-no-providers', 'status');
    });

    test('shows the reconnect button under the providers while offline', async ({ page, ai }) => {
        await ai.stop();
        await openApp(page);

        await statusButton(page).click();

        await expect(byId(page, TestIds.ai.statusValue)).toHaveText('Offline');
        await expect(byId(page, TestIds.ai.provider)).toHaveValue(ai.endpoint);
        await expect(byId(page, TestIds.ai.reconnect)).toBeVisible();
        const providerBox = await byId(page, TestIds.ai.provider).boundingBox();
        const reconnectBox = await byId(page, TestIds.ai.reconnect).boundingBox();
        expect(reconnectBox!.y).toBeGreaterThan(providerBox!.y);
        await shot(page, 'status-offline-reconnect', 'status');
    });

    test('switches between the providers configured', async ({ page, ai }) => {
        await routeHost(page, LOCALHOST);
        const other = `http://${LOCALHOST}:8000`;
        await openApp(page);
        await setProviders(page, [provider(ai.endpoint), provider(other)], ai.endpoint);
        await statusButton(page).click();
        await expect(byId(page, TestIds.ai.statusValue)).toHaveText('Online');

        await byId(page, TestIds.ai.provider).selectOption(other);

        // Nothing answers there
        await expect(byId(page, TestIds.ai.statusValue)).toHaveText('Offline');
        await expect(byId(page, TestIds.ai.reconnect)).toBeVisible();
        expect((await storedProviders(page)).current).toBe(other);

        await byId(page, TestIds.ai.provider).selectOption(ai.endpoint);
        await expect(byId(page, TestIds.ai.statusValue)).toHaveText('Online');
    });

    test('keeps the provider chosen after reloading', async ({ page, ai }) => {
        const other = `http://${LOCALHOST}:8000`;
        await openApp(page);
        await setProviders(page, [provider(ai.endpoint), provider(other)], other);

        await statusButton(page).click();

        await expect(byId(page, TestIds.ai.provider)).toHaveValue(other);
    });

    test('replaces a provider added again with the same address', async ({ page }) => {
        await routeHost(page, LOCALHOST, { 8000: { models: ['qwen-a'] } });
        await openApp(page);
        await openWizardFromStatus(page);
        await chooseKind(page, 'local');
        await detectedPort(page, 8000).click();
        await finishWithAutoModel(page);

        await byId(page, TestIds.ai.addProvider).click();
        await chooseKind(page, 'local');
        await detectedPort(page, 8000).click();
        await byId(page, W.serverModel).click();
        await byId(page, W.finish).click();

        const { providers } = await storedProviders(page);
        expect(providers).toHaveLength(2);
        expect(providers.at(-1)).toEqual(provider(`http://${LOCALHOST}:8000`, { models: ['qwen-a'], defaultModel: 'qwen-a' }));
    });

    test('sends the requests to the default model chosen', async ({ page, ai }) => {
        await openApp(page);
        await setProviders(page, [provider(ai.endpoint, { models: ['model-a', 'model-b'], defaultModel: 'model-a' })]);
        await statusButton(page).click();
        await expect(byId(page, TestIds.ai.defaultModel)).toHaveValue('model-a');

        await byId(page, TestIds.ai.defaultModel).selectOption('model-b');

        expect((await storedProviders(page)).providers[0].defaultModel).toBe('model-b');
        // The model does not change the server, which stays online
        await expect(byId(page, TestIds.ai.statusValue)).toHaveText('Online');
        // Read again from the storage, as chosen
        await page.reload();
        await openSampleInOpenProject(page);
        await byId(page, TestIds.ai.warmUp).click();
        await expect(byId(page, TestIds.ai.warmUp)).toHaveAttribute('data-state', 'ready');

        expect(ai.sent.length).toBeGreaterThan(0);
        expect(ai.sent.every(sent => sent.model === 'model-b')).toBe(true);
    });

    test('sends the requests to the loaded model while it is automatic', async ({ page, ai }) => {
        await startWithReferences(page, buildCsv(STANDARD_COLUMNS, sampleArticles(1)));
        const card = articleCard(page, 'Article 1');
        await attachPdf(card, samplePdf());
        await openPreview(page, card, SAMPLE_PAGES.length);
        await expect(statusButton(page)).toHaveAttribute('data-status', 'online');

        await byId(page, TestIds.ai.warmUp).click();
        await expect(byId(page, TestIds.ai.warmUp)).toHaveAttribute('data-state', 'ready');

        expect(ai.sent.every(sent => sent.model === 'mock-model')).toBe(true);
    });
});

test.describe('the AI configuration on the project export', () => {
    const SECRET = provider('https://ai.example.test', { kind: 'remote', apiKey: 'sk-secret' });

    test('is left out, with its API keys', async ({ page, ai }) => {
        await openApp(page);
        await setProviders(page, [provider(ai.endpoint), SECRET], SECRET.endpoint);

        const download = page.waitForEvent('download');
        await byId(page, TestIds.dataTransfer.export).click();
        const exported = await (await download).path().then(path => readFileSync(path, 'utf8'));

        expect(exported).not.toContain('sk-secret');
        expect(exported).not.toContain('ai.example.test');
        const keys = Object.keys(JSON.parse(exported).localStorage);
        expect(keys).not.toContain('ai-providers');
        expect(keys).not.toContain('ai-provider-current');
    });

    test('is kept on import, ignoring the one a file brings', async ({ page, ai }) => {
        await openApp(page);
        await setProviders(page, [provider(ai.endpoint, { apiKey: 'mine' })], ai.endpoint);
        const file = {
            format: 'research-workflow-export',
            exportedAt: new Date().toISOString(),
            localStorage: {
                'ai-providers': JSON.stringify([provider('https://attacker.example.test')]),
                'ai-provider-current': 'https://attacker.example.test',
                'ai-endpoints': JSON.stringify({ endpoints: ['https://attacker.example.test'], current: 'https://attacker.example.test' }),
            },
        };
        page.once('dialog', dialog => dialog.accept());

        await byId(page, TestIds.dataTransfer.importInput).setInputFiles({
            name: 'export.json',
            mimeType: 'application/json',
            buffer: Buffer.from(JSON.stringify(file)),
        });
        await page.waitForEvent('load');
        await expect(byId(page, TestIds.steps.step).first()).toBeVisible();

        expect(await storedProviders(page)).toEqual({ providers: [provider(ai.endpoint, { apiKey: 'mine' })], current: ai.endpoint });
        await statusButton(page).click();
        await expect(byId(page, TestIds.ai.provider)).toHaveValue(ai.endpoint);
    });
});

