import type { PluginStorage } from '../../types';

const API = 'https://api.brain-map.org/api/v2';

/** The Allen Human Reference Atlas: an adult brain (34 years) cut on 106 annotated Nissl sections, at about 1 µm per pixel */
const ATLAS_ID = 265297126;
/** The structures of the atlas, the ones of the Developing Human Brain Atlas (DHBA) that Uberon refers to */
const STRUCTURE_GRAPH_ID = 16;
/** The group of each section with the outlines of the structures */
const STRUCTURES_GROUP_LABEL = 31;
/** The outlines are drawn on the sections reduced 7 times */
export const OUTLINE_SCALE = 7;
/** Of the sections in full resolution */
export const MICRONS_PER_PIXEL = 0.97;
/** The most a section can be reduced, as a power of 2: 128 times, about the size of the window */
export const MAX_DOWNSAMPLE = 7;

const SECTIONS_KEY = 'allen-sections';

/** A section of the atlas: its image, and the group with the outlines of its structures */
type Section = { image: number; number: number; width: number; height: number; group: number };

/** A part outlined on a section, as "stratum pyramidale of caudal CA1" */
export type Outline = {
    /** SVG path, on the pixels reduced `OUTLINE_SCALE` times */
    d: string;
    name: string;
    /** As "CA1Csp" */
    acronym: string;
};

/** The outlines of a structure on a section, and the box around them, on the pixels of the whole section */
export type StructureOnSection = {
    image: number;
    number: number;
    width: number;
    height: number;
    /** The structure is often only outlined by its parts, as CA1 by its layers */
    outlines: Outline[];
    box: { left: number; top: number; right: number; bottom: number };
};

type Query<T> = { success: boolean; msg: T[] | string };

/** Sent as a form, as the lists of IDs are too long for an URL */
async function query<T>(criteria: string) {
    const response = await fetch(`${API}/data/query.json`, { method: 'POST', body: new URLSearchParams({ criteria }) });
    if (!response.ok) throw new Error(`Allen answered ${response.status}`);
    const result = (await response.json()) as Query<T>;
    if (!result.success || typeof result.msg === 'string') throw new Error(`Allen answered ${result.msg}`);
    return result.msg;
}

let sections: Section[] = [];

/** The sections never change, so they are only downloaded once */
export async function loadSections(storage: PluginStorage) {
    const stored = await storage.get<Section[]>(SECTIONS_KEY);
    if (stored) {
        sections = stored;
        return;
    }
    const images = await query<{ id: number; section_number: number; width: number; height: number }>(
        `model::AtlasImage,rma::criteria,[annotated$eqtrue],atlas_data_set(atlases[id$eq${ATLAS_ID}]),rma::options[num_rows$eqall]`,
    );
    const groups = await query<{ id: number; sub_image_id: number }>(
        `model::GraphicObject,rma::criteria,[sub_image_id$in${images.map(i => i.id).join(',')}][graphic_group_label_id$eq${STRUCTURES_GROUP_LABEL}],rma::options[num_rows$eqall]`,
    );
    const groupOf = new Map(groups.map(group => [group.sub_image_id, group.id]));
    sections = images
        .filter(image => groupOf.has(image.id))
        .map(image => ({ image: image.id, number: image.section_number, width: image.width, height: image.height, group: groupOf.get(image.id)! }));
    await storage.set(SECTIONS_KEY, sections);
}

const PATH_TOKEN = /[MmCcLlHhVvSsQqTtZz]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/g;
const ARGUMENTS: Record<string, number> = { M: 2, L: 2, C: 6, S: 4, Q: 4, T: 2, H: 1, V: 1 };

