#if DEBUG
import Foundation
import WebKit

/// Debug builds only: every second, saves the HTML of the page and of each AR window to
/// `Documents/dom-snapshot.html` when it changed, so it can be read from the Mac with
/// `xcrun devicectl device copy from --device <id> --domain-type appDataContainer
///  --domain-identifier io.github.muritavo.researchworkflow --source Documents/dom-snapshot.html --destination <dir>`
@MainActor
final class DOMSnapshotter {
    static let shared = DOMSnapshotter()

    private weak var page: WKWebView?
    private var timer: Timer?
    private var last = ""
    private var capturing = false
    private let file = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("dom-snapshot.html")

    func start(page: WKWebView) {
        self.page = page
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
            Task { @MainActor in await DOMSnapshotter.shared.capture() }
        }
    }

    private func capture() async {
        guard !capturing, let page else { return }
        capturing = true
        defer { capturing = false }

        var parts = ["<!-- page -->\n" + (await html(of: page))]
        for (id, entry) in ARWindowStore.shared.entries.sorted(by: { $0.key < $1.key }) {
            let size = "\(Int(entry.size.width))x\(Int(entry.size.height))"
            parts.append("<!-- ar window \(id) (\(size)) -->\n" + (await html(of: entry.webView)))
        }

        let snapshot = parts.joined(separator: "\n\n")
        guard snapshot != last else { return }
        last = snapshot
        try? snapshot.write(to: file, atomically: true, encoding: .utf8)
    }

    private func html(of webView: WKWebView) async -> String {
        (try? await webView.evaluateJavaScript("document.documentElement.outerHTML")) as? String
            ?? "<!-- unavailable -->"
    }
}
#endif
