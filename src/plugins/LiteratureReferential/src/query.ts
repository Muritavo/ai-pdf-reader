import { DEFAULT_AI_SETTINGS } from '../../../services/ai';
import type { PluginEnv } from '../../types';
import { answersKey, contentOf, preloadedBooks, type Book } from './library';
import { questionMessages } from './prompt';

/** A page of a book where the AI found the excerpt discussed */
export type Match = { book: Book; term: string; page: number };

/** The places shown for each book, the first ones the AI answered */
const MAX_MATCHES = 3;

type Place = Pick<Match, 'page' | 'term'>;

/** The answers of a book by excerpt, for the preload they were asked on, as preloading again may answer differently */
type StoredAnswers = { preloadedAt: string; byExcerpt: Record<string, Place[]> };


/** The same excerpt selected again, with another case or line breaks, is answered from what was kept */
const excerptKey = (excerpt: string) => excerpt.replace(/\s+/g, ' ').trim().toLowerCase();

function parsePlaces(answer: string, book: Book): Place[] {
    const start = answer.indexOf('[');
    const end = answer.lastIndexOf(']');
    try {
        const parsed = JSON.parse(answer.slice(start, end + 1)) as unknown[];
        const seen = new Set<number>();
        return parsed.flatMap(item => {
            const { page, term } = (item ?? {}) as { page?: unknown; term?: unknown };
            const number = Number(page);
            if (!Number.isInteger(number) || number < 1 || seen.has(number)) return [];
            seen.add(number);
            return [{ page: number, term: typeof term === 'string' ? term.trim() : '' }];
        });
    } catch {
        throw new Error(`A IA não respondeu com as páginas de ${book.title}`);
    }
}

/** What the book answered about the excerpt: kept, or asked to the AI and kept */
async function placesOn({ storage, ai }: PluginEnv, book: Book, excerpt: string) {
    const preloadedAt = book.cached!.at;
    const stored = await storage.get<StoredAnswers>(answersKey(book.id));
    const answers = stored?.preloadedAt === preloadedAt ? stored : { preloadedAt, byExcerpt: {} };
    const key = excerptKey(excerpt);
    if (answers.byExcerpt[key]) return answers.byExcerpt[key];

    const places = parsePlaces(await ai.complete(questionMessages(book, contentOf(book.id), excerpt), { cache: true, settings: book.ai }), book);
    await storage.set(answersKey(book.id), { ...answers, byExcerpt: { ...answers.byExcerpt, [key]: places } });
    return places;
}

/** The books on the default model (27B) first and the ones on another (35B) last */
const onDefaultModel = (book: Book) => !book.ai || book.ai.name === DEFAULT_AI_SETTINGS.name;

/** Asks about the excerpt on each preloaded book, one after another, as the AI server handles one request at a time */
export async function askBooks(env: PluginEnv, excerpt: string) {
    const matches: Match[] = [];
    const books = [...preloadedBooks()].sort((a, b) => Number(onDefaultModel(b)) - Number(onDefaultModel(a))).reverse();
    for (const book of books) {
        const places = await placesOn(env, book, excerpt);
        matches.push(...places.slice(0, MAX_MATCHES).map(place => ({ ...place, book })));
    }
    return matches;
}
