#if DEBUG
import AppKit
import GinoteCore

/// 디버그 빌드 전용 화면 순회. 실제 동작을 차례로 실행하고 창을 PNG로 남긴다(GINOTE_SHOT_DIR).
/// 포커스·마우스에 기대지 않으므로 같은 순서로 다시 돌릴 수 있다. 사람이 그림을 보고 판단한다.
///
///   GINOTE_SELF_TEST=tour GINOTE_SHOT_DIR=<폴더> … (SelfTest.swift의 다른 변수와 같음)
@MainActor
enum SceneTour {
    static var directory: URL!
    static var index = 0

    static func run(app: AppModel, repo: String, token: String) async {
        directory = URL(fileURLWithPath: ProcessInfo.processInfo.environment["GINOTE_SHOT_DIR"] ?? NSTemporaryDirectory())
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        if app.settings.workspaces.isEmpty { app.addWorkspace(repo: repo, token: token, remember: false) }

        // 1. 연결 직후 로딩(스켈레톤)
        await burst("01-launch", times: [0.3, 0.8, 1.6])
        _ = await SelfTest.wait("tour connect", timeout: 30) { app.workspace?.issues.isEmpty == false }
        guard let workspace = app.workspace else { return finish() }
        try? await Task.sleep(for: .seconds(2.5))
        workspace.openedId = nil
        workspace.selection = []
        try? await Task.sleep(for: .seconds(0.8))
        await snap("02-loaded-badges")

        // 2. 태그가 붙은 노트(목록 표시)
        // 본문이 있어야 태그 저장이 된다(첫 줄 제목 모드에서 빈 본문은 제목이 없어 저장하지 않는다, 웹과 같음).
        let plain = workspace.displayedIssues.first { !$0.isLocked && !($0.body ?? "").isEmpty && AttachmentLinks.parsePaths($0.body ?? "").isEmpty && ($0.comments ?? 0) == 0 }
        if let plain {
            let session = workspace.session(for: plain)
            if !session.visibleLabels.contains("qa태그") {
                session.setLabels(session.visibleLabels + ["qa태그"], saveNow: true)
                _ = await SelfTest.wait("tour tag save", timeout: 20) { !session.dirty && !session.saving }
            }
            await snap("03-list-with-tag")

            // 3. 첨부 없는 노트 열기(깜빡임 확인)
            workspace.open(plain.id)
            await burst("04-open-plain", times: [0.05, 0.15, 0.3, 0.6, 1.2, 2.0])
        }

        // 4. 첨부 있는 노트
        if let attached = workspace.displayedIssues.first(where: { !$0.isLocked && !AttachmentLinks.parsePaths($0.body ?? "").isEmpty }) {
            workspace.open(attached.id)
            await burst("05-open-attached", times: [0.05, 0.3, 0.8, 2.0])
            // 미리보기
            performMenu("Markdown 미리보기")
            await burst("06-preview", times: [0.6])
            performMenu("Markdown 미리보기")
        }

        // 5. 기록(댓글)이 있는 노트
        if let commented = workspace.displayedIssues.first(where: { ($0.comments ?? 0) > 0 && !$0.isLocked }) {
            workspace.open(commented.id)
            await burst("07-comments", times: [0.1, 0.5, 2.5])
        }

        // 5-1. 여러 개 선택(마지막으로 누른 노트 미리보기)
        let picks = workspace.displayedIssues.filter { !$0.isLocked }.prefix(3).map(\.id)
        if picks.count == 3 {
            workspace.selection = Set(picks)
            workspace.selectionPreviewId = picks[1]
            await burst("07b-multi", times: [0.6])
            workspace.selection = []
        }

        // 6. 새 노트
        _ = workspace.createNote()
        await burst("08-new-note", times: [0.05, 0.3, 1.0, 2.0])

        // 7. 잠긴 노트
        if let locked = workspace.displayedIssues.first(where: { $0.isLocked }) {
            workspace.open(locked.id)
            await burst("09-locked", times: [0.5, 1.5])
            workspace.sessions[locked.number]?.lockPrompt = nil
            try? await Task.sleep(for: .seconds(0.5))
        }

        // 8. 휴지통
        workspace.scope = .trash
        await burst("10-trash", times: [0.1, 0.5, 2.0])
        workspace.scope = .notes
        _ = await SelfTest.wait("tour notes", timeout: 20) { !workspace.loading }

        // 9. 별도 제목 모드, 라이트 테마, 확대
        if let plain { workspace.open(plain.id) }
        app.updateSettings { $0.preferences.titleMode = .separate }
        await burst("11-separate-title", times: [0.8])
        // 라이트·확대는 기록이 있는 노트로 본다(본문 아래 기록 배치 확인).
        if let commented = workspace.displayedIssues.first(where: { ($0.comments ?? 0) > 0 && !$0.isLocked }) { workspace.open(commented.id) }
        app.updateSettings { $0.preferences.titleMode = .firstLine; $0.preferences.theme = .light }
        await burst("12-light", times: [0.8])
        app.updateSettings { $0.preferences.theme = .dark; $0.preferences.uiScale = 1.3 }
        await burst("13-zoom", times: [0.8])
        app.updateSettings { $0.preferences.theme = .system; $0.preferences.uiScale = 1.0 }

        // 10. 음성(키 없음)
        if let session = workspace.sessions.values.first {
            VoiceLauncher.start(.body, session: session)
            await burst("14-voice-nokey", times: [0.8])
            app.voiceRequest = nil
            try? await Task.sleep(for: .seconds(0.5))
        }

        // 11. 설정 각 탭
        // macOS 14에서는 showSettingsWindow:가 듣지 않는다. 앱 메뉴의 "설정…"을 누른다.
        if let appMenu = NSApp.mainMenu?.items.first?.submenu,
           let index = appMenu.items.firstIndex(where: { $0.title.hasPrefix("설정") || $0.title.hasPrefix("Settings") }) {
            appMenu.performActionForItem(at: index)
        }
        try? await Task.sleep(for: .seconds(1))
        for (tab, name) in [(SettingsTab.general, "general"), (.editor, "editor"), (.list, "list"), (.workspaces, "workspaces"), (.voice, "voice"), (.shortcuts, "shortcuts")] {
            app.settingsTab = tab
            try? await Task.sleep(for: .seconds(0.8))
            await snap("15-settings-\(name)", window: settingsWindow())
        }
        settingsWindow()?.close()

        // 12. 도움말
        performMenu("Ginote 도움말")
        try? await Task.sleep(for: .seconds(1))
        await snap("16-help", window: NSApp.windows.first { $0.title == "Ginote 도움말" })
        finish()
    }

