import Foundation
import XCTest
@testable import GinoteCore
import GinoteTestSupport

/// GitHubClient의 모든 요청을 가짜 GitHub로 검사한다. 네트워크를 쓰지 않는다.
final class GitHubClientTests: XCTestCase {
    var client: GitHubClient!

    override func setUp() {
        FakeGitHub.reset()
        client = GitHubClient(token: "t", repo: FakeGitHub.repo, session: FakeGitHub.session)
    }

    // MARK: - 연결과 오류

    func testVerifyReturnsUserAndRepository() async throws {
        let result = try await client.verify()
        XCTAssertEqual(result.user.login, "tester")
        XCTAssertEqual(result.repository.fullName, FakeGitHub.repo)
        XCTAssertEqual(result.repository.private, true)
    }

    func testErrorCarriesStatusMessageAndRateLimit() async {
        FakeGitHub.fail("/user", status: 401, message: "Bad credentials")
        do {
            _ = try await client.verify()
            XCTFail("오류여야 한다")
        } catch let error as GitHubError {
            XCTAssertEqual(error.status, 401)
            XCTAssertEqual(error.message, "Bad credentials")
            XCTAssertEqual(error.rateLimitRemaining, "0")
        } catch { XCTFail("\(error)") }
    }

    func testErrorWithoutMessageUsesHTTPStatusText() async {
        FakeGitHub.fail("/user", status: 503)
        do { _ = try await client.verify(); XCTFail() } catch let error as GitHubError {
            XCTAssertEqual(error.status, 503)
            XCTAssertFalse(error.message.isEmpty)
            XCTAssertTrue(error.isRetryable)
        } catch { XCTFail("\(error)") }
    }

    func testNetworkFailureBecomesStatusZero() async {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [FailingProtocol.self]
        let offline = GitHubClient(token: "t", repo: FakeGitHub.repo, session: URLSession(configuration: configuration))
        do { _ = try await offline.verify(); XCTFail() } catch let error as GitHubError {
            XCTAssertEqual(error.status, 0)
        } catch { XCTFail("\(error)") }
    }

    func testInvalidPathIsRejected() async {
        do { _ = try await client.send("bad path with spaces and \u{0}") ; XCTFail() } catch let error as GitHubError {
            XCTAssertEqual(error.status, 0)
        } catch { XCTFail("\(error)") }
    }

    func testSessionOverrideIsUsedWhenNoSessionGiven() async throws {
        GitHubClient.sessionOverride = FakeGitHub.session
        defer { GitHubClient.sessionOverride = nil }
        let viaOverride = GitHubClient(token: "t", repo: FakeGitHub.repo)
        let value1 = try await viaOverride.verify().user.login
        XCTAssertEqual(value1, "tester")
    }

    // MARK: - 이슈

    func testListIssuesPagesAndCounts() async throws {
        for index in 1...5 { FakeGitHub.addIssue(title: "노트 \(index)") }
        FakeGitHub.addIssue(title: "닫힘", state: "closed")
        let first = try await client.listIssuesPage(page: 1, pageSize: 2)
        XCTAssertEqual(first.items.map(\.title), ["노트 5", "노트 4"], "최근 수정 순")
        XCTAssertTrue(first.hasMore)
        XCTAssertEqual(first.totalCount, 5)
        let last = try await client.listIssuesPage(page: 3, pageSize: 2)
        XCTAssertEqual(last.items.map(\.title), ["노트 1"])
        XCTAssertFalse(last.hasMore)
        XCTAssertNil(last.totalCount, "첫 쪽에서만 센다")
    }

    func testListIssuesByLabelAndClosedUsesSearch() async throws {
        FakeGitHub.addIssue(title: "버그", labels: ["bug"])
        FakeGitHub.addIssue(title: "그냥")
        FakeGitHub.addIssue(title: "닫힌 버그", labels: ["bug"], state: "closed")
        let bugs = try await client.listIssuesPage(label: "bug")
        XCTAssertEqual(bugs.items.map(\.title), ["버그"])
        XCTAssertEqual(bugs.totalCount, 1)
        let closed = try await client.listIssuesPage(state: "closed")
        XCTAssertEqual(closed.items.map(\.title), ["닫힌 버그"])
        XCTAssertFalse(closed.hasMore)
        XCTAssertTrue(FakeGitHub.requests.contains { $0.hasPrefix("GET /search/issues") })
    }

    func testSearchMatchesTermAndLabel() async throws {
        FakeGitHub.addIssue(title: "회의록", body: "예산 논의", labels: ["work"])
        FakeGitHub.addIssue(title: "장보기", body: "예산 확인")
        let all = try await client.searchIssuesPage(state: "open", term: "예산")
        XCTAssertEqual(Set(all.items.map(\.title)), ["회의록", "장보기"])
        let work = try await client.searchIssuesPage(state: "open", term: "예산", label: "work")
        XCTAssertEqual(work.items.map(\.title), ["회의록"])
        XCTAssertEqual(work.totalCount, 1)
    }

