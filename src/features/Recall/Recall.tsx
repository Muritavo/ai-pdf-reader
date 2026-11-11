import { useRef, useState } from 'react';
import Text from '@onepercentio/one-ui/components/Text';
import Button from '@onepercentio/one-ui/components/Button';
import Tabs from '@onepercentio/one-ui/components/Tabs';
import AdaptiveDialog from '@onepercentio/one-ui/components/AdaptiveDialog';
import useShortIntl from '@onepercentio/one-ui/hooks/useShortIntl';
import { Brain, Search } from 'lucide-react';
import { useAI } from '../../context/AIContext';
import { useArticlesRepository } from '../../context/ArticlesRepository';
import type { Article, FullText } from '../../models/Article';
import { askContext, RECALL_NOT_ADDRESSED, singleDocumentPrompt, synthesizeRecall } from '../../services/ai';
import { getNormalizedText, wasWarmedUpBefore } from '../../utils/preprocessing';
import { addRecall, loadRecalls, type RecallDocument, type RecallEntry } from '../../utils/recallHistory';
import Markdown from '../../components/Markdown';
import { TestIds } from '../../testids';
import Styles from './Recall.module.scss';

type Phase = 'idle' | 'preparing' | 'asking' | 'synthesizing' | 'done' | 'error';

type Tab = 'ask' | 'history';

/** An article being asked, or already answered */
type DocumentAnswer = Omit<RecallDocument, 'state'> & { state: 'pending' | 'running' | RecallDocument['state']; answer?: string };

const isNotAddressed = (answer = '') => answer.trim().toUpperCase().startsWith(RECALL_NOT_ADDRESSED);

/** A brain with a magnifying glass over it */
function RecallIcon() {
    return (
        <span className={Styles.icon} aria-hidden>
            <Brain size={20} strokeWidth={1.8} />
            <Search size={12} strokeWidth={2.6} className={Styles.iconSearch} />
        </span>
    );
}

const CELL_CLASS: Record<DocumentAnswer['state'], string | undefined> = {
    pending: undefined,
    running: Styles.cellRunning,
    done: Styles.cellDone,
    error: Styles.cellError,
};

/** The progress of a recall, a cell for each article, with the answer put together under it */
function RecallResult({ synthesis, documents }: { synthesis: string; documents: DocumentAnswer[] }) {
    const { txt } = useShortIntl();
    return (
        <>
            {documents.length > 0 && (
                <ul className={Styles.cells} data-testid={TestIds.recall.documents}>
                    {documents.map(({ articleKey, title, year, state }) => (
                        <li
                            key={articleKey}
                            className={`${Styles.cell} ${CELL_CLASS[state] ?? ''}`}
                            data-state={state}
                            title={`${title}${year ? ` (${year})` : ''} · ${txt(`recall.state.${state}`)}`}
                        >
                            {state === 'running' && (
                                <span className={Styles.dots} aria-hidden>
                                    <span />
                                    <span />
                                    <span />
                                </span>
                            )}
                        </li>
                    ))}
                </ul>
            )}

            {synthesis && (
                <section className={Styles.section}>
                    <Text type="caption" className={Styles.label}>
                        {txt('recall.synthesis')}
                    </Text>
                    <Markdown className={Styles.answer} data-testid={TestIds.recall.synthesis}>
                        {synthesis}
                    </Markdown>
                </section>
            )}
        </>
    );
}

/**
 * Looks for something across all the documents: the question is turned into one asked about each
 * prepared document alone, and their answers are put together into one answer
 */
