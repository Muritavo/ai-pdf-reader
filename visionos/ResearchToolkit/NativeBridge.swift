import Foundation
import Network
import WebKit

/// `window.nativeBridge` of the web app: what it can't do from the browser (see src/utils/nativeBridge.ts).
/// Each call is a message to this handler, whose reply resolves the promise the call returns.
final class NativeBridgeHandler: NSObject, WKScriptMessageHandlerWithReply {
    static let name = "nativeBridge"

    /// Defines the bridge on the page, before the app's scripts run
    static let script = """
    window.nativeBridge = {
        getDevices: () => window.webkit.messageHandlers.\(name).postMessage({ action: 'getDevices' }),
    };
    """

    func userContentController(
        _ controller: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping (Any?, String?) -> Void
    ) {
        guard let body = message.body as? [String: Any], let action = body["action"] as? String else {
            return replyHandler(nil, "Invalid message")
        }
        switch action {
        case "getDevices":
            Task {
                let devices = await LocalNetworkScanner.devices()
                let reply: [[String: Any]] = devices.map { device in
                    var entry: [String: Any] = ["ip": device.ip]
                    if let name = device.name { entry["name"] = name }
                    return entry
                }
                await MainActor.run { replyHandler(reply, nil) }
            }
        default:
            replyHandler(nil, "Unknown action \(action)")
        }
    }
}

/// Finds the devices on the network of this device (its /24), with the names the network gives them
enum LocalNetworkScanner {
    struct Device {
        let ip: String
        let name: String?
    }

    /// A device answers quickly, even refusing the connection, while an address without one only fails after this
    private static let connectTimeout: TimeInterval = 1.5
    /// Any port tells if there is a device, since a closed one is refused
    private static let probePort: NWEndpoint.Port = 80
    private static let queue = DispatchQueue(label: "LocalNetworkScanner", attributes: .concurrent)

    static func devices() async -> [Device] {
        // Bonjour tells the friendly names (as "Sala de estar"), and finds devices that ignore connections
        async let announced = BonjourNames.collect()
        let swept = await sweep()
        let names = await announced
        var byIP = Dictionary(uniqueKeysWithValues: swept.map { ($0.ip, $0) })
        // This device announces itself too, which the local provider already covers
        let own = Set(localIPv4s().map(\.ip))
        for (ip, name) in names where !own.contains(ip) {
            byIP[ip] = Device(ip: ip, name: name)
        }
        return byIP.values.sorted { lastOctet($0.ip) < lastOctet($1.ip) }
    }

    /// Connects to every address of the /24 of this device, naming the ones that answer by their reverse lookup
    private static func sweep() async -> [Device] {
        guard let local = localIPv4() else { return [] }
        let prefix = local.split(separator: ".").prefix(3).joined(separator: ".")
        let hosts = (1...254).map { "\(prefix).\($0)" }.filter { $0 != local }

        let reachable = await withTaskGroup(of: String?.self) { group in
            for host in hosts {
                group.addTask { await isReachable(host) ? host : nil }
            }
            var found: [String] = []
            for await host in group {
                if let host { found.append(host) }
            }
            return found
        }

        let devices = await withTaskGroup(of: Device.self) { group in
            for ip in reachable {
                group.addTask { Device(ip: ip, name: await name(of: ip)) }
            }
            var named: [Device] = []
            for await device in group { named.append(device) }
            return named
        }
        return devices
    }

    private static func lastOctet(_ ip: String) -> Int {
        Int(ip.split(separator: ".").last ?? "") ?? 0
    }

    /// The private IPv4 address of this device, preferring the Wi-Fi interface
    private static func localIPv4() -> String? {
        let addresses = localIPv4s()
        return (addresses.first { $0.interface == "en0" } ?? addresses.first)?.ip
    }

    /// Every private IPv4 address of this device, by interface
    private static func localIPv4s() -> [(interface: String, ip: String)] {
        var addresses: [(interface: String, ip: String)] = []
        var list: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&list) == 0, let first = list else { return [] }
        defer { freeifaddrs(list) }
        for pointer in sequence(first: first, next: { $0.pointee.ifa_next }) {
            let entry = pointer.pointee
            guard let address = entry.ifa_addr, address.pointee.sa_family == sa_family_t(AF_INET),
                  entry.ifa_flags & UInt32(IFF_UP) != 0, entry.ifa_flags & UInt32(IFF_LOOPBACK) == 0
            else { continue }
            var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            guard getnameinfo(address, socklen_t(address.pointee.sa_len), &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST) == 0
            else { continue }
            let ip = String(cString: host)
            if isPrivate(ip) { addresses.append((String(cString: entry.ifa_name), ip)) }
        }
        return addresses
    }

    static func isPrivate(_ ip: String) -> Bool {
        let octets = ip.split(separator: ".").compactMap { Int($0) }
        guard octets.count == 4 else { return false }
        return octets[0] == 10 || (octets[0] == 192 && octets[1] == 168) || (octets[0] == 172 && (16...31).contains(octets[1]))
    }

    /// Whether a device answers on the address, by connecting to it: connected or refused, it is there
    private static func isReachable(_ ip: String) async -> Bool {
        await withCheckedContinuation { continuation in
            let connection = NWConnection(host: NWEndpoint.Host(ip), port: probePort, using: .tcp)
            let once = Once()
            let finish = { (reachable: Bool) in
                guard once.claim() else { return }
                connection.cancel()
                continuation.resume(returning: reachable)
            }
            connection.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    finish(true)
                case .waiting(let error), .failed(let error):
                    if case .posix(let code) = error, code == .ECONNREFUSED { finish(true) }
                    // Any other failure is final only when the connection gave up
                    else if case .failed = state { finish(false) }
                default:
                    break
                }
            }
            connection.start(queue: queue)
            queue.asyncAfter(deadline: .now() + connectTimeout) { finish(false) }
        }
    }

    /// The name the network gives the address (mDNS, as "Murilos-MacBook.local", or DNS), without the domain
    private static func name(of ip: String) async -> String? {
        await withCheckedContinuation { continuation in
            queue.async {
                var address = sockaddr_in()
                address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
                address.sin_family = sa_family_t(AF_INET)
                guard inet_pton(AF_INET, ip, &address.sin_addr) == 1 else { return continuation.resume(returning: nil) }
                var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
                let result = withUnsafePointer(to: &address) {
                    $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                        getnameinfo($0, socklen_t(MemoryLayout<sockaddr_in>.size), &host, socklen_t(host.count), nil, 0, NI_NAMEREQD)
                    }
                }
                guard result == 0 else { return continuation.resume(returning: nil) }
                var name = String(cString: host)
                if name.hasSuffix(".") { name.removeLast() }
                if name.hasSuffix(".local") { name.removeLast(".local".count) }
                continuation.resume(returning: name.isEmpty || name == ip ? nil : name)
            }
        }
    }
}

