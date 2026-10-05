import AppKit
import GinoteCore
import GinoteTestSupport
import XCTest
@testable import Ginote_Native

/// 열린 노트 하나의 편집·저장·초안·잠금 흐름을 가짜 GitHub로 검사한다.
@MainActor
final class NoteSessionTests: GinoteTestCase {
    // MARK: - 편집과 저장

    func testEditBodySavesFirstLineTitle() async throws {
        let number = FakeGitHub.addIssue(title: "옛 제목", body: "옛 본문")
        let session = try await open(number)
        XCTAssertEqual(session.title, "옛 제목")
        XCTAssertFalse(session.isNew)
        XCTAssertTrue(session.isEditable)

        session.edit(body: "새 제목\n둘째 줄")
        XCTAssertTrue(session.dirty)
        XCTAssertEqual(session.displayTitle, "새 제목")
        let saved = await session.flush()
        XCTAssertTrue(saved)
        XCTAssertEqual(FakeGitHub.title(number), "새 제목")
        XCTAssertEqual(FakeGitHub.body(number), "새 제목\n둘째 줄")
        XCTAssertFalse(session.dirty)
        XCTAssertNil(AppModel.shared.localState.draft(repo: FakeGitHub.repo, id: "issue.\(number)"))

        // 같은 내용이면 다시 보내지 않는다.
        let before = patches(number)
        session.edit(body: "새 제목\n둘째 줄")
        let unchanged = await session.save()
        XCTAssertTrue(unchanged)
        XCTAssertEqual(patches(number), before)
    }

    func testComposingEditDoesNotScheduleSave() async throws {
        let number = FakeGitHub.addIssue(title: "a", body: "a")
        let session = try await open(number)
        session.edit(body: "ㅎ", composing: true)
        XCTAssertTrue(session.dirty)
        XCTAssertEqual(session.body, "ㅎ")
        session.edit(body: "ㅎ", composing: true)
        try await Task.sleep(for: .milliseconds(200))
        XCTAssertEqual(patches(number), 0)
        _ = await session.flush()
    }

    func testForceSaveWhileSavingQueuesAnother() async throws {
        let number = FakeGitHub.addIssue(title: "a", body: "a")
        let session = try await open(number)
        FakeGitHub.latency = 0.3
        session.edit(body: "하나")
        let first = Task { await session.save() }
        try await waitUntil("저장 시작", session.saving)
        session.edit(body: "둘")
        let skipped = await session.save(force: true)
        XCTAssertFalse(skipped, "저장 중이면 줄을 세우고 돌아온다")
        _ = await first.value
        try await waitUntil("대기한 저장", FakeGitHub.body(number) == "둘" && !session.saving)
        _ = await session.flush()
    }

    func testNewerChangesDuringSaveScheduleAnotherSave() async throws {
        AppModel.shared.updateSettings { $0.preferences.autoSaveSeconds = 3 }
        let number = FakeGitHub.addIssue(title: "a", body: "a")
        let session = try await open(number)
        FakeGitHub.latency = 0.3
        session.edit(body: "하나")
        let first = Task { await session.save() }
        try await waitUntil("저장 시작", session.saving)
        session.edit(body: "하나 둘")
        _ = await first.value
        XCTAssertTrue(session.dirty, "저장 중에 바뀐 내용은 다음 저장으로 넘긴다")
        let saved = await session.flush()
        XCTAssertTrue(saved)
        XCTAssertEqual(FakeGitHub.body(number), "하나 둘")
    }

    func testSaveFailureShowsErrorAndRetries() async throws {
        let number = FakeGitHub.addIssue(title: "a", body: "a")
        let session = try await open(number)
        session.edit(body: "실패할 저장")
        FakeGitHub.fail("/issues/\(number)", method: "PATCH", status: 500, message: "서버 오류")
        let saved = await session.save()
        XCTAssertFalse(saved)
        XCTAssertTrue(session.saveFailed)
        XCTAssertEqual(session.errorMessage, "서버 오류")
        let flushed = await session.flush()
        XCTAssertTrue(flushed)
        XCTAssertFalse(session.saveFailed)
        XCTAssertEqual(FakeGitHub.body(number), "실패할 저장")
        let again = await session.flush()
        XCTAssertTrue(again, "저장할 것이 없으면 성공")
    }

    // MARK: - 다른 기기에서 닫힌 노트