export default function Recall() {
    const { txt } = useShortIntl();
    const { status, checking, warmUps } = useAI();
    const { articles, fullTexts } = useArticlesRepository();
    const [open, setOpen] = useState(false);
    const [tab, setTab] = useState<Tab>('ask');
    const [history, setHistory] = useState<RecallEntry[]>(loadRecalls);
    // The recall of the history being seen, by its position on it
    const [seen, setSeen] = useState<number>();
    const [question, setQuestion] = useState('');
    const [phase, setPhase] = useState<Phase>('idle');
    const [documents, setDocuments] = useState<DocumentAnswer[]>([]);
    const [skipped, setSkipped] = useState(0);
    const [synthesis, setSynthesis] = useState('');
    // Changes when a recall is started again or the window is closed, so the one running stops updating it
    const run = useRef(0);

    const offline = status === 'offline' && !checking;
    const running = phase === 'preparing' || phase === 'asking' || phase === 'synthesizing';

    const close = () => {
        run.current += 1;
        setOpen(false);
        setPhase(current => (current === 'done' || current === 'idle' ? current : 'idle'));
    };

    const recall = async () => {
        const broadPrompt = question.trim();
        if (!broadPrompt) return;
        const id = ++run.current;
        const isCurrent = () => id === run.current;
        setPhase('preparing');
        setDocuments([]);
        setSkipped(0);
        setSynthesis('');
        try {
            // Only the documents already prepared for the AI: preparing all of them would take too long
            const withPdf = articles.filter(a => fullTexts[a.key]);
            const prepared: Article[] = [];
            for (const article of withPdf) {
                const fullText = fullTexts[article.key] as FullText;
                if (warmUps[article.key]?.state === 'done' || (await wasWarmedUpBefore(fullText))) prepared.push(article);
            }
            if (!isCurrent()) return;
            const left = withPdf.length - prepared.length;
            setSkipped(left);
            if (prepared.length === 0) {
                setPhase('done');
                return;
            }

            const single = await singleDocumentPrompt(broadPrompt);
            if (!isCurrent()) return;
            const answers: DocumentAnswer[] = prepared.map(({ key, title, year }) => ({ articleKey: key, title, year, state: 'pending' }));
            setDocuments(answers);
            setPhase('asking');

            // One at a time, as the AI server answers one question at a time anyway
            for (let i = 0; i < answers.length; i++) {
                answers[i] = { ...answers[i], state: 'running' };
                setDocuments([...answers]);
                try {
                    const context = await getNormalizedText(fullTexts[answers[i].articleKey] as FullText);
                    const answer = await askContext(single, context);
                    answers[i] = { ...answers[i], state: 'done', answer };
                } catch {
                    answers[i] = { ...answers[i], state: 'error' };
                }
                if (!isCurrent()) return;
                setDocuments([...answers]);
            }

            const relevant = prepared.filter((_, i) => answers[i].state === 'done' && !isNotAddressed(answers[i].answer));
            setPhase('synthesizing');
            let result = '';
            if (relevant.length === 0) {
                result = txt('recall.nothingFound');
                setSynthesis(result);
            } else {
                result = await synthesizeRecall(
                    broadPrompt,
                    relevant.map(article => ({ ...article, answer: answers[prepared.indexOf(article)].answer! })),
                    chunk => {
                        if (isCurrent()) setSynthesis(previous => previous + chunk);
                    },
                );
            }
            if (!isCurrent()) return;
            setHistory(
                addRecall({
                    question: broadPrompt,
                    timestamp: new Date().toISOString(),
                    synthesis: result,
                    documents: answers.map(({ answer, ...document }) => document as RecallDocument),
                    skipped: left,
                }),
            );
            setPhase('done');
        } catch {
            if (isCurrent()) setPhase('error');
        }
    };

    /** Clears the question and its answer, to ask another one */
    const askNewQuestion = () => {
        run.current += 1;
        setQuestion('');
        setPhase('idle');
        setDocuments([]);
        setSkipped(0);
        setSynthesis('');
    };

    const answeredQuestion = phase === 'done';
    const answered = documents.filter(d => d.state === 'done' || d.state === 'error').length;
    const seenEntry = seen === undefined ? undefined : history[seen];

    return (
        <>
            <button
                type="button"
                className={Styles.trigger}
                title={offline ? txt('recall.offline') : txt('recall.open')}
                aria-label={txt('recall.open')}
                data-testid={TestIds.recall.open}
                onClick={() => setOpen(true)}
            >
                <RecallIcon />
            </button>
            {/* Its own close button is in the header, so onClose (which adds one-ui's) is left out */}
            <AdaptiveDialog open={open} onClickOut={close}>
                <div
                    className={Styles.content}
                    data-testid={TestIds.recall.modal}
                    // On the panel rather than the page, so it also works where the panel has its own window (AR)
                    onKeyDown={e => {
                        if (e.key === 'Escape') close();
                    }}
                >
                    <div className={Styles.header}>
                        <Text type="subtitle" className={Styles.title}>
                            <RecallIcon />
                            {txt('recall.title')}
                        </Text>
                        <Button variant="transparent" onClick={close} aria-label={txt('recall.close')}>
                            ✕
                        </Button>
                    </div>
                    <Tabs<Tab>
                        className={Styles.tabs}
                        itemClassName={Styles.tab}
                        options={[
                            { id: 'ask', label: <span data-testid={TestIds.recall.tabAsk}>{txt('recall.tabAsk')}</span> },
                            {
                                id: 'history',
                                label: (
                                    <span data-testid={TestIds.recall.tabHistory}>
                                        {txt('recall.tabHistory', { count: String(history.length) })}
                                    </span>
                                ),
                            },
                        ]}
                        selected={tab}
                        onSelect={next => {
                            setTab(next);
                            setSeen(undefined);
                        }}
                    />
                    {tab === 'ask' && (
                        <div className={Styles.body}>
                            <Text type="caption">{txt('recall.description')}</Text>
                            <textarea
                                className={Styles.question}
                                rows={3}
                                placeholder={txt('recall.placeholder')}
                                data-testid={TestIds.recall.question}
                                value={question}
                                // Answered, it stays as the question of the answer below until a new one is asked
                                disabled={running || answeredQuestion}
                                onChange={e => setQuestion(e.target.value)}
                                onKeyDown={e => {
                                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !answeredQuestion) recall();
                                }}
                            />
                            <div className={Styles.actions}>
                                {answeredQuestion ? (
                                    <Button variant="primary" data-testid={TestIds.recall.newQuestion} onClick={askNewQuestion}>
                                        {txt('recall.newQuestion')}
                                    </Button>
                                ) : (
                                    <Button
                                        variant="primary"
                                        data-testid={TestIds.recall.start}
                                        disabled={running || !question.trim() || offline}
                                        onClick={recall}
                                    >
                                        {txt('recall.start')}
                                    </Button>
                                )}
                                {running && (
                                    <Text type="caption" data-testid={TestIds.recall.progress}>
                                        {phase === 'preparing' && txt('recall.preparing')}
                                        {phase === 'asking' &&
                                            txt('recall.asking', { done: String(answered), total: String(documents.length) })}
                                        {phase === 'synthesizing' && txt('recall.synthesizing')}
                                    </Text>
                                )}
                            </div>
                            {phase === 'error' && (
                                <Text type="caption" className={Styles.error} role="alert">
                                    {txt('recall.failed')}
                                </Text>
                            )}
                            {skipped > 0 && (
                                <Text type="caption" className={Styles.muted}>
                                    {txt('recall.skipped', { count: String(skipped) })}
                                </Text>
                            )}
                            {phase === 'done' && documents.length === 0 && (
                                <Text type="description">{txt('recall.noPrepared')}</Text>
                            )}
                            <RecallResult synthesis={synthesis} documents={documents} />
                        </div>
                    )}
                    {tab === 'history' && (
                        <div className={Styles.body} data-testid={TestIds.recall.history}>
                            {history.length === 0 && <Text type="description">{txt('recall.noHistory')}</Text>}
                            {!seenEntry && history.length > 0 && (
                                <ul className={Styles.historyList}>
                                    {history.map((entry, index) => (
                                        <li key={`${entry.timestamp}-${index}`}>
                                            <button
                                                type="button"
                                                className={Styles.historyItem}
                                                data-testid={TestIds.recall.historyItem}
                                                onClick={() => setSeen(index)}
                                            >
                                                <Text type="description" className={Styles.historyQuestion}>
                                                    {entry.question}
                                                </Text>
                                                <Text type="caption" className={Styles.muted}>
                                                    {new Date(entry.timestamp).toLocaleString('pt-BR')}
                                                    {' · '}
                                                    {txt('recall.historyDocuments', { count: String(entry.documents.length) })}
                                                </Text>
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                            {seenEntry && (
                                <>
                                    <div>
                                        <Button variant="transparent" onClick={() => setSeen(undefined)}>
                                            ← {txt('recall.backToHistory')}
                                        </Button>
                                    </div>
                                    <Text type="description" className={Styles.historyQuestion}>
                                        {seenEntry.question}
                                    </Text>
                                    <Text type="caption" className={Styles.muted}>
                                        {new Date(seenEntry.timestamp).toLocaleString('pt-BR')}
                                    </Text>
                                    {seenEntry.skipped > 0 && (
                                        <Text type="caption" className={Styles.muted}>
                                            {txt('recall.skipped', { count: String(seenEntry.skipped) })}
                                        </Text>
                                    )}
                                    <RecallResult
                                        synthesis={seenEntry.synthesis}
                                        documents={seenEntry.documents}
                                    />
                                </>
                            )}
                        </div>
                    )}
                </div>
            </AdaptiveDialog>
        </>
    );
}
