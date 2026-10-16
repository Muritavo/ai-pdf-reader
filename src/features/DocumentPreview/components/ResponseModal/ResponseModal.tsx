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
};

export default function ResponseModal({ prompt, answer, onClose }: ResponseModalProps) {
    const { txt } = useShortIntl();

    return (
        <div className={Styles.modalOverlay} onClick={onClose} data-testid={TestIds.ai.responseModal}>
            <div className={Styles.modalContent} onClick={e => e.stopPropagation()}>
                <div className={Styles.modalHeader}>
                    <Text type="subtitle">{txt('documentPreview.responseModal.title')}</Text>
                    <Button variant="transparent" onClick={onClose}>
                        ✕
                    </Button>
                </div>

                <div className={Styles.promptSection}>
                    <Text type="caption" className={Styles.sectionLabel}>
                        {txt('documentPreview.responseModal.prompt')}
                    </Text>
                    <Text type="description" className={Styles.promptText}>
                        {prompt}
                    </Text>
                </div>

                <div className={Styles.answerSection}>
                    <Text type="caption" className={Styles.sectionLabel}>
                        {txt('documentPreview.responseModal.answer')}
                    </Text>
                    <div className={Styles.answerContent}>
                        <Markdown className={Styles.answerText} data-testid={TestIds.ai.responseModalAnswer}>
                            {answer}
                        </Markdown>
                    </div>
                </div>
            </div>
        </div>
    );
}
