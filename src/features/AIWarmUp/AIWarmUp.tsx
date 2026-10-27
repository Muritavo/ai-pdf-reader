import useShortIntl from '@onepercentio/one-ui/hooks/useShortIntl';
import { useEffect, useState } from 'react';
import { Brain, Check, Play, Trash2, X } from 'lucide-react';
import type { FullText } from '../../models/Article';
import { useWarmUp } from '../../context/AIContext';
import { TestIds } from '../../testids';
import Styles from './AIWarmUp.module.css';

const RADIUS = 20;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export default function AIWarmUp({ fullText }: { fullText: FullText }) {
    const { txt } = useShortIntl();
    const { status, checking, state, progress, generatedWords, ready, start, clear } = useWarmUp(fullText);
    const [holdingCtrl, setHoldingCtrl] = useState(false);

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

    // While the server is being verified, it is not known to be offline yet
    const offline = status === 'offline' && !checking;
    const running = !offline && !checking && state === 'running';
    const canStart = !offline && !checking && (state === 'idle' || state === 'error');
    // Holding Ctrl, a prepared document can be discarded, to be prepared again
    const clearing = holdingCtrl && state === 'done';
    const generated =
        running && generatedWords !== undefined
            ? txt('aiWarmUp.generatedWords', { count: generatedWords.toLocaleString('pt-BR') })
            : undefined;
    const label = clearing
        ? txt('aiWarmUp.clear')
        : checking
        ? txt('aiWarmUp.checking')
        : offline
        ? txt('aiWarmUp.offline')
        : running
          ? [txt('aiWarmUp.running', { progress: String(Math.round(progress * 100)) }), generated].filter(Boolean).join(' · ')
          : ready
            ? txt('aiWarmUp.ready')
            : state === 'error'
              ? txt('aiWarmUp.error')
              : txt('aiWarmUp.idle');

    return (
        <div className={Styles.wrapper}>
            <button
                type="button"
                data-testid={TestIds.ai.warmUp}
                data-state={clearing ? 'clearing' : checking ? 'checking' : offline ? 'offline' : ready ? 'ready' : state}
                className={`${Styles.container} ${ready && !clearing ? Styles.ready : ''} ${clearing || offline || state === 'error' ? Styles.failed : ''}`}
                title={label}
                aria-label={label}
                disabled={!canStart && !clearing}
                onClick={clearing ? clear : start}
                // On macOS a Ctrl click is a right click, so it comes as the context menu instead
                onContextMenu={e => {
                    if (!clearing) return;
                    e.preventDefault();
                    clear();
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
                        />
                    )}
                </svg>
                {clearing ? (
                    <Trash2 className={Styles.brain} size={20} strokeWidth={1.75} />
                ) : (
                    <Brain className={Styles.brain} size={20} strokeWidth={1.75} />
                )}
                {offline && <X className={`${Styles.badge} ${Styles.badgeFailed}`} size={14} strokeWidth={3} />}
                {canStart && <Play className={`${Styles.badge} ${Styles.badgePlay}`} size={14} strokeWidth={0} fill="currentColor" />}
                {ready && !clearing && <Check className={`${Styles.badge} ${Styles.badgeReady}`} size={14} strokeWidth={3} />}
            </button>
            {generated && <span className={Styles.generated} data-testid={TestIds.ai.generatedWords}>{generated}</span>}
        </div>
    );
}
