import { createStore, type UseStore } from 'idb-keyval';

/**
 * The IndexedDB databases of the app, one for each kind of data, so clearing one never touches the others:
 * - personal: what the user built using the app and can't be redone (the PDFs, tags, notes, questions...). Never cleared to free space
 * - optimization: what can be redone by running the processes again (the AI answers, the downloaded lists...). Safe to clear
 * - plugin/<id>/<kind>: the same two kinds, for each plugin on its own
 */
const DB_PREFIX = 'research-workflow';
const STORE_NAME = 'entries';

export type StorageKind = 'personal' | 'optimization';

export const personalStore = createStore(`${DB_PREFIX}/personal`, STORE_NAME);
export const optimizationStore = createStore(`${DB_PREFIX}/optimization`, STORE_NAME);

const pluginStores = new Map<string, UseStore>();

/** The database of the plugin for that kind of data, created on its first use */
export function pluginStore(pluginId: string, kind: StorageKind) {
    const name = `${DB_PREFIX}/plugin/${pluginId}/${kind}`;
    let store = pluginStores.get(name);
    if (!store) {
        store = createStore(name, STORE_NAME);
        pluginStores.set(name, store);
    }
    return store;
}
