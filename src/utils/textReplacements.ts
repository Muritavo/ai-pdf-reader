/** A text of the document that is shown as another one, for the PDFs whose text is not what is drawn (as a β read as an "A") */
export type TextReplacement = { from: string; to: string };

const escapeForRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Matches `from` along the pieces of a page, letting any spacing (as a line break) be any spacing between them */
const patternOf = (from: string) =>
    new RegExp(
        from
            .trim()
            .split(/\s+/)
            .map(escapeForRegExp)
            .join('\\s*'),
        'gu',
    );

/**
 * The texts of the pieces of a page, with every replacement made. A text can be found across pieces,
 * and only what changes is rewritten, so the rest of each piece stays where it is drawn
 */
export function replaceInPieces(texts: string[], replacements: TextReplacement[]) {
    let result = [...texts];
    for (const { from, to } of replacements) {
        if (!from.trim()) continue;
        const pageText = result.join('');
        // The piece and the place in it of each character of the page
        const sources = result.flatMap((text, piece) => [...text].map((_, offset) => ({ piece, offset })));
        const edits: Array<{ start: number; end: number; text: string }> = [];
        for (const match of pageText.matchAll(patternOf(from))) {
            const found = match[0];
            const start = match.index!;
            // Only the part that differs, as "A-oxidation" into "β-oxidation" changes the "A" alone
            let prefix = 0;
            while (prefix < found.length && prefix < to.length && found[prefix] === to[prefix]) prefix++;
            let suffix = 0;
            while (
                suffix < found.length - prefix &&
                suffix < to.length - prefix &&
                found[found.length - 1 - suffix] === to[to.length - 1 - suffix]
            )
                suffix++;
            if (prefix === found.length && prefix === to.length) continue;
            edits.push({ start: start + prefix, end: start + found.length - suffix, text: to.slice(prefix, to.length - suffix) });
        }
        if (!edits.length) continue;
        const next = result.map(text => [...text]);
        // From the last one, so the places of the others are kept
        for (const { start, end, text } of edits.reverse()) {
            // Written in the piece of the first changed character, or after the one before it when nothing is removed
            const anchor = start < end ? sources[start] : sources[start - 1] ?? sources[start];
            if (!anchor) continue;
            for (let i = end - 1; i >= start; i--) next[sources[i].piece][sources[i].offset] = '';
            const characters = next[anchor.piece];
            if (start < end) characters[anchor.offset] = text;
            else if (sources[start - 1]) characters[anchor.offset] += text;
            else characters[anchor.offset] = text + characters[anchor.offset];
        }
        result = next.map(characters => characters.join(''));
    }
    return result;
}
