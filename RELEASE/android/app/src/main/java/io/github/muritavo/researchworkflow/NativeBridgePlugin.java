package io.github.muritavo.researchworkflow;

import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.net.ConnectException;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

/**
 * What the web app can't do from the browser (see src/utils/nativeBridge.ts), exposed by Capacitor as
 * window.Capacitor.Plugins.NativeBridge
 */
@CapacitorPlugin(name = "NativeBridge")
public class NativeBridgePlugin extends Plugin {
    /** A device answers quickly, even refusing the connection, while an address without one only fails after this */
    private static final int CONNECT_TIMEOUT_MS = 1500;
    /** Any port tells if there is a device, since a closed one is refused */
    private static final int PROBE_PORT = 80;
    private static final long BROWSE_MS = 3000;
    private static final long RESOLVE_TIMEOUT_MS = 2000;
    /** The services announced with the name of the device, the first ones giving the best names */
    private static final String[] SERVICE_TYPES = {
        "_companion-link._tcp",
        "_airplay._tcp",
        "_googlecast._tcp",
        "_smb._tcp",
        "_device-info._tcp",
        "_workstation._tcp",
        "_ssh._tcp",
        "_sftp-ssh._tcp",
        "_rfb._tcp",
        "_http._tcp",
    };

    /** The devices of the local network, with their names, as { devices: [{ ip, name? }] } */
    @PluginMethod
    public void getDevices(PluginCall call) {
        new Thread(() -> {
            try {
                List<String> own = localAddresses();
                // Bonjour (NSD) tells the friendly names, and finds devices that ignore connections
                Map<String, String> announced = new ConcurrentHashMap<>();
                Thread bonjour = new Thread(() -> announced.putAll(bonjourNames()));
                bonjour.start();
                Map<String, String> devices = sweep(own);
                bonjour.join();
                // This device announces itself too, which the local provider already covers
                for (Map.Entry<String, String> entry : announced.entrySet()) {
                    if (!own.contains(entry.getKey())) devices.put(entry.getKey(), entry.getValue());
                }

                List<String> ips = new ArrayList<>(devices.keySet());
                Collections.sort(ips, (a, b) -> Long.compare(numeric(a), numeric(b)));
                JSArray list = new JSArray();
                for (String ip : ips) {
                    JSObject device = new JSObject();
                    device.put("ip", ip);
                    String name = devices.get(ip);
                    if (name != null && !name.isEmpty()) device.put("name", name);
                    list.put(device);
                }
                JSObject result = new JSObject();
                result.put("devices", list);
                call.resolve(result);
            } catch (Exception e) {
                call.reject("Could not look for the devices", e);
            }
        }).start();
    }

    private static boolean isPrivate(String ip) {
        return ip.startsWith("10.") || ip.startsWith("192.168.") || ip.matches("^172\\.(1[6-9]|2\\d|3[01])\\..*");
    }

    private static long numeric(String ip) {
        long value = 0;
        for (String octet : ip.split("\\.")) value = value * 256 + Long.parseLong(octet);
        return value;
    }

    /** The private IPv4 addresses of this device */
    private static List<String> localAddresses() throws Exception {
        List<String> addresses = new ArrayList<>();
        for (NetworkInterface network : Collections.list(NetworkInterface.getNetworkInterfaces())) {
            if (!network.isUp() || network.isLoopback()) continue;
            for (InetAddress address : Collections.list(network.getInetAddresses())) {
                if (address instanceof Inet4Address && isPrivate(address.getHostAddress())) addresses.add(address.getHostAddress());
            }
        }
        return addresses;
    }

    /** Connects to every address of the /24 of each network, naming the ones that answer by their reverse lookup */
    private static Map<String, String> sweep(List<String> own) throws Exception {
        List<String> hosts = new ArrayList<>();
        for (String ip : own) {
            String subnet = ip.substring(0, ip.lastIndexOf('.'));
            for (int i = 1; i <= 254; i++) {
                String host = subnet + "." + i;
                if (!own.contains(host) && !hosts.contains(host)) hosts.add(host);
            }
        }
        ExecutorService pool = Executors.newFixedThreadPool(64);
        try {
            List<Future<String[]>> checks = new ArrayList<>();
            for (String host : hosts) {
                checks.add(pool.submit(() -> isReachable(host) ? new String[] { host, nameOf(host) } : null));
            }
            Map<String, String> found = new TreeMap<>();
            for (Future<String[]> check : checks) {
                String[] device = check.get();
                if (device != null) found.put(device[0], device[1]);
            }
            return found;
        } finally {
            pool.shutdownNow();
        }
    }

