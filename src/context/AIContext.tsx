import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import useAsyncControl from '@onepercentio/one-ui/hooks/useAsyncControl';
import { getLoadedModelId, pingServer, setAIProvider, warmUpDocumentContext } from '../services/ai';
import { loadAIProviders, normalizeEndpoint, saveAIProviders, type AIProviderShape } from '../utils/aiProviders';
import type { FullText } from '../models/Article';
import { clearNormalizedText, getNormalizedText, wasWarmedUpBefore } from '../utils/preprocessing';

export type AIStatus = 'offline' | 'online';

/** The warm up extracts the PDF text and passes it through the AI normalization, which asking and defining depend on */
export type WarmUp = {
    state: 'idle' | 'running' | 'done' | 'error';
    /** From 0 to 1 */
    progress: number;
    /** The page the AI is currently reading, while running */
    page?: number;
    /** How many words the AI has generated so far, while running */
    generatedWords?: number;
    /** What the AI has written so far, while running */
    streamed?: string;
};

const NOT_WARMED: WarmUp = { state: 'idle', progress: 0 };

type AIContextShape = {
    /** Online only when the AI server answers and has a model loaded */
    status: AIStatus;
    /** The provider in use (none while none is configured), and every one configured, to switch between */
    provider: AIProviderShape | null;
    providers: AIProviderShape[];
    selectProvider: (endpoint: string) => void;
    /** Adds a provider and starts using it. One with the same endpoint is replaced */
    addProvider: (provider: AIProviderShape) => void;
    /** Changes the model the requests of the provider in use go to. null is the automatic model */
    selectDefaultModel: (model: string | null) => void;
    /** The id of the loaded model, when online */
    model: string | null;
    checking: boolean;
    reconnect: () => Promise<void>;
    /** The warm up state by article key */
    warmUps: Record<string, WarmUp>;
    /** Prepares the document, or joins the preparation already running, resolving with its normalized text */
    warmUp: (fullText: FullText) => Promise<string>;
    /** Marks the document as warmed up when it was before, without using the AI */
    checkWarmedUpBefore: (fullText: FullText) => Promise<void>;
    /** Discards the normalized text, so the document has to be warmed up again */
    clearWarmUp: (fullText: FullText) => Promise<void>;
};

export const AIContext = createContext<AIContextShape>(null as any);

