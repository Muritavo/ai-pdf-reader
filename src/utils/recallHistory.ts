import { scoped } from './projects';

/** An article asked on a recall, with what identifies it kept, as the article may be removed later */
export type RecallDocument = {
    articleKey: string;
    title: string;
    year: string;
    state: 'done' | 'error';
};

/** A recall that was made to the end, as it is shown again on the history */
export type RecallEntry = {
    question: string;
    timestamp: string;
    synthesis: string;
    documents: RecallDocument[];
    /** How many articles with a PDF were left out, as not prepared for the AI */
    skipped: number;
};

const KEY = 'recall-history';

/** The recalls of the open project, the latest first */
export function loadRecalls(): RecallEntry[] {
    const stored = localStorage.getItem(scoped(KEY));
    return stored ? (JSON.parse(stored) as RecallEntry[]) : [];
}

/** Keeps a recall first on the history of the open project, and returns the history */
export function addRecall(entry: RecallEntry): RecallEntry[] {
    const entries = [entry, ...loadRecalls()];
    localStorage.setItem(scoped(KEY), JSON.stringify(entries));
    return entries;
}