    func testClosedSearchSortsByClosedAtDescending() async throws {
        let older = FakeGitHub.addIssue(title: "먼저 닫음")
        let newer = FakeGitHub.addIssue(title: "나중에 닫음")
        _ = try await client.setState(older, state: "closed")
        _ = try await client.setState(newer, state: "closed")
        let page = try await client.searchIssuesPage(state: "closed", term: "")
        XCTAssertEqual(page.items.map(\.number), [newer, older])
    }

    func testExpiredClosedIssues() async throws {
        FakeGitHub.addIssue(title: "[expired] 오래됨", state: "closed")
        FakeGitHub.addIssue(title: "최근", state: "closed")
        let expired = try await client.listExpiredClosedIssues()
        XCTAssertEqual(expired.map(\.title), ["[expired] 오래됨"])
    }

    func testCreateGetUpdateAndState() async throws {
        let created = try await client.createIssue(NoteDraft(title: "제목", body: "본문", labels: ["새태그"]))
        XCTAssertEqual(created.labels.map(\.name), ["새태그"])
        let value2 = try await client.getIssue(created.number).body
        XCTAssertEqual(value2, "본문")
        let updated = try await client.updateIssue(created.number, NoteDraft(title: "바뀜", body: "새 본문", labels: [], state: "closed"))
        XCTAssertEqual(updated.title, "바뀜")
        XCTAssertTrue(updated.isClosed)
        XCTAssertNotNil(updated.closedAt)
        let reopened = try await client.setState(created.number, state: "open")
        XCTAssertFalse(reopened.isClosed)
        let kept = try await client.updateIssue(created.number, NoteDraft(title: "상태 그대로", body: "", labels: []))
        XCTAssertEqual(kept.state, "open")
    }

    func testAddAndRemoveLabelOnIssue() async throws {
        let number = FakeGitHub.addIssue(title: "x")
        try await client.addLabel(number, label: "a b")
        XCTAssertEqual(FakeGitHub.labelNames(number), ["a b"])
        try await client.removeLabelFromIssue(number, label: "a b")
        XCTAssertEqual(FakeGitHub.labelNames(number), [])
    }

    func testNoteCounts() async throws {
        FakeGitHub.addIssue(title: "1", labels: ["bug"])
        FakeGitHub.addIssue(title: "2", labels: ["bug", "idea"])
        FakeGitHub.addIssue(title: "3", state: "closed")
        let counts = try await client.noteCounts()
        XCTAssertEqual(counts.notes, 2)
        XCTAssertEqual(counts.trash, 1)
        XCTAssertEqual(counts.labels, ["bug": 2, "idea": 1])
    }

    func testNoteCountsRejectsInvalidRepository() async {
        let broken = GitHubClient(token: "t", repo: "not-a-repo", session: FakeGitHub.session)
        do { _ = try await broken.noteCounts(); XCTFail() } catch let error as GitHubError {
            XCTAssertEqual(error.status, 0)
        } catch { XCTFail("\(error)") }
    }

    func testPullRequestsAreDropped() {
        var pr = Issue(id: 1, number: 1, title: "PR", body: nil, createdAt: "", updatedAt: "")
        pr.pullRequest = Issue.PullRequestRef(url: "x")
        let plain = Issue(id: 2, number: 2, title: "노트", body: nil, createdAt: "", updatedAt: "")
        XCTAssertEqual(GitHubClient.issuesOnly([pr, plain]).map(\.number), [2])
    }

    func testHelpers() {
        XCTAssertTrue(GitHubClient.hasNextPage("<a>; rel=\"prev\", <b>; rel=\"next\""))
        XCTAssertFalse(GitHubClient.hasNextPage(nil))
        XCTAssertEqual(GitHubClient.quoted("a\"b"), "\"a\\\"b\"")
        XCTAssertEqual(GitHubClient.closedCutoff(Date(timeIntervalSince1970: 1_790_000_000)), "2026-08-22")
        XCTAssertEqual(GitHubClient.query([("q", "a b"), ("x", "1")]), "q=a%20b&x=1")
    }

    // MARK: - 라벨

    func testLabelLifecycle() async throws {
        let created = try await client.createLabel("일정", description: "약속")
        XCTAssertEqual(created.name, "일정")
        XCTAssertEqual(FakeGitHub.labelDescription("일정"), "약속")
        let again = try await client.createLabel("일정")
        XCTAssertEqual(again.name, "일정", "이미 있으면 그 라벨을 쓴다(422)")
        let plain = try await client.createLabel("메모")
        XCTAssertEqual(plain.name, "메모")
        let renamed = try await client.renameLabel("일정", to: "약속", description: "바뀐 설명")
        XCTAssertEqual(renamed.name, "약속")
        XCTAssertEqual(FakeGitHub.labelDescription("약속"), "바뀐 설명")
        _ = try await client.renameLabel("약속", to: "약속2", description: nil)
        let value3 = try await client.listLabels().map(\.name)
        XCTAssertEqual(Set(value3), ["약속2", "메모"])
        try await client.deleteLabel("메모")
        XCTAssertEqual(FakeGitHub.labelList, ["약속2"])
    }

