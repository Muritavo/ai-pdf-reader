import { useState } from 'react';
import Button from '@onepercentio/one-ui/components/Button';
import Input from '@onepercentio/one-ui/components/Input';
import Text from '@onepercentio/one-ui/components/Text';
import Dots from '@onepercentio/one-ui/components/LoaderDotsIndicator';
import useShortIntl from '@onepercentio/one-ui/hooks/useShortIntl';
import { isValidEndpoint, normalizeEndpoint } from '../../../../utils/aiProviders';
import { TestIds } from '../../../../testids';
import { probeProvider } from '../../discovery';
import Styles from '../../AIIntegrationWizard.module.scss';

/** A generic OpenAI compatible server: its host and API key, checked before going on */
export default function RemoteProvider({ onFound }: { onFound: (endpoint: string, apiKey?: string) => void }) {
    const { txt } = useShortIntl();
    const [host, setHost] = useState('');
    const [apiKey, setApiKey] = useState('');
    const [checking, setChecking] = useState(false);
    const [error, setError] = useState<string>();

    const check = async () => {
        const endpoint = normalizeEndpoint(host);
        if (!isValidEndpoint(endpoint)) return setError(txt('aiWizard.remoteInvalidHost'));
        setChecking(true);
        setError(undefined);
        const key = apiKey.trim() || undefined;
        const result = await probeProvider(endpoint, { apiKey: key, timeoutMs: 8000 });
        setChecking(false);
        if (result === 'absent') setError(txt('aiWizard.remoteUnreachable'));
        else if (result === 'unauthorized') setError(txt('aiWizard.apiKeyInvalid'));
        else onFound(endpoint, key);
    };

    return (
        <form
            className={Styles.step}
            onSubmit={e => {
                e.preventDefault();
                check();
            }}
        >
            <Text type="description">{txt('aiWizard.remoteTitle')}</Text>
            <div className={Styles.fields}>
                <Input
                    className={Styles.input}
                    placeholder={txt('aiWizard.remoteHost')}
                    value={host}
                    onChange={e => {
                        setHost(e.target.value);
                        setError(undefined);
                    }}
                    data-testid={TestIds.aiWizard.remoteHost}
                />
                <Input
                    className={Styles.input}
                    type="password"
                    placeholder={txt('aiWizard.apiKey')}
                    value={apiKey}
                    onChange={e => {
                        setApiKey(e.target.value);
                        setError(undefined);
                    }}
                    data-testid={TestIds.aiWizard.remoteApiKey}
                />
            </div>
            {error && (
                <Text type="caption" className={Styles.error} data-testid={TestIds.aiWizard.remoteError}>
                    {error}
                </Text>
            )}
            <Button type="submit" variant="primary" disabled={!host.trim() || checking} data-testid={TestIds.aiWizard.remoteCheck}>
                {checking ? <Dots dotsCount={3} lockSize /> : txt('aiWizard.check')}
            </Button>
        </form>
    );
}
