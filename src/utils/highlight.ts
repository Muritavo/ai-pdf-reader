import chroma from 'chroma-js';
import seedrandom from 'seedrandom';
import { useEffect, useState } from 'react';

const HIGHLIGHT_STORAGE_KEY = 'pdf-ai-reader/highlights';

export type HighlightRule = {
    color: string;
    normalizedWord: string;
    word: string;
};

type HighlightMatch = { color: string; end: number; start: number };

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

function collectHighlightMatches(text: string, highlightRules: HighlightRule[]) {
    const lowerText = text.toLocaleLowerCase();
    const rawMatches = highlightRules.flatMap(rule => {
        const matches: HighlightMatch[] = [];
        for (const match of lowerText.matchAll(new RegExp(escapeForRegExp(rule.normalizedWord), 'gu'))) {
            const start = match.index;
            if (start === undefined) continue;
            const end = start + rule.normalizedWord.length;
            // Only whole words are highlighted
            if (isWordCharacter(lowerText[start - 1]) || isWordCharacter(lowerText[end])) continue;
            matches.push({ color: rule.color, end, start });
        }
        return matches;
    });

    return rawMatches
        .sort((left, right) => (left.start !== right.start ? left.start - right.start : right.end - left.end))
        .reduce<HighlightMatch[]>((matches, match) => {
            const previous = matches[matches.length - 1];
            return previous && match.start < previous.end ? matches : [...matches, match];
        }, []);
}

/** Rewrites the content of a text layer element wrapping the matches in <mark> */
export function appendHighlightedText(
    container: HTMLElement,
    text: string,
    highlightRules: HighlightRule[],
    markClassName: string,
    markTestId: string,
) {
    const matches = collectHighlightMatches(text, highlightRules);
    container.textContent = '';

    let currentIndex = 0;
    for (const match of matches) {
        if (match.start > currentIndex) container.append(document.createTextNode(text.slice(currentIndex, match.start)));
        const mark = document.createElement('mark');
        mark.className = markClassName;
        mark.dataset.testid = markTestId;
        mark.style.backgroundColor = match.color;
        mark.textContent = text.slice(match.start, match.end);
        container.append(mark);
        currentIndex = match.end;
    }
    if (currentIndex < text.length) container.append(document.createTextNode(text.slice(currentIndex)));
}