    func testClosedElsewhereReopensWhenConfirmed() async throws {
        let number = FakeGitHub.addIssue(title: "a", body: "a")
        let session = try await open(number)
        FakeGitHub.editIssue(number, state: "closed")
        session.edit(body: "살림")
        let saved = await session.save()
        XCTAssertTrue(saved)
        XCTAssertEqual(FakeGitHub.state(number), "open")
        XCTAssertEqual(FakeGitHub.body(number), "살림")
    }

    func testClosedElsewhereDiscardsWhenDeclined() async throws {
        let number = FakeGitHub.addIssue(title: "a", body: "a")
        let session = try await open(number)
        FakeGitHub.editIssue(number, state: "closed")
        session.edit(body: "버림")
        Dialogs.autoAnswer = false
        let saved = await session.save()
        XCTAssertFalse(saved)
        XCTAssertEqual(session.body, "a")
        XCTAssertTrue(session.isArchived)
        XCTAssertFalse(session.dirty)
        XCTAssertEqual(FakeGitHub.state(number), "closed")
    }

    func testClosedBetweenReadAndWriteRestoresPreviousWhenDeclined() async throws {
        let number = FakeGitHub.addIssue(title: "a", body: "a")
        let session = try await open(number)
        FakeGitHub.closeBeforeNextPatch(number)
        session.edit(body: "되돌릴 내용")
        Dialogs.autoAnswer = false
        let saved = await session.save()
        XCTAssertFalse(saved)
        XCTAssertEqual(FakeGitHub.body(number), "a", "덮어쓴 내용을 이전 내용으로 돌려놓는다")
        XCTAssertEqual(session.body, "a")
        XCTAssertTrue(session.isArchived)
    }

    // MARK: - 원격 반영

    func testRefreshFromRemoteAppliesOtherDeviceEdit() async throws {
        let number = FakeGitHub.addIssue(title: "a", body: "a")
        let session = try await open(number)
        await session.refreshFromRemote()
        XCTAssertEqual(session.body, "a", "updated_at이 같으면 그대로")
        FakeGitHub.editIssue(number, title: "b", body: "b")
        await session.loadDetails()
        XCTAssertEqual(session.body, "b")
        XCTAssertFalse(session.refreshing)

        session.edit(body: "고치는 중")
        FakeGitHub.editIssue(number, body: "c")
        await session.refreshFromRemote()
        XCTAssertEqual(session.body, "고치는 중", "고치는 중이면 건드리지 않는다")
        _ = await session.flush()
    }

    func testDraftIsKeptAndRestored() async throws {
        let number = FakeGitHub.addIssue(title: "a", body: "a")
        let session = try await open(number)
        session.edit(body: "기기에 남길 초안")
        try await waitUntil("초안 저장", AppModel.shared.localState.draft(repo: FakeGitHub.repo, id: "issue.\(number)") != nil)

        AppModel.shared.updateSettings { $0.preferences.autoSaveSeconds = 30 }
        let reopened = try await open(number)
        XCTAssertEqual(reopened.body, "기기에 남길 초안")
        XCTAssertTrue(reopened.dirty)
        AppModel.shared.updateSettings { $0.preferences.autoSaveSeconds = 5 }
        let saved = await reopened.flush()
        XCTAssertTrue(saved)
        XCTAssertEqual(FakeGitHub.body(number), "기기에 남길 초안")
        _ = await session.flush()
    }

    func testNewNoteAllocationFailureRetriesAndSaveCreates() async throws {
        let session = keep(NoteSession(workspace: workspace, newNoteLabels: [], body: "먼저 쓴 글"))
        XCTAssertTrue(session.dirty)
        FakeGitHub.fail("/repos/\(FakeGitHub.repo)/issues", method: "POST", status: 503, times: 2)
        session.allocate(pendingFiles: [])
        _ = await session.resolvedNumber()
        XCTAssertTrue(session.allocationFailed)
        XCTAssertTrue(session.errorMessage?.hasPrefix("새 노트를 준비하지 못했습니다.") ?? false)

        session.retryAllocation()
        _ = await session.resolvedNumber()
        XCTAssertTrue(session.allocationFailed, "두 번째도 실패")

        // 저장하면서 만든다.
        let saved = await session.save()
        XCTAssertTrue(saved)
        XCTAssertEqual(session.number, 1)
        XCTAssertEqual(FakeGitHub.body(1), "먼저 쓴 글")
        session.retryAllocation()
        XCTAssertFalse(session.allocationFailed, "번호가 있으면 다시 받지 않는다")
    }

