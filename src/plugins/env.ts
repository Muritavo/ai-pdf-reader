import { del, get, keys, set } from 'idb-keyval';
import { callOpenAiApi } from '../services/ai';
import AISettingsButton from '../components/AISettingsButton';
import { pluginStore, type StorageKind } from '../utils/storage';
import type { PluginEnv, PluginStorage } from './types';

/** A database of the plugin alone, for one kind of its data */
function createPluginStorage(pluginId: string, kind: StorageKind): PluginStorage {
    const store = pluginStore(pluginId, kind);
    return {
        get: key => get(key, store),
        set: (key, value) => set(key, value, store),
        del: key => del(key, store),
        keys: async () => (await keys(store)).filter((key): key is string => typeof key === 'string'),
    };
}

/** The storages and the AI given to a plugin, its storages kept on databases of its own */
export function createPluginEnv(pluginId: string): PluginEnv {
    return {
        storage: { personal: createPluginStorage(pluginId, 'personal'), optimization: createPluginStorage(pluginId, 'optimization') },
        ai: {
            // Not kept on the server unless the plugin asks to, as for a prompt it starts every question with
            complete: (messages, { onProgress, cache = false, settings } = {}) => callOpenAiApi(messages, onProgress, { cache, settings }),
        },
        settingsComponents: { AISettingsButton },
    };
}
