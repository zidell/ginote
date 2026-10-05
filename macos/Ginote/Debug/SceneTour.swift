#if DEBUG
import AppKit

/// 선택 E2E와 화면 점검에서 쓰는 캡처 도구.
@MainActor
enum SceneTour {
    static var directory: URL!
    static var index = 0

    static func mainWindow() -> NSWindow? {
        NSApp.windows.filter { $0.isVisible && $0.frame.width >= 700 && $0.title != "Ginote 도움말" }
            .max { $0.frame.width < $1.frame.width }
    }

    static func settingsWindow() -> NSWindow? {
        NSApp.windows.first { $0.isVisible && $0.identifier?.rawValue.contains("Settings") == true }
            ?? NSApp.windows.first { $0.isVisible && $0.frame.width < 700 && $0.frame.width > 400 }
    }

    static func snap(_ name: String, window: NSWindow? = nil) async {
        guard let window = window ?? mainWindow(), let view = window.contentView?.superview ?? window.contentView else { return }
        guard let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return }
        view.cacheDisplay(in: view.bounds, to: rep)
        index += 1
        let url = directory.appendingPathComponent("\(name).png")
        try? rep.representation(using: .png, properties: [:])?.write(to: url)
    }
}
#endif
