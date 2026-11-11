/**
 * Finding OpenAI compatible servers, on this machine and on the network, from the browser.
 * Every check is a plain request, so it only finds the servers that allow being called from the app (CORS)
 */

/** The host the local provider is looked for on */
export const LOCALHOST = '127.0.0.1';

/** The ports AI servers usually listen on, with the provider each one is commonly attributed to */
export const PORT_PROVIDERS: Record<number, string> = {
    8000: 'oMLX / vLLM',
    8080: 'llama.cpp',
    1234: 'LM Studio',
    11434: 'Ollama',
    5000: 'text-generation-webui',
    5001: 'KoboldCpp',
};

export const COMMON_PORTS = Object.keys(PORT_PROVIDERS).map(Number);

/**
 * - available: a server answered the completions route
 * - unauthorized: a server answered, asking for an API key
 * - absent: nothing answered, or what answered is not an AI server
 */
export type ProbeResult = 'available' | 'unauthorized' | 'absent';

export const endpointOf = (host: string, port: number) => `http://${host}:${port}`;

/** Aborts the request after the time, besides when the signal given aborts */
function timedSignal(timeoutMs: number, signal?: AbortSignal) {
    const timeout = AbortSignal.timeout(timeoutMs);
    return signal ? AbortSignal.any([timeout, signal]) : timeout;
}

/** Calls the completions route with an empty conversation, which a server refuses without generating anything */
export async function probeProvider(endpoint: string, { apiKey, timeoutMs = 2000, signal }: { apiKey?: string; timeoutMs?: number; signal?: AbortSignal } = {}): Promise<ProbeResult> {
    try {
        const response = await fetch(`${endpoint}/v1/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
            },
            body: JSON.stringify({ messages: [], max_tokens: 1 }),
            signal: timedSignal(timeoutMs, signal),
        });
        if (response.status === 401) return 'unauthorized';
        // Something else listens on the port, without the route
        if (response.status === 404) return 'absent';
        return 'available';
    } catch {
        return 'absent';
    }
}

export type DetectedPort = { port: number; result: Exclude<ProbeResult, 'absent'> };

/** Checks every port at once, returning the ones a server answered on */
export async function scanPorts(host: string, ports = COMMON_PORTS, signal?: AbortSignal): Promise<DetectedPort[]> {
    const results = await Promise.all(ports.map(async port => ({ port, result: await probeProvider(endpointOf(host, port), { signal }) })));
    return results.filter((detected): detected is DetectedPort => detected.result !== 'absent');
}

/** The models the server offers, on the standard OpenAI route. Empty when it does not tell them */
export async function listModels(endpoint: string, apiKey?: string): Promise<string[]> {
    try {
        const response = await fetch(`${endpoint}/v1/models`, {
            headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
            signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) return [];
        const data = await response.json();
        return ((data?.data ?? []) as { id?: unknown }[]).map(model => model.id).filter((id): id is string => typeof id === 'string');
    } catch {
        return [];
    }
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
export const isValidIp = (ip: string) => IPV4.test(ip.trim());

const isPrivateIp = (ip: string) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);

/** The networks usually used at home and at offices, for when the address of this device can't be known */
const FALLBACK_SUBNETS = ['192.168.0', '192.168.1', '10.0.0'];

/** The address of this device, as WebRTC tells it. Browsers that hide it give none */
async function localAddresses(): Promise<string[]> {
    if (typeof RTCPeerConnection === 'undefined') return [];
    const connection = new RTCPeerConnection({ iceServers: [] });
    const found = new Set<string>();
    try {
        connection.createDataChannel('');
        await new Promise<void>(resolve => {
            const done = setTimeout(resolve, 1500);
            connection.onicecandidate = event => {
                if (!event.candidate) {
                    clearTimeout(done);
                    return resolve();
                }
                for (const ip of event.candidate.candidate.match(/\d{1,3}(\.\d{1,3}){3}/g) ?? []) {
                    if (isPrivateIp(ip)) found.add(ip);
                }
            };
            connection
                .createOffer()
                .then(offer => connection.setLocalDescription(offer))
                .catch(() => resolve());
        });
    } finally {
        connection.close();
    }
    return [...found];
}

/** The networks to look for devices on: the ones of this device, or the usual ones when they can't be known */
export async function localSubnets(): Promise<string[]> {
    const subnets = [...new Set((await localAddresses()).map(ip => ip.split('.').slice(0, 3).join('.')))];
    return subnets.length ? subnets : FALLBACK_SUBNETS;
}

/** How long a device takes at most to answer. A missing address only fails after it */
const DEVICE_TIMEOUT_MS = 1200;
const CONCURRENT_CHECKS = 64;

/**
 * Whether there is a device on the address. A device answers quickly, even refusing the connection,
 * while an address without one is only given up after the timeout
 */
async function hasDevice(ip: string, signal: AbortSignal) {
    const timeout = AbortSignal.timeout(DEVICE_TIMEOUT_MS);
    try {
        await fetch(`${endpointOf(ip, COMMON_PORTS[0])}/`, { mode: 'no-cors', signal: AbortSignal.any([timeout, signal]) });
        return true;
    } catch {
        return !timeout.aborted && !signal.aborted;
    }
}

/** Looks for the devices on the networks of this device, telling each as it is found */
export async function discoverDevices(
    onDevice: (ip: string) => void,
    { signal, onProgress }: { signal: AbortSignal; onProgress?: (progress: number) => void },
) {
    const subnets = await localSubnets();
    const addresses = subnets.flatMap(subnet => Array.from({ length: 254 }, (_, i) => `${subnet}.${i + 1}`));
    let next = 0;
    let checked = 0;
    const worker = async () => {
        while (next < addresses.length && !signal.aborted) {
            const ip = addresses[next++];
            if (await hasDevice(ip, signal)) onDevice(ip);
            onProgress?.(++checked / addresses.length);
        }
    };
    await Promise.all(Array.from({ length: CONCURRENT_CHECKS }, worker));
}

/**
 * Whether the provider answers with the model, asking it for a single token.
 * Slow when the provider has to load the model first, so it waits longer than the other checks
 */
export async function checkModel(endpoint: string, model: string, apiKey?: string): Promise<boolean> {
    try {
        const response = await fetch(`${endpoint}/v1/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
            },
            body: JSON.stringify({ model, messages: [{ role: 'user', content: 'OK' }], max_tokens: 1, stream: false }),
            signal: AbortSignal.timeout(120_000),
        });
        return response.ok;
    } catch {
        return false;
    }
}
