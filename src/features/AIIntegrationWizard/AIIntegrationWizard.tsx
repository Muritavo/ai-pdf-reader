import { useState } from 'react';
import AdaptiveContainer from '@onepercentio/one-ui/components/AdaptiveContainer';
import Text from '@onepercentio/one-ui/components/Text';
import useShortIntl from '@onepercentio/one-ui/hooks/useShortIntl';
import { ArrowLeft } from 'lucide-react';
import { useAI } from '../../context/AIContext';
import type { AIProviderKind } from '../../utils/aiProviders';
import { TestIds } from '../../testids';
import { LOCALHOST, type ProbeResult } from './discovery';
import ProviderChoice from './components/ProviderChoice';
import ScanPort from './components/ScanPort';
import NetworkDevices from './components/NetworkDevices';
import RemoteProvider from './components/RemoteProvider';
import ApiKey from './components/ApiKey';
import ModelDefinition from './components/ModelDefinition';
import Styles from './AIIntegrationWizard.module.scss';

type Step =
    | { name: 'provider' }
    | { name: 'scan'; kind: Exclude<AIProviderKind, 'remote'>; host: string }
    | { name: 'devices' }
    | { name: 'remote' }
    | { name: 'apiKey'; kind: AIProviderKind; endpoint: string }
    | { name: 'models'; kind: AIProviderKind; endpoint: string; apiKey?: string };

/** Configures a new AI provider, step by step, adding it once its models are defined */
export default function AIIntegrationWizard({ onDone }: { onDone?: () => void }) {
    const { txt } = useShortIntl();
    const { addProvider } = useAI();
    // The steps passed through, so going back returns to the one before
    const [steps, setSteps] = useState<Step[]>([{ name: 'provider' }]);
    const step = steps[steps.length - 1];
    const go = (next: Step) => setSteps(prev => [...prev, next]);

    /** A server answered: it asks for the API key first, when it needs one */
    const found = (kind: AIProviderKind) => (endpoint: string, result: Exclude<ProbeResult, 'absent'>) =>
        go(result === 'unauthorized' ? { name: 'apiKey', kind, endpoint } : { name: 'models', kind, endpoint });

    return (
        <div className={Styles.wizard} data-testid={TestIds.aiWizard.root} data-step={step.name}>
            <div className={Styles.header}>
                {/* The back button slides in from the second step on, pushing the title */}
                <AdaptiveContainer direction="h">
                    {steps.length > 1 ? (
                        <button
                            key="back"
                            type="button"
                            className={Styles.back}
                            aria-label={txt('aiWizard.back')}
                            title={txt('aiWizard.back')}
                            data-testid={TestIds.aiWizard.back}
                            onClick={() => setSteps(prev => prev.slice(0, -1))}
                        >
                            <ArrowLeft size={20} />
                        </button>
                    ) : (
                        <span key="none" />
                    )}
                </AdaptiveContainer>
                <Text type="subtitle">{txt('aiWizard.title')}</Text>
            </div>
            {step.name === 'provider' && (
                <ProviderChoice
                    onChoose={kind =>
                        go(kind === 'local' ? { name: 'scan', kind, host: LOCALHOST } : kind === 'network' ? { name: 'devices' } : { name: 'remote' })
                    }
                />
            )}
            {step.name === 'scan' && <ScanPort key={step.host} forIp={step.host} onFound={found(step.kind)} />}
            {step.name === 'devices' && <NetworkDevices onSelect={ip => go({ name: 'scan', kind: 'network', host: ip })} />}
            {step.name === 'remote' && <RemoteProvider onFound={(endpoint, apiKey) => go({ name: 'models', kind: 'remote', endpoint, apiKey })} />}
            {step.name === 'apiKey' && (
                <ApiKey endpoint={step.endpoint} onValid={apiKey => go({ name: 'models', kind: step.kind, endpoint: step.endpoint, apiKey })} />
            )}
            {step.name === 'models' && (
                <ModelDefinition
                    endpoint={step.endpoint}
                    apiKey={step.apiKey}
                    onDone={models => {
                        addProvider({
                            kind: step.kind,
                            endpoint: step.endpoint,
                            ...(step.apiKey ? { apiKey: step.apiKey } : {}),
                            models,
                            defaultModel: models?.[0] ?? null,
                        });
                        onDone?.();
                    }}
                />
            )}
        </div>
    );
}
