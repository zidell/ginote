import AppKit
import GinoteCore
import GinoteTestSupport
import XCTest
@testable import Ginote_Native

/// 노트에 덧붙인 기록(댓글): 읽기, 쓰기·저장, 삭제와 첨부 정리, 기록 첨부, 음성, 잠금, 복구.
@MainActor
final class CommentStoreTests: GinoteTestCase {
    private let uuid = "11111111-1111-4111-8111-111111111111"

    private func filePath(_ number: Int, comment: Int? = nil, _ name: String) -> String {
        folder(number, comment: comment) + "\(uuid)-\(name)"
    }

    private func link(_ path: String) -> String { AttachmentLinks.composeLink(repo: FakeGitHub.repo, path: path, name: "x.txt") }

    private func comments(_ number: Int) async throws -> (NoteSession, CommentStore) {
        let session = try await loaded(number)
        return (session, session.comments)
    }

    // MARK: - 읽기

    func testAddEditSaveAndUpdate() async throws {
        let number = FakeGitHub.addIssue(title: "a", body: "a")
        let (_, store) = try await comments(number)
        store.add()
        let item = try XCTUnwrap(store.items.first)
        XCTAssertEqual(store.focusedCommentId, item.localId)
        XCTAssertNil(item.remoteId)

        store.edit(item, text: String(repeating: "가", count: NoteText.maxBodyLength + 5))
        XCTAssertEqual(NoteText.length(item.text), NoteText.maxBodyLength)
        store.edit(item, text: "새 기록")
        store.edit(item, text: "새 기록")
        XCTAssertTrue(item.dirty)
        let draft = AppModel.shared.localState.pendingWork(repo: FakeGitHub.repo, issueNumber: number)?.commentDrafts
        XCTAssertEqual(draft?.map(\.body), ["새 기록"], "저장 전 기록은 기기에 남긴다")

        let created = await store.save(item)
        XCTAssertTrue(created)
        XCTAssertNotNil(item.remoteId)
        XCTAssertEqual(FakeGitHub.commentBodies(number), ["새 기록"])
        XCTAssertFalse(item.dirty)
        let notDirty = await store.save(item)
        XCTAssertTrue(notDirty, "바뀐 게 없으면 보내지 않는다")

        store.edit(item, text: "고친 기록")
        let flushed = await store.flush()
        XCTAssertTrue(flushed)
        XCTAssertEqual(FakeGitHub.commentBodies(number), ["고친 기록"])
    }

    func testTextChangedDuringSaveSavesAgain() async throws {
        let number = FakeGitHub.addIssue(title: "a", body: "a")
        let (_, store) = try await comments(number)
        store.add()
        let item = store.items[0]
        store.edit(item, text: "하나")
        FakeGitHub.latency = 0.3
        let first = Task { await store.save(item) }
        try await waitUntil("저장 시작", item.saving)
        let busy = await store.save(item)
        XCTAssertFalse(busy, "저장 중에는 겹쳐 저장하지 않는다")
        store.edit(item, text: "하나 둘")
        _ = await first.value
        try await waitUntil("다시 저장", FakeGitHub.commentBodies(number) == ["하나 둘"] && !item.dirty)
    }

