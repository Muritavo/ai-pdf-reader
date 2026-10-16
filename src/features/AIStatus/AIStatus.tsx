import { useState } from 'react';
import AdaptiveDialog from '@onepercentio/one-ui/components/AdaptiveDialog';
import Button from '@onepercentio/one-ui/components/Button';
import Text from '@onepercentio/one-ui/components/Text';
import Dots from '@onepercentio/one-ui/components/LoaderDotsIndicator';
import useShortIntl from '@onepercentio/one-ui/hooks/useShortIntl';
import { Brain } from 'lucide-react';
import { useAI } from '../../context/AIContext';
import { TestIds } from '../../testids';
import Styles from './AIStatus.module.css';

export default function AIStatus() {
    const { txt } = useShortIntl();
    const { status, endpoint, model, checking, reconnect } = useAI();
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
            <AdaptiveDialog open={open} onClose={() => setOpen(false)} onClickOut={() => setOpen(false)}>
                <div className={Styles.dialog} data-testid={TestIds.ai.statusDialog}>
                    <Text type="subtitle">{txt('aiStatus.title')}</Text>
                    <dl className={Styles.details}>
                        <dt>
                            <Text type="caption">{txt('aiStatus.statusLabel')}</Text>
                        </dt>
                        <dd className={status === 'online' ? Styles.online : Styles.offline} data-testid={TestIds.ai.statusValue}>
                            {checking ? <Dots dotsCount={3} lockSize /> : txt(`aiStatus.${status}`)}
                        </dd>
                        <dt>
                            <Text type="caption">{txt('aiStatus.endpointLabel')}</Text>
                        </dt>
                        <dd>
                            <code data-testid={TestIds.ai.endpoint}>{endpoint}</code>
                        </dd>
                        {model && (
                            <>
                                <dt>
                                    <Text type="caption">{txt('aiStatus.modelLabel')}</Text>
                                </dt>
                                <dd>
                                    <code data-testid={TestIds.ai.model}>{model}</code>
                                </dd>
                            </>
                        )}
                    </dl>
                    {status === 'offline' && (
                        <Button variant="primary" onClick={reconnect} disabled={checking} data-testid={TestIds.ai.reconnect}>
                            {txt('aiStatus.reconnect')}
                        </Button>
                    )}
                </div>
            </AdaptiveDialog>
        </>
    );
}
