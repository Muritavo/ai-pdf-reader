#if DEBUG
import WebKit

/// Debug builds only: prints what the page sends to `window.webkit.messageHandlers.arLog`
@MainActor
final class ARDebugLogHandler: NSObject, WKScriptMessageHandler {
    static let name = "arLog"

    /// Forwards uncaught page errors to the same log
    static let errorForwarder = """
    window.addEventListener('error', (e) => window.webkit.messageHandlers.arLog.postMessage('error: ' + e.message + ' @ ' + e.filename + ':' + e.lineno));
    window.addEventListener('unhandledrejection', (e) => window.webkit.messageHandlers.arLog.postMessage('rejection: ' + String(e.reason)));
    """

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        arLog("page: \(message.body)")
    }
}
#endif