    /** Whether a device answers on the address, by connecting to it: connected or refused, it is there */
    private static boolean isReachable(String ip) {
        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress(ip, PROBE_PORT), CONNECT_TIMEOUT_MS);
            return true;
        } catch (ConnectException e) {
            return e.getMessage() != null && e.getMessage().contains("ECONNREFUSED");
        } catch (Exception e) {
            return false;
        }
    }

    /** The name DNS gives the address, without the domain. Null when it has none */
    private static String nameOf(String ip) {
        try {
            String name = InetAddress.getByName(ip).getCanonicalHostName();
            if (name.endsWith(".")) name = name.substring(0, name.length() - 1);
            if (name.endsWith(".local")) name = name.substring(0, name.length() - ".local".length());
            return name.isEmpty() || name.equals(ip) ? null : name;
        } catch (Exception e) {
            return null;
        }
    }

    /** The names the devices announce on Bonjour, by their IPv4 address */
    private Map<String, String> bonjourNames() {
        Map<String, String> names = new ConcurrentHashMap<>();
        NsdManager nsd = (NsdManager) getContext().getSystemService(Context.NSD_SERVICE);
        if (nsd == null) return names;

        // Each instance found, with the priority of its service type
        List<Object[]> found = new CopyOnWriteArrayList<>();
        List<NsdManager.DiscoveryListener> listeners = new ArrayList<>();
        for (int priority = 0; priority < SERVICE_TYPES.length; priority++) {
            final int servicePriority = priority;
            NsdManager.DiscoveryListener listener = new NsdManager.DiscoveryListener() {
                @Override public void onServiceFound(NsdServiceInfo info) { found.add(new Object[] { info, servicePriority }); }
                @Override public void onServiceLost(NsdServiceInfo info) {}
                @Override public void onDiscoveryStarted(String type) {}
                @Override public void onDiscoveryStopped(String type) {}
                @Override public void onStartDiscoveryFailed(String type, int error) {}
                @Override public void onStopDiscoveryFailed(String type, int error) {}
            };
            try {
                nsd.discoverServices(SERVICE_TYPES[priority], NsdManager.PROTOCOL_DNS_SD, listener);
                listeners.add(listener);
            } catch (Exception ignored) {
                // The type is skipped
            }
        }
        try {
            Thread.sleep(BROWSE_MS);
        } catch (InterruptedException ignored) {}
        for (NsdManager.DiscoveryListener listener : listeners) {
            try {
                nsd.stopServiceDiscovery(listener);
            } catch (Exception ignored) {}
        }

        // Resolved one at a time, as older Android versions refuse resolving several at once
        Map<String, Integer> priorities = new ConcurrentHashMap<>();
        for (Object[] item : found) {
            NsdServiceInfo service = (NsdServiceInfo) item[0];
            int priority = (Integer) item[1];
            CountDownLatch resolved = new CountDownLatch(1);
            try {
                nsd.resolveService(service, new NsdManager.ResolveListener() {
                    @Override
                    public void onServiceResolved(NsdServiceInfo info) {
                        InetAddress host = info.getHost();
                        if (host instanceof Inet4Address && isPrivate(host.getHostAddress())) {
                            String ip = host.getHostAddress();
                            Integer current = priorities.get(ip);
                            if (current == null || priority < current) {
                                priorities.put(ip, priority);
                                names.put(ip, friendlyName(info));
                            }
                        }
                        resolved.countDown();
                    }

                    @Override
                    public void onResolveFailed(NsdServiceInfo info, int error) {
                        resolved.countDown();
                    }
                });
                resolved.await(RESOLVE_TIMEOUT_MS, TimeUnit.MILLISECONDS);
            } catch (Exception ignored) {
                // The instance is skipped
            }
        }
        return names;
    }

    /** Chromecasts tell the friendly name on the "fn" of the TXT record, their instance name being an id */
    private static String friendlyName(NsdServiceInfo info) {
        byte[] friendly = info.getAttributes().get("fn");
        if (friendly != null && friendly.length > 0) return new String(friendly, StandardCharsets.UTF_8);
        return info.getServiceName();
    }
}
