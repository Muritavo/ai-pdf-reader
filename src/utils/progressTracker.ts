/** How many words a text sequence of a page has (more than 3) */
export const SEQUENCE_LENGTH = 4;
/** How many text sequences are picked at the start and at the end of each page */
const SEQUENCES_BY_SIDE = 3;

export function tokenize(text: string) {
    return text
        .toLocaleLowerCase()
        .split(/\s+/)
        .map(word => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
        .filter(Boolean);
}

export type TrackedProgress = {
    /** From 0 to 1, how many of the pages the response already covered */
    progress: number;
    /** The 1 based page the response is currently reaching */
    page: number;
};

/** Words joined so a sequence is found only as whole words, as in ` a b c d ` */
export const asKey = (words: string[]) => ` ${words.join(' ')} `;

/** The AI response as whole words (see `asKey`), built as it arrives so it is not tokenized again on every chunk */
export function createStreamedWords() {
    let key = ' ';
    /** How much of the response was already read into `key` */
    let consumed = 0;
    return {
        read(response: string) {
            // Only whole words, as the last one may still be coming
            const completeUpTo = response.search(/\S*$/);
            if (completeUpTo > consumed) {
                const words = tokenize(response.slice(consumed, completeUpTo));
                if (words.length) key += `${words.join(' ')} `;
                consumed = completeUpTo;
            }
            return key;
        },
    };
}

/**
 * The words of each line of the page, so a text sequence is always continuous and never stitches two blocks.
 * A word broken by a hyphen at the end of a line is dropped from both lines, as the AI writes it whole.
 */
function linesOf(pageText: string) {
    const lines = pageText.split('\n');
    return lines.map((line, i) => {
        let words = tokenize(line);
        if (/-\s*$/.test(line)) words = words.slice(0, -1);
        if (i > 0 && /-\s*$/.test(lines[i - 1])) words = words.slice(1);
        return words;
    });
}

/** The first text sequence of the line, read from its start or from its end, that is found only once in the document */
function uniqueSequence(words: string[], fromEnd: boolean, documentKey: string) {
    const starts = Array.from({ length: Math.max(0, words.length - SEQUENCE_LENGTH + 1) }, (_, i) => i);
    for (const start of fromEnd ? starts.reverse() : starts) {
        const key = asKey(words.slice(start, start + SEQUENCE_LENGTH));
        if (documentKey.indexOf(key) === documentKey.lastIndexOf(key)) return key;
    }
}

/**
 * Up to `SEQUENCES_BY_SIDE` text sequences from each side of the page, one by line.
 * The ends never come from the lines of the starts, so a short page is not passed by its first lines alone
 */
function pickSequences(lines: string[][], documentKey: string) {
    const starts: string[] = [];
    let lastStartLine = -1;
    for (let i = 0; i < lines.length && starts.length < SEQUENCES_BY_SIDE; i++) {
        const key = uniqueSequence(lines[i], false, documentKey);
        if (key) {
            starts.push(key);
            lastStartLine = i;
        }
    }
    const ends: string[] = [];
    for (let i = lines.length - 1; i > lastStartLine && ends.length < SEQUENCES_BY_SIDE; i--) {
        const key = uniqueSequence(lines[i], true, documentKey);
        if (key) ends.push(key);
    }
    return { starts, ends };
}

/**
 * Follows the AI response over the pages of the PDF.
 * Each page has a few text sequences from its start and from its end, unique to the document.
 * The page being reached is the first one whose start or end is not yet on the response.
 */
export function createProgressTracker(pageTexts: string[]) {
    const pageLines = pageTexts.map(linesOf);
    const documentKey = asKey(pageLines.flat(2));
    const pages = pageLines.map(lines => pickSequences(lines, documentKey));

    const streamed = createStreamedWords();
    let responseKey = ' ';
    /** The page being reached. The response only grows, so the pages before it are never checked again */
    let scanning = 0;
    /** Whether a start of the scanning page was already found */
    let startFound = false;
    /** Up to where of `responseKey` the starts and the ends of the scanning page were already looked for */
    const searched = { starts: 0, ends: 0 };

    /** Whether one of the sequences of the side is on the response, looking only at what came after the last time. A side without sequences can't be followed and is passed */
    const isOnResponse = (side: 'starts' | 'ends') => {
        const keys = pages[scanning][side];
        const from = searched[side];
        searched[side] = responseKey.length;
        return !keys.length || keys.some(key => responseKey.indexOf(key, Math.max(0, from - key.length)) !== -1);
    };

    function current(): TrackedProgress {
        return {
            progress: pages.length ? scanning / pages.length : 0,
            page: Math.min(scanning, pages.length - 1) + 1,
        };
    }

    return {
        track(response: string): TrackedProgress {
            responseKey = streamed.read(response);
            while (scanning < pages.length) {
                startFound ||= isOnResponse('starts');
                if (!startFound) break;
                if (!isOnResponse('ends')) break;
                // The next page is looked for on the whole response
                scanning += 1;
                startFound = false;
                searched.starts = searched.ends = 0;
            }
            return current();
        },
    };
}

/**
 * The pieces of text of a page (as the divs of its text layer) that can be followed on the AI response:
 * those with more than 3 words that are found only once on the page, each with its `asKey` to look for.
 * A word broken by a hyphen between two pieces is dropped from both, as the AI writes it whole.
 */
export function uniqueExcerptsOfPage(pieces: string[]) {
    const broken = (text: string | undefined) => !!text && /-\s*$/.test(text);
    const words = pieces.map((text, i) => {
        let pieceWords = tokenize(text);
        if (broken(text)) pieceWords = pieceWords.slice(0, -1);
        if (broken(pieces[i - 1])) pieceWords = pieceWords.slice(1);
        return pieceWords;
    });
    const pageKey = asKey(words.flat());
    return words.flatMap((pieceWords, index) => {
        if (pieceWords.length < SEQUENCE_LENGTH) return [];
        const key = asKey(pieceWords);
        return pageKey.indexOf(key) === pageKey.lastIndexOf(key) ? [{ index, key }] : [];
    });
}
