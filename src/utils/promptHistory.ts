import { scoped } from './projects';
import { wordingOf } from './wording';

export type PromptScope = 'local' | 'global';

/** The answer a question got about one document */
export type DocumentAnswer = {
    answer: string;
    timestamp: string;
    documentName?: string;
};

export type PromptHistoryEntry = {
    prompt: string;
    timestamp: string;
    /**
     * The answers by document. A local question has the one of its document, while a global one
     * gathers an answer for each document it was answered about
     */
    answers: Record<string, DocumentAnswer>;
};

/** How the entries were kept before the answers by document */
type StoredBefore = { prompt: string; answer?: string; timestamp: string; documentHash?: string; documentName?: string };

/**
 * Where an answer kept before the answers by document goes, when the document it is about was not kept with it.
 * It is not lost, and it is never shown as the answer about any document
 */
const UNKNOWN_DOCUMENT = '?';

/** The questions of a single document */
const localKeyOf = (hash: string) => `prompt-history-${hash}`;
/** The questions that are offered on every document */
const GLOBAL_KEY = 'prompt-history-global';

const keyOf = (scope: PromptScope, hash: string) => scoped(scope === 'local' ? localKeyOf(hash) : GLOBAL_KEY);

export function loadPrompts(scope: PromptScope, hash: string): PromptHistoryEntry[] {
    const stored = localStorage.getItem(keyOf(scope, hash));
    if (!stored) return [];
    return (JSON.parse(stored) as Array<PromptHistoryEntry | StoredBefore>).map(entry =>
        'answers' in entry
            ? entry
            : {
                  prompt: entry.prompt,
                  timestamp: entry.timestamp,
                  answers:
                      entry.answer === undefined
                          ? {}
                          : {
                                // A local question is about its own document, while a global one could be about any
                                [entry.documentHash ?? (scope === 'local' ? hash : UNKNOWN_DOCUMENT)]: {
                                    answer: entry.answer,
                                    timestamp: entry.timestamp,
                                    documentName: entry.documentName,
                                },
                            },
              },
    );
}

export function savePrompts(scope: PromptScope, hash: string, entries: PromptHistoryEntry[]) {
    if (entries.length) localStorage.setItem(keyOf(scope, hash), JSON.stringify(entries));
    else localStorage.removeItem(keyOf(scope, hash));
}

export const answerFor = (entry: PromptHistoryEntry, hash: string) => entry.answers[hash]?.answer;

/** Puts an entry first, replacing the ones with the same wording, as they are the same question */
export const withEntryFirst = (entries: PromptHistoryEntry[], entry: PromptHistoryEntry) => [
    entry,
    ...entries.filter(other => wordingOf(other.prompt) !== wordingOf(entry.prompt)),
];

/** Tells the entries apart, so the list can animate the ones that come and go */
export const entryKeyOf = (entry: PromptHistoryEntry) => `${entry.timestamp}-${wordingOf(entry.prompt)}`;
