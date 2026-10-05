import AppKit
import GinoteCore
import GinoteTestSupport
import XCTest
@testable import Ginote_Native

/// 화면 모델(WorkspaceModel 등)을 가짜 GitHub(FakeGitHub)로 검사한다. 창을 띄우지 않는다.
/// 2026-10-05에 사용자가 쓰다가 발견한 버그(개수·목록·병합)를 다시 막는 것이 목적이다.
@MainActor
final class WorkspaceModelTests: XCTestCase {
    override func setUp() async throws {
        FakeGitHub.reset()
        GitHubClient.sessionOverride = FakeGitHub.session
        Dialogs.autoAnswer = true
    }

    override func tearDown() async throws {
        GitHubClient.sessionOverride = nil
    }

    private func connectedModel() async throws -> WorkspaceModel {
        let model = WorkspaceModel(workspace: Workspace(id: UUID().uuidString, repo: FakeGitHub.repo), token: "test-token", app: AppModel.shared)
        await model.connect()
        try await waitUntil("목록과 개수", model.hasLoaded && model.counts != nil)
        return model
    }

    private func waitUntil(_ what: String, timeout: Double = 5, _ condition: @autoclosure () -> Bool) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while !condition() {
            if Date() > deadline { XCTFail("기다렸지만 끝나지 않음: \(what)"); return }
            try await Task.sleep(for: .milliseconds(20))
        }
    }

    // MARK: - 개수

    func testTrashAndRestoreUpdateCountsImmediatelyWhileGitHubCountsLag() async throws {
        FakeGitHub.addIssue(title: "하나", labels: ["bug"])
        let target = FakeGitHub.addIssue(title: "둘", labels: ["bug"])
        let model = try await connectedModel()
        XCTAssertEqual(model.counts?.notes, 2)
        XCTAssertEqual(model.counts?.trash, 0)
        XCTAssertEqual(model.counts?.labels["bug"], 2)

        FakeGitHub.freezeCounts()
        let issue = try XCTUnwrap(model.issues.first { $0.number == target })
        await model.moveToTrash([issue], undoManager: nil)
        XCTAssertEqual(FakeGitHub.state(target), "closed")
        XCTAssertEqual(model.counts?.notes, 1, "휴지통으로 옮기면 사이드바 노트 개수가 바로 준다")
        XCTAssertEqual(model.counts?.trash, 1)
        XCTAssertEqual(model.counts?.labels["bug"], 1)
        XCTAssertEqual(model.totalCount, 1, "목록 머리 개수")

        let closed = Issue(id: issue.id, number: issue.number, title: issue.title, body: issue.body, state: "closed",
                           labels: issue.labels, createdAt: issue.createdAt, updatedAt: issue.updatedAt)
        await model.restore([closed], undoManager: nil)
        XCTAssertEqual(FakeGitHub.state(target), "open")
        XCTAssertEqual(model.counts?.notes, 2)
        XCTAssertEqual(model.counts?.trash, 0)
        XCTAssertEqual(model.counts?.labels["bug"], 2)
        XCTAssertEqual(model.totalCount, 2, "되돌리면 목록 머리 개수도 돌아온다")
    }

    func testNewNoteUpdatesCounts() async throws {
        FakeGitHub.addIssue(title: "기존")
        let model = try await connectedModel()
        FakeGitHub.freezeCounts()
        let session = try XCTUnwrap(model.createNote())
        try await waitUntil("새 노트 번호", session.number != nil)
        XCTAssertEqual(model.counts?.notes, 2, "새 노트를 만들면 사이드바 개수가 바로 는다")
        XCTAssertEqual(model.totalCount, 2)
        XCTAssertEqual(model.issues.first?.number, session.number, "새 노트는 보통 노트 맨 앞")
        XCTAssertEqual(session.displayTitle, NoteSession.placeholderTitle)
    }

    func testNewNoteTitleBeforeNumberIsPlaceholderNotUntitled() async throws {
        let model = try await connectedModel()
        let session = try XCTUnwrap(model.createNote())
        XCTAssertNil(session.number)
        XCTAssertEqual(session.displayTitle, "새 노트", "번호를 받기 전에도 GitHub에 만들 제목과 같아야 줄 제목이 바뀌지 않는다")
        try await waitUntil("새 노트 번호", session.number != nil)
    }

    func testLabelChangeUpdatesSidebarCount() async throws {
        let number = FakeGitHub.addIssue(title: "태그 시험")
        FakeGitHub.addLabel("bug")
        let model = try await connectedModel()
        XCTAssertEqual(model.counts?.labels["bug"] ?? 0, 0)
        FakeGitHub.freezeCounts()

        let issue = try XCTUnwrap(model.issues.first { $0.number == number })
        let session = model.session(for: issue)
        await session.loadDetails()
        session.setLabels(["bug"], saveNow: true)
        try await waitUntil("태그 저장", FakeGitHub.labelNames(number) == ["bug"])
        try await waitUntil("사이드바 bug 개수", model.counts?.labels["bug"] == 1)

        session.setLabels([], saveNow: true)
        try await waitUntil("태그 떼기 저장", FakeGitHub.labelNames(number).isEmpty)
        try await waitUntil("사이드바 bug 개수 0", model.counts?.labels["bug"] == 0)
    }

    func testMergeUpdatesListAndCounts() async throws {
        let first = FakeGitHub.addIssue(title: "가", body: "가 본문", labels: ["bug"])
        let second = FakeGitHub.addIssue(title: "나", body: "나 본문", labels: ["bug"])
        FakeGitHub.addIssue(title: "다")
        let model = try await connectedModel()
        XCTAssertEqual(model.totalCount, 3)
        FakeGitHub.freezeCounts()

        let targets = model.issues.filter { [first, second].contains($0.number) }
        await MergeRunner.run(targets, workspace: model)

        XCTAssertEqual(FakeGitHub.state(first), "closed")
        XCTAssertEqual(FakeGitHub.state(second), "closed")
        XCTAssertEqual(FakeGitHub.openCount, 2)
        XCTAssertEqual(model.totalCount, 2, "목록 머리: 원본 2개 빠지고 병합 노트 1개 더해진다(옛 GitHub 개수를 쓰지 않는다)")
        XCTAssertEqual(model.counts?.notes, 2)
        XCTAssertEqual(model.counts?.trash, 2)
        XCTAssertEqual(model.counts?.labels["bug"], 1)
        XCTAssertFalse(model.issues.contains { [first, second].contains($0.number) }, "원본은 목록에서 빠진다")
    }

    // MARK: - 목록 기억

    func testSwitchingBackToRememberedListShowsItWithoutSkeleton() async throws {
        FakeGitHub.addIssue(title: "열린 노트")
        FakeGitHub.addIssue(title: "닫힌 노트", state: "closed")
        let model = try await connectedModel()
        let notes = model.issues.map(\.number)

        model.scope = .trash
        try await waitUntil("휴지통 목록", !model.showingSkeleton && model.issues.first?.title == "닫힌 노트")

        model.scope = .notes
        await Task.yield()
        XCTAssertFalse(model.showingSkeleton, "기억한 목록은 자리표시 없이 바로 보인다")
        XCTAssertEqual(model.issues.map(\.number), notes)
    }

    func testFirstOpenLoadsCountsWithoutDebounceDelay() async throws {
        FakeGitHub.addIssue(title: "하나")
        let started = Date()
        _ = try await connectedModel()
        XCTAssertLessThan(Date().timeIntervalSince(started), 1.2, "처음 여는 저장소는 개수를 기다리지 않고 바로 읽는다")
    }
}
