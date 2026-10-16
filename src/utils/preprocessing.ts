import type { PDFDocumentProxy } from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { organizeDocumentText } from '../services/ai-helper';
import type { FullText } from '../models/Article';

/** Share of the progress taken by extracting the text from the pages. The rest is the AI normalization */
const EXTRACTION_WEIGHT = 0.3;
/** The normalized markdown is expected to be slightly bigger than the extracted text */
const EXPECTED_GROWTH = 1.1;

async function preprocessPDF(pdfBytes: ArrayBuffer, onProgress: (progress: number) => void): Promise<string> {
    const getPageText = async (pdf: PDFDocumentProxy, pageNo: number) => {
        const page = await pdf.getPage(pageNo);
        const tokenizedText = await page.getTextContent();
        return tokenizedText.items.map(token => ('transform' in token ? token.str : undefined)).join('');
    };
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;
    const pdf = await pdfjsLib.getDocument({ data: pdfBytes }).promise;

    let extractedPages = 0;
    const pageTexts = await Promise.all(
        Array.from({ length: pdf.numPages }, async (_, i) => {
            const text = await getPageText(pdf, i + 1);
            extractedPages += 1;
            onProgress((extractedPages / pdf.numPages) * EXTRACTION_WEIGHT);
            return text;
        }),
    );

    const extractedText = pageTexts.join(' ');
    const expectedLength = extractedText.length * EXPECTED_GROWTH;
    const normalized = await organizeDocumentText(extractedText, receivedCharacters =>
        onProgress(EXTRACTION_WEIGHT + (1 - EXTRACTION_WEIGHT) * Math.min(0.99, receivedCharacters / expectedLength)),
    );
    onProgress(1);
    return normalized;
}

const normalizedTexts = new Map<string, Promise<string>>();

/** The AI organized text of a full text, processed only when first needed and shared afterwards */
export function getNormalizedText(fullText: FullText, onProgress: (progress: number) => void = () => {}): Promise<string> {
    const cached = normalizedTexts.get(fullText.hash);
    if (cached) return cached;

    const processing = fetch(fullText.url)
        .then(r => r.arrayBuffer())
        .then(bytes => preprocessPDF(bytes, onProgress))
        .catch(error => {
            normalizedTexts.delete(fullText.hash);
            throw error;
        });
    normalizedTexts.set(fullText.hash, processing);
    return processing;
}
