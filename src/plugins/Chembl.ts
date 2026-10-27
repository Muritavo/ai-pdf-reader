import { get, set } from 'idb-keyval';
import type { Plugin } from './types';

const API = 'https://www.ebi.ac.uk/chembl/api/data';

/** The approved drugs (max phase 4): about 4 thousand, with their names on every pharmacopoeia and their trade names */
const LIST_URL = `${API}/molecule.json?max_phase=4&only=molecule_chembl_id,pref_name,molecule_synonyms`;
/** The most the API gives at once */
const PAGE_SIZE = 1000;

/** Outside of the projects, as the list is the same for all of them */
const LIST_KEY = 'plugins/chembl/approved';

/** ChEMBL is released about twice a year */
const LIST_MAX_AGE = 90 * 24 * 60 * 60 * 1000;

/** Each line is `CHEMBL ID \t preferred name \t synonyms separated by |`, as only the names are needed to match */
type StoredList = { downloadedAt: number; tsv: string };

type ListPage = {
    molecules: { molecule_chembl_id: string; pref_name: string | null; molecule_synonyms: { molecule_synonym: string; syn_type: string }[] }[];
    page_meta: { total_count: number };
};

/** Every name of a drug, to its ChEMBL ID */
let index = new Map<string, string>();

/** Without case, accents and separators, so "Methylphenidate HCl" and "methylphenidate-HCl" are the same name */
const normalize = (text: string) =>
    text
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .replace(/[^\p{L}\p{N}]/gu, '');

/** Short synonyms are mostly codes and abbreviations ("DIC", "Inh") that the articles use for other things */
const MIN_SYNONYM_LENGTH = 5;

function buildIndex(tsv: string) {
    const rows = tsv
        .split('\n')
        .map(line => line.split('\t'))
        .filter(([id]) => id);
    // A name on more than one drug is kept by the strongest use of it: the preferred name, then its synonyms
    const byPriority: [string, string[]][] = [
        ...rows.map(([id, name]) => [id, [name]] as [string, string[]]),
        ...rows.map(([id, , synonyms = '']) => [id, synonyms.split('|').filter(s => normalize(s).length >= MIN_SYNONYM_LENGTH)] as [string, string[]]),
    ];
    const built = new Map<string, string>();
    for (const [id, names] of byPriority) {
        for (const name of names) {
            const key = normalize(name);
            if (key && !built.has(key)) built.set(key, id);
        }
    }
    return built;
}

async function fetchPage(offset: number) {
    const response = await fetch(`${LIST_URL}&limit=${PAGE_SIZE}&offset=${offset}`);
    if (!response.ok) throw new Error(`ChEMBL answered ${response.status}`);
    return (await response.json()) as ListPage;
}

async function download() {
    const first = await fetchPage(0);
    const offsets = [];
    for (let offset = PAGE_SIZE; offset < first.page_meta.total_count; offset += PAGE_SIZE) offsets.push(offset);
    const pages = [first, ...(await Promise.all(offsets.map(fetchPage)))];
    const tsv = pages
        .flatMap(page => page.molecules)
        .map(molecule =>
            [
                molecule.molecule_chembl_id,
                molecule.pref_name ?? '',
                // E numbers ("E260") are food additives, not how a drug is named
                [...new Set(molecule.molecule_synonyms.filter(s => s.syn_type !== 'E_NUMBER').map(s => s.molecule_synonym))].join('|'),
            ].join('\t'),
        )
        .join('\n');
    const list: StoredList = { downloadedAt: Date.now(), tsv };
    await set(LIST_KEY, list);
    return list;
}

type Molecule = {
    molecule_chembl_id: string;
    pref_name: string | null;
    molecule_properties: { full_molformula: string | null } | null;
    /** Salts and other forms of a drug point to the molecule they come from */
    molecule_hierarchy: { parent_chembl_id: string } | null;
};

type Mechanisms = { mechanisms: { mechanism_of_action: string | null }[] };

const SUBSCRIPTS = '₀₁₂₃₄₅₆₇₈₉';

/** "C14H19NO2" as "C₁₄H₁₉NO₂" */
const formatFormula = (formula: string) => formula.replace(/\d/g, digit => SUBSCRIPTS[Number(digit)]);

/** ChEMBL names are uppercase, as "METHYLPHENIDATE HYDROCHLORIDE" */
const formatName = (name: string) => name.charAt(0) + name.slice(1).toLowerCase();

async function fetchJson<T>(url: string) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`ChEMBL answered ${response.status}`);
    return (await response.json()) as T;
}

const ChemblPlugin: Plugin = {
    id: 'chembl',
    async setup() {
        let list = (await get(LIST_KEY)) as StoredList | undefined;
        if (!list) list = await download();
        // An old list is used while the new one is downloaded, for the next time
        else if (Date.now() - list.downloadedAt > LIST_MAX_AGE) download().catch(e => console.error('Failed to update the ChEMBL list', e));
        index = buildIndex(list.tsv);
    },
    menuOptions: [
        {
            id: 'chembl-info',
            label: 'Informações no ChEMBL',
            testId: 'menu-plugin-chembl',
            matches: selection => index.has(normalize(selection)),
            async onClick({ selection, showResult }) {
                const id = index.get(normalize(selection))!;
                const molecule = await fetchJson<Molecule>(
                    `${API}/molecule/${id}.json?only=molecule_chembl_id,pref_name,molecule_properties,molecule_hierarchy`,
                );
                // Recorded on the parent, on a salt of it, or on both, so the ones of every form of the drug are taken
                const parent = molecule.molecule_hierarchy?.parent_chembl_id ?? id;
                const { mechanisms } = await fetchJson<Mechanisms>(
                    `${API}/mechanism.json?parent_molecule_chembl_id=${parent}&only=mechanism_of_action&limit=50`,
                );
                // The same mechanism is recorded once for each form and each target it acts on
                const actions = [...new Set(mechanisms.map(m => m.mechanism_of_action).filter(Boolean))];
                const formula = molecule.molecule_properties?.full_molformula;

                showResult({
                    title: 'ChEMBL',
                    prompt: selection,
                    promptLabel: 'Seleção',
                    answerLabel: 'Fármaco',
                    background: `${API}/image/${molecule.molecule_chembl_id}.svg`,
                    answer: [
                        `**Nome:** ${molecule.pref_name ? formatName(molecule.pref_name) : '—'}`,
                        `**Fórmula química:** ${formula ? formatFormula(formula) : '—'}`,
                        actions.length > 1
                            ? `**Mecanismo de ação:**\n\n${actions.map(action => `- ${action}`).join('\n')}`
                            : `**Mecanismo de ação:** ${actions[0] ?? 'Sem mecanismo descrito.'}`,
                        `[Ver ${molecule.molecule_chembl_id} no ChEMBL](https://www.ebi.ac.uk/chembl/explore/compound/${molecule.molecule_chembl_id})`,
                    ].join('\n\n'),
                });
            },
        },
    ],
};

export default ChemblPlugin;
