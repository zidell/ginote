import AppKit
import GinoteCore
import Observation
import UniformTypeIdentifiers

/// 노트에 덧붙인 기록(이슈 댓글) 하나.
@MainActor
@Observable
final class CommentItem: Identifiable {
    let localId: String
    var id: String { localId }
    var remoteId: Int?
    /// 편집 화면용 글: 관리 블록·`<audio>` 표기를 빼고 첨부 주소를 `{repo}/`로 줄인 것.
    var text: String
    /// 숨겨 두었다가 저장할 때 다시 붙이는 원본 음성 표기.
    var audioMarkup: [String]
    var preservedManagedLinks: [String]
    var author: String
    var createdAt: String
    var updatedAt: String
    var dirty = false
    var saving = false
    var saveFailed = false
    var deleting = false
    /// 유예가 끝나 GitHub에서 지우는 중. 이때는 취소할 수 없다.
    var deleteInFlight = false
    /// 지금 GitHub에서 지우는 중인 첨부 경로(취소 불가).
    var deletingAttachmentPath: String?
    var attachments: [Attachment] = []
    var uploading: [String] = []
    var pendingAttachmentDeletes: [String: Date] = [:]
    /// 잠금 노트의 댓글을 아직 풀지 못했으면 원래 암호문.
    var lockedPayload: String?

    init(localId: String = "draft-\(UUID().uuidString.lowercased())", remoteId: Int?, rawBody: String, repo: String,
         author: String, createdAt: String, updatedAt: String) {
        self.localId = localId
        self.remoteId = remoteId
        self.author = author
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.text = ""
        self.audioMarkup = []
        self.preservedManagedLinks = []
        setBody(rawBody, repo: repo)
    }

    func setBody(_ rawBody: String, repo: String) {
        if NoteLock.isLockedPayload(rawBody) {
            lockedPayload = rawBody
            text = ""
            audioMarkup = []
            preservedManagedLinks = []
            return
        }
        lockedPayload = nil
        let split = VoiceNotes.splitAudio(rawBody)
        audioMarkup = split.audio
        preservedManagedLinks = AttachmentLinks.managedLinks(split.text)
        text = AttachmentLinks.compress(AttachmentLinks.stripManagedBlocks(split.text), repo: repo)
    }
}

/// 노트 댓글 목록과 저장·삭제·첨부. 웹 `NoteEditor.svelte`의 댓글 부분과 같은 규칙.
@MainActor
@Observable
final class CommentStore {
    static let deleteDelay: TimeInterval = 3

    unowned let session: NoteSession
    private(set) var items: [CommentItem] = []
    private(set) var loading = false
    private(set) var loaded = false
    var errorMessage: String?
    private var deleteTimers: [String: Task<Void, Never>] = [:]
    private var attachmentTimers: [String: Task<Void, Never>] = [:]
    var focusedCommentId: String?

    init(session: NoteSession) {
        self.session = session
    }

    var repo: String { session.repo }
    var client: GitHubClient { session.workspace.client }
    var attachmentCount: Int { items.reduce(0) { $0 + $1.attachments.count + $1.uploading.count } }

    /// 댓글이 직접 링크한 첨부 경로(본문 관리 블록에서 빼야 한다).
    var linkedPaths: Set<String> {
        Set(items.flatMap { item in
            AttachmentLinks.parsePaths(AttachmentLinks.expand(item.text, repo: repo))
                + item.preservedManagedLinks.flatMap(AttachmentLinks.parsePaths)
                + item.audioMarkup.flatMap(VoiceNotes.audioSources).compactMap(Self.path(fromRawURL:))
        })
    }

    nonisolated static func path(fromRawURL url: String) -> String? {
        let marker = "/raw/\(AttachmentLinks.branch)/"
        guard let range = url.range(of: marker) else { return nil }
        return url[range.upperBound...].split(separator: "/", omittingEmptySubsequences: false)
            .map { String($0).removingPercentEncoding ?? String($0) }.joined(separator: "/")
    }

    // MARK: - 불러오기

    func load() async {
        guard let number = session.number, !loading else { return }
        loading = true
        defer { loading = false }
        do {
            #if DEBUG
            // 화면 점검용: 기록 읽기를 일부러 늦춘다(자리표시 확인).
            if let delay = ProcessInfo.processInfo.environment["GINOTE_DEBUG_COMMENT_DELAY"].flatMap(Double.init) {
                try? await Task.sleep(for: .seconds(delay))
            }
            #endif
            let comments = try await client.listComments(number)
            var next: [CommentItem] = []
            for comment in comments {
                let item = CommentItem(localId: "comment-\(comment.id)", remoteId: comment.id, rawBody: comment.body ?? "", repo: repo,
                                       author: comment.author, createdAt: comment.createdAt, updatedAt: comment.updatedAt)
                next.append(item)
            }
            items = next
            if let pin = session.currentPin { decrypt(pin: pin) }
            restorePendingDrafts()
            loaded = true
            for item in items where item.remoteId != nil { await loadAttachments(item) }
        } catch {
            errorMessage = session.workspace.friendly(error)
        }
    }

