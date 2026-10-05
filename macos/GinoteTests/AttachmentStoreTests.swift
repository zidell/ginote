import AppKit
import GinoteCore
import GinoteTestSupport
import XCTest
@testable import Ginote_Native

/// 노트 본문의 첨부: 읽기 순서, 올리기 제한, 본문에 넣기·복사, 삭제 유예와 복구, 내려받기, 썸네일.
@MainActor
final class AttachmentStoreTests: GinoteTestCase {
    private let uuid = "22222222-2222-4222-8222-222222222222"

    private func path(_ number: Int, _ name: String) -> String { folder(number) + "\(uuid)-\(name)" }
    private func link(_ path: String) -> String { AttachmentLinks.compress(AttachmentLinks.composeLink(repo: FakeGitHub.repo, path: path, name: "x.txt"), repo: FakeGitHub.repo) }

    private func png() -> Data {
        let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 8, pixelsHigh: 8, bitsPerSample: 8, samplesPerPixel: 4,
                                   hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
        return rep.representation(using: .png, properties: [:])!
    }

    // MARK: - 읽기

    func testLoadOrdersBodyLinksThenManagedThenOrphans() async throws {
        let number = FakeGitHub.addIssue(title: "a", body: "")
        let inBody = path(number, "body.txt"), managed = path(number, "managed.txt"), orphan = path(number, "orphan.txt")
        let image = path(number, "그림.png")
        for item in [inBody, managed, orphan, image] { FakeGitHub.putFile(item, data: Data("x".utf8)) }
        let body = "본문 \(AttachmentLinks.expand(link(inBody), repo: FakeGitHub.repo)) \(AttachmentLinks.expand(link(inBody), repo: FakeGitHub.repo)) [](없는/경로)"
        FakeGitHub.editIssue(number, body: AttachmentLinks.withManagedBlock(body, links: [
            AttachmentLinks.composeLink(repo: FakeGitHub.repo, path: managed, name: "managed.txt"),
            AttachmentLinks.composeLink(repo: FakeGitHub.repo, path: path(number, "사라진.txt"), name: "사라진.txt")
        ]))
        let session = try await loaded(number)
        let store = session.attachments!
        XCTAssertEqual(store.items.map(\.path), [inBody, managed, orphan, image], "본문 링크, 관리 블록, 나머지(폴더 순서)")
        XCTAssertTrue(session.hasAttachments)
        XCTAssertEqual(store.items.first?.id, inBody)
        XCTAssertTrue(store.items.contains { $0.isImage })
        XCTAssertTrue(store.isLinkedInBody(store.items[0]))
        XCTAssertFalse(store.isLinkedInBody(store.items[1]))

        let links = try XCTUnwrap(store.managedLinks(commentLinkedPaths: [orphan]))
        XCTAssertEqual(links.count, 2, "본문 링크·댓글 링크를 빼고 관리 블록에 넣는다")
        XCTAssertFalse(links.contains { $0.contains(orphan) })
    }

    func testAddChecksFilesAndReportsErrors() async throws {
        let number = FakeGitHub.addIssue(title: "a", body: "a")
        let session = try await open(number)
        let store = session.attachments!
        await store.add([])
        let missing = FileManager.default.temporaryDirectory.appendingPathComponent("없는-\(UUID().uuidString).txt")
        await store.add([missing])
        XCTAssertEqual(store.errorMessage, "“\(missing.lastPathComponent)” 파일을 읽지 못했습니다.")
        let big = try tempFile("큰.bin", "")
        try Data(count: AttachmentLinks.maxFileBytes + 1).write(to: big)
        await store.add([big])
        XCTAssertEqual(store.errorMessage, "“큰.bin” 파일은 10MB보다 커서 업로드하지 않았습니다.")
        XCTAssertTrue(store.items.isEmpty)

        FakeGitHub.fail("/contents/", method: "PUT", status: 403)
        await store.add([try tempFile("권한.txt")])
        XCTAssertEqual(store.errorMessage, "첨부 권한이 없습니다. PAT에 Contents: Read and write 권한을 주세요.")
        FakeGitHub.fail("/contents/", method: "PUT", status: 500, message: "올리기 실패")
        await store.add([try tempFile("서버.txt")])
        XCTAssertEqual(store.errorMessage, "올리기 실패")
        XCTAssertTrue(store.uploadingNames.isEmpty)

        store.errorMessage = nil
        await store.add([try tempFile("사진.png")])
        XCTAssertNil(store.errorMessage)
        XCTAssertEqual(store.items.map(\.name), ["사진.png"])
        XCTAssertEqual(store.items[0].type, "image/png")
        XCTAssertTrue(FakeGitHub.body(number)?.contains(folder(number)) ?? false, "올린 뒤 관리 블록을 강제로 저장한다")
    }

