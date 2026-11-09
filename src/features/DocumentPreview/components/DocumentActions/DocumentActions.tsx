import { useState, type ReactElement } from 'react';
import useShortIntl from '@onepercentio/one-ui/hooks/useShortIntl';
import Dots from '@onepercentio/one-ui/components/LoaderDotsIndicator';
import { Workflow } from 'lucide-react';
import type { FullText } from '../../../../models/Article';
import { askContext } from '../../../../services/ai';
import { useWarmUp } from '../../../../context/AIContext';
import { unwrapMarkdownFence } from '../../../../utils/markdownFence';
import ResponseModal from '../ResponseModal/ResponseModal';
import Attachments from '../Attachments';
import { TestIds } from '../../../../testids';
import Styles from './DocumentActions.module.scss';

type DocumentAction = {
    id: string;
    icon: ReactElement;
    /** The key of its texts: `label` (the button and the title of the result), and `description` */
    textsKey: string;
    prompt: string;
};

/** What can be asked about the whole document at once. Answers are cached, so asking again is instant */
const DOCUMENT_ACTIONS: DocumentAction[] = [
    {
        id: 'method-flowchart',
        icon: <Workflow size={18} strokeWidth={1.75} />,
        textsKey: 'documentActions.methodFlowchart',
        prompt: `Could you build a "flowchart LR" using mermaid.js syntax wrapped in "\`\`\`mermaid" to detail the proteomics/metabolomics method, from sample to data aquisition? Wrap the steps into packages like "instrument preparation" "sample preparation" "sample analysis" "bioinformatics". Also use arrow comments whenever the step A => step B details time.`,
    },
];

type DocumentActionsProps = {
    fullText: FullText;
    /** The actions need the AI ready for the document */
    aiReady: boolean;
};

/** A balloon at the top left of the document, with the actions about it as a whole */
export default function DocumentActions({ fullText, aiReady }: DocumentActionsProps) {
    const { txt } = useShortIntl();
    const { prepare } = useWarmUp(fullText);
    const [running, setRunning] = useState<string>();
    const [failed, setFailed] = useState<string>();
    const [result, setResult] = useState<{ action: DocumentAction; answer: string }>();

    const run = async (action: DocumentAction) => {
        setRunning(action.id);
        setFailed(undefined);
        try {
            const answer = await askContext(action.prompt, await prepare());
            setResult({ action, answer: unwrapMarkdownFence(answer) });
        } catch {
            setFailed(action.id);
        } finally {
            setRunning(undefined);
        }
    };

    return (
        <>
            <div className={Styles.balloon} data-testid={TestIds.documentActions.balloon}>
                {DOCUMENT_ACTIONS.map(action => (
                    <button
                        key={action.id}
                        type="button"
                        className={`${Styles.action} ${failed === action.id ? Styles.failed : ''}`}
                        data-testid={TestIds.documentActions.action}
                        data-action={action.id}
                        disabled={!aiReady || running !== undefined}
                        title={
                            !aiReady
                                ? txt('aiWarmUp.locked')
                                : failed === action.id
                                  ? txt('documentActions.failed')
                                  : txt(`${action.textsKey}.label`)
                        }
                        aria-label={txt(`${action.textsKey}.label`)}
                        onClick={() => run(action)}
                    >
                        {running === action.id ? <Dots dotsCount={3} lockSize /> : action.icon}
                    </button>
                ))}
                <Attachments fullText={fullText} />
            </div>
            {result && (
                <ResponseModal
                    prompt={txt(`${result.action.textsKey}.description`)}
                    answer={result.answer}
                    onClose={() => setResult(undefined)}
                    labels={{
                        title: txt(`${result.action.textsKey}.label`),
                        prompt: txt('documentActions.request'),
                        answer: txt('documentActions.result'),
                    }}
                    testIds={{ modal: TestIds.documentActions.modal, answer: TestIds.documentActions.answer }}
                />
            )}
        </>
    );
}
