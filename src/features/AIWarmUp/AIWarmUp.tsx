import useShortIntl from '@onepercentio/one-ui/hooks/useShortIntl';
import { Brain, Check, Play, X } from 'lucide-react';
import type { FullText } from '../../models/Article';
import { useWarmUp } from '../../context/AIContext';
import { TestIds } from '../../testids';
import Styles from './AIWarmUp.module.css';

const RADIUS = 20;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export default function AIWarmUp({ fullText }: { fullText: FullText }) {
    const { txt } = useShortIntl();
    const { status, state, progress, generatedWords, ready, start } = useWarmUp(fullText);

    const offline = status === 'offline';
    const running = !offline && state === 'running';
    const canStart = !offline && (state === 'idle' || state === 'error');
    const generated =
        running && generatedWords !== undefined
            ? txt('aiWarmUp.generatedWords', { count: generatedWords.toLocaleString('pt-BR') })
            : undefined;
    const label = offline
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
                data-state={offline ? 'offline' : ready ? 'ready' : state}
                className={`${Styles.container} ${ready ? Styles.ready : ''} ${offline || state === 'error' ? Styles.failed : ''}`}
                title={label}
                aria-label={label}
                disabled={!canStart}
                onClick={start}
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
                <Brain className={Styles.brain} size={20} strokeWidth={1.75} />
                {offline && <X className={`${Styles.badge} ${Styles.badgeFailed}`} size={14} strokeWidth={3} />}
                {canStart && <Play className={`${Styles.badge} ${Styles.badgePlay}`} size={14} strokeWidth={0} fill="currentColor" />}
                {ready && <Check className={`${Styles.badge} ${Styles.badgeReady}`} size={14} strokeWidth={3} />}
            </button>
            {generated && <span className={Styles.generated} data-testid={TestIds.ai.generatedWords}>{generated}</span>}
        </div>
    );
}
