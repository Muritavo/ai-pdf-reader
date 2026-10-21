import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import useShortIntl from '@onepercentio/one-ui/hooks/useShortIntl';
import Dots from '@onepercentio/one-ui/components/LoaderDotsIndicator';
import { Send, X } from 'lucide-react';
import { TestIds } from '../../../../testids';
import Styles from './ImageQuestion.module.scss';

type ImageQuestionProps = {
    /** Where it is shown: centered across the image, with its bottom on the bottom of the image */
    style: CSSProperties;
    onSend: (question: string) => Promise<void>;
    onClose: () => void;
    /** Asking needs the AI ready for the document */
    aiReady: boolean;
};

/** The space kept between the field and the edges of what is seen of the document */
const MARGIN = 8;

/** A question about an image of the document, written right over it */
export default function ImageQuestion({ style, onSend, onClose, aiReady }: ImageQuestionProps) {
    const { txt } = useShortIntl();
    const [question, setQuestion] = useState('');
    const [sending, setSending] = useState(false);
    const [failed, setFailed] = useState(false);
    const field = useRef<HTMLTextAreaElement>(null);
    const box = useRef<HTMLDivElement>(null);
    // How far it is moved from the point it is centered on, to be all inside what is seen of the document
    const [shift, setShift] = useState({ x: 0, y: 0 });

    // An image at the edge of the page (or of what is seen of it) would leave part of the field out, cut
    useLayoutEffect(() => {
        const element = box.current;
        const visible = element?.closest(`[data-testid="${TestIds.preview.box}"]`)?.getBoundingClientRect();
        if (!element || !visible) return;
        const own = element.getBoundingClientRect();
        const inside = (start: number, end: number, from: number, to: number) =>
            start < from ? from - start : end > to ? to - end : 0;
        setShift({
            x: inside(own.left, own.right, visible.left + MARGIN, visible.right - MARGIN),
            y: inside(own.top, own.bottom, visible.top + MARGIN, visible.bottom - MARGIN),
        });
    }, []);

    useEffect(() => {
        // Without scrolling, as the field was just moved to be on the screen
        field.current?.focus({ preventScroll: true });
    }, []);

    // Esc closes it even without the field focused, as when it is locked until the AI is ready
    useEffect(() => {
        const closeOnEscape = (e: globalThis.KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', closeOnEscape);
        return () => document.removeEventListener('keydown', closeOnEscape);
    }, [onClose]);

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
            // Only this closes, without also clearing the question of the prompt bar
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
            ref={box}
            className={Styles.box}
            style={{ ...style, transform: `translate(calc(-50% + ${shift.x}px), calc(-100% - ${MARGIN}px + ${shift.y}px))` }}
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
