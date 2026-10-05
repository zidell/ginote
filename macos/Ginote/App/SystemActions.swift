import AppKit
import SwiftUI

/// 클립보드·Finder·브라우저처럼 앱 밖을 건드리는 동작. 단위 테스트에서는 사용자 클립보드와 화면을 건드리지 않고
/// 따로 둔 클립보드에 쓰거나 기록만 남긴다.
@MainActor
enum SystemActions {
    static var pasteboard: NSPasteboard = AppModel.isUnitTest ? NSPasteboard(name: .init("ginote.unittest")) : .general
    static var downloadsDirectory: URL = AppModel.isUnitTest
        ? FileManager.default.temporaryDirectory.appendingPathComponent("ginote-unittest-downloads")
        : FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
    /// 키 창의 첫 응답자. 테스트는 화면에 띄우지 않은 창의 응답자로 바꿔 끼운다.
    static var keyResponder: () -> NSResponder? = { NSApp.keyWindow?.firstResponder }
    static var keyWindow: () -> NSWindow? = { NSApp.keyWindow }
    /// 설정 창이 떠 있는지(떠 있으면 목록을 뒤에서 다시 읽지 않는다).
    static var settingsWindowVisible: () -> Bool = {
        NSApp.windows.contains { $0.isVisible && $0.identifier?.rawValue.contains("Settings") == true }
    }
    /// 사용자가 보고 있는 창(키·주 창)인지. 테스트 창은 화면에 띄우지 않아 키 창이 되지 않으므로 바꿔 끼운다.
    static var isActiveWindow: (NSWindow) -> Bool = { $0.isKeyWindow || $0.isMainWindow }
    /// 단위 테스트에서 열거나 보여 주려 한 주소·창.
    static var log: [String] = []
    /// 프로필 사진 주소의 앞부분. 단위 테스트는 github.com에 요청하지 않게 임시 폴더를 쓴다.
    static var avatarBase: URL = AppModel.isUnitTest
        ? FileManager.default.temporaryDirectory.appendingPathComponent("ginote-unittest-avatars", isDirectory: true)
        : URL(string: "https://github.com/")!

    static func avatarURL(owner: String, size: Int) -> URL? {
        if AppModel.isUnitTest { return avatarBase.appendingPathComponent("\(owner).png") }
        return URL(string: "\(owner).png?size=\(size)", relativeTo: avatarBase)
    }

    static func copy(_ text: String) {
        pasteboard.clearContents()
        pasteboard.setString(text, forType: .string)
    }

    static func open(_ url: URL) {
        if AppModel.isUnitTest { log.append("open \(url.absoluteString)"); return }
        NSWorkspace.shared.open(url)
    }

    static func openSettings(_ action: OpenSettingsAction) {
        if AppModel.isUnitTest { log.append("settings"); return }
        action()
    }

    static func openWindow(_ action: OpenWindowAction, id: String) {
        if AppModel.isUnitTest { log.append("window \(id)"); return }
        action(id: id)
    }

    static func openWindow(_ action: OpenWindowAction, id: String, value: Int) {
        if AppModel.isUnitTest { log.append("window \(id) \(value)"); return }
        action(id: id, value: value)
    }

    /// Quick Look 패널. 단위 테스트에서는 띄우지 않고 기록만 남긴다.
    static func quickLook(_ quickLook: QuickLook, start: Int) {
        if AppModel.isUnitTest { log.append("quicklook \(quickLook.urls.count) \(start)"); return }
        quickLook.present(start: start)
    }

    /// 시스템 글꼴 패널. 단위 테스트에서는 띄우지 않는다.
    static func showFontPanel(_ manager: NSFontManager) {
        if AppModel.isUnitTest { log.append("fontpanel"); return }
        manager.orderFrontFontPanel(nil)
    }

    /// 경고음·알림음. 단위 테스트에서는 스피커로 내지 않고 기록만 남긴다.
    static func beep() {
        if AppModel.isUnitTest { log.append("beep"); return }
        NSSound.beep()
    }

    static func play(_ name: String) {
        if AppModel.isUnitTest { log.append("sound \(name)"); return }
        NSSound(named: name)?.play()
    }

    static func reveal(_ urls: [URL]) {
        if AppModel.isUnitTest { log.append("reveal \(urls.map(\.path).joined(separator: ","))"); return }
        NSWorkspace.shared.activateFileViewerSelecting(urls)
    }
}