    /// 잠금 노트를 열면 댓글도 같은 숫자로 푼다.
    func decrypt(pin: String) {
        guard let number = session.number else { return }
        for item in items {
            guard let payload = item.lockedPayload,
                  let plain = try? session.app.noteLock.decrypt(payload, pin: pin, issueNumber: number) else { continue }
            item.setBody(plain, repo: repo)
        }
    }

    func relock() {
        for item in items where item.remoteId != nil { item.text = "" }
        Task { await load() }
    }

    private func loadAttachments(_ item: CommentItem) async {
        guard let number = session.number, let id = item.remoteId else { return }
        if let files = try? await client.listAttachmentFiles(issueNumber: number, commentId: id) {
            item.attachments = files.map(Attachment.init(file:))
        }
    }

    // MARK: - 편집·저장

    func add() {
        DebugTrace.log("comment add editable=\(session.isEditable) number=\(session.number.map(String.init) ?? "nil")")
        guard session.isEditable, session.number != nil else { return }
        let now = ISO8601DateFormatter().string(from: Date())
        let item = CommentItem(remoteId: nil, rawBody: "", repo: repo,
                               author: session.workspace.user?.login ?? "", createdAt: now, updatedAt: now)
        items.append(item)
        focusedCommentId = item.localId
    }

    func edit(_ item: CommentItem, text: String) {
        guard session.isEditable, item.text != text else { return }
        // 기록도 GitHub 상한의 90%까지만 받는다.
        item.text = NoteText.length(text) > NoteText.maxBodyLength ? NoteLock.prefixUTF16(text, NoteText.maxBodyLength) : text
        item.dirty = true
        item.saveFailed = false
        persistDrafts()
    }

    func remoteBody(_ item: CommentItem) -> String {
        let clean = AttachmentLinks.stripManagedBlocks(item.text.trimmingCharacters(in: .whitespacesAndNewlines))
        let manual = Set(AttachmentLinks.parsePaths(AttachmentLinks.expand(clean, repo: repo)))
        var seen = Set<String>()
        let generated = item.attachments
            .map { AttachmentLinks.composeLink(repo: repo, path: $0.path, name: $0.name, type: $0.type) }
        let links = (item.preservedManagedLinks + generated).filter { link in
            guard let path = AttachmentLinks.parsePaths(link).first else { return false }
            // 삭제 중인 파일 링크는 빼야 댓글에 깨진 링크가 남지 않는다.
            guard !manual.contains(path), item.pendingAttachmentDeletes[path] == nil, seen.insert(path).inserted else { return false }
            return true
        }
        var body = AttachmentLinks.expand(AttachmentLinks.withManagedBlock(clean, links: links), repo: repo)
        if !item.audioMarkup.isEmpty {
            body += (body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "" : "\n\n") + item.audioMarkup.joined(separator: "\n\n")
        }
        return body
    }

    @discardableResult
    func save(_ item: CommentItem, force: Bool = false) async -> Bool {
        guard session.isEditable, !item.saving, let number = session.number else { return false }
        let trimmed = item.text.trimmingCharacters(in: .whitespacesAndNewlines)
        if item.remoteId == nil && trimmed.isEmpty && item.audioMarkup.isEmpty {
            DebugTrace.log("comment empty removed")
            items.removeAll { $0 === item }
            persistDrafts()
            return true
        }
        guard force || item.dirty else { return true }
        let savingText = item.text
        item.saving = true
        defer { item.saving = false }
        do {
            let plainBody = remoteBody(item)
            var body = plainBody
            if let pin = session.currentPin {
                body = try session.app.noteLock.encrypt(body, pin: pin, issueNumber: number)
            }
            let saved = item.remoteId == nil
                ? try await client.createComment(number, body: body)
                : try await client.updateComment(item.remoteId!, body: body)
            item.remoteId = saved.id
            item.updatedAt = saved.updatedAt
            if item.author.isEmpty { item.author = saved.author }
            item.preservedManagedLinks = AttachmentLinks.managedLinks(plainBody)
            item.saveFailed = false
            if item.text == savingText { item.dirty = false } else { Task { await save(item) } }
            persistDrafts()
            return true
        } catch {
            item.saveFailed = true
            errorMessage = session.workspace.friendly(error)
            return false
        }
    }

    func flush() async -> Bool {
        var ok = true
        for item in items where item.dirty || (item.remoteId == nil && !item.saving) {
            if item.remoteId == nil, item.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, item.audioMarkup.isEmpty { continue }
            ok = await save(item) && ok
        }
        return ok
    }

