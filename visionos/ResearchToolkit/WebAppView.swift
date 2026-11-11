import SwiftUI
import UIKit
import WebKit

struct WebAppView: UIViewControllerRepresentable {
    @Environment(\.openWindow) private var openWindow

    func makeUIViewController(context: Context) -> WebAppViewController {
        ARWindowStore.shared.openWindow = { [openWindow] group, id in openWindow(id: group, value: id) }
        return WebAppViewController()
    }
    func updateUIViewController(_ controller: WebAppViewController, context: Context) {}
}

final class WebAppViewController: UIViewController {
    private var webView: WKWebView!
    private var pendingDownloads: [WKDownload: URL] = [:]

    override func viewDidLoad() {
        super.viewDidLoad()

        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(BundleSchemeHandler(), forURLScheme: BundleSchemeHandler.scheme)
        config.websiteDataStore = .default() // keeps IndexedDB between launches

        // AR bridge: .ar on the body lets styles target AR, and onAREntry opens AR windows (see ARWindows.swift)
        config.userContentController.addUserScript(WKUserScript(
            source: "document.body.classList.add('ar')",
            injectionTime: .atDocumentEnd,
            forMainFrameOnly: true
        ))
        config.userContentController.add(ARBridgeHandler(), name: ARBridgeHandler.name)
        // ARDiv opens its window after measuring, which may be past the tap that triggered it
        config.preferences.javaScriptCanOpenWindowsAutomatically = true
        #if DEBUG
        // Page errors and ARDiv's own logs, as `window.webkit.messageHandlers.arLog.postMessage(...)`
        config.userContentController.add(ARDebugLogHandler(), name: ARDebugLogHandler.name)
        config.userContentController.addUserScript(WKUserScript(
            source: ARDebugLogHandler.errorForwarder,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))
        #endif

        webView = WKWebView(frame: view.bounds, configuration: config)
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.isInspectable = true // Safari ▸ Develop menu on the Mac
        view.addSubview(webView)

        webView.load(URLRequest(url: BundleSchemeHandler.startURL))
        ARWindowStore.shared.mainWebView = webView
        #if DEBUG
        DOMSnapshotter.shared.start(page: webView)
        ARMetricsLogger.shared.start(page: webView)
        #endif

        ARWindowStore.shared.onExit = { [weak self] id in
            self?.webView.callAsyncJavaScript(
                "window.dispatchEvent(new CustomEvent('arexit', { detail: { id } }))",
                arguments: ["id": id],
                in: nil,
                in: .page
            )
        }
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        if let session = view.window?.windowScene?.session {
            ARWindowStore.shared.closeLeftoverWindows(keeping: session)
        }
    }

    fileprivate static func isExternal(_ url: URL) -> Bool {
        ["http", "https", "mailto"].contains(url.scheme?.lowercased() ?? "")
    }
}

// MARK: - Navigation and downloads

extension WebAppViewController: WKNavigationDelegate, WKDownloadDelegate {
    func webView(
        _ webView: WKWebView,
        decidePolicyFor action: WKNavigationAction
    ) async -> WKNavigationActionPolicy {
        if action.shouldPerformDownload { return .download }
        // Links that leave the app open in Safari instead of replacing it.
        if let url = action.request.url, action.targetFrame?.isMainFrame == true, Self.isExternal(url) {
            await UIApplication.shared.open(url)
            return .cancel
        }
        return .allow
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func download(
        _ download: WKDownload,
        decideDestinationUsing response: URLResponse,
        suggestedFilename: String
    ) async -> URL? {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let destination = dir.appendingPathComponent(suggestedFilename)
        pendingDownloads[download] = destination
        return destination
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let file = pendingDownloads.removeValue(forKey: download) else { return }
        // Let the user choose where to save it (Files, iCloud Drive, …).
        let picker = UIDocumentPickerViewController(forExporting: [file], asCopy: true)
        present(picker, animated: true)
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        pendingDownloads.removeValue(forKey: download)
    }
}

// MARK: - window.open / target="_blank"

extension WebAppViewController: WKUIDelegate {
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for action: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        // window.open('', id) from ARDiv, announced through onAREntry
        let url = action.request.url
        arLog("createWebViewWith url: \(url?.absoluteString ?? "nil")")
        if url == nil || url?.absoluteString == "about:blank" || url?.absoluteString == "" {
            let popup = WKWebView(frame: .zero, configuration: configuration)
            popup.uiDelegate = self
            if ARWindowStore.shared.adopt(popup) { return popup }
        }

        guard let url else { return nil }

        if Self.isExternal(url) {
            UIApplication.shared.open(url)
            return nil
        }

        // blob: and app: URLs (PDF pages, diagrams) open in a sheet above the app.
        let popup = PopupViewController(configuration: configuration)
        present(UINavigationController(rootViewController: popup), animated: true)
        return popup.webView
    }

    func webViewDidClose(_ webView: WKWebView) {
        // ARDiv unmounted, closing its popup
        if let id = ARWindowStore.shared.id(of: webView) { ARWindowStore.shared.remove(id) }
    }
}

private final class PopupViewController: UIViewController, WKUIDelegate {
    let webView: WKWebView

    init(configuration: WKWebViewConfiguration) {
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init(nibName: nil, bundle: nil)
        webView.uiDelegate = self
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func loadView() { view = webView }

    override func viewDidLoad() {
        super.viewDidLoad()
        navigationItem.rightBarButtonItem = UIBarButtonItem(
            systemItem: .close,
            primaryAction: UIAction { [weak self] _ in self?.dismiss(animated: true) }
        )
    }

    func webViewDidClose(_ webView: WKWebView) {
        dismiss(animated: true)
    }
}
