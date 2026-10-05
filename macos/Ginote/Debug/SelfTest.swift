import AppKit
import GinoteCore

/// 디버그 빌드에서 화면 상태 변화를 GINOTE_TRACE_LOG 파일에 남긴다. 릴리스 빌드에서는 아무것도 하지 않는다.
enum DebugTrace {
    /// 디버그 빌드는 늘 기록한다. GINOTE_TRACE_LOG가 없으면 ~/Library/Logs/Ginote Native/debug.log에 쓰고,
    /// 5MB를 넘으면 debug.1.log로 한 번 넘긴다(최근 기록만 남는다).
    static let path: String? = {
        #if DEBUG
        if let path = ProcessInfo.processInfo.environment["GINOTE_TRACE_LOG"] { return path }
        let folder = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/Ginote Native")
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        return folder.appendingPathComponent("debug.log").path
        #else
        return nil
        #endif
    }()

    static func log(_ message: @autoclosure () -> String) {
        #if DEBUG
        guard let path else { return }
        if let size = (try? FileManager.default.attributesOfItem(atPath: path))?[.size] as? Int, size > 5_000_000 {
            let previous = (path as NSString).deletingPathExtension + ".1.log"
            try? FileManager.default.removeItem(atPath: previous)
            try? FileManager.default.moveItem(atPath: path, toPath: previous)
        }
        let line = "\(Date().timeIntervalSince1970) \(message())\n"
        if let handle = FileHandle(forWritingAtPath: path) {
            handle.seekToEndOfFile()
            handle.write(Data(line.utf8))
            try? handle.close()
        } else {
            try? line.write(toFile: path, atomically: true, encoding: .utf8)
        }
        #endif
    }
}

#if DEBUG

/// 디버그 빌드 전용 자가 점검. 실제 화면 모델(WorkspaceModel·NoteSession)로 시험 저장소에 노트 작업을
/// 보내고 GitHub API로 결과를 다시 읽어 확인한다. 사용자 설정·키체인은 쓰지 않는다.
///
///   GINOTE_SELF_TEST=1 GINOTE_CONFIG_DIR=<빈 임시 폴더> GINOTE_TEST_REPO=owner/name \
///   GINOTE_DEBUG_TOKEN=<PAT> "Ginote Native.app/Contents/MacOS/Ginote"
///
/// 결과는 표준 출력과 GINOTE_SELF_TEST_LOG 파일에 남고, 실패가 있으면 종료 코드 1로 끝난다.
@MainActor
enum SelfTest {
    static var passed = 0
    static var failed = 0
    static var lines: [String] = []
    static let values = ProcessInfo.processInfo.environment

    static func report(_ line: String) {
        print(line)
        lines.append(line)
        if let path = values["GINOTE_SELF_TEST_LOG"] {
            try? (lines.joined(separator: "\n") + "\n").write(toFile: path, atomically: true, encoding: .utf8)
        }
    }

    static func check(_ condition: Bool, _ name: String, _ detail: @autoclosure () -> String = "") {
        if condition { passed += 1; report("PASS \(name)") } else { failed += 1; report("FAIL \(name) \(detail())") }
    }

