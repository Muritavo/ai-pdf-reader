import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import Text from '@onepercentio/one-ui/components/Text';
import Button from '@onepercentio/one-ui/components/Button';
import Dots from '@onepercentio/one-ui/components/LoaderDotsIndicator';
import useShortIntl from '@onepercentio/one-ui/hooks/useShortIntl';
import { Clock, ExternalLink } from 'lucide-react';
import type { FullText } from '../../../../models/Article';
import { askContext } from '../../../../services/ai';
import { getNormalizedText } from '../../../../utils/preprocessing';
import {
    answerFor,
    entryKeyOf,
    loadPrompts,
    savePrompts,
    withEntryFirst,
    type PromptHistoryEntry,
    type PromptScope,
} from '../../../../utils/promptHistory';
import AIWarmUp from '../../../AIWarmUp';
import { useWarmUp } from '../../../../context/AIContext';
import { TestIds } from '../../../../testids';
import Markdown from '../../../../components/Markdown';
import ResponseModal from '../ResponseModal/ResponseModal';
import PromptHistoryPanel from './components/PromptHistoryPanel';
import Styles from './DocumentPromptBar.module.scss';

export default function DocumentPromptBar({ fullText }: { fullText: FullText }) {
    const { txt } = useShortIntl();
    const [promptText, setPromptText] = useState<string>();
    const [lastAnswer, setLastAnswer] = useState<string>();
    const [isLoading, setIsLoading] = useState(false);
    const [isError, setIsError] = useState(false);
    const [history, setHistory] = useState<Record<PromptScope, PromptHistoryEntry[]>>({ local: [], global: [] });
    const [showHistory, setShowHistory] = useState(false);
    const [showResponseModal, setShowResponseModal] = useState(false);

    const { ready: aiReady } = useWarmUp(fullText);
    const { hash } = fullText;

    const saveHistory = useCallback(
        (scope: PromptScope, entries: PromptHistoryEntry[]) => {
            setHistory(current => ({ ...current, [scope]: entries }));
            savePrompts(scope, hash, entries);
        },
        [hash],
    );

    useEffect(() => {
        setHistory({ local: loadPrompts('local', hash), global: loadPrompts('global', hash) });
        setPromptText(undefined);
        setLastAnswer(undefined);
    }, [hash]);

    /** Takes the entry out of the list it is on, and puts it first on the other one */
    const moveEntry = (entry: PromptHistoryEntry, from: PromptScope) => {
        const to: PromptScope = from === 'local' ? 'global' : 'local';
        saveHistory(from, history[from].filter(other => other !== entry));
        // A question made local is about the document that is open now, so it keeps only the answer about it
        const moved: PromptHistoryEntry =
            to === 'local' ? { ...entry, answers: entry.answers[hash] ? { [hash]: entry.answers[hash] } : {} } : entry;
        saveHistory(to, withEntryFirst(history[to], moved));
    };

    const [answering, setAnswering] = useState<ReadonlySet<string>>(new Set());
    const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
    const withKey = (keys: ReadonlySet<string>, key: string, present: boolean) => {
        const next = new Set(keys);
        if (present) next.add(key);
        else next.delete(key);
        return next;
    };

    /** Answers a question of the history about the document that is open, keeping the answers about the others */
    const answerHere = async (entry: PromptHistoryEntry, scope: PromptScope) => {
        const key = entryKeyOf(entry);
        setAnswering(current => withKey(current, key, true));
        setFailed(current => withKey(current, key, false));
        try {
            const answer = await askContext(entry.prompt, await getNormalizedText(fullText));
            const answered: PromptHistoryEntry = {
                ...entry,
                answers: { ...entry.answers, [hash]: { answer, timestamp: new Date().toISOString(), documentName: fullText.name } },
            };
            setHistory(current => {
                const updated = current[scope].map(other => (entryKeyOf(other) === key ? answered : other));
                savePrompts(scope, hash, updated);
                return { ...current, [scope]: updated };
            });
        } catch {
            setFailed(current => withKey(current, key, true));
        } finally {
            setAnswering(current => withKey(current, key, false));
        }
    };

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
            // A question is always born local. Asking again with the same wording replaces the previous one
            saveHistory(
                'local',
                withEntryFirst(history.local, {
                    prompt,
                    timestamp: new Date().toISOString(),
                    answers: { [hash]: { answer: result, timestamp: new Date().toISOString(), documentName: fullText.name } },
                }),
            );
        } catch {
            setIsError(true);
        } finally {
            asking.current = false;
            setIsLoading(false);
        }
    };

    // Enter sends the question, while Shift+Enter breaks the line (as does Enter while composing an accent)
    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
        e.preventDefault();
        handleAsk();
    };

    // The field grows with the lines of the question, up to a limit, and shrinks back when they are gone
    const promptField = useRef<HTMLTextAreaElement>(null);
    useEffect(() => {
        const field = promptField.current;
        if (!field) return;
        field.style.height = 'auto';
        field.style.height = `${field.scrollHeight}px`;
    }, [promptText]);

    return (
        <>
            {showResponseModal && (
                <ResponseModal prompt={promptText!} answer={lastAnswer!} onClose={() => setShowResponseModal(false)} />
            )}
            {showHistory && (
                <PromptHistoryPanel
                    entries={history}
                    documentHash={hash}
                    onPick={entry => {
                        setPromptText(entry.prompt);
                        // Only the answer about this document, as a global question may have been answered about others
                        setLastAnswer(answerFor(entry, hash));
                        setShowHistory(false);
                    }}
                    onRemove={(entry, scope) => saveHistory(scope, history[scope].filter(other => other !== entry))}
                    onMove={moveEntry}
                    onClose={() => setShowHistory(false)}
                    onAnswerHere={answerHere}
                    answering={answering}
                    failed={failed}
                    aiReady={aiReady}
                />
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
                    <textarea
                        ref={promptField}
                        rows={1}
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
