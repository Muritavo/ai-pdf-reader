import { useState } from 'react';
import useShortIntl from '@onepercentio/one-ui/hooks/useShortIntl';
import { Brain } from 'lucide-react';
import { useAI } from '../../context/AIContext';
import { TestIds } from '../../testids';
import AIStatusDialog from './AIStatusDialog';
import Styles from './AIStatus.module.css';

export default function AIStatus() {
    const { txt } = useShortIntl();
    const { status, checking } = useAI();
    const [open, setOpen] = useState(false);

    return (
        <>
            <button
                type="button"
                data-testid={TestIds.ai.statusButton}
                data-status={status}
                data-checking={checking}
                className={`${Styles.trigger} ${checking ? Styles.checking : status === 'online' ? Styles.online : Styles.offline}`}
                title={checking ? txt('aiStatus.checking') : txt(`aiStatus.${status}`)}
                aria-label={txt('aiStatus.title')}
                onClick={() => setOpen(true)}
            >
                <Brain size={22} strokeWidth={1.75} />
            </button>
            <AIStatusDialog open={open} onClose={() => setOpen(false)} />
        </>
    );
}
