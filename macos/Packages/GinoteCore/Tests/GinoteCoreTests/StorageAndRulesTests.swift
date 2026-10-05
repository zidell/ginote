import Foundation
import XCTest
@testable import GinoteCore

/// 로컬 상태·설정 파일·키체인·작은 규칙들. 임시 폴더와 시험 전용 키체인 서비스만 쓴다.
final class StorageAndRulesTests: XCTestCase {
    var directory: URL!
    var keychain: Keychain!
    var tauriKeychain: Keychain!

    override func setUp() {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent("ginote-core-\(UUID().uuidString)")
        keychain = Keychain(service: "net.gitools.note.mac.coretest.\(UUID().uuidString)")
        tauriKeychain = Keychain(service: "net.gitools.note.coretest.\(UUID().uuidString)")
    }

    override func tearDown() {
        for account in [Keychain.openAIAccount, Keychain.patAccount("a"), Keychain.patAccount("b"), "plain"] {
            keychain.delete(account)
            tauriKeychain.delete(account)
        }
        try? FileManager.default.removeItem(at: directory)
    }

    // MARK: - LocalState

    func testDraftsMoveRenameAndClear() {
        let state = LocalState(directory: directory)
        XCTAssertNil(state.draft(repo: "o/r", id: "new.1"))
        state.setDraft(repo: "o/r", id: "new.1", LocalState.Draft(title: "t", body: "b", labels: ["Bug", "idea"]))
        XCTAssertEqual(state.draft(repo: "o/r", id: "new.1")?.body, "b")
        state.moveDraft(repo: "o/r", from: "new.1", to: "issue.5")
        state.moveDraft(repo: "o/r", from: "missing", to: "issue.6")
        state.moveDraft(repo: "x/y", from: "new.1", to: "issue.7")
        XCTAssertNil(state.draft(repo: "o/r", id: "new.1"))
        state.renameDraftLabels(repo: "o/r", from: "bug", to: "결함")
        XCTAssertEqual(state.draft(repo: "o/r", id: "issue.5")?.labels, ["결함", "idea"])
        state.renameDraftLabels(repo: "o/r", from: "idea", to: nil)
        XCTAssertEqual(state.draft(repo: "o/r", id: "issue.5")?.labels, ["결함"])
        state.renameDraftLabels(repo: "x/y", from: "a", to: "b")
        state.setDraft(repo: "o/r", id: "issue.5", nil)
        XCTAssertNil(state.draft(repo: "o/r", id: "issue.5"))
    }

    func testPendingWorkPruneModelsAndHints() {
        let state = LocalState(directory: directory)
        XCTAssertNil(state.pendingWork(repo: "o/r", issueNumber: 1))
        state.updatePendingWork(repo: "o/r", issueNumber: 1) {
            $0.commentDrafts.append(LocalState.PendingComment(id: nil, localId: "l", body: "기록"))
            $0.attachmentDeletes.append(LocalState.PendingAttachmentDelete(path: "p", sha: "s", name: "n", commentId: 3, expiresAt: Date()))
        }
        XCTAssertEqual(state.pendingWork(repo: "o/r", issueNumber: 1)?.commentDrafts.first?.body, "기록")
        state.updatePendingWork(repo: "o/r", issueNumber: 1) { $0 = LocalState.PendingWork() }
        XCTAssertNil(state.pendingWork(repo: "o/r", issueNumber: 1), "비면 지운다")

        let now = Date()
        XCTAssertTrue(state.shouldPruneAttachments(repo: "o/r", now: now))
        state.markAttachmentsPruned(repo: "o/r", now: now)
        XCTAssertFalse(state.shouldPruneAttachments(repo: "o/r", now: now.addingTimeInterval(60)))
        XCTAssertTrue(state.shouldPruneAttachments(repo: "o/r", now: now.addingTimeInterval(LocalState.pruneInterval)))

        XCTAssertFalse(state.voiceModelLists.transcription.isEmpty, "저장 전에는 기본 목록")
        state.voiceModelLists = LocalState.ModelLists(transcription: [" a ", "a", "", "gpt-4o-2024-08-06"], refinement: ["r"])
        XCTAssertEqual(state.voiceModelLists.transcription, ["a"], "공백·중복·날짜 붙은 스냅숏을 뺀다")
        XCTAssertEqual(state.voiceModelLists.refinement, ["r"])

        XCTAssertNil(state.pendingVoiceHints(repo: "o/r"))
        state.setPendingVoiceHints(repo: "o/r", "단어")
        XCTAssertEqual(state.pendingVoiceHints(repo: "o/r"), "단어")
        state.setPendingVoiceHints(repo: "o/r", nil)
        XCTAssertNil(state.pendingVoiceHints(repo: "o/r"))
    }