    func testDeleteRemovesCommentAndOnlyItsUnlinkedFiles() async throws {
        let number = FakeGitHub.addIssue(title: "a", body: "")
        let id = FakeGitHub.addComment(to: number, body: "")
        let own = filePath(number, comment: id, "own.txt")
        let keptByBody = filePath(number, comment: id, "body.txt")
        let outside = filePath(number, "outside.txt")
        FakeGitHub.editIssue(number, body: "본문 \(link(keptByBody))")
        _ = FakeGitHub.addComment(to: number, body: "다른 기록")
        let commentBody = "지울 기록 \(link(outside))"
        FakeGitHub.putFile(own, data: Data("o".utf8))
        FakeGitHub.putFile(keptByBody, data: Data("b".utf8))
        FakeGitHub.putFile(outside, data: Data("x".utf8))
        let (_, store) = try await comments(number)
        let item = try XCTUnwrap(store.items.first { $0.remoteId == id })
        item.text = AttachmentLinks.compress(commentBody, repo: FakeGitHub.repo)

        store.scheduleDelete(item, undoManager: nil)
        XCTAssertTrue(item.deleting)
        store.scheduleDelete(item, undoManager: nil)
        try await waitUntil("기록 삭제", !store.items.contains { $0 === item } && !FakeGitHub.filePaths.contains(own))
        try await waitUntil("기록이 링크한 바깥 파일 삭제", !FakeGitHub.filePaths.contains(outside))
        XCTAssertTrue(FakeGitHub.filePaths.contains(keptByBody), "본문이 링크한 파일은 남긴다")
        XCTAssertEqual(FakeGitHub.commentBodies(number), ["다른 기록"])
    }

    func testDeleteCanBeUndoneAndHandles404AndErrors() async throws {
        let number = FakeGitHub.addIssue(title: "a", body: "a")
        let first = FakeGitHub.addComment(to: number, body: "되살릴 기록")
        let (_, store) = try await comments(number)
        let item = store.items[0]

        CommentStore.deleteDelay = 1
        let undo = UndoManager()
        store.scheduleDelete(item, undoManager: undo)
        try await Task.sleep(for: .milliseconds(50))
        undo.undo()
        try await waitUntil("되돌림", !item.deleting)
        store.cancelDelete(item)
        try await Task.sleep(for: .milliseconds(1100))
        XCTAssertEqual(FakeGitHub.commentBodies(number), ["되살릴 기록"])

        CommentStore.deleteDelay = 0.05
        FakeGitHub.fail("/issues/comments/\(first)", method: "DELETE", status: 500, message: "삭제 실패")
        store.scheduleDelete(item, undoManager: nil)
        try await waitUntil("삭제 실패", store.errorMessage == "삭제 실패" && !item.deleting && !item.deleteInFlight)
        XCTAssertEqual(store.items.count, 1)

        FakeGitHub.fail("/issues/comments/\(first)", method: "DELETE", status: 404)
        store.scheduleDelete(item, undoManager: nil)
        try await waitUntil("이미 지워진 기록", store.items.isEmpty)
    }

    func testCommentAttachments() async throws {
        let number = FakeGitHub.addIssue(title: "a", body: "a")
        let (_, store) = try await comments(number)
        store.add()
        let draft = store.items[0]
        await store.addAttachments([try tempFile()], to: draft)
        XCTAssertEqual(store.errorMessage, "댓글을 먼저 저장한 뒤 파일을 첨부하세요.")

        store.edit(draft, text: "첨부할 기록")
        _ = await store.save(draft)
        let id = try XCTUnwrap(draft.remoteId)
        let missing = FileManager.default.temporaryDirectory.appendingPathComponent("없는-\(UUID().uuidString).txt")
        let big = try tempFile("큰 파일.bin", "")
        try Data(count: AttachmentLinks.maxFileBytes + 1).write(to: big)
        store.errorMessage = nil
        await store.addAttachments([missing, big, try tempFile("기록 첨부.txt")], to: draft)
        XCTAssertEqual(store.errorMessage, "“큰 파일.bin” 파일은 10MB보다 커서 업로드하지 않았습니다.")
        XCTAssertEqual(draft.attachments.map(\.name), ["기록 첨부.txt"])
        XCTAssertTrue(FakeGitHub.filePaths.contains { $0.hasPrefix(folder(number, comment: id)) })
        XCTAssertTrue(FakeGitHub.commentBodies(number)[0].contains(folder(number, comment: id)), "관리 블록에 링크를 넣어 저장한다")

        FakeGitHub.fail("/contents/", method: "PUT", status: 500, message: "올리기 실패")
        await store.addAttachments([try tempFile("실패.txt")], to: draft)
        XCTAssertEqual(store.errorMessage, "올리기 실패")
        XCTAssertEqual(draft.attachments.count, 1)
        XCTAssertTrue(draft.uploading.isEmpty)
    }