    func testLockUnlockAndRemoveLock() async throws {
        let number = FakeGitHub.addIssue(title: "비밀", body: "비밀 본문")
        let session = try await open(number)
        session.requestLock()
        XCTAssertEqual(session.lockPrompt, .lock, "기억한 숫자가 없으면 묻는다")
        await session.lock(pin: "12")
        XCTAssertEqual(session.lockPrompt, .lock, "6자리가 아니면 다시 묻는다")
        await session.lock(pin: pin)
        XCTAssertEqual(session.lockState, .unlocked)
        XCTAssertEqual(session.currentPin, pin)
        XCTAssertTrue(NoteLock.isLockedTitle(FakeGitHub.title(number) ?? ""))
        XCTAssertFalse(FakeGitHub.body(number)?.contains("비밀 본문") ?? true)

        // 풀린 채로 고치면 다시 암호화해 저장한다.
        session.edit(body: "비밀 본문 2")
        _ = await session.flush()
        XCTAssertFalse(FakeGitHub.body(number)?.contains("비밀 본문 2") ?? true)

        // 다른 창에서 새로 열면 잠겨 있고, 숫자로 연다.
        AppModel.shared.lockSession.clear()
        let other = try await open(number)
        XCTAssertEqual(other.lockState, .locked)
        XCTAssertNil(other.lockPrompt, "목록에서 잠긴 노트를 열어도 잠금 시트는 자동으로 뜨지 않는다")
        XCTAssertFalse(other.isEditable)
        XCTAssertEqual(other.displayTitle, "비밀 본문 2")
        XCTAssertThrowsError(try other.unlock(pin: "1"))
        XCTAssertThrowsError(try other.unlock(pin: "999999"))
        try other.unlock(pin: pin)
        XCTAssertEqual(other.body, "비밀 본문 2")
        XCTAssertNil(other.lockPrompt)
        try other.unlock(pin: pin)

        // 풀린 노트에서 잠금 버튼은 잠금 풀기(평문 저장).
        other.requestLock()
        try await waitUntil("평문 저장", FakeGitHub.body(number) == "비밀 본문 2")
        XCTAssertEqual(other.lockState, .plain)
        XCTAssertEqual(FakeGitHub.title(number), "비밀 본문 2")
        await other.removeLock()
        XCTAssertEqual(other.lockPrompt, .unlock(message: nil), "평문 노트에서 부르면 숫자 시트를 띄운다")
    }

    func testRememberedPinLocksImmediatelyAndReopens() async throws {
        let number = FakeGitHub.addIssue(title: "a", body: "기억한 숫자")
        AppModel.shared.lockSession.remember(pin)
        let session = try await open(number)
        session.requestLock()
        try await waitUntil("바로 잠금", session.lockState == .unlocked && NoteLock.isLockedTitle(FakeGitHub.title(number) ?? ""))

        let reopened = try await open(number)
        XCTAssertTrue(reopened.reusingPin)
        try await waitUntil("기억한 숫자로 열림", timeout: 4, reopened.lockState == .unlocked)
        XCTAssertEqual(reopened.body, "기억한 숫자")
        XCTAssertFalse(reopened.reusingPin)
        XCTAssertNil(reopened.lockPrompt)

        // 잠긴 노트(같은 세션)에서 잠금 버튼은 숫자를 묻는다.
        await reopened.expireLock()
        reopened.requestLock()
        XCTAssertEqual(reopened.lockPrompt, .unlock(message: nil))
    }

    func testLockedNoteSaveKeepsCiphertextAndEmptyLockedTitleIsNotSaved() async throws {
        let number = FakeGitHub.addIssue(title: "제목", body: "본문")
        let first = try await open(number)
        await first.lock(pin: pin)
        let cipher = try XCTUnwrap(FakeGitHub.body(number))
        AppModel.shared.lockSession.clear()
        let locked = try await open(number)
        locked.lockPrompt = nil
        let saved = await locked.save(force: true)
        XCTAssertTrue(saved, "잠긴 채로는 암호문을 그대로 다시 저장한다")
        XCTAssertEqual(FakeGitHub.body(number), cipher)

        let blank = FakeGitHub.addIssue(title: NoteLock.addLock(to: ""), body: cipher)
        let untitled = try await open(blank)
        untitled.lockPrompt = nil
        let skipped = await untitled.save(force: true)
        XCTAssertFalse(skipped, "제목이 비면 저장하지 않는다")
    }
}