    func testLocalStateIgnoresBrokenFiles() throws {
        let state = LocalState(directory: directory)
        try Data("{".utf8).write(to: directory.appendingPathComponent("drafts.json"))
        XCTAssertNil(state.draft(repo: "o/r", id: "x"))
    }

    func testLabelNames() {
        XCTAssertEqual(LabelNames.replace(["A", "b"], "a", "c"), ["c", "b"])
        XCTAssertEqual(LabelNames.replace(["A", "b"], "a", ""), ["b"])
        let one = Issue(id: 1, number: 1, title: "", body: nil, labels: [GitHubLabel(name: "Bug"), GitHubLabel(name: PinLabel.name), GitHubLabel(name: " ")],
                        createdAt: "", updatedAt: "")
        let two = Issue(id: 2, number: 2, title: "", body: nil, labels: [GitHubLabel(name: "bug"), GitHubLabel(name: "idea")], createdAt: "", updatedAt: "")
        XCTAssertEqual(LabelNames.unique([one, two]), ["bug", "idea"], "대소문자 구분 없이 합치고 마지막 표기를 쓴다")
    }

    // MARK: - Keychain

    func testKeychainReadWriteUpdateDelete() {
        XCTAssertNil(keychain.read("plain"))
        XCTAssertTrue(keychain.write("plain", "하나"))
        XCTAssertEqual(keychain.read("plain"), "하나")
        XCTAssertTrue(keychain.write("plain", "둘"), "있으면 덮어쓴다")
        XCTAssertEqual(keychain.read("plain"), "둘")
        XCTAssertTrue(keychain.write("plain", ""), "빈 값은 지운다")
        XCTAssertNil(keychain.read("plain"))
        XCTAssertTrue(keychain.delete("plain"), "없는 항목 지우기도 성공")
        XCTAssertEqual(Keychain.patAccount("x"), "github-pat:x")
        XCTAssertEqual(Keychain().service, Keychain.service)
    }

    // MARK: - ConfigStore

    func testFirstLoadCreatesFileWithoutImport() throws {
        let store = ConfigStore(directory: directory, keychain: keychain, importsTauri: false)
        guard case .loaded(let settings, let problems) = store.load() else { return XCTFail() }
        XCTAssertEqual(settings, AppSettings())
        XCTAssertEqual(problems, [])
        XCTAssertTrue(FileManager.default.fileExists(atPath: store.configURL.path))
        XCTAssertTrue(try String(contentsOf: store.statusURL, encoding: .utf8).contains("every value was accepted"))
    }

    func testFirstLoadImportsTauriSettingsAndCredentials() throws {
        let tauri = directory.appendingPathComponent("tauri")
        try FileManager.default.createDirectory(at: tauri, withIntermediateDirectories: true)
        try """
        active_workspace = "a"
        [display]
        theme = "dark"
        editor_font_size = 17
        [[workspaces]]
        id = "a"
        repo = "o/notes"
        [[workspaces]]
        id = "b"
        repo = "o/work"
        remember_token = false
        """.write(to: tauri.appendingPathComponent("config.toml"), atomically: true, encoding: .utf8)
        tauriKeychain.write(Keychain.patAccount("a"), "pat-a")
        tauriKeychain.write(Keychain.patAccount("b"), "pat-b")
        tauriKeychain.write(Keychain.openAIAccount, "sk-test")

        let store = ConfigStore(directory: directory.appendingPathComponent("mac"), keychain: keychain, importsTauri: true,
                                tauriDirectory: tauri, tauriKeychain: tauriKeychain)
        guard case .loaded(let settings, _) = store.load() else { return XCTFail() }
        XCTAssertEqual(settings.workspaces.map(\.repo), ["o/notes", "o/work"])
        XCTAssertEqual(settings.preferences.theme, .system, "Tauri 테마 대신 시스템 모양으로 시작")
        XCTAssertEqual(settings.preferences.editorFontSize, Preferences().editorFontSize, "웹 기본 크기 17은 맥 기본값으로")
        XCTAssertEqual(keychain.read(Keychain.patAccount("a")), "pat-a")
        XCTAssertNil(keychain.read(Keychain.patAccount("b")), "기억하지 않는 토큰은 가져오지 않는다")
        XCTAssertEqual(keychain.read(Keychain.openAIAccount), "sk-test")
    }

    func testImportWithoutTauriConfigFallsBackToDefaults() {
        let store = ConfigStore(directory: directory, keychain: keychain, importsTauri: true,
                                tauriDirectory: directory.appendingPathComponent("missing"), tauriKeychain: tauriKeychain)
        guard case .loaded(let settings, _) = store.load() else { return XCTFail() }
        XCTAssertEqual(settings, AppSettings())
    }

