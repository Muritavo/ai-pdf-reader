import useShortIntl from '@onepercentio/one-ui/hooks/useShortIntl';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Brain, Bug, Check, Ellipsis, Play, ScanEye, X } from 'lucide-react';
import type { FullText } from '../../models/Article';
import { useWarmUp } from '../../context/AIContext';
import { validateAgainstPages } from '../../services/ai';
import { extractPageTexts, getNormalizedText, renderPageImages } from '../../utils/preprocessing';
import { unwrapMarkdownFence } from '../../utils/markdownFence';
import AdaptiveDialog from '@onepercentio/one-ui/components/AdaptiveDialog';
import ResponseModal from '../DocumentPreview/components/ResponseModal/ResponseModal';
import AIIntegrationWizard from '../AIIntegrationWizard';
import { TestIds } from '../../testids';
import Styles from './AIWarmUp.module.css';

const RADIUS = 20;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export default function AIWarmUp({ fullText }: { fullText: FullText }) {
    const { txt } = useShortIntl();
    const { status, checking, state, progress, generatedWords, ready, start } = useWarmUp(fullText);
    const [holdingCtrl, setHoldingCtrl] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [validating, setValidating] = useState(false);
    const [validationFailed, setValidationFailed] = useState(false);
    const [validation, setValidation] = useState<string>();
    // What a DEBUG item of the menu shows, with its label as the title
    const [debugView, setDebugView] = useState<{ label: string; text: string }>();
    // While the AI is offline, the button opens its configuration instead
    const [configuring, setConfiguring] = useState(false);
    const wrapperRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const follow = (e: KeyboardEvent) => setHoldingCtrl(e.ctrlKey);
        // Released out of the window, as by changing to another one, it would stay held
        const release = () => setHoldingCtrl(false);
        window.addEventListener('keydown', follow);
        window.addEventListener('keyup', follow);
        window.addEventListener('blur', release);
        return () => {
            window.removeEventListener('keydown', follow);
            window.removeEventListener('keyup', follow);
            window.removeEventListener('blur', release);
        };
    }, []);

    // Closed by a click anywhere else, or by Escape
    useEffect(() => {
        if (!menuOpen) return;
        const closeOutside = (e: PointerEvent) => {
            if (!wrapperRef.current?.contains(e.target as Node)) setMenuOpen(false);
        };
        const closeOnEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setMenuOpen(false);
        };
        window.addEventListener('pointerdown', closeOutside);
        window.addEventListener('keydown', closeOnEscape);
        return () => {
            window.removeEventListener('pointerdown', closeOutside);
            window.removeEventListener('keydown', closeOnEscape);
        };
    }, [menuOpen]);

    /** Asks the AI to compare the prepared text with the image of each page (experimental) */
    const validateVisually = async () => {
        setMenuOpen(false);
        setValidating(true);
        setValidationFailed(false);
        try {
            const [context, pageImages] = await Promise.all([getNormalizedText(fullText), renderPageImages(fullText)]);
            setValidation(unwrapMarkdownFence(await validateAgainstPages(context, ...pageImages)));
        } catch {
            setValidationFailed(true);
        } finally {
            setValidating(false);
        }
    };

    // While the server is being verified, it is not known to be offline yet
    const offline = status === 'offline' && !checking;
    const running = !offline && !checking && state === 'running';
    const canStart = !offline && !checking && (state === 'idle' || state === 'error');
    // Holding Ctrl, a prepared document shows its options, as validating it against its pages
    const showingOptions = holdingCtrl && state === 'done' && !validating;
    const generated =
        running && generatedWords !== undefined
            ? txt('aiWarmUp.generatedWords', { count: generatedWords.toLocaleString('pt-BR') })
            : undefined;
    const label = validating
        ? txt('aiWarmUp.validating')
        : showingOptions
        ? txt('aiWarmUp.options')
        : checking
        ? txt('aiWarmUp.checking')
        : offline
        ? txt('aiWarmUp.offline')
        : running
          ? [txt('aiWarmUp.running', { progress: String(Math.round(progress * 100)) }), generated].filter(Boolean).join(' · ')
          : ready
            ? validationFailed
              ? txt('aiWarmUp.validationFailed')
              : txt('aiWarmUp.ready')
            : state === 'error'
              ? txt('aiWarmUp.error')
              : txt('aiWarmUp.idle');

    return (
        <div ref={wrapperRef} className={Styles.wrapper}>
            <button
                type="button"
                data-testid={TestIds.ai.warmUp}
                data-state={validating ? 'validating' : showingOptions ? 'options' : checking ? 'checking' : offline ? 'offline' : ready ? 'ready' : state}
                className={`${Styles.container} ${ready && !showingOptions && !validationFailed ? Styles.ready : ''} ${offline || state === 'error' || (ready && validationFailed) ? Styles.failed : ''} ${validating ? Styles.validating : ''}`}
                title={label}
                aria-label={label}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                disabled={!canStart && !showingOptions && !offline}
                onClick={offline ? () => setConfiguring(true) : showingOptions ? () => setMenuOpen(true) : start}
                // On macOS a Ctrl click is a right click, so it comes as the context menu instead
                onContextMenu={e => {
                    if (!showingOptions) return;
                    e.preventDefault();
                    setMenuOpen(true);
                }}
            >
                <svg className={Styles.ring} viewBox="0 0 48 48" aria-hidden>
                    <circle className={Styles.track} cx="24" cy="24" r={RADIUS} />
                    {running && (
                        <circle
                            className={Styles.progress}
                            cx="24"
                            cy="24"
                            r={RADIUS}
                            strokeDasharray={`${CIRCUMFERENCE * progress} ${CIRCUMFERENCE}`}
                            style={{ '--progress': progress } as CSSProperties}
                        />
                    )}
                </svg>
                {showingOptions ? (
                    <Ellipsis className={Styles.brain} size={20} strokeWidth={1.75} />
                ) : (
                    <Brain className={Styles.brain} size={20} strokeWidth={1.75} />
                )}
                {offline && <X className={`${Styles.badge} ${Styles.badgeFailed}`} size={14} strokeWidth={3} />}
                {canStart && <Play className={`${Styles.badge} ${Styles.badgePlay}`} size={14} strokeWidth={0} fill="currentColor" />}
                {ready && !showingOptions && !validationFailed && <Check className={`${Styles.badge} ${Styles.badgeReady}`} size={14} strokeWidth={3} />}
            </button>
            {generated && <span className={Styles.generated} data-testid={TestIds.ai.generatedWords}>{generated}</span>}
            {menuOpen && (
                <div className={Styles.menu} role="menu" data-testid={TestIds.ai.warmUpMenu}>
                    <button
                        type="button"
                        role="menuitem"
                        className={Styles.menuItem}
                        data-testid={TestIds.ai.warmUpValidate}
                        disabled={!ready}
                        onClick={validateVisually}
                    >
                        <ScanEye size={16} strokeWidth={1.75} aria-hidden />
                        {txt('aiWarmUp.validateVisually')}
                    </button>
                    <button
                        type="button"
                        role="menuitem"
                        className={Styles.menuItem}
                        data-testid={TestIds.ai.warmUpShowExtracted}
                        onClick={async () => {
                            setMenuOpen(false);
                            setDebugView({ label: txt('aiWarmUp.showExtracted'), text: await getNormalizedText(fullText) });
                        }}
                    >
                        <Bug size={16} strokeWidth={1.75} aria-hidden />
                        {txt('aiWarmUp.showExtracted')}
                    </button>
                    <button
                        type="button"
                        role="menuitem"
                        className={Styles.menuItem}
                        data-testid={TestIds.ai.warmUpShowUnstructured}
                        onClick={async () => {
                            setMenuOpen(false);
                            const bytes = await (await fetch(fullText.url)).arrayBuffer();
                            // As sent to be organized, in a code block so its line breaks are kept
                            const text = (await extractPageTexts(bytes)).join(' ');
                            setDebugView({ label: txt('aiWarmUp.showUnstructured'), text: `~~~~text\n${text}\n~~~~` });
                        }}
                    >
                        <Bug size={16} strokeWidth={1.75} aria-hidden />
                        {txt('aiWarmUp.showUnstructured')}
                    </button>
                </div>
            )}
            <AdaptiveDialog open={configuring} onClose={() => setConfiguring(false)} onClickOut={() => setConfiguring(false)}>
                {configuring && <AIIntegrationWizard onDone={() => setConfiguring(false)} />}
            </AdaptiveDialog>
            {debugView && (
                <ResponseModal
                    prompt={debugView.label}
                    answer={debugView.text}
                    onClose={() => setDebugView(undefined)}
                    labels={{
                        title: debugView.label,
                        prompt: txt('documentActions.request'),
                        answer: txt('documentActions.result'),
                    }}
                    testIds={{ modal: TestIds.ai.debugModal, answer: TestIds.ai.debugAnswer }}
                />
            )}
            {validation && (
                <ResponseModal
                    prompt={txt('aiWarmUp.validationRequest')}
                    answer={validation}
                    onClose={() => setValidation(undefined)}
                    labels={{
                        title: txt('aiWarmUp.validationTitle'),
                        prompt: txt('documentActions.request'),
                        answer: txt('documentActions.result'),
                    }}
                    testIds={{ modal: TestIds.ai.validationModal, answer: TestIds.ai.validationAnswer }}
                />
            )}
        </div>
    );
}
