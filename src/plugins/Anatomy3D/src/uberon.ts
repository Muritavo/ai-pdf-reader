import type { PluginStorage } from '../../types';

/** The release of Uberon kept on its repository: 22 MB, 3.7 MB as transferred */
const OBO_URL = 'https://raw.githubusercontent.com/obophenotype/uberon/master/uberon.obo';

const UBERON_KEY = 'uberon';

/** Uberon is released about every two months */
const UBERON_MAX_AGE = 90 * 24 * 60 * 60 * 1000;

export type Term = {
    /** As "UBERON:0003881" */
    id: string;
    name: string;
    definition?: string;
    /** The ones that mean exactly the same as the name, as "CA1" */
    exactSynonyms: string[];
    /** Broader, narrower or only related, as "regio superior" */
    otherSynonyms: string[];
    /** What it is part of, as "Ammon's horn" for CA1. Not what it is a kind of, that leads to the general classes of Uberon */
    parents: string[];
    /** The structure on the atlases of the Allen Institute for the human brain, as "10297". Only these are offered for a selection */
    dhba?: string;
};

type StoredUberon = { downloadedAt: number; version: string; terms: Term[] };

/** The relations of being part of something, by how strongly they say it */
const PART_OF = ['part_of', 'contributes_to_morphology_of', 'located_in'];

const unquote = (value: string) => value.match(/^"((?:[^"\\]|\\.)*)"/)?.[1].replace(/\\(.)/g, '$1');

function parseObo(obo: string) {
    const terms: Term[] = [];
    for (const block of obo.split('\n\n')) {
        if (!block.startsWith('[Term]')) continue;
        const term: Term = { id: '', name: '', exactSynonyms: [], otherSynonyms: [], parents: [] };
        let obsolete = false;
        for (const line of block.split('\n')) {
            const colon = line.indexOf(': ');
            if (colon < 0) continue;
            const tag = line.slice(0, colon);
            const value = line.slice(colon + 2);
            if (tag === 'id') term.id = value;
            else if (tag === 'name') term.name = value;
            else if (tag === 'def') term.definition = unquote(value);
            else if (tag === 'is_obsolete') obsolete = value === 'true';
            else if (tag === 'synonym') {
                const synonym = unquote(value);
                if (!synonym) continue;
                // `"CA1" EXACT []`
                if (value.slice(synonym.length + 3).startsWith('EXACT')) term.exactSynonyms.push(synonym);
                else term.otherSynonyms.push(synonym);
            } else if (tag === 'relationship') {
                const [type, target] = value.split(' ');
                if (PART_OF.includes(type) && target.startsWith('UBERON:') && !term.parents.includes(target)) term.parents.push(target);
            } else if (tag === 'xref') {
                const dhba = value.match(/^DHBA:(\d+)/)?.[1];
                if (dhba) term.dhba = dhba;
            }
        }
        if (!term.id.startsWith('UBERON:') || obsolete) continue;
        terms.push(term);
    }
    return terms;
}

async function download(storage: PluginStorage) {
    const response = await fetch(OBO_URL);
    if (!response.ok) throw new Error(`Uberon answered ${response.status}`);
    const obo = await response.text();
    const uberon: StoredUberon = {
        downloadedAt: Date.now(),
        version: obo.match(/^data-version: (.*)$/m)?.[1] ?? '',
        terms: parseObo(obo),
    };
    await storage.set(UBERON_KEY, uberon);
    return uberon;
}

let terms = new Map<string, Term>();
/** The parts of each term, the ones that have it as the parent shown on the hierarchy */
let children = new Map<string, string[]>();
/** Every name of a term with sections on the Allen atlas of the human brain, to its ID */
let index = new Map<string, string>();
/** The parent shown for each term, of the ones it has */
const chosenParent = new Map<string, string | undefined>();

/** Without case, accents and separators, so "Ammon's horn" and "ammons horn" are the same name */
const normalize = (text: string) =>
    text
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .replace(/[^\p{L}\p{N}]/gu, '');

/** Short synonyms are mostly abbreviations, but some are how the structure is written, as "CA1" */
const MIN_SYNONYM_LENGTH = 3;

