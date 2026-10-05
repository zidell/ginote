import AppKit
import CryptoKit
import GinoteCore
import Observation
import UniformTypeIdentifiers

struct Attachment: Identifiable, Hashable {
    var path: String
    var sha: String
    var name: String
    var size: Int
    var type: String
    var id: String { path }
    var isImage: Bool { AttachmentLinks.isImage(name: name, type: type) }

    init(file: RepoFile) {
        path = file.path
        sha = file.sha
        size = file.size
        name = AttachmentLinks.displayName(fromPath: file.path)
        type = AttachmentLinks.inferredType(name: name)
    }

    /// 경로만 아는 첨부(본문 링크). 캐시 키는 경로에서 만든다.
    init(path: String) {
        self.path = path
        sha = "path-" + SHA256.hash(data: Data(path.utf8)).map { String(format: "%02x", $0) }.joined()
        size = 0
        name = AttachmentLinks.displayName(fromPath: path)
        type = AttachmentLinks.inferredType(name: name)
    }

    init(uploaded: GitHubClient.UploadedAttachment) {
        path = uploaded.path
        sha = uploaded.sha
        size = uploaded.size
        name = uploaded.name
        type = uploaded.type
    }
}

/// 노트 본문의 첨부. 웹 `NoteEditor.svelte`의 첨부 부분과 같은 규칙(docs/ATTACHMENTS.md).
/// 링크를 본문에 직접 넣지 않은 첨부는 저장할 때 본문 맨 위 관리 블록에 자동으로 넣는다.
@MainActor
@Observable
final class AttachmentStore {
    /// 삭제 유예와 실패 뒤 다시 시도할 때까지의 시간. 테스트가 줄여 쓴다.
    static var deleteDelay: TimeInterval = 5
    static var retryDelay: TimeInterval = 15

    unowned let session: NoteSession
    private(set) var items: [Attachment] = []
    private(set) var uploadingNames: [String] = []
    private(set) var loading = false
    private(set) var loaded = false
    /// 삭제 대기 중인 경로 → 실제로 지울 시각.
    private(set) var pendingDeletes: [String: Date] = [:]
    private(set) var deletingPath: String?
    var errorMessage: String?
    private var timers: [String: Task<Void, Never>] = [:]

    init(session: NoteSession) {
        self.session = session
    }

    var client: GitHubClient { session.workspace.client }
    var repo: String { session.repo }
    var visibleCount: Int { items.count + uploadingNames.count }

    // MARK: - 불러오기

    /// 노트를 열면 이슈 폴더를 확인한다. 본문에 링크가 있는 것을 먼저, 링크 없는(고아) 첨부를 뒤에 둔다.
    func load() async {
        guard let number = session.number, session.lockState != .locked, !loading else { return }
        loading = true
        defer { loading = false }
        do {
            let files = try await client.listAttachmentFiles(issueNumber: number)
            guard uploadingNames.isEmpty, deletingPath == nil else { return }
            var byPath: [String: RepoFile] = [:]
            for file in files where byPath[file.path] == nil { byPath[file.path] = file }
            var linked: [Attachment] = []
            var seen = Set<String>()
            for path in AttachmentLinks.parsePaths(AttachmentLinks.expand(session.body, repo: repo)) {
                guard let file = byPath[path], seen.insert(path).inserted else { continue }
                linked.append(Attachment(file: file))
            }
            let managedPaths = session.preservedLinkPaths
            for path in managedPaths {
                guard let file = byPath[path], seen.insert(path).inserted else { continue }
                linked.append(Attachment(file: file))
            }
            let orphans = files.filter { !seen.contains($0.path) }.map(Attachment.init(file:))
            items = linked + orphans
            loaded = true
            session.hasAttachments = !items.isEmpty
            restorePendingDeletes()
        } catch {
            errorMessage = session.workspace.friendly(error)
        }
    }

    /// 저장할 때 관리 블록에 넣을 링크: 본문·댓글에 직접 넣지 않았고 삭제 대기도 아닌 첨부.
    func managedLinks(commentLinkedPaths: Set<String>) -> [String]? {
        guard loaded else { return nil }
        let manual = Set(AttachmentLinks.parsePaths(AttachmentLinks.expand(session.body, repo: repo)))
        return items
            .filter { !manual.contains($0.path) && !commentLinkedPaths.contains($0.path) && pendingDeletes[$0.path] == nil }
            .map { AttachmentLinks.composeLink(repo: repo, path: $0.path, name: $0.name, type: $0.type) }
    }

    // MARK: - 추가

