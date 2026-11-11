import { useState } from 'react';
import Button from '@onepercentio/one-ui/components/Button';
import Input from '@onepercentio/one-ui/components/Input';
import Text from '@onepercentio/one-ui/components/Text';
import Dots from '@onepercentio/one-ui/components/LoaderDotsIndicator';
import useShortIntl from '@onepercentio/one-ui/hooks/useShortIntl';
import { TestIds } from '../../../../testids';
import { probeProvider } from '../../discovery';
import Styles from '../../AIIntegrationWizard.module.scss';

/** For a provider that answered asking for authorization: the API key, checked against it */
export default function ApiKey({ endpoint, onValid }: { endpoint: string; onValid: (apiKey: string) => void }) {
    const { txt } = useShortIntl();
    const [apiKey, setApiKey] = useState('');
    const [checking, setChecking] = useState(false);
    const [invalid, setInvalid] = useState(false);

    const check = async () => {
        const key = apiKey.trim();
        setChecking(true);
        setInvalid(false);
        const result = await probeProvider(endpoint, { apiKey: key });
        setChecking(false);
        if (result === 'available') onValid(key);
        else setInvalid(true);
    };

    return (
        <form
            className={Styles.step}
            onSubmit={e => {
                e.preventDefault();
                check();
            }}
        >
            <Text type="description">{txt('aiWizard.apiKeyTitle', { endpoint })}</Text>
            <div className={Styles.row}>
                <Input
                    className={Styles.input}
                    type="password"
                    placeholder={txt('aiWizard.apiKey')}
                    value={apiKey}
                    onChange={e => {
                        setApiKey(e.target.value);
                        setInvalid(false);
                    }}
                    data-testid={TestIds.aiWizard.apiKeyInput}
                />
                <Button type="submit" variant="primary" disabled={!apiKey.trim() || checking} data-testid={TestIds.aiWizard.apiKeyCheck}>
                    {checking ? <Dots dotsCount={3} lockSize /> : txt('aiWizard.check')}
                </Button>
            </div>
            {invalid && (
                <Text type="caption" className={Styles.error} data-testid={TestIds.aiWizard.apiKeyError}>
                    {txt('aiWizard.apiKeyInvalid')}
                </Text>
            )}
        </form>
    );
}
