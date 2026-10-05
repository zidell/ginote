import AppKit
import GinoteCore
import GinoteTestSupport
import UniformTypeIdentifiers
import XCTest
@testable import Ginote_Native

/// 목록·메뉴에서 쓰는 노트 작업: 번호 복사, GitHub에서 보기, 붙여넣어 새 노트, 병합, 일괄 태그.
@MainActor
final class NoteActionsTests: GinoteTestCase {
    private func issue(_ number: Int) async throws -> Issue { try await workspace.client.getIssue(number) }

    private func png() -> Data {
        let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 4, pixelsHigh: 4, bitsPerSample: 8, samplesPerPixel: 4,
                                   hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
        return rep.representation(using: .png, properties: [:])!
    }

    // MARK: - 번호 복사·GitHub

    func testMergeMovesCommentsCopiesFilesAndClosesOriginals() async throws {
        let first = FakeGitHub.addIssue(title: "", body: "첫 노트", labels: ["work"])
        let second = FakeGitHub.addIssue(title: "둘째", body: "둘째 노트", labels: ["home"])
        FakeGitHub.addComment(to: first, body: "첫 기록")
        FakeGitHub.putFile(folder(second) + "33333333-3333-4333-8333-333333333333-a.txt", data: Data("a".utf8))
        try await connect()
        let targets = [try await issue(first), try await issue(second)]
        Dialogs.log = []
        await MergeRunner.run(targets, workspace: workspace)
        let merged = 3
        XCTAssertEqual(FakeGitHub.title(merged), "병합 노트", "가장 이른 노트의 제목이 비면 기본 제목")
        XCTAssertTrue(FakeGitHub.body(merged)?.contains("첫 노트") ?? false)
        XCTAssertTrue(FakeGitHub.body(merged)?.contains("둘째 노트") ?? false)
        XCTAssertEqual(Set(FakeGitHub.labelNames(merged)), ["work", "home"])
        XCTAssertEqual(FakeGitHub.commentBodies(merged).count, 1, "원본 기록은 새 노트의 기록으로 옮긴다")
        XCTAssertTrue(FakeGitHub.filePaths.contains { $0.hasPrefix(folder(merged)) }, "첨부도 새 노트로 복사한다")
        XCTAssertEqual(FakeGitHub.state(first), "closed")
        XCTAssertEqual(FakeGitHub.state(second), "closed")
        XCTAssertTrue(Dialogs.log.last?.contains("병합 노트 #\(merged)") ?? false)
        XCTAssertFalse(workspace.merging)
    }

    func testMergeFailuresKeepOriginals() async throws {
        let first = FakeGitHub.addIssue(title: "a", body: "a")
        let second = FakeGitHub.addIssue(title: "b", body: "b")
        try await connect()
        let targets = [try await issue(first), try await issue(second)]

        // 만들기 전 실패: 원본은 그대로.
        Dialogs.log = []
        FakeGitHub.fail("/issues/\(first)", method: "GET", status: 500, message: "읽기 실패")
        await MergeRunner.run(targets, workspace: workspace)
        XCTAssertEqual(Dialogs.log.last, "inform: 노트를 병합하지 못했습니다. 원본 노트는 휴지통으로 옮기지 않았습니다. 읽기 실패")

        // 만든 뒤 실패: 불완전한 새 노트를 닫는다.
        FakeGitHub.fail("/issues/3", method: "PATCH", status: 500, message: "쓰기 실패")
        await MergeRunner.run(targets, workspace: workspace)
        XCTAssertEqual(FakeGitHub.state(3), "closed")
        XCTAssertTrue(Dialogs.log.last?.contains("불완전한 병합 노트 #3") ?? false)
        XCTAssertEqual(FakeGitHub.state(first), "open")

        // 원본 하나를 닫지 못하면 알린다.
        FakeGitHub.fail("/issues/\(second)", method: "PATCH", status: 500)
        await MergeRunner.run(targets, workspace: workspace)
        XCTAssertTrue(Dialogs.log.last?.contains("#\(second)을(를) 휴지통으로 옮기지 못했습니다") ?? false)
        XCTAssertEqual(FakeGitHub.state(first), "closed")
    }

    func testMergeTooLongShowsLengthNotNetworkError() async throws {
        let half = String(repeating: "가", count: NoteText.maxBodyLength / 2 + 10)
        let first = FakeGitHub.addIssue(title: "a", body: half)
        let second = FakeGitHub.addIssue(title: "b", body: half)
        try await connect()
        Dialogs.log = []
        await MergeRunner.run([try await issue(first), try await issue(second)], workspace: workspace)
        let message = try XCTUnwrap(Dialogs.log.last)
        XCTAssertTrue(message.hasPrefix("inform: 노트를 병합하지 못했습니다. 원본 노트는 휴지통으로 옮기지 않았습니다. 병합 기록이 노트 최대 길이("), message)
        XCTAssertEqual(FakeGitHub.openCount, 2)
    }
}
