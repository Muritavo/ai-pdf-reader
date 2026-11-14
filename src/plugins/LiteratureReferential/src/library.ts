import { useSyncExternalStore } from 'react';
import type { AISettings, PluginStores } from '../../types';
import type { ImageBox } from '../../../utils/pageImages';
import { openPdf, type PdfDocument } from './pdf';

/** A page of the PDF whose text is read, counting from 1. With a boundary, only the text within it, as fractions of the page */
export type BookPage = { page: number; boundary?: ImageBox };

/** Consecutive pages, both included, as they are shown */
export type PageRange = { from: number; to: number };

export type Book = {
    id: string;
    title: string;
    pageCount: number;
    /** The pages of the summary and of the index, which are read by the AI, in order */
    pages: BookPage[];
    /** The pages (and boundaries) whose text was sent to the AI, kept on its cache to ask about each highlight */
    cached?: { pages: string; at: string };
    /** Added to the page numbers of the summary and of the index, as the pages before the first numbered one (cover, preface) */
    offset?: number;
    /** The model and the thinking mode its requests use. Without it, the defaults of the app */
    ai?: AISettings;
    /** Turned off on the listing: kept with its preload, but not asked about the highlights */
    disabled?: boolean;
    /** Sends the outline of the PDF (its bookmarks), a glossary built in it, along with the pages */
    glossary?: boolean;
    /** The file the PDF was added from, to find the same one on another device, as the PDF itself isn't synced. The browser doesn't give its path */
    source?: { name: string; size: number; lastModified: number };
};

/** The page of the PDF a page number of the book is on */
export const pdfPageOf = (book: Book, page: number) => page + (book.offset ?? 0);

/** The text of a page of the book, as extracted from the PDF */
export type PageContent = { page: number; text: string };

/** The pages of a book being sent to the AI, or why it failed */
export type PreloadProgress = { total: number; error?: string };

/** The books and their PDFs are personal. What is read from them and asked to the AI is on the optimization storage */
const BOOKS_KEY = 'books';
const pdfKey = (id: string) => `pdf/${id}`;
const contentKey = (id: string) => `content/${id}`;
const outlineKey = (id: string) => `outline/${id}`;
/** The answers kept for the highlights, by the query */
export const answersKey = (id: string) => `answers/${id}`;

let books: Book[] = [];
let preloading: Record<string, PreloadProgress> = {};
/** The books whose PDF isn't on this device, as when they came from another one */
let missingPdfs: ReadonlySet<string> = new Set();
/** Kept as it was sent, so every question starts exactly as the preload did and reuses the cache of the AI */
const contentByBook = new Map<string, PageContent[]>();
/** The outline sent with the pages, of the books preloaded with their glossary */
const outlineByBook = new Map<string, string>();
const opened = new Map<string, Promise<PdfDocument>>();
const fileUrls = new Map<string, Promise<string>>();
const listeners = new Set<() => void>();

const notify = () => listeners.forEach(listener => listener());
const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};

/** The pages of the book, empty for one saved before they replaced the ranges */
export const pagesOf = (book: Pick<Book, 'pages'>) => book.pages ?? [];

const boundaryKey = (boundary?: ImageBox) =>
    boundary ? `@${[boundary.left, boundary.top, boundary.width, boundary.height].map(n => n.toFixed(4)).join(',')}` : '';
/** What is read from the book: its pages, their boundaries and, with the glossary, the offset its page numbers are printed with */
const readKey = (book: Pick<Book, 'pages' | 'glossary' | 'offset'>) =>
    pagesOf(book)
        .map(({ page, boundary }) => page + boundaryKey(boundary))
        .join(',') + (book.glossary ? `|glossary${book.offset ?? 0}` : '');

/** Has something to send to the AI: pages, or the glossary */
export const hasContent = (book: Pick<Book, 'pages' | 'glossary'>) => pagesOf(book).length > 0 || !!book.glossary;

