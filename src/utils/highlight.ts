import chroma from 'chroma-js';
import seedrandom from 'seedrandom';
import { useEffect, useState } from 'react';

const HIGHLIGHT_STORAGE_KEY = 'pdf-ai-reader/highlights';

export type HighlightRule = {
    color: string;
    normalizedWord: string;
    word: string;
};

type HighlightMatch = { color: string; end: number; start: number; word: string };

/**
 * The form a text is compared in: lowercase, with any spacing (as line breaks) as a single space,
 * and the words cut by a hyphen at the end of a line joined back, as "bro- ken" is "broken".
 */
function normalizeWord(value: string) {
    return value
        .replace(/\s+/g, ' ')
        .replace(/(\p{L})- (\p{L})/gu, '$1$2')
        .trim()
        .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
        .toLocaleLowerCase();
}

function createHighlightColor(normalizedWord: string) {
    const random = seedrandom(normalizedWord, { entropy: true });
    return chroma
        .rgb(Math.round(random() * 255), Math.round(random() * 255), Math.round(random() * 255))
        .alpha(0.55)
        .css();
}

export function useHighlightsForPDF(hash?: string) {
    const key = `${HIGHLIGHT_STORAGE_KEY}/${hash ?? ''}`;
    const [highlightRules, setHighlightRules] = useState<HighlightRule[]>();

    useEffect(() => {
        const storedRules = window.localStorage.getItem(key);
        setHighlightRules(storedRules ? (JSON.parse(storedRules) as HighlightRule[]) : []);
    }, [hash]);

    useEffect(() => {
        if (highlightRules) window.localStorage.setItem(key, JSON.stringify(highlightRules));
    }, [highlightRules]);

    return {
        highlightRules,
        removeHighlight(normalizedWord: string) {
            setHighlightRules(currentRules => currentRules?.filter(rule => rule.normalizedWord !== normalizedWord));
        },
        addHighlight(word: string) {
            const normalizedWord = normalizeWord(word);
            setHighlightRules(currentRules => {
                const rules = currentRules ?? [];
                if (rules.some(rule => rule.normalizedWord === normalizedWord)) return currentRules;
                return [...rules, { color: createHighlightColor(normalizedWord), normalizedWord, word }];
            });
        },
    };
}

const escapeForRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isWordCharacter = (character: string | undefined) => (character ? /[\p{L}\p{N}]/u.test(character) : false);

/** A line of the text layer of a page: the element that shows it, and its text */
export type TextPiece = { element: HTMLElement; text: string };

/** Where a character of the page text came from. Undefined for the space put between lines */
type Source = { piece: number; offset: number } | undefined;

/**
 * The text of a whole page, so a highlighted text can be found even when it goes on to the next line.
 * The lines are joined by a space, except for a word cut by a hyphen, which is joined back without it.
 */
function pageTextOf(pieces: TextPiece[]) {
    let text = '';
    const sources: Source[] = [];
    const push = (character: string, source: Source) => {
        if (/\s/.test(character)) {
            // Any spacing is a single space, as it is how the highlighted texts are compared
            if (text === '' || text.endsWith(' ')) return;
            text += ' ';
            sources.push(source);
            return;
        }
        for (const unit of character.toLocaleLowerCase()) {
            text += unit;
            sources.push(source);
        }
    };

    pieces.forEach((piece, index) => {
        const next = pieces[index + 1];
        const cutByHyphen = next !== undefined && /\p{L}-\s*$/u.test(piece.text) && /^\s*\p{L}/u.test(next.text);
        const lastCharacter = cutByHyphen ? piece.text.lastIndexOf('-') : piece.text.length;
        const skipsLeadingSpace = index > 0 && /\p{L}-\s*$/u.test(pieces[index - 1].text) && /^\s*\p{L}/u.test(piece.text);
        for (let offset = 0; offset < lastCharacter; offset++) {
            if (skipsLeadingSpace && offset < piece.text.length - piece.text.trimStart().length) continue;
            push(piece.text[offset], { piece: index, offset });
        }
        if (!cutByHyphen) push(' ', undefined);
    });
    return { text, sources };
}

