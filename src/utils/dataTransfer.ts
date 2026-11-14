import { get, keys, set } from 'idb-keyval';
import { AI_CONFIG_KEYS } from './aiProviders';
import { PLUGIN_DB_PREFIX, pluginStore } from './storage';
import { allProjectsEntries, clearProjectEntries, loadProjects, projectEntries, saveProjects, scoped, splitProjectKey, type Project } from './projects';

/** Tells an export of this app apart from any other JSON */
const FORMAT = 'research-workflow-export';

export type DataExport = {
    format: typeof FORMAT;
    exportedAt: string;
    /** Everything the project keeps in the browser storage: the references, the highlights, the questions... but the AI configuration */
    localStorage: Record<string, string>;
};

const isAIConfig = (key: string) => AI_CONFIG_KEYS.includes(key);

/** What the project keeps, without the AI configuration */
const withoutAIConfig = (entries: Record<string, string>) => Object.fromEntries(Object.entries(entries).filter(([key]) => !isAIConfig(key)));

/**
 * All the data of the open project, except the PDFs, which stay in the browser file storage of each machine,
 * and the AI configuration, which belongs to the machine and holds the API keys
 */
export function exportData(): DataExport {
    return { format: FORMAT, exportedAt: new Date().toISOString(), localStorage: withoutAIConfig(projectEntries()) };
}

