import type { PluginEnv } from '../../types';
import { openBook, pagesOf, savePreload, setPreloadProgress, type Book } from './library';
import { outlineText, pageText } from './pdf';
import { preloadMessages } from './prompt';

/** Sends the text of every page of the book to the AI, kept on its cache, so the highlights are asked about without sending it again */
export async function preloadBook({ storage, ai }: PluginEnv, book: Book) {
    const total = pagesOf(book).length;
    setPreloadProgress(book.id, { total });
    try {
        const pdf = await openBook(storage, book.id);
        const content = (await Promise.all(pagesOf(book).map(async ({ page, boundary }) => ({ page, text: await pageText(pdf, page, boundary) })))).filter(
            ({ text }) => text.trim(),
        );
        const outline = book.glossary ? await outlineText(pdf, book.offset ?? 0) : undefined;
        await ai.complete(preloadMessages(book, content, outline), { cache: true, settings: book.ai });
        await savePreload(storage, book.id, book, content, outline);
        setPreloadProgress(book.id, undefined);
    } catch (e) {
        setPreloadProgress(book.id, { total, error: e instanceof Error ? e.message : String(e) });
    }
}