    static func wait(_ name: String, timeout: Double = 30, _ condition: () async -> Bool) async -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if await condition() { return true }
            try? await Task.sleep(for: .milliseconds(250))
        }
        report("TIMEOUT \(name)")
        return false
    }

    static func step(_ name: String, _ body: () async throws -> Void) async {
        report("== \(name)")
        do { try await body() } catch { failed += 1; report("FAIL \(name) threw: \(error)") }
    }

    static let runId = String(Int(Date().timeIntervalSince1970) % 100000)

    static func run() async {
        guard let repo = values["GINOTE_TEST_REPO"], let token = values["GINOTE_DEBUG_TOKEN"] else {
            report("FAIL missing GINOTE_TEST_REPO / GINOTE_DEBUG_TOKEN"); exit(2)
        }
        let app = AppModel.shared
        if values["GINOTE_SELF_TEST"] == "tour" { await SceneTour.run(app: app, repo: repo, token: token); return }
        if values["GINOTE_SELF_TEST"] == "e2e" { await E2E.run(app: app, repo: repo, token: token); return }
        if app.settings.workspaces.isEmpty { app.addWorkspace(repo: repo, token: token, remember: false) }
        // 화면 점검 모드: 시험 저장소에 연결만 하고 앱을 그대로 둔다.
        if values["GINOTE_SELF_TEST"] == "ui" {
            // 화면 점검: 설정 창을 지정한 탭으로 연다(GINOTE_UI_SETTINGS=general|editor|list|workspaces|voice|shortcuts).
            if let tab = values["GINOTE_UI_SETTINGS"] {
                Task {
                    _ = await wait("ui settings list", { app.workspace?.issues.isEmpty == false })
                    let tabs = tab.split(separator: ",").compactMap { SettingsTab(rawValue: String($0)) }
                    app.settingsTab = tabs.first ?? .general
                    if let appMenu = NSApp.mainMenu?.items.first?.submenu,
                       let index = appMenu.items.firstIndex(where: { $0.title.hasPrefix("설정") || $0.title.hasPrefix("Settings") }) {
                        appMenu.performActionForItem(at: index)
                    }
                    // 여러 개를 주면 0.8초 간격으로 차례로 바꾼다(탭 전환 점검).
                    for next in tabs.dropFirst() {
                        try? await Task.sleep(for: .seconds(0.8))
                        app.settingsTab = next
                        report("ui settings tab \(next)")
                    }
                    report("ui settings opened \(tab)")
                    try? await Task.sleep(for: .seconds(2))
                    if SceneTour.directory == nil { SceneTour.directory = URL(fileURLWithPath: values["GINOTE_SHOT_DIR"] ?? NSTemporaryDirectory()) }
                    if let settings = NSApp.windows.first(where: { $0.isVisible && $0.identifier?.rawValue.contains("Settings") == true }) {
                        await SceneTour.snap("settings", window: settings)
                    }
                    report("ui settings shot")
                }
            }
            // 화면 점검: 단축키를 바꾸면 메뉴 항목에 바로 반영되는지(GINOTE_UI_SHORTCUT=1).
            if values["GINOTE_UI_SHORTCUT"] != nil {
                Task {
                    @MainActor func menuKey(_ title: String) -> String {
                        func find(_ menu: NSMenu) -> NSMenuItem? {
                            for item in menu.items {
                                if item.title == title { return item }
                                if let sub = item.submenu, let found = find(sub) { return found }
                            }
                            return nil
                        }
                        guard let item = NSApp.mainMenu.flatMap(find) else { return "missing" }
                        return "\(item.keyEquivalentModifierMask.rawValue)+\(item.keyEquivalent)"
                    }
                    _ = await wait("ui shortcut list", { app.workspace?.issues.isEmpty == false })
                    report("menu 태그… before \(menuKey("태그…"))")
                    app.updateSettings { $0.shortcuts[.tags] = "option+t" }
                    try? await Task.sleep(for: .seconds(1))
                    report("menu 태그… after \(menuKey("태그…"))")
                    NSApp.mainMenu?.items.forEach { $0.submenu?.update() }
                    try? await Task.sleep(for: .seconds(0.5))
                    report("menu 태그… after update \(menuKey("태그…"))")
                    if let first = app.workspace?.displayedIssues.first { app.workspace?.open(first.id) }
                    try? await Task.sleep(for: .seconds(1.5))
                    report("menu 태그… after open \(menuKey("태그…"))")
                    app.updateSettings { $0.shortcuts[.tags] = "" }
                    try? await Task.sleep(for: .seconds(1))
                    report("menu 태그… cleared \(menuKey("태그…"))")
                    app.settingsTab = .shortcuts
                    if let appMenu = NSApp.mainMenu?.items.first?.submenu,
                       let index = appMenu.items.firstIndex(where: { $0.title.hasPrefix("설정") || $0.title.hasPrefix("Settings") }) {
                        appMenu.performActionForItem(at: index)
                    }
                    try? await Task.sleep(for: .seconds(1.5))
                    if SceneTour.directory == nil { SceneTour.directory = URL(fileURLWithPath: values["GINOTE_SHOT_DIR"] ?? NSTemporaryDirectory()) }
                    if let settings = NSApp.windows.first(where: { $0.isVisible && $0.identifier?.rawValue.contains("Settings") == true }) {
                        await SceneTour.snap("shortcuts", window: settings)
                    }
                    report("ui shortcut done")
                }
            }
            // 화면 점검: 새 노트를 만들고 번호를 받기 전·후 목록을 찍는다(GINOTE_UI_NEWNOTE=1). 시험 저장소에 빈 노트가 하나 생긴다.
            if values["GINOTE_UI_NEWNOTE"] != nil {
                Task {
                    _ = await wait("ui newnote list", { app.workspace?.issues.isEmpty == false })
                    try? await Task.sleep(for: .seconds(1))
                    if SceneTour.directory == nil { SceneTour.directory = URL(fileURLWithPath: values["GINOTE_SHOT_DIR"] ?? NSTemporaryDirectory()) }
                    guard let workspace = app.workspace else { return }
                    let session = workspace.createNote()
                    try? await Task.sleep(for: .seconds(0.3))
                    await SceneTour.snap("newnote-before")
                    _ = await wait("ui newnote number", { session?.number != nil })
                    try? await Task.sleep(for: .seconds(0.5))
                    await SceneTour.snap("newnote-after")
                    report("ui newnote done #\(session?.number.map(String.init) ?? "nil")")
                }
            }
            // 화면 점검: 목록 위 검색칸을 드러내고 창을 찍는다(GINOTE_UI_SEARCH=1, GINOTE_SHOT_DIR).
            if values["GINOTE_UI_SEARCH"] != nil {
                Task {
                    _ = await wait("ui search list", { app.workspace?.issues.isEmpty == false })
                    try? await Task.sleep(for: .seconds(1.5))
                    app.searchFocusRequest += 1
                    try? await Task.sleep(for: .seconds(1))
                    if SceneTour.directory == nil { SceneTour.directory = URL(fileURLWithPath: values["GINOTE_SHOT_DIR"] ?? NSTemporaryDirectory()) }
                    await SceneTour.snap("search")
                    report("ui search shot")
                }
            }
            if values["GINOTE_UI_TOOLBAR"] != nil {
                Task {
                    @MainActor func dump(_ stage: String) async {
                        for window in NSApp.windows where window.isVisible {
                            report("toolbar[\(stage)] \(window.title): \(window.toolbar?.items.map { item in "\(item.itemIdentifier.rawValue.prefix(52))\(item.view.map { " frame=\($0.frame) hidden=\($0.isHidden) win=\($0.window != nil)" } ?? "")" } ?? [])")
                        }
                        if SceneTour.directory == nil { SceneTour.directory = URL(fileURLWithPath: values["GINOTE_SHOT_DIR"] ?? NSTemporaryDirectory()) }
                        await SceneTour.snap("toolbar-\(stage)")
                    }
                    try? await Task.sleep(for: .seconds(4))
                    await dump("start")
                    // 저장소를 둘 이상 두고 오가도 사이드바 접기 버튼이 남는지(GINOTE_UI_TOOLBAR=switch).
                    guard values["GINOTE_UI_TOOLBAR"] == "switch" else { return }
                    if app.settings.workspaces.count < 2 { app.addWorkspace(repo: repo, token: token, remember: false) }
                    try? await Task.sleep(for: .seconds(4))
                    await dump("added")
                    for round in 1...2 {
                        app.switchWorkspace(number: 1)
                        try? await Task.sleep(for: .seconds(3))
                        await dump("switch\(round)-1")
                        app.switchWorkspace(number: 2)
                        try? await Task.sleep(for: .seconds(3))
                        await dump("switch\(round)-2")
                    }
                }
            }
            if let number = values["GINOTE_UI_SELECT"].flatMap(Int.init),
               await wait("ui list", { app.workspace?.issues.isEmpty == false }),
               let issue = app.workspace?.displayedIssues.first(where: { $0.number == number }) {
                app.workspace?.open(issue.id)
                if values["GINOTE_UI_IME"]?.isEmpty == false { await simulateKoreanInput(number: number) }
            }
            return
        }
        Dialogs.autoAnswer = true
        guard await wait("connect", { app.workspace?.user != nil }), let workspace = app.workspace else {
            report("FAIL connect \(app.workspace?.errorMessage ?? "")"); finish()
            return
        }
        let client = workspace.client
        check(workspace.workspace.repo == repo, "workspace repo")
        check(FileManager.default.fileExists(atPath: app.configStore.configURL.path), "config.toml written")

        var first: NoteSession?

        await step("새 노트와 첫 줄 제목") {
            let session = workspace.createNote(body: "")!
            first = session
            check(await wait("allocate") { session.number != nil }, "issue number allocated", session.errorMessage ?? "")
            session.edit(body: "초안 키 시험")
            try? await Task.sleep(for: .seconds(1.5))
            check(app.localState.draft(repo: repo, id: "issue.\(session.number!)") != nil, "new note draft stored under issue.N")
            session.edit(body: "첫 줄 제목\n본문 둘째 줄")
            session.saveNow()
            check(await wait("save") { !session.dirty && !session.saving }, "saved", session.errorMessage ?? "")
            let remote = try await client.getIssue(session.number!)
            check(remote.title == "첫 줄 제목", "remote title", remote.title)
            check(remote.body == "첫 줄 제목\n본문 둘째 줄", "remote body", remote.body ?? "nil")
            check(workspace.issues.contains { $0.number == remote.number }, "listed")
        }
        guard let session = first, let number = session.number else { finish(); return }

        await step("자동 저장") {
            session.edit(body: "첫 줄 제목\n자동 저장 시험")
            check(session.dirty, "dirty after edit")
            check(await wait("autosave", timeout: 15) { !session.dirty && !session.saving }, "autosaved after delay")
            check(try await client.getIssue(number).body == "첫 줄 제목\n자동 저장 시험", "autosave body")
        }

        await step("한글 조합 중 입력") {
            session.edit(body: "첫 줄 제목\n자동 저장 시험\n한", composing: true)
            check(session.dirty, "composing marks dirty")
            session.edit(body: "첫 줄 제목\n자동 저장 시험\n한글")
            session.saveNow()
            check(await wait("save composed") { !session.dirty && !session.saving }, "saved after composition")
        }

        await step("태그") {
            session.setLabels(["시험태그"], saveNow: true)
            check(await wait("label save") { !session.dirty && !session.saving }, "label saved", session.errorMessage ?? "")
            let remote = try await client.getIssue(number)
            check(remote.labels.contains { $0.name == "시험태그" }, "remote label", remote.labels.map(\.name).joined(separator: ","))
            let label = try await client.listLabels().first { $0.name == "시험태그" }
            check(label?.color == TagColor.hex(for: "시험태그"), "label color matches web hash", label?.color ?? "nil")
        }

        await step("고정") {
            guard let issue = workspace.issue(id: session.issue!.id) else { check(false, "issue in list"); return }
            await workspace.togglePin(issue)
            var remote = try await client.getIssue(number)
            check(remote.isPinned, "pinned remotely")
            check(workspace.pinned.contains { $0.number == number }, "pinned list")
            check(session.isPinned, "session pinned")
            await workspace.togglePin(workspace.issue(id: issue.id) ?? issue)
            remote = try await client.getIssue(number)
            check(!remote.isPinned, "unpinned remotely")
            check(remote.labels.contains { $0.name == "시험태그" }, "tag kept after pin toggle")
        }

        await step("웹 대조: 저장·다시 열기·목록 상태") {
            // 고정을 눌러도 저장 안 된 본문 수정은 GitHub까지 간다.
            session.edit(body: "첫 줄 제목\n고정 직전 수정")
            await workspace.togglePin(workspace.issue(id: session.issue!.id)!)
            check(session.dirty, "unsaved body stays dirty after pin")
            check(await wait("save after pin", timeout: 20) { !session.dirty && !session.saving }, "body saved after pin")
            check((try await client.getIssue(number).body ?? "").contains("고정 직전 수정"), "pinned edit reached GitHub")
            await workspace.togglePin(workspace.issue(id: session.issue!.id)!)

            // 다시 열면 다른 기기에서 고친 본문을 읽는다.
            let remote = try await client.getIssue(number)
            _ = try await client.updateIssue(number, NoteDraft(title: remote.title, body: "첫 줄 제목\n다른 기기 수정", labels: remote.labels.map(\.name)))
            await session.loadDetails()
            check(session.body.contains("다른 기기 수정"), "reopen shows remote edit", session.body)

            // 검색해서 목록에서 빠져도 열어 둔 노트는 닫히지 않는다.
            workspace.open(session.issue!.id)
            workspace.searchText = "zz-없는-검색어-\(runId)"
            workspace.submitSearch()
            _ = await wait("search") { !workspace.loading }
            check(workspace.openedId == session.issue!.id, "opened note kept after search")
            workspace.clearSearch()
            _ = await wait("reset") { !workspace.loading }

            // 본문 blur(전체 flush)가 막 추가한 빈 기록 카드를 지우지 않는다.
            await session.comments.load()
            session.comments.add()
            let before = session.comments.items.count
            _ = await session.flush()
            check(session.comments.items.count == before, "empty new comment card survives flush")
            if let empty = session.comments.items.last { _ = await session.comments.save(empty) }

            // 본문이 빈 노트에도 태그를 붙이면 Untitled 제목으로 저장되고, 본문을 쓰면 첫 줄로 바뀐다(웹과 같음).
            let blank = try await client.createIssue(NoteDraft(title: "새 노트", body: "", labels: []))
            let blankSession = NoteSession(workspace: workspace, issue: blank)
            blankSession.setLabels(["시험태그"], saveNow: true)
            check(await wait("blank tag save", timeout: 20) { !blankSession.dirty && !blankSession.saving }, "empty-body note saves tag")
            let blankRemote = try await client.getIssue(blank.number)
            check(blankRemote.title == "Untitled" && blankRemote.labels.contains { $0.name == "시험태그" }, "empty-body title is Untitled", blankRemote.title)
            blankSession.edit(body: "내용이 들어옴")
            blankSession.saveNow()
            check(await wait("blank body save", timeout: 20) { !blankSession.dirty && !blankSession.saving }, "body saved")
            check(try await client.getIssue(blank.number).title == "내용이 들어옴", "Untitled replaced by first line")
            _ = try await client.setState(blank.number, state: "closed")

            // 제목을 따로 쓰는 모드의 새 노트도 바로 저장된다.
            app.updateSettings { $0.preferences.titleMode = .separate }
            let separate = workspace.createNote(body: "")!
            check(await wait("allocate separate") { separate.number != nil }, "separate-title note allocated")
            separate.edit(body: "제목 따로 본문")
            separate.saveNow()
            check(await wait("save separate") { !separate.dirty && !separate.saving }, "separate-title note saved", separate.errorMessage ?? "")
            check((try await client.getIssue(separate.number!).body ?? "") == "제목 따로 본문", "separate-title body reached GitHub")
            app.updateSettings { $0.preferences.titleMode = .firstLine }
            _ = try await client.setState(separate.number!, state: "closed")

            // 뒤 단계가 보는 본문으로 되돌린다.
            session.edit(body: "첫 줄 제목\n자동 저장 시험\n한글")
            session.saveNow()
            check(await wait("restore body") { !session.dirty && !session.saving }, "body restored")
        }

        await step("첨부: 빈 저장소에 브랜치 만들고 올리기") {
            let file = FileManager.default.temporaryDirectory.appendingPathComponent("시험 이미지.png")
            let image = NSImage(size: NSSize(width: 8, height: 8), flipped: false) { rect in NSColor.red.setFill(); rect.fill(); return true }
            try NSBitmapImageRep(data: image.tiffRepresentation!)!.representation(using: .png, properties: [:])!.write(to: file)
            await session.attachments.add([file])
            check(session.attachments.items.count == 1, "attachment listed", session.attachments.errorMessage ?? "")
            check(await wait("attachment save") { !session.dirty && !session.saving }, "saved with attachment")
            let remote = try await client.getIssue(number)
            let paths = AttachmentLinks.parsePaths(remote.body ?? "")
            check(paths.count == 1 && paths[0].hasPrefix(".issue-note-assets/issues/\(number)/"), "managed link in body", remote.body ?? "")
            check((remote.body ?? "").hasPrefix(AttachmentLinks.managedStart), "managed block at top")
            check(!session.body.contains(AttachmentLinks.managedStart), "managed block hidden in editor")
            let files = try await client.listAttachmentFiles(issueNumber: number)
            check(files.count == 1, "file on ginote-assets branch")
            let data = try await client.downloadAttachment(path: files[0].path)
            check(NSImage(data: data) != nil, "downloaded image decodes")
        }

        await step("첨부: 본문에 넣기와 축약 주소") {
            guard let item = session.attachments.items.first else { check(false, "has attachment"); return }
            session.attachments.insertIntoBody(item)
            check(session.body.contains(AttachmentLinks.placeholder), "editor shows {repo}/", session.body)
            check(await wait("insert save") { !session.dirty && !session.saving }, "saved after insert")
            let body = try await client.getIssue(number).body ?? ""
            check(!body.contains(AttachmentLinks.placeholder), "remote has full URL")
            check(!body.contains(AttachmentLinks.managedStart), "no managed block when linked manually", body)
        }

        await step("첨부: 삭제(5초 대기)") {
            guard let item = session.attachments.items.first else { check(false, "has attachment"); return }
            session.attachments.scheduleDelete(item, undoManager: nil)
            check(session.attachments.pendingDeletes[item.path] != nil, "pending delete")
            check(await wait("delete", timeout: 30) { session.attachments.items.isEmpty }, "attachment removed", session.attachments.errorMessage ?? "")
            let files = try await client.listAttachmentFiles(issueNumber: number)
            check(files.isEmpty, "file deleted from branch")
            let body = try await client.getIssue(number).body ?? ""
            check(AttachmentLinks.parsePaths(body).isEmpty, "link removed from body", body)
        }

        await step("댓글") {
            session.comments.add()
            guard let item = session.comments.items.last else { check(false, "comment added"); return }
            session.comments.edit(item, text: "첫 기록")
            check(await session.comments.save(item), "comment saved", session.comments.errorMessage ?? "")
            check(item.remoteId != nil, "comment id")
            var remote = try await client.listComments(number)
            check(remote.contains { $0.body == "첫 기록" }, "remote comment")
            session.comments.edit(item, text: "고친 기록")
            _ = await session.comments.save(item)
            remote = try await client.listComments(number)
            check(remote.contains { $0.body == "고친 기록" }, "comment edited")

            let file = FileManager.default.temporaryDirectory.appendingPathComponent("memo.txt")
            try "기록 첨부".write(to: file, atomically: true, encoding: .utf8)
            await session.comments.addAttachments([file], to: item)
            check(item.attachments.count == 1, "comment attachment", session.comments.errorMessage ?? "")
            let commentFiles = try await client.listAttachmentFiles(issueNumber: number, commentId: item.remoteId!)
            check(commentFiles.count == 1, "comment folder file")
            remote = try await client.listComments(number)
            let saved = remote.first { $0.id == item.remoteId }?.body ?? ""
            check(saved.contains(AttachmentLinks.managedStart) && saved.contains("고친 기록"), "comment managed block", saved)
            let issueBody = try await client.getIssue(number).body ?? ""
            check(!issueBody.contains(commentFiles[0].path.components(separatedBy: "/").last!), "comment file not in note body")

            session.comments.add()
            let empty = session.comments.items.last!
            _ = await session.comments.save(empty)
            check(!session.comments.items.contains { $0 === empty }, "empty new comment discarded")

            session.comments.scheduleDelete(item, undoManager: nil)
            check(await wait("comment delete", timeout: 20) { !session.comments.items.contains { $0 === item } }, "comment removed")
            remote = try await client.listComments(number)
            check(!remote.contains { $0.id == item.remoteId }, "remote comment deleted")
            let commentId = item.remoteId!
            check(await wait("comment files", timeout: 20) {
                (try? await client.listAttachmentFiles(issueNumber: number, commentId: commentId))?.isEmpty ?? false
            }, "comment folder emptied")
        }

        await step("잠금") {
            await session.comments.load()
            session.comments.add()
            let comment = session.comments.items.last!
            session.comments.edit(comment, text: "잠금 전 기록")
            _ = await session.comments.save(comment)

            await session.lock(pin: "123456")
            check(session.lockState == .unlocked, "unlocked after lock", session.errorMessage ?? "")
            check(await wait("lock save") { !session.dirty && !session.saving }, "lock saved")
            let remote = try await client.getIssue(number)
            check(remote.title.hasPrefix("🔒 "), "lock title", remote.title)
            check(NoteLock.isLockedPayload(remote.body ?? ""), "locked payload")
            let plain = try app.noteLock.decrypt(remote.body ?? "", pin: "123456", issueNumber: number)
            check(plain.contains("자동 저장 시험"), "swift decrypts", plain)
            let web = await webDecrypts(payload: remote.body ?? "", pin: "123456", issue: number, expected: plain, pepper: BuildPepper.value ?? "")
            check(web, "web code decrypts with build pepper")

            session.comments.edit(comment, text: "잠금 후 고친 기록")
            _ = await session.comments.save(comment)
            let comments = try await client.listComments(number)
            let lockedComment = comments.first { $0.id == comment.remoteId }?.body ?? ""
            check(NoteLock.isLockedPayload(lockedComment), "comment encrypted in locked note", lockedComment)

            await session.expireLock()
            check(session.lockState == .locked && session.body.isEmpty, "relocked on expiry")
            check(throws: { try session.unlock(pin: "000000") }, "wrong pin rejected")
            try session.unlock(pin: "123456")
            check(session.lockState == .unlocked && session.body.contains("자동 저장 시험"), "unlocked with pin")
            check(await wait("comment decrypt", timeout: 15) { session.comments.items.contains { $0.text == "잠금 후 고친 기록" } },
                  "comments decrypted on unlock", session.comments.items.map { "\($0.text)|\($0.lockedPayload != nil)" }.joined(separator: ","))

            session.edit(body: session.body + "\n잠금 중 수정")
            session.saveNow()
            check(await wait("locked edit save") { !session.dirty && !session.saving }, "saved while unlocked")
            let edited = try await client.getIssue(number)
            check(NoteLock.isLockedPayload(edited.body ?? ""), "edit stays encrypted")

            await session.removeLock()
            check(await wait("unlock save") { !session.dirty && !session.saving }, "remove lock saved")
            let unlocked = try await client.getIssue(number)
            check(!unlocked.title.hasPrefix("🔒"), "plain title", unlocked.title)
            check(unlocked.body?.contains("잠금 중 수정") == true, "plain body", unlocked.body ?? "")
            let afterUnlock = try await client.listComments(number)
            check(!afterUnlock.contains { NoteLock.isLockedPayload($0.body ?? "") }, "comments re-saved as plain after removing lock")
        }

        await step("다른 기기에서 휴지통으로 옮긴 노트 저장") {
            _ = try await client.setState(number, state: "closed")
            Dialogs.autoAnswer = true
            session.edit(body: session.body + "\n복원 시험")
            session.saveNow()
            check(await wait("reopen save") { !session.dirty && !session.saving }, "saved after confirm")
            let reopened = try await client.getIssue(number)
            check(!reopened.isClosed && reopened.body?.contains("복원 시험") == true, "reopened and saved")
            check(Dialogs.log.contains { $0.contains("휴지통으로 옮겼습니다") }, "asked before reopening")

            _ = try await client.setState(number, state: "closed")
            Dialogs.autoAnswer = false
            session.edit(body: session.body + "\n버릴 수정")
            session.saveNow()
            check(await wait("discard") { !session.dirty && !session.saving }, "discarded")
            let closed = try await client.getIssue(number)
            check(closed.isClosed && closed.body?.contains("버릴 수정") == false, "stayed closed, change discarded")
            Dialogs.autoAnswer = true
            // 앱 밖에서 다시 연 노트라 목록 반영은 GitHub를 기다린다.
            workspace.hold(try await client.setState(number, state: "open"))
            await workspace.reload()
        }

        await step("휴지통 이동과 복원") {
            guard let issue = workspace.issue(id: session.issue!.id) ?? workspace.displayedIssues.first(where: { $0.number == number }) else {
                let detail = await listing(workspace); check(false, "issue listed", detail); return
            }
            let undo = UndoManager()
            await workspace.moveToTrash([issue], undoManager: undo)
            check(try await client.getIssue(number).isClosed, "closed remotely")
            check(!workspace.issues.contains { $0.number == number }, "removed from list")
            check(undo.canUndo, "undo registered")
            undo.undo()
            check(await wait("undo restore") { (try? await client.getIssue(number).isClosed) == false }, "undo restored")
            workspace.scope = .trash
            check(await wait("trash list") { !workspace.loading }, "trash loaded")
            workspace.scope = .notes
            _ = await wait("notes list") { !workspace.loading }
        }

        await step("검색") {
            let found = await wait("search index", timeout: 120) {
                workspace.searchText = "자동 저장 시험"
                workspace.submitSearch()
                _ = await wait("search load") { !workspace.loading }
                return workspace.issues.contains { $0.number == number }
            }
            check(found, "hybrid search finds note")
            workspace.searchText = "#시험태그"
            workspace.submitSearch()
            check(workspace.labelFilter == "시험태그", "#tag becomes filter")
            _ = await wait("label list") { !workspace.loading }
            check(workspace.issues.contains { $0.number == number }, "label filter lists note")
            workspace.labelFilter = nil
            workspace.clearSearch()
            _ = await wait("reset") { !workspace.loading }
        }

        await step("초안 복구") {
            let remote = try await client.getIssue(number)
            let draftBody = AttachmentLinks.compress(AttachmentLinks.stripManagedBlocks(remote.body ?? ""), repo: repo) + "\n초안만 있는 줄"
            app.localState.setDraft(repo: repo, id: "issue.\(number)", LocalState.Draft(title: "", body: draftBody, labels: remote.labels.map(\.name)))
            let restored = NoteSession(workspace: workspace, issue: remote)
            check(restored.dirty && restored.body.contains("초안만 있는 줄"), "draft restored into new session", "dirty=\(restored.dirty) archived=\(restored.isArchived)")
            check(await wait("draft save", timeout: 20) { !restored.dirty && !restored.saving }, "restored draft saved")
            check((try await client.getIssue(number).body ?? "").contains("초안만 있는 줄"), "restored draft reached GitHub")
            await session.refreshFromRemote()
        }

        await step("음성 전달(전사 없이)") {
            let audio = Data(repeating: 0, count: 64)
            let request = VoiceRequest(target: .newNote, workspace: workspace, session: nil)
            app.updateSettings { $0.voice.preserveOriginalAudio = true }
            try await VoiceDelivery.deliver(body: "음성 본문", tags: ["시험태그"], suggestedTitle: "음성 제목 \(runId)", audio: audio, request: request)
            guard let created = workspace.issues.first(where: { $0.title == "음성 제목 \(runId)" }) else { let detail = await listing(workspace); check(false, "voice note created", detail); return }
            check(created.body == "음성 제목 \(runId)\n\n음성 본문", "voice note body", created.body ?? "")
            check(created.labels.contains { $0.name == "시험태그" }, "voice tag")
            let files = try await client.listAttachmentFiles(issueNumber: created.number)
            check(files.count == 1 && files[0].name.contains("voice-"), "audio attached", files.map(\.name).joined(separator: ","))

            let voiceSession = workspace.session(for: created)
            let comment = VoiceRequest(target: .newComment, workspace: workspace, session: voiceSession)
            try await VoiceDelivery.deliver(body: "음성 기록", tags: [], suggestedTitle: "", audio: audio, request: comment)
            let comments = try await client.listComments(created.number)
            check(comments.contains { ($0.body ?? "").contains("음성 기록") && ($0.body ?? "").contains("<audio controls") }, "voice comment with audio")
            app.updateSettings { $0.voice.preserveOriginalAudio = false }
        }

        await step("병합") {
            let a = try await client.createIssue(NoteDraft(title: "병합 A \(runId)", body: "A 본문", labels: ["시험태그"]))
            let b = try await client.createIssue(NoteDraft(title: "병합 B", body: "B 본문", labels: []))
            _ = try await client.createComment(b.number, body: "B 기록")
            let attached = try await client.uploadAttachment(issueNumber: a.number, fileName: "a.txt", type: "text/plain", data: Data("a".utf8))
            _ = try await client.updateIssue(a.number, NoteDraft(title: "병합 A \(runId)", body: "A 본문\n\n" + AttachmentLinks.composeLink(repo: repo, path: attached.path, name: "a.txt"), labels: ["시험태그"]))
            await workspace.reload()
            await MergeRunner.run([a, b], workspace: workspace)
            let a2 = try await client.getIssue(a.number), b2 = try await client.getIssue(b.number)
            check(a2.isClosed && b2.isClosed, "sources closed", Dialogs.log.last ?? "")
            guard let merged = workspace.issues.first(where: { $0.title == "병합 A \(runId)" && !$0.isClosed && $0.number > b.number }) else {
                check(false, "merged note listed", Dialogs.log.last ?? ""); return
            }
            let body = merged.body ?? ""
            check(body.contains("A 본문") && body.contains("B 본문") && !body.contains("B 기록"), "merged bodies only", body)
            let mergedComments = try await client.listComments(merged.number)
            check(mergedComments.map { $0.body ?? "" } == ["B 기록"], "source comments moved as comments", "\(mergedComments.map(\.body))")
            check(body.contains(".issue-note-assets/issues/\(merged.number)/"), "attachment url rewritten", body)
            check(merged.labels.contains { $0.name == "시험태그" }, "merged labels")
        }

        await step("태그 이름 바꾸기·삭제") {
            guard let label = workspace.labels.first(where: { $0.name == "시험태그" }) else { check(false, "label exists"); return }
            try await workspace.renameLabel(label, definition: "바뀐태그: 설명")
            check(workspace.labels.contains { $0.name == "바뀐태그" && $0.description == "설명" }, "renamed with description")
            let open = workspace.session(number: number)
            check(open?.labels.contains("바뀐태그") == true, "open session label renamed", open?.labels.joined(separator: ",") ?? "no session")
            let renamed = workspace.labels.first { $0.name == "바뀐태그" }!
            try await workspace.deleteLabel(renamed)
            check(!workspace.labels.contains { $0.name == "바뀐태그" }, "label deleted")
            check(open?.labels.contains("바뀐태그") == false, "open session label removed")
        }

        await step("설정 파일 바깥 수정") {
            let url = app.configStore.configURL
            var text = try String(contentsOf: url, encoding: .utf8)
            text = text.replacingOccurrences(of: #"(?m)^editor_font_size = \d+$"#, with: "editor_font_size = 20", options: .regularExpression)
            try text.write(to: url, atomically: true, encoding: .utf8)
            check(await wait("config watch", timeout: 5) { app.settings.preferences.editorFontSize == 20 }, "external edit applied")
            let status = try String(contentsOf: app.configStore.statusURL, encoding: .utf8)
            check(status.contains("every value was accepted"), "status file", status)
        }

        finish()
    }

    /// 입력기가 보내는 것과 같은 순서로 한글을 조합해 넣는다: ㅎ→하→한(조합 중) → 확정 → 줄바꿈 → 글 → 확정.
    /// 마지막 글자를 조합하는 중에 줄바꿈해도 글자가 남고 줄이 바뀌는지, 저장된 본문이 맞는지 본다.
    static func simulateKoreanInput(number: Int) async {
        try? await Task.sleep(for: .seconds(3))
        guard let window = NSApp.windows.first(where: { $0.isVisible && $0.title != "" || $0.isMainWindow }),
              let textView = findTextView(in: window.contentView) else { report("FAIL ime: no editor"); return }
        window.makeKeyAndOrderFront(nil)
        window.makeFirstResponder(textView)
        textView.setSelectedRange(NSRange(location: (textView.string as NSString).length, length: 0))
        let before = textView.string
        textView.insertNewline(nil)
        for (marked, commit) in [(["ㅎ", "하", "한"], "한"), (["ㄱ", "그", "글"], "글")] {
            for syllable in marked {
                textView.setMarkedText(syllable, selectedRange: NSRange(location: (syllable as NSString).length, length: 0), replacementRange: NSRange(location: NSNotFound, length: 0))
                try? await Task.sleep(for: .milliseconds(80))
            }
            check(textView.hasMarkedText(), "ime composing \(commit)")
            textView.insertText(commit, replacementRange: textView.markedRange())
            if commit == "한" { textView.insertNewline(nil) }
        }
        check(textView.string == before + "\n한\n글", "ime text", textView.string.debugDescription)
        guard let session = AppModel.shared.workspace?.sessions[number] else { report("FAIL ime: no session"); return }
        check(session.body == textView.string, "ime session body", session.body.debugDescription)
        _ = await wait("ime save", timeout: 20) { !session.dirty && !session.saving }
        let remote = (try? await AppModel.shared.workspace!.client.getIssue(number).body) ?? ""
        check(remote.hasSuffix("\n한\n글"), "ime saved to GitHub", remote.debugDescription)
        report("RESULT ime passed=\(passed) failed=\(failed)")
    }

    static func findTextView(in view: NSView?) -> GinoteTextView? {
        guard let view else { return nil }
        if let textView = view as? GinoteTextView { return textView }
        for subview in view.subviews { if let found = findTextView(in: subview) { return found } }
        return nil
    }

    static func listing(_ workspace: WorkspaceModel) async -> String {
        let local = workspace.issues.map { "#\($0.number)" }.joined(separator: " ")
        let remote = (try? await workspace.client.listIssuesPage(state: "open", page: 1, pageSize: 30).items.map { "#\($0.number)" }.joined(separator: " ")) ?? "?"
        return "app=[\(local)] scope=\(workspace.scope) label=\(workspace.labelFilter ?? "-") query=\(workspace.activeQuery) loading=\(workspace.loading) github=[\(remote)]"
    }

    static func check(throws work: () throws -> Void, _ name: String) {
        do { try work(); check(false, name, "did not throw") } catch { check(true, name) }
    }

    /// 웹 코드(src/lib/note-lock.js)로 같은 암호문을 풀어 본다.
    static func webDecrypts(payload: String, pin: String, issue: Int, expected: String, pepper: String) async -> Bool {
        guard let script = values["GINOTE_VERIFY_LOCK"], let node = values["GINOTE_NODE"] else { report("SKIP web decrypt (no node)"); return true }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: node)
        process.arguments = [script]
        let input = Pipe(), output = Pipe()
        process.standardInput = input
        process.standardOutput = output
        process.standardError = output
        do { try process.run() } catch { return false }
        let cases: [[String: Any]] = [["pepper": pepper, "pin": pin, "issue": issue, "payload": payload, "body": expected]]
        input.fileHandleForWriting.write(try! JSONSerialization.data(withJSONObject: cases))
        input.fileHandleForWriting.closeFile()
        let text = String(decoding: output.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
        process.waitUntilExit()
        if process.terminationStatus != 0 { report("web decrypt: \(text)") }
        return process.terminationStatus == 0
    }

    static func finish() {
        report("RESULT passed=\(passed) failed=\(failed)")
        for line in Dialogs.log { report("dialog: \(line)") }
        exit(failed == 0 ? 0 : 1)
    }
}
#endif