/** Read with the pages, boundaries and glossary it has now. Changing them asks for reading it again */
export const isPreloaded = (book: Book) => book.cached?.pages === readKey(book);

/** The pages as runs of consecutive ones, a page with a boundary always on its own, to be shown */
export function rangesOf(pages: BookPage[]): (PageRange & { boundary?: ImageBox })[] {
    const ranges: (PageRange & { boundary?: ImageBox })[] = [];
    for (const { page, boundary } of pages) {
        const last = ranges.at(-1);
        if (last && !last.boundary && !boundary && last.to === page - 1) last.to = page;
        else ranges.push({ from: page, to: page, boundary });
    }
    return ranges;
}

export async function loadLibrary(storage: PluginStores) {
    books = (await storage.personal.get<Book[]>(BOOKS_KEY)) ?? [];
    const stored = new Set(await storage.personal.keys());
    missingPdfs = new Set(books.filter(book => !stored.has(pdfKey(book.id))).map(book => book.id));
    await Promise.all(
        books.filter(isPreloaded).map(async book => {
            contentByBook.set(book.id, (await storage.optimization.get<PageContent[]>(contentKey(book.id))) ?? []);
            const outline = book.glossary ? await storage.optimization.get<string>(outlineKey(book.id)) : undefined;
            if (outline) outlineByBook.set(book.id, outline);
        }),
    );
    notify();
}

export const useBooks = () => useSyncExternalStore(subscribe, () => books);
export const usePreloading = () => useSyncExternalStore(subscribe, () => preloading);
export const useMissingPdfs = () => useSyncExternalStore(subscribe, () => missingPdfs);
/** Preloaded and not turned off */
const isConsulted = (book: Book) => isPreloaded(book) && !book.disabled;

export const usePreloadedCount = () => useSyncExternalStore(subscribe, () => books.filter(isConsulted).length);
export const preloadedBooks = () => books.filter(isConsulted);
export const preloadedCount = () => preloadedBooks().length;
export const contentOf = (id: string) => contentByBook.get(id) ?? [];
export const outlineOf = (id: string) => outlineByBook.get(id);

export function setPreloadProgress(id: string, progress: PreloadProgress | undefined) {
    const { [id]: _, ...others } = preloading;
    preloading = progress ? { ...others, [id]: progress } : others;
    notify();
}

async function saveBooks(storage: PluginStores, next: Book[]) {
    books = next;
    await storage.personal.set(BOOKS_KEY, next);
    notify();
}

/** crypto.randomUUID is missing outside of secure contexts, as when opened through http://<ip> */
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** Stored as a Blob, as IndexedDB keeps it as a file and a value of bytes over ~133 MB is refused. The ones stored as bytes before still open */
async function fileOf(storage: PluginStores, id: string) {
    const stored = await storage.personal.get<Blob | ArrayBuffer>(pdfKey(id));
    if (!stored) {
        const source = books.find(book => book.id === id)?.source;
        throw new Error(source ? `O PDF do livro não foi encontrado (arquivo original: ${source.name})` : 'O PDF do livro não foi encontrado');
    }
    return stored instanceof Blob ? stored : new Blob([stored], { type: 'application/pdf' });
}

export async function addBook(storage: PluginStores, file: File) {
    const pdf = await openPdf(file);
    const book: Book = {
        id: newId(),
        title: file.name.replace(/\.pdf$/i, ''),
        pageCount: pdf.numPages,
        pages: [],
        source: { name: file.name, size: file.size, lastModified: file.lastModified },
    };
    await storage.personal.set(pdfKey(book.id), file);
    opened.set(book.id, Promise.resolve(pdf));
    await saveBooks(storage, [...books, book]);
}

