import AppKit

/// 확인 대화상자. 창이 있으면 그 창에 붙는 시트로, 없으면 별도 창으로 묻는다.
@MainActor
enum Dialogs {
    #if DEBUG
    /// 자가 점검이 묻지 않고 답할 값. 질문과 알림은 기록으로 남긴다.
    static var autoAnswer: Bool?
    static var log: [String] = []
    #endif

    static func confirm(_ message: String, confirmTitle: String = String(localized: "확인"), cancelTitle: String = String(localized: "취소"), destructive: Bool = false) async -> Bool {
        #if DEBUG
        if let autoAnswer { log.append("confirm: \(message)"); return autoAnswer }
        #endif
        let alert = NSAlert()
        alert.messageText = message
        alert.alertStyle = destructive ? .critical : .warning
        let confirm = alert.addButton(withTitle: confirmTitle)
        if destructive { confirm.hasDestructiveAction = true }
        alert.addButton(withTitle: cancelTitle)
        if let window = NSApp.keyWindow ?? NSApp.mainWindow {
            return await withCheckedContinuation { continuation in
                alert.beginSheetModal(for: window) { response in
                    continuation.resume(returning: response == .alertFirstButtonReturn)
                }
            }
        }
        return alert.runModal() == .alertFirstButtonReturn
    }

    static func inform(_ message: String, detail: String? = nil) {
        #if DEBUG
        if autoAnswer != nil { log.append("inform: \(message) \(detail ?? "")"); return }
        #endif
        let alert = NSAlert()
        alert.messageText = message
        if let detail { alert.informativeText = detail }
        alert.addButton(withTitle: String(localized: "확인"))
        if let window = NSApp.keyWindow ?? NSApp.mainWindow {
            alert.beginSheetModal(for: window)
        } else {
            alert.runModal()
        }
    }
}
