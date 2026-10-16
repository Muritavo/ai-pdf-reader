import Papa from 'papaparse';
import type { Article } from '../models/Article';

type CsvRow = Record<string, string | undefined>;

const REQUIRED_COLUMNS = ['key', 'title'];

/** Some exported fields carry extra WoS tags (e.g. "10.1186/xyz     WE  - Science ...") */
function cleanField(value: string | undefined) {
    return (value ?? '').split(/\s{2,}[A-Z0-9]{2}\s+-\s/)[0].trim();
}

export async function parseArticlesCsv(file: File): Promise<Article[]> {
    const text = await file.text();
    const result = Papa.parse<CsvRow>(text, { header: true, skipEmptyLines: true });

    const columns = result.meta.fields ?? [];
    const missing = REQUIRED_COLUMNS.filter(c => !columns.includes(c));
    if (missing.length) {
        throw new Error(`Colunas obrigatórias ausentes no CSV: ${missing.join(', ')}`);
    }

    return result.data
        .filter(row => row.key && row.title)
        .map(row => ({
            key: row.key!.trim(),
            title: row.title!.trim(),
            year: cleanField(row.year),
            journal: cleanField(row.journal),
            authors: cleanField(row.authors),
            doi: cleanField(row.doi),
            abstract: (row.abstract ?? '').trim(),
        }));
}