/// The names the devices announce on Bonjour, by their IPv4 address
enum BonjourNames {
    /// The services announced with the name of the device, the first ones giving the best names.
    /// Must match NSBonjourServices of Info.plist, or visionOS refuses browsing them
    static let serviceTypes = [
        "_companion-link._tcp", // Apple devices, by the name set on them
        "_airplay._tcp",
        "_googlecast._tcp", // The friendly name is on the "fn" of its TXT record
        "_smb._tcp",
        "_device-info._tcp",
        "_workstation._tcp",
        "_ssh._tcp",
        "_sftp-ssh._tcp",
        "_rfb._tcp",
        "_http._tcp",
    ]
    private static let browseTime: TimeInterval = 3
    private static let resolveTimeout: TimeInterval = 2
    private static let queue = DispatchQueue(label: "BonjourNames")

    private struct Found {
        let endpoint: NWEndpoint
        let name: String
        let priority: Int
    }

    static func collect() async -> [String: String] {
        let found = await browse()
        let resolved = await withTaskGroup(of: (String, Found)?.self) { group in
            for item in found {
                group.addTask { await ipv4(of: item.endpoint).map { ($0, item) } }
            }
            var result: [(String, Found)] = []
            for await item in group {
                if let item { result.append(item) }
            }
            return result
        }
        var best: [String: Found] = [:]
        for (ip, item) in resolved where LocalNetworkScanner.isPrivate(ip) {
            if let current = best[ip], current.priority <= item.priority { continue }
            best[ip] = item
        }
        return best.mapValues(\.name)
    }

    /// Every instance announced of the services, during the browse time
    private static func browse() async -> [Found] {
        await withCheckedContinuation { continuation in
            // Only touched on the serial queue of the browsers
            let found = Box<[NWEndpoint: Found]>([:])
            let browsers = serviceTypes.enumerated().map { priority, type in
                let browser = NWBrowser(for: .bonjourWithTXTRecord(type: type, domain: nil), using: .tcp)
                browser.browseResultsChangedHandler = { results, _ in
                    for result in results {
                        guard case .service(let instance, _, _, _) = result.endpoint else { continue }
                        var name = instance
                        if case .bonjour(let txt) = result.metadata, let friendly = txt["fn"], !friendly.isEmpty {
                            name = friendly
                        }
                        found.value[result.endpoint] = Found(endpoint: result.endpoint, name: name, priority: priority)
                    }
                }
                browser.start(queue: queue)
                return browser
            }
            queue.asyncAfter(deadline: .now() + browseTime) {
                browsers.forEach { $0.cancel() }
                continuation.resume(returning: Array(found.value.values))
            }
        }
    }

    /// The IPv4 address of a service, connecting to it over IPv4
    private static func ipv4(of endpoint: NWEndpoint) async -> String? {
        await withCheckedContinuation { continuation in
            let parameters = NWParameters.tcp
            (parameters.defaultProtocolStack.internetProtocol as? NWProtocolIP.Options)?.version = .v4
            let connection = NWConnection(to: endpoint, using: parameters)
            let once = Once()
            let finish = { (ip: String?) in
                guard once.claim() else { return }
                connection.cancel()
                continuation.resume(returning: ip)
            }
            connection.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    if case .hostPort(let host, _) = connection.currentPath?.remoteEndpoint, case .ipv4(let address) = host {
                        finish("\(address)".components(separatedBy: "%").first)
                    } else {
                        finish(nil)
                    }
                case .failed, .cancelled:
                    finish(nil)
                default:
                    break
                }
            }
            connection.start(queue: queue)
            queue.asyncAfter(deadline: .now() + resolveTimeout) { finish(nil) }
        }
    }
}

/// A value shared by callbacks that all run on the same serial queue
private final class Box<Value>: @unchecked Sendable {
    var value: Value
    init(_ value: Value) { self.value = value }
}

/// Lets only the first of the callbacks racing to finish a connection resume it
private final class Once: @unchecked Sendable {
    private let lock = NSLock()
    private var claimed = false

    func claim() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        if claimed { return false }
        claimed = true
        return true
    }
}
