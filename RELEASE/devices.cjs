const dns = require('node:dns').promises;
const net = require('node:net');
const os = require('node:os');
const { Bonjour } = require('bonjour-service');

/** A device answers quickly, even refusing the connection, while an address without one only fails after this */
const CONNECT_TIMEOUT_MS = 1500;
const NAME_TIMEOUT_MS = 3000;
/** Any port tells if there is a device, since a closed one is refused */
const PROBE_PORT = 80;

/**
 * The services announced with the name of the device, the first ones giving the best names.
 * Must match NSBonjourServices of the visionOS app, which browses the same ones
 */
const SERVICE_TYPES = ['companion-link', 'airplay', 'googlecast', 'smb', 'device-info', 'workstation', 'ssh', 'sftp-ssh', 'rfb', 'http'];
const BROWSE_MS = 3000;

const isPrivate = ip => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);

/** The private IPv4 addresses of this computer */
function localAddresses() {
    return Object.values(os.networkInterfaces())
        .flat()
        .filter(info => info && info.family === 'IPv4' && !info.internal && isPrivate(info.address))
        .map(info => info.address);
}

/** Whether a device answers on the address, by connecting to it: connected or refused, it is there */
function isReachable(ip) {
    return new Promise(resolve => {
        const socket = net.connect({ host: ip, port: PROBE_PORT });
        const finish = reachable => {
            socket.destroy();
            resolve(reachable);
        };
        socket.setTimeout(CONNECT_TIMEOUT_MS, () => finish(false));
        socket.once('connect', () => finish(true));
        socket.once('error', error => finish(error.code === 'ECONNREFUSED'));
    });
}

/** The name the system resolver gives the address (mDNS on macOS, DNS, NetBIOS on Windows), without the domain */
async function nameOf(ip) {
    try {
        const { hostname } = await Promise.race([
            dns.lookupService(ip, PROBE_PORT),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NAME_TIMEOUT_MS)),
        ]);
        const name = hostname.replace(/\.$/, '').replace(/\.local$/, '');
        return name && name !== ip ? name : undefined;
    } catch {
        return undefined;
    }
}

/** The names the devices announce on Bonjour (as "Sala de estar"), by their IPv4 address */
function bonjourNames() {
    return new Promise(resolve => {
        const bonjour = new Bonjour();
        /** By address: the name and the priority of the service that gave it */
        const found = new Map();
        const browsers = SERVICE_TYPES.map((type, priority) =>
            bonjour.find({ type }, service => {
                // Chromecasts tell the friendly name on the TXT record, their instance name being an id
                const name = (service.txt && service.txt.fn) || service.name;
                // Some devices answer without their addresses, which are then the one the answer came from
                const addresses = service.addresses && service.addresses.length ? service.addresses : [service.referer && service.referer.address];
                for (const ip of addresses) {
                    if (!ip) continue;
                    if (!net.isIPv4(ip) || !isPrivate(ip)) continue;
                    const current = found.get(ip);
                    if (!current || priority < current.priority) found.set(ip, { name, priority });
                }
            }),
        );
        setTimeout(() => {
            browsers.forEach(browser => browser.stop());
            bonjour.destroy();
            resolve(new Map([...found].map(([ip, { name }]) => [ip, name])));
        }, BROWSE_MS);
    });
}

/** Connects to every address of the /24 of each network, naming the ones that answer by their reverse lookup */
async function sweep(own) {
    const subnets = [...new Set(own.map(ip => ip.split('.').slice(0, 3).join('.')))];
    const hosts = subnets.flatMap(subnet => Array.from({ length: 254 }, (_, i) => `${subnet}.${i + 1}`)).filter(ip => !own.includes(ip));
    const reachable = (await Promise.all(hosts.map(async ip => ((await isReachable(ip)) ? ip : null)))).filter(Boolean);
    return Promise.all(reachable.map(async ip => ({ ip, name: await nameOf(ip) })));
}

/** The devices on the networks of this computer, with their names. Bonjour also finds the ones that ignore connections */
async function getDevices() {
    const own = localAddresses();
    const [swept, announced] = await Promise.all([sweep(own), bonjourNames().catch(() => new Map())]);
    const byIp = new Map(swept.map(device => [device.ip, device]));
    // This computer announces itself too, which the local provider already covers
    for (const [ip, name] of announced) if (!own.includes(ip)) byIp.set(ip, { ip, name });
    return [...byIp.values()].sort((a, b) => a.ip.localeCompare(b.ip, undefined, { numeric: true }));
}

module.exports = { getDevices };
