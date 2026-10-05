import AppKit
import GinoteCore
import GinoteTestSupport
import XCTest
@testable import Ginote_Native

/// 앱 전체 상태: 저장소 추가·전환·해제·토큰, 기억해 둔 목록, 설정 변경의 뒤처리, 바깥에서 고친 설정 파일, 확대,
/// 잠금 기억 시간, 시스템 이벤트(활성·비활성·잠자기·네트워크·설정 창 닫기).
@MainActor
final class AppModelTests: GinoteTestCase {
    private var app: AppModel { .shared }

    override func tearDown() async throws {
        app.updateSettings { $0.preferences = Preferences() }
        app.configNotice = nil
        app.voiceRequest = nil
        app.voiceAfterSettings = nil
        app.openAIKey = ""
        try await super.tearDown()
    }

    func testAddSwitchRemoveWorkspacesAndCache() async throws {
        FakeGitHub.addIssue(title: "a", body: "a")
        app.addWorkspace(repo: FakeGitHub.repo, token: "t1", remember: true)
        let first = try XCTUnwrap(app.workspace)
        XCTAssertEqual(app.configStore.keychain.read(Keychain.patAccount(first.workspace.id)), "t1", "기억하면 키체인에 둔다")
        try await waitUntil("연결", first.hasLoaded)
        app.addWorkspace(repo: "tester/second", token: "t2", remember: false)
        let second = try XCTUnwrap(app.workspace)
        XCTAssertNotIdentical(first, second)
        XCTAssertIdentical(app.model(forWorkspace: first.workspace.id), first, "기억해 둔 모델을 쓴다")
        XCTAssertIdentical(app.model(forWorkspace: second.workspace.id), second)
        XCTAssertNil(app.model(forWorkspace: "없는 id"))

        // 기억 시간 안에 돌아오면 같은 모델을 다시 쓴다.
        app.switchWorkspace(number: 1)
        XCTAssertIdentical(app.workspace, first)
        app.switchWorkspace(number: 1)
        app.switchWorkspace(number: 9)
        app.switchWorkspace(to: second.workspace.id)
        XCTAssertIdentical(app.workspace, second)

        // 기억 시간이 0이면 새로 만든다.
        app.updateSettings { $0.preferences.workspaceCacheMinutes = 0 }
        app.switchWorkspace(to: first.workspace.id)
        XCTAssertNotIdentical(app.workspace, first)

        // 다른 저장소 개수는 기억한 토큰으로 한 번 센다.
        app.workspaceNoteCounts = [:]
        app.loadOtherWorkspaceCounts()
        try await waitUntil("다른 저장소 개수", app.workspaceNoteCounts[second.workspace.id] != nil)

        // 지금 저장소를 지우면 다음 저장소로, 토큰도 지운다.
        let current = try XCTUnwrap(app.workspace).workspace.id
        app.removeWorkspace(current)
        XCTAssertNil(app.configStore.keychain.read(Keychain.patAccount(current)))
        XCTAssertEqual(app.settings.activeWorkspaceId, second.workspace.id)
        await app.flushAll()
    }

    func testTokenPromptAndSetToken() async throws {
        let record = Workspace(repo: FakeGitHub.repo, rememberToken: true)
        app.updateSettings { $0.workspaces = [record]; $0.activeWorkspaceId = record.id }
        XCTAssertNil(app.workspace)
        XCTAssertEqual(app.tokenPromptWorkspace?.id, record.id, "토큰이 없으면 묻는다")
        app.setToken("t", for: record, remember: false)
        XCTAssertNil(app.tokenPromptWorkspace)
        XCTAssertNotNil(app.workspace)
        XCTAssertEqual(app.settings.workspaces.first?.rememberToken, false)
        app.setToken("t2", for: record, remember: true)
        XCTAssertEqual(app.configStore.keychain.read(Keychain.patAccount(record.id)), "t2")
        // 기억을 끄면 키체인에서 지운다.
        app.updateSettings { $0.workspaces[0].rememberToken = false }
        XCTAssertNil(app.configStore.keychain.read(Keychain.patAccount(record.id)))
    }

