import Foundation
import XCTest
@testable import GinoteCore
import GinoteTestSupport

/// 한 줄 안의 대체값·오류 분기까지 실행되도록 하는 검사. 깨진 입력과 경계값을 넣는다.
final class BranchCoverageTests: XCTestCase {
    // MARK: - 설정 파일 값 종류

    func testConfigRejectsWrongValueTypes() throws {
        let result = try AppConfig.parse("""
        [display]
        editor_font = 3
        editor_font_size = "big"
        editor_line_height = nan
        ui_scale = 9.5
        [display.list_row]
        title = "yes"
        [behavior]
        lock_session_minutes = "x"
        workspace_cache_minutes = 999
        clear_lock_on_sleep = 1
        [voice]
        transcription_model = 1
        refinement_model = 2
        refinement_prompt = 3
        [shortcuts]
        tags = 5
        pin = "cmd+alt+p"
        """)
        let s = result.settings
        XCTAssertEqual(s.preferences.editorFont, "system")
        XCTAssertEqual(s.preferences.editorFontSize, 16)
        XCTAssertEqual(s.preferences.editorLineHeight, 1.8)
        XCTAssertEqual(s.preferences.uiScale, 1.6)
        XCTAssertTrue(s.preferences.listRow.title)
        XCTAssertEqual(s.preferences.lockSessionMinutes, 60)
        XCTAssertEqual(s.preferences.workspaceCacheMinutes, 60)
        XCTAssertTrue(s.preferences.clearLockOnSleep)
        XCTAssertEqual(s.voice.transcriptionModel, VoicePresets.defaultTranscriptionModel)
        XCTAssertEqual(s.voice.refinementModel, VoicePresets.defaultRefinementModel)
        XCTAssertEqual(s.voice.refinementPrompt, VoicePresets.defaultRefinementPrompt)
        XCTAssertEqual(s.shortcuts[.tags], ShortcutCommand.tags.defaultSpec)
        XCTAssertEqual(s.shortcuts[.pin], "option+cmd+p", "별칭은 정리한 형식으로 받는다")
        XCTAssertFalse(result.problems.contains { $0.contains("shortcuts.pin") }, "순서만 다른 단축키는 문제로 보지 않는다")
        XCTAssertTrue(result.problems.contains { $0.contains("ui_scale = 9.5 is not allowed; using 1.6") }, "소수 값 표기")
        XCTAssertTrue(result.problems.contains { $0.contains("clear_lock_on_sleep = 1 is not allowed; using true") }, "참거짓 값 표기")
    }

    func testConfigAcceptsValidVariants() throws {
        let result = try AppConfig.parse("""
        [display]
        editor_font = "local:  "
        editor_font_size = 20.0
        [behavior]
        workspace_cache_minutes = 180
        [voice]
        refinement_prompt = "나만의 규칙"
        """)
        XCTAssertEqual(result.settings.preferences.editorFont, "system", "글꼴 이름이 빈 local:은 거절")
        XCTAssertEqual(result.settings.preferences.editorFontSize, 20)
        XCTAssertFalse(result.problems.contains { $0.contains("editor_font_size") }, "20.0과 20은 같은 값")
        XCTAssertEqual(result.settings.preferences.workspaceCacheMinutes, 180)
        XCTAssertEqual(result.settings.voice.refinementPrompt, "나만의 규칙")
    }

    func testConfigWorkspaceProblems() throws {
        let result = try AppConfig.parse("""
        workspaces = [1, { repo = "bad" }, { id = "a", repo = "o/one" }, { id = "a", repo = "o/two" }, { name = "x" }]
        """, createId: { "new-id" })
        XCTAssertEqual(result.settings.workspaces.map(\.repo), ["o/one", "o/two"])
        XCTAssertEqual(result.settings.workspaces.map(\.id), ["a", "new-id"])
        XCTAssertTrue(result.rewrite)
        XCTAssertTrue(result.problems.contains { $0.contains("workspaces[0] is not a table") })
        XCTAssertTrue(result.problems.contains { $0.contains("\"bad\" is not \"owner/name\"") })
        XCTAssertTrue(result.problems.contains { $0.contains("is used twice") })
        XCTAssertTrue(result.problems.contains { $0.contains("repo = missing") })
    }