/** The box around the points of an SVG path, as the outlines are drawn with relative curves */
function boundsOf(path: string) {
    const tokens = path.match(PATH_TOKEN) ?? [];
    let x = 0;
    let y = 0;
    let startX = 0;
    let startY = 0;
    let command = 'M';
    const box = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
    const add = (px: number, py: number) => {
        box.left = Math.min(box.left, px);
        box.top = Math.min(box.top, py);
        box.right = Math.max(box.right, px);
        box.bottom = Math.max(box.bottom, py);
    };
    for (let i = 0; i < tokens.length; ) {
        if (/[a-z]/i.test(tokens[i])) {
            command = tokens[i++];
            if (command === 'Z' || command === 'z') {
                x = startX;
                y = startY;
                continue;
            }
        }
        const type = command.toUpperCase();
        const relative = command !== type;
        const values = tokens.slice(i, i + ARGUMENTS[type]).map(Number);
        i += ARGUMENTS[type];
        if (type === 'H') x = relative ? x + values[0] : values[0];
        else if (type === 'V') y = relative ? y + values[0] : values[0];
        else {
            for (let j = 0; j < values.length; j += 2) add(values[j] + (relative ? x : 0), values[j + 1] + (relative ? y : 0));
            x = values[values.length - 2] + (relative ? x : 0);
            y = values[values.length - 1] + (relative ? y : 0);
            if (type === 'M') {
                startX = x;
                startY = y;
                // The pairs after a move are lines
                command = relative ? 'l' : 'L';
            }
        }
        add(x, y);
    }
    return box;
}

const outlines = new Map<string, Promise<StructureOnSection[]>>();

/**
 * The sections where the structure is outlined, the ones where it is largest first.
 * A structure is often only outlined by its parts (CA1 by its layers), so the parts are taken with it
 */
export function sectionsOf(dhba: string) {
    let found = outlines.get(dhba);
    if (!found) {
        found = (async () => {
            const structures = await query<{ id: number; name: string; acronym: string }>(
                `model::Structure,rma::criteria,[graph_id$eq${STRUCTURE_GRAPH_ID}][structure_id_path$li'*/${dhba}/*'],rma::options[num_rows$eqall][only$eq'id,name,acronym']`,
            );
            const structureOf = new Map(structures.map(s => [s.id, s]));
            if (!structures.length || !sections.length) return [];
            const objects = await query<{ parent_id: number; structure_id: number; path: string }>(
                `model::GraphicObject,rma::criteria,[structure_id$in${structures.map(s => s.id).join(',')}][parent_id$in${sections.map(s => s.group).join(',')}],rma::options[num_rows$eqall][only$eq'parent_id,structure_id,path']`,
            );
            const byGroup = new Map<number, Outline[]>();
            for (const object of objects) {
                const structure = structureOf.get(object.structure_id)!;
                const outline = { d: object.path, name: structure.name, acronym: structure.acronym };
                byGroup.set(object.parent_id, [...(byGroup.get(object.parent_id) ?? []), outline]);
            }
            return sections
                .filter(section => byGroup.has(section.group))
                .map(section => {
                    const outlines = byGroup.get(section.group)!;
                    const box = outlines.map(outline => boundsOf(outline.d)).reduce((a, b) => ({
                        left: Math.min(a.left, b.left),
                        top: Math.min(a.top, b.top),
                        right: Math.max(a.right, b.right),
                        bottom: Math.max(a.bottom, b.bottom),
                    }));
                    return {
                        image: section.image,
                        number: section.number,
                        width: section.width,
                        height: section.height,
                        outlines,
                        box: {
                            left: box.left * OUTLINE_SCALE,
                            top: box.top * OUTLINE_SCALE,
                            right: box.right * OUTLINE_SCALE,
                            bottom: box.bottom * OUTLINE_SCALE,
                        },
                    };
                })
                .sort((a, b) => (b.box.right - b.box.left) * (b.box.bottom - b.box.top) - (a.box.right - a.box.left) * (a.box.bottom - a.box.top));
        })();
        // A failure is not kept, so it can be tried again
        found.catch(() => outlines.delete(dhba));
        outlines.set(dhba, found);
    }
    return found;
}

/** A part of a section, on the pixels of the whole section, reduced 2^downsample times */
export const imageUrl = (image: number, downsample: number, area?: { left: number; top: number; width: number; height: number }) =>
    `${API}/image_download/${image}?downsample=${downsample}` +
    (area ? `&left=${Math.round(area.left)}&top=${Math.round(area.top)}&width=${Math.round(area.width)}&height=${Math.round(area.height)}` : '');

/** The section on the viewer of the Allen Brain Atlas */
export const atlasUrl = (image: number) => `https://atlas.brain-map.org/atlas?atlas=${ATLAS_ID}#atlas=${ATLAS_ID}&plate=${image}`;
