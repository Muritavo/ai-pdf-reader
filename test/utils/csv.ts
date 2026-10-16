import type { UploadableFile } from './pdf';

type Row = Record<string, string>;

function quote(value: string, delimiter: string) {
    return /["\n\r]/.test(value) || value.includes(delimiter) ? `"${value.replace(/"/g, '""')}"` : value;
}

export type CsvOptions = {
    delimiter?: string;
    lineBreak?: string;
    /** Excel exports prepend it to UTF-8 files */
    bom?: boolean;
};

export function buildCsv(columns: string[], rows: Row[], { delimiter = ',', lineBreak = '\n', bom = false }: CsvOptions = {}): UploadableFile {
    const lines = [columns, ...rows.map(row => columns.map(column => row[column] ?? ''))].map(cells =>
        cells.map(cell => quote(cell, delimiter)).join(delimiter),
    );
    return {
        name: 'references.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(`${bom ? '﻿' : ''}${lines.join(lineBreak)}${lineBreak}`, 'utf-8'),
    };
}

/** Builds `count` articles like "Article 1" with the standard columns */
export function sampleArticles(count: number): Row[] {
    return Array.from({ length: count }, (_, i) => ({
        key: `ref-${i + 1}`,
        title: `Article ${i + 1} about proteomes`,
        year: String(2000 + i),
        journal: `Journal ${i + 1}`,
    }));
}

export const STANDARD_COLUMNS = ['key', 'title', 'year', 'journal'];
