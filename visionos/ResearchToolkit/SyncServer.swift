import Foundation
import Network
import UIKit

/// The sync server of the visionOS app (see SyncHost on src/utils/nativeBridge.ts, which documents the routes).
/// It only relays: what arrives waits on the inbox until the web app takes it.
/// It announces itself over Bonjour and finds the other native apps doing the same
final class SyncServer: @unchecked Sendable {
    /// Must match SYNC_PORT of src/features/Sync/network.ts
    static let port: NWEndpoint.Port = 47816
    /// Must match the one the other native shells announce and browse, and NSBonjourServices of Info.plist
    static let serviceType = "_researchsync._tcp"
    private static let app = "research-toolkit"
    private static let maxBody = 64 * 1024 * 1024
    private static let resolveTimeout: TimeInterval = 3

    let id: String
    let name: String
    private let listener: NWListener
    private let browser: NWBrowser
    /// Everything below is only touched on this queue
    private let queue = DispatchQueue(label: "SyncServer")
    private var inbox: [[String: Any]] = []
    private var held: [String: [String]] = [:]
    /// The native apps found, by their Bonjour endpoint
    private var peers: [NWEndpoint: [String: Any]] = [:]

    @MainActor
    init(id: String) throws {
        self.id = id
        name = UIDevice.current.name
        let parameters = NWParameters.tcp
        parameters.allowLocalEndpointReuse = true
        listener = try NWListener(using: parameters, on: Self.port)
        listener.service = NWListener.Service(name: name, type: Self.serviceType, domain: nil, txtRecord: NWTXTRecord(["id": id]))
        browser = NWBrowser(for: .bonjourWithTXTRecord(type: Self.serviceType, domain: nil), using: .tcp)

        listener.newConnectionHandler = { [weak self] connection in self?.serve(connection) }
        listener.start(queue: queue)
        browser.browseResultsChangedHandler = { [weak self] results, _ in self?.update(results) }
        browser.start(queue: queue)
    }

    func stop() {
        listener.cancel()
        browser.cancel()
    }

    func currentPeers() -> [[String: Any]] {
        queue.sync { Array(peers.values) }
    }

    func takeInbox() -> [[String: Any]] {
        queue.sync {
            let taken = inbox
            inbox = []
            return taken
        }
    }

    func hold(to: String, body: String) {
        queue.async { self.held[to, default: []].append(body) }
    }

    // MARK: Finding the other native apps

    /// Runs on the queue
    private func update(_ results: Set<NWBrowser.Result>) {
        let endpoints = Set(results.map(\.endpoint))
        peers = peers.filter { endpoints.contains($0.key) }
        for result in results where peers[result.endpoint] == nil {
            guard case .service(let instance, _, _, _) = result.endpoint,
                  case .bonjour(let txt) = result.metadata, let peerId = txt["id"], peerId != id
            else { continue }
            resolve(result.endpoint) { [weak self] address in
                guard let self, let address else { return }
                self.queue.async {
                    self.peers[result.endpoint] = ["id": peerId, "name": instance, "ip": address.ip, "port": address.port]
                }
            }
        }
    }

