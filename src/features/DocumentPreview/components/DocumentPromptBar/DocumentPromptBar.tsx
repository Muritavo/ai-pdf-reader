import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import Text from '@onepercentio/one-ui/components/Text';
import Button from '@onepercentio/one-ui/components/Button';
import Dots from '@onepercentio/one-ui/components/LoaderDotsIndicator';
import useShortIntl from '@onepercentio/one-ui/hooks/useShortIntl';
import { Clock, ExternalLink } from 'lucide-react';
import type { FullText } from '../../../../models/Article';
import { askContext } from '../../../../services/ai';
import { getNormalizedText } from '../../../../utils/preprocessing';
import { wordingOf } from '../../../../utils/wording';
import AIWarmUp from '../../../AIWarmUp';
import { useWarmUp } from '../../../../context/AIContext';
import { TestIds } from '../../../../testids';
import Markdown from '../../../../components/Markdown';
import ResponseModal from '../ResponseModal/ResponseModal';
import Styles from './DocumentPromptBar.module.scss';

type PromptHistoryEntry = {
    prompt: string;
    answer: string;
    timestamp: string;
};

const STORAGE_KEY_PREFIX = 'prompt-history-';

function formatTimestamp(timestamp: string) {
    const date = new Date(timestamp);
    const time = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const day = date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    return `${day} ${time}`;
}

