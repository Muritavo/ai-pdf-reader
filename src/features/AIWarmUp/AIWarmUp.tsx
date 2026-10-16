import useShortIntl from '@onepercentio/one-ui/hooks/useShortIntl';
import { Brain, Check, X } from 'lucide-react';
import type { FullText } from '../../models/Article';
import { useWarmUp } from '../../context/AIContext';
import Styles from './AIWarmUp.module.css';

const RADIUS = 20;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export default function AIWarmUp({ fullText }: { fullText: FullText }) {
    const { txt } = useShortIntl();
    const { status, state, progress, ready, start } = useWarmUp(fullText);

    const offline = status === 'offline';
    const running = !offline && state === 'running';
    const canStart = !offline && (state === 'idle' || state === 'error');
    const label = offline
        ? txt('aiWarmUp.offline')
        : running
          ? txt('aiWarmUp.running', { progress: String(Math.round(progress * 100)) })
          : ready
            ? txt('aiWarmUp.ready')
            : state === 'error'
              ? txt('aiWarmUp.error')
              : txt('aiWarmUp.idle');

    return (
        <button
            type="button"
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
            {ready && <Check className={`${Styles.badge} ${Styles.badgeReady}`} size={14} strokeWidth={3} />}
        </button>
    );
}