    static func finish() {
        SelfTest.report("TOUR done \(index) shots in \(directory.path)")
        exit(0)
    }

    static func mainWindow() -> NSWindow? {
        NSApp.windows.filter { $0.isVisible && $0.frame.width >= 700 && $0.title != "Ginote 도움말" }
            .max { $0.frame.width < $1.frame.width }
    }

    static func settingsWindow() -> NSWindow? {
        NSApp.windows.first { $0.isVisible && $0.identifier?.rawValue.contains("Settings") == true }
            ?? NSApp.windows.first { $0.isVisible && $0.frame.width < 700 && $0.frame.width > 400 }
    }

    static func performMenu(_ title: String) {
        func find(_ menu: NSMenu) -> (NSMenu, Int)? {
            for (i, item) in menu.items.enumerated() {
                if item.title == title { return (menu, i) }
                if let sub = item.submenu, let found = find(sub) { return found }
            }
            return nil
        }
        mainWindow()?.makeKeyAndOrderFront(nil)
        if let main = NSApp.mainMenu, let (menu, i) = find(main) { menu.update(); menu.performActionForItem(at: i) }
    }

    static func burst(_ name: String, times: [Double]) async {
        var elapsed = 0.0
        for (n, time) in times.enumerated() {
            try? await Task.sleep(for: .seconds(max(0, time - elapsed)))
            elapsed = time
            await snap("\(name)-\(n + 1)")
        }
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