/** Every place a highlighted text is found on the page, including the ones inside or across the others */
function collectHighlightMatches(pageText: string, highlightRules: HighlightRule[]) {
    return highlightRules
        .flatMap(rule => {
            const comparedAs = normalizeWord(rule.normalizedWord);
            if (!comparedAs) return [];
            const matches: HighlightMatch[] = [];
            for (const match of pageText.matchAll(new RegExp(escapeForRegExp(comparedAs), 'gu'))) {
                const start = match.index;
                if (start === undefined) continue;
                const end = start + comparedAs.length;
                // Only whole words are highlighted
                if (isWordCharacter(pageText[start - 1]) || isWordCharacter(pageText[end])) continue;
                matches.push({ color: rule.color, end, start, word: rule.normalizedWord });
            }
            return matches;
        })
        .sort((left, right) => (left.start !== right.start ? left.start - right.start : right.end - left.end));
}

/**
 * Names one occurrence of a highlighted text, so every piece of it can be found even when
 * other highlights, or the end of the line, cut it. The text is inside, as it is how the occurrence is tied to its highlight.
 */
const occurrenceToken = (word: string, scope: string, index: number) =>
    `${encodeURIComponent(word).replace(/~/g, '%7E')}~${scope}~${index}`;

export const wordOfOccurrence = (token: string) => decodeURIComponent(token.split('~')[0]);

/** The occurrences a piece of the document belongs to */
export const occurrencesOf = (mark: HTMLElement) => (mark.dataset.occurrences ?? '').split(' ').filter(Boolean);

/** A background that shows the color of every highlight over that piece, one over the other */
function backgroundOf(colors: string[]) {
    const band = 100 / colors.length;
    return `linear-gradient(${colors.map((color, i) => `${color} ${i * band}% ${(i + 1) * band}%`).join(', ')})`;
}

type PieceRange = { start: number; end: number; color: string; token: string };

/**
 * Rewrites the lines of the text layer of a page, wrapping the highlighted pieces in <mark>.
 * A text is found across lines, and highlights that overlap are all kept: where they do, the piece belongs to every one of them.
 * `scope` tells this page apart from the others, to name the occurrences.
 */
export function highlightTextLayer(
    pieces: TextPiece[],
    highlightRules: HighlightRule[],
    markClassName: string,
    markTestId: string,
    scope: string,
) {
    const { text: pageText, sources } = pageTextOf(pieces);
    const ranges: PieceRange[][] = pieces.map(() => []);

    collectHighlightMatches(pageText, highlightRules).forEach((match, index) => {
        const token = occurrenceToken(match.word, scope, index);
        const touched = new Map<number, { first: number; last: number }>();
        for (let i = match.start; i < match.end; i++) {
            const source = sources[i];
            if (!source) continue;
            const found = touched.get(source.piece);
            if (found) found.last = source.offset;
            else touched.set(source.piece, { first: source.offset, last: source.offset });
        }
        const touchedPieces = [...touched.keys()].sort((a, b) => a - b);
        touchedPieces.forEach((piece, i) => {
            const { first, last } = touched.get(piece)!;
            // When it goes on to the next line, the rest of this one (like the hyphen) is part of it too
            ranges[piece].push({
                start: i === 0 ? first : 0,
                end: i === touchedPieces.length - 1 ? last + 1 : pieces[piece].text.length,
                color: match.color,
                token,
            });
        });
    });

    pieces.forEach(({ element, text }, index) => {
        const pieceRanges = ranges[index];
        element.textContent = '';
        const edges = [...new Set([0, text.length, ...pieceRanges.flatMap(range => [range.start, range.end])])].sort((a, b) => a - b);
        for (let i = 0; i < edges.length - 1; i++) {
            const [start, end] = [edges[i], edges[i + 1]];
            const covering = pieceRanges.filter(range => range.start <= start && range.end >= end);
            if (!covering.length) {
                element.append(document.createTextNode(text.slice(start, end)));
                continue;
            }
            const mark = document.createElement('mark');
            mark.className = markClassName;
            mark.dataset.testid = markTestId;
            mark.dataset.occurrences = covering.map(range => range.token).join(' ');
            const colors = covering.map(range => range.color);
            if (colors.length === 1) mark.style.backgroundColor = colors[0];
            else mark.style.background = backgroundOf(colors);
            mark.textContent = text.slice(start, end);
            element.append(mark);
        }
    });
}