/** Gives a book its PDF again, as on a device it was synced to. Its pages must be the same, as its pages point to them */
export async function relinkBook(storage: PluginStores, id: string, file: File) {
    const book = books.find(book => book.id === id);
    if (!book) throw new Error('O livro não foi encontrado');
    const pdf = await openPdf(file);
    if (pdf.numPages !== book.pageCount) {
        pdf.loadingTask.destroy();
        throw new Error(`O PDF tem ${pdf.numPages} páginas, mas o livro tem ${book.pageCount}`);
    }
    await storage.personal.set(pdfKey(id), file);
    opened.get(id)?.then(previous => previous.loadingTask.destroy(), () => {});
    opened.set(id, Promise.resolve(pdf));
    fileUrls.get(id)?.then(url => URL.revokeObjectURL(url), () => {});
    fileUrls.delete(id);
    missingPdfs = new Set([...missingPdfs].filter(missing => missing !== id));
    await saveBooks(
        storage,
        books.map(other => (other.id === id ? { ...other, source: { name: file.name, size: file.size, lastModified: file.lastModified } } : other)),
    );
}

export async function removeBook(storage: PluginStores, id: string) {
    await Promise.all([
        storage.personal.del(pdfKey(id)),
        storage.optimization.del(contentKey(id)),
        storage.optimization.del(outlineKey(id)),
        storage.optimization.del(answersKey(id)),
    ]);
    contentByBook.delete(id);
    outlineByBook.delete(id);
    opened.get(id)?.then(pdf => pdf.loadingTask.destroy());
    opened.delete(id);
    fileUrls.get(id)?.then(url => URL.revokeObjectURL(url));
    fileUrls.delete(id);
    await saveBooks(
        storage,
        books.filter(book => book.id !== id),
    );
}

export async function savePages(storage: PluginStores, id: string, pages: BookPage[], glossary: boolean) {
    await saveBooks(
        storage,
        books.map(book => (book.id === id ? { ...book, pages, glossary } : book)),
    );
}

/** Not part of what is sent to the AI, so changing it keeps the book preloaded */
export async function saveOffset(storage: PluginStores, id: string, offset: number) {
    await saveBooks(
        storage,
        books.map(book => (book.id === id ? { ...book, offset } : book)),
    );
}

export async function saveDisabled(storage: PluginStores, id: string, disabled: boolean) {
    await saveBooks(
        storage,
        books.map(book => (book.id === id ? { ...book, disabled } : book)),
    );
}

export async function saveAISettings(storage: PluginStores, id: string, ai: AISettings) {
    await saveBooks(
        storage,
        books.map(book => (book.id === id ? { ...book, ai } : book)),
    );
}

export async function savePreload(
    storage: PluginStores,
    id: string,
    read: Pick<Book, 'pages' | 'glossary' | 'offset'>,
    content: PageContent[],
    outline?: string,
) {
    await storage.optimization.set(contentKey(id), content);
    contentByBook.set(id, content);
    if (outline) {
        await storage.optimization.set(outlineKey(id), outline);
        outlineByBook.set(id, outline);
    } else {
        await storage.optimization.del(outlineKey(id));
        outlineByBook.delete(id);
    }
    await saveBooks(
        storage,
        books.map(book => (book.id === id ? { ...book, cached: { pages: readKey(read), at: new Date().toISOString() } } : book)),
    );
}

/** A URL of the PDF, for the viewer of the browser. Kept while the app is open, as the tabs opened with it still read it */
export function fileUrlOf(storage: PluginStores, id: string) {
    let url = fileUrls.get(id);
    if (!url) {
        url = fileOf(storage, id).then(file => URL.createObjectURL(file));
        url.catch(() => fileUrls.delete(id));
        fileUrls.set(id, url);
    }
    return url;
}

/** Opened once, as a book can have hundreds of pages */
export function openBook(storage: PluginStores, id: string) {
    let pdf = opened.get(id);
    if (!pdf) {
        pdf = fileOf(storage, id).then(openPdf);
        // A failure is not kept, so opening again tries again
        pdf.catch(() => opened.delete(id));
        opened.set(id, pdf);
    }
    return pdf;
}

