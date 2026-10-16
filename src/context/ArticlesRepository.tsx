import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { del, get, set } from 'idb-keyval';
import type { Article, FullText } from '../models/Article';

type StoredFullText = Omit<FullText, 'url' | 'createdAt'> & { createdAt: string };

const ARTICLES_KEY = 'research_workflow_articles';
const FULL_TEXTS_KEY = 'research_workflow_full_texts';

export type IArticlesRepository = {
    articles: Article[];
    /** Full texts indexed by article key */
    fullTexts: Record<string, FullText>;
    loaded: boolean;
    setArticles(articles: Article[]): void;
    attachFullText(articleKey: string, file: File): Promise<FullText>;
    detachFullText(articleKey: string): Promise<void>;
    clear(): Promise<void>;
};

/** Binary content is kept on IndexedDB by hash, metadata on localStorage */
async function storeFile(hash: string, file: File) {
    await set(hash, file);
}

async function restoreFile(hash: string) {
    return (await get(hash)) as File | undefined;
}

async function hashFile(file: File) {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return Array.from(new Uint8Array(digest))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

function readJSON<T>(key: string, fallback: T): T {
    try {
        const stored = localStorage.getItem(key);
        return stored ? (JSON.parse(stored) as T) : fallback;
    } catch (e) {
        console.error(`Failed to load ${key} from localStorage`, e);
        return fallback;
    }
}

function saveFullTexts(fullTexts: Record<string, FullText>) {
    const items: StoredFullText[] = Object.values(fullTexts).map(({ url, ...f }) => ({
        ...f,
        createdAt: f.createdAt.toISOString(),
    }));
    localStorage.setItem(FULL_TEXTS_KEY, JSON.stringify(items));
}

async function loadFullTexts(): Promise<Record<string, FullText>> {
    const items = readJSON<StoredFullText[]>(FULL_TEXTS_KEY, []);
    const loaded = await Promise.all(
        items.map(async item => {
            try {
                const file = await restoreFile(item.hash);
                if (!file) return undefined;
                return {
                    ...item,
                    createdAt: new Date(item.createdAt),
                    url: URL.createObjectURL(file),
                } satisfies FullText;
            } catch (e) {
                console.error('Failed to load file', e);
                return undefined;
            }
        }),
    );
    return Object.fromEntries(loaded.filter(f => !!f).map(f => [f.articleKey, f]));
}

export const ArticlesRepositoryContext = createContext<IArticlesRepository>(null as any);

export function ArticlesRepositoryProvider({ children }: { children: React.ReactNode }) {
    const [articles, _setArticles] = useState<Article[]>(() => readJSON<Article[]>(ARTICLES_KEY, []));
    const [fullTexts, setFullTexts] = useState<Record<string, FullText>>({});
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        loadFullTexts().then(f => {
            setFullTexts(f);
            setLoaded(true);
        });
    }, []);

    const setArticles = useCallback((next: Article[]) => {
        _setArticles(next);
        localStorage.setItem(ARTICLES_KEY, JSON.stringify(next));
    }, []);

    const attachFullText = useCallback(async (articleKey: string, file: File) => {
        const hash = await hashFile(file);
        await storeFile(hash, file);

        const fullText: FullText = {
            articleKey,
            hash,
            name: file.name,
            size: file.size,
            createdAt: new Date(),
            url: URL.createObjectURL(file),
        };

        setFullTexts(prev => {
            if (prev[articleKey]) URL.revokeObjectURL(prev[articleKey].url);
            const updated = { ...prev, [articleKey]: fullText };
            saveFullTexts(updated);
            return updated;
        });
        return fullText;
    }, []);

    const detachFullText = useCallback(async (articleKey: string) => {
        const removed = fullTexts[articleKey];
        if (!removed) return;
        URL.revokeObjectURL(removed.url);
        const { [articleKey]: _, ...updated } = fullTexts;
        setFullTexts(updated);
        saveFullTexts(updated);
        // The same PDF may be attached to more than one article
        if (!Object.values(updated).some(f => f.hash === removed.hash)) await del(removed.hash);
    }, [fullTexts]);

    const clear = useCallback(async () => {
        await Promise.all(Object.values(fullTexts).map(f => del(f.hash)));
        Object.values(fullTexts).forEach(f => URL.revokeObjectURL(f.url));
        setFullTexts({});
        saveFullTexts({});
        setArticles([]);
    }, [fullTexts, setArticles]);

    return (
        <ArticlesRepositoryContext.Provider
            value={{ articles, fullTexts, loaded, setArticles, attachFullText, detachFullText, clear }}
        >
            {children}
        </ArticlesRepositoryContext.Provider>
    );
}

export function useArticlesRepository(): IArticlesRepository {
    return useContext(ArticlesRepositoryContext);
}
