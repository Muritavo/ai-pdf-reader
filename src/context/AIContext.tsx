import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import useAsyncControl from '@onepercentio/one-ui/hooks/useAsyncControl';
import { getLoadedModelId, pingServer, setAIEndpoint } from '../services/ai';
import { isValidEndpoint, loadAIEndpoints, normalizeEndpoint, saveAIEndpoints, type AIEndpoints } from '../utils/aiEndpoints';
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
};

const NOT_WARMED: WarmUp = { state: 'idle', progress: 0 };

type AIContextShape = {
    /** Online only when the AI server answers and has a model loaded */
    status: AIStatus;
    /** The endpoint in use, and every one added, to switch between */
    endpoint: string;
    endpoints: string[];
    selectEndpoint: (endpoint: string) => void;
    /** Adds an endpoint and starts using it. False when it is not an http(s) address */
    addEndpoint: (endpoint: string) => boolean;
    /** The id of the loaded model, when online */
    model: string | null;
    checking: boolean;
    reconnect: () => Promise<void>;
    /** The warm up state by article key */
    warmUps: Record<string, WarmUp>;
    warmUp: (fullText: FullText) => Promise<void>;
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
    const [endpoints, setEndpoints] = useState<AIEndpoints>(() => {
        const loaded = loadAIEndpoints();
        // Before the first check, so it already goes to the chosen endpoint
        setAIEndpoint(loaded.current);
        return loaded;
    });
    // Changes with the endpoint, so a check of the previous one that ends late does not tell its status as the new one's
    const checkGeneration = useRef(0);
    const control = useAsyncControl({
        async checkStatus() {
            const generation = checkGeneration.current;
            const isCurrent = () => generation === checkGeneration.current;
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

    const applyEndpoints = useCallback(
        (next: AIEndpoints) => {
            setEndpoints(next);
            saveAIEndpoints(next);
            setAIEndpoint(next.current);
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

    const selectEndpoint = useCallback(
        (endpoint: string) => {
            if (endpoint !== endpoints.current) applyEndpoints({ ...endpoints, current: endpoint });
        },
        [endpoints, applyEndpoints],
    );

    const addEndpoint = useCallback(
        (typed: string) => {
            const endpoint = normalizeEndpoint(typed);
            if (!isValidEndpoint(endpoint)) return false;
            // Added again, it is only chosen
            const list = endpoints.endpoints.includes(endpoint) ? endpoints.endpoints : [...endpoints.endpoints, endpoint];
            applyEndpoints({ endpoints: list, current: endpoint });
            return true;
        },
        [endpoints, applyEndpoints],
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
        async (fullText: FullText) => {
            const { articleKey } = fullText;
            reportedKey.current[articleKey] = '';
            updateWarmUp(articleKey, { state: 'running', progress: 0 });
            try {
                await getNormalizedText(fullText, ({ progress, page, generatedWords }) => {
                    const reported = `${Math.round(progress * 100)}-${page}-${generatedWords}`;
                    if (reported === reportedKey.current[articleKey]) return;
                    reportedKey.current[articleKey] = reported;
                    updateWarmUp(articleKey, { state: 'running', progress, page, generatedWords });
                });
                updateWarmUp(articleKey, { state: 'done', progress: 1 });
            } catch {
                updateWarmUp(articleKey, { state: 'error', progress: 0 });
            }
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
            endpoint: endpoints.current,
            endpoints: endpoints.endpoints,
            selectEndpoint,
            addEndpoint,
            model,
            checking: control.loading || !hasChecked,
            reconnect,
            warmUps,
            warmUp,
            checkWarmedUpBefore,
            clearWarmUp,
        }),
        [status, endpoints, selectEndpoint, addEndpoint, model, control.loading, hasChecked, reconnect, warmUps, warmUp, checkWarmedUpBefore, clearWarmUp],
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
        start: () => warmUp(fullText),
        checkWarmedUpBefore: () => checkWarmedUpBefore(fullText),
        clear: () => clearWarmUp(fullText),
    };
}
