import { DEFAULT_AI_ENDPOINT } from '../services/ai';
import { scoped } from './projects';

/** The endpoints added on the AI status, and the one in use */
export type AIEndpoints = { endpoints: string[]; current: string };

const STORAGE_KEY = 'ai-endpoints';

/** The same endpoint, however it was typed: without the slashes at the end */
export const normalizeEndpoint = (endpoint: string) => endpoint.trim().replace(/\/+$/, '');

export function isValidEndpoint(endpoint: string) {
    try {
        const { protocol } = new URL(endpoint);
        return protocol === 'http:' || protocol === 'https:';
    } catch {
        return false;
    }
}

/** While nothing was chosen, the default endpoint is the only one */
export function loadAIEndpoints(): AIEndpoints {
    const stored = localStorage.getItem(scoped(STORAGE_KEY));
    return stored ? (JSON.parse(stored) as AIEndpoints) : { endpoints: [DEFAULT_AI_ENDPOINT], current: DEFAULT_AI_ENDPOINT };
}

export function saveAIEndpoints(endpoints: AIEndpoints) {
    localStorage.setItem(scoped(STORAGE_KEY), JSON.stringify(endpoints));
}
