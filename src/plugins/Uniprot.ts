import { get, set } from 'idb-keyval';
import type { Plugin } from './types';

const API = 'https://rest.uniprot.org/uniprotkb';

/** The reviewed (Swiss-Prot) human proteins: about 20 thousand, 2.6 MB */
const LIST_URL = `${API}/stream?query=organism_id:9606+AND+reviewed:true&fields=accession,gene_names,protein_name&format=tsv`;

/** Outside of the projects, as the list is the same for all of them */
const LIST_KEY = 'plugins/uniprot/human';

/** UniProt is released every 8 weeks */
const LIST_MAX_AGE = 90 * 24 * 60 * 60 * 1000;

type StoredList = { downloadedAt: number; tsv: string };

/** Every gene name, synonym and protein name, to the accession of its protein */
let index = new Map<string, string>();

/** UniProt spells the Greek letters, as "Interferon gamma", that the articles write as "IFN-γ" */
const GREEK: Record<string, string> = {
    α: 'alpha',
    β: 'beta',
    γ: 'gamma',
    δ: 'delta',
    ε: 'epsilon',
    ζ: 'zeta',
    η: 'eta',
    θ: 'theta',
    ι: 'iota',
    κ: 'kappa',
    λ: 'lambda',
    μ: 'mu',
    ν: 'nu',
    ξ: 'xi',
    ο: 'omicron',
    π: 'pi',
    ρ: 'rho',
    σ: 'sigma',
    ς: 'sigma',
    τ: 'tau',
    υ: 'upsilon',
    φ: 'phi',
    χ: 'chi',
    ψ: 'psi',
    ω: 'omega',
    // The micro sign, typed for μ
    µ: 'mu',
};

/**
 * Without what changes from one article to another: case, accents, Greek letters and the separators,
 * so "IFN-γ", "IFNγ", "IFN gamma" and "IFN-gamma" are the same name
 */
const normalize = (text: string) =>
    text
        .toLowerCase()
        .replace(/[α-ωµ]/g, letter => GREEK[letter] ?? letter)
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .replace(/[^\p{L}\p{N}]/gu, '');

/** The recommended name and the alternative ones, as in "Apolipoprotein E (Apo-E)", without the EC numbers */
function proteinNames(text: string) {
    const names = [''];
    let depth = 0;
    for (const char of text) {
        if (char === '(' && depth++ === 0) names.push('');
        else if (char === ')' && --depth === 0) names.push('');
        else names[names.length - 1] += char;
    }
    return names.map(name => name.trim()).filter(name => name.length > 1 && !name.startsWith('EC '));
}

/**
 * The names of the protein itself, and of the chains cleaved from it or the parts included on it, as in
 * "Transforming growth factor beta-1 proprotein [Cleaved into: Latency-associated peptide (LAP); Transforming growth factor beta-1 (TGF-beta-1)]".
 * Those chains are often what the articles measure, so they lead to the entry of the protein they come from.
 */
function namesOfField(field: string) {
    const [own, ...parts] = field.split(' [');
    const chains = parts.flatMap(part =>
        part
            .replace(/^(Cleaved into|Includes):\s*/, '')
            .replace(/\]$/, '')
            .split('; '),
    );
    return { own: proteinNames(own), chains: chains.flatMap(proteinNames) };
}

function buildIndex(tsv: string) {
    const rows = tsv
        .split('\n')
        .slice(1)
        .map(line => line.split('\t'))
        .filter(([accession]) => accession);
    const symbols = rows.map(([accession, genes = '']) => [accession, genes.split(' ').filter(Boolean)] as const);
    const names = rows.map(([accession, , proteins = '']) => [accession, namesOfField(proteins)] as const);
    // A name on more than one protein is kept by the strongest use of it: the primary symbol of a gene,
    // then its synonyms, then the names of the proteins, then the ones of their chains
    const byPriority: [string, string[]][] = [
        ...symbols.map(([accession, genes]) => [accession, genes.slice(0, 1)] as [string, string[]]),
        ...symbols.map(([accession, genes]) => [accession, genes.slice(1)] as [string, string[]]),
        ...names.map(([accession, { own }]) => [accession, own] as [string, string[]]),
        ...names.map(([accession, { chains }]) => [accession, chains] as [string, string[]]),
    ];
    const built = new Map<string, string>();
    for (const [accession, names] of byPriority) {
        for (const name of names) {
            const key = normalize(name);
            if (key && !built.has(key)) built.set(key, accession);
        }
    }
    return built;
}

async function download() {
    const response = await fetch(LIST_URL);
    if (!response.ok) throw new Error(`UniProt answered ${response.status}`);
    const list: StoredList = { downloadedAt: Date.now(), tsv: await response.text() };
    await set(LIST_KEY, list);
    return list;
}

type Entry = {
    primaryAccession: string;
    annotationScore?: number;
    proteinDescription?: { recommendedName?: { fullName?: { value: string } } };
    genes?: { geneName?: { value: string } }[];
    comments?: { commentType: string; texts?: { value: string }[] }[];
};

/** The first sentences, without the references to the articles, as "(PubMed:12345)" */
function shortFunction(text: string) {
    const clean = text.replace(/\s*\((?:PubMed|By similarity)[^)]*\)/g, '').trim();
    if (clean.length <= 500) return clean;
    const cut = clean.slice(0, 500);
    const sentences = cut.slice(0, cut.lastIndexOf('. ') + 1);
    // Ending on a sentence, it reads as complete, so it is only marked as cut in the middle of one
    return sentences || `${cut}…`;
}

const UniprotPlugin: Plugin = {
    id: 'uniprot',
    async setup() {
        let list = (await get(LIST_KEY)) as StoredList | undefined;
        if (!list) list = await download();
        // An old list is used while the new one is downloaded, for the next time
        else if (Date.now() - list.downloadedAt > LIST_MAX_AGE) download().catch(e => console.error('Failed to update the UniProt list', e));
        index = buildIndex(list.tsv);
    },
    menuOptions: [
        {
            id: 'uniprot-info',
            label: 'Informações no UniProt',
            testId: 'menu-plugin-uniprot',
            matches: selection => index.has(normalize(selection)),
            async onClick({ selection, showResult }) {
                const accession = index.get(normalize(selection))!;
                const response = await fetch(
                    `${API}/${accession}?fields=accession,protein_name,gene_primary,cc_function,annotation_score&format=json`,
                );
                if (!response.ok) throw new Error(`UniProt answered ${response.status}`);
                const entry = (await response.json()) as Entry;

                const name = entry.proteinDescription?.recommendedName?.fullName?.value ?? '—';
                const symbol = entry.genes?.[0]?.geneName?.value ?? '—';
                const fn = entry.comments?.find(comment => comment.commentType === 'FUNCTION')?.texts?.[0]?.value;
                showResult({
                    title: 'UniProt',
                    prompt: selection,
                    promptLabel: 'Seleção',
                    answerLabel: 'Proteína',
                    answer: [
                        `**Nome:** ${name}`,
                        `**Símbolo:** ${symbol}`,
                        // From 1 to 5, how much of the protein is known (and annotated) on UniProt
                        `**Escore de anotação:** ${entry.annotationScore ?? '—'}/5`,
                        `**Função:** ${fn ? shortFunction(fn) : 'Sem função descrita.'}`,
                        `[Ver ${entry.primaryAccession} no UniProt](https://www.uniprot.org/uniprotkb/${entry.primaryAccession}/entry)`,
                    ].join('\n\n'),
                });
            },
        },
    ],
};

export default UniprotPlugin;
