import { useState, type CSSProperties } from 'react';
import AdaptiveDialog from '@onepercentio/one-ui/components/AdaptiveDialog';
import Button from '@onepercentio/one-ui/components/Button';
import Text from '@onepercentio/one-ui/components/Text';
import useShortIntl from '@onepercentio/one-ui/hooks/useShortIntl';
import { useIntl } from 'react-intl';
import { Eye, EyeOff, Globe, MonitorSmartphone, RefreshCw, X } from 'lucide-react';
import { getNativeBridge } from '../../utils/nativeBridge';
import { TestIds } from '../../testids';
import useSyncSession, { MAX_ATTEMPTS } from './useSyncSession';
import type { SyncDevice } from './network';
import Styles from './Sync.module.css';

/** Brings the projects of another device on the network to this one */
export default function Sync() {
    const { txt } = useShortIntl();
    const [open, setOpen] = useState(false);

    return (
        <>
            <button
                type="button"
                className={Styles.button}
                data-testid={TestIds.sync.open}
                title={txt('sync.open')}
                aria-label={txt('sync.open')}
                onClick={() => setOpen(true)}
            >
                <RefreshCw size={18} strokeWidth={1.75} />
            </button>
            <AdaptiveDialog open={open} onClose={() => setOpen(false)}>
                {/* Mounted only while open, as the radar keeps the network busy */}
                {open && <SyncRadar onClose={() => setOpen(false)} />}
            </AdaptiveDialog>
        </>
    );
}

/** The same place for the device on every render, spread around the radar by its id */
function positionOf(device: SyncDevice): CSSProperties {
    let hash = 0;
    for (const char of device.id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    const angle = ((hash % 360) * Math.PI) / 180;
    const radius = 30 + ((hash >> 9) % 12);
    return { left: `${50 + radius * Math.cos(angle)}%`, top: `${50 + radius * Math.sin(angle)}%` };
}

function SyncRadar({ onClose }: { onClose: () => void }) {
    const { txt } = useShortIntl();
    // The plurals take numbers, which txt does not
    const { formatMessage } = useIntl();
    const { self, devices, outgoing, incoming, result, failure, syncWith, submitCode, cancel, dismiss } = useSyncSession();
    const [revealed, setRevealed] = useState(false);
    const [code, setCode] = useState('');
    const isNative = !!getNativeBridge();

    const finish = () => {
        // What was added is read when the app starts
        if (result && (result.projects || result.entries)) window.location.reload();
        else dismiss();
    };

    return (
        <div className={Styles.dialog} data-testid={TestIds.sync.radar}>
            <header className={Styles.header}>
                <Text type="subtitle">{txt('sync.title')}</Text>
                <button type="button" className={Styles.button} title={txt('sync.close')} aria-label={txt('sync.close')} onClick={onClose}>
                    <X size={18} strokeWidth={1.75} />
                </button>
            </header>

            <div className={Styles.radar}>
                <span className={Styles.ring} />
                <span className={Styles.ring} />
                <span className={Styles.ring} />
                <span className={Styles.sweep} />
                <span className={Styles.self}>
                    <span className={Styles.selfDot} />
                    <span className={Styles.label}>{self?.name ?? txt('sync.thisDevice')}</span>
                </span>
                {devices.map(device => (
                    <button
                        key={device.id}
                        type="button"
                        className={Styles.device}
                        style={positionOf(device)}
                        data-testid={TestIds.sync.device}
                        onClick={() => {
                            setCode('');
                            syncWith(device);
                        }}
                    >
                        {device.kind === 'browser' ? <Globe size={20} strokeWidth={1.75} /> : <MonitorSmartphone size={20} strokeWidth={1.75} />}
                        <span className={Styles.label}>{device.name}</span>
                    </button>
                ))}
            </div>

            <Text type="caption" className={Styles.hint}>
                {devices.length ? txt('sync.pick') : `${txt('sync.searching')} ${txt(isNative ? 'sync.nativeHint' : 'sync.browserHint')}`}
            </Text>

            {incoming && (
                <div className={Styles.overlay} data-testid={TestIds.sync.incoming}>
                    {incoming.status === 'done' ? (
                        <>
                            <Text type="subtitle">{txt('sync.incomingDone', { name: incoming.device.name })}</Text>
                            <Button variant="primary" onClick={dismiss}>
                                {txt('sync.finish')}
                            </Button>
                        </>
                    ) : (
                        <>
                            <Text type="subtitle">{txt('sync.incomingTitle', { name: incoming.device.name })}</Text>
                            <Text type="description">{txt('sync.incomingDescription', { name: incoming.device.name })}</Text>
                            <div className={Styles.code}>
                                <span data-testid={TestIds.sync.code} className={revealed ? undefined : Styles.hidden}>
                                    {revealed ? incoming.code : '••••••'}
                                </span>
                                <button
                                    type="button"
                                    className={Styles.button}
                                    data-testid={TestIds.sync.reveal}
                                    title={txt(revealed ? 'sync.hide' : 'sync.reveal')}
                                    aria-label={txt(revealed ? 'sync.hide' : 'sync.reveal')}
                                    onClick={() => setRevealed(!revealed)}
                                >
                                    {revealed ? <EyeOff size={20} strokeWidth={1.75} /> : <Eye size={20} strokeWidth={1.75} />}
                                </button>
                            </div>
                            <Button variant="outline" data-testid={TestIds.sync.cancel} onClick={cancel}>
                                {txt('sync.cancel')}
                            </Button>
                        </>
                    )}
                </div>
            )}

            {outgoing && (
                <form
                    className={Styles.overlay}
                    data-testid={TestIds.sync.outgoing}
                    onSubmit={e => {
                        e.preventDefault();
                        if (code.length === 6) submitCode(code);
                    }}
                >
                    <Text type="subtitle">{txt('sync.outgoingTitle', { name: outgoing.device.name })}</Text>
                    <Text type="description">{txt('sync.outgoingDescription', { name: outgoing.device.name })}</Text>
                    <input
                        className={Styles.codeInput}
                        data-testid={TestIds.sync.codeInput}
                        aria-label={txt('sync.code')}
                        placeholder="000000"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={6}
                        value={code}
                        onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        autoFocus
                    />
                    {outgoing.status === 'wrong' && (
                        <Text type="caption" className={Styles.error}>
                            {formatMessage({ id: 'sync.wrongCode' }, { left: MAX_ATTEMPTS - outgoing.attempts })}
                        </Text>
                    )}
                    <div className={Styles.actions}>
                        <Button variant="outline" type="button" data-testid={TestIds.sync.cancel} onClick={cancel}>
                            {txt('sync.cancel')}
                        </Button>
                        <Button
                            variant="primary"
                            type="submit"
                            data-testid={TestIds.sync.submit}
                            disabled={!outgoing.sealed || code.length !== 6 || outgoing.status === 'checking'}
                        >
                            {outgoing.sealed ? txt('sync.submit') : txt('sync.waiting', { name: outgoing.device.name })}
                        </Button>
                    </div>
                </form>
            )}

            {(result || failure) && !outgoing && !incoming && (
                <div className={Styles.overlay} data-testid={TestIds.sync.result}>
                    <Text type="subtitle">
                        {failure
                            ? txt(`sync.failure.${failure}`)
                            : result!.projects || result!.entries
                              ? formatMessage({ id: 'sync.result' }, { projects: result!.projects, entries: result!.entries })
                              : txt('sync.resultNothing')}
                    </Text>
                    <Button variant="primary" onClick={finish}>
                        {txt('sync.finish')}
                    </Button>
                </div>
            )}
        </div>
    );
}
