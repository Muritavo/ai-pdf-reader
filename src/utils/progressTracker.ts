/** How many of the last words of the response are matched against the extracted text */
const SEQUENCE_LENGTH = 5;
/** How far ahead of the current position the sequence is searched, to avoid jumping on a distant coincidence */
const LOOKAHEAD_WINDOW = 1500;
/** Enough characters to hold the sequence, so the whole response is not tokenized on every chunk */
const TAIL_CHARACTERS = 300;

export function tokenize(text: string) {
    return text
        .toLocaleLowerCase()
        .split(/\s+/)
        .map(word => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
        .filter(Boolean);
}

export type TrackedProgress = {
    /** From 0 to 1, how much of the extracted text the response already covered */
    progress: number;
    /** The 1 based page the response is currently reaching */
    page: number;
};

/**
 * Follows the AI response over the raw text extracted from the PDF.
 * The last words of the response are searched ahead of the current position, so a miss never moves it and it never goes back.
 */
export function createProgressTracker(pageTexts: string[]) {
    const pageWords = pageTexts.map(tokenize);
    const rawWords = pageWords.flat();
    const pageEnds = pageWords.reduce<number[]>((ends, words) => [...ends, (ends[ends.length - 1] ?? 0) + words.length], []);
    let position = 0;
    let lastSequence = '';

    function current(): TrackedProgress {
        const page = pageEnds.findIndex(end => position < end);
        return {
            progress: rawWords.length ? position / rawWords.length : 0,
            page: (page === -1 ? pageEnds.length - 1 : page) + 1,
        };
    }

    return {
        track(response: string): TrackedProgress {
            const completeWords = /\s$/.test(response) ? response : response.replace(/\S*$/, '');
            const tail = completeWords.slice(-TAIL_CHARACTERS);
            const words = tokenize(tail);
            // When the tail starts in the middle of a word, the first token can't be trusted
            const trustedWords = tail.length < completeWords.length ? words.slice(1) : words;
            if (trustedWords.length < SEQUENCE_LENGTH) return current();

            const sequence = trustedWords.slice(-SEQUENCE_LENGTH);
            const sequenceKey = sequence.join(' ');
            if (sequenceKey === lastSequence) return current();
            lastSequence = sequenceKey;

            const lastStart = Math.min(rawWords.length - SEQUENCE_LENGTH, position + LOOKAHEAD_WINDOW);
            for (let start = position; start <= lastStart; start++) {
                if (sequence.every((word, offset) => rawWords[start + offset] === word)) {
                    position = start + SEQUENCE_LENGTH;
                    break;
                }
            }
            return current();
        },
    };
}