    func testLockedNoteCommentsAreEncryptedAndDecrypted() async throws {
        let number = FakeGitHub.addIssue(title: "a", body: "잠글 본문")
        FakeGitHub.addComment(to: number, body: "평문 기록")
        let (session, store) = try await comments(number)
        await session.lock(pin: pin)
        store.add()
        store.edit(store.items[1], text: "잠긴 뒤 쓴 기록")
        _ = await store.flush()
        let stored = FakeGitHub.commentBodies(number)
        XCTAssertEqual(stored[0], "평문 기록", "잠그기 전 기록은 그대로")
        XCTAssertTrue(NoteLock.isLockedPayload(stored[1]), "풀린 잠금 노트의 새 기록은 암호화한다")

        // 다른 창에서 잠긴 채 열면 기록도 잠겨 있다가 숫자로 풀린다.
        AppModel.shared.lockSession.clear()
        let other = try await loaded(number)
        XCTAssertEqual(other.comments.items[1].text, "")
        XCTAssertNotNil(other.comments.items[1].lockedPayload)
        other.comments.decrypt(pin: "000000")
        XCTAssertNotNil(other.comments.items[1].lockedPayload, "틀린 숫자는 건너뛴다")
        try other.unlock(pin: pin)
        XCTAssertEqual(other.comments.items[1].text, "잠긴 뒤 쓴 기록")

        // 숫자를 기억하면 기록을 읽을 때 바로 푼다.
        let third = try await loaded(number)
        try await waitUntil("기억한 숫자로 열림", third.lockState == .unlocked)
        await third.comments.load()
        XCTAssertEqual(third.comments.items[1].text, "잠긴 뒤 쓴 기록")

        // 잠금을 풀면 암호화한 기록도 평문으로 다시 저장한다.
        await other.removeLock()
        try await waitUntil("평문 기록", FakeGitHub.commentBodies(number) == ["평문 기록", "잠긴 뒤 쓴 기록"])

        // 다시 잠기면 화면의 기록 글을 비우고 다시 읽는다.
        third.comments.relock()
        XCTAssertEqual(third.comments.items.first?.text, "")
        try await waitUntil("다시 읽음", !third.comments.loading && third.comments.items.first?.text == "평문 기록")
    }

    // MARK: - 복구

    func testPendingDraftsAreRestoredAndSaved() async throws {
        let number = FakeGitHub.addIssue(title: "a", body: "a")
        let changed = FakeGitHub.addComment(to: number, body: "원래 기록")
        let same = FakeGitHub.addComment(to: number, body: "같은 기록")
        AppModel.shared.localState.updatePendingWork(repo: FakeGitHub.repo, issueNumber: number) {
            $0.commentDrafts = [
                .init(id: changed, localId: "comment-\(changed)", body: "고친 기록"),
                .init(id: same, localId: "comment-\(same)", body: "같은 기록"),
                .init(id: 999, localId: "comment-999", body: "사라진 기록"),
                .init(id: nil, localId: "draft-new", body: "새로 쓰던 기록")
            ]
        }
        let (_, store) = try await comments(number)
        try await waitUntil("복구 저장", FakeGitHub.commentBodies(number) == ["고친 기록", "같은 기록", "새로 쓰던 기록"])
        try await waitUntil("저장 끝", !store.items.contains { $0.dirty })
        XCTAssertEqual(store.items.map(\.localId).last, "draft-new")
        let left = AppModel.shared.localState.pendingWork(repo: FakeGitHub.repo, issueNumber: number)?.commentDrafts
        XCTAssertTrue(left?.isEmpty ?? true, "저장한 초안은 지운다")
    }
}
