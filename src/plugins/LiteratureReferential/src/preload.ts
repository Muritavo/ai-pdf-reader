import type { PluginEnv } from '../../types';
import { openBook, pagesOf, savePreload, setPreloadProgress, type Book } from './library';
import { pageText } from './pdf';
import { preloadMessages } from './prompt';

/** Sends the text of every page of the ranges to the AI, kept on its cache, so the highlights are asked about without sending it again */
export async function preloadBook({ storage, ai }: PluginEnv, book: Book) {
    const total = pagesOf(book.ranges).length;
    setPreloadProgress(book.id, { total });
    try {
        const pdf = await openBook(storage, book.id);
        const content = (await Promise.all(pagesOf(book.ranges).map(async page => ({ page, text: await pageText(pdf, page) })))).filter(
            ({ text }) => text.trim(),
        );
        await ai.complete(preloadMessages(book, content), { cache: true });
        await savePreload(storage, book.id, book.ranges, content);
        setPreloadProgress(book.id, undefined);
    } catch (e) {
        setPreloadProgress(book.id, { total, error: e instanceof Error ? e.message : String(e) });
    }
}