    // MARK: - 삭제 (3초 대기)

    func scheduleDelete(_ item: CommentItem, undoManager: UndoManager?) {
        guard session.isEditable, !item.deleting else { return }
        guard item.remoteId != nil else {
            items.removeAll { $0 === item }
            persistDrafts()
            return
        }
        item.deleting = true
        deleteTimers[item.localId] = Task { [weak self] in
            try? await Task.sleep(for: .seconds(Self.deleteDelay))
            guard !Task.isCancelled else { return }
            await self?.commitDelete(item)
        }
        undoManager?.registerUndo(withTarget: self) { store in
            Task { @MainActor in store.cancelDelete(item) }
        }
        undoManager?.setActionName(String(localized: "댓글 삭제"))
    }

    func cancelDelete(_ item: CommentItem) {
        guard item.deleting, let timer = deleteTimers[item.localId] else { return }
        timer.cancel()
        deleteTimers[item.localId] = nil
        item.deleting = false
    }

    /// 댓글을 지운 뒤 그 댓글만 쓰던 첨부도 지운다.
    private func commitDelete(_ item: CommentItem) async {
        deleteTimers[item.localId] = nil
        guard let id = item.remoteId, let number = session.number else { return }
        item.deleteInFlight = true
        defer { item.deleteInFlight = false }
        do {
            try await client.deleteComment(id)
        } catch let error as GitHubError where error.status == 404 {
        } catch {
            item.deleting = false
            errorMessage = session.workspace.friendly(error)
            return
        }
        items.removeAll { $0 === item }
        persistDrafts()
        let folder = (try? await client.listAttachmentFiles(issueNumber: number, commentId: id)) ?? []
        let stillLinked = linkedPaths.union(AttachmentLinks.parsePaths(AttachmentLinks.expand(session.body, repo: repo)))
        let ownPaths = Set(AttachmentLinks.parsePaths(AttachmentLinks.expand(item.text, repo: repo)) + item.preservedManagedLinks.flatMap(AttachmentLinks.parsePaths)
            + item.audioMarkup.flatMap(VoiceNotes.audioSources).compactMap(Self.path(fromRawURL:)))
        // 본문이나 다른 기록이 아직 링크하는 파일은 남긴다(웹과 같음).
        var targets = folder.filter { !stillLinked.contains($0.path) }.map { ($0.path, $0.sha, $0.name) }
        if !ownPaths.isEmpty, let all = try? await client.listAllAttachmentFiles(issueNumber: number) {
            targets += all.filter { ownPaths.contains($0.path) && !stillLinked.contains($0.path) && !folder.contains($0) }.map { ($0.path, $0.sha, $0.name) }
        }
        for target in targets {
            try? await client.deleteAttachment(path: target.0, sha: target.1, name: target.2)
        }
    }

    // MARK: - 댓글 첨부

    func addAttachments(_ urls: [URL], to item: CommentItem) async {
        guard session.isEditable, let number = session.number else { return }
        guard let commentId = item.remoteId else {
            errorMessage = String(localized: "댓글을 먼저 저장한 뒤 파일을 첨부하세요.")
            return
        }
        let remaining = max(0, AttachmentLinks.maxPerNote - session.totalAttachmentCount)
        guard remaining > 0 else {
            errorMessage = String(localized: "노트당 첨부파일은 최대 \(AttachmentLinks.maxPerNote)개까지 추가할 수 있습니다.")
            return
        }
        var uploadedAny = false
        for url in urls.prefix(remaining) {
            guard let data = try? Data(contentsOf: url) else { continue }
            guard data.count <= AttachmentLinks.maxFileBytes else {
                errorMessage = String(localized: "“\(url.lastPathComponent)” 파일은 10MB보다 커서 업로드하지 않았습니다.")
                continue
            }
            let name = url.lastPathComponent
            item.uploading.append(name)
            defer { item.uploading.removeAll { $0 == name } }
            do {
                let type = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? AttachmentLinks.inferredType(name: name)
                let uploaded = try await client.uploadAttachment(issueNumber: number, commentId: commentId, fileName: name, type: type, data: data)
                item.attachments.append(Attachment(uploaded: uploaded))
                await ThumbnailCache.shared.store(data, sha: uploaded.sha, name: name)
                uploadedAny = true
            } catch {
                errorMessage = session.workspace.friendly(error)
            }
        }
        if uploadedAny { item.dirty = true; await save(item, force: true) }
    }

