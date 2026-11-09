import type { PDFDocumentProxy } from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { forgetDocumentTextOrganization, isDocumentTextOrganized, organizeDocumentText } from '../services/ai-helper';
import type { FullText } from '../models/Article';
import { createProgressTracker, tokenize } from './progressTracker';
import { PAGE_MAX_SIDE } from './pageImages';
import { scoped } from './projects';

export type PreprocessingProgress = {
    /** From 0 to 1 */
    progress: number;
    /** The page being reached by the AI, available once the normalization starts */
    page?: number;
    /** How many words the AI has generated so far */
    generatedWords?: number;
    /** What the AI has written so far, once the normalization starts */
    streamed?: string;
};

/** Share of the progress taken by the AI reading the document (the prefill). The rest follows the pages it writes */
const PREFILL_WEIGHT = 0.5;

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

/** An image of each page, as a PNG data URL, with its longest side as `PAGE_MAX_SIDE` */
export async function renderPageImages(fullText: FullText): Promise<string[]> {
    const pdf = await loadPdf(await (await fetch(fullText.url)).arrayBuffer());
    const images: string[] = [];
    // One page at a time, so only one canvas is in memory
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
        const page = await pdf.getPage(pageNo);
        const { width, height } = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: PAGE_MAX_SIDE / Math.max(width, height) });
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise;
        images.push(canvas.toDataURL('image/png'));
        page.cleanup();
    }
    return images;
}

export async function countWords(pdfBytes: ArrayBuffer) {
    return tokenize((await extractPageTexts(pdfBytes)).join(' ')).length;
}

async function preprocessPDF(pdfBytes: ArrayBuffer, onProgress: (progress: PreprocessingProgress) => void): Promise<string> {
    const pageTexts = await extractPageTexts(pdfBytes);

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
            progress: PREFILL_WEIGHT + (1 - PREFILL_WEIGHT) * Math.min(0.99, tracked.progress),
            page: tracked.page,
            generatedWords,
            streamed: received,
        });
    }, read => onProgress({ progress: PREFILL_WEIGHT * read }));
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
    // By project, as nothing done for a project is reused by another
    const key = scoped(fullText.hash);
    const cached = normalizedTexts.get(key);
    if (cached) return cached;

    const processing = fetch(fullText.url)
        .then(r => r.arrayBuffer())
        .then(bytes => preprocessPDF(bytes, onProgress))
        .catch(error => {
            normalizedTexts.delete(key);
            throw error;
        });
    normalizedTexts.set(key, processing);
    return processing;
}

/** Discards the organized text of a full text, kept and saved, so the next warm up normalizes it again */
export async function clearNormalizedText(fullText: FullText) {
    normalizedTexts.delete(scoped(fullText.hash));
    const bytes = await (await fetch(fullText.url)).arrayBuffer();
    await forgetDocumentTextOrganization((await extractPageTexts(bytes)).join(' '));
}
