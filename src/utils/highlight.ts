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

function normalizeWord(value: string) {
    return value
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

/** Every place a highlighted text is found, including the ones inside or across the others */
function collectHighlightMatches(text: string, highlightRules: HighlightRule[]) {
    const lowerText = text.toLocaleLowerCase();
    return highlightRules
        .flatMap(rule => {
            const matches: HighlightMatch[] = [];
            for (const match of lowerText.matchAll(new RegExp(escapeForRegExp(rule.normalizedWord), 'gu'))) {
                const start = match.index;
                if (start === undefined) continue;
                const end = start + rule.normalizedWord.length;
                // Only whole words are highlighted
                if (isWordCharacter(lowerText[start - 1]) || isWordCharacter(lowerText[end])) continue;
                matches.push({ color: rule.color, end, start, word: rule.normalizedWord });
            }
            return matches;
        })
        .sort((left, right) => (left.start !== right.start ? left.start - right.start : right.end - left.end));
}

/**
 * Names one occurrence of a highlighted text, so every piece of it can be found even when
 * other highlights cut it. The text is inside, as it is how the occurrence is tied to its highlight.
 */
const occurrenceToken = (word: string, scope: string, index: number) =>
    `${encodeURIComponent(word).replace(/~/g, '%7E')}~${scope}~${index}`;

export const wordOfOccurrence = (token: string) => decodeURIComponent(token.split('~')[0]);

/** The occurrences a piece of the document belongs to */
export const occurrencesOf = (mark: HTMLElement) => (mark.dataset.occurrences ?? '').split(' ').filter(Boolean);

/** A background that shows the color of every highlight over that piece, one over the other */
function backgroundOf(colors: string[]) {
    if (colors.length === 1) return colors[0];
    const band = 100 / colors.length;
    return `linear-gradient(${colors.map((color, i) => `${color} ${i * band}% ${(i + 1) * band}%`).join(', ')})`;
}

/**
 * Rewrites the content of a text layer element wrapping the highlighted pieces in <mark>.
 * Highlights that overlap are all kept: where they do, the piece belongs to every one of them.
 * `scope` tells this element apart from the others, to name the occurrences.
 */
export function appendHighlightedText(
    container: HTMLElement,
    text: string,
    highlightRules: HighlightRule[],
    markClassName: string,
    markTestId: string,
    scope: string,
) {
    const matches = collectHighlightMatches(text, highlightRules);
    container.textContent = '';

    const edges = [...new Set([0, text.length, ...matches.flatMap(match => [match.start, match.end])])].sort((a, b) => a - b);
    for (let i = 0; i < edges.length - 1; i++) {
        const [start, end] = [edges[i], edges[i + 1]];
        const covering = matches.filter(match => match.start <= start && match.end >= end);
        if (!covering.length) {
            container.append(document.createTextNode(text.slice(start, end)));
            continue;
        }
        const mark = document.createElement('mark');
        mark.className = markClassName;
        mark.dataset.testid = markTestId;
        mark.dataset.occurrences = covering.map(match => occurrenceToken(match.word, scope, matches.indexOf(match))).join(' ');
        const colors = covering.map(match => match.color);
        if (colors.length === 1) mark.style.backgroundColor = colors[0];
        else mark.style.background = backgroundOf(colors);
        mark.textContent = text.slice(start, end);
        container.append(mark);
    }
}