    func testReadReportsProblemsRewritesAndFallsBackOnSyntaxError() throws {
        let store = ConfigStore(directory: directory, keychain: keychain, importsTauri: false)
        var settings = AppSettings()
        settings.preferences.editorFontSize = 20
        store.write(settings)
        store.write(settings) // 같은 내용은 다시 쓰지 않는다

        try "[display]\ntheme = \"purple\"\n".write(to: store.configURL, atomically: true, encoding: .utf8)
        guard case .loaded(_, let problems) = store.load() else { return XCTFail() }
        XCTAssertEqual(problems.count, 1)
        XCTAssertTrue(try String(contentsOf: store.statusURL, encoding: .utf8).contains("rejected"))

        try "[[workspaces]]\nrepo = \"o/r\"\n".write(to: store.configURL, atomically: true, encoding: .utf8)
        guard case .loaded(let rewritten, _) = store.load() else { return XCTFail() }
        XCTAssertFalse(rewritten.workspaces[0].id.isEmpty)
        XCTAssertTrue(try String(contentsOf: store.configURL, encoding: .utf8).contains("id = \"\(rewritten.workspaces[0].id)\""), "새 id를 바로 파일에 쓴다")

        try "theme = = broken".write(to: store.configURL, atomically: true, encoding: .utf8)
        guard case .syntaxError(let message, let fallback) = store.load() else { return XCTFail() }
        XCTAssertFalse(message.isEmpty)
        XCTAssertEqual(fallback.workspaces.map(\.repo), ["o/r"], "마지막 정상 설정으로 띄운다")
        XCTAssertTrue(try String(contentsOf: store.statusURL, encoding: .utf8).contains("not valid TOML"))
    }

    func testWatchingReportsOutsideEditsButNotOwnWrites() throws {
        let store = ConfigStore(directory: directory, keychain: keychain, importsTauri: false)
        _ = store.load()
        let changed = expectation(description: "바깥 수정")
        var seen: [AppSettings] = []
        store.startWatching { result in
            if case .loaded(let settings, _) = result { seen.append(settings); changed.fulfill() }
        }
        var own = AppSettings()
        own.preferences.notesPerPage = 40
        store.write(own) // 앱이 쓴 것은 알리지 않는다
        RunLoop.main.run(until: Date().addingTimeInterval(1.3))
        XCTAssertTrue(seen.isEmpty)
        Thread.sleep(forTimeInterval: 1.1) // 수정 시각이 달라지도록
        try "[behavior]\nnotes_per_page = 50\n".write(to: store.configURL, atomically: true, encoding: .utf8)
        wait(for: [changed], timeout: 4)
        XCTAssertEqual(seen.last?.preferences.notesPerPage, 50)
    }

    func testDirectories() {
        XCTAssertTrue(ConfigStore.defaultDirectory.path.hasSuffix(ConfigStore.bundleIdentifier))
        XCTAssertTrue(ConfigStore.tauriDirectory.path.hasSuffix("net.gitools.note"))
        XCTAssertTrue(ConfigStore(directory: directory).lastGoodURL.path.contains("state"))
    }

    // MARK: - AppConfig 남은 분기

    func testRenderStatusBranches() {
        let date = Date(timeIntervalSince1970: 0)
        XCTAssertTrue(AppConfig.renderStatus(loadedAt: date, problems: []).contains("every value was accepted"))
        XCTAssertTrue(AppConfig.renderStatus(loadedAt: date, problems: ["x"]).contains("- x"))
        XCTAssertTrue(AppConfig.renderStatus(loadedAt: date, problems: [], syntaxError: "bad").contains("Error: bad"))
        XCTAssertEqual(AppConfig.SyntaxError(message: "m").errorDescription, "m")
    }

    func testParseOddShapes() throws {
        let result = try AppConfig.parse("""
        workspaces = 3
        [display]
        theme = [1]
        """)
        XCTAssertTrue(result.problems.contains { $0.contains("unsupported type") })
        XCTAssertTrue(result.problems.contains { $0.contains("workspaces must be an array") })
        let notTable = try AppConfig.parse("display = 1\n")
        XCTAssertEqual(notTable.settings.preferences.theme, .system)
        XCTAssertEqual(AppConfig.jsonQuoted("a\u{01}b"), "\"a\\u0001b\"")
    }

    // MARK: - 작은 규칙과 모델

