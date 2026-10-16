import type { PDFDocumentProxy } from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { organizeDocumentText } from '../services/ai-helper';
import type { FullText } from '../models/Article';

async function preprocessPDF(pdfBytes: ArrayBuffer): Promise<string> {
    const getPageText = async (pdf: PDFDocumentProxy, pageNo: number) => {
        const page = await pdf.getPage(pageNo);
        const tokenizedText = await page.getTextContent();
        return tokenizedText.items.map(token => ('transform' in token ? token.str : undefined)).join('');
    };
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;
    const pdf = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
    const pageTexts = await Promise.all(
        Array.from({ length: pdf.numPages }, (_, i) => getPageText(pdf, i + 1)),
    );
    return organizeDocumentText(pageTexts.join(' '));
}

const normalizedTexts = new Map<string, Promise<string>>();

/** The AI organized text of a full text, processed only when first needed and shared afterwards */
export function getNormalizedText(fullText: FullText): Promise<string> {
    const cached = normalizedTexts.get(fullText.hash);
    if (cached) return cached;

    const processing = fetch(fullText.url)
        .then(r => r.arrayBuffer())
        .then(preprocessPDF)
        .catch(error => {
            normalizedTexts.delete(fullText.hash);
            throw error;
        });
    normalizedTexts.set(fullText.hash, processing);
    return processing;
}
