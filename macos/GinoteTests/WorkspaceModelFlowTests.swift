import AppKit
import GinoteCore
import GinoteTestSupport
import XCTest
@testable import Ginote_Native

/// WorkspaceModel의 나머지 경로: 연결 실패, 검색·필터, 새로고침·재시도, 붙들기, 더 읽기, 휴지통 대기열, 고정, 태그, 첨부 정리.
@MainActor
final class WorkspaceModelFlowTests: XCTestCase {
    override func setUp() async throws {
        FakeGitHub.reset()
        GitHubClient.sessionOverride = FakeGitHub.session
        Dialogs.autoAnswer = true
    }

    override func tearDown() async throws { GitHubClient.sessionOverride = nil }

    private func model() -> WorkspaceModel {
        WorkspaceModel(workspace: Workspace(id: UUID().uuidString, repo: FakeGitHub.repo), token: "t", app: AppModel.shared)
    }

    private func connected() async throws -> WorkspaceModel {
        let model = model()
        await model.connect()
        try await waitUntil("목록", model.hasLoaded && !model.showingSkeleton)
        return model
    }

    private func waitUntil(_ what: String, timeout: Double = 5, _ condition: @autoclosure () -> Bool) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while !condition() {
            if Date() > deadline { XCTFail("기다렸지만 끝나지 않음: \(what)"); return }
            try await Task.sleep(for: .milliseconds(20))
        }
    }

    // MARK: - 연결

    func testFailedLoadShowsErrorAndRetriesServerErrors() async throws {
        FakeGitHub.addIssue(title: "하나")
        let model = model()
        await model.connect()
        try await waitUntil("목록", model.hasLoaded)
        FakeGitHub.fail("/repos/\(FakeGitHub.repo)/issues", status: 502)
        await model.reload()
        XCTAssertNotNil(model.errorMessage)
        try await waitUntil("재시도로 복구", timeout: 5, model.errorMessage == nil)

        FakeGitHub.fail("/repos/\(FakeGitHub.repo)/issues", status: 401, times: 2)
        await model.reload()
        XCTAssertEqual(model.errorMessage, "PAT가 올바르지 않거나 폐기되었습니다.", "인증 오류는 다시 시도하지 않는다")
        await model.refresh(background: true, ignoringCooldown: true)
    }

    // MARK: - 더 읽기

    func testHeldIssuesSurviveLaggingLists() async throws {
        let stale = FakeGitHub.addIssue(title: "닫을 노트", labels: ["work"])
        let model = try await connected()
        let issue = try XCTUnwrap(model.issues.first { $0.number == stale })

        // 다른 화면이 만든 노트(아직 목록에 안 나옴)를 올린다.
        var created = issue
        created.id = 999_999; created.number = 999; created.title = "방금 만듦"; created.updatedAt = "2099-01-01T00:00:00Z"
        created.labels = []
        model.insertCreated(created)
        XCTAssertEqual(model.openedId, created.id)
        await model.reload()
        XCTAssertEqual(model.issues.first?.title, "방금 만듦", "목록에 없더라도 붙들어 둔 새 노트를 앞에 둔다")

        // 태그로 거른 목록에는 태그가 맞을 때만 붙든 노트를 넣는다.
        model.labelFilter = "work"
        try await waitUntil("태그로 거른 목록(붙든 새 노트는 태그가 없어 빠짐)", model.issues.map(\.number) == [stale])

        // 방금 닫았는데 열린 목록에 아직 나오면 뺀다.
        model.labelFilter = nil
        try await waitUntil("전체", !model.showingSkeleton)
        var closed = issue
        closed.state = "closed"; closed.updatedAt = "2099-01-01T00:00:00Z"
        model.hold(closed)
        await model.reload()
        try await waitUntil("방금 닫은 노트가 빠짐", !model.issues.contains { $0.id == issue.id })
    }

    func testTrashQueueCancelAndInFlight() async throws {
        let a = FakeGitHub.addIssue(title: "a")
        let b = FakeGitHub.addIssue(title: "b")
        let model = try await connected()
        let ia = try XCTUnwrap(model.issues.first { $0.number == a })
        let ib = try XCTUnwrap(model.issues.first { $0.number == b })

        let first = Task { await model.moveToTrash([ia], undoManager: nil) }
        try await waitUntil("대기", model.trashEntry(for: ia.id) != nil)
        await model.moveToTrash([ia], undoManager: nil) // 이미 대기 중이면 다시 넣지 않는다
        XCTAssertEqual(model.trashQueue.count, 1)
        XCTAssertTrue(model.cancelMostRecentTrash())
        XCTAssertFalse(model.cancelMostRecentTrash())
        await first.value
        XCTAssertEqual(FakeGitHub.state(a), "open", "취소한 노트는 옮기지 않는다")

        let second = Task { await model.moveToTrash([ib], undoManager: nil) }
        try await waitUntil("대기", model.trashEntry(for: ib.id) != nil)
        model.cancelAllTrash()
        XCTAssertFalse(model.cancelTrash(entry: 999))
        await second.value
        XCTAssertEqual(FakeGitHub.state(b), "open")
    }

    func testTrashSavesOpenNoteFirstAndStopsWhenSaveFails() async throws {
        let number = FakeGitHub.addIssue(title: "x", body: "원래")
        let model = try await connected()
        let issue = try XCTUnwrap(model.issues.first)
        let session = model.session(for: issue)
        await session.loadDetails()
        session.edit(body: "고친 본문", composing: false)
        FakeGitHub.fail("/issues/\(number)", method: "PATCH", status: 500, times: 3)
        await model.moveToTrash([issue], undoManager: nil)
        XCTAssertEqual(model.errorMessage, "GitHub에 저장하지 못해 휴지통으로 옮기지 않았습니다.")
        XCTAssertEqual(FakeGitHub.state(number), "open")
    }

    // MARK: - 고정

    func testTogglePinCreatesLabelAndRevertsOnFailure() async throws {
        let number = FakeGitHub.addIssue(title: "x")
        let model = try await connected()
        let issue = try XCTUnwrap(model.issues.first)
        await model.togglePin(issue)
        XCTAssertEqual(FakeGitHub.labelNames(number), [PinLabel.name])
        XCTAssertTrue(model.labels.contains { PinLabel.isPin($0.name) })
        await model.togglePin(issue)
        XCTAssertEqual(FakeGitHub.labelNames(number), [])
        FakeGitHub.fail("/labels/\(PinLabel.name.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed)!)", status: 404)
        await model.togglePin(issue)
        await model.togglePin(issue) // 이미 떼어진 라벨(404)도 풀린 것으로 본다

        FakeGitHub.fail("/issues/\(number)/labels", method: "POST", status: 500)
        await model.togglePin(issue)
        XCTAssertNotNil(model.errorMessage)
        XCTAssertFalse(model.displayedPinned.contains { $0.number == number }, "실패하면 되돌린다")
    }

    // MARK: - 태그 관리

    func testLabelManagement() async throws {
        let number = FakeGitHub.addIssue(title: "x", labels: ["옛이름"])
        let model = try await connected()
        try await waitUntil("태그", !model.labels.isEmpty)
        let issue = try XCTUnwrap(model.issues.first)
        let session = model.session(for: issue)
        await session.loadDetails()
        model.labelFilter = "옛이름"
        try await waitUntil("필터", !model.showingSkeleton)

        try await model.ensureLabels(["옛이름", "새태그", PinLabel.name])
        XCTAssertTrue(FakeGitHub.labelList.contains("새태그"))

        do { _ = try await model.createLabel(definition: "  "); XCTFail() } catch {}
        let created = try await model.createLabel(definition: "일정: 약속")
        XCTAssertEqual(created.name, "일정")

        let old = try XCTUnwrap(model.labels.first { $0.name == "옛이름" })
        try await model.renameLabel(old, definition: "옛이름") // 바뀐 것이 없으면 보내지 않는다
        do { try await model.renameLabel(old, definition: ":"); XCTFail() } catch {}
        try await model.renameLabel(old, definition: "새이름: 설명")
        XCTAssertEqual(FakeGitHub.labelNames(number), ["새이름"])
        XCTAssertEqual(model.issues.first?.labels.map(\.name), ["새이름"])
        XCTAssertEqual(session.visibleLabels, ["새이름"])
        XCTAssertEqual(model.labelFilter, "새이름", "거는 필터도 새 이름으로")

        let renamed = try XCTUnwrap(model.labels.first { $0.name == "새이름" })
        try await model.deleteLabel(renamed)
        XCTAssertNil(model.labelFilter)
        XCTAssertFalse(FakeGitHub.labelList.contains("새이름"))
    }

    // MARK: - 첨부 정리

    func testPruneExpiredAttachmentsOncePerDay() async throws {
        let expired = FakeGitHub.addIssue(title: "[expired] 오래됨", state: "closed")
        FakeGitHub.putFile(AttachmentLinks.directory(issueNumber: expired) + "/a.txt", data: Data("x".utf8))
        let model = model()
        AppModel.shared.localState.markAttachmentsPruned(repo: FakeGitHub.repo, now: Date(timeIntervalSince1970: 0))
        model.pruneExpiredAttachments()
        try await waitUntil("정리", FakeGitHub.filePaths.isEmpty)
        try await waitUntil("정리 시각", !AppModel.shared.localState.shouldPruneAttachments(repo: FakeGitHub.repo))
        model.pruneExpiredAttachments() // 하루 안에는 다시 하지 않는다

        AppModel.shared.localState.markAttachmentsPruned(repo: FakeGitHub.repo, now: Date(timeIntervalSince1970: 0))
        FakeGitHub.fail("/search/issues", status: 500)
        model.pruneExpiredAttachments()
        try await Task.sleep(for: .milliseconds(200))
        XCTAssertTrue(AppModel.shared.localState.shouldPruneAttachments(repo: FakeGitHub.repo), "실패하면 다음에 다시")
    }
}
