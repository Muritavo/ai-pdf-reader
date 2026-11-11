#if DEBUG
import Foundation
import WebKit

/// Debug builds only: every 2 seconds, logs the window, viewport and text sizes of the page and of each AR window,
/// to compare how big the same content renders in each
@MainActor
final class ARMetricsLogger {
    static let shared = ARMetricsLogger()

    private weak var page: WKWebView?
    private var timer: Timer?

    /// Viewport and text size, as the page sees them
    private static let probe = """
    (() => {
      const content = document.body.classList.contains('ar-window')
        ? document.body.lastElementChild?.firstElementChild
        : document.body;
      const text = content?.querySelector('h1, h2, h3, p, label, button') ?? content;
      const vv = window.visualViewport;
      return JSON.stringify({
        viewport: innerWidth + 'x' + innerHeight,
        layout: document.documentElement.clientWidth + 'x' + document.documentElement.clientHeight,
        scale: vv ? +vv.scale.toFixed(3) : null,
        dpr: devicePixelRatio,
        viewportMeta: document.querySelector('meta[name=viewport]')?.content ?? null,
        content: content ? content.offsetWidth + 'x' + content.offsetHeight : null,
        text: text ? getComputedStyle(text).fontSize + ' <' + text.tagName.toLowerCase() + '>' : null,
      });
    })()
    """

    func start(page: WKWebView) {
        self.page = page
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { _ in
            Task { @MainActor in await ARMetricsLogger.shared.log() }
        }
    }

    private func log() async {
        guard let page else { return }
        await log("page", page)
        for (id, entry) in ARWindowStore.shared.entries.sorted(by: { $0.key < $1.key }) {
            await log(id, entry.webView)
        }
    }

    private func log(_ name: String, _ webView: WKWebView) async {
        let window = webView.window.map { "\(Int($0.bounds.width))x\(Int($0.bounds.height))" } ?? "none"
        let view = "\(Int(webView.bounds.width))x\(Int(webView.bounds.height))"
        let zoom = String(format: "%.3f", webView.scrollView.zoomScale)
        let metrics = (try? await webView.evaluateJavaScript(Self.probe)) as? String ?? "unavailable"
        arLog("metrics \(name): window \(window)pt, webView \(view)pt, zoom \(zoom), page \(metrics)")
    }
}
#endif
