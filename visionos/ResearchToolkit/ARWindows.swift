import SwiftUI
import WebKit

/// Debug builds only: AR logs, read with `devicectl device process launch --console`
func arLog(_ message: @autoclosure () -> String) {
    #if DEBUG
    print("[AR] \(message())")
    #endif
}

/// Windows holding content the page lifts out of itself with ARDiv (one-ui).
///
/// The page posts `onAREntry({ id, width, height })` and then calls `window.open('', id)`.
/// The popup web view WebKit asks for is shown in its own window with that size, and the page renders
/// into it through a React portal, so state and events stay in the main page.
@MainActor
final class ARWindowStore: ObservableObject {
    static let shared = ARWindowStore()
    static let mainWindowID = "main"
    /// AR windows go in slots, window groups of their own, so placement can tell them apart: visionOS only tells the
    /// group of each window, not the value it was opened with. Past the slots, windows go in a shared group
    static let slotCount = 8
    static let sharedWindowID = "ar"
    static func slotWindowID(_ slot: Int) -> String { "ar-slot-\(slot)" }
    static let arWindowIDs = (0..<slotCount).map(slotWindowID) + [sharedWindowID]

    struct Entry {
        let webView: WKWebView
        /// The measured size the window opens with; the user may resize it afterwards
        let size: CGSize
        let request: Request
        /// The window group it was opened in: a slot of its own, or the shared one once every slot is taken
        let group: String
        /// The web view of the window it was opened from, given the focus back once it shows (when `focus` is false)
        weak var returnFocusTo: WKWebView?
    }

    /// What the page asks for through onAREntry
    struct Request {
        let id: String
        let size: CGSize
        /// The window the ARDiv is rendered in: "main", or the id of the AR window it was lifted into
        let parent: String
        /// The side of that window to open on ("right"), if any
        let snapToWindow: String?
        /// Whether the window takes the focus when it opens
        let focus: Bool
        /// How the window shows and closes: "pop" grows in like a bubble and pops when it closes
        let effect: String?
    }

    @Published private(set) var entries: [String: Entry] = [:]
    /// Requests reported before their popup exists, in the order the page opens them
    private var pending: [Request] = []

    /// Opens a window of the given group, for the given AR id
    var openWindow: ((_ group: String, _ id: String) -> Void)?
    /// Whether the windows left from the last run were closed already, which happens once per launch
    private var leftoversClosed = false
    /// The window being opened, read by the scene's placement
    private(set) var placing: String?
    /// The web view of the main window, one of the windows that may have the focus
    weak var mainWebView: WKWebView?
    /// Whether the window with the page is showing, so an orphan AR window can bring it back
    var mainWindowOpen = false
    /// Tells the page the user closed an AR window
    var onExit: ((String) -> Void)?
    /// Whether the main window was closed, which ends the app
    private(set) var quitting = false

    func report(_ request: Request) {
        arLog("onAREntry \(request.id) \(request.size.width)x\(request.size.height) from \(request.parent) (snap: \(request.snapToWindow ?? "none"), focus: \(request.focus))")
        pending.append(request)
    }

    /// Closes the AR windows left from the last run, which visionOS restores although their page is gone.
    /// Called once the main window shows; any other window then, but the ones of open AR entries, is one of them
    func closeLeftoverWindows(keeping main: UISceneSession) {
        guard !leftoversClosed else { return }
        leftoversClosed = true
        let current = Set(entries.values.compactMap { $0.webView.window?.windowScene?.session })
        for session in UIApplication.shared.openSessions where session != main && !current.contains(session) {
            arLog("closing a window left from the last run")
            UIApplication.shared.requestSceneSessionDestruction(session, options: nil)
        }
    }

    /// The user closed the main window: closes every AR window and ends the app
    func mainWindowClosed() {
        guard !quitting else { return }
        quitting = true
        arLog("main window closed, closing everything")
        for session in UIApplication.shared.openSessions {
            UIApplication.shared.requestSceneSessionDestruction(session, options: nil)
        }
        // Once the windows had their moment to close, so none is restored on the next launch
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { exit(0) }
    }

    /// The window group of a window, by its id ("main" or an AR window's)
    func group(of window: String) -> String? {
        window == Self.mainWindowID ? Self.mainWindowID : entries[window]?.group
    }

    /// The web view of a window, by its id ("main" or an AR window's)
    func webView(of window: String) -> WKWebView? {
        window == Self.mainWindowID ? mainWebView : entries[window]?.webView
    }