export default function DocumentPromptBar({ fullText }: { fullText: FullText }) {
    const { txt } = useShortIntl();
    const [promptText, setPromptText] = useState<string>();
    const [lastAnswer, setLastAnswer] = useState<string>();
    const [isLoading, setIsLoading] = useState(false);
    const [isError, setIsError] = useState(false);
    const [history, setHistory] = useState<PromptHistoryEntry[]>();
    const [showHistory, setShowHistory] = useState(false);
    const [showResponseModal, setShowResponseModal] = useState(false);

    const { ready: aiReady } = useWarmUp(fullText);
    const storageKey = `${STORAGE_KEY_PREFIX}${fullText.hash}`;

    const saveHistory = useCallback(
        (updated: PromptHistoryEntry[]) => {
            setHistory(updated);
            localStorage.setItem(storageKey, JSON.stringify(updated));
        },
        [storageKey],
    );

    useEffect(() => {
        const stored = localStorage.getItem(storageKey);
        setHistory(stored ? (JSON.parse(stored) as PromptHistoryEntry[]) : undefined);
        setPromptText(undefined);
        setLastAnswer(undefined);
    }, [storageKey]);

    useEffect(() => {
        const handleEscape = (e: globalThis.KeyboardEvent) => {
            if (e.key === 'Escape') {
                setPromptText(undefined);
                setLastAnswer(undefined);
            }
        };
        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, []);

    const asking = useRef(false);

    const handleAsk = async () => {
        const prompt = promptText?.trim();
        // A question being answered is not sent again, as it would be asked twice
        if (!prompt || !aiReady || asking.current) return;

        asking.current = true;
        setIsLoading(true);
        setIsError(false);
        try {
            const context = await getNormalizedText(fullText);
            const result = await askContext(prompt, context);
            setLastAnswer(result);
            // Asking again with the same wording replaces the previous entry instead of adding another one
            const others = (history ?? []).filter(entry => wordingOf(entry.prompt) !== wordingOf(prompt));
            saveHistory([{ prompt, answer: result, timestamp: new Date().toISOString() }, ...others]);
        } catch {
            setIsError(true);
        } finally {
            asking.current = false;
            setIsLoading(false);
        }
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') handleAsk();
    };

    return (
        <>
            {showResponseModal && (
                <ResponseModal prompt={promptText!} answer={lastAnswer!} onClose={() => setShowResponseModal(false)} />
            )}
            {showHistory && (
                <div className={Styles.historyPanel}>
                    <div className={Styles.historyHeader}>
                        <Text type="caption" className={Styles.historyTitle}>
                            {txt('documentPreview.promptBar.historyTitle')}
                        </Text>
                        <div className={Styles.historyActions}>
                            <Button
                                variant="transparent"
                                data-testid={TestIds.ai.historyClear}
                                className={Styles.clearButton}
                                onClick={() => {
                                    setHistory(undefined);
                                    localStorage.removeItem(storageKey);
                                }}
                            >
                                {txt('documentPreview.promptBar.clearHistory')}
                            </Button>
                            <Button variant="transparent" onClick={() => setShowHistory(false)}>
                                ✕
                            </Button>
                        </div>
                    </div>
                    <div className={Styles.historyList}>
                        {history && history.length > 0 ? (
                            history.map((entry, index) => (
                                <div
                                    key={index}
                                    data-testid={TestIds.ai.historyItem}
                                    className={Styles.historyItem}
                                    onClick={() => {
                                        setLastAnswer(entry.answer);
                                        setPromptText(entry.prompt);
                                        setShowHistory(false);
                                    }}
                                >
                                    <Text type="caption" className={Styles.historyItemPrompt}>
                                        {entry.prompt}
                                    </Text>
                                    <Text type="caption" className={Styles.historyItemAnswer}>
                                        {entry.answer}
                                    </Text>
                                    <Text type="caption" className={Styles.historyItemTime}>
                                        {formatTimestamp(entry.timestamp)}
                                    </Text>
                                </div>
                            ))
                        ) : (
                            <Text type="caption" className={Styles.noHistory}>
                                {txt('documentPreview.promptBar.noHistory')}
                            </Text>
                        )}
                    </div>
                </div>
            )}
            <div className={Styles.container}>
                <div className={Styles.inputRow}>
                    <Button
                        variant="transparent"
                        data-testid={TestIds.ai.historyToggle}
                        className={Styles.iconButton}
                        onClick={() => setShowHistory(!showHistory)}
                        title={txt('documentPreview.promptBar.history')}
                    >
                        <Clock size={18} strokeWidth={1.5} />
                    </Button>
                    <AIWarmUp fullText={fullText} />
                    <input
                        type="text"
                        data-testid={TestIds.ai.promptInput}
                        value={promptText ?? ''}
                        onChange={e => setPromptText(e.target.value)}
                        onKeyDown={handleKeyDown}
                        className={Styles.promptInput}
                        disabled={!aiReady}
                        title={aiReady ? undefined : txt('aiWarmUp.locked')}
                        placeholder={txt('documentPreview.promptBar.placeholder')}
                    />
                    <Button variant="primary" data-testid={TestIds.ai.promptSend} onClick={handleAsk} disabled={!aiReady || !promptText?.trim() || isLoading}>
                        {isLoading ? <Dots dotsCount={5} lockSize /> : txt('documentPreview.promptBar.send')}
                    </Button>
                </div>

                {isError && (
                    <Text type="caption" className={Styles.errorText} data-testid={TestIds.ai.promptError}>
                        {txt('documentPreview.promptBar.error')}
                    </Text>
                )}

                {lastAnswer && (
                    <div className={Styles.resultSection}>
                        <div className={Styles.resultHeader}>
                            <Text type="caption" className={Styles.resultLabel}>
                                {txt('documentPreview.promptBar.answer')}
                            </Text>
                            <Button
                                variant="transparent"
                                data-testid={TestIds.ai.openResponseModal}
                                className={Styles.iconButton}
                                onClick={() => setShowResponseModal(true)}
                                title={txt('documentPreview.promptBar.openInModal')}
                            >
                                <ExternalLink size={14} strokeWidth={1.5} />
                            </Button>
                        </div>
                        <div className={Styles.resultContentWrapper}>
                            <Markdown className={Styles.resultContent} data-testid={TestIds.ai.answer}>
                                {lastAnswer}
                            </Markdown>
                        </div>
                    </div>
                )}
            </div>
        </>
    );
}
