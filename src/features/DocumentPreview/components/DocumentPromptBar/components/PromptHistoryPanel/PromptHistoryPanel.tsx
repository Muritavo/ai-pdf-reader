import { useState } from 'react';
import Text from '@onepercentio/one-ui/components/Text';
import Button from '@onepercentio/one-ui/components/Button';
import Tabs from '@onepercentio/one-ui/components/Tabs';
import Switch from '@onepercentio/one-ui/components/Switch';
import AnimatedEntrance from '@onepercentio/one-ui/components/AnimatedEntrance';
import useShortIntl from '@onepercentio/one-ui/hooks/useShortIntl';
import Dots from '@onepercentio/one-ui/components/LoaderDotsIndicator';
import { FileText, Globe, Play, Trash2 } from 'lucide-react';
import { answerFor, entryKeyOf, type PromptHistoryEntry, type PromptScope } from '../../../../../../utils/promptHistory';
import { TestIds } from '../../../../../../testids';
import Styles from './PromptHistoryPanel.module.scss';

function formatTimestamp(timestamp: string) {
    const date = new Date(timestamp);
    const time = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const day = date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    return `${day} ${time}`;
}

type PromptHistoryPanelProps = {
    entries: Record<PromptScope, PromptHistoryEntry[]>;
    /** The document that is open, to tell the global questions that were asked about it */
    documentHash: string;
    onPick: (entry: PromptHistoryEntry) => void;
    onRemove: (entry: PromptHistoryEntry, scope: PromptScope) => void;
    /** Moves the entry from the list it is on to the other one */
    onMove: (entry: PromptHistoryEntry, from: PromptScope) => void;
    onClose: () => void;
    /** Answers the question about the document that is open, when it has no answer about it yet */
    onAnswerHere: (entry: PromptHistoryEntry, scope: PromptScope) => void;
    /** The entries (by their key) being answered, and the ones that failed */
    answering: ReadonlySet<string>;
    failed: ReadonlySet<string>;
    /** Answering needs the AI ready for the document */
    aiReady: boolean;
};

export default function PromptHistoryPanel({ entries, documentHash, onPick, onRemove, onMove, onClose, onAnswerHere, answering, failed, aiReady }: PromptHistoryPanelProps) {
    const { txt } = useShortIntl();
    const [scope, setScope] = useState<PromptScope>('local');
    const shown = entries[scope];

    return (
        <div className={Styles.historyPanel} data-testid={TestIds.ai.historyPanel} data-scope={scope}>
            <div className={Styles.historyHeader}>
                <Text type="caption" className={Styles.historyTitle}>
                    {txt('documentPreview.promptBar.historyTitle')}
                </Text>
                <div className={Styles.historyActions}>
                    <Button variant="transparent" onClick={onClose}>
                        ✕
                    </Button>
                </div>
            </div>
            <Tabs<PromptScope>
                className={Styles.tabs}
                itemClassName={Styles.tab}
                options={[
                    { id: 'local', label: <span data-testid={TestIds.ai.historyTabLocal}>{txt('documentPreview.promptBar.local')}</span> },
                    { id: 'global', label: <span data-testid={TestIds.ai.historyTabGlobal}>{txt('documentPreview.promptBar.global')}</span> },
                ]}
                selected={scope}
                onSelect={setScope}
            />
            <div className={Styles.historyList}>
                {shown.length === 0 && (
                    <Text type="caption" className={Styles.noHistory}>
                        {txt(scope === 'local' ? 'documentPreview.promptBar.noHistory' : 'documentPreview.promptBar.noGlobalHistory')}
                    </Text>
                )}
                {/* A list for each tab, so changing tabs does not animate every entry */}
                <AnimatedEntrance key={scope}>
                    {shown.map(entry => (
                        <div
                            key={entryKeyOf(entry)}
                            data-testid={TestIds.ai.historyItem}
                            data-scope={scope}
                            className={Styles.historyItem}
                            onClick={() => onPick(entry)}
                        >
                            <button
                                type="button"
                                className={Styles.historyItemRemove}
                                data-testid={TestIds.ai.historyRemove}
                                title={txt('documentPreview.promptBar.removeEntry')}
                                aria-label={txt('documentPreview.promptBar.removeEntry')}
                                onClick={e => {
                                    // Removing does not open the entry
                                    e.stopPropagation();
                                    onRemove(entry, scope);
                                }}
                            >
                                <Trash2 size={14} strokeWidth={1.75} />
                            </button>
                            <Text type="caption" className={Styles.historyItemPrompt}>
                                {entry.prompt}
                            </Text>
                            {answerFor(entry, documentHash) !== undefined ? (
                                <Text type="caption" className={Styles.historyItemAnswer} data-testid={TestIds.ai.historyItemAnswer}>
                                    {answerFor(entry, documentHash)}
                                </Text>
                            ) : (
                                // The question was not answered about this document: it can be, without leaving the list
                                <div className={Styles.noAnswer} data-testid={TestIds.ai.historyItemNoAnswer}>
                                    <button
                                        type="button"
                                        className={Styles.answerHere}
                                        data-testid={TestIds.ai.historyAnswerHere}
                                        disabled={!aiReady || answering.has(entryKeyOf(entry))}
                                        title={aiReady ? txt('documentPreview.promptBar.answerHere') : txt('aiWarmUp.locked')}
                                        aria-label={txt('documentPreview.promptBar.answerHere')}
                                        onClick={e => {
                                            e.stopPropagation();
                                            onAnswerHere(entry, scope);
                                        }}
                                    >
                                        {answering.has(entryKeyOf(entry)) ? (
                                            <Dots dotsCount={3} lockSize />
                                        ) : (
                                            <Play size={12} strokeWidth={0} fill="currentColor" />
                                        )}
                                    </button>
                                    <Text type="caption" className={failed.has(entryKeyOf(entry)) ? Styles.answerFailed : undefined}>
                                        {txt(
                                            failed.has(entryKeyOf(entry))
                                                ? 'documentPreview.promptBar.answerHereFailed'
                                                : 'documentPreview.promptBar.noAnswerHere',
                                        )}
                                    </Text>
                                </div>
                            )}
                            <div className={Styles.historyItemFooter}>
                                <Text type="caption" className={Styles.historyItemTime}>
                                    {formatTimestamp(entry.timestamp)}
                                </Text>
                                {/* Picking the list does not open the entry */}
                                <div
                                    className={Styles.scopeToggle}
                                    data-testid={TestIds.ai.historyScopeToggle}
                                    title={txt(scope === 'local' ? 'documentPreview.promptBar.makeGlobal' : 'documentPreview.promptBar.makeLocal')}
                                    onClick={e => e.stopPropagation()}
                                >
                                    <FileText size={14} strokeWidth={1.75} aria-label={txt('documentPreview.promptBar.local')} />
                                    <Switch
                                        size={12}
                                        enabled={scope === 'global'}
                                        onToggle={() => onMove(entry, scope)}
                                        data-testid={TestIds.ai.historyScopeSwitch}
                                        role="switch"
                                        aria-checked={scope === 'global'}
                                        aria-label={txt(scope === 'local' ? 'documentPreview.promptBar.makeGlobal' : 'documentPreview.promptBar.makeLocal')}
                                    />
                                    <Globe size={14} strokeWidth={1.75} aria-label={txt('documentPreview.promptBar.global')} />
                                </div>
                            </div>
                        </div>
                    ))}
                </AnimatedEntrance>
            </div>
        </div>
    );
}
