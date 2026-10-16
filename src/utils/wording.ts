/**
 * The wording of a text, ignoring what does not change what is being said:
 * the case, accents, punctuation and spacing. Questions with the same wording are the same question.
 */
export function wordingOf(text: string) {
    return text
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLocaleLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}
