import { AI_CONFIG_KEYS } from './aiProviders';
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
};

/** Whether the full key holds the AI configuration of a project, which never leaves the machine */
const isProjectAIConfig = (key: string) => {
    const split = splitProjectKey(key);
    return !split || isAIConfig(split.key);
};

export function exportAllProjects(): SyncExport {
    const entries = Object.fromEntries(Object.entries(allProjectsEntries()).filter(([key]) => !isProjectAIConfig(key)));
    return { format: SYNC_FORMAT, exportedAt: new Date().toISOString(), projects: loadProjects().projects, entries };
}

/** Reads what a device sent on a sync, or undefined when it is not one */
export function parseSyncExport(text: string): SyncExport | undefined {
    try {
        const data = JSON.parse(text) as Partial<SyncExport>;
        if (data.format !== SYNC_FORMAT || !Array.isArray(data.projects) || !data.entries || typeof data.entries !== 'object') return undefined;
        if (!data.projects.every(project => typeof project?.id === 'string' && typeof project.name === 'string')) return undefined;
        if (!Object.values(data.entries).every(value => typeof value === 'string')) return undefined;
        return data as SyncExport;
    } catch {
        return undefined;
    }
}

/**
 * Adds what this device misses from a sync, never replacing nor removing anything:
 * a project is added when there is none with its id, and a key only when this device has no value for it.
 * The AI configuration that may come is ignored, as on importData
 */
export function mergeSyncExport(data: SyncExport): { projects: number; entries: number } {
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
    return { projects: added.length, entries };
}