    /// Shows the popup web view in a window, if the page announced one through onAREntry
    func adopt(_ webView: WKWebView) -> Bool {
        guard !pending.isEmpty else {
            arLog("popup requested with nothing pending")
            return false
        }
        let next = pending.removeFirst()
        let taken = Set(entries.values.map(\.group))
        let group = (0..<Self.slotCount).map(Self.slotWindowID).first { !taken.contains($0) } ?? Self.sharedWindowID
        entries[next.id] = Entry(
            webView: webView,
            size: next.size,
            request: next,
            group: group,
            returnFocusTo: next.focus ? nil : self.webView(of: next.parent)
        )
        placing = next.id
        arLog("opening window \(next.id) in \(group)")
        openWindow?(group, next.id)
        return true
    }

    func id(of webView: WKWebView) -> String? {
        entries.first { $0.value.webView === webView }?.key
    }

    /// The page closed the popup
    func remove(_ id: String) {
        arLog("page closed \(id)")
        entries[id] = nil
    }

    /// The user closed the window
    func closedByUser(_ id: String) {
        guard entries.removeValue(forKey: id) != nil else { return }
        arLog("user closed \(id)")
        onExit?(id)
    }
}

/// Receives `window.webkit.messageHandlers.onAREntry.postMessage({ id, width, height, parent, snapToWindow, focus, effect })`
@MainActor
final class ARBridgeHandler: NSObject, WKScriptMessageHandler {
    static let name = "onAREntry"

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let id = body["id"] as? String,
              let width = body["width"] as? Double,
              let height = body["height"] as? Double
        else { return }
        ARWindowStore.shared.report(ARWindowStore.Request(
            id: id,
            size: CGSize(width: width, height: height),
            parent: body["parent"] as? String ?? ARWindowStore.mainWindowID,
            snapToWindow: body["snapToWindow"] as? String,
            focus: body["focus"] as? Bool ?? true,
            effect: body["effect"] as? String
        ))
    }
}

struct ARWindowView: View {
    /// The window group it's in
    let group: String
    let id: String
    @ObservedObject private var store = ARWindowStore.shared
    @Environment(\.dismissWindow) private var dismissWindow
    @Environment(\.openWindow) private var openWindow
    /// Bubble effect: grows in once the page is sized, pops out before the window closes
    @State private var bubble = Bubble.hidden
    /// Whether the window asked for the bubble effect (`effect: "pop"`), kept as the entry is gone by the time it pops
    @State private var pops: Bool

    init(group: String, id: String) {
        self.group = group
        self.id = id
        _pops = State(initialValue: ARWindowStore.shared.entries[id]?.request.effect == "pop")
    }

    private enum Bubble { case hidden, shown, popped }

    var body: some View {
        ZStack {
            if let entry = store.entries[id] {
                WebViewHost(webView: entry.webView, initialSize: entry.size, returnFocusTo: entry.returnFocusTo) {
                    guard pops else { return }
                    withAnimation(.spring(response: 0.35, dampingFraction: 0.55)) { bubble = .shown }
                }
            }
        }
        // The glass is drawn here instead of by the window (plain style), so it grows and pops along with the page
        .glassBackgroundEffect()
        .scaleEffect(!pops || bubble == .shown ? 1 : bubble == .popped ? 1.08 : 0.6)
        .opacity(!pops || bubble == .shown ? 1 : 0)
        // Also closes windows restored from a previous launch, whose page is gone
        .onAppear {
            arLog("window \(id) appeared (entry: \(store.entries[id] != nil))")
        }
        .onChange(of: store.entries[id] == nil, initial: true) { _, gone in
            guard gone, !store.quitting else { return }
            if store.mainWindowOpen {
                pop { dismissWindow(id: group, value: id) }
                return
            }
            // An AR window with no page behind it (e.g. restored on its own) would leave the app without any window.
            // Checked a moment later, as a main window opening alongside it may not have appeared yet
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                if !store.mainWindowOpen && !store.quitting {
                    arLog("no main window, opening it")
                    openWindow(id: ARWindowStore.mainWindowID)
                }
                dismissWindow(id: group, value: id)
            }
        }
        .onDisappear { store.closedByUser(id) }
    }

    /// Pops the bubble, if it was shown, then runs the action
    private func pop(then action: @escaping () -> Void) {
        guard pops, bubble == .shown else { return action() }
        withAnimation(.easeOut(duration: 0.18)) { bubble = .popped }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.18, execute: action)
    }
}

private struct WebViewHost: UIViewRepresentable {
    let webView: WKWebView
    let initialSize: CGSize
    let returnFocusTo: WKWebView?
    let onReveal: () -> Void
    func makeUIView(context: Context) -> SizingHost {
        SizingHost(webView: webView, initialSize: initialSize, returnFocusTo: returnFocusTo, onReveal: onReveal)
    }
    func updateUIView(_ view: SizingHost, context: Context) {}
}

