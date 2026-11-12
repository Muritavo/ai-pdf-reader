import { useEffect, useState } from 'react';
import Button from '@onepercentio/one-ui/components/Button';
import Input from '@onepercentio/one-ui/components/Input';
import Text from '@onepercentio/one-ui/components/Text';
import useShortIntl from '@onepercentio/one-ui/hooks/useShortIntl';
import { Monitor } from 'lucide-react';
import { TestIds } from '../../../../testids';
import { getNativeBridge, type NativeDevice } from '../../../../utils/nativeBridge';
import { discoverDevices, isValidIp } from '../../discovery';
import Styles from '../../AIIntegrationWizard.module.scss';

/**
 * Lists the devices found on the network, besides taking the IP of one typed.
 * The native shells find them with their names; the browser only finds their IPs
 */
export default function NetworkDevices({ onSelect }: { onSelect: (ip: string) => void }) {
    const { txt } = useShortIntl();
    const [devices, setDevices] = useState<NativeDevice[]>([]);
    // Unknown while the native shell looks for them, as it does not tell how far it is
    const [progress, setProgress] = useState<number>();
    const [scanning, setScanning] = useState(true);
    const [ip, setIp] = useState('');
    const [invalidIp, setInvalidIp] = useState(false);

    useEffect(() => {
        const controller = new AbortController();
        const scanOnBrowser = () => {
            setProgress(0);
            return discoverDevices(ip => setDevices(prev => (prev.some(d => d.ip === ip) ? prev : [...prev, { ip }])), {
                signal: controller.signal,
                onProgress: setProgress,
            });
        };
        const bridge = getNativeBridge();
        (bridge
            ? bridge.getDevices().then(
                  found => {
                      if (!controller.signal.aborted) setDevices(found);
                  },
                  // The shell failed to look, so the browser looks instead
                  scanOnBrowser,
              )
            : scanOnBrowser()
        ).finally(() => {
            if (!controller.signal.aborted) setScanning(false);
        });
        return () => controller.abort();
    }, []);

    return (
        <div className={Styles.step}>
            {scanning ? (
                <Text type="description" data-testid={TestIds.aiWizard.devicesScanning}>
                    {progress === undefined
                        ? txt('aiWizard.devicesScanningNative')
                        : txt('aiWizard.devicesScanning', { progress: String(Math.round(progress * 100)) })}
                </Text>
            ) : (
                <Text type="description">{devices.length ? txt('aiWizard.devicesDone') : txt('aiWizard.noDevices')}</Text>
            )}
            {devices.length > 0 && (
                <ul className={Styles.list}>
                    {devices.map(device => (
                        <li key={device.ip}>
                            <button
                                type="button"
                                className={Styles.option}
                                data-testid={TestIds.aiWizard.device}
                                data-ip={device.ip}
                                onClick={() => onSelect(device.ip)}
                            >
                                <span className={Styles.device}>
                                    {device.name && device.name !== device.ip && (
                                        <strong data-testid={TestIds.aiWizard.deviceName}>{device.name}</strong>
                                    )}
                                    <span className={Styles.mono}>{device.ip}</span>
                                </span>
                                <Monitor size={16} aria-hidden />
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            <form
                className={Styles.row}
                onSubmit={e => {
                    e.preventDefault();
                    if (isValidIp(ip)) onSelect(ip.trim());
                    else setInvalidIp(true);
                }}
            >
                <Input
                    className={Styles.input}
                    placeholder={txt('aiWizard.ipLabel')}
                    inputMode="decimal"
                    value={ip}
                    onChange={e => {
                        setIp(e.target.value);
                        setInvalidIp(false);
                    }}
                    data-testid={TestIds.aiWizard.ipInput}
                />
                <Button type="submit" variant="primary" disabled={!ip.trim()} data-testid={TestIds.aiWizard.ipContinue}>
                    {txt('aiWizard.continue')}
                </Button>
            </form>
            {invalidIp && (
                <Text type="caption" className={Styles.error} data-testid={TestIds.aiWizard.ipError}>
                    {txt('aiWizard.ipError')}
                </Text>
            )}
        </div>
    );
}
