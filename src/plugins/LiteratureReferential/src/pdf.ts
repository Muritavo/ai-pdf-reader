import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

export type PdfDocument = pdfjsLib.PDFDocumentProxy;

/** pdf.js takes the bytes over (detaching them), so it reads its own copy from the file */
export const openPdf = async (file: Blob) => pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;

/**
 * The leaders of a summary, as "Choroid plexus ........ 34", and the runs of spaces, as one space.
 * Separately, so the space after the end of a sentence is kept with its period
 */
const collapseLeaders = (text: string) => text.replace(/ *\.{2,} */g, ' - ').replace(/ {2,}/g, ' - ');

/** The text of the page, as extracted from the PDF, with its lines kept apart */
export async function pageText(pdf: PdfDocument, pageNo: number) {
    const page = await pdf.getPage(pageNo);
    const content = await page.getTextContent();
    return collapseLeaders(content.items.map(token => ('transform' in token ? token.str + (token.hasEOL ? '\n' : '') : '')).join(''));
}
