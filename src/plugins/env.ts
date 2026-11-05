import { del, get, keys, set } from 'idb-keyval';
import { callOpenAiApi } from '../services/ai';
import AISettingsButton from '../components/AISettingsButton';
import type { PluginEnv } from './types';

/** The same prefix the plugins used before having a storage of their own, as "plugins/uniprot/human" */
const prefixOf = (pluginId: string) => `plugins/${pluginId}/`;

/** The storage and the AI given to a plugin, its storage limited to its own keys */
export function createPluginEnv(pluginId: string): PluginEnv {
    const prefix = prefixOf(pluginId);
    return {
        storage: {
            get: key => get(`${prefix}${key}`),
            set: (key, value) => set(`${prefix}${key}`, value),
            del: key => del(`${prefix}${key}`),
            keys: async () =>
                (await keys())
                    .filter((key): key is string => typeof key === 'string' && key.startsWith(prefix))
                    .map(key => key.slice(prefix.length)),
        },
        ai: {
            // Not kept on the server unless the plugin asks to, as for a prompt it starts every question with
            complete: (messages, { onProgress, cache = false, settings } = {}) => callOpenAiApi(messages, onProgress, { cache, settings }),
        },
        settingsComponents: { AISettingsButton },
    };
}
