import { AI_CONFIG_KEYS } from './aiProviders';
import { clearProjectEntries, projectEntries, scoped } from './projects';

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
