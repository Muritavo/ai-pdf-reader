/** Tells an export of this app apart from any other JSON */
const FORMAT = 'research-workflow-export';

export type DataExport = {
    format: typeof FORMAT;
    exportedAt: string;
    /** Everything kept in the browser storage, as it is kept: the references, the highlights, the questions... */
    localStorage: Record<string, string>;
};

/** All the data kept by the app, except the PDFs, which stay in the browser file storage of each machine */
export function exportData(): DataExport {
    const stored: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)!;
        stored[key] = localStorage.getItem(key)!;
    }
    return { format: FORMAT, exportedAt: new Date().toISOString(), localStorage: stored };
}

/** Downloads the export as a file named with its day */
export function downloadExport() {
    const data = exportData();
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `research-workflow-${data.exportedAt.slice(0, 10)}.json`;
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

/** Replaces what is kept in the browser storage with the export. The PDFs already stored stay */
export function importData(data: DataExport) {
    localStorage.clear();
    for (const [key, value] of Object.entries(data.localStorage)) localStorage.setItem(key, value);
}
