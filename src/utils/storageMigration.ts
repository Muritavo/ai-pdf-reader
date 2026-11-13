import { createStore, get, keys, set, type UseStore } from 'idb-keyval';
import { optimizationStore, personalStore, pluginStore } from './storage';

/** The single database everything was kept on before, the default of idb-keyval */
const LEGACY_DB = 'keyval-store';
const LEGACY_STORE = 'keyval';

/** Kept on the personal database once everything was copied, so the copy runs once */
const MIGRATED_KEY = 'meta/migrated-from-keyval-store';

/** The AI answers of a project, as project/<id>/cache-<sha256> */
const PROJECT_CACHE_KEY = /^project\/[^/]+\/cache-[0-9a-f]{64}$/;
/** What a plugin kept under its prefix, as plugins/<id>/<key> */
const PLUGIN_KEY = /^plugins\/([^/]+)\/(.+)$/;

/** The plugin keys that can't be redone: the books added to LiteratureReferential and their PDFs. Any other plugin key was downloaded or asked to the AI */
const isPersonalPluginKey = (pluginId: string, key: string) => pluginId === 'literature-referential' && (key === 'books' || key.startsWith('pdf/'));

/** Where a key of the old database goes, and under which key */
function destinationOf(key: string): { store: UseStore; key: string } {
    if (PROJECT_CACHE_KEY.test(key)) return { store: optimizationStore, key };
    const plugin = PLUGIN_KEY.exec(key);
    if (plugin) {
        const [, pluginId, pluginKey] = plugin;
        return { store: pluginStore(pluginId, isPersonalPluginKey(pluginId, pluginKey) ? 'personal' : 'optimization'), key: pluginKey };
    }
    // The PDFs and the attachments folder of the projects, and anything not known: kept as personal, so nothing is lost
    return { store: personalStore, key };
}

/** Whether the browser tells the old database is missing, so it is not created just to be read */
async function legacyIsMissing() {
    if (!('databases' in indexedDB)) return false;
    const databases = await indexedDB.databases();
    return !databases.some(db => db.name === LEGACY_DB);
}

/**
 * Copies what was kept on the old single database to the databases of each kind of data.
 * Only copies: the old database is left as it was, as a backup. A value already on the new database is never replaced,
 * so a copy stopped in the middle (as the tab closed) is finished on the next opening
 */
export async function migrateLegacyStore() {
    if (await get(MIGRATED_KEY, personalStore)) return;
    if (!(await legacyIsMissing())) {
        const legacy = createStore(LEGACY_DB, LEGACY_STORE);
        // One value at a time, as the PDFs together may not fit in memory
        for (const key of await keys(legacy)) {
            if (typeof key !== 'string') continue;
            const destination = destinationOf(key);
            if ((await get(destination.key, destination.store)) !== undefined) continue;
            const value = await get(key, legacy);
            if (value !== undefined) await set(destination.key, value, destination.store);
        }
    }
    await set(MIGRATED_KEY, new Date().toISOString(), personalStore);
}
