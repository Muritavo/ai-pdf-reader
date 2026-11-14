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
