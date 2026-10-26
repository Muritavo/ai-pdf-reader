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
