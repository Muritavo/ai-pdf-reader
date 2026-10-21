/** What only a formula has: a command (\mu), a superscript or subscript, braces or an equal sign */
const FORMULA_MARKERS = /[\\^_{}=]/;

/** Code is shown as it is, so nothing inside it is changed */
const CODE = /(```[\s\S]*?```|`[^`\n]*`)/;

/** A single dollar that can open or close inline math: not escaped, and not part of a $$ block */
const isSingleDollar = (text: string, index: number) =>
    text[index] === '$' && text[index - 1] !== '\\' && text[index - 1] !== '$' && text[index + 1] !== '$';

const isMoney = (inner: string) => /^\s*\d/.test(inner) && !FORMULA_MARKERS.test(inner);

/** Escapes the dollars of the money amounts of a text that has no code in it */
function protectInText(text: string) {
    let result = '';
    let index = 0;
    while (index < text.length) {
        if (!isSingleDollar(text, index)) {
            result += text[index++];
            continue;
        }
        let closing = index + 1;
        while (closing < text.length && text[closing] !== '\n' && !isSingleDollar(text, closing)) closing++;
        if (closing >= text.length || text[closing] === '\n') {
            // Nothing closes it on the line, so it is not math anyway
            result += text[index++];
            continue;
        }
        const inner = text.slice(index + 1, closing);
        if (isMoney(inner)) {
            // Only this dollar is money: the next one may still open a formula, so it is looked at again
            result += `\\$${inner}`;
            index = closing;
        } else {
            result += text.slice(index, closing + 1);
            index = closing + 1;
        }
    }
    return result;
}

/**
 * Keeps money amounts as text, as single dollars also mark inline math:
 * "custa $5 e $10" is not the formula "5 e ". A text between dollars counts as money when it
 * starts with a number and has nothing only a formula has, so "$24.9\,\mu g/m^3$" is still math.
 */
export function protectMoneyAmounts(markdown: string) {
    return markdown
        .split(CODE)
        .map((part, index) => (index % 2 === 1 ? part : protectInText(part)))
        .join('');
}
