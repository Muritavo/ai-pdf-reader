package io.github.muritavo.researchworkflow;

import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * The sync server of the Android app (see SyncHost on src/utils/nativeBridge.ts, which documents the routes).
 * It only relays: what arrives waits on the inbox until the web app takes it.
 * It announces itself over NSD (mDNS) and finds the other native apps doing the same
 */
class SyncServer {
    /** Must match SYNC_PORT of src/features/Sync/network.ts */
    static final int PORT = 47816;
    /** Must match the one the other native shells announce and browse */
    private static final String SERVICE_TYPE = "_researchsync._tcp";
    private static final String APP = "research-toolkit";
    private static final int MAX_BODY = 64 * 1024 * 1024;
    private static final int READ_TIMEOUT_MS = 30_000;
    private static final long RESOLVE_TIMEOUT_MS = 3000;

    final String id;
    final String name;
    private final NsdManager nsd;
    private final ServerSocket socket;
    private final ExecutorService connections = Executors.newCachedThreadPool();
    /** Older Android versions refuse resolving several services at once */
    private final ExecutorService resolver = Executors.newSingleThreadExecutor();
    private final List<JSObject> inbox = new ArrayList<>();
    private final Map<String, List<String>> held = new HashMap<>();
    /** The native apps found, by their service name */
    private final Map<String, JSObject> peers = new ConcurrentHashMap<>();
    private NsdManager.RegistrationListener registration;
    private NsdManager.DiscoveryListener discovery;
    private volatile boolean stopped;

    SyncServer(Context context, String id) throws Exception {
        this.id = id;
        this.name = deviceName(context);
        this.nsd = (NsdManager) context.getSystemService(Context.NSD_SERVICE);
        socket = new ServerSocket();
        socket.setReuseAddress(true);
        socket.bind(new InetSocketAddress(PORT));
        new Thread(this::accept, "SyncServer").start();
        if (nsd != null) {
            announce();
            browse();
        }
    }