    func testRenderUsesDefaultShortcutForMissingKeyAndEscapes() {
        var settings = AppSettings()
        settings.shortcuts.removeValue(forKey: .tags)
        settings.voice.refinementPrompt = "탭\t\"따옴표\" 역슬래시\\ 리턴\r 백\u{08} 폼\u{0C}"
        let text = AppConfig.render(settings)
        XCTAssertTrue(text.contains("tags = \"\(ShortcutCommand.tags.defaultSpec)\""))
        XCTAssertTrue(text.contains(#"\t\"따옴표\" 역슬래시\\ 리턴\r 백\b 폼\f"#))
        XCTAssertEqual(AppConfig.tomlString("여러 줄 '''\n막힘"), "\"여러 줄 '''\\n막힘\"", "''' 가 들어 있으면 따옴표 문자열로")
        XCTAssertEqual(AppSettings().shortcut(.tags)?.spec, "shift+cmd+t")
        var missing = AppSettings()
        missing.shortcuts = [:]
        XCTAssertEqual(missing.shortcut(.pin)?.spec, ShortcutCommand.pin.defaultSpec)
        XCTAssertEqual(KeyShortcut.parse("ctrl+shift+cmd+k")?.symbol, "⌃⇧⌘K")
    }

    func testConfigRemainingValueShapes() throws {
        var settings = AppSettings()
        settings.preferences.listRow.summary = false
        settings.preferences.editorFont = "local:Menlo"
        let text = AppConfig.render(settings)
        XCTAssertTrue(text.contains("summary = false"))
        let parsed = try AppConfig.parse(text)
        XCTAssertEqual(parsed.settings.preferences.editorFont, "local:Menlo")
        XCTAssertFalse(parsed.settings.preferences.listRow.summary)
        let cache = try AppConfig.parse("[behavior]\nworkspace_cache_minutes = \"x\"\n")
        XCTAssertEqual(cache.settings.preferences.workspaceCacheMinutes, 60)
        let flagProblem = try AppConfig.parse("[display.list_row]\ntags = 0\n")
        XCTAssertTrue(flagProblem.problems.contains { $0.contains("using true") })
        XCTAssertEqual(AppConfig.Value.bool(false).toml, "false")
        XCTAssertEqual(AppConfig.Value.bool(false).described, "false")
    }

    // MARK: - 설정 파일 저장소

    func testConfigStoreReadWithoutFileAndSyntaxErrorWithoutLastGood() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("ginote-branch-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = ConfigStore(directory: directory, keychain: Keychain(service: "net.gitools.note.mac.coretest.unused"), importsTauri: false)
        guard case .loaded(let settings, _) = store.read() else { return XCTFail() }
        XCTAssertEqual(settings, AppSettings(), "파일이 없으면 빈 설정")
        try "x = = y".write(to: store.configURL, atomically: true, encoding: .utf8)
        try? FileManager.default.removeItem(at: store.lastGoodURL)
        guard case .syntaxError(_, let fallback) = store.read() else { return XCTFail() }
        XCTAssertEqual(fallback, AppSettings(), "마지막 정상 설정이 없으면 기본값")
    }

    func testWatcherIgnoresTouchWithSameContent() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("ginote-branch-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = ConfigStore(directory: directory, keychain: Keychain(service: "net.gitools.note.mac.coretest.unused"), importsTauri: false)
        _ = store.load()
        var calls = 0
        store.startWatching { _ in calls += 1 }
        let content = try String(contentsOf: store.configURL, encoding: .utf8)
        Thread.sleep(forTimeInterval: 1.1)
        try content.write(to: store.configURL, atomically: true, encoding: .utf8) // 시각만 바뀌고 내용은 앱이 쓴 그대로
        RunLoop.main.run(until: Date().addingTimeInterval(1.5))
        XCTAssertEqual(calls, 0)
    }

    // MARK: - 잠금

    func testLockErrorBranches() {
        let lock = NoteLock()
        XCTAssertFalse(NoteLock.isLockedPayload("%%%"), "base64가 아니면 잠금 본문이 아니다")
        XCTAssertThrowsError(try lock.decrypt("a", pin: "123456", issueNumber: 1)) { XCTAssertEqual($0 as? NoteLockError, .unreadablePayload) }
        let short = Data([NoteLock.formatVersion] + [UInt8](repeating: 1, count: NoteLock.headerBytes - 1 + 4)).base64EncodedString()
        XCTAssertThrowsError(try lock.decrypt(short, pin: "123456", issueNumber: 1)) { XCTAssertEqual($0 as? NoteLockError, .wrongPinOrNotLocked) }
        XCTAssertThrowsError(try lock.encrypt("x", pin: "12ab", issueNumber: 1)) { XCTAssertEqual($0 as? NoteLockError, .invalidPin) }
        XCTAssertThrowsError(try lock.encrypt("x", pin: "123456", issueNumber: 0)) { XCTAssertEqual($0 as? NoteLockError, .invalidIssueNumber) }
        XCTAssertNil(NoteLock.decodeBase64("abcde"), "길이가 4로 나눠 1이 남으면 읽을 수 없다")
        XCTAssertEqual(NoteLock.decodeBase64("YQ"), Data("a".utf8), "빠진 = 를 채운다")
    }

    // MARK: - 노트 규칙

    func testNoteRuleEdges() {
        XCTAssertNotNil(DueDate.parse("due: 2026-10-05\r\n본문"), "CRLF 첫 줄")
        XCTAssertNil(DueDate.parse("due: 2026-02-30"), "없는 날짜")
        XCTAssertNil(NoteText.linkAtCursor("https://a.b", cursor: 99))
        XCTAssertNil(NoteText.linkAtCursor("x", cursor: -1))
        XCTAssertEqual(JSText.decodeURIComponent("%zz"), "%zz", "잘못된 인코딩은 그대로")
        let earliest = NoteMerge.earliest([
            NoteMerge.Source(number: 5, title: "b", createdAt: "2026-10-05T00:00:00Z", author: "", body: "", comments: []),
            NoteMerge.Source(number: 3, title: "a", createdAt: "2026-10-05T00:00:00Z", author: "", body: "", comments: [])
        ])
        XCTAssertEqual(earliest?.number, 3, "같은 시각이면 번호가 작은 노트")
    }

    func testAttachmentLinkEdges() {
        XCTAssertEqual(AttachmentLinks.insertLinks("앞\n", links: ["L"], position: 2), "앞\n\nL")
        XCTAssertEqual(AttachmentLinks.insertLinks("앞\n\n뒤", links: ["L"], position: 2), "앞\n\nL\n\n뒤", "앞뒤에 줄바꿈이 하나씩 있으면 하나씩만 더한다")
        XCTAssertEqual(AttachmentLinks.compress("본문", repo: ""), "본문")
        XCTAssertEqual(AttachmentLinks.expand("본문", repo: ""), "본문")
        XCTAssertEqual(AttachmentLinks.safeFileName("///"), "attachment")
        XCTAssertEqual(AttachmentLinks.displayName(fromPath: ""), "")
        XCTAssertEqual(AttachmentLinks.inferredType(name: ""), "application/octet-stream")
    }

    func testVoiceEdges() {
        XCTAssertEqual(VoiceNotes.splitAudio("본문만").audio, [])
        let refinement = OpenAIVoiceClient.parseRefinement(#"{"body":"본문","tags":"bug"}"#, tags: ["bug", "BUG"])
        XCTAssertEqual(refinement.tags, [], "tags가 배열이 아니면 무시")
        XCTAssertEqual(refinement.title, "", "제목이 없으면 빈 값")
    }

    func testCommentWithoutUser() throws {
        let comment = try GitHubClient.decoder.decode(IssueComment.self, from: Data(#"{"id":1,"created_at":"","updated_at":""}"#.utf8))
        XCTAssertEqual(comment.author, "")
    }

    // MARK: - GitHub 응답 변형

    func testGitHubOddResponses() async throws {
        FakeGitHub.reset()
        let client = GitHubClient(token: "t", repo: FakeGitHub.repo, session: FakeGitHub.session)

        FakeGitHub.fail("/user", status: 400, message: "<empty>")
        do { _ = try await client.verify(); XCTFail() } catch let error as GitHubError {
            XCTAssertFalse(error.message.isEmpty, "빈 message면 HTTP 상태 문구")
        }

        FakeGitHub.override("/graphql", json: ["data": [:]])
        let counts = try await client.noteCounts()
        XCTAssertEqual(counts.notes, 0)
        XCTAssertEqual(counts.labels, [:])

        FakeGitHub.override("/repos/\(FakeGitHub.repo)", json: ["full_name": FakeGitHub.repo])
        FakeGitHub.fail("/git/ref/heads/main", status: 409)
        let empty = try await client.repositoryHasNoBranches()
        XCTAssertTrue(empty, "기본 브랜치 이름이 없으면 main을 본다")

        FakeGitHub.fail("/git/ref/heads/ginote-assets", status: 409)
        let exists = try await client.attachmentBranchExists()
        XCTAssertFalse(exists)

        FakeGitHub.putFile(GitHubClient.voiceHintsPath, data: Data(#"{"version":1}"#.utf8))
        let hints = try await client.loadVoiceHints()
        XCTAssertEqual(hints, "")

        FakeGitHub.override("/search/issues", json: ["total_count": 2, "items": [
            ["id": 1, "number": 1, "title": "a", "state": "closed", "labels": [], "created_at": "", "updated_at": ""],
            ["id": 2, "number": 2, "title": "b", "state": "closed", "labels": [], "created_at": "", "updated_at": "", "closed_at": "2026-01-01"]
        ]])
        let closed = try await client.searchIssuesPage(state: "closed", term: "")
        XCTAssertEqual(closed.items.map(\.number), [2, 1], "closed_at이 없으면 맨 뒤")
    }

    func testOpenAIModelsWithoutData() async throws {
        FakeOpenAI.reset()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [FakeOpenAI.self]
        let client = OpenAIVoiceClient(apiKey: "k", session: URLSession(configuration: configuration))
        let models = try await client.listModels()
        XCTAssertEqual(models, [])
    }

    func testClosedIssuesWithoutClosedAtSortLast() async throws {
        FakeGitHub.reset()
        let client = GitHubClient(token: "t", repo: FakeGitHub.repo, session: FakeGitHub.session)
        FakeGitHub.override("/search/issues", json: ["total_count": 2, "items": [
            ["id": 1, "number": 1, "title": "a", "state": "closed", "labels": [], "created_at": "", "updated_at": ""],
            ["id": 3, "number": 3, "title": "c", "state": "closed", "labels": [], "created_at": "", "updated_at": ""]
        ]])
        let page = try await client.searchIssuesPage(state: "closed", term: "")
        XCTAssertEqual(page.items.count, 2)
    }

    func testOpenAINonHTTPAndNonJSON() async {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [PlainResponseProtocol.self]
        let client = OpenAIVoiceClient(apiKey: "k", session: URLSession(configuration: configuration))
        do { _ = try await client.listModels(); XCTFail() } catch let error as GitHubError {
            XCTAssertEqual(error.status, 0)
        } catch { XCTFail("\(error)") }
    }
}
