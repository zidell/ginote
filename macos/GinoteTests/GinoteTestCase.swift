import Foundation
import GinoteCore
import GinoteTestSupport
import XCTest
@testable import Ginote_Native

/// 가짜 GitHub를 끼운 앱 모델 테스트의 공통 준비. 확인창은 자동으로 "예"라고 답하고, 앱 밖(클립보드·Finder)은
/// `SystemActions`가 테스트용으로 막는다.
@MainActor
class GinoteTestCase: XCTestCase {
    var workspace: WorkspaceModel!
    let pin = "246813"
    /// 세션·첨부·기록 저장소는 서로를 unowned로 잡는다. 테스트가 끝난 뒤 깨어나는 작업이 있어도 살아 있게 붙들어 둔다.
    private static var kept: [AnyObject] = []

    override func setUp() async throws {
        FakeGitHub.reset()
        GitHubClient.sessionOverride = FakeGitHub.session
        Dialogs.autoAnswer = true
        Dialogs.autoFiles = nil
        Dialogs.autoSaveURL = nil
        SystemActions.log = []
        // 첨부 캐시는 sha가 키다. 가짜 GitHub의 sha는 테스트마다 같은 값부터 다시 시작하므로 앞 테스트의 파일을 비운다.
        try? FileManager.default.removeItem(at: await ThumbnailCache.shared.directory)
        AttachmentStore.deleteDelay = 0.05
        AttachmentStore.retryDelay = 0.2
        CommentStore.deleteDelay = 0.05
        AppModel.shared.lockSession.clear()
        AppModel.shared.updateSettings { $0.preferences.titleMode = .firstLine; $0.preferences.autoSaveSeconds = 5 }
        workspace = WorkspaceModel(workspace: Workspace(id: UUID().uuidString, repo: FakeGitHub.repo), token: "t", app: AppModel.shared)
        Self.kept.append(workspace)
        // 번호가 테스트마다 1부터 다시 시작하므로 앞 테스트의 초안과 남은 작업을 지운다.
        for number in 0...20 {
            AppModel.shared.localState.setDraft(repo: FakeGitHub.repo, id: "issue.\(number)", nil)
            AppModel.shared.localState.updatePendingWork(repo: FakeGitHub.repo, issueNumber: number) { $0 = LocalState.PendingWork() }
        }
    }

    override func tearDown() async throws {
        AppModel.shared.lockSession.clear()
        AppModel.shared.updateSettings { $0.preferences.titleMode = .firstLine; $0.preferences.autoSaveSeconds = 5 }
        Dialogs.autoAnswer = true
        AppModel.shared.updateSettings { $0.workspaces = []; $0.activeWorkspaceId = "" }
        GitHubClient.sessionOverride = nil
    }

    func connect() async throws {
        await workspace.connect()
        try await waitUntil("목록", workspace.hasLoaded && !workspace.showingSkeleton)
    }

    /// 범위·필터를 바꾼 뒤 목록을 다시 읽기 시작하고 끝날 때까지 기다린다.
    func settle() async throws {
        try await Task.sleep(for: .milliseconds(150))
        try await waitUntil("목록 읽기", !workspace.loading && !workspace.showingSkeleton)
    }

    func open(_ number: Int) async throws -> NoteSession {
        let issue = try await workspace.client.getIssue(number)
        return keep(NoteSession(workspace: workspace, issue: issue))
    }

    /// 열고 첨부·기록까지 읽은 세션.
    func loaded(_ number: Int) async throws -> NoteSession {
        let session = try await open(number)
        await session.loadDetails()
        return session
    }

    func keep<T: AnyObject>(_ object: T) -> T {
        Self.kept.append(object)
        return object
    }

    func folder(_ number: Int, comment: Int? = nil) -> String { AttachmentLinks.directory(issueNumber: number, commentId: comment) + "/" }

    func tempFile(_ name: String = "메모.txt", _ text: String = "첨부") throws -> URL {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("ginote-test-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let url = directory.appendingPathComponent(name)
        try Data(text.utf8).write(to: url)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        return url
    }

    func waitUntil(_ what: String, timeout: Double = 5, _ condition: @autoclosure () -> Bool,
                   file: StaticString = #filePath, line: UInt = #line) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while !condition() {
            if Date() > deadline { XCTFail("기다렸지만 끝나지 않음: \(what)", file: file, line: line); return }
            try await Task.sleep(for: .milliseconds(20))
        }
    }

    func waitUntil(_ what: String, _ condition: @autoclosure () -> Bool, timeout: Double,
                   file: StaticString = #filePath, line: UInt = #line) async throws {
        try await waitUntil(what, timeout: timeout, condition(), file: file, line: line)
    }

    func patches(_ number: Int) -> Int {
        FakeGitHub.requests.filter { $0 == "PATCH /repos/\(FakeGitHub.repo)/issues/\(number)" }.count
    }
}