    /** The name set on the device (as "Pixel de Murilo"), or its model when it has none */
    private static String deviceName(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N_MR1) {
            String name = Settings.Global.getString(context.getContentResolver(), Settings.Global.DEVICE_NAME);
            if (name != null && !name.trim().isEmpty()) return name.trim();
        }
        return Build.MODEL;
    }

    void stop() {
        stopped = true;
        try {
            socket.close();
        } catch (Exception ignored) {}
        if (nsd != null) {
            try {
                if (registration != null) nsd.unregisterService(registration);
            } catch (Exception ignored) {}
            try {
                if (discovery != null) nsd.stopServiceDiscovery(discovery);
            } catch (Exception ignored) {}
        }
        connections.shutdownNow();
        resolver.shutdownNow();
    }

    JSArray peers() {
        JSArray list = new JSArray();
        for (JSObject peer : peers.values()) list.put(peer);
        return list;
    }

    JSArray takeInbox() {
        JSArray list = new JSArray();
        synchronized (inbox) {
            for (JSObject envelope : inbox) list.put(envelope);
            inbox.clear();
        }
        return list;
    }

    void hold(String to, String body) {
        synchronized (held) {
            List<String> messages = held.get(to);
            if (messages == null) held.put(to, messages = new ArrayList<>());
            messages.add(body);
        }
    }

    private void accept() {
        while (!stopped) {
            try {
                Socket client = socket.accept();
                connections.execute(() -> serve(client));
            } catch (Exception e) {
                if (stopped) return;
            }
        }
    }

    private JSONObject hello() throws Exception {
        JSONObject hello = new JSONObject();
        hello.put("app", APP);
        hello.put("id", id);
        hello.put("name", name);
        return hello;
    }

    /** One request per connection, closed after the response */
    private void serve(Socket client) {
        try (Socket connection = client) {
            connection.setSoTimeout(READ_TIMEOUT_MS);
            InputStream input = connection.getInputStream();
            OutputStream output = connection.getOutputStream();
            String head = readHead(input);
            if (head == null) return;
            String[] lines = head.split("\r\n");
            String[] requestLine = lines[0].split(" ");
            if (requestLine.length < 2) return;
            String method = requestLine[0];
            String target = requestLine[1];
            int length = 0;
            for (int i = 1; i < lines.length; i++) {
                int colon = lines[i].indexOf(':');
                if (colon > 0 && lines[i].substring(0, colon).trim().equalsIgnoreCase("content-length")) {
                    length = Integer.parseInt(lines[i].substring(colon + 1).trim());
                }
            }
            if (length > MAX_BODY) {
                respond(output, 413, null);
                return;
            }
            String path = target.contains("?") ? target.substring(0, target.indexOf('?')) : target;
            String query = target.contains("?") ? target.substring(target.indexOf('?') + 1) : "";

            if (method.equals("OPTIONS")) {
                respond(output, 204, null);
            } else if (method.equals("GET") && path.equals("/sync/hello")) {
                respond(output, 200, hello().toString());
            } else if (method.equals("GET") && path.equals("/sync/messages")) {
                String to = parameter(query, "for");
                List<String> messages;
                synchronized (held) {
                    messages = held.remove(to);
                }
                JSONArray list = new JSONArray();
                if (messages != null) for (String message : messages) list.put(message);
                respond(output, 200, list.toString());
            } else if (method.equals("POST") && (path.equals("/sync/announce") || path.equals("/sync/message"))) {
                String body = new String(readBytes(input, length), StandardCharsets.UTF_8);
                String route = path.equals("/sync/announce") ? "announce" : "message";
                JSObject envelope = new JSObject();
                envelope.put("route", route);
                envelope.put("ip", ipOf(connection.getInetAddress()));
                envelope.put("body", body);
                synchronized (inbox) {
                    inbox.add(envelope);
                }
                if (route.equals("announce")) respond(output, 200, hello().toString());
                else respond(output, 204, null);
            } else {
                respond(output, 404, "{\"error\":\"Not found\"}");
            }
        } catch (Exception ignored) {
            // The connection is dropped
        }
    }

    private static String ipOf(InetAddress address) {
        String ip = address.getHostAddress();
        return ip != null && ip.startsWith("::ffff:") ? ip.substring("::ffff:".length()) : ip;
    }

    private static String parameter(String query, String key) throws Exception {
        for (String pair : query.split("&")) {
            int equals = pair.indexOf('=');
            if (equals > 0 && pair.substring(0, equals).equals(key)) return URLDecoder.decode(pair.substring(equals + 1), "UTF-8");
        }
        return "";
    }

    /** The request line and headers, up to the blank line */
    private static String readHead(InputStream input) throws Exception {
        ByteArrayOutputStream head = new ByteArrayOutputStream();
        // The last 4 bytes read, to tell the \r\n\r\n ending the head
        int last = 0;
        int value;
        while ((value = input.read()) != -1) {
            head.write(value);
            last = (last << 8) | value;
            if (last == 0x0D0A0D0A) return head.toString("UTF-8");
            if (head.size() > 64 * 1024) return null;
        }
        return null;
    }

    private static byte[] readBytes(InputStream input, int length) throws Exception {
        byte[] body = new byte[length];
        int read = 0;
        while (read < length) {
            int count = input.read(body, read, length - read);
            if (count == -1) throw new Exception("The body ended early");
            read += count;
        }
        return body;
    }

    private static void respond(OutputStream output, int status, String json) throws Exception {
        byte[] body = json == null ? new byte[0] : json.getBytes(StandardCharsets.UTF_8);
        StringBuilder head = new StringBuilder()
            .append(String.format(Locale.ROOT, "HTTP/1.1 %d %s\r\n", status, reason(status)))
            .append("Access-Control-Allow-Origin: *\r\n")
            .append("Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n")
            .append("Access-Control-Allow-Headers: Content-Type\r\n")
            .append("Access-Control-Allow-Private-Network: true\r\n")
            .append("Connection: close\r\n")
            .append("Content-Length: ").append(body.length).append("\r\n");
        if (json != null) head.append("Content-Type: application/json\r\n");
        head.append("\r\n");
        output.write(head.toString().getBytes(StandardCharsets.UTF_8));
        output.write(body);
        output.flush();
    }

    private static String reason(int status) {
        switch (status) {
            case 200: return "OK";
            case 204: return "No Content";
            case 404: return "Not Found";
            case 413: return "Payload Too Large";
            default: return "Error";
        }
    }

    private void announce() {
        NsdServiceInfo service = new NsdServiceInfo();
        service.setServiceName(name);
        service.setServiceType(SERVICE_TYPE);
        service.setPort(PORT);
        service.setAttribute("id", id);
        registration = new NsdManager.RegistrationListener() {
            @Override public void onServiceRegistered(NsdServiceInfo info) {}
            @Override public void onRegistrationFailed(NsdServiceInfo info, int error) {}
            @Override public void onServiceUnregistered(NsdServiceInfo info) {}
            @Override public void onUnregistrationFailed(NsdServiceInfo info, int error) {}
        };
        nsd.registerService(service, NsdManager.PROTOCOL_DNS_SD, registration);
    }

    private void browse() {
        discovery = new NsdManager.DiscoveryListener() {
            @Override public void onServiceFound(NsdServiceInfo info) { resolver.execute(() -> resolve(info)); }
            @Override public void onServiceLost(NsdServiceInfo info) { peers.remove(info.getServiceName()); }
            @Override public void onDiscoveryStarted(String type) {}
            @Override public void onDiscoveryStopped(String type) {}
            @Override public void onStartDiscoveryFailed(String type, int error) {}
            @Override public void onStopDiscoveryFailed(String type, int error) {}
        };
        nsd.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, discovery);
    }

    /** Waits for each resolution, as the resolver runs them one at a time */
    private void resolve(NsdServiceInfo service) {
        if (stopped) return;
        CountDownLatch done = new CountDownLatch(1);
        try {
            nsd.resolveService(service, new NsdManager.ResolveListener() {
                @Override
                public void onServiceResolved(NsdServiceInfo info) {
                    byte[] peerId = info.getAttributes().get("id");
                    InetAddress host = info.getHost();
                    if (peerId != null && host instanceof Inet4Address) {
                        String value = new String(peerId, StandardCharsets.UTF_8);
                        if (!value.equals(id)) {
                            JSObject peer = new JSObject();
                            peer.put("id", value);
                            peer.put("name", info.getServiceName());
                            peer.put("ip", host.getHostAddress());
                            peer.put("port", info.getPort());
                            peers.put(info.getServiceName(), peer);
                        }
                    }
                    done.countDown();
                }

                @Override
                public void onResolveFailed(NsdServiceInfo info, int error) {
                    done.countDown();
                }
            });
            done.await(RESOLVE_TIMEOUT_MS, TimeUnit.MILLISECONDS);
        } catch (Exception ignored) {
            // The service is skipped
        }
    }
}