export function AIProvider({ children }: { children: ReactNode }) {
    const [status, setStatus] = useState<AIStatus>('offline');
    const [model, setModel] = useState<string | null>(null);
    const [hasChecked, setHasChecked] = useState(false);
    const [warmUps, setWarmUps] = useState<Record<string, WarmUp>>({});
    const reportedKey = useRef<Record<string, string>>({});
    /** The warm ups running, by article key, so an AI action started meanwhile waits for the same one */
    const runningWarmUps = useRef(new Map<string, Promise<string>>());
    const [providers, setProviders] = useState(() => {
        const loaded = loadAIProviders();
        // Before the first check, so it already goes to the chosen provider
        const current = loaded.providers.find(p => p.endpoint === loaded.current);
        if (current) setAIProvider(current);
        return loaded;
    });
    const provider = providers.providers.find(p => p.endpoint === providers.current) ?? null;
    const hasProvider = useRef(!!provider);
    hasProvider.current = !!provider;
    // Changes with the endpoint, so a check of the previous one that ends late does not tell its status as the new one's
    const checkGeneration = useRef(0);
    const control = useAsyncControl({
        async checkStatus() {
            const generation = checkGeneration.current;
            const isCurrent = () => generation === checkGeneration.current;
            // Nothing to ask while no provider is configured
            if (!hasProvider.current) {
                setModel(null);
                setStatus('offline');
                return;
            }
            try {
                const loadedModel = await getLoadedModelId();
                if (!isCurrent()) return;
                setModel(loadedModel);
                setStatus(loadedModel ? 'online' : 'offline');
            } catch {
                // The models can't be known, so it falls back to checking if the server answers at all
                const answers = await pingServer();
                if (!isCurrent()) return;
                setModel(null);
                setStatus(answers ? 'online' : 'offline');
            }
        },
    });

    // A check already running is shared, instead of asking the server twice
    const checkInFlight = useRef<Promise<void>>();
    const reconnect = useCallback(() => {
        const generation = checkGeneration.current;
        checkInFlight.current ??= control
            .checkStatus()
            .catch(() => {
                if (generation !== checkGeneration.current) return;
                setModel(null);
                setStatus('offline');
            })
            .finally(() => {
                checkInFlight.current = undefined;
                setHasChecked(true);
            });
        return checkInFlight.current;
    }, [control.checkStatus]);

    useEffect(() => {
        reconnect();
    }, []);

    const applyProviders = useCallback(
        (next: { providers: AIProviderShape[]; current: string | null }, serverChanged = true) => {
            setProviders(next);
            saveAIProviders(next.providers, next.current);
            const current = next.providers.find(p => p.endpoint === next.current);
            hasProvider.current = !!current;
            if (current) setAIProvider(current);
            // Only the model changed: the same server, whose status is still the same
            if (!serverChanged) return;
            // A new server: its status is checked again from the start
            checkGeneration.current += 1;
            checkInFlight.current = undefined;
            setModel(null);
            setStatus('offline');
            setHasChecked(false);
            reconnect();
        },
        [reconnect],
    );

    const selectProvider = useCallback(
        (endpoint: string) => {
            if (endpoint !== providers.current) applyProviders({ ...providers, current: endpoint });
        },
        [providers, applyProviders],
    );

    const addProvider = useCallback(
        (added: AIProviderShape) => {
            const next = { ...added, endpoint: normalizeEndpoint(added.endpoint) };
            // Added again, it replaces the one configured before
            const others = providers.providers.filter(p => p.endpoint !== next.endpoint);
            applyProviders({ providers: [...others, next], current: next.endpoint });
        },
        [providers, applyProviders],
    );

    const selectDefaultModel = useCallback(
        (defaultModel: string | null) => {
            if (!provider) return;
            applyProviders(
                {
                    ...providers,
                    providers: providers.providers.map(p => (p === provider ? { ...p, defaultModel } : p)),
                },
                false,
            );
        },
        [provider, providers, applyProviders],
    );

    const updateWarmUp = useCallback((articleKey: string, warmUp: WarmUp) => {
        setWarmUps(prev => ({ ...prev, [articleKey]: warmUp }));
    }, []);

    const checkedBefore = useRef(new Set<string>());
    const checkWarmedUpBefore = useCallback(
        async (fullText: FullText) => {
            if (checkedBefore.current.has(fullText.hash)) return;
            checkedBefore.current.add(fullText.hash);
            if (!(await wasWarmedUpBefore(fullText))) return;
            // Does not override a warm up that started in the meantime
            setWarmUps(prev =>
                prev[fullText.articleKey]?.state === 'running'
                    ? prev
                    : { ...prev, [fullText.articleKey]: { state: 'done', progress: 1 } },
            );
        },
        [],
    );

    const warmUp = useCallback(
        (fullText: FullText) => {
            const { articleKey } = fullText;
            const running = runningWarmUps.current.get(articleKey);
            if (running) return running;

            reportedKey.current[articleKey] = '';
            updateWarmUp(articleKey, { state: 'running', progress: 0 });
            const processing = (async () => {
                try {
                    const normalized = await getNormalizedText(fullText, ({ progress, page, generatedWords, streamed }) => {
                        const reported = `${Math.round(progress * 100)}-${page}-${generatedWords}`;
                        if (reported === reportedKey.current[articleKey]) return;
                        reportedKey.current[articleKey] = reported;
                        updateWarmUp(articleKey, { state: 'running', progress, page, generatedWords, streamed });
                    });
                    updateWarmUp(articleKey, { state: 'done', progress: 1 });
                    // Once processed, a stub question has the server read the document, so the first real one is quicker.
                    // It does not hold the document from being used, and failing it changes nothing
                    warmUpDocumentContext(normalized).catch(() => {});
                    return normalized;
                } catch (error) {
                    updateWarmUp(articleKey, { state: 'error', progress: 0 });
                    throw error;
                } finally {
                    runningWarmUps.current.delete(articleKey);
                }
            })();
            runningWarmUps.current.set(articleKey, processing);
            return processing;
        },
        [updateWarmUp],
    );

    const clearWarmUp = useCallback(
        async (fullText: FullText) => {
            await clearNormalizedText(fullText);
            updateWarmUp(fullText.articleKey, NOT_WARMED);
        },
        [updateWarmUp],
    );

    const value = useMemo(
        () => ({
            status,
            provider,
            providers: providers.providers,
            selectProvider,
            addProvider,
            selectDefaultModel,
            model,
            checking: control.loading || !hasChecked,
            reconnect,
            warmUps,
            warmUp,
            checkWarmedUpBefore,
            clearWarmUp,
        }),
        [status, provider, providers, selectProvider, addProvider, selectDefaultModel, model, control.loading, hasChecked, reconnect, warmUps, warmUp, checkWarmedUpBefore, clearWarmUp],
    );

    return <AIContext.Provider value={value}>{children}</AIContext.Provider>;
}

export function useAI() {
    return useContext(AIContext) as AIContextShape;
}

/** Warm up state of a full text, and whether the AI features that depend on it can be used */
export function useWarmUp(fullText: FullText) {
    const { status, checking, warmUps, warmUp, checkWarmedUpBefore, clearWarmUp } = useAI();
    const current = warmUps[fullText.articleKey] ?? NOT_WARMED;
    return {
        ...current,
        status,
        checking,
        ready: status === 'online' && current.state === 'done',
        /** The AI actions can be used while online, preparing the document first when it is not yet */
        available: status === 'online',
        start: () => {
            // Its failure is shown by the warm up state
            warmUp(fullText).catch(() => {});
        },
        /** The normalized text, for an AI action, warming the document up first when needed (showing its progress) */
        prepare: () => (current.state === 'done' ? getNormalizedText(fullText) : warmUp(fullText)),
        checkWarmedUpBefore: () => checkWarmedUpBefore(fullText),
        clear: () => clearWarmUp(fullText),
    };
}
