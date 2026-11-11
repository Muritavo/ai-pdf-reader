import { useState } from 'react';
import AdaptiveDialog from '@onepercentio/one-ui/components/AdaptiveDialog';
import Button from '@onepercentio/one-ui/components/Button';
import Text from '@onepercentio/one-ui/components/Text';
import Dots from '@onepercentio/one-ui/components/LoaderDotsIndicator';
import useShortIntl from '@onepercentio/one-ui/hooks/useShortIntl';
import { Brain } from 'lucide-react';
import { useAI } from '../../context/AIContext';
import { TestIds } from '../../testids';
import AIIntegrationWizard from '../AIIntegrationWizard';
import Styles from './AIStatus.module.css';

export default function AIStatus() {
    const { txt } = useShortIntl();
    const { status, provider, providers, selectProvider, selectDefaultModel, model, checking, reconnect } = useAI();
    const [open, setOpen] = useState(false);
    // Adding a provider shows the wizard in place of the status
    const [adding, setAdding] = useState(false);
    const close = () => {
        setOpen(false);
        setAdding(false);
    };

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
            <AdaptiveDialog open={open} onClose={close} onClickOut={close}>
                {adding ? (
                    <AIIntegrationWizard onDone={() => setAdding(false)} />
                ) : (
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
                                <Text type="caption">{txt('aiStatus.providerLabel')}</Text>
                            </dt>
                            <dd>
                                {provider ? (
                                    <select
                                        className={Styles.select}
                                        data-testid={TestIds.ai.provider}
                                        value={provider.endpoint}
                                        onChange={e => selectProvider(e.target.value)}
                                        aria-label={txt('aiStatus.providerLabel')}
                                    >
                                        {providers.map(option => (
                                            <option key={option.endpoint} value={option.endpoint}>
                                                {option.endpoint}
                                            </option>
                                        ))}
                                    </select>
                                ) : (
                                    <Text type="caption" data-testid={TestIds.ai.noProviders}>
                                        {txt('aiStatus.noProviders')}
                                    </Text>
                                )}
                            </dd>
                            {provider && (
                                <>
                                    <dt>
                                        <Text type="caption">{txt('aiStatus.defaultModelLabel')}</Text>
                                    </dt>
                                    <dd>
                                        <select
                                            className={Styles.select}
                                            data-testid={TestIds.ai.defaultModel}
                                            value={provider.defaultModel ?? ''}
                                            onChange={e => selectDefaultModel(e.target.value || null)}
                                            aria-label={txt('aiStatus.defaultModelLabel')}
                                        >
                                            {provider.models === null ? (
                                                <option value="">{txt('aiStatus.autoModel')}</option>
                                            ) : (
                                                provider.models.map(option => (
                                                    <option key={option} value={option}>
                                                        {option}
                                                    </option>
                                                ))
                                            )}
                                        </select>
                                    </dd>
                                </>
                            )}
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
                        {status === 'offline' && providers.length > 0 && (
                            <Button variant="primary" onClick={reconnect} disabled={checking} data-testid={TestIds.ai.reconnect}>
                                {txt('aiStatus.reconnect')}
                            </Button>
                        )}
                        <Button variant="outline" onClick={() => setAdding(true)} data-testid={TestIds.ai.addProvider}>
                            {txt('aiStatus.addProvider')}
                        </Button>
                    </div>
                )}
            </AdaptiveDialog>
        </>
    );
}
