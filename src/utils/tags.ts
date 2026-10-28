import { useMemo, useSyncExternalStore } from 'react';
import chroma from 'chroma-js';
import seedrandom from 'seedrandom';
import { scoped } from './projects';

/** The tags of each article, by the article key. A tag exists while some article has it */
type StoredTags = Record<string, string[]>;

const TAGS_KEY = 'article-tags';
const CHANGED_EVENT = 'article-tags-changed';

/** The raw value is the snapshot, so it stays the same object while nothing changes */
const readRaw = () => window.localStorage.getItem(scoped(TAGS_KEY));

function parse(raw: string | null): StoredTags {
    try {
        return raw ? (JSON.parse(raw) as StoredTags) : {};
    } catch (e) {
        console.error('Failed to load the tags', e);
        return {};
    }
}

function save(tags: StoredTags) {
    window.localStorage.setItem(scoped(TAGS_KEY), JSON.stringify(tags));
    window.dispatchEvent(new Event(CHANGED_EVENT));
}

/** The hue comes from the name alone (no entropy), so a tag keeps its color everywhere and across reloads */
export function tagColor(tag: string) {
    const random = seedrandom(tag.toLocaleLowerCase());
    return chroma.hsl(random() * 360, 0.7, 0.62).css();
}

export const sameTag =(a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' }) === 0;

/** Adds the tag to the article, reusing the spelling of an existing tag that only differs by case or accents */
export function addTag(articleKey: string, tag: string) {
    const name = tag.trim();
    if (!name) return;
    const tags = parse(readRaw());
    const existing = Object.values(tags)
        .flat()
        .find(t => sameTag(t, name));
    const current = tags[articleKey] ?? [];
    if (current.some(t => sameTag(t, name))) return;
    save({ ...tags, [articleKey]: [...current, existing ?? name] });
}

export function removeTag(articleKey: string, tag: string) {
    const { [articleKey]: current = [], ...others } = parse(readRaw());
    const remaining = current.filter(t => t !== tag);
    save(remaining.length ? { ...others, [articleKey]: remaining } : others);
}

function subscribe(onChange: () => void) {
    window.addEventListener(CHANGED_EVENT, onChange);
    window.addEventListener('storage', onChange);
    return () => {
        window.removeEventListener(CHANGED_EVENT, onChange);
        window.removeEventListener('storage', onChange);
    };
}

function useStoredTags() {
    const raw = useSyncExternalStore(subscribe, readRaw);
    return useMemo(() => parse(raw), [raw]);
}

const NO_TAGS: string[] = [];

export function useArticleTags(articleKey: string) {
    return useStoredTags()[articleKey] ?? NO_TAGS;
}

/** Every tag in use, the most used first */
export function useAllTags() {
    const tags = useStoredTags();
    return useMemo(() => {
        const counts = new Map<string, number>();
        for (const tag of Object.values(tags).flat()) counts.set(tag, (counts.get(tag) ?? 0) + 1);
        return [...counts.entries()].sort(([a, ca], [b, cb]) => cb - ca || a.localeCompare(b)).map(([tag]) => tag);
    }, [tags]);
}