    func testCreateLabelOtherErrorsPropagate() async {
        FakeGitHub.fail("/labels", method: "POST", status: 500)
        do { _ = try await client.createLabel("x"); XCTFail() } catch let error as GitHubError {
            XCTAssertEqual(error.status, 500)
        } catch { XCTFail("\(error)") }
    }

    // MARK: - 댓글

    func testCommentLifecycleAndPaging() async throws {
        let number = FakeGitHub.addIssue(title: "x")
        for index in 1...101 { FakeGitHub.addComment(to: number, body: "기록 \(index)") }
        let all = try await client.listComments(number)
        XCTAssertEqual(all.count, 101, "100개씩 끊어 모두 읽는다")
        let created = try await client.createComment(number, body: "새 기록")
        XCTAssertEqual(created.author, "tester")
        let updated = try await client.updateComment(created.id, body: "고친 기록")
        XCTAssertEqual(updated.body, "고친 기록")
        try await client.deleteComment(created.id)
        XCTAssertFalse(FakeGitHub.commentBodies(number).contains("고친 기록"))
    }

    func testListCommentsStopsOnEmptyPage() async throws {
        let number = FakeGitHub.addIssue(title: "x")
        for index in 1...100 { FakeGitHub.addComment(to: number, body: "\(index)") }
        let value4 = try await client.listComments(number).count
        XCTAssertEqual(value4, 100)
    }

    // MARK: - 첨부

    func testUploadListDownloadDeleteAndPurge() async throws {
        let number = FakeGitHub.addIssue(title: "x")
        let uploaded = try await client.uploadAttachment(issueNumber: number, fileName: "a.txt", type: "text/plain", data: Data("A".utf8))
        let commentFile = try await client.uploadAttachment(issueNumber: number, commentId: 7, fileName: "b.png", type: "image/png", data: Data("B".utf8))
        XCTAssertEqual(uploaded.size, 1)
        XCTAssertTrue(uploaded.path.hasPrefix(AttachmentLinks.directory(issueNumber: number)))

        let top = try await client.listAttachmentFiles(issueNumber: number)
        XCTAssertEqual(top.map(\.name), [(uploaded.path as NSString).lastPathComponent], "본문 폴더만(댓글 폴더 제외)")
        let comment = try await client.listAttachmentFiles(issueNumber: number, commentId: 7)
        XCTAssertEqual(comment.map(\.path), [commentFile.path])
        let all = try await client.listAllAttachmentFiles(issueNumber: number)
        XCTAssertEqual(Set(all.map(\.path)), [uploaded.path, commentFile.path])

        let value5 = try await client.downloadAttachment(path: uploaded.path)
        XCTAssertEqual(value5, Data("A".utf8))
        FakeGitHub.answerRawAsJSON = true
        let value6 = try await client.downloadAttachment(path: uploaded.path)
        XCTAssertEqual(value6, Data("A".utf8), "Contents JSON(base64)으로 와도 푼다")
        FakeGitHub.answerRawAsJSON = false

        try await client.deleteAttachment(path: uploaded.path, sha: uploaded.sha, name: uploaded.name)
        XCTAssertNil(FakeGitHub.file(uploaded.path))
        let value7 = try await client.purgeAttachments(issueNumber: number)
        XCTAssertEqual(value7, 1)
        XCTAssertEqual(FakeGitHub.filePaths.filter { $0.contains("/issues/") }, [])
        let value8 = try await client.listAttachmentFiles(issueNumber: number)
        XCTAssertEqual(value8, [], "없는 폴더는 빈 목록")
    }

    func testCreatesAttachmentBranchWhenMissing() async throws {
        FakeGitHub.attachmentBranchExists = false
        try await client.ensureAttachmentBranch()
        XCTAssertTrue(FakeGitHub.attachmentBranchExists)
        XCTAssertTrue(FakeGitHub.requests.contains("POST /repos/\(FakeGitHub.repo)/git/refs"))
    }

    func testBranchCreatedByAnotherDeviceMeanwhileIsAccepted() async throws {
        FakeGitHub.attachmentBranchExists = false
        FakeGitHub.fail("/git/ref/heads/ginote-assets", status: 404)
        FakeGitHub.fail("/git/refs", method: "POST", status: 422)
        FakeGitHub.attachmentBranchExists = true
        try await client.ensureAttachmentBranch()
    }

