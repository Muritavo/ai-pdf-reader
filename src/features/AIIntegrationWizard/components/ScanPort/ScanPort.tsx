import { useCallback, useEffect, useRef, useState } from 'react';
import Button from '@onepercentio/one-ui/components/Button';
import Input from '@onepercentio/one-ui/components/Input';
import Text from '@onepercentio/one-ui/components/Text';
import Dots from '@onepercentio/one-ui/components/LoaderDotsIndicator';
import useShortIntl from '@onepercentio/one-ui/hooks/useShortIntl';
import { KeyRound } from 'lucide-react';
import { TestIds } from '../../../../testids';
import { COMMON_PORTS, LOCALHOST, PORT_PROVIDERS, endpointOf, probeProvider, scanPorts, type DetectedPort, type ProbeResult } from '../../discovery';
import Styles from '../../AIIntegrationWizard.module.scss';

/** Looks for a provider on the common ports of the host, offering to check another port when none answers */
export default function ScanPort({
    forIp,
    onFound,
}: {
    forIp: string;
    onFound: (endpoint: string, result: Exclude<ProbeResult, 'absent'>) => void;
}) {
    const { txt } = useShortIntl();
    const [detected, setDetected] = useState<DetectedPort[]>();
    const [customPort, setCustomPort] = useState('');
    const [checkingPort, setCheckingPort] = useState(false);
    const [portError, setPortError] = useState<string>();
    const scanning = useRef<AbortController>();

    const scan = useCallback(() => {
        scanning.current?.abort();
        const controller = new AbortController();
        scanning.current = controller;
        setDetected(undefined);
        scanPorts(forIp, COMMON_PORTS, controller.signal).then(ports => {
            if (!controller.signal.aborted) setDetected(ports);
        });
    }, [forIp]);

    useEffect(() => {
        scan();
        return () => scanning.current?.abort();
    }, [scan]);

    const checkPort = async () => {
        const port = Number(customPort);
        setCheckingPort(true);
        setPortError(undefined);
        const result = await probeProvider(endpointOf(forIp, port));
        setCheckingPort(false);
        if (result === 'absent') setPortError(txt('aiWizard.customPortError', { port: String(port) }));
        else onFound(endpointOf(forIp, port), result);
    };

    if (!detected)
        return (
            <div className={Styles.step} data-testid={TestIds.aiWizard.scanning}>
                <Text type="description">{txt('aiWizard.scanning', { host: forIp })}</Text>
                <Dots dotsCount={3} />
            </div>
        );

    if (detected.length)
        return (
            <div className={Styles.step}>
                <Text type="description">{txt('aiWizard.detected')}</Text>
                <ul className={Styles.list}>
                    {detected.map(({ port, result }) => (
                        <li key={port}>
                            <button
                                type="button"
                                className={Styles.option}
                                data-testid={TestIds.aiWizard.detectedPort}
                                data-port={port}
                                data-result={result}
                                onClick={() => onFound(endpointOf(forIp, port), result)}
                            >
                                <span>
                                    <span className={Styles.mono}>{endpointOf(forIp, port)}</span>
                                    {PORT_PROVIDERS[port] && (
                                        <span className={Styles.muted} data-testid={TestIds.aiWizard.portProvider}>
                                            {' '}
                                            · {PORT_PROVIDERS[port]}
                                        </span>
                                    )}
                                </span>
                                {result === 'unauthorized' && (
                                    <span className={Styles.muted} title={txt('aiWizard.needsApiKey')}>
                                        <KeyRound size={16} aria-label={txt('aiWizard.needsApiKey')} />
                                    </span>
                                )}
                            </button>
                        </li>
                    ))}
                </ul>
            </div>
        );

    return (
        <div className={Styles.step} data-testid={TestIds.aiWizard.notFound}>
            <Text type="description">
                {forIp === LOCALHOST ? txt('aiWizard.notFoundLocal') : txt('aiWizard.notFoundAt', { host: forIp })}
            </Text>
            <Button variant="outline" onClick={scan} data-testid={TestIds.aiWizard.reconnect}>
                {txt('aiWizard.reconnect')}
            </Button>
            <Text type="caption">{txt('aiWizard.customPortLabel')}</Text>
            <form
                className={Styles.row}
                onSubmit={e => {
                    e.preventDefault();
                    checkPort();
                }}
            >
                <Input
                    className={Styles.input}
                    type="number"
                    min={1}
                    max={65535}
                    placeholder={txt('aiWizard.customPort')}
                    value={customPort}
                    onChange={e => {
                        setCustomPort(e.target.value);
                        setPortError(undefined);
                    }}
                    data-testid={TestIds.aiWizard.customPort}
                />
                <Button type="submit" variant="primary" disabled={!customPort || checkingPort} data-testid={TestIds.aiWizard.customPortCheck}>
                    {checkingPort ? <Dots dotsCount={3} lockSize /> : txt('aiWizard.check')}
                </Button>
            </form>
            {portError && (
                <Text type="caption" className={Styles.error} data-testid={TestIds.aiWizard.customPortError}>
                    {portError}
                </Text>
            )}
        </div>
    );
}
