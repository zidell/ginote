import AppKit
import GinoteCore
import Observation

/// 열린 노트 하나의 편집·저장·잠금 상태. 같은 노트를 여러 창에서 열어도 이 객체 하나를 같이 쓴다.
/// 저장 흐름은 웹 `NoteEditor.svelte`의 saveRemote와 같다(macos/DESIGN.md §6).
@MainActor
@Observable
final class NoteSession: Identifiable {
    static let newNoteSelectionId = -1
    static let placeholderTitle = "새 노트"
    static let attachmentOnlyTitle = "첨부 노트"
    /// 본문이 비어 제목을 정할 수 없을 때 쓰는 제목(웹 UNTITLED_TITLE). 본문이 들어오면 첫 줄로 바뀐다.
    static let untitledTitle = "Untitled"

    enum LockState: Equatable { case plain, locked, unlocked }

    let id = UUID()
    unowned let workspace: WorkspaceModel

    private(set) var issue: Issue?
    var number: Int? { issue?.number }
    private(set) var title = ""
    /// 편집 화면용 본문: 관리 블록을 빼고 첨부 주소를 `{repo}/`로 줄인 것.
    private(set) var body = ""
    private(set) var labels: [String] = []
    private(set) var lockState: LockState = .plain
    private var encryptedBody = ""
    private var preservedManagedLinks: [String] = []

    private(set) var dirty = false
    private(set) var saving = false
    private(set) var saveFailed = false
    var errorMessage: String?
    private(set) var allocationFailed = false
    /// 열 때 자동으로 기억한 잠금 숫자를 시도하는 중.
    private(set) var reusingPin = false
    /// 잠금 숫자 시트를 띄울 이유(잠그기·열기). nil이면 닫힌다.
    var lockPrompt: LockPrompt?

    enum LockPrompt: Equatable { case lock, unlock(message: String?) }

    /// GitHub에 마지막으로 저장된(또는 읽은) 제목·본문·태그. 저장할 게 있는지 이것과 비교한다.
    /// 태그만 다른 화면에서 바뀌면 태그만 고친다. 본문까지 지금 값으로 바꾸면 저장 안 된 본문이 "저장됨"이 된다.
    private var lastRemoteNote: CurrentNote?
    /// 이 노트에서 자동으로 시도했다가 틀린 잠금 숫자. 이 노트에만 다시 쓰지 않는다(기억한 숫자는 그대로 둔다).
    private var rejectedPin: String?
    private var savingSignature = ""
    private var revision = 0
    private var forceSaveQueued = false
    private var saveTimer: Task<Void, Never>?
    private var draftTimer: Task<Void, Never>?
    private var allocation: Task<Issue?, Never>?
    private var draftId: String
    private var pendingFiles: [URL] = []

    /// 본문 첨부와 댓글. init 끝에서 만든다.
    private(set) var attachments: AttachmentStore!
    private(set) var comments: CommentStore!

    var repo: String { workspace.repo }
    var app: AppModel { workspace.app }
    var isNew: Bool { issue == nil }
    var isArchived: Bool { issue?.isClosed ?? false }
    var isEditable: Bool { !isArchived && lockState != .locked }
    var isPinned: Bool { labels.contains { PinLabel.isPin($0) } }
    var visibleLabels: [String] { labels.filter { !PinLabel.isPin($0) } }

    // MARK: - 만들기

    init(workspace: WorkspaceModel, issue: Issue) {
        self.workspace = workspace
        self.draftId = "issue.\(issue.number)"
        applyRemote(issue)
        setUpStores()
        restoreLocalDraft()
        if lockState == .locked, let pin = app.lockSession.pin {
            reuseSessionPin(pin)
        } else if lockState == .locked {
            lockPrompt = .unlock(message: nil)
        }
    }

    init(workspace: WorkspaceModel, newNoteLabels: [String], body: String) {
        self.workspace = workspace
        self.draftId = "new.\(UUID().uuidString.lowercased())"
        self.labels = newNoteLabels
        // 웹처럼 제목을 "새 노트"로 채워 시작한다. 비어 있으면 제목을 따로 쓰는 모드에서 저장이 멈춘다.
        self.title = Self.placeholderTitle
        self.body = body
        self.dirty = !body.isEmpty
        setUpStores()
    }