    func testEmptyRepositoryIsInitializedBeforeCreatingTheBranch() async throws {
        FakeGitHub.emptyRepository = true
        try await client.ensureAttachmentBranch()
        XCTAssertTrue(FakeGitHub.attachmentBranchExists)
        XCTAssertNotNil(FakeGitHub.file(GitHubClient.storageMarker), "기본 브랜치를 marker 파일로 초기화한다")
    }

    func testEmptyRepositoryWhenRefCreationFails() async throws {
        FakeGitHub.attachmentBranchExists = false
        FakeGitHub.fail("/git/refs", method: "POST", status: 422)
        FakeGitHub.fail("/git/ref/heads/ginote-assets", status: 404, times: 2)
        FakeGitHub.fail("/git/ref/heads/main", status: 409)
        try await client.ensureAttachmentBranch()
        XCTAssertNotNil(FakeGitHub.file(GitHubClient.storageMarker))
        XCTAssertTrue(FakeGitHub.attachmentBranchExists)
    }

    func testRefFailureOnNonEmptyRepositoryPropagates() async {
        FakeGitHub.attachmentBranchExists = false
        FakeGitHub.fail("/git/refs", method: "POST", status: 422)
        FakeGitHub.fail("/git/ref/heads/ginote-assets", status: 404, times: 2)
        do { try await client.ensureAttachmentBranch(); XCTFail() } catch let error as GitHubError {
            XCTAssertEqual(error.status, 422)
        } catch { XCTFail("\(error)") }
    }

    func testTreeConflictOnNonEmptyRepositoryPropagates() async {
        FakeGitHub.attachmentBranchExists = false
        FakeGitHub.fail("/git/trees", status: 409)
        do { try await client.ensureAttachmentBranch(); XCTFail() } catch let error as GitHubError {
            XCTAssertEqual(error.status, 409)
        } catch { XCTFail("\(error)") }
    }

    func testRetryAfterInitializingConflictsButBranchAppeared() async throws {
        FakeGitHub.attachmentBranchExists = false
        FakeGitHub.fail("/git/refs", method: "POST", status: 422, times: 2)
        FakeGitHub.fail("/git/ref/heads/ginote-assets", status: 404, times: 2)
        FakeGitHub.fail("/git/ref/heads/main", status: 404)
        FakeGitHub.attachmentBranchExists = true
        try await client.ensureAttachmentBranch()
    }

    func testRetryAfterInitializingFailsWhenBranchStillMissing() async {
        FakeGitHub.attachmentBranchExists = false
        FakeGitHub.fail("/git/refs", method: "POST", status: 422, times: 2)
        FakeGitHub.fail("/git/ref/heads/ginote-assets", status: 404, times: 3)
        FakeGitHub.fail("/git/ref/heads/main", status: 404)
        do { try await client.ensureAttachmentBranch(); XCTFail() } catch let error as GitHubError {
            XCTAssertEqual(error.status, 422)
        } catch { XCTFail("\(error)") }
    }

    func testListDirectoryIgnoresUndecodableAnswers() async throws {
        let number = FakeGitHub.addIssue(title: "x")
        FakeGitHub.putFile(AttachmentLinks.directory(issueNumber: number), data: Data("not a list".utf8))
        let value9 = try await client.listDirectory(AttachmentLinks.directory(issueNumber: number))
        XCTAssertEqual(value9, [])
    }

    // MARK: - 전사 단어

    func testVoiceHintsLoadAndSave() async throws {
        let value10 = try await client.loadVoiceHints()
        XCTAssertEqual(value10, "", "파일이 없으면 빈 값")
        let value11 = try await client.saveVoiceHints("  지노트\n깃허브  ")
        XCTAssertEqual(value11, "지노트\n깃허브")
        let value12 = try await client.loadVoiceHints()
        XCTAssertEqual(value12, "지노트\n깃허브")
        _ = try await client.saveVoiceHints("바뀐 단어")
        let value13 = try await client.loadVoiceHints()
        XCTAssertEqual(value13, "바뀐 단어", "있는 파일은 sha를 넘겨 덮어쓴다")
        FakeGitHub.putFile(GitHubClient.voiceHintsPath, data: Data("{broken".utf8))
        let value14 = try await client.loadVoiceHints()
        XCTAssertEqual(value14, "", "깨진 파일은 빈 값")
    }

    func testVoiceHintsOtherErrorsPropagate() async {
        FakeGitHub.fail("voice-hints.json", status: 500)
        do { _ = try await client.loadVoiceHints(); XCTFail() } catch let error as GitHubError {
            XCTAssertEqual(error.status, 500)
        } catch { XCTFail("\(error)") }
    }
}

/// 연결 자체가 실패하는 세션(오프라인).
final class FailingProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() { client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet)) }
    override func stopLoading() {}
}