    /// 노트당 30개(본문+댓글), 파일당 10MB. 한 번에 한 묶음씩 차례로 올린다.
    func add(_ urls: [URL]) async {
        guard session.isEditable, !urls.isEmpty else { return }
        guard uploadingNames.isEmpty else {
            errorMessage = String(localized: "진행 중인 첨부 작업이 끝난 뒤 다시 시도하세요.")
            return
        }
        guard let number = await session.resolvedNumber() else {
            errorMessage = String(localized: "새 노트를 준비하지 못했습니다.")
            return
        }
        if !loaded { await load() }
        let remaining = max(0, AttachmentLinks.maxPerNote - session.totalAttachmentCount)
        let accepted = Array(urls.prefix(remaining))
        let limitReached = urls.count > remaining
        if accepted.isEmpty {
            errorMessage = String(localized: "노트당 첨부파일은 최대 \(AttachmentLinks.maxPerNote)개까지 추가할 수 있습니다.")
            return
        }
        var files: [(url: URL, data: Data)] = []
        for url in accepted {
            let didAccess = url.startAccessingSecurityScopedResource()
            defer { if didAccess { url.stopAccessingSecurityScopedResource() } }
            guard let data = try? Data(contentsOf: url) else {
                errorMessage = String(localized: "“\(url.lastPathComponent)” 파일을 읽지 못했습니다.")
                continue
            }
            guard data.count <= AttachmentLinks.maxFileBytes else {
                errorMessage = String(localized: "“\(url.lastPathComponent)” 파일은 10MB보다 커서 업로드하지 않았습니다.")
                continue
            }
            files.append((url, data))
        }
        guard !files.isEmpty else { return }
        uploadingNames = files.map(\.url.lastPathComponent)
        var uploadedAny = false
        for file in files {
            let name = file.url.lastPathComponent
            let type = UTType(filenameExtension: file.url.pathExtension)?.preferredMIMEType ?? AttachmentLinks.inferredType(name: name)
            do {
                let uploaded = try await client.uploadAttachment(issueNumber: number, fileName: name, type: type, data: file.data)
                items.append(Attachment(uploaded: uploaded))
                await ThumbnailCache.shared.store(file.data, sha: uploaded.sha, name: name)
                uploadedAny = true
            } catch {
                errorMessage = (error as? GitHubError)?.status == 403
                    ? String(localized: "첨부 권한이 없습니다. PAT에 Contents: Read and write 권한을 주세요.")
                    : session.workspace.friendly(error)
            }
            uploadingNames.removeFirst()
        }
        session.hasAttachments = !items.isEmpty
        if uploadedAny { _ = await session.saveForced() }
        if limitReached, errorMessage == nil {
            errorMessage = String(localized: "노트당 첨부파일은 최대 \(AttachmentLinks.maxPerNote)개라서 \(AttachmentLinks.maxPerNote)개만 추가했습니다.")
        }
    }

    // MARK: - 본문에 넣기·복사

    func markdownLink(_ item: Attachment) -> String {
        AttachmentLinks.composeLink(repo: repo, path: item.path, name: item.name, type: item.type)
    }

    func isLinkedInBody(_ item: Attachment) -> Bool {
        AttachmentLinks.parsePaths(AttachmentLinks.expand(session.body, repo: repo)).contains(item.path)
    }

    func copyMarkdown(_ item: Attachment) {
        SystemActions.copy(markdownLink(item))
    }

    /// 본문 맨 끝에 링크를 넣고 바로 저장한다.
    func insertIntoBody(_ item: Attachment) {
        guard session.isEditable, !isLinkedInBody(item) else { return }
        let link = AttachmentLinks.compress(markdownLink(item), repo: repo)
        session.edit(body: AttachmentLinks.insertLinks(session.body, links: [link]))
        session.saveNow()
    }

    // MARK: - 삭제 (5초 대기, 취소 가능)

    func scheduleDelete(_ item: Attachment, undoManager: UndoManager?) {
        guard session.isEditable, pendingDeletes[item.path] == nil, deletingPath != item.path else { return }
        let expiresAt = Date().addingTimeInterval(Self.deleteDelay)
        pendingDeletes[item.path] = expiresAt
        persist()
        startTimer(item, at: expiresAt)
        undoManager?.registerUndo(withTarget: self) { store in
            Task { @MainActor in store.cancelDelete(item) }
        }
        undoManager?.setActionName(String(localized: "첨부 삭제"))
    }

    /// 대기 중인 삭제를 지금 처리한다(새로고침 전).
    func commitPendingNow() async {
        for item in items where pendingDeletes[item.path] != nil {
            timers[item.path]?.cancel()
            await commitDelete(item)
        }
    }

    func cancelDelete(_ item: Attachment) {
        guard pendingDeletes[item.path] != nil, deletingPath != item.path else { return }
        timers[item.path]?.cancel()
        timers[item.path] = nil
        pendingDeletes[item.path] = nil
        persist()
    }

    private func startTimer(_ item: Attachment, at date: Date) {
        timers[item.path]?.cancel()
        timers[item.path] = Task { [weak self] in
            let delay = max(0, date.timeIntervalSinceNow)
            try? await Task.sleep(for: .seconds(delay))
            guard !Task.isCancelled else { return }
            await self?.commitDelete(item)
        }
    }