function buildIndex() {
    const onAtlas = [...terms.values()].filter(term => term.dhba);
    // A name on more than one term is kept by the strongest use of it: the name, then the exact synonyms, then the others
    const byPriority: [string, string[]][] = [
        ...onAtlas.map(t => [t.id, [t.name]] as [string, string[]]),
        ...onAtlas.map(t => [t.id, t.exactSynonyms] as [string, string[]]),
        ...onAtlas.map(t => [t.id, t.otherSynonyms] as [string, string[]]),
    ];
    const built = new Map<string, string>();
    for (const [id, names] of byPriority) {
        for (const name of names) {
            const key = normalize(name);
            if (key.length >= MIN_SYNONYM_LENGTH && !built.has(key)) built.set(key, id);
        }
    }
    return built;
}

/**
 * How many steps up to a term that is part of nothing.
 * Of the parents of a term, the one with the longest path is shown, as it is the most specific:
 * Ammon's horn is part of the limbic system and of the hippocampal formation, and the hippocampal formation is shown
 */
const depths = new Map<string, number>();
function depthOf(id: string, visiting = new Set<string>()): number {
    const known = depths.get(id);
    if (known !== undefined) return known;
    // A cycle, on the relations of Uberon, ends there
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const parents = (terms.get(id)?.parents ?? []).filter(parent => terms.has(parent));
    const depth = parents.length ? 1 + Math.max(...parents.map(parent => depthOf(parent, visiting))) : 0;
    visiting.delete(id);
    depths.set(id, depth);
    return depth;
}

function parentOf(id: string) {
    if (chosenParent.has(id)) return chosenParent.get(id);
    const parents = (terms.get(id)?.parents ?? []).filter(parent => terms.has(parent));
    const parent = parents.sort((a, b) => depthOf(b) - depthOf(a))[0];
    chosenParent.set(id, parent);
    return parent;
}

export async function loadUberon(storage: PluginStorage) {
    let uberon = await storage.get<StoredUberon>(UBERON_KEY);
    if (!uberon) uberon = await download(storage);
    // An old release is used while the new one is downloaded, for the next time
    else if (Date.now() - uberon.downloadedAt > UBERON_MAX_AGE) download(storage).catch(e => console.error('Failed to update Uberon', e));
    terms = new Map(uberon.terms.map(term => [term.id, term]));
    depths.clear();
    chosenParent.clear();
    children = new Map();
    for (const term of terms.values()) {
        const parent = parentOf(term.id);
        if (parent) children.set(parent, [...(children.get(parent) ?? []), term.id]);
    }
    index = buildIndex();
}

/** The term named by the selection, also on the plural ("ovarian follicles", "ovaries") */
export function findTerm(selection: string) {
    const key = normalize(selection);
    if (!key) return undefined;
    const candidates = [key];
    if (key.endsWith('ies')) candidates.push(`${key.slice(0, -3)}y`);
    if (key.endsWith('es')) candidates.push(key.slice(0, -2));
    if (key.endsWith('s')) candidates.push(key.slice(0, -1));
    for (const candidate of candidates) {
        const id = index.get(candidate);
        if (id) return id;
    }
    return undefined;
}

export const termOf = (id: string) => terms.get(id);

/** From the most general term down to this one, itself included */
export function lineageOf(id: string) {
    const lineage: Term[] = [];
    const seen = new Set<string>();
    for (let current: string | undefined = id; current && !seen.has(current); current = parentOf(current)) {
        seen.add(current);
        const term = terms.get(current);
        if (term) lineage.unshift(term);
    }
    return lineage;
}

export const childrenOf = (id: string) =>
    (children.get(id) ?? [])
        .map(child => terms.get(child)!)
        .sort((a, b) => a.name.localeCompare(b.name));

/** The page of the term on the Ontology Lookup Service */
export const urlOf = (id: string) =>
    `https://www.ebi.ac.uk/ols4/ontologies/uberon/classes/${encodeURIComponent(encodeURIComponent(`http://purl.obolibrary.org/obo/${id.replace(':', '_')}`))}`;
