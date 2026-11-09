import Foundation
import UniformTypeIdentifiers
import WebKit

/// Serves the built web app (the `web` folder copied from `dist/`) under `app://localhost/`.
/// A real origin, unlike `file://`, lets ES modules, workers and IndexedDB work.
final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "app"
    static let startURL = URL(string: "\(scheme)://localhost/index.html")!

    private let root = Bundle.main.resourceURL!.appendingPathComponent("web", isDirectory: true)

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else {
            task.didFailWithError(URLError(.badURL))
            return
        }

        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }
        var file = root.appendingPathComponent(String(path.dropFirst()))

        // Unknown paths fall back to index.html so client-side routes still load.
        if !FileManager.default.fileExists(atPath: file.path) {
            file = root.appendingPathComponent("index.html")
        }

        guard let data = try? Data(contentsOf: file) else {
            task.didFailWithError(URLError(.fileDoesNotExist))
            return
        }

        let response = HTTPURLResponse(
            url: url,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: [
                "Content-Type": Self.mimeType(for: file),
                "Content-Length": String(data.count),
                "Access-Control-Allow-Origin": "*",
            ]
        )!
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}

    private static func mimeType(for file: URL) -> String {
        switch file.pathExtension.lowercased() {
        case "js", "mjs": return "text/javascript"
        case "wasm": return "application/wasm"
        case "json", "map": return "application/json"
        default:
            return UTType(filenameExtension: file.pathExtension)?.preferredMIMEType
                ?? "application/octet-stream"
        }
    }
}
