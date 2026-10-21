import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import useShortIntl from '@onepercentio/one-ui/hooks/useShortIntl';
import Dots from '@onepercentio/one-ui/components/LoaderDotsIndicator';
import { Send, X } from 'lucide-react';
import { TestIds } from '../../../../testids';
import Styles from './ImageQuestion.module.scss';

type ImageQuestionProps = {
    /** Where it is shown, centered on the image */
    style: CSSProperties;
    onSend: (question: string) => Promise<void>;
    onClose: () => void;
    /** Asking needs the AI ready for the document */
    aiReady: boolean;
};

/** A question about an image of the document, written right over it */
export default function ImageQuestion({ style, onSend, onClose, aiReady }: ImageQuestionProps) {
    const { txt } = useShortIntl();
    const [question, setQuestion] = useState('');
    const [sending, setSending] = useState(false);
    const [failed, setFailed] = useState(false);
    const field = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        field.current?.focus();
    }, []);

    const send = async () => {
        if (!question.trim() || sending || !aiReady) return;
        setSending(true);
        setFailed(false);
        try {
            await onSend(question.trim());
        } catch {
            setFailed(true);
        } finally {
            setSending(false);
        }
    };

    // Enter sends, Shift+Enter breaks the line, and Esc leaves, as on the prompt
    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
        } else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
        }
    };

    return (
        // Clicks here stay here: they don't open the menu or move the last click marker
        <div
            className={Styles.box}
            style={style}
            data-testid={TestIds.preview.imageQuestion}
            onClick={e => e.stopPropagation()}
            onMouseUp={e => e.stopPropagation()}
        >
            <div className={Styles.row}>
                <textarea
                    ref={field}
                    rows={2}
                    className={Styles.field}
                    data-testid={TestIds.preview.imageQuestionInput}
                    value={question}
                    disabled={!aiReady || sending}
                    placeholder={aiReady ? txt('imageQuestion.placeholder') : txt('aiWarmUp.locked')}
                    onChange={e => setQuestion(e.target.value)}
                    onKeyDown={handleKeyDown}
                />
                <div className={Styles.buttons}>
                    <button
                        type="button"
                        className={Styles.send}
                        data-testid={TestIds.preview.imageQuestionSend}
                        disabled={!aiReady || sending || !question.trim()}
                        title={txt('imageQuestion.send')}
                        aria-label={txt('imageQuestion.send')}
                        onClick={send}
                    >
                        {sending ? <Dots dotsCount={3} lockSize /> : <Send size={15} strokeWidth={1.75} />}
                    </button>
                    <button type="button" className={Styles.close} title={txt('imageQuestion.close')} aria-label={txt('imageQuestion.close')} onClick={onClose}>
                        <X size={14} strokeWidth={1.75} />
                    </button>
                </div>
            </div>
            {failed && <p className={Styles.error}>{txt('imageQuestion.failed')}</p>}
        </div>
    );
}
