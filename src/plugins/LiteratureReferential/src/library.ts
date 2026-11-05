import { useSyncExternalStore } from 'react';
import type { AISettings, PluginStorage } from '../../types';
import { openPdf, type PdfDocument } from './pdf';

/** Pages of the PDF, both included, counting from 1 */
export type PageRange = { from: number; to: number };

export type Book = {
    id: string;
    title: string;
    pageCount: number;
    /** The pages of the summary and of the index, which are read by the AI */
    ranges: PageRange[];
    /** The ranges whose text was sent to the AI, kept on its cache to ask about each highlight */
    cached?: { ranges: string; at: string };
    /** Added to the page numbers of the summary and of the index, as the pages before the first numbered one (cover, preface) */
    offset?: number;
    /** The model and the thinking mode its requests use. Without it, the defaults of the app */
    ai?: AISettings;
    /** Turned off on the listing: kept with its preload, but not asked about the highlights */
    disabled?: boolean;
};

/** The page of the PDF a page number of the book is on */
export const pdfPageOf = (book: Book, page: number) => page + (book.offset ?? 0);

/** The text of a page of the ranges, as extracted from the PDF */
export type PageContent = { page: number; text: string };

/** The pages of the ranges of a book being sent to the AI, or why it failed */
export type PreloadProgress = { total: number; error?: string };

const BOOKS_KEY = 'books';
const pdfKey = (id: string) => `pdf/${id}`;
const contentKey = (id: string) => `content/${id}`;
/** The answers kept for the highlights, by the query */
export const answersKey = (id: string) => `answers/${id}`;

let books: Book[] = [];
let preloading: Record<string, PreloadProgress> = {};
/** Kept as it was sent, so every question starts exactly as the preload did and reuses the cache of the AI */
const contentByBook = new Map<string, PageContent[]>();
const opened = new Map<string, Promise<PdfDocument>>();
const fileUrls = new Map<string, Promise<string>>();
const listeners = new Set<() => void>();

const notify = () => listeners.forEach(listener => listener());
const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};

export const rangesKey = (ranges: PageRange[]) => ranges.map(({ from, to }) => `${from}-${to}`).join(',');

/** Read with the ranges it has now. Changing them asks for reading it again */
export const isPreloaded = (book: Book) => book.cached?.ranges === rangesKey(book.ranges);

/** Every page of the ranges, in order */
export const pagesOf = (ranges: PageRange[]) =>
    ranges.flatMap(({ from, to }) => Array.from({ length: to - from + 1 }, (_, i) => from + i));

export async function loadLibrary(storage: PluginStorage) {
    books = (await storage.get<Book[]>(BOOKS_KEY)) ?? [];
    await Promise.all(
        books.filter(isPreloaded).map(async book => contentByBook.set(book.id, (await storage.get<PageContent[]>(contentKey(book.id))) ?? [])),
    );
    notify();
}

export const useBooks = () => useSyncExternalStore(subscribe, () => books);
export const usePreloading = () => useSyncExternalStore(subscribe, () => preloading);
/** Preloaded and not turned off */
const isConsulted = (book: Book) => isPreloaded(book) && !book.disabled;

export const usePreloadedCount = () => useSyncExternalStore(subscribe, () => books.filter(isConsulted).length);
export const preloadedBooks = () => books.filter(isConsulted);
export const preloadedCount = () => preloadedBooks().length;
export const contentOf = (id: string) => contentByBook.get(id) ?? [];

export function setPreloadProgress(id: string, progress: PreloadProgress | undefined) {
    const { [id]: _, ...others } = preloading;
    preloading = progress ? { ...others, [id]: progress } : others;
    notify();
}

async function saveBooks(storage: PluginStorage, next: Book[]) {
    books = next;
    await storage.set(BOOKS_KEY, next);
    notify();
}

/** crypto.randomUUID is missing outside of secure contexts, as when opened through http://<ip> */
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** Stored as a Blob, as IndexedDB keeps it as a file and a value of bytes over ~133 MB is refused. The ones stored as bytes before still open */
async function fileOf(storage: PluginStorage, id: string) {
    const stored = await storage.get<Blob | ArrayBuffer>(pdfKey(id));
    if (!stored) throw new Error('O PDF do livro não foi encontrado');
    return stored instanceof Blob ? stored : new Blob([stored], { type: 'application/pdf' });
}

export async function addBook(storage: PluginStorage, file: File) {
    const pdf = await openPdf(file);
    const book: Book = { id: newId(), title: file.name.replace(/\.pdf$/i, ''), pageCount: pdf.numPages, ranges: [] };
    await storage.set(pdfKey(book.id), file);
    opened.set(book.id, Promise.resolve(pdf));
    await saveBooks(storage, [...books, book]);
}

export async function removeBook(storage: PluginStorage, id: string) {
    await Promise.all([storage.del(pdfKey(id)), storage.del(contentKey(id)), storage.del(answersKey(id))]);
    contentByBook.delete(id);
    opened.get(id)?.then(pdf => pdf.loadingTask.destroy());
    opened.delete(id);
    fileUrls.get(id)?.then(url => URL.revokeObjectURL(url));
    fileUrls.delete(id);
    await saveBooks(
        storage,
        books.filter(book => book.id !== id),
    );
}

export async function saveRanges(storage: PluginStorage, id: string, ranges: PageRange[]) {
    await saveBooks(
        storage,
        books.map(book => (book.id === id ? { ...book, ranges } : book)),
    );
}

/** Not part of what is sent to the AI, so changing it keeps the book preloaded */
export async function saveOffset(storage: PluginStorage, id: string, offset: number) {
    await saveBooks(
        storage,
        books.map(book => (book.id === id ? { ...book, offset } : book)),
    );
}

export async function saveDisabled(storage: PluginStorage, id: string, disabled: boolean) {
    await saveBooks(
        storage,
        books.map(book => (book.id === id ? { ...book, disabled } : book)),
    );
}

export async function saveAISettings(storage: PluginStorage, id: string, ai: AISettings) {
    await saveBooks(
        storage,
        books.map(book => (book.id === id ? { ...book, ai } : book)),
    );
}

export async function savePreload(storage: PluginStorage, id: string, ranges: PageRange[], content: PageContent[]) {
    await storage.set(contentKey(id), content);
    contentByBook.set(id, content);
    await saveBooks(
        storage,
        books.map(book => (book.id === id ? { ...book, cached: { ranges: rangesKey(ranges), at: new Date().toISOString() } } : book)),
    );
}

/** A URL of the PDF, for the viewer of the browser. Kept while the app is open, as the tabs opened with it still read it */
export function fileUrlOf(storage: PluginStorage, id: string) {
    let url = fileUrls.get(id);
    if (!url) {
        url = fileOf(storage, id).then(file => URL.createObjectURL(file));
        url.catch(() => fileUrls.delete(id));
        fileUrls.set(id, url);
    }
    return url;
}

/** Opened once, as a book can have hundreds of pages */
export function openBook(storage: PluginStorage, id: string) {
    let pdf = opened.get(id);
    if (!pdf) {
        pdf = fileOf(storage, id).then(openPdf);
        // A failure is not kept, so opening again tries again
        pdf.catch(() => opened.delete(id));
        opened.set(id, pdf);
    }
    return pdf;
}
