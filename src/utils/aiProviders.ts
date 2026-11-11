import { DEFAULT_AI_ENDPOINT } from '../services/ai';
import { scoped } from './projects';

/** How the provider was found on the AI integration wizard */
export type AIProviderKind = 'local' | 'network' | 'remote';

/** An OpenAI compatible server configured to answer the AI requests */
export type AIProviderShape = {
    kind: AIProviderKind;
    /** The address of the server, without the /v1 of its routes. Identifies the provider */
    endpoint: string;
    /** Sent as the bearer token, for servers that ask for one */
    apiKey?: string;
    /** The models that can be used. null is the automatic model: the one the server has loaded */
    models: string[] | null;
    /** The one of the models the requests use. null is the automatic model */
    defaultModel: string | null;
};

const PROVIDERS_KEY = 'ai-providers';
const CURRENT_KEY = 'ai-provider-current';

/**
 * The keys of the AI configuration, which belongs to this machine and holds the API keys:
 * never exported, nor replaced by an import. ai-endpoints is the configuration used before the providers
 */
export const AI_CONFIG_KEYS = [PROVIDERS_KEY, CURRENT_KEY, 'ai-endpoints'];

/** The same endpoint, however it was typed: without the slashes and the /v1 at the end */
export const normalizeEndpoint = (endpoint: string) =>
    endpoint
        .trim()
        .replace(/\/+$/, '')
        .replace(/\/v1$/, '');

export function isValidEndpoint(endpoint: string) {
    try {
        const { protocol } = new URL(endpoint);
        return protocol === 'http:' || protocol === 'https:';
    } catch {
        return false;
    }
}

/** While none was configured, the default endpoint is the only provider */
export function loadAIProviders(): { providers: AIProviderShape[]; current: string | null } {
    const stored = localStorage.getItem(scoped(PROVIDERS_KEY));
    const providers: AIProviderShape[] = stored
        ? JSON.parse(stored)
        : [{ kind: 'local', endpoint: DEFAULT_AI_ENDPOINT, models: null, defaultModel: null }];
    const current = localStorage.getItem(scoped(CURRENT_KEY));
    return {
        providers,
        current: providers.some(p => p.endpoint === current) ? current : (providers[0]?.endpoint ?? null),
    };
}

export function saveAIProviders(providers: AIProviderShape[], current: string | null) {
    localStorage.setItem(scoped(PROVIDERS_KEY), JSON.stringify(providers));
    if (current) localStorage.setItem(scoped(CURRENT_KEY), current);
    else localStorage.removeItem(scoped(CURRENT_KEY));
}