    func testSmallRules() {
        XCTAssertEqual(AttachmentLinks.displayName(fromPath: "a/b/7f6907d0-4fa4-460b-9af3-54af9cb74d63-보고서.pdf"), "보고서.pdf")
        XCTAssertEqual(AttachmentLinks.displayName(fromPath: "plain.txt"), "plain.txt")
        XCTAssertEqual(AttachmentLinks.inferredType(name: "사진.JPG"), "image/jpeg")
        XCTAssertEqual(AttachmentLinks.inferredType(name: "noext"), "application/octet-stream")
        XCTAssertEqual(TagDefinition.format(name: "일", description: "업무"), "일: 업무")
        XCTAssertEqual(TagDefinition.format(name: "일", description: nil), "일")
        XCTAssertEqual(TagDefinition.format(name: "일", description: ""), "일")
        XCTAssertTrue(PinLabel.isPin("GINOTE:PIN"))
        XCTAssertEqual(JSText.codePointCount("가😀"), 2)
        XCTAssertEqual(NoteText.length("😀"), 2, "GitHub 상한은 UTF-16 길이")
        XCTAssertEqual(VoiceNotes.knownTagNames(["Bug", "없음"], labels: ["bug", "idea"]), ["Bug"])
        XCTAssertTrue(VoiceNotes.audioFileName(now: Date(timeIntervalSince1970: 0)).hasPrefix("voice-1970-01-01T00-00-00-000Z"))
    }

    func testWorkspaceAndSettingsHelpers() {
        let named = Workspace(id: "a", repo: "o/notes", displayName: "  내 노트 ")
        let plain = Workspace(id: "b", repo: "o/work")
        XCTAssertEqual(named.title, "내 노트")
        XCTAssertEqual(plain.title, "o/work")
        XCTAssertEqual(plain.owner, "o")
        XCTAssertEqual(Workspace(repo: "broken").owner, "")
        var settings = AppSettings()
        XCTAssertNil(settings.activeWorkspace)
        settings.workspaces = [named, plain]
        settings.activeWorkspaceId = "b"
        XCTAssertEqual(settings.activeWorkspace?.id, "b")
        settings.activeWorkspaceId = "missing"
        XCTAssertEqual(settings.activeWorkspace?.id, "a", "없는 id면 첫 저장소")
    }

    func testModelHelpers() {
        let label = GitHubLabel(name: "x", color: "fff", description: "d")
        XCTAssertEqual(label.description, "d")
        let issue = Issue(id: 1, number: 1, title: "🔒 비밀", body: nil, labels: [GitHubLabel(name: PinLabel.name), label], createdAt: "", updatedAt: "")
        XCTAssertTrue(issue.isPinned)
        XCTAssertTrue(issue.isLocked)
        XCTAssertEqual(issue.visibleLabels.map(\.name), ["x"])
        XCTAssertEqual(GitHubError(status: 1, message: "m").errorDescription, "m")
    }

    func testMergeOrdersSameTimeByIssueNumber() {
        let time = "2026-10-05T00:00:00Z"
        let a = NoteMerge.Source(number: 2, title: "a", createdAt: time, author: "x", body: "A", comments: [])
        let b = NoteMerge.Source(number: 1, title: "b", createdAt: time, author: "x", body: "B", comments: [])
        XCTAssertEqual(NoteMerge.timeline([a, b]).map(\.issueNumber), [1, 2])
    }

    func testMergeKeepsOriginalOrderForSameTimeAndIssue() {
        let time = "2026-10-05T00:00:00Z"
        let source = NoteMerge.Source(number: 1, title: "a", createdAt: time, author: "x", body: "A",
                                      comments: [.init(createdAt: time, author: "x", body: "첫째"), .init(createdAt: time, author: "x", body: "둘째")])
        XCTAssertEqual(NoteMerge.comments([source]).map(\.body), ["첫째", "둘째"])
    }

    func testNonHTTPResponseIsAnError() async {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [PlainResponseProtocol.self]
        let client = GitHubClient(token: "t", repo: "o/r", session: URLSession(configuration: configuration))
        do { _ = try await client.verify(); XCTFail() } catch let error as GitHubError {
            XCTAssertEqual(error.status, 0)
            XCTAssertEqual(error.message, "No HTTP response")
        } catch { XCTFail("\(error)") }
    }

    func testLockRejectsUnknownFormatVersion() {
        let lock = NoteLock()
        let payload = Data([9] + [UInt8](repeating: 0, count: 64)).base64EncodedString()
        XCTAssertThrowsError(try lock.decrypt(payload, pin: "123456", issueNumber: 1)) {
            XCTAssertEqual($0 as? NoteLockError, .unsupportedPayload)
        }
    }

    func testUncachedSessionDoesNotCache() {
        let configuration = GitHubClient.uncachedSession.configuration
        XCTAssertNil(configuration.urlCache)
        XCTAssertEqual(configuration.requestCachePolicy, .reloadIgnoringLocalCacheData)
        XCTAssertTrue(GitHubClient(token: "t", repo: "o/r").session === GitHubClient.uncachedSession)
    }
}

/// HTTP가 아닌 응답(URLResponse)을 돌려주는 세션.
final class PlainResponseProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func stopLoading() {}
    override func startLoading() {
        let response = URLResponse(url: request.url!, mimeType: "text/plain", expectedContentLength: 0, textEncodingName: nil)
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data())
        client?.urlProtocolDidFinishLoading(self)
    }
}
