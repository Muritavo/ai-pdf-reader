import { useCallback, useEffect, useRef, useState } from 'react';
import { exportAllProjects, mergeSyncExport, parseSyncExport } from '../../utils/dataTransfer';
import { newCode, open, seal, type Sealed } from './crypto';
import { startSyncNetwork, type SyncDevice, type SyncMessage, type SyncNetwork } from './network';

/** Wrong codes accepted before the sync is given up */
export const MAX_ATTEMPTS = 5;
/** How long a device that asked to sync may take to show up, as its registration can arrive after its request */
const UNKNOWN_DEVICE_WAIT_MS = 4000;

/** This device asked another for its projects, and waits for the code shown there */
export type Outgoing = {
    device: SyncDevice;
    session: string;
    sealed?: Sealed;
    attempts: number;
    status: 'waiting' | 'ready' | 'checking' | 'wrong';
};

/** Another device asked for the projects of this one, which shows the code to type there */
export type Incoming = { device: SyncDevice; session: string; code: string; status: 'sending' | 'sent' | 'done' };

export type SyncResult = { projects: number; entries: number };

/** Why a sync stopped before the end */
export type SyncFailure = 'cancelled' | 'unreachable' | 'attempts' | 'invalid';

const newSession = () => Math.random().toString(36).slice(2, 12);

/**
 * The sync while the radar is open: the devices around and the one sync going on at a time.
 * The device that starts the sync always receives: it asks the other, which sends its projects sealed with a code
 * shown on its screen, and the one asking adds what it misses once the code typed opens them
 */
