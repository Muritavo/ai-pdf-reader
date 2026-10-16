const escapeText = (text: string) => text.replace(/[\\()]/g, '\\$&');

/**
 * Builds a valid PDF with a known text, so the specs can assert on it.
 * Every entry of `pages` is a page and every string is a line (use ASCII only).
 */
export function makePdf(pages: string[][]): Buffer {
    const objects: string[] = [];
    objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    objects[2] = `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + 2 * i} 0 R`).join(' ')}] /Count ${pages.length} >>`;
    objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
    pages.forEach((lines, i) => {
        const stream = lines.map((line, j) => `BT /F1 14 Tf 72 ${780 - 28 * j} Td (${escapeText(line)}) Tj ET`).join('\n');
        objects[4 + 2 * i] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + 2 * i} 0 R >>`;
        objects[5 + 2 * i] = `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`;
    });

    let out = '%PDF-1.4\n';
    const offsets: number[] = [];
    for (let n = 1; n < objects.length; n++) {
        offsets[n] = Buffer.byteLength(out);
        out += `${n} 0 obj\n${objects[n]}\nendobj\n`;
    }
    const xrefOffset = Buffer.byteLength(out);
    out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
    out += offsets
        .slice(1)
        .map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`)
        .join('');
    out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    return Buffer.from(out, 'latin1');
}

export type UploadableFile = { name: string; mimeType: string; buffer: Buffer };

export function pdfFile(name: string, pages: string[][]): UploadableFile {
    return { name, mimeType: 'application/pdf', buffer: makePdf(pages) };
}

/** Starts like a PDF, but its content can't be parsed */
export function corruptedPdfFile(name = 'corrupted.pdf'): UploadableFile {
    return { name, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nthis is not really a pdf, the structure is broken\n') };
}

export function textFile(name = 'notes.txt'): UploadableFile {
    return { name, mimeType: 'text/plain', buffer: Buffer.from('Just some notes, definitely not a PDF') };
}

/**
 * The document used by most specs. "proteome" appears 4 times as a whole word
 * (plus "proteomes" and "acetyl-proteomic", which must not be counted), over 3 pages.
 */
export const SAMPLE_PAGES = [
    ['Proteome analysis of ovarian tissue', 'The proteome changes after menopause', 'Introduction to proteomes and methods'],
    ['Plasma samples were collected from women', 'We compared the proteome between groups', 'Results are shown for each group'],
    ['Discussion about acetyl-proteomic profiles', 'A stable proteome was not observed', 'Conclusion of the study'],
];
export const SAMPLE_WORD = 'proteome';
export const SAMPLE_WORD_OCCURRENCES = 4;
export const sampleWordCount = SAMPLE_PAGES.flat().join(' ').split(/\s+/).length;
export const samplePdf = () => pdfFile('sample.pdf', SAMPLE_PAGES);
