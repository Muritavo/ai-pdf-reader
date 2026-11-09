import SwiftUI
import UIKit
import WebKit

struct WebAppView: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> WebAppViewController { WebAppViewController() }
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

        webView = WKWebView(frame: view.bounds, configuration: config)
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.isInspectable = true // Safari ▸ Develop menu on the Mac
        view.addSubview(webView)

        webView.load(URLRequest(url: BundleSchemeHandler.startURL))
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
        guard let url = action.request.url else { return nil }

        if Self.isExternal(url) {
            UIApplication.shared.open(url)
            return nil
        }

        // blob: and app: URLs (PDF pages, diagrams) open in a sheet above the app.
        let popup = PopupViewController(configuration: configuration)
        present(UINavigationController(rootViewController: popup), animated: true)
        return popup.webView
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
