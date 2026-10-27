import type { Article } from '../models/Article';

export type CitationFields = Pick<Article, 'title' | 'authors' | 'year' | 'journal' | 'doi'>;

/**
 * The citation as PubMed gives it on "Cite > NLM", as
 * `Smith J, Doe AB. Title of the article. J Proteome Res. 2020 Mar 6;19(3):1234-45. doi: 10.1021/xyz. PMID: 123.`
 * The journal abbreviation never has periods, so the title is what is left between the authors and it
 */
const NLM = /^(?<authors>[^.]+?)\.\s+(?<title>.+?[.?!])\s+(?<journal>[^.]+?)\.\s+(?<year>\d{4})\b[^.]*\./s;
const DOI = /doi:\s*(10\.\S+?)\.?(?=\s|$)/i;
/** `Smith J`, `de Souza AB`, or the `et al` that closes a long list */
const AUTHOR = /^(?<surname>\p{L}[\p{L}'’ -]*?)\s+(?<initials>\p{Lu}{1,4})$/u;
const ET_AL = /^et al$/i;

/** The fields of a reference in the NLM style, or undefined when the text is something else */
export function parseNlmCitation(text: string): CitationFields | undefined {
    const match = NLM.exec(text.trim().replace(/\s+/g, ' '));
    if (!match?.groups) return undefined;
    const names = match.groups.authors.split(/,\s*/);
    const authors = names.filter(name => !ET_AL.test(name)).map(name => AUTHOR.exec(name.trim())?.groups);
    // Most text has a sentence or two before a year, so it is only a citation when every author reads as one
    if (authors.length === 0 || authors.some(author => !author)) return undefined;

    return {
        // As the app keeps them from the CSV exports: `Smith, J and Doe, AB`
        authors: [
            ...authors.map(author => `${author!.surname}, ${author!.initials}`),
            ...(names.some(name => ET_AL.test(name)) ? ['others'] : []),
        ].join(' and '),
        title: match.groups.title.replace(/\.$/, ''),
        journal: match.groups.journal,
        year: match.groups.year,
        doi: DOI.exec(text)?.[1] ?? '',
    };
}

/** `Sultan`, `de Souza`, with the `S.M.E.` or `J.-P.` initials of the Springer Nature style */
const SN_SURNAME = String.raw`\p{L}[\p{L}'’ -]*?`;
const SN_INITIALS = String.raw`\p{Lu}\.(?:-?\p{Lu}\.)*`;
const SN_AUTHORS = String.raw`${SN_SURNAME}, ${SN_INITIALS}(?:(?:, | & )${SN_SURNAME}, ${SN_INITIALS})*(?: et al\.)?`;
/**
 * The citation as the "Cite this article" of BMC, Nature and Springer gives it, as
 * `Sultan, S.M.E., Yousef, A.F. et al. Title of the article. BMC Plant Biol 24, 420 (2024). https://doi.org/10.1186/xyz`
 * As on NLM, the journal abbreviation never has periods
 */
const SPRINGER = new RegExp(
    String.raw`^(?<authors>${SN_AUTHORS}) (?<title>.+?[.?!]) (?<journal>[^.\d]+?) \d+, [\w–-]+ \((?<year>\d{4})\)(?=[.\s]|$)`,
    'u',
);
const SN_AUTHOR_EACH = new RegExp(String.raw`(?<surname>${SN_SURNAME}), (?<initials>${SN_INITIALS})`, 'gu');
const DOI_URL = /doi\.org\/(10\.\S+?)\.?(?=\s|$)/i;

/** The fields of a reference in the Springer Nature style, or undefined when the text is something else */
export function parseSpringerCitation(text: string): CitationFields | undefined {
    const match = SPRINGER.exec(text.trim().replace(/\s+/g, ' '));
    if (!match?.groups) return undefined;
    const authors = [...match.groups.authors.matchAll(SN_AUTHOR_EACH)].map(({ groups }) => `${groups!.surname}, ${groups!.initials.replace(/\./g, '')}`);

    return {
        // Only the first three authors are given before the `et al.`
        authors: [...authors, ...(match.groups.authors.endsWith('et al.') ? ['others'] : [])].join(' and '),
        title: match.groups.title.replace(/\.$/, ''),
        journal: match.groups.journal,
        year: match.groups.year,
        doi: DOI_URL.exec(text)?.[1] ?? DOI.exec(text)?.[1] ?? '',
    };
}

const MDPI_AUTHORS = String.raw`${SN_SURNAME}, ${SN_INITIALS}(?:(?:; |;? and )${SN_SURNAME}, ${SN_INITIALS})*(?: et al\.)?`;
/**
 * The citation as MDPI (and ACS) gives it, as
 * `Yan, D.; Lin, L.; Keidar, M. Title of the article. Plasma 2022, 5, 98-110. https://doi.org/10.3390/xyz`
 * Unlike the others, the journal may be abbreviated with periods (`Int. J. Mol. Sci.`), but only by single words before the year
 */
const MDPI = new RegExp(
    String.raw`^(?<authors>${MDPI_AUTHORS}) (?<title>.+?[.?!]) (?<journal>(?:[\p{L}&-]+\.? )+?)(?<year>\d{4}), \d+`,
    'u',
);

/** The fields of a reference in the MDPI or ACS style, or undefined when the text is something else */
export function parseMdpiCitation(text: string): CitationFields | undefined {
    const match = MDPI.exec(text.trim().replace(/\s+/g, ' '));
    if (!match?.groups) return undefined;
    const authors = [...match.groups.authors.matchAll(SN_AUTHOR_EACH)].map(({ groups }) => `${groups!.surname}, ${groups!.initials.replace(/\./g, '')}`);

    return {
        authors: [...authors, ...(match.groups.authors.endsWith('et al.') ? ['others'] : [])].join(' and '),
        title: match.groups.title.replace(/\.$/, ''),
        journal: match.groups.journal.trim(),
        year: match.groups.year,
        doi: DOI_URL.exec(text)?.[1] ?? DOI.exec(text)?.[1] ?? '',
    };
}

/** A citation copied from PubMed (NLM), or from a Springer Nature, MDPI or ACS article page */
export const parseCitation = (text: string) => parseNlmCitation(text) ?? parseSpringerCitation(text) ?? parseMdpiCitation(text);