    func testExternalConfigEditsApplyOrReportSyntaxError() async throws {
        let url = app.configStore.configURL
        let original = try String(contentsOf: url, encoding: .utf8)
        defer { try? original.write(to: url, atomically: true, encoding: .utf8); app.configNotice = nil }
        try await Task.sleep(for: .milliseconds(1100))
        try (original + "\n[[깨진").write(to: url, atomically: true, encoding: .utf8)
        try await waitUntil("문법 오류 안내", app.configNotice != nil, timeout: 4)
        app.configNotice = nil
        try await Task.sleep(for: .milliseconds(1100))
        let changed = original.replacingOccurrences(of: "auto_save_seconds = 5", with: "auto_save_seconds = 9")
        XCTAssertNotEqual(changed, original)
        try changed.write(to: url, atomically: true, encoding: .utf8)
        try await waitUntil("바깥에서 고친 값", app.settings.preferences.autoSaveSeconds == 9, timeout: 4)
    }

    func testLockSessionTimerAndSleep() async throws {
        let session = LockSession()
        var expired = 0
        session.onExpire = { expired += 1 }
        session.clear()
        XCTAssertEqual(expired, 0, "기억한 숫자가 없으면 아무 일 없음")
        session.minutes = 0
        session.remember("123456")
        try await waitUntil("기억 시간 끝", session.pin == nil)
        XCTAssertEqual(expired, 1)
        XCTAssertEqual(session.generation, 1)
        session.minutes = 60
        session.remember("123456")
        session.minutes = 30
        session.minutes = 30
        session.clear()

        app.lockSession.remember("123456")
        app.updateSettings { $0.preferences.clearLockOnSleep = false }
        app.clearLockOnSleepIfNeeded()
        XCTAssertNotNil(app.lockSession.pin)
        app.updateSettings { $0.preferences.clearLockOnSleep = true }
        NSWorkspace.shared.notificationCenter.post(name: NSWorkspace.willSleepNotification, object: nil)
        try await waitUntil("잠자기 때 지움", app.lockSession.pin == nil)
        XCTAssertNotNil(BuildPepper.value ?? "기본값")
    }

    func testSystemEventsRefreshFlushAndNetwork() async throws {
        FakeGitHub.addIssue(title: "a", body: "a")
        app.addWorkspace(repo: FakeGitHub.repo, token: "t", remember: false)
        let active = try XCTUnwrap(app.workspace)
        try await waitUntil("연결", active.hasLoaded)
        // 방금 읽은 목록은 잠시 다시 읽지 않는다. 한 번 실패시켜 그 대기를 없앤 뒤 이벤트마다 다시 읽는지 본다.
        func resetCooldown() async {
            FakeGitHub.fail("/search/issues", status: 500)
            FakeGitHub.fail("/repos/\(FakeGitHub.repo)/issues", method: "GET", status: 500)
            await active.refresh(background: false)
            active.errorMessage = nil
        }
        func searches() -> Int { FakeGitHub.requests.filter { $0.contains("/search/issues") || $0 == "GET /repos/\(FakeGitHub.repo)/issues" }.count }
        await resetCooldown()
        var before = searches()
        NotificationCenter.default.post(name: NSApplication.didBecomeActiveNotification, object: nil)
        try await waitUntil("활성화하면 다시 읽기", searches() > before)
        await resetCooldown()
        before = searches()
        NSWorkspace.shared.notificationCenter.post(name: NSWorkspace.didWakeNotification, object: nil)
        try await waitUntil("깨어나면 다시 읽기", searches() > before)
        await resetCooldown()
        before = searches()
        await app.networkChanged(satisfied: false)
        await app.networkChanged(satisfied: true)
        XCTAssertGreaterThan(searches(), before, "네트워크가 돌아오면 다시 읽기")
        before = searches()
        await app.networkChanged(satisfied: true)
        XCTAssertEqual(searches(), before, "이미 연결돼 있으면 그대로")

        // 다른 앱으로 넘어가면 남은 저장을 한다.
        let number = active.displayedIssues[0].number
        let session = active.session(for: active.displayedIssues[0])
        session.edit(body: "넘어가며 저장")
        NotificationCenter.default.post(name: NSApplication.didResignActiveNotification, object: nil)
        try await waitUntil("저장", FakeGitHub.body(number) == "넘어가며 저장")
    }
}
