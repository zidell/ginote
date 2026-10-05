import AppKit
import GinoteCore
import SwiftUI

#if DEBUG

/// 디버그 빌드 전용 E2E. 앱을 앞으로 가져와 실제 이벤트 경로(키 감시·메뉴 단축키·첫 응답자)로 키와 클릭을
/// 보내고, 화면 모델·첫 응답자·GitHub 결과로 확인한다. 글자 입력은 입력기를 거치지 않게 첫 응답자에 직접 넣는다.
///
///   GINOTE_SELF_TEST=e2e GINOTE_SHOT_DIR=<캡처 폴더> 그 밖은 SelfTest와 같다.
///
/// 단계마다 창을 캡처해 GINOTE_SHOT_DIR에 남긴다.
@MainActor
enum E2E {
    static var shotIndex = 0
    static func check(_ condition: Bool, _ name: String, _ detail: @autoclosure () -> String = "") {
        SelfTest.check(condition, name, detail())
    }
    static var runId: String { SelfTest.runId }

    static var window: NSWindow? { SceneTour.mainWindow() }
    static var responder: String { window?.firstResponder.map { String(describing: type(of: $0)) } ?? "nil" }

    // MARK: - 이벤트

    static func settle(_ seconds: Double = 0.4) async { try? await Task.sleep(for: .seconds(seconds)) }

    static func bringToFront() {
        NSApp.activate(ignoringOtherApps: true)
        window?.makeKeyAndOrderFront(nil)
    }

    /// 특수 키 글자(NSEvent 함수 키 영역).
    enum Key {
        static let up: (UInt16, String) = (126, "\u{F700}")
        static let down: (UInt16, String) = (125, "\u{F701}")
        static let left: (UInt16, String) = (123, "\u{F702}")
        static let right: (UInt16, String) = (124, "\u{F703}")
        static let enter: (UInt16, String) = (36, "\r")
        static let escape: (UInt16, String) = (53, "\u{1b}")
        static let space: (UInt16, String) = (49, " ")
        static let delete: (UInt16, String) = (51, "\u{7f}")
    }

    static func key(_ key: (UInt16, String), _ modifiers: NSEvent.ModifierFlags = [], wait: Double = 0.45) async {
        await press(code: key.0, chars: key.1, modifiers)
        await settle(wait)
    }

    /// 메뉴 단축키. SwiftUI 메뉴 명령은 앱 안에서 만든 키 이벤트에는 반응하지 않으므로, 실행 스크립트에
    /// 요청 파일로 부탁해 실제 키(시스템 이벤트)로 누르게 한다. 스크립트가 누른 뒤 파일을 지운다.
    static func shortcut(_ chars: String, code: UInt16, _ modifiers: NSEvent.ModifierFlags = .command, wait: Double = 0.6) async {
        guard let path = SelfTest.values["GINOTE_E2E_KEYS"] else { check(false, "shortcut: GINOTE_E2E_KEYS missing"); return }
        bringToFront()
        var names: [String] = []
        if modifiers.contains(.command) { names.append("command down") }
        if modifiers.contains(.shift) { names.append("shift down") }
        if modifiers.contains(.option) { names.append("option down") }
        if modifiers.contains(.control) { names.append("control down") }
        try? "\(code)|\(names.joined(separator: ","))".write(toFile: path, atomically: true, encoding: .utf8)
        let sent = await SelfTest.wait("shortcut \(chars) sent", timeout: 10) { !FileManager.default.fileExists(atPath: path) }
        if !sent { check(false, "shortcut \(chars) not sent") }
        await settle(wait)
    }

    private static func press(code: UInt16, chars: String, _ modifiers: NSEvent.ModifierFlags) async {
        guard let window = NSApp.keyWindow ?? window else { return }
        bringToFront()
        let time = ProcessInfo.processInfo.systemUptime
        for type in [NSEvent.EventType.keyDown, .keyUp] {
            guard let event = NSEvent.keyEvent(with: type, location: .zero, modifierFlags: modifiers, timestamp: time,
                                               windowNumber: window.windowNumber, context: nil, characters: chars,
                                               charactersIgnoringModifiers: chars, isARepeat: false, keyCode: code) else { continue }
            NSApp.postEvent(event, atStart: false)
        }
    }

