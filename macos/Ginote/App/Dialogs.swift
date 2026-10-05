import AppKit

/// 확인 대화상자. 창이 있으면 그 창에 붙는 시트로, 없으면 별도 창으로 묻는다.
@MainActor
enum Dialogs {
    #if DEBUG
    /// 자가 점검이 묻지 않고 답할 값. 질문과 알림은 기록으로 남긴다.
    static var autoAnswer: Bool?
    static var log: [String] = []
    /// 파일 고르기·저장 위치 창에 자가 점검이 대신 고를 값. nil이면 취소한 것으로 본다.
    static var autoFiles: [URL]?
    static var autoSaveURL: URL?
    #endif

    static func confirm(_ message: String, confirmTitle: String = String(localized: "확인"), cancelTitle: String = String(localized: "취소"), destructive: Bool = false) async -> Bool {
        #if DEBUG
        if let autoAnswer { log.append("confirm: \(message)"); return autoAnswer }
        #endif
        let alert = confirmAlert(message, confirmTitle: confirmTitle, cancelTitle: cancelTitle, destructive: destructive)
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
        let alert = informAlert(message, detail: detail)
        if let window = NSApp.keyWindow ?? NSApp.mainWindow {
            alert.beginSheetModal(for: window)
        } else {
            alert.runModal()
        }
    }

    /// 여러 파일을 고른다. 창이 있으면 그 창에 붙는 시트로 띄운다. 취소하면 빈 배열.
    static func chooseFiles(message: String) async -> [URL] {
        #if DEBUG
        if autoAnswer != nil { log.append("choose: \(message)"); return autoFiles ?? [] }
        #endif
        let panel = openPanel(message: message)
        if let window = NSApp.keyWindow {
            let response = await panel.beginSheetModal(for: window)
            return response == .OK ? panel.urls : []
        }
        return panel.runModal() == .OK ? panel.urls : []
    }

    /// 저장할 위치를 묻는다. 취소하면 nil.
    static func saveLocation(suggestedName: String) -> URL? {
        #if DEBUG
        if autoAnswer != nil { log.append("save: \(suggestedName)"); return autoSaveURL }
        #endif
        let panel = savePanel(suggestedName: suggestedName)
        return panel.runModal() == .OK ? panel.url : nil
    }

    // MARK: - 창 만들기(띄우기 전까지)

    static func confirmAlert(_ message: String, confirmTitle: String, cancelTitle: String, destructive: Bool) -> NSAlert {
        let alert = NSAlert()
        alert.messageText = message
        alert.alertStyle = destructive ? .critical : .warning
        let confirm = alert.addButton(withTitle: confirmTitle)
        if destructive { confirm.hasDestructiveAction = true }
        alert.addButton(withTitle: cancelTitle)
        return alert
    }

    static func informAlert(_ message: String, detail: String?) -> NSAlert {
        let alert = NSAlert()
        alert.messageText = message
        if let detail { alert.informativeText = detail }
        alert.addButton(withTitle: String(localized: "확인"))
        return alert
    }

    static func openPanel(message: String) -> NSOpenPanel {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        panel.message = message
        return panel
    }

    static func savePanel(suggestedName: String) -> NSSavePanel {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = suggestedName
        return panel
    }
}
