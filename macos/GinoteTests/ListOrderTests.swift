import AppKit
import GinoteCore
import XCTest
@testable import Ginote_Native

/// 목록 줄 순서(화면과 키보드 이동이 같이 쓰는 WorkspaceModel.listRowIds).
@MainActor
final class ListOrderTests: XCTestCase {
    override func setUp() async throws {
        FakeGitHub.reset()
        GitHubClient.sessionOverride = FakeGitHub.session
    }

    override func tearDown() async throws { GitHubClient.sessionOverride = nil }

    func testNewNoteSitsBelowPinnedBeforeAndAfterNumbering() async throws {
        FakeGitHub.addIssue(title: "고정", labels: [PinLabel.name])
        FakeGitHub.addIssue(title: "보통")
        let model = WorkspaceModel(workspace: Workspace(id: UUID().uuidString, repo: FakeGitHub.repo), token: "t", app: AppModel.shared)
        await model.connect()
        let pinnedId = try XCTUnwrap(model.displayedPinned.first?.id)

        let session = try XCTUnwrap(model.createNote())
        XCTAssertEqual(Array(model.listRowIds.prefix(2)), [pinnedId, NoteSession.newNoteSelectionId], "번호를 받기 전: 고정 노트 바로 아래")

        let deadline = Date().addingTimeInterval(5)
        while session.number == nil, Date() < deadline { try await Task.sleep(for: .milliseconds(20)) }
        let newId = try XCTUnwrap(session.issue?.id)
        XCTAssertEqual(Array(model.listRowIds.prefix(2)), [pinnedId, newId], "번호를 받은 뒤에도 같은 자리")
    }
}
