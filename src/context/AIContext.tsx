import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import useAsyncControl from '@onepercentio/one-ui/hooks/useAsyncControl';
import { AI_ENDPOINT, getLoadedModelId } from '../services/ai';
import type { FullText } from '../models/Article';
import { getNormalizedText } from '../utils/preprocessing';

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
    endpoint: string;
    /** The id of the loaded model, when online */
    model: string | null;
    checking: boolean;
    reconnect: () => Promise<void>;
    /** The warm up state by article key */
    warmUps: Record<string, WarmUp>;
    warmUp: (fullText: FullText) => Promise<void>;
};

export const AIContext = createContext<AIContextShape>(null as any);

export function AIProvider({ children }: { children: ReactNode }) {
    const [status, setStatus] = useState<AIStatus>('offline');
    const [model, setModel] = useState<string | null>(null);
    const [hasChecked, setHasChecked] = useState(false);
    const [warmUps, setWarmUps] = useState<Record<string, WarmUp>>({});
    const reportedKey = useRef<Record<string, string>>({});
    const control = useAsyncControl({
        async checkStatus() {
            const loadedModel = await getLoadedModelId();
            setModel(loadedModel);
            setStatus(loadedModel ? 'online' : 'offline');
        },
    });

    const reconnect = useCallback(
        () =>
            control
                .checkStatus()
                .catch(() => {
                    setModel(null);
                    setStatus('offline');
                })
                .finally(() => setHasChecked(true)),
        [control.checkStatus],
    );

    useEffect(() => {
        reconnect();
    }, []);

    const updateWarmUp = useCallback((articleKey: string, warmUp: WarmUp) => {
        setWarmUps(prev => ({ ...prev, [articleKey]: warmUp }));
    }, []);

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

    const value = useMemo(
        () => ({ status, endpoint: AI_ENDPOINT, model, checking: control.loading || !hasChecked, reconnect, warmUps, warmUp }),
        [status, model, control.loading, hasChecked, reconnect, warmUps, warmUp],
    );

    return <AIContext.Provider value={value}>{children}</AIContext.Provider>;
}

export function useAI() {
    return useContext(AIContext) as AIContextShape;
}

/** Warm up state of a full text, and whether the AI features that depend on it can be used */
export function useWarmUp(fullText: FullText) {
    const { status, checking, warmUps, warmUp } = useAI();
    const current = warmUps[fullText.articleKey] ?? NOT_WARMED;
    return {
        ...current,
        status,
        checking,
        ready: status === 'online' && current.state === 'done',
        start: () => warmUp(fullText),
    };
}
