import type { PluginAIMessage } from '../../types';
import type { Book, PageContent } from './library';

/**
 * The start of every conversation about a book: its pages of the summary and of the index.
 * A message of its own, identical between the preload and the questions, as the server only reuses
 * what it already processed (KV cache) up to the end of a message, and only handles what follows.
 */
const shared = (book: Book, content: PageContent[]): PluginAIMessage => ({
    role: 'user',
    content: `Here is the information about the book "${book.title}" in relation to its pages organization (its table of contents and its index):

${content.map(({ page, text }) => `--- Page ${page} of the PDF ---\n${text}`).join('\n\n')}

Get ready for indexing the user requests. Ready?`,
});

/** Always the same, as the questions follow it and the answer of the preload may vary */
const READY: PluginAIMessage = { role: 'assistant', content: 'Ready.' };

/** Sent once, so the book is already processed by the time the first highlight is asked about */
export const preloadMessages = (book: Book, content: PageContent[]): PluginAIMessage[] => [shared(book, content)];

export const questionMessages = (book: Book, content: PageContent[], excerpt: string): PluginAIMessage[] => [
    shared(book, content),
    READY,
    {
        role: 'user',
        content: `Is the excerpt "${excerpt}" discussed on this book? Where?

Answer only with a JSON array of the places it is discussed, as the table of contents or the index point to them, as [{"page": 34, "term": "Choroid plexus"}]: "page" is the page number written on the table of contents or the index (not the page of the PDF where the entry is listed), and "term" the entry as it is written there, with its main entry before a subentry, as "Choroid plexus, of lateral ventricle". Include the synonyms and the closely related entries of the excerpt. If it is not discussed on this book, answer []. No other commentary.`,
    },
];
