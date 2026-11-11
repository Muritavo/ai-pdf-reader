import { expect, type Page, type Route } from '@playwright/test';
import { TestIds } from '../../src/testids';
import { byId } from './app';

/** As stored by the app (src/utils/aiProviders.ts), kept apart so the specs don't load the app's services */
type AIProviderShape = {
    kind: 'local' | 'network' | 'remote';
    endpoint: string;
    apiKey?: string;
    models: string[] | null;
    defaultModel: string | null;
};

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': '*',
};

/** Where the specs look for the local provider, as the wizard does */
export const LOCALHOST = '127.0.0.1';

export type RoutedProvider = {
    /** When set, the provider answers 401 to requests without this key */
    apiKey?: string;
    /** The models listed on /v1/models */
    models?: string[];
    /** The model reported as loaded on /v1/models/status */
    loadedModel?: string;
    /** The models the provider answers with. Without it, the ones listed */
    validModels?: string[];
    /** The authorization headers received, of every request */
    authorizations: (string | undefined)[];
};

/** Answers like an OpenAI compatible server: refusing the empty conversation of the probe, as real ones do */
async function answerAsProvider(route: Route, provider: RoutedProvider) {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const authorization = request.headers()['authorization'];
    provider.authorizations.push(authorization);
    if (provider.apiKey && authorization !== `Bearer ${provider.apiKey}`) return route.fulfill({ status: 401, headers: CORS });
    const { pathname } = new URL(request.url());
    if (pathname === '/v1/models')
        return route.fulfill({ headers: CORS, json: { data: (provider.models ?? []).map(id => ({ id, object: 'model' })) } });
    if (pathname === '/v1/models/status')
        return route.fulfill({ headers: CORS, json: { models: [{ id: provider.loadedModel ?? 'routed-model', loaded: true }] } });
    if (pathname === '/v1/chat/completions') {
        const { model, messages } = request.postDataJSON() as { model?: string; messages: unknown[] };
        if (!messages.length) return route.fulfill({ status: 400, headers: CORS, json: { error: 'messages is empty' } });
        const known = provider.validModels ?? provider.models ?? [];
        if (!model || !known.includes(model)) return route.fulfill({ status: 404, headers: CORS, json: { error: `model ${model} not found` } });
        return route.fulfill({ headers: CORS, json: { choices: [{ message: { role: 'assistant', content: 'OK' } }] } });
    }
    return route.fulfill({ status: 404, headers: CORS });
}

/**
 * Takes over the requests to the host: the ports given answer as providers, the others refuse the connection,
 * like a device that is on but has nothing listening there. So no real server of the machine is ever reached
 */
export async function routeHost(page: Page, host: string, ports: Record<number, Omit<RoutedProvider, 'authorizations'>> = {}) {
    const providers: Record<number, RoutedProvider> = {};
    for (const [port, provider] of Object.entries(ports)) providers[Number(port)] = { ...provider, authorizations: [] };
    const pattern = new RegExp(`^https?://${host.replace(/\./g, '\\.')}:\\d+/`);
    await page.route(pattern, route => {
        const provider = providers[Number(new URL(route.request().url()).port)];
        return provider ? answerAsProvider(route, provider) : route.abort('connectionrefused');
    });
    return providers;
}

/** A remote provider, on https */
export async function routeRemote(page: Page, origin: string, provider: Omit<RoutedProvider, 'authorizations'>) {
    const routed: RoutedProvider = { ...provider, authorizations: [] };
    await page.route(`${origin}/**`, route => answerAsProvider(route, routed));
    return routed;
}

/**
 * Has the browser report the address of this device as on 10.20.30.0/24, so the network scan is deterministic.
 * Of its addresses, the devices given refuse the connection quickly (being there), and the others never answer
 */
export async function fakeNetwork(page: Page, devices: Record<string, Record<number, Omit<RoutedProvider, 'authorizations'>>>) {
    await page.addInitScript(() => {
        class FakePeerConnection {
            onicecandidate: ((event: { candidate: { candidate: string } | null }) => void) | null = null;
            createDataChannel() {}
            async createOffer() {
                return { type: 'offer', sdp: '' };
            }
            async setLocalDescription() {
                setTimeout(() => this.onicecandidate?.({ candidate: { candidate: 'candidate:1 1 udp 1 10.20.30.5 9 typ host' } }), 0);
                setTimeout(() => this.onicecandidate?.({ candidate: null }), 10);
            }
            close() {}
        }
        (window as any).RTCPeerConnection = FakePeerConnection;
    });
    const providers: Record<string, Record<number, RoutedProvider>> = {};
    for (const [ip, ports] of Object.entries(devices)) {
        providers[ip] = {};
        for (const [port, provider] of Object.entries(ports)) providers[ip][Number(port)] = { ...provider, authorizations: [] };
    }
    await page.route(/^http:\/\/10\.20\.30\.\d+:\d+\//, route => {
        const url = new URL(route.request().url());
        const device = providers[url.hostname];
        // No device: the request is left unanswered, until the scan gives up on it
        if (!device) return;
        const provider = device[Number(url.port)];
        return provider ? answerAsProvider(route, provider) : route.abort('connectionrefused');
    });
    return providers;
}

/** Replaces the providers of the open project, reloading so the app reads them */
export async function setProviders(page: Page, providers: AIProviderShape[], current?: string) {
    await page.evaluate(
        ({ providers, current }) => {
            const { last } = JSON.parse(localStorage.getItem('research-workflow/projects')!);
            localStorage.setItem(`project/${last}/ai-providers`, JSON.stringify(providers));
            if (current) localStorage.setItem(`project/${last}/ai-provider-current`, current);
        },
        { providers, current },
    );
    await page.reload();
    await expect(byId(page, TestIds.steps.step).first()).toBeVisible();
}

/** The providers stored on the open project */
export async function storedProviders(page: Page): Promise<{ providers: AIProviderShape[]; current: string | null }> {
    return page.evaluate(() => {
        const { last } = JSON.parse(localStorage.getItem('research-workflow/projects')!);
        return {
            providers: JSON.parse(localStorage.getItem(`project/${last}/ai-providers`) ?? '[]'),
            current: localStorage.getItem(`project/${last}/ai-provider-current`),
        };
    });
}

export const provider = (endpoint: string, overrides: Partial<AIProviderShape> = {}): AIProviderShape => ({
    kind: 'local',
    endpoint,
    models: null,
    defaultModel: null,
    ...overrides,
});

/** Opens the wizard from the AI status, as adding a provider */
export async function openWizardFromStatus(page: Page) {
    await byId(page, TestIds.ai.statusButton).click();
    await byId(page, TestIds.ai.addProvider).click();
    await expect(byId(page, TestIds.aiWizard.root)).toBeVisible();
}

export const chooseKind = (page: Page, kind: 'local' | 'network' | 'remote') =>
    page.locator(`[data-testid="${TestIds.aiWizard.provider}"][data-kind="${kind}"]`).click();

export const detectedPort = (page: Page, port: number) =>
    page.locator(`[data-testid="${TestIds.aiWizard.detectedPort}"][data-port="${port}"]`);
