import SwiftUI

@main
struct ResearchToolkitApp: App {
    var body: some Scene {
        WindowGroup(id: ARWindowStore.mainWindowID) {
            WebAppView()
                .ignoresSafeArea()
                .onAppear { ARWindowStore.shared.mainWindowOpen = true }
                .onDisappear {
                    ARWindowStore.shared.mainWindowOpen = false
                    ARWindowStore.shared.mainWindowClosed()
                }
        }
        .defaultSize(width: 1400, height: 900)

        ARWindowScenes()
    }
}

/// The window groups of the content lifted from the page by ARDiv (see ARWindows.swift): one per slot, then the shared one
struct ARWindowScenes: Scene {
    var body: some Scene {
        arWindowGroup(ARWindowStore.slotWindowID(0))
        arWindowGroup(ARWindowStore.slotWindowID(1))
        arWindowGroup(ARWindowStore.slotWindowID(2))
        arWindowGroup(ARWindowStore.slotWindowID(3))
        arWindowGroup(ARWindowStore.slotWindowID(4))
        arWindowGroup(ARWindowStore.slotWindowID(5))
        arWindowGroup(ARWindowStore.slotWindowID(6))
        arWindowGroup(ARWindowStore.slotWindowID(7))
        arWindowGroup(ARWindowStore.sharedWindowID)
    }

    private func arWindowGroup(_ group: String) -> some Scene {
        WindowGroup(id: group, for: String.self) { $id in
            if let id { ARWindowView(group: group, id: id) }
        }
        // Opens at the measured size, and with `snapToWindow: "right"` on the right of the window its ARDiv is in,
        // found by its group (a slot is told apart; the shared group is not, so the first of its windows is taken)
        .defaultWindowPlacement { _, context in
            MainActor.assumeIsolated {
                let store = ARWindowStore.shared
                guard let id = store.placing, let entry = store.entries[id] else { return WindowPlacement() }
                let request = entry.request
                if request.snapToWindow == "right",
                   let parentGroup = store.group(of: request.parent),
                   let parent = context.windows.first(where: { $0.id == parentGroup }) {
                    arLog("placing \(id) on the right of \(request.parent) (\(parentGroup))")
                    return WindowPlacement(.trailing(parent), size: entry.size)
                }
                return WindowPlacement(nil as WindowPlacement.Position?, size: entry.size)
            }
        }
    }
}