    func testDeleteRemovesLinkSavesThenDeletesFile() async throws {
        let number = FakeGitHub.addIssue(title: "a", body: "")
        let target = path(number, "x.txt")
        FakeGitHub.putFile(target, data: Data("x".utf8))
        FakeGitHub.editIssue(number, body: "본문 " + AttachmentLinks.expand(link(target), repo: FakeGitHub.repo))
        let session = try await loaded(number)
        let store = session.attachments!
        let item = store.items[0]

        AttachmentStore.deleteDelay = 1
        let undo = UndoManager()
        store.scheduleDelete(item, undoManager: undo)
        store.scheduleDelete(item, undoManager: undo)
        let pending = AppModel.shared.localState.pendingWork(repo: FakeGitHub.repo, issueNumber: number)?.attachmentDeletes
        XCTAssertEqual(pending?.map(\.path), [target], "앱이 꺼져도 이어서 지우게 남긴다")
        XCTAssertFalse(try XCTUnwrap(store.managedLinks(commentLinkedPaths: [])).contains { $0.contains(target) })
        try await Task.sleep(for: .milliseconds(50))
        undo.undo()
        try await waitUntil("되돌림", store.pendingDeletes.isEmpty)
        store.cancelDelete(item)

        AttachmentStore.deleteDelay = 0.05
        store.scheduleDelete(item, undoManager: nil)
        try await waitUntil("삭제", store.items.isEmpty && !FakeGitHub.filePaths.contains(target))
        XCTAssertEqual(FakeGitHub.body(number), "본문")
        XCTAssertFalse(session.hasAttachments)
        XCTAssertTrue(AppModel.shared.localState.pendingWork(repo: FakeGitHub.repo, issueNumber: number)?.attachmentDeletes.isEmpty ?? true)
    }

    func testDeleteRetriesAfterSaveOrDeleteFailure() async throws {
        let number = FakeGitHub.addIssue(title: "a", body: "a")
        let target = path(number, "x.txt")
        FakeGitHub.putFile(target, data: Data("x".utf8))
        let session = try await loaded(number)
        let store = session.attachments!

        FakeGitHub.fail("/issues/\(number)", method: "PATCH", status: 500, message: "저장 실패")
        FakeGitHub.fail("/contents/", method: "DELETE", status: 500, message: "파일 삭제 실패")
        store.scheduleDelete(store.items[0], undoManager: nil)
        try await waitUntil("파일 삭제 실패", store.errorMessage == "파일 삭제 실패")
        XCTAssertFalse(store.items.isEmpty)
        try await waitUntil("다시 시도해 삭제", store.items.isEmpty && !FakeGitHub.filePaths.contains(target))
    }

    func testPendingDeletesResumeAfterRestart() async throws {
        let number = FakeGitHub.addIssue(title: "a", body: "a")
        let target = path(number, "x.txt")
        FakeGitHub.putFile(target, data: Data("x".utf8))
        AppModel.shared.localState.updatePendingWork(repo: FakeGitHub.repo, issueNumber: number) {
            $0.attachmentDeletes = [
                .init(path: target, sha: "old", name: "x.txt", commentId: nil, expiresAt: Date()),
                .init(path: path(number, "없음.txt"), sha: "s", name: "없음.txt", commentId: nil, expiresAt: Date()),
                .init(path: "comment/file", sha: "s", name: "c", commentId: 9, expiresAt: Date())
            ]
        }
        let session = try await loaded(number)
        try await waitUntil("이어서 삭제", session.attachments.items.isEmpty && !FakeGitHub.filePaths.contains(target))
        let left = AppModel.shared.localState.pendingWork(repo: FakeGitHub.repo, issueNumber: number)?.attachmentDeletes
        XCTAssertEqual(left?.map(\.path), ["comment/file"], "댓글 첨부 삭제 기록은 건드리지 않는다")
    }

    func testArchivedNoteAttachmentsAreReadOnly() async throws {
        let number = FakeGitHub.addIssue(title: "a", body: "a", state: "closed")
        FakeGitHub.putFile(path(number, "x.txt"), data: Data("x".utf8))
        let session = try await loaded(number)
        let store = session.attachments!
        await store.add([try tempFile()])
        store.insertIntoBody(store.items[0])
        store.scheduleDelete(store.items[0], undoManager: nil)
        XCTAssertTrue(store.pendingDeletes.isEmpty)
        XCTAssertEqual(store.items.count, 1)
    }

    // MARK: - 파일
}