    /// 지금 첫 응답자인 글 상자에 글을 넣는다(사용자가 친 것과 같은 편집 경로).
    static func typeText(_ text: String) async {
        guard let textView = (NSApp.keyWindow ?? window)?.firstResponder as? NSTextView else { check(false, "type: no text responder", responder); return }
        textView.insertText(text, replacementRange: textView.selectedRange())
        await settle(0.3)
    }

    /// 창 좌표(왼쪽 아래 원점)의 한 점을 누른다.
    static func click(_ point: NSPoint) async {
        guard let window else { return }
        bringToFront()
        let time = ProcessInfo.processInfo.systemUptime
        for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
            guard let event = NSEvent.mouseEvent(with: type, location: point, modifierFlags: [], timestamp: time,
                                                 windowNumber: window.windowNumber, context: nil, eventNumber: 0,
                                                 clickCount: 1, pressure: 1) else { continue }
            NSApp.postEvent(event, atStart: false)
        }
        await settle(0.5)
    }

    /// 접근성 이름으로 화면 요소를 찾아 가운데를 누른다.
    @discardableResult
    static func click(label: String) async -> Bool {
        guard let window, let rect = find(label: label, in: window) else { check(false, "click \(label): not found"); return false }
        await click(NSPoint(x: rect.midX, y: rect.midY))
        return true
    }

    /// 창 좌표의 사각형을 돌려준다.
    static func find(label: String, in window: NSWindow) -> NSRect? {
        var found: NSRect?
        func visit(_ element: Any, depth: Int) {
            guard found == nil, depth < 60 else { return }
            if let item = element as? NSAccessibilityProtocol {
                let name = (item.accessibilityLabel() ?? "") + "|" + (item.accessibilityTitle() ?? "")
                if name.split(separator: "|").contains(where: { $0 == label }) {
                    let screen = item.accessibilityFrame()
                    if screen.width > 0 { found = window.convertFromScreen(screen); return }
                }
            }
            if let item = element as? NSAccessibilityProtocol, let children = item.accessibilityChildren() {
                for child in children { visit(child, depth: depth + 1) }
            }
        }
        if let content = window.contentView { visit(content, depth: 0) }
        return found
    }

    /// 본문 아래 기록 영역의 "기록 추가" 버튼 위치(창 좌표).
    static func addCommentPoint() -> NSPoint? {
        guard let window,
              let document = allViews(of: NoteDocumentView.self).first(where: { $0.window === window && !$0.isHiddenOrHasHiddenAncestor }),
              let footer = document.subviews.first(where: { $0 is NSHostingView<AnyView> && !$0.isHidden }) else { return nil }
        let scale = UIScale.value
        // 기록 영역: 아래 여백 24, 버튼 줄 높이 약 20, 왼쪽 여백 24(본문 최대 폭 안).
        let maxWidth = CGFloat(AppModel.shared.settings.preferences.editorMaxWidth)
        let left = max(24, (footer.bounds.width - maxWidth) / 2 + 24)
        let local = NSPoint(x: left + 30 * scale, y: footer.bounds.height - 24 - 10 * scale)
        footer.scrollToVisible(NSRect(x: 0, y: footer.bounds.height - 60, width: 10, height: 60))
        return footer.convert(local, to: nil)
    }

    static func clickAddComment() async {
        guard let point = addCommentPoint() else { check(false, "add comment button not found"); return }
        await click(point)
    }

    static func snap(_ name: String) async {
        shotIndex += 1
        await SceneTour.snap(String(format: "%02d-%@", shotIndex, name))
    }

    /// 실행기는 선택한 항목만 넘긴다. 전체 실행은 명시적인 "all"이다.
    static let scenarioKeys: Set<String> = [
        "list", "up", "new", "comments", "tags", "toolbar", "search", "multi", "lock",
        "trash", "profile", "paste", "comment-undo", "replace", "tag-filter", "trash-view", "paging"
    ]
    static let only: Set<String>? = {
        let names = (SelfTest.values["GINOTE_E2E_ONLY"] ?? "").split(separator: ",").map { String($0).trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        return names == ["all"] ? nil : Set(names)
    }()

    static func enabled(_ key: String) -> Bool { only?.contains(key) ?? true }

    static func scenario(_ key: String, _ title: String, _ body: () async throws -> Void) async {
        guard enabled(key) else { return }
        await SelfTest.step("[\(key)] \(title)", body)
    }

    static var searchFocused: Bool {
        guard let editor = window?.firstResponder as? NSTextView else { return false }
        return editor.delegate is NSSearchField
    }

    static var listFocused: Bool { window?.firstResponder is NSTableView }
    static var editorFocused: Bool { window?.firstResponder is GinoteTextView }

    // MARK: - 시나리오

    static func run(app: AppModel, repo: String, token: String) async {
        let selected = only
        guard SelfTest.values["GINOTE_E2E_ONLY"] == "all"
            || (selected.map { !$0.isEmpty && $0.isSubset(of: scenarioKeys) } ?? false) else {
            check(false, "e2e scenario", "Choose: \(scenarioKeys.sorted().joined(separator: ",")) or all")
            SelfTest.finish()
            return
        }
        await runSelected(app: app, repo: repo, token: token)
    }

    static func runSelected(app: AppModel, repo: String, token: String) async {
        SceneTour.directory = URL(fileURLWithPath: SelfTest.values["GINOTE_SHOT_DIR"] ?? NSTemporaryDirectory())
        try? FileManager.default.createDirectory(at: SceneTour.directory, withIntermediateDirectories: true)
        Dialogs.autoAnswer = true
        if app.settings.workspaces.isEmpty { app.addWorkspace(repo: repo, token: token, remember: false) }
        guard await SelfTest.wait("e2e connect", timeout: 40, { app.workspace?.issues.isEmpty == false }), let workspace = app.workspace else {
            check(false, "e2e connect"); return SelfTest.finish()
        }
        let client = workspace.client
        // 지난 실행에서 되살아난 노트 창이 있으면 닫고, 본창만으로 시작한다(따로 연 창은 뒤에서 따로 시험한다).
        for extra in NSApp.windows where extra.isVisible && extra !== window && extra.frame.width >= 400 { extra.close() }
        bringToFront()
        await settle(1.0)
        // SwiftUI는 실제 입력 장치 이벤트를 한 번 받아야 이 창을 메뉴 명령의 대상(포커스된 장면)으로 삼는다.
        // 앱 자신은 손쉬운 사용 권한이 없어 그 이벤트를 만들 수 없으므로, 실행 스크립트가 제목 막대를 한 번 누른다.
        SelfTest.report("E2E READY_FOR_CLICK")
        await settle(2.0)
        await snap("start")

        await scenario("list", "목록 키보드: 커서와 열기 분리, ⏎ 두 번, ⎋, ←→") {
            app.listFocusRequest += 1
            await settle(0.6)
            check(listFocused, "list focused by request", responder)
            workspace.selection = []
            await key(Key.down)
            let first = workspace.selection.first
            check(first != nil, "↓ moves cursor", "\(workspace.selection)")
            let openedBefore = workspace.openedId
            await key(Key.down)
            check(workspace.selection.first != first, "↓ again moves cursor")
            check(workspace.openedId == openedBefore, "↓ does not open note", "\(String(describing: workspace.openedId))")
            let cursor = workspace.selection.first
            await key(Key.enter, wait: 1.2)
            check(workspace.openedId == cursor, "⏎ opens cursor note")
            await key(Key.enter, wait: 0.8)
            check(editorFocused, "⏎ again focuses editor", responder)
            if let editor = window?.firstResponder as? NSTextView {
                check(editor.selectedRange().location == (editor.string as NSString).length, "caret at end of body")
            }
            await snap("editor-focused")
            await key(Key.escape, wait: 0.8)
            check(listFocused, "⎋ returns to list", responder)
            await key(Key.left)
            check(app.activePane == .sidebar, "← to sidebar", "\(String(describing: app.activePane))")
            await key(Key.right)
            check(app.activePane == .list && listFocused, "→ back to list", responder)
            await key(Key.right, wait: 1.0)
            check(editorFocused, "→ from list opens and focuses editor", responder)
            await key(Key.escape, wait: 0.6)
        }

        await scenario("up", "목록 맨 위 ↑: 검색칸 → 새 노트 → 음성, 멈춤, ↓로 되돌아오기") {
            if let top = workspace.displayedIssues.first?.id { workspace.selection = [top] }
            app.listFocusRequest += 1
            await settle(0.5)
            await key(Key.up)
            check(searchFocused, "↑ at top focuses search", responder)
            await key(Key.up)
            check(app.toolbarKeyFocus == .newNote, "↑ in search → new note button")
            await snap("toolbar-newnote")
            await key(Key.up)
            check(app.toolbarKeyFocus == .voice, "↑ → voice button")
            await key(Key.up)
            check(app.toolbarKeyFocus == .voice, "↑ at voice stays")
            await key(Key.down)
            check(app.toolbarKeyFocus == .newNote, "↓ → new note button")
            await key(Key.down)
            check(app.toolbarKeyFocus == nil && searchFocused, "↓ → search", responder)
            await key(Key.down, wait: 0.6)
            check(listFocused && !workspace.selection.isEmpty, "↓ from search → list", responder)
        }

        var noteNumber: Int?
        let title = "E2E 노트 \(runId)"
        await scenario("new", "⌘N 새 노트, 바로 입력, 번호 받는 동안 포커스 유지") {
            let highest = workspace.issues.map(\.number).max() ?? 0
            await shortcut("n", code: 45)
            // 번호를 금방 받으면 새 노트 자리(newNote)는 이미 목록으로 옮겨져 있다. 열린 노트로 찾는다.
            @MainActor func openedSession() -> NoteSession? {
                if workspace.openedId == NoteSession.newNoteSelectionId { return workspace.newNote }
                guard let id = workspace.openedId, let issue = workspace.issue(id: id), issue.number > highest else { return nil }
                return workspace.session(for: issue)
            }
            check(openedSession() != nil, "⌘N creates and opens new note", "\(String(describing: workspace.openedId))")
            check(await SelfTest.wait("new note editor", timeout: 5) { editorFocused }, "new note editor focused", responder)
            await typeText(title)
            await typeText("\n본문 둘째 줄")
            let session = openedSession()
            check(await SelfTest.wait("allocate", timeout: 20) { session?.number != nil }, "number allocated")
            check(editorFocused, "editor keeps focus after number", responder)
            await typeText("\n번호 받은 뒤 입력")
            noteNumber = session?.number
            await shortcut("s", code: 1, wait: 0.3)
            check(await SelfTest.wait("save", timeout: 20) { session?.dirty == false && session?.saving == false }, "saved")
            if let number = noteNumber {
                let remote = try await client.getIssue(number)
                check(remote.title == title, "remote title", remote.title)
                check((remote.body ?? "").contains("번호 받은 뒤 입력"), "remote body has text typed after allocation", remote.body ?? "")
            }
            await snap("new-note")
        }
        if noteNumber == nil, !enabled("new") {
            if let created = try? await client.createIssue(NoteDraft(title: title, body: "\(title)\n본문 둘째 줄\n번호 받은 뒤 입력", labels: [])) {
                workspace.insertCreated(created)
                noteNumber = created.number
                await settle(1.5)
            }
        }
        guard let number = noteNumber, let session = workspace.session(number: number) ?? workspace.sessions[number] else {
            check(false, "e2e note available"); return SelfTest.finish()
        }

        await scenario("comments", "기록: 기록 추가 → 바로 입력 → 벗어나면 저장, 빈 칸은 사라짐") {
            app.editorFocusRequest += 1
            await settle(0.5)
            let before = session.comments.items.count
            await clickAddComment()
            check(await SelfTest.wait("comment card", timeout: 3) { session.comments.items.count == before + 1 }, "card added")
            check(await SelfTest.wait("comment focus", timeout: 3) { (window?.firstResponder as? NSTextView).map { !($0 is GinoteTextView) } ?? false },
                  "new comment focused", responder)
            await typeText("E2E 기록 \(runId)")
            app.editorFocusRequest += 1
            await settle(0.8)
            check(await SelfTest.wait("comment saved", timeout: 20) {
                ((try? await client.listComments(number)) ?? []).contains { ($0.body ?? "") == "E2E 기록 \(runId)" }
            }, "comment saved to GitHub")
            await snap("comment-saved")
            let count = session.comments.items.count
            await clickAddComment()
            check(await SelfTest.wait("empty card", timeout: 3) { session.comments.items.count == count + 1 }, "second card added")
            app.editorFocusRequest += 1
            check(await SelfTest.wait("empty removed", timeout: 5) { session.comments.items.count == count }, "empty card removed on blur")
        }

        await scenario("tags", "태그 ⇧⌘T: 새 태그 만들어 붙이기") {
            app.editorFocusRequest += 1
            await settle(0.4)
            await shortcut("t", code: 17, [.command, .shift], wait: 1.0)
            let popover = NSApp.windows.contains { $0.isVisible && String(describing: type(of: $0)).contains("Popover") }
            check(popover, "tag picker popover opens")
            await snap("tag-picker")
            if popover {
                await typeText("e2e태그")
                await key(Key.enter, wait: 2.5)
                await key(Key.escape, wait: 0.6)
            }
            check(await SelfTest.wait("tag applied", timeout: 20) { session.visibleLabels.contains("e2e태그") && !session.saving && !session.dirty },
                  "tag applied", session.visibleLabels.joined(separator: ","))
            let remote = try await client.getIssue(number)
            check(remote.labels.contains { $0.name == "e2e태그" }, "tag saved to GitHub", remote.labels.map(\.name).joined(separator: ","))
        }

        await scenario("toolbar", "고정 ⇧⌘P, 미리보기 ⇧⌘M, 찾기 ⌘F, 확대 ⌘=/⌘-") {
            app.editorFocusRequest += 1
            await settle(0.4)
            await shortcut("p", code: 35, [.command, .shift], wait: 1.5)
            check(session.isPinned, "⇧⌘P pins")
            check(await SelfTest.wait("pinned list", timeout: 5) { workspace.pinned.contains { $0.number == number } }, "pinned list shows note")
            await shortcut("p", code: 35, [.command, .shift], wait: 1.5)
            check(!session.isPinned, "⇧⌘P unpins")

            await shortcut("m", code: 46, [.command, .shift], wait: 1.0)
            let editorVisible = allViews(of: GinoteTextView.self).contains { $0.window === window && !$0.isHiddenOrHasHiddenAncestor }
            check(!editorVisible, "⇧⌘M shows preview")
            await snap("preview")
            await shortcut("m", code: 46, [.command, .shift], wait: 1.0)

            app.editorFocusRequest += 1
            await settle(0.5)
            await shortcut("f", code: 3, wait: 1.0)
            let bar = allViews(of: FindBarScrollView.self).first { $0.window === window && $0.isFindBarVisible }
            check(bar != nil, "⌘F shows find bar")
            await snap("find-bar")
            await key(Key.escape, wait: 0.6)

            let scale = app.settings.preferences.uiScale
            await shortcut("=", code: 24, wait: 0.8)
            check(abs(app.settings.preferences.uiScale - (scale + 0.1)) < 0.001, "⌘= zooms in", "\(app.settings.preferences.uiScale)")
            await snap("zoom")
            await shortcut("0", code: 29, wait: 0.8)
            check(app.settings.preferences.uiScale == 1.0, "⌘0 resets zoom")
        }

        await scenario("search", "검색 ⇧⌘F, 결과 중에도 열린 노트 유지, 지우기") {
            await shortcut("f", code: 3, [.command, .shift], wait: 0.6)
            check(searchFocused, "⇧⌘F focuses search", responder)
            await typeText(runId)
            await key(Key.enter, wait: 0.5)
            check(workspace.activeQuery == runId, "search applied", workspace.activeQuery)
            check(await SelfTest.wait("search results", timeout: 20) { !workspace.loading && workspace.issues.contains { $0.number == number } },
                  "search finds e2e note")
            check(workspace.openedId != nil, "opened note kept during search")
            await snap("search")
            await key(Key.escape, wait: 0.4)
            if !workspace.searchText.isEmpty { workspace.searchText = "" }
            check(await SelfTest.wait("search cleared", timeout: 15) { workspace.activeQuery.isEmpty && !workspace.loading }, "search cleared")
        }

        await scenario("multi", "여러 개 선택 ⇧↓, 미리보기") {
            app.listFocusRequest += 1
            await settle(0.5)
            if let top = workspace.displayedIssues.first?.id { workspace.selection = [top] }
            await key(Key.down, .shift, wait: 1.0)
            check(workspace.selection.count == 2, "⇧↓ selects two", "\(workspace.selection.count)")
            await snap("multi-select")
            await key(Key.escape, wait: 0.5)
            check(workspace.selection.isEmpty, "⎋ clears selection", "\(workspace.selection.count)")
        }

        await scenario("lock", "잠금 ⇧⌘L: 숫자로 잠그고 풀기") {
            if let issue = workspace.issue(id: session.issue!.id) { workspace.open(issue.id) }
            app.editorFocusRequest += 1
            await settle(0.6)
            await shortcut("l", code: 37, [.command, .shift], wait: 1.0)
            check(await SelfTest.wait("lock prompt", timeout: 3) { session.lockPrompt == .lock || session.lockState == .unlocked },
                  "lock prompt or remembered pin", "\(String(describing: session.lockPrompt))")
            await snap("lock-sheet")
            if session.lockPrompt == .lock {
                await typeText("246810")
                await key(Key.enter, wait: 3.0)
            }
            check(await SelfTest.wait("locked", timeout: 20) { session.lockState == .unlocked && !session.saving }, "note locked (open)", "\(session.lockState)")
            let remote = try await client.getIssue(number)
            check(NoteLock.isLockedTitle(remote.title), "locked title on GitHub", remote.title)
            await snap("locked-reading")
            app.editorFocusRequest += 1
            await settle(0.6)
            await snap("locked-editing")
            await shortcut("l", code: 37, [.command, .shift], wait: 3.0)
            check(await SelfTest.wait("unlocked", timeout: 20) { session.lockState == .plain && !session.saving }, "lock removed")
        }

        await scenario("trash", "휴지통 ⌘⌫, 되돌리기 ⌘Z") {
            app.editorFocusRequest += 1
            await settle(0.4)
            await key(Key.escape, wait: 0.5)
            // 유예 중에는 행에 "삭제 중…"과 취소가 보이고, ⎋로 취소된다.
            await shortcut("⌫", code: 51, wait: 0.6)
            check(workspace.trashEntry(for: session.issue!.id) != nil, "⌘⌫ queues note")
            await snap("trash-pending")
            await key(Key.escape, wait: 2.5)
            check(workspace.trashQueue.isEmpty, "⎋ cancels most recent trash")
            check(!(try await client.getIssue(number)).isClosed, "cancelled note stays open")
            app.listFocusRequest += 1
            await settle(0.4)
            await shortcut("⌫", code: 51, wait: 3.5)
            let trashed = try await client.getIssue(number)
            check(trashed.isClosed, "⌘⌫ moves to trash")
            await shortcut("z", code: 6, wait: 3.0)
            let restored = try await client.getIssue(number)
            check(!restored.isClosed, "⌘Z restores")
        }

        await scenario("profile", "프로필 블록 → 설정, 음성 ⌥⌘N(키 없음)") {
            await click(NSPoint(x: 60, y: 18))
            await settle(1.0)
            let settings = SceneTour.settingsWindow()
            check(settings != nil, "profile block opens settings")
            settings?.close()
            await settle(0.5)
            await shortcut("n", code: 45, [.command, .option], wait: 1.0)
            check(app.voiceRequest != nil, "⌥⌘N opens voice sheet")
            await snap("voice")
            app.voiceRequest = nil
            await settle(0.5)
        }

        // 클립보드는 시험이 쓰는 동안만 바꾸고 끝나면 되돌린다.
        let pasteboard = NSPasteboard.general
        let savedClipboard = pasteboard.pasteboardItems?.map { item -> NSPasteboardItem in
            let copy = NSPasteboardItem()
            for type in item.types { if let data = item.data(forType: type) { copy.setData(data, forType: type) } }
            return copy
        } ?? []

        await scenario("paste", "붙여넣기: 본문에 이미지 → 첨부, 목록에 글 → 새 노트") {
            guard let issue = try? await client.getIssue(number) else { return }
            workspace.open(issue.id)
            await settle(0.5)
            guard let session = workspace.session(number: number) else { check(false, "session after restore"); return }
            app.editorFocusRequest += 1
            await settle(0.8)
            let before = session.attachments.items.count
            let image = NSImage(size: NSSize(width: 12, height: 12), flipped: false) { rect in NSColor.systemTeal.setFill(); rect.fill(); return true }
            pasteboard.clearContents()
            pasteboard.writeObjects([image])
            await shortcut("v", code: 9, wait: 1.0)
            check(await SelfTest.wait("pasted image uploaded", timeout: 40) { session.attachments.items.count == before + 1 && session.attachments.uploadingNames.isEmpty },
                  "pasted image becomes attachment", "\(session.attachments.items.count)")
            check(await SelfTest.wait("attachment link saved", timeout: 20) { !session.dirty && !session.saving }, "attachment save settled")
            await snap("pasted-image")

            let pasted = "E2E 붙여넣기 \(runId)"
            pasteboard.clearContents()
            pasteboard.setString(pasted, forType: .string)
            workspace.openedId = nil
            app.listFocusRequest += 1
            await settle(0.6)
            await shortcut("v", code: 9, wait: 1.5)
            let created = workspace.newNote ?? workspace.openedId.flatMap { workspace.issue(id: $0) }.map { workspace.session(for: $0) }
            check(created?.body == pasted, "paste in list starts note with text", created?.body ?? "nil")
            if let created {
                _ = await created.flush()
                if let pastedNumber = await created.resolvedNumber() { _ = try? await client.setState(pastedNumber, state: "closed") }
            }
        }
        pasteboard.clearContents()
        if !savedClipboard.isEmpty { pasteboard.writeObjects(savedClipboard) }

        await scenario("comment-undo", "기록 삭제와 ⌘Z 취소") {
            guard let issue = try? await client.getIssue(number) else { return }
            workspace.open(issue.id)
            guard let session = workspace.session(number: number) else { check(false, "session"); return }
            await settle(1.0)
            // 혼자 돌려도 되게, 지울 기록이 없으면 API로 하나 만든다.
            if !session.comments.items.contains(where: { $0.remoteId != nil }) {
                _ = try await client.createComment(number, body: "E2E 지울 기록 \(runId)")
                await session.comments.load()
            }
            guard let item = session.comments.items.first(where: { $0.remoteId != nil }) else { check(false, "comment to delete"); return }
            app.editorFocusRequest += 1
            await settle(0.4)
            session.comments.scheduleDelete(item, undoManager: window?.undoManager)
            check(item.deleting, "comment marked deleting")
            await settle(0.6)
            await snap("comment-deleting")
            await shortcut("z", code: 6, wait: 1.0)
            check(!item.deleting, "⌘Z cancels comment delete")
            await settle(CommentStore.deleteDelay + 1)
            let remaining = try await client.listComments(number)
            check(remaining.contains { $0.id == item.remoteId }, "comment still on GitHub after undo")
        }

        await scenario("replace", "찾아 바꾸기 ⌥⌘F") {
            guard let session = workspace.session(number: number) else { check(false, "session"); return }
            app.editorFocusRequest += 1
            await settle(0.5)
            await shortcut("f", code: 3, [.command, .option], wait: 1.2)
            check(NSApp.keyWindow !== window, "replace sheet opens", NSApp.keyWindow?.title ?? "nil")
            await typeText("둘째 줄")
            await key((48, "\t"), wait: 0.4)
            await typeText("두 번째 줄")
            await snap("replace-sheet")
            await key(Key.enter, wait: 1.0)
            check(session.body.contains("두 번째 줄") && !session.body.contains("둘째 줄"), "replace applied", session.body)
            check(await SelfTest.wait("replace saved", timeout: 20) { !session.dirty && !session.saving }, "replace saved")
            check((try await client.getIssue(number).body ?? "").contains("두 번째 줄"), "replace on GitHub")
        }

        await scenario("tag-filter", "사이드바 태그 필터, 빈 검색으로 풀기") {
            // 혼자 돌려도 되게, 시험 노트에 태그가 없으면 API로 붙이고 다시 읽는다.
            // 앱이 태그를 붙이는 길(세션 저장)로 붙인다.
            if let target = workspace.session(number: number), !target.visibleLabels.contains("e2e태그") {
                target.setLabels(target.visibleLabels + ["e2e태그"], saveNow: true)
                _ = await SelfTest.wait("tag save", timeout: 20) { !target.dirty && !target.saving }
            }
            app.listFocusRequest += 1
            await settle(0.5)
            await key(Key.left, wait: 0.5)
            workspace.labelFilter = nil
            // 사이드바 커서를 태그로 옮겨 ⏎로 적용한다.
            let tags = workspace.visibleLabels.map(\.name)
            if let index = tags.firstIndex(of: "e2e태그") {
                // 커서는 "노트"에서 시작한다: 휴지통 다음이 첫 태그.
                for _ in 0..<(index + 2) { await key(Key.down, wait: 0.25) }
            }
            await key(Key.enter, wait: 1.5)
            check(workspace.labelFilter == "e2e태그", "⏎ applies tag filter from sidebar", workspace.labelFilter ?? "nil")
            check(await SelfTest.wait("tag list", timeout: 15) { !workspace.loading && workspace.issues.contains { $0.number == number } }, "tag filter lists note")
            await snap("tag-filter")
            await shortcut("f", code: 3, [.command, .shift], wait: 0.5)
            await key(Key.enter, wait: 1.5)
            check(workspace.labelFilter == nil, "empty search clears tag filter", workspace.labelFilter ?? "nil")
        }

        await scenario("trash-view", "휴지통 보기와 복원") {
            workspace.scope = .trash
            await settle(0.5)
            check(await SelfTest.wait("trash list", timeout: 20) { !workspace.loading && !workspace.issues.isEmpty }, "trash lists notes")
            check(workspace.issues.allSatisfy(\.isClosed), "trash shows only closed notes",
                  workspace.issues.filter { !$0.isClosed }.map { "#\($0.number) \($0.state)" }.joined(separator: ","))
            await snap("trash")
            guard let trashed = workspace.issues.first else { return }
            workspace.open(trashed.id)
            await settle(1.5)
            app.listFocusRequest += 1
            await settle(0.4)
            let opened = workspace.sessions[trashed.number]
            SelfTest.report("trash open #\(trashed.number) sessionState=\(opened?.issue?.state ?? "nil") archived=\(opened?.isArchived ?? false) openedId=\(String(describing: workspace.openedId)) selection=\(workspace.selection)")
            await shortcut("⌫", code: 51, wait: 3.0)
            check(!(try await client.getIssue(trashed.number)).isClosed, "⌘⌫ on trashed note restores")
            _ = try? await client.setState(trashed.number, state: "closed")
            workspace.scope = .notes
            _ = await SelfTest.wait("notes back", timeout: 15) { !workspace.loading }
        }

        await scenario("paging", "더 불러오기(쪽 넘김)") {
            app.updateSettings { $0.preferences.notesPerPage = 10 }
            await workspace.reload()
            SelfTest.report("page scope=\(workspace.scope) count=\(workspace.issues.count) pinned=\(workspace.pinned.count) query=\(workspace.activeQuery) label=\(workspace.labelFilter ?? "nil")")
            // 방금 만들거나 복원한 노트(붙들어 둔 것)는 첫 쪽 위에 더해진다.
            check(workspace.issues.count >= 10 && workspace.issues.count < 20 && workspace.hasMore, "first page uses page size", "\(workspace.issues.count) more=\(workspace.hasMore)")
            // 사이드바도 표다. 노트 목록은 창에서 가장 오른쪽 표다.
            if let table = allViews(of: NSTableView.self).filter({ $0.window === window })
                .max(by: { $0.convert($0.bounds, to: nil).minX < $1.convert($1.bounds, to: nil).minX }) {
                table.scrollRowToVisible(table.numberOfRows - 1)
            }
            let firstPage = workspace.issues.count
            check(await SelfTest.wait("load more", timeout: 20) { workspace.issues.count > firstPage }, "scrolling to end loads next page", "\(workspace.issues.count)")
            app.updateSettings { $0.preferences.notesPerPage = 30 }
        }

        // 정리: 시험 노트는 휴지통으로
        _ = try? await client.setState(number, state: "closed")
        SelfTest.finish()
    }

    static func allViews<T: NSView>(of type: T.Type) -> [T] {
        var result: [T] = []
        func visit(_ view: NSView) {
            if let match = view as? T { result.append(match) }
            view.subviews.forEach(visit)
        }
        for window in NSApp.windows { if let root = window.contentView?.superview ?? window.contentView { visit(root) } }
        return result
    }
}
#endif