    private func setUpStores() {
        attachments = AttachmentStore(session: self)
        comments = CommentStore(session: self)
        managedLinksProvider = { [weak self] in
            guard let self else { return nil }
            return self.attachments.managedLinks(commentLinkedPaths: self.comments.linkedPaths)
        }
        onUnlock = { [weak self] pin in
            self?.comments.decrypt(pin: pin)
            Task { await self?.attachments.load() }
        }
    }

    /// 노트를 열 때 첨부 폴더와 댓글을 읽는다.
    /// 노트를 열며 GitHub에서 다시 읽는 중. 목록 행에 스피너를 띄운다(웹 note-row-refresh-spinner).
    private(set) var refreshing = false

    func loadDetails() async {
        guard number != nil else { return }
        refreshing = true
        defer { refreshing = false }
        // 웹처럼 열 때마다 이슈를 다시 읽는다. 예전에 열어 둔 세션은 다른 기기의 수정을 모르기 때문이다.
        // 첨부·기록과 함께 읽어 기록이 늦게 뜨지 않게 한다.
        async let latest: Void = refreshFromRemote()
        async let files: Void = attachments.load()
        async let notes: Void = comments.load()
        _ = await (latest, files, notes)
    }

    /// 새 노트면 번호를 받을 때까지 기다린다.
    func resolvedNumber() async -> Int? {
        if let number { return number }
        guard let allocation else { return nil }
        return await allocation.value?.number
    }

    /// 본문과 댓글 첨부를 합친 개수(노트당 30개 제한).
    var totalAttachmentCount: Int { attachments.visibleCount + comments.attachmentCount }

    var preservedLinkPaths: [String] { preservedManagedLinks.flatMap(AttachmentLinks.parsePaths) }

    /// 본문(관리 블록 포함)에 걸린 첨부 링크 수. 첨부 폴더를 읽기 전 자리 잡기에 쓴다.
    var expectedAttachmentCount: Int {
        Set(preservedLinkPaths + AttachmentLinks.parsePaths(AttachmentLinks.expand(body, repo: repo))).count
    }

    /// 첨부를 올리거나 지운 뒤 관리 블록을 갱신해 바로 저장한다.
    /// 첨부만 바뀌면 제목·본문·태그가 같아 보통 저장은 건너뛰므로, 웹처럼 강제로 저장한다.
    func attachmentsChanged() {
        changed()
        saveNow()
    }

    /// 지금 저장 중인 것을 기다린 뒤 강제로 한 번 더 저장한다. 성공하면 true.
    func saveForced() async -> Bool {
        saveTimer?.cancel()
        while saving { try? await Task.sleep(for: .milliseconds(50)) }
        return await save(force: true)
    }

    func addAttachments(_ urls: [URL]) {
        guard !urls.isEmpty else { return }
        if number == nil, allocation != nil {
            pendingFiles += urls
            return
        }
        Task { await attachments.add(urls) }
    }

