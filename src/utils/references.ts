/**
 * The references of an answer of the AI, one for each line, as plain text:
 * without the markers of the list or the formatting of markdown, so they can be searched as they are.
 */
export function referencesOf(answer: string) {
    return answer
        .split('\n')
        .map(line =>
            line
                .trim()
                .replace(/^([-*+]|\d+[.)])\s+/, '')
                .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
                .replace(/(\*\*|__|\*|_|`)/g, '')
                .trim(),
        )
        .filter(Boolean);
}

export const googleSearchUrl = (text: string) => `https://www.google.com/search?q=${encodeURIComponent(text)}`;