    /// 본문 링크를 지우고 저장한 뒤 파일을 지운다. 404는 이미 지워진 것으로 본다.
    func commitDelete(_ item: Attachment) async {
        guard pendingDeletes[item.path] != nil else { return }
        timers[item.path] = nil
        let link = AttachmentLinks.compress(markdownLink(item), repo: repo)
        if session.body.contains(link) {
            session.edit(body: AttachmentLinks.removeLink(session.body, link: link))
        }
        guard await session.saveForced() else {
            startTimer(item, at: Date().addingTimeInterval(Self.retryDelay))
            return
        }
        deletingPath = item.path
        defer { deletingPath = nil }
        do {
            try await client.deleteAttachment(path: item.path, sha: item.sha, name: item.name)
        } catch let error as GitHubError where error.status == 404 {
        } catch {
            errorMessage = session.workspace.friendly(error)
            startTimer(item, at: Date().addingTimeInterval(Self.retryDelay))
            return
        }
        pendingDeletes[item.path] = nil
        items.removeAll { $0.path == item.path }
        session.hasAttachments = !items.isEmpty
        persist()
    }

    func persist() {
        guard let number = session.number else { return }
        let deletes = items.compactMap { item -> LocalState.PendingAttachmentDelete? in
            guard let date = pendingDeletes[item.path] else { return nil }
            return .init(path: item.path, sha: item.sha, name: item.name, commentId: nil, expiresAt: date)
        }
        session.app.localState.updatePendingWork(repo: repo, issueNumber: number) { work in
            work.attachmentDeletes = work.attachmentDeletes.filter { $0.commentId != nil } + deletes
        }
    }

    /// 앱이 꺼진 동안 남은 삭제를 이어서 처리한다.
    private func restorePendingDeletes() {
        guard let number = session.number,
              let work = session.app.localState.pendingWork(repo: repo, issueNumber: number) else { return }
        for entry in work.attachmentDeletes where entry.commentId == nil {
            guard let item = items.first(where: { $0.path == entry.path }) else { continue }
            let date = Date(timeIntervalSince1970: entry.expiresAt / 1000)
            pendingDeletes[item.path] = date
            startTimer(item, at: date)
        }
    }

    // MARK: - 파일

    func localFile(_ item: Attachment) async throws -> URL {
        try await Self.localFile(item, client: client)
    }

    static func localFile(_ item: Attachment, client: GitHubClient) async throws -> URL {
        if let cached = await ThumbnailCache.shared.file(sha: item.sha, name: item.name) { return cached }
        let data = try await client.downloadAttachment(path: item.path)
        return await ThumbnailCache.shared.store(data, sha: item.sha, name: item.name)
    }

    func download(_ item: Attachment) async {
        do {
            let source = try await localFile(item)
            let downloads = SystemActions.downloadsDirectory
            var target = downloads.appendingPathComponent(item.name)
            var counter = 2
            while FileManager.default.fileExists(atPath: target.path) {
                let base = (item.name as NSString).deletingPathExtension
                let ext = (item.name as NSString).pathExtension
                target = downloads.appendingPathComponent(ext.isEmpty ? "\(base) \(counter)" : "\(base) \(counter).\(ext)")
                counter += 1
            }
            try FileManager.default.copyItem(at: source, to: target)
            SystemActions.reveal([target])
        } catch {
            errorMessage = session.workspace.friendly(error)
        }
    }
}

/// 첨부 파일 캐시. 경로에 UUID가 있고 blob sha가 내용이므로 sha를 키로 쓴다.
actor ThumbnailCache {
    static let shared = ThumbnailCache()
    /// 단위 테스트는 사용자 앱의 캐시와 섞이지 않게 임시 폴더를 쓴다.
    let directory: URL = (AppModel.isUnitTest
        ? FileManager.default.temporaryDirectory.appendingPathComponent("ginote-unittest-cache")
        : FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent(ConfigStore.bundleIdentifier))
        .appendingPathComponent("attachments")
    private var thumbnails: [String: NSImage] = [:]

    func file(sha: String, name: String) -> URL? {
        let url = directory.appendingPathComponent(sha).appendingPathComponent(name)
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    @discardableResult
    func store(_ data: Data, sha: String, name: String) -> URL {
        let folder = directory.appendingPathComponent(sha)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let url = folder.appendingPathComponent(name)
        try? data.write(to: url, options: .atomic)
        return url
    }

    func thumbnail(for url: URL, sha: String, size: CGFloat) -> NSImage? {
        if let cached = thumbnails[sha] { return cached }
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
              let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                  kCGImageSourceCreateThumbnailFromImageAlways: true,
                  kCGImageSourceCreateThumbnailWithTransform: true,
                  kCGImageSourceThumbnailMaxPixelSize: size * 2
              ] as CFDictionary) else { return nil }
        let thumbnail = NSImage(cgImage: image, size: .zero)
        thumbnails[sha] = thumbnail
        return thumbnail
    }
}