export default function useSyncSession() {
    const [self, setSelf] = useState<{ id: string; name: string }>();
    const [devices, setDevices] = useState<SyncDevice[]>([]);
    const [outgoing, setOutgoing] = useState<Outgoing>();
    const [incoming, setIncoming] = useState<Incoming>();
    const [result, setResult] = useState<SyncResult>();
    const [failure, setFailure] = useState<SyncFailure>();

    const network = useRef<SyncNetwork>();
    const devicesRef = useRef<SyncDevice[]>([]);
    // The callbacks of the network read the latest of these, not the ones of when it started
    const outgoingRef = useRef(outgoing);
    const incomingRef = useRef(incoming);
    outgoingRef.current = outgoing;
    incomingRef.current = incoming;

    const send = useCallback((to: SyncDevice, message: SyncMessage) => network.current!.send(to, message), []);

    /** The device by its id, waiting a bit for one that asked before registering */
    const findDevice = useCallback(async (id: string) => {
        const deadline = Date.now() + UNKNOWN_DEVICE_WAIT_MS;
        while (Date.now() < deadline) {
            const device = devicesRef.current.find(known => known.id === id);
            if (device) return device;
            await new Promise(resolve => setTimeout(resolve, 250));
        }
        return undefined;
    }, []);

    const onRequest = useCallback(
        async (message: Extract<SyncMessage, { type: 'request' }>) => {
            const device = await findDevice(message.from);
            if (!device) return;
            const self = network.current!.self;
            // One sync at a time
            if (incomingRef.current || outgoingRef.current) {
                await send(device, { type: 'cancel', from: self.id, session: message.session }).catch(() => undefined);
                return;
            }
            const code = newCode();
            const current: Incoming = { device, session: message.session, code, status: 'sending' };
            incomingRef.current = current;
            setFailure(undefined);
            setResult(undefined);
            setIncoming(current);
            try {
                const sealed = await seal(code, JSON.stringify(await exportAllProjects()));
                if (incomingRef.current?.session !== message.session) return;
                await send(device, { type: 'payload', from: self.id, session: message.session, sealed });
                setIncoming(previous => (previous?.session === message.session ? { ...previous, status: 'sent' } : previous));
            } catch (e) {
                console.error('Could not send the projects', e);
                setIncoming(undefined);
                setFailure('unreachable');
            }
        },
        [findDevice, send],
    );

    const onMessage = useCallback(
        (message: SyncMessage) => {
            switch (message.type) {
                case 'request':
                    onRequest(message);
                    break;
                case 'payload':
                    setOutgoing(previous =>
                        previous?.session === message.session && !previous.sealed ? { ...previous, sealed: message.sealed, status: 'ready' } : previous,
                    );
                    break;
                case 'done':
                    setIncoming(previous => (previous?.session === message.session ? { ...previous, status: 'done' } : previous));
                    break;
                case 'cancel':
                    if (outgoingRef.current?.session === message.session) {
                        setOutgoing(undefined);
                        setFailure('cancelled');
                    }
                    if (incomingRef.current?.session === message.session) {
                        setIncoming(undefined);
                        setFailure('cancelled');
                    }
                    break;
            }
        },
        [onRequest],
    );

    useEffect(() => {
        let started: SyncNetwork | undefined;
        let unmounted = false;
        startSyncNetwork({
            onDevices: list => {
                devicesRef.current = list;
                setDevices(list);
            },
            onMessage,
        })
            .then(created => {
                if (unmounted) return created.stop();
                started = created;
                network.current = created;
                setSelf(created.self);
            })
            .catch(e => console.error('Could not start the sync', e));
        return () => {
            unmounted = true;
            const self = network.current?.self;
            // Whoever waits on this device is told it left
            const pending = outgoingRef.current ?? incomingRef.current;
            if (pending && self) started?.send(pending.device, { type: 'cancel', from: self.id, session: pending.session }).catch(() => undefined);
            started?.stop();
            network.current = undefined;
        };
        // The network lives as long as the radar is open
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /** Asks the device for its projects */
    const syncWith = useCallback(
        async (device: SyncDevice) => {
            if (!network.current || outgoingRef.current || incomingRef.current) return;
            const session = newSession();
            const current: Outgoing = { device, session, attempts: 0, status: 'waiting' };
            outgoingRef.current = current;
            setFailure(undefined);
            setResult(undefined);
            setOutgoing(current);
            try {
                await send(device, { type: 'request', from: network.current.self.id, session });
            } catch (e) {
                console.error('Could not ask the device to sync', e);
                setOutgoing(undefined);
                setFailure('unreachable');
            }
        },
        [send],
    );

    /** Opens what the device sent with the code typed, adding what this device misses */
    const submitCode = useCallback(
        async (code: string) => {
            const current = outgoingRef.current;
            if (!current?.sealed || current.status === 'checking' || !network.current) return;
            setOutgoing({ ...current, status: 'checking' });
            const text = await open(code, current.sealed);
            if (outgoingRef.current?.session !== current.session) return;
            if (text === undefined) {
                const attempts = current.attempts + 1;
                if (attempts < MAX_ATTEMPTS) return setOutgoing({ ...current, attempts, status: 'wrong' });
                send(current.device, { type: 'cancel', from: network.current.self.id, session: current.session }).catch(() => undefined);
                setOutgoing(undefined);
                return setFailure('attempts');
            }
            const data = parseSyncExport(text);
            if (!data) {
                send(current.device, { type: 'cancel', from: network.current.self.id, session: current.session }).catch(() => undefined);
                setOutgoing(undefined);
                return setFailure('invalid');
            }
            const added = await mergeSyncExport(data);
            send(current.device, { type: 'done', from: network.current.self.id, session: current.session }).catch(() => undefined);
            setOutgoing(undefined);
            setResult(added);
        },
        [send],
    );

    /** Gives up the sync going on, telling the other device */
    const cancel = useCallback(() => {
        const pending = outgoingRef.current ?? incomingRef.current;
        if (pending && network.current)
            send(pending.device, { type: 'cancel', from: network.current.self.id, session: pending.session }).catch(() => undefined);
        setOutgoing(undefined);
        setIncoming(undefined);
    }, [send]);

    /** Leaves the end of a sync, back to the radar */
    const dismiss = useCallback(() => {
        setIncoming(previous => (previous?.status === 'done' ? undefined : previous));
        setResult(undefined);
        setFailure(undefined);
    }, []);

    return { self, devices, outgoing, incoming, result, failure, syncWith, submitCode, cancel, dismiss };
}
