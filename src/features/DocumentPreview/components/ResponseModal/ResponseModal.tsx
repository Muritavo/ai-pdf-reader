import Text from '@onepercentio/one-ui/components/Text';
import Button from '@onepercentio/one-ui/components/Button';
import useShortIntl from '@onepercentio/one-ui/hooks/useShortIntl';
import Markdown from '../../../../components/Markdown';
import { TestIds } from '../../../../testids';
import Styles from './ResponseModal.module.scss';

type ResponseModalProps = {
    prompt: string;
    answer: string;
    onClose: () => void;
    /** The texts of the window, when it shows something else than an answer to a question */
    labels?: { title: string; prompt: string; answer: string };
    testIds?: { modal: string; answer: string };
};

export default function ResponseModal({ prompt, answer, onClose, labels, testIds }: ResponseModalProps) {
    const { txt } = useShortIntl();

    return (
        <div className={Styles.modalOverlay} onClick={onClose} data-testid={testIds?.modal ?? TestIds.ai.responseModal}>
            <div className={Styles.modalContent} onClick={e => e.stopPropagation()}>
                <div className={Styles.modalHeader}>
                    <Text type="subtitle">{labels?.title ?? txt('documentPreview.responseModal.title')}</Text>
                    <Button variant="transparent" onClick={onClose} aria-label={txt('documentPreview.responseModal.close')}>
                        ✕
                    </Button>
                </div>

                <div className={Styles.promptSection}>
                    <Text type="caption" className={Styles.sectionLabel}>
                        {labels?.prompt ?? txt('documentPreview.responseModal.prompt')}
                    </Text>
                    <Text type="description" className={Styles.promptText}>
                        {prompt}
                    </Text>
                </div>

                <div className={Styles.answerSection}>
                    <Text type="caption" className={Styles.sectionLabel}>
                        {labels?.answer ?? txt('documentPreview.responseModal.answer')}
                    </Text>
                    <div className={Styles.answerContent}>
                        <Markdown className={Styles.answerText} data-testid={testIds?.answer ?? TestIds.ai.responseModalAnswer}>
                            {answer}
                        </Markdown>
                    </div>
                </div>
            </div>
        </div>
    );
}
