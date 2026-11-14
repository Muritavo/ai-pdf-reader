import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import type { ImageBox } from '../../../utils/pageImages';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

export type PdfDocument = pdfjsLib.PDFDocumentProxy;

/** pdf.js takes the bytes over (detaching them), so it reads its own copy from the file */
export const openPdf = async (file: Blob) => pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;

/**
 * The leaders of a summary, as "Choroid plexus ........ 34", and the runs of spaces, as one space.
 * Separately, so the space after the end of a sentence is kept with its period
 */
const collapseLeaders = (text: string) => text.replace(/ *\.{2,} */g, ' - ').replace(/ {2,}/g, ' - ');

/** The text of the page, as extracted from the PDF, with its lines kept apart. With bounds, only the text whose middle is in them */
export async function pageText(pdf: PdfDocument, pageNo: number, bounds?: ImageBox) {
    const page = await pdf.getPage(pageNo);
    const content = await page.getTextContent();
    if (!bounds) return collapseLeaders(content.items.map(token => ('transform' in token ? token.str + (token.hasEOL ? '\n' : '') : '')).join(''));

    const viewport = page.getViewport({ scale: 1 });
    const inBounds = (token: TextItem) => {
        // The PDF counts from the bottom; the viewport, as the bounds, from the top
        const [x, y] = viewport.convertToViewportPoint(token.transform[4] + token.width / 2, token.transform[5] + token.height / 2);
        const left = x / viewport.width;
        const top = y / viewport.height;
        return left >= bounds.left && left <= bounds.left + bounds.width && top >= bounds.top && top <= bounds.top + bounds.height;
    };
    let text = '';
    for (const token of content.items) {
        if (!('transform' in token)) continue;
        if (token.str && inBounds(token)) text += token.str;
        // A line break only after text kept, so the lines left out don't leave blank ones
        if (token.hasEOL && text && !text.endsWith('\n')) text += '\n';
    }
    return collapseLeaders(text);
}

type OutlineItem = Awaited<ReturnType<PdfDocument['getOutline']>>[number];

/** The page of the PDF an entry of the outline points to, counting from 1, if it can be found */
async function pageOfDest(pdf: PdfDocument, dest: OutlineItem['dest']) {
    try {
        const explicit = typeof dest === 'string' ? await pdf.getDestination(dest) : dest;
        const ref = explicit?.[0];
        if (ref == null) return undefined;
        return (typeof ref === 'number' ? ref : await pdf.getPageIndex(ref)) + 1;
    } catch {
        return undefined;
    }
}

/** Whether the PDF has an outline (its bookmarks), as a glossary built in it */
export const hasOutline = async (pdf: PdfDocument) => ((await pdf.getOutline()) ?? []).length > 0;

/**
 * The outline of the PDF, one entry a line, indented by its level, with the page number printed on the book
 * (the page of the PDF less the offset), as the summary and the index give it
 */
export async function outlineText(pdf: PdfDocument, offset: number) {
    const lines: string[] = [];
    const walk = async (items: OutlineItem[], depth: number) => {
        for (const item of items) {
            const page = await pageOfDest(pdf, item.dest);
            lines.push(`${'  '.repeat(depth)}${item.title}${page === undefined ? '' : ` - ${page - offset}`}`);
            await walk(item.items ?? [], depth + 1);
        }
    };
    await walk((await pdf.getOutline()) ?? [], 0);
    return lines.join('\n');
}