/// Sizes its window to the measured content once it's shown, then leaves resizing to the user.
///
/// The window opens at the system's default size before shrinking to the measured one, so the page stays hidden
/// (or the whole window, with the bubble effect of ARWindowView) until it gets there. WebKit lays the page out a moment after each size change, so while the user resizes
/// the window is blurred. Either way the page is shown only once it reports the new size and has painted it.
private final class SizingHost: UIView {
    /// How long the size must hold still to count the resize as done
    private static let settleDelay: TimeInterval = 0.15
    /// Longest wait for the page to lay out at the new size, so the window never stays hidden or blurred
    private static let layoutTimeout = 1000

    /// Resolves once the page reports the given size and has painted it (two frames later), or after the timeout
    private static let waitForLayout = """
    return await new Promise((resolve) => {
      const started = performance.now();
      const check = () => {
        const fits = Math.abs(innerWidth - width) <= 1 && Math.abs(innerHeight - height) <= 1;
        if (fits || performance.now() - started > timeout)
          return requestAnimationFrame(() => requestAnimationFrame(() => resolve(fits)));
        requestAnimationFrame(check);
      };
      check();
    });
    """
    /// Shows the page anyway if the window never reaches the measured size (e.g. clamped to a minimum)
    private static let revealTimeout: TimeInterval = 1.5

    private let webView: WKWebView
    private let initialSize: CGSize
    private weak var returnFocusTo: WKWebView?
    private let onReveal: () -> Void
    private let blur = UIVisualEffectView(effect: UIBlurEffect(style: .regular))
    private var sized = false
    private var revealed = false
    private var lastSize: CGSize = .zero
    private var settle: DispatchWorkItem?

    init(webView: WKWebView, initialSize: CGSize, returnFocusTo: WKWebView?, onReveal: @escaping () -> Void) {
        self.webView = webView
        self.initialSize = initialSize
        self.returnFocusTo = returnFocusTo
        self.onReveal = onReveal
        super.init(frame: .zero)
        webView.frame = bounds
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        webView.alpha = 0
        addSubview(webView)
        blur.frame = bounds
        blur.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        blur.alpha = 0
        blur.isUserInteractionEnabled = false
        addSubview(blur)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        guard !sized, let scene = window?.windowScene else { return }
        sized = true
        arLog("sizing window to \(initialSize.width)x\(initialSize.height)")
        scene.requestGeometryUpdate(.Vision(size: initialSize)) { [weak self] error in
            arLog("sizing failed: \(error)")
            self?.reveal()
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.revealTimeout) { [weak self] in self?.reveal() }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        let size = bounds.size
        guard size != lastSize else { return }
        lastSize = size

        if !revealed {
            let reached = abs(size.width - initialSize.width) < 1 && abs(size.height - initialSize.height) < 1
            if reached { afterLayout(of: size) { [weak self] in self?.reveal() } }
            return
        }

        // The user is resizing
        UIView.animate(withDuration: 0.15) { self.blur.alpha = 1 }
        afterLayout(of: size) { [weak self] in
            UIView.animate(withDuration: 0.25) { self?.blur.alpha = 0 }
        }
    }

    /// Runs the action once the size holds still and the page has painted at it, unless the size changed meanwhile
    private func afterLayout(of size: CGSize, _ action: @escaping () -> Void) {
        afterSettling { [weak self] in
            guard let self else { return }
            Task { @MainActor in
                let started = Date()
                let fits = try? await self.webView.callAsyncJavaScript(
                    Self.waitForLayout,
                    arguments: ["width": size.width, "height": size.height, "timeout": Self.layoutTimeout],
                    in: nil,
                    contentWorld: .page
                )
                guard self.bounds.size == size else { return }
                arLog("page laid out at \(size.width)x\(size.height) after \(Int(Date().timeIntervalSince(started) * 1000))ms (fits: \(fits.map { "\($0)" } ?? "unknown"))")
                action()
            }
        }
    }

    private func afterSettling(_ action: @escaping () -> Void) {
        settle?.cancel()
        let work = DispatchWorkItem(block: action)
        settle = work
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.settleDelay, execute: work)
    }

    private func reveal() {
        guard !revealed else { return }
        revealed = true
        arLog("revealing window at \(bounds.width)x\(bounds.height)")
        UIView.animate(withDuration: 0.2) { self.webView.alpha = 1 }
        onReveal()
        giveFocusBack()
    }

    /// Hands the focus back to the window it was opened from, so opening it doesn't interrupt what was being done there
    private func giveFocusBack() {
        guard let target = returnFocusTo, let targetWindow = target.window else { return }
        targetWindow.makeKey()
        let focused = target.becomeFirstResponder()
        arLog("focus given back (key: \(targetWindow.isKeyWindow), first responder: \(focused))")
    }
}