    func chooseAttachments() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        panel.message = String(localized: "노트에 첨부할 파일을 고르세요.")
        let handler: (NSApplication.ModalResponse) -> Void = { [weak self] response in
            guard response == .OK else { return }
            self?.addAttachments(panel.urls)
        }
        if let window = NSApp.keyWindow { panel.beginSheetModal(for: window, completionHandler: handler) } else { handler(panel.runModal()) }
    }

    func allocate(pendingFiles: [URL]) {
        self.pendingFiles = pendingFiles
        allocationFailed = false
        allocation = Task { [weak self] in
            guard let self else { return nil }
            do {
                let created = try await self.createRemoteIssue()
                if self.dirty { self.scheduleSave(delay: 0) }
                return created
            } catch {
                self.allocationFailed = true
                self.errorMessage = String(localized: "새 노트를 준비하지 못했습니다.") + " " + self.workspace.friendly(error)
                return nil
            }
        }
    }

    /// 번호를 받지 못한 새 노트에서 다시 받아 본다.
    func retryAllocation() {
        guard issue == nil, allocationFailed else { return }
        allocate(pendingFiles: pendingFiles)
    }

    /// 빈 이슈를 만들어 이 새 노트의 번호로 삼는다.
    private func createRemoteIssue() async throws -> Issue {
        try await workspace.ensureLabels(labels)
        let created = try await workspace.client.createIssue(NoteDraft(title: Self.placeholderTitle, body: "", labels: labels))
        DebugTrace.log("allocated #\(created.number)")
        issue = created
        lastRemoteNote = nil
        allocationFailed = false
        errorMessage = nil
        // 번호를 받으면 초안 키도 issue.N으로 옮긴다(충돌 뒤 복구는 이 키를 본다).
        let numberedDraftId = "issue.\(created.number)"
        app.localState.moveDraft(repo: repo, from: draftId, to: numberedDraftId)
        draftId = numberedDraftId
        workspace.promote(self, issue: created)
        let files = takePendingFiles()
        if !files.isEmpty { Task { await attachments.add(files) } }
        return created
    }

    func takePendingFiles() -> [URL] {
        defer { pendingFiles = [] }
        return pendingFiles
    }

    // MARK: - 원격 내용 반영

    private func applyRemote(_ remote: Issue) {
        issue = remote
        let locked = NoteLock.isLockedTitle(remote.title)
        title = NoteLock.removeLock(from: remote.title)
        let remoteBody = remote.body ?? ""
        encryptedBody = locked ? remoteBody : ""
        body = locked ? "" : AttachmentLinks.compress(AttachmentLinks.stripManagedBlocks(remoteBody), repo: repo)
        preservedManagedLinks = locked ? [] : AttachmentLinks.managedLinks(remoteBody)
        lockState = locked ? .locked : .plain
        labels = remote.labels.map(\.name)
        dirty = false
        revision += 1
        lastRemoteNote = currentNote()
    }

    /// 목록이 다시 읽힐 때 원격 내용이 바뀌었으면 반영한다. 고치는 중이면 건드리지 않는다.
    func refreshFromRemote() async {
        guard let number, !dirty, !saving else { return }
        let startRevision = revision
        guard let latest = try? await workspace.client.getIssue(number),
              !dirty, !saving, revision == startRevision, latest.updatedAt != issue?.updatedAt else { return }
        applyRemote(latest)
        workspace.apply(latest)
        await revealWithSessionPin()
    }

    /// 사용자가 새로고침을 고르면. 저장하지 않은 변경이 있으면 버릴지 묻는다.
    func reloadFromGitHub() async {
        guard let number else { return }
        if dirty {
            let discard = await Dialogs.confirm(String(localized: "아직 저장하지 않은 변경 내용을 버리고 GitHub의 최신 내용으로 다시 불러올까요?"), confirmTitle: String(localized: "다시 불러오기"))
            guard discard else { return }
        }
        // 대기 중인 첨부 삭제는 먼저 끝낸다(웹과 같음).
        await attachments.commitPendingNow()
        do {
            let latest = try await workspace.client.getIssue(number)
            saveTimer?.cancel()
            applyRemote(latest)
            removeLocalDraft()
            workspace.apply(latest)
            await revealWithSessionPin()
        } catch {
            errorMessage = workspace.friendly(error)
        }
    }

    // MARK: - 편집

    func edit(title newTitle: String) {
        guard isEditable, newTitle != title else { return }
        title = NoteLock.prefixUTF16(newTitle, 256)
        changed()
    }

    /// `composing`이면 한글 조합 중이다. 내용만 기억하고 저장 예약은 조합이 끝난 뒤에 한다.
    func edit(body newBody: String, composing: Bool = false) {
        guard isEditable, newBody != body else { return }
        // GitHub 본문 상한(65,536)의 90%. 편집기도 넘는 입력을 막지만, 붙여넣기 등 다른 경로도 여기서 자른다.
        let newBody = NoteText.length(newBody) > NoteText.maxBodyLength ? NoteLock.prefixUTF16(newBody, NoteText.maxBodyLength) : newBody
        body = newBody
        if composing {
            dirty = true
            revision += 1
            return
        }
        changed()
    }

    func setLabels(_ names: [String], saveNow: Bool) {
        guard isEditable else { return }
        let pins = labels.filter { PinLabel.isPin($0) }
        labels = names.filter { !PinLabel.isPin($0) } + pins
        changed()
        if saveNow { scheduleSave(delay: 0) }
    }

    /// 음성 전사문을 본문 끝에 붙이고(문단 사이 빈 줄), 고른 태그를 더한다. 제안 제목은 쓰지 않는다.
    func appendVoice(_ text: String, tags: [String]) {
        guard isEditable else { return }
        let addition = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if !addition.isEmpty {
            let value = body.replacingOccurrences(of: #"\s+$"#, with: "", options: .regularExpression)
            body = value.isEmpty ? addition : "\(value)\n\n\(addition)"
        }
        var names = visibleLabels
        for tag in tags where !names.contains(where: { LabelNames.same($0, tag) }) { names.append(tag) }
        labels = names + labels.filter { PinLabel.isPin($0) }
        changed()
    }

    func setPinnedLabel(_ pinned: Bool) {
        labels = labels.filter { !PinLabel.isPin($0) } + (pinned ? [PinLabel.name] : [])
        lastRemoteNote?.labels = labels
    }

    /// 다른 화면(일괄 태그 등)에서 바뀐 원격 태그를 받아들인다.
    func adoptRemoteLabels(_ names: [String]) {
        labels = names
        lastRemoteNote?.labels = labels
    }

    func renameLabel(_ currentName: String, to nextName: String?) {
        labels = LabelNames.replace(labels, currentName, nextName)
    }

    private func changed() {
        dirty = true
        revision += 1
        scheduleDraft()
        scheduleSave()
    }

    /// 목록에 보일 제목(저장 전 포함).
    var displayTitle: String {
        let resolved = resolvedTitle(trimmedBody: body.trimmingCharacters(in: .whitespacesAndNewlines))
        return resolved.isEmpty ? Self.placeholderTitle : resolved
    }

    private func resolvedTitle(trimmedBody: String) -> String {
        if lockState == .locked { return title.trimmingCharacters(in: .whitespacesAndNewlines) }
        if app.settings.preferences.titleMode == .firstLine {
            let automatic = NoteText.automaticTitle(trimmedBody)
            if automatic.isEmpty, !preservedManagedLinks.isEmpty || hasAttachments { return Self.attachmentOnlyTitle }
            // 본문이 비어도 태그부터 저장할 수 있게 Untitled를 제목으로 쓴다(웹과 같음, GitHub는 빈 제목만 거부한다).
            return automatic.isEmpty ? Self.untitledTitle : automatic
        }
        // 별도 제목 모드: 직접 쓴 제목이 없거나 Untitled면 본문 첫 줄, 그것도 없으면 Untitled(웹 separateModeTitle).
        let typed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        if !typed.isEmpty, typed != Self.untitledTitle { return typed }
        let automatic = NoteText.automaticTitle(trimmedBody)
        return automatic.isEmpty ? Self.untitledTitle : automatic
    }

    /// 편집기·미리보기가 함께 쓰는 스크롤 위치(0~1). 화면 갱신을 일으키지 않게 관찰하지 않는다.
    @ObservationIgnored var scrollRatio: Double = 0

    /// 첨부가 하나라도 있으면 첫 줄 제목이 비어도 "첨부 노트"로 저장한다.
    var hasAttachments = false

    struct CurrentNote: Equatable {
        var title: String
        var body: String
        var labels: [String]
    }

    private func currentNote() -> CurrentNote {
        let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)
        return CurrentNote(title: resolvedTitle(trimmedBody: trimmed), body: trimmed, labels: labels)
    }

    private func signature(_ note: CurrentNote) -> String {
        "\(note.title)\u{0}\(note.body)\u{0}\(note.labels.joined(separator: "\u{1}"))"
    }

    // MARK: - 초안

    private func scheduleDraft() {
        guard draftTimer == nil else { return }
        draftTimer = Task { [weak self] in
            try? await Task.sleep(for: .seconds(1))
            guard let self, !Task.isCancelled else { return }
            self.draftTimer = nil
            self.persistLocalDraft()
        }
    }

    private func persistLocalDraft() {
        // 잠금 노트의 평문은 기기에 남기지 않는다.
        guard dirty, lockState == .plain else { return }
        app.localState.setDraft(repo: repo, id: draftId,
                                LocalState.Draft(title: title, body: body, labels: labels))
    }

    private func removeLocalDraft() {
        app.localState.setDraft(repo: repo, id: draftId, nil)
    }

    private func restoreLocalDraft() {
        guard lockState == .plain, !isArchived, let draft = app.localState.draft(repo: repo, id: draftId) else { return }
        guard draft.title != title || draft.body != body || draft.labels != labels else {
            removeLocalDraft()
            return
        }
        title = draft.title
        body = draft.body
        labels = draft.labels
        dirty = true
        revision += 1
        scheduleSave()
    }

    // MARK: - 저장

    func scheduleSave(delay: Double? = nil) {
        saveTimer?.cancel()
        let seconds = delay ?? Double(app.settings.preferences.autoSaveSeconds)
        saveTimer = Task { [weak self] in
            if seconds > 0 { try? await Task.sleep(for: .seconds(seconds)) }
            guard !Task.isCancelled else { return }
            await self?.save()
        }
    }

    /// 남은 저장을 지금 끝낸다. 저장할 것이 없거나 성공하면 true.
    @discardableResult
    func flush() async -> Bool {
        saveTimer?.cancel()
        draftTimer?.cancel()
        draftTimer = nil
        if dirty { persistLocalDraft() }
        while saving { try? await Task.sleep(for: .milliseconds(50)) }
        let commentsSaved = await comments.flush()
        guard dirty else { return !saveFailed && commentsSaved }
        return await save(force: false) && commentsSaved
    }

    /// ⌘S: 본문과 고치는 중인 기록(댓글)을 지금 저장한다.
    func saveNow() {
        saveTimer?.cancel()
        Task {
            await save(force: true)
            _ = await comments.flush()
        }
    }

    @discardableResult
    func save(force: Bool = false) async -> Bool {
        guard !isArchived else { return false }
        if saving {
            if force, signature(currentNote()) != savingSignature { forceSaveQueued = true }
            return false
        }
        if !force && !dirty { return true }
        persistLocalDraft()
        let note = currentNote()
        guard !note.title.isEmpty else { return false }
        let noteSignature = signature(note)
        if !force, let lastRemoteNote, noteSignature == signature(lastRemoteNote) {
            dirty = false
            removeLocalDraft()
            return true
        }

        let savingRevision = revision
        savingSignature = noteSignature
        saving = true
        saveFailed = false
        errorMessage = nil
        defer {
            saving = false
            savingSignature = ""
            if forceSaveQueued {
                forceSaveQueued = false
                Task { await save(force: true) }
            }
        }

        do {
            var target = issue
            if target == nil, let allocation { target = await allocation.value }
            // 번호를 받지 못했으면 저장하면서 만든다. 네트워크가 돌아오면 저절로 이어진다(웹 saveRemote).
            if target == nil, issue == nil, allocationFailed { target = try await createRemoteIssue() }
            if target == nil { target = issue }
            var reopen = false
            var previous: Issue?
            if let current = target {
                // 저장 전에 최신 상태를 읽는다. 다른 기기에서 휴지통으로 갔으면 복원할지 묻는다.
                let latest = try await workspace.client.getIssue(current.number)
                previous = latest
                target = latest
                if latest.isClosed {
                    let shouldReopen = await Dialogs.confirm(
                        String(localized: "다른 기기에서 “\(latest.title)” 노트를 휴지통으로 옮겼습니다. 복원한 뒤 수정 내용을 저장할까요?"),
                        confirmTitle: String(localized: "복원하고 저장"))
                    guard shouldReopen else {
                        discardLocalChanges(latest)
                        return false
                    }
                    reopen = true
                }
            }
            guard let target else { throw GitHubError(status: 0, message: String(localized: "새 노트를 준비하지 못했습니다.")) }

            try await workspace.ensureLabels(labels)
            let remoteNote = try noteForRemote(note, issueNumber: target.number)
            var draft = remoteNote
            if reopen { draft.state = "open" }
            var saved = try await workspace.client.updateIssue(target.number, draft)

            // GET과 PATCH 사이에 다른 기기가 닫았으면 다시 묻는다.
            if !reopen, saved.isClosed {
                let shouldReopen = await Dialogs.confirm(
                    String(localized: "다른 기기에서 “\(saved.title)” 노트를 휴지통으로 옮겼습니다. 복원한 뒤 수정 내용을 저장할까요?"),
                    confirmTitle: String(localized: "복원하고 저장"))
                if shouldReopen {
                    var reopened = remoteNote
                    reopened.state = "open"
                    saved = try await workspace.client.updateIssue(saved.number, reopened)
                } else {
                    var discarded = saved
                    if let previous, saved.title == remoteNote.title, saved.body ?? "" == remoteNote.body {
                        discarded = try await workspace.client.updateIssue(saved.number, NoteDraft(
                            title: previous.title, body: previous.body ?? "", labels: previous.labels.map(\.name)))
                    }
                    discarded.state = "closed"
                    discardLocalChanges(discarded)
                    return false
                }
            }

            issue = saved
            if lockState != .plain { encryptedBody = saved.body ?? encryptedBody }
            lastRemoteNote = note
            workspace.apply(saved)
            let hasNewerChanges = savingRevision != revision || signature(currentNote()) != noteSignature
            if hasNewerChanges {
                scheduleSave()
            } else {
                dirty = false
                removeLocalDraft()
            }
            saveFailed = false
            return true
        } catch {
            saveFailed = true
            errorMessage = workspace.friendly(error)
            scheduleSave(delay: 15)
            return false
        }
    }

    private func noteForRemote(_ note: CurrentNote, issueNumber: Int) throws -> NoteDraft {
        let clean = AttachmentLinks.stripManagedBlocks(note.body)
        let manual = Set(AttachmentLinks.parsePaths(AttachmentLinks.expand(clean, repo: repo)))
        let links = managedLinks().filter { link in
            guard let path = AttachmentLinks.parsePaths(link).first else { return false }
            return !manual.contains(path)
        }
        let remoteBody = AttachmentLinks.expand(AttachmentLinks.withManagedBlock(clean, links: links), repo: repo)
        switch lockState {
        case .plain:
            return NoteDraft(title: note.title, body: remoteBody, labels: note.labels)
        case .locked:
            return NoteDraft(title: NoteLock.addLock(to: note.title), body: encryptedBody, labels: note.labels)
        case .unlocked:
            guard let pin = activePin else { throw GitHubError(status: 0, message: String(localized: "잠금 세션이 만료되었습니다.")) }
            encryptedBody = try app.noteLock.encrypt(remoteBody, pin: pin, issueNumber: issueNumber)
            return NoteDraft(title: NoteLock.addLock(to: note.title), body: encryptedBody, labels: note.labels)
        }
    }

    /// 본문 맨 위 관리 블록에 넣을 첨부 링크. 첨부 목록을 쓰는 기능이 붙으면 그 목록에서 만든다.
    var managedLinksProvider: (() -> [String]?)?

    private func managedLinks() -> [String] {
        (managedLinksProvider?() ?? nil) ?? preservedManagedLinks
    }

    private func discardLocalChanges(_ remote: Issue) {
        saveTimer?.cancel()
        forceSaveQueued = false
        applyRemote(remote)
        removeLocalDraft()
        saveFailed = false
        errorMessage = nil
        workspace.apply(remote)
    }

    // MARK: - 잠금

    private var activePin: String?

    /// 잠그기: 기억한 숫자가 있으면 바로 잠그고, 없으면 숫자를 묻는다.
    func requestLock() {
        switch lockState {
        case .plain:
            if let pin = app.lockSession.pin { Task { await lock(pin: pin) } } else { lockPrompt = .lock }
        case .locked:
            lockPrompt = .unlock(message: nil)
        case .unlocked:
            Task { await removeLock() }
        }
    }

    func lock(pin: String) async {
        guard let pin = NoteLock.normalizePin(pin) else { lockPrompt = .lock; return }
        var target = issue
        if target == nil, let allocation { target = await allocation.value }
        guard let target else { errorMessage = String(localized: "새 노트를 준비하지 못했습니다."); return }
        activePin = pin
        app.lockSession.remember(pin)
        do {
            encryptedBody = try app.noteLock.encrypt(body, pin: pin, issueNumber: target.number)
        } catch {
            errorMessage = error.localizedDescription
            return
        }
        lockState = .unlocked
        lockPrompt = nil
        removeLocalDraft()
        changed()
        saveTimer?.cancel()
        await save(force: true)
    }

    /// 잠금 숫자를 넣어 연다. 틀리면 오류를 던진다.
    func unlock(pin: String) throws {
        guard lockState == .locked, let number else { return }
        guard let normalized = NoteLock.normalizePin(pin) else { throw NoteLockError.invalidPin }
        let decrypted = try app.noteLock.decrypt(encryptedBody, pin: normalized, issueNumber: number)
        preservedManagedLinks = AttachmentLinks.managedLinks(decrypted)
        body = AttachmentLinks.compress(AttachmentLinks.stripManagedBlocks(decrypted), repo: repo)
        activePin = normalized
        lockState = .unlocked
        lockPrompt = nil
        app.lockSession.remember(normalized)
        rejectedPin = nil
        lastRemoteNote = currentNote()
        revision += 1
        onUnlock?(normalized)
    }

    /// 댓글 등 잠금 해제 때 함께 풀어야 하는 것이 있으면 여기 연결한다.
    var onUnlock: ((String) -> Void)?
    var currentPin: String? { lockState == .unlocked ? activePin : nil }

    private func reuseSessionPin(_ pin: String) {
        reusingPin = true
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(1))
            await self?.revealWithSessionPin(pin)
        }
    }

    private func revealWithSessionPin(_ pin: String? = nil) async {
        defer { reusingPin = false }
        guard lockState == .locked, let pin = pin ?? app.lockSession.pin, pin != rejectedPin else {
            if lockState == .locked, lockPrompt == nil { lockPrompt = .unlock(message: nil) }
            return
        }
        do {
            try unlock(pin: pin)
        } catch {
            rejectedPin = pin
            lockPrompt = .unlock(message: String(localized: "6자리 숫자가 맞지 않거나 잠긴 이슈가 아닙니다."))
        }
    }

    /// 잠금 기억 시간이 지나면 저장할 것을 암호화해 저장한 뒤 다시 잠근다.
    func expireLock() async {
        guard lockState == .unlocked else { return }
        if dirty { saveTimer?.cancel(); await save(force: true) }
        activePin = nil
        body = ""
        lockState = .locked
        comments.relock()
        lockPrompt = .unlock(message: String(localized: "잠금 시간이 만료되었습니다. 6자리 숫자를 다시 입력해 주세요."))
    }

    /// 잠금 풀기: 평문으로 다시 저장한다.
    func removeLock() async {
        guard lockState == .unlocked else { lockPrompt = .unlock(message: nil); return }
        lockState = .plain
        encryptedBody = ""
        activePin = nil
        changed()
        saveTimer?.cancel()
        await save(force: true)
        // 잠금 중에 암호화해 저장한 기록도 평문으로 다시 저장한다. 그대로 두면 숫자를 알아도 다시 열 방법이 없다.
        await comments.resaveAsPlain()
    }
}

extension NoteLock {
    static func prefixUTF16(_ text: String, _ count: Int) -> String {
        String(decoding: Array(text.utf16.prefix(count)), as: UTF16.self)
    }
}
