import type { PDFDocumentProxy } from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { isDocumentTextOrganized, organizeDocumentText } from '../services/ai-helper';
import type { FullText } from '../models/Article';
import { createProgressTracker, tokenize } from './progressTracker';

export type PreprocessingProgress = {
    /** From 0 to 1 */
    progress: number;
    /** The page being reached by the AI, available once the normalization starts */
    page?: number;
    /** How many words the AI has generated so far */
    generatedWords?: number;
};

/** Share of the progress taken by extracting the text from the pages. The rest is the AI normalization */
const EXTRACTION_WEIGHT = 0.3;

async function loadPdf(pdfBytes: ArrayBuffer) {
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;
    return pdfjsLib.getDocument({ data: pdfBytes }).promise;
}

/** The raw text of each page, as extracted from the PDF */
export async function extractPageTexts(
    pdfBytes: ArrayBuffer,
    onPageExtracted: (extractedPages: number, totalPages: number) => void = () => {},
): Promise<string[]> {
    const getPageText = async (pdf: PDFDocumentProxy, pageNo: number) => {
        const page = await pdf.getPage(pageNo);
        const tokenizedText = await page.getTextContent();
        // Lines are kept apart, otherwise the last word of a line is glued to the first of the next one
        return tokenizedText.items.map(token => ('transform' in token ? token.str + (token.hasEOL ? '\n' : '') : '')).join('');
    };
    const pdf = await loadPdf(pdfBytes);

    let extractedPages = 0;
    return Promise.all(
        Array.from({ length: pdf.numPages }, async (_, i) => {
            const text = await getPageText(pdf, i + 1);
            extractedPages += 1;
            onPageExtracted(extractedPages, pdf.numPages);
            return text;
        }),
    );
}

export async function countWords(pdfBytes: ArrayBuffer) {
    return tokenize((await extractPageTexts(pdfBytes)).join(' ')).length;
}

async function preprocessPDF(pdfBytes: ArrayBuffer, onProgress: (progress: PreprocessingProgress) => void): Promise<string> {
    const pageTexts = await extractPageTexts(pdfBytes, (extractedPages, totalPages) =>
        onProgress({ progress: (extractedPages / totalPages) * EXTRACTION_WEIGHT }),
    );

    const tracker = createProgressTracker(pageTexts);
    let received = '';
    let generatedWords = 0;
    let insideWord = false;
    const normalized = await organizeDocumentText(pageTexts.join(' '), chunk => {
        received += chunk;
        for (const character of chunk) {
            const isSpace = /\s/.test(character);
            if (!isSpace && !insideWord) generatedWords += 1;
            insideWord = !isSpace;
        }
        const tracked = tracker.track(received);
        onProgress({
            progress: EXTRACTION_WEIGHT + (1 - EXTRACTION_WEIGHT) * Math.min(0.99, tracked.progress),
            page: tracked.page,
            generatedWords,
        });
    });
    onProgress({ progress: 1 });
    return normalized;
}

/**
 * Whether the document was already warmed up before, checked without the AI:
 * the text is extracted again and looked up on the cache of the organized texts.
 */
export async function wasWarmedUpBefore(fullText: FullText): Promise<boolean> {
    try {
        const bytes = await (await fetch(fullText.url)).arrayBuffer();
        return await isDocumentTextOrganized((await extractPageTexts(bytes)).join(' '));
    } catch {
        return false;
    }
}

const normalizedTexts = new Map<string, Promise<string>>();

/** The AI organized text of a full text, processed only when first needed and shared afterwards */
export function getNormalizedText(
    fullText: FullText,
    onProgress: (progress: PreprocessingProgress) => void = () => {},
): Promise<string> {
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
