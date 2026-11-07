import SwiftUI

@main
struct ResearchToolkitApp: App {
    var body: some Scene {
        WindowGroup {
            WebAppView()
                .ignoresSafeArea()
        }
        .defaultSize(width: 1400, height: 900)
    }
}