/** Downloads the export as a file named with its day */
export function downloadExport() {
    const data = exportData();
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `research-toolkit-${data.exportedAt.slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
}

/** Reads an export, or undefined when the file is not one */
export function parseExport(text: string): DataExport | undefined {
    try {
        const data = JSON.parse(text) as Partial<DataExport>;
        const values = data.localStorage;
        if (data.format !== FORMAT || !values || typeof values !== 'object') return undefined;
        if (!Object.values(values).every(value => typeof value === 'string')) return undefined;
        return data as DataExport;
    } catch {
        return undefined;
    }
}

/**
 * Replaces what the open project keeps with the export. The PDFs already stored stay, and so does the AI configuration:
 * an export never brings one, as it could send the documents to a server of whoever made the file
 */
export function importData(data: DataExport) {
    const aiConfig = Object.entries(projectEntries()).filter(([key]) => isAIConfig(key));
    clearProjectEntries();
    for (const [key, value] of Object.entries(withoutAIConfig(data.localStorage))) localStorage.setItem(scoped(key), value);
    for (const [key, value] of aiConfig) localStorage.setItem(scoped(key), value);
}

/** Tells what a device sends on a sync apart from anything else */
const SYNC_FORMAT = 'research-workflow-sync';

/** What a device sends on a sync: every project it has, with everything they keep but the PDFs and the AI configuration */
export type SyncExport = {
    format: typeof SYNC_FORMAT;
    exportedAt: string;
    projects: Project[];
    /** By their full key (project/<id>/...) */
    entries: Record<string, string>;
    /** The personal storage of each plugin, by its id and then by key, without the files (as the PDFs of the books). Missing from devices before it */
    plugins?: Record<string, Record<string, unknown>>;
};

/** A file or bytes, which stay on the device as the PDFs do */
const hasBinary = (value: unknown): boolean => {
    if (value instanceof Blob || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return true;
    if (Array.isArray(value)) return value.some(hasBinary);
    if (value && typeof value === 'object') return Object.values(value).some(hasBinary);
    return false;
};

/** The ids of the plugins with a personal storage on this device, from the names of their databases */
async function pluginIds() {
    const databases = (await indexedDB.databases?.()) ?? [];
    return databases.flatMap(({ name }) => (name?.startsWith(PLUGIN_DB_PREFIX) && name.endsWith('/personal') ? [name.slice(PLUGIN_DB_PREFIX.length, -'/personal'.length)] : []));
}

/** The personal storage of every plugin, without its files */
async function exportPlugins() {
    const plugins: Record<string, Record<string, unknown>> = {};
    for (const id of await pluginIds()) {
        const store = pluginStore(id, 'personal');
        const values: Record<string, unknown> = {};
        for (const key of await keys(store)) {
            if (typeof key !== 'string') continue;
            const value = await get(key, store);
            if (!hasBinary(value)) values[key] = value;
        }
        plugins[id] = values;
    }
    return plugins;
}

type WithId = { id: string };
const isListById = (value: unknown): value is WithId[] =>
    Array.isArray(value) && value.every(item => !!item && typeof item === 'object' && typeof (item as Partial<WithId>).id === 'string');

/**
 * Adds what this device misses of the plugins: a key it has no value for, and, on a list of items with ids (as the books),
 * the items it has no id of. Returns how many were added
 */
async function mergePlugins(plugins: Record<string, Record<string, unknown>>) {
    let added = 0;
    for (const [id, values] of Object.entries(plugins)) {
        const store = pluginStore(id, 'personal');
        for (const [key, value] of Object.entries(values)) {
            if (hasBinary(value)) continue;
            const current = await get(key, store);
            if (current === undefined) {
                await set(key, value, store);
                added++;
            } else if (isListById(current) && isListById(value)) {
                const known = new Set(current.map(item => item.id));
                const missing = value.filter(item => !known.has(item.id));
                if (!missing.length) continue;
                await set(key, [...current, ...missing], store);
                added += missing.length;
            }
        }
    }
    return added;
}

/** Whether the full key holds the AI configuration of a project, which never leaves the machine */
const isProjectAIConfig = (key: string) => {
    const split = splitProjectKey(key);
    return !split || isAIConfig(split.key);
};

export async function exportAllProjects(): Promise<SyncExport> {
    const entries = Object.fromEntries(Object.entries(allProjectsEntries()).filter(([key]) => !isProjectAIConfig(key)));
    return { format: SYNC_FORMAT, exportedAt: new Date().toISOString(), projects: loadProjects().projects, entries, plugins: await exportPlugins() };
}

/** Reads what a device sent on a sync, or undefined when it is not one */
export function parseSyncExport(text: string): SyncExport | undefined {
    try {
        const data = JSON.parse(text) as Partial<SyncExport>;
        if (data.format !== SYNC_FORMAT || !Array.isArray(data.projects) || !data.entries || typeof data.entries !== 'object') return undefined;
        if (!data.projects.every(project => typeof project?.id === 'string' && typeof project.name === 'string')) return undefined;
        if (!Object.values(data.entries).every(value => typeof value === 'string')) return undefined;
        if (data.plugins !== undefined && !(data.plugins && typeof data.plugins === 'object' && Object.values(data.plugins).every(values => values && typeof values === 'object')))
            return undefined;
        return data as SyncExport;
    } catch {
        return undefined;
    }
}

/**
 * Adds what this device misses from a sync, never replacing nor removing anything:
 * a project is added when there is none with its id, and a key only when this device has no value for it.
 * The AI configuration that may come is ignored, as on importData. What is added to the plugins counts as entries
 */
export async function mergeSyncExport(data: SyncExport): Promise<{ projects: number; entries: number }> {
    const state = loadProjects();
    const known = new Set(state.projects.map(project => project.id));
    const added = data.projects.filter(project => !known.has(project.id));
    if (added.length) saveProjects({ ...state, projects: [...state.projects, ...added] });

    // Only the keys of the projects that came, so nothing lands outside of a project
    const sent = new Set(data.projects.map(project => project.id));
    let entries = 0;
    for (const [key, value] of Object.entries(data.entries)) {
        const split = splitProjectKey(key);
        if (!split || !sent.has(split.id) || isAIConfig(split.key)) continue;
        if (localStorage.getItem(key) !== null) continue;
        localStorage.setItem(key, value);
        entries++;
    }
    if (data.plugins) entries += await mergePlugins(data.plugins);
    return { projects: added.length, entries };
}