    /// The IPv4 address and port of a service, connecting to it over IPv4
    private func resolve(_ endpoint: NWEndpoint, completion: @escaping @Sendable ((ip: String, port: Int)?) -> Void) {
        let parameters = NWParameters.tcp
        (parameters.defaultProtocolStack.internetProtocol as? NWProtocolIP.Options)?.version = .v4
        let connection = NWConnection(to: endpoint, using: parameters)
        let once = SyncOnce()
        let finish = { (address: (ip: String, port: Int)?) in
            guard once.claim() else { return }
            connection.cancel()
            completion(address)
        }
        connection.stateUpdateHandler = { state in
            switch state {
            case .ready:
                if case .hostPort(let host, let port) = connection.currentPath?.remoteEndpoint, case .ipv4(let address) = host,
                   let ip = "\(address)".components(separatedBy: "%").first {
                    finish((ip, Int(port.rawValue)))
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
        queue.asyncAfter(deadline: .now() + Self.resolveTimeout) { finish(nil) }
    }

    // MARK: Serving

    private struct Request {
        let method: String
        let path: String
        let query: [String: String]
        let body: Data
    }

    /// One request per connection, closed after the response
    private func serve(_ connection: NWConnection) {
        connection.start(queue: queue)
        receive(connection, buffer: Data())
    }

    private func receive(_ connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 1 << 20) { [weak self] data, _, isComplete, error in
            guard let self else { return connection.cancel() }
            var buffer = buffer
            if let data { buffer.append(data) }
            switch Self.parse(buffer) {
            case .some(.some(let request)):
                self.handle(request, on: connection)
            case .some(.none):
                // Malformed or too large
                connection.cancel()
            case .none:
                if isComplete || error != nil { return connection.cancel() }
                self.receive(connection, buffer: buffer)
            }
        }
    }

    /// The request, nil while it hasn't fully arrived, or .some(nil) when it never will be a valid one
    private static func parse(_ buffer: Data) -> Request?? {
        guard let headEnd = buffer.range(of: Data("\r\n\r\n".utf8)) else {
            return buffer.count > 64 * 1024 ? .some(nil) : nil
        }
        guard let head = String(data: buffer[buffer.startIndex..<headEnd.lowerBound], encoding: .utf8) else { return .some(nil) }
        let lines = head.components(separatedBy: "\r\n")
        let requestLine = lines[0].split(separator: " ")
        guard requestLine.count >= 2 else { return .some(nil) }
        var length = 0
        for line in lines.dropFirst() {
            let parts = line.split(separator: ":", maxSplits: 1)
            if parts.count == 2, parts[0].trimmingCharacters(in: .whitespaces).lowercased() == "content-length" {
                length = Int(parts[1].trimmingCharacters(in: .whitespaces)) ?? 0
            }
        }
        guard length <= maxBody else { return .some(nil) }
        guard buffer.count - headEnd.upperBound >= length else { return nil }
        let body = buffer[headEnd.upperBound..<headEnd.upperBound + length]
        let components = URLComponents(string: String(requestLine[1]))
        var query: [String: String] = [:]
        for item in components?.queryItems ?? [] { query[item.name] = item.value ?? "" }
        return .some(Request(method: String(requestLine[0]), path: components?.path ?? "", query: query, body: Data(body)))
    }

    /// Runs on the queue
    private func handle(_ request: Request, on connection: NWConnection) {
        let hello: [String: Any] = ["app": Self.app, "id": id, "name": name]
        switch (request.method, request.path) {
        case ("OPTIONS", _):
            respond(connection, status: 204, json: nil)
        case ("GET", "/sync/hello"):
            respond(connection, status: 200, json: hello)
        case ("GET", "/sync/messages"):
            let to = request.query["for"] ?? ""
            let messages = held.removeValue(forKey: to) ?? []
            respond(connection, status: 200, json: messages)
        case ("POST", "/sync/announce"), ("POST", "/sync/message"):
            let route = request.path == "/sync/announce" ? "announce" : "message"
            inbox.append(["route": route, "ip": Self.ip(of: connection), "body": String(decoding: request.body, as: UTF8.self)])
            if route == "announce" { respond(connection, status: 200, json: hello) } else { respond(connection, status: 204, json: nil) }
        default:
            respond(connection, status: 404, json: ["error": "Not found"])
        }
    }

    private static func ip(of connection: NWConnection) -> String {
        guard case .hostPort(let host, _) = connection.endpoint else { return "" }
        switch host {
        case .ipv4(let address):
            return "\(address)".components(separatedBy: "%").first ?? ""
        case .ipv6(let address):
            let ip = "\(address)".components(separatedBy: "%").first ?? ""
            return ip.hasPrefix("::ffff:") ? String(ip.dropFirst("::ffff:".count)) : ip
        default:
            return "\(host)"
        }
    }

    private func respond(_ connection: NWConnection, status: Int, json: Any?) {
        let body = json.flatMap { try? JSONSerialization.data(withJSONObject: $0) } ?? Data()
        let reasons = [200: "OK", 204: "No Content", 404: "Not Found"]
        var head = "HTTP/1.1 \(status) \(reasons[status] ?? "Error")\r\n"
        head += "Access-Control-Allow-Origin: *\r\n"
        head += "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
        head += "Access-Control-Allow-Headers: Content-Type\r\n"
        head += "Access-Control-Allow-Private-Network: true\r\n"
        head += "Connection: close\r\n"
        head += "Content-Length: \(body.count)\r\n"
        if json != nil { head += "Content-Type: application/json\r\n" }
        head += "\r\n"
        connection.send(content: Data(head.utf8) + body, completion: .contentProcessed { _ in connection.cancel() })
    }

    // MARK: Reaching the other devices

    /// POSTs the body to another device, as { status, body }
    static func post(url: String, body: String) async throws -> [String: Any] {
        guard let target = URL(string: url) else { throw URLError(.badURL) }
        var request = URLRequest(url: target, timeoutInterval: 30)
        request.httpMethod = "POST"
        request.setValue("text/plain", forHTTPHeaderField: "Content-Type")
        request.httpBody = Data(body.utf8)
        let (data, response) = try await URLSession.shared.data(for: request)
        return ["status": (response as? HTTPURLResponse)?.statusCode ?? 0, "body": String(decoding: data, as: UTF8.self)]
    }
}

/// Lets only the first of the callbacks racing to finish a connection go on
private final class SyncOnce: @unchecked Sendable {
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