    func scheduleAttachmentDelete(_ attachment: Attachment, in item: CommentItem, undoManager: UndoManager? = nil) {
        guard session.isEditable, item.pendingAttachmentDeletes[attachment.path] == nil else { return }
        undoManager?.registerUndo(withTarget: self) { store in
            Task { @MainActor in store.cancelAttachmentDelete(attachment, in: item) }
        }
        undoManager?.setActionName(String(localized: "첨부 삭제"))
        item.pendingAttachmentDeletes[attachment.path] = Date().addingTimeInterval(AttachmentStore.deleteDelay)
        let key = "\(item.localId):\(attachment.path)"
        attachmentTimers[key] = Task { [weak self] in
            try? await Task.sleep(for: .seconds(AttachmentStore.deleteDelay))
            guard !Task.isCancelled, let self else { return }
            self.attachmentTimers[key] = nil
            let link = AttachmentLinks.compress(AttachmentLinks.composeLink(repo: self.repo, path: attachment.path, name: attachment.name, type: attachment.type), repo: self.repo)
            if item.text.contains(link) { item.text = AttachmentLinks.removeLink(item.text, link: link) }
            item.dirty = true
            item.deletingAttachmentPath = attachment.path
            defer { item.deletingAttachmentPath = nil }
            guard await self.save(item, force: true) else { return }
            do {
                try await self.client.deleteAttachment(path: attachment.path, sha: attachment.sha, name: attachment.name)
            } catch let error as GitHubError where error.status == 404 {
            } catch {
                self.errorMessage = self.session.workspace.friendly(error)
                return
            }
            item.pendingAttachmentDeletes[attachment.path] = nil
            item.attachments.removeAll { $0.path == attachment.path }
        }
    }

    func cancelAttachmentDelete(_ attachment: Attachment, in item: CommentItem) {
        guard item.deletingAttachmentPath != attachment.path else { return }
        let key = "\(item.localId):\(attachment.path)"
        attachmentTimers[key]?.cancel()
        attachmentTimers[key] = nil
        item.pendingAttachmentDeletes[attachment.path] = nil
    }

    // MARK: - 음성

    /// 음성 전사문을 댓글 끝에 붙이고 원본 음성 표기를 더한다.
    func appendVoice(_ text: String, audio: String?, to item: CommentItem) async {
        let value = item.text.trimmingCharacters(in: .whitespacesAndNewlines)
        let addition = text.trimmingCharacters(in: .whitespacesAndNewlines)
        item.text = value.isEmpty ? addition : addition.isEmpty ? value : "\(value)\n\n\(addition)"
        if let audio { item.audioMarkup.append(audio) }
        item.dirty = true
        await save(item, force: true)
    }

    /// 음성으로 새 댓글을 만든다. 원본 음성은 이슈 폴더에 올라가 있고 표기만 붙인다(웹과 같음).
    func createVoiceComment(text: String, audioLink: String?) async {
        guard session.number != nil else { return }
        let now = ISO8601DateFormatter().string(from: Date())
        let item = CommentItem(remoteId: nil, rawBody: text, repo: repo, author: session.workspace.user?.login ?? "", createdAt: now, updatedAt: now)
        if let audioLink { item.audioMarkup = [audioLink] }
        item.dirty = true
        items.append(item)
        await save(item, force: true)
    }

    /// 잠금을 풀 때: 풀어 둔 기록을 평문으로 다시 저장한다.
    func resaveAsPlain() async {
        for item in items where item.remoteId != nil && item.lockedPayload == nil {
            item.dirty = true
            await save(item, force: true)
        }
    }

    // MARK: - 복구

    private func persistDrafts() {
        guard let number = session.number, session.lockState == .plain else { return }
        let drafts = items.filter { $0.dirty }.map { item in
            // 새 기록은 음성 표기까지 함께 둔다. 이미 저장된 기록은 음성 표기가 GitHub에 있으므로 글만 둔다.
            let body = item.remoteId == nil && !item.audioMarkup.isEmpty
                ? ([item.text].filter { !$0.isEmpty } + item.audioMarkup).joined(separator: "\n\n")
                : item.text
            return LocalState.PendingComment(id: item.remoteId, localId: item.localId, body: body)
        }
        session.app.localState.updatePendingWork(repo: repo, issueNumber: number) { $0.commentDrafts = drafts }
    }

    private func restorePendingDrafts() {
        guard let number = session.number, session.lockState == .plain,
              let work = session.app.localState.pendingWork(repo: repo, issueNumber: number) else { return }
        for draft in work.commentDrafts {
            if let id = draft.id, let item = items.first(where: { $0.remoteId == id }) {
                guard item.text != draft.body else { continue }
                item.text = draft.body
                item.dirty = true
            } else if draft.id == nil {
                let now = ISO8601DateFormatter().string(from: Date())
                let item = CommentItem(localId: draft.localId, remoteId: nil, rawBody: draft.body, repo: repo,
                                       author: session.workspace.user?.login ?? "", createdAt: now, updatedAt: now)
                item.dirty = true
                items.append(item)
            }
        }
        if items.contains(where: \.dirty) { Task { _ = await flush() } }
    }
}
