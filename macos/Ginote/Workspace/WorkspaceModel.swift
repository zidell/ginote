import AppKit
import GinoteCore
import Observation

enum NoteScope: Hashable { case notes, trash }

/// 저장소 하나의 목록·태그·열린 노트 상태. 웹 `App.svelte`의 목록 부분을 옮겼다.
@MainActor
@Observable
final class WorkspaceModel {
    static let pinnedPageSize = 100
    static let retryDelays: [Double] = [2, 5, 15]
    static let refreshCooldown: TimeInterval = 30

    var workspace: Workspace
    let client: GitHubClient
    unowned let app: AppModel

    private(set) var user: GitHubUser?
    private(set) var labels: [GitHubLabel] = []
    private(set) var connected = false

    // 목록
    var scope: NoteScope = .notes {
        didSet {
            guard scope != oldValue else { return }
            stashList(ListKey(scope: oldValue, label: labelFilter))
            selection = []
            openedId = nil
            searchText = ""
            activeQuery = ""
            Task { await showList() }
        }
    }
    /// 태그 필터와 검색어는 함께 걸지 않는다(웹은 검색칸이 `#태그`로 바뀐다). 태그를 걸면 검색어를 지우고
    /// 열린 노트를 닫는다(웹 openLabel).
    var labelFilter: String? {
        didSet {
            guard labelFilter != oldValue else { return }
            stashList(ListKey(scope: scope, label: oldValue))
            if labelFilter != nil {
                searchText = ""
                activeQuery = ""
                selection = []
                openedId = nil
            }
            Task { await showList() }
        }
    }
    var searchText = ""
    private(set) var activeQuery = ""
    private(set) var issues: [Issue] = []
    private(set) var pinned: [Issue] = []
    private(set) var hasMore = false
    private(set) var totalCount: Int?
    private(set) var searchLimitReached = false
    private(set) var loading = false
    /// 목록을 새로 읽는 동안(연결, 노트/휴지통, 태그, 검색) 옛 목록 대신 자리표시 행을 보인다.
    /// 앱이 앞으로 올 때의 조용한 새로고침에는 쓰지 않는다.
    private(set) var showingSkeleton = false
    /// 목록을 한 번이라도 받았는지. 받기 전에는 "노트 없음" 대신 자리표시 행을 보인다.
    private(set) var hasLoaded = false
    private(set) var loadingMore = false
    var errorMessage: String?
    private var page = 1
    private var requestVersion = 0
    private var retryAttempt = 0
    private var lastRefresh = Date.distantPast
    /// 고정 처리 중. 그동안 고정 버튼·메뉴를 끈다(웹과 같음).
    private(set) var pinMutation = false

    // 선택과 열린 노트
    /// 목록의 커서(키보드 이동·여러 개 선택). 커서를 옮기는 것만으로는 노트를 열지 않는다(웹과 같은 정책).
    var selection: Set<Int> = [] { didSet { DebugTrace.log("selection \(selection.sorted())") } }
    /// 오른쪽에 열린 노트. 클릭하거나 ⏎를 누를 때만 바뀐다.
    /// 여러 개를 고르는 중 마지막으로 누른 노트. 오른쪽에 읽기 전용으로 보인다(웹과 같음).
    var selectionPreviewId: Int?
    var openedId: Int? { didSet { DebugTrace.log("opened \(openedId.map(String.init) ?? "nil")") } }

    /// 노트를 열고 커서도 그 노트에 둔다.
    func open(_ id: Int) {
        selection = [id]
        openedId = id
    }
    private(set) var sessions: [Int: NoteSession] = [:]
    private(set) var newNote: NoteSession?
    var merging = false
    /// 번호를 받지 못한 새 노트가 있거나 여러 개를 고른 중이면 새 노트·음성 새 노트를 끈다(웹과 같음).
    var newNoteBlocked: Bool { (newNote != nil && newNote?.number == nil) || selection.count > 1 }
    /// 사이드바 배지. 목록을 읽거나 노트·태그를 바꾼 뒤 다시 센다.
    private(set) var counts: GitHubClient.NoteCounts?
    private var countsTask: Task<Void, Never>?

    /// 잠시 모아서 한 번만 센다(연달아 바뀔 때 요청이 몰리지 않게). 방금 이 앱에서 개수를 바꿨으면(휴지통 이동·복원)
    /// GitHub 개수가 따라올 때까지(10초) 기다렸다 센다. 일찍 세면 옛 개수가 와서 맞춰 둔 개수를 되돌린다.
    func refreshCounts() {
        countsTask?.cancel()
        countsTask = Task { [weak self] in
            let settle = max(1.5, 10 - Date().timeIntervalSince(self?.localCountChange ?? .distantPast))
            try? await Task.sleep(for: .seconds(settle))
            guard let self, !Task.isCancelled else { return }
            if let counts = try? await self.client.noteCounts() {
                self.counts = counts
                self.app.workspaceNoteCounts[self.workspace.id] = counts.notes
            }
        }
    }
    @ObservationIgnored private(set) lazy var voiceHints = VoiceHints(workspace: self)
    @ObservationIgnored private var localCountChange = Date.distantPast

    /// 휴지통 이동(toTrash)·복원한 노트만큼 사이드바 개수를 바로 맞춘다.
    private func adjustCounts(for changed: [Issue], toTrash: Bool) {
        guard !changed.isEmpty else { return }
        localCountChange = Date()
        let delta = toTrash ? -changed.count : changed.count
        guard var next = counts else { return }
        next.notes = max(0, next.notes + delta)
        next.trash = max(0, next.trash - delta)
        for issue in changed {
            for label in issue.labels.map(\.name) where next.labels[label] != nil {
                next.labels[label] = max(0, (next.labels[label] ?? 0) + (toTrash ? -1 : 1))
            }
        }
        counts = next
        app.workspaceNoteCounts[workspace.id] = next.notes
    }

    init(workspace: Workspace, token: String, app: AppModel) {
        self.workspace = workspace
        self.client = GitHubClient(token: token, repo: workspace.repo)
        self.app = app
    }

    var repo: String { workspace.repo }
    var preferences: Preferences { app.settings.preferences }
    var visibleLabels: [GitHubLabel] { labels.filter { !PinLabel.isPin($0.name) } }

    /// 화면에 보이는 순서(고정 먼저).
    var displayedIssues: [Issue] {
        let pinnedIds = Set(pinned.map(\.id))
        return pinned + issues.filter { !pinnedIds.contains($0.id) }
    }

    var displayedPinned: [Issue] { pinned }
    var displayedRegular: [Issue] {
        let pinnedIds = Set(displayedPinned.map(\.id))
        return issues.filter { !pinnedIds.contains($0.id) }
    }

    func issue(id: Int) -> Issue? {
        issues.first { $0.id == id } ?? pinned.first { $0.id == id }
            ?? sessions.values.first { $0.issue?.id == id }?.issue
    }

    // MARK: - 연결

    func connect() async {
        do {
            let verified = try await client.verify()
            user = verified.user
            connected = true
            errorMessage = nil
        } catch {
            errorMessage = friendly(error)
            if let github = error as? GitHubError, github.status == 401 {
                app.tokenPromptWorkspace = workspace
            }
            return
        }
        Task { await voiceHints.flush() }
        async let labelsTask: Void = loadLabels()
        await reload()
        await labelsTask
        pruneExpiredAttachments()
    }

    func loadLabels() async {
        guard let loaded = try? await client.listLabels() else { return }
        labels = loaded.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }

    func suspend() {
        for session in sessions.values { Task { await session.flush() } }
        Task { await newNote?.flush() }
    }

    func flushAll() async {
        for session in sessions.values { await session.flush() }
        await newNote?.flush()
    }

    // MARK: - 목록 읽기

    func submitSearch() {
        let term = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        // 빈 검색 제출은 태그 필터도 푼다(웹 submitSearch).
        if term.isEmpty, labelFilter != nil {
            searchText = ""
            activeQuery = ""
            labelFilter = nil
            return
        }
        // `#태그`가 기존 태그와 정확히 같으면 태그로 거른다.
        if term.hasPrefix("#"), let label = visibleLabels.first(where: { "#\($0.name)".lowercased() == term.lowercased() }) {
            searchText = ""
            activeQuery = ""
            labelFilter = label.name
            return
        }
        activeQuery = term
        if !term.isEmpty, labelFilter != nil {
            labelFilter = nil // didSet이 다시 읽는다.
        } else {
            Task { await reload() }
        }
    }

    func clearSearch() {
        guard !activeQuery.isEmpty || !searchText.isEmpty else { return }
        searchText = ""
        activeQuery = ""
        Task { await reload() }
    }

    func reload() async { await load(background: false) }

    // MARK: - 보관함·태그별 목록 기억

    /// 노트·휴지통·태그 목록을 오갈 때 이미 읽은 목록을 바로 다시 보인다(저장소 목록 기억과 같은 시간 동안).
    /// 다시 보인 뒤에는 자리표시 없이 조용히 새로 읽어 그 사이 바뀐 것(휴지통 이동 등)을 맞춘다.
    private struct ListKey: Hashable { var scope: NoteScope; var label: String? }
    private struct ListSnapshot {
        var issues: [Issue], pinned: [Issue], hasMore: Bool, totalCount: Int?, page: Int, savedAt: Date
    }
    private var listCache: [ListKey: ListSnapshot] = [:]

    private func stashList(_ key: ListKey) {
        guard hasLoaded, !showingSkeleton, activeQuery.isEmpty, errorMessage == nil else { return }
        listCache[key] = ListSnapshot(issues: issues, pinned: pinned, hasMore: hasMore, totalCount: totalCount, page: page, savedAt: Date())
    }

    private func showList() async {
        let key = ListKey(scope: scope, label: labelFilter)
        let maxAge = TimeInterval(preferences.workspaceCacheMinutes * 60)
        guard activeQuery.isEmpty, let cached = listCache[key], Date().timeIntervalSince(cached.savedAt) < maxAge else {
            await reload()
            return
        }
        requestVersion += 1 // 앞서 보낸 요청의 결과가 이 목록을 덮지 않게 한다.
        issues = cached.issues
        pinned = cached.pinned
        hasMore = cached.hasMore
        totalCount = cached.totalCount
        page = cached.page
        searchLimitReached = false
        errorMessage = nil
        loading = false
        showingSkeleton = false
        pruneSelection()
        await load(background: true)
    }

    /// 앱 활성화·깨어남·온라인 복구 때. 30초 안에는 다시 하지 않는다.
    func refresh(background: Bool, ignoringCooldown: Bool = false) async {
        guard connected else { await connect(); return }
        if background {
            guard ignoringCooldown || Date().timeIntervalSince(lastRefresh) >= Self.refreshCooldown, !loading else { return }
            // 설정 창이 열려 있으면 건너뛴다(웹과 같음).
            if NSApp.windows.contains(where: { $0.isVisible && $0.identifier?.rawValue.contains("Settings") == true }) { return }
        }
        let succeeded = await load(background: background)
        if !succeeded { lastRefresh = .distantPast }
        // 열린 노트만 다시 읽는다. 예전에 열었던 노트까지 읽으면 요청이 계속 늘어난다.
        if let opened = openedId, let issue = issue(id: opened) { await sessions[issue.number]?.refreshFromRemote() }
    }

    @discardableResult
    private func load(background: Bool) async -> Bool {
        requestVersion += 1
        let version = requestVersion
        let state = scope == .trash ? "closed" : "open"
        let label = labelFilter ?? ""
        let term = activeQuery
        let pageSize = preferences.notesPerPage
        lastRefresh = Date()
        if !background {
            loading = true
            showingSkeleton = true
            errorMessage = nil
        }
        defer { if version == requestVersion, !background { loading = false; showingSkeleton = false } }
        do {
            async let pinnedPage = client.listIssuesPage(state: state, label: PinLabel.name, page: 1, pageSize: Self.pinnedPageSize)
            let result = term.isEmpty
                ? try await client.listIssuesPage(state: state, label: label, page: 1, pageSize: pageSize)
                : try await client.searchIssuesPage(state: state, term: term, label: label)
            let pinnedResult = try await pinnedPage
            guard version == requestVersion else { return false }
            let fetched = term.isEmpty ? applyHolds(result.items, state: state, label: label) : result.items
            DebugTrace.log("load state=\(state) label=\(label) term=\(term) pageSize=\(pageSize) fetched=\(result.items.count) withHolds=\(fetched.count) holds=\(holds.count) background=\(background)")
            if background && page > 1 && term.isEmpty {
                let fresh = Set(fetched.map(\.id))
                issues = fetched + issues.filter { !fresh.contains($0.id) }
            } else {
                issues = fetched
                page = 1
                hasMore = result.hasMore
            }
            var seen = Set<Int>()
            pinned = applyHolds(pinnedResult.items, state: state, label: PinLabel.name).filter { seen.insert($0.id).inserted }
            totalCount = result.totalCount.map { term.isEmpty ? $0 : min($0, result.items.count) }
            searchLimitReached = !term.isEmpty && (result.totalCount ?? 0) > result.items.count
            pruneSelection()
            retryAttempt = 0
            hasLoaded = true
            refreshCounts()
            if !background { errorMessage = nil }
            return true
        } catch {
            guard version == requestVersion else { return false }
            if !background {
                errorMessage = friendly(error)
                // 인증·권한·요청 한도 오류는 다시 보내도 같으므로 네트워크·서버 오류만 다시 시도한다.
                if let github = error as? GitHubError, github.isRetryable { scheduleRetry() }
            }
            return false
        }
    }

    // MARK: - 방금 바뀐 노트 붙들기

    /// GitHub 목록 API는 쓰기 직후 몇 초 동안 방금 만들거나 다시 연(또는 닫은) 이슈를 반영하지 않는다.
    /// 웹의 pendingRestoredIssues·pendingTrashedIssues처럼, 목록이 따라잡을 때까지(최대 2분) 붙들어 둔다.
    private struct Hold { var issue: Issue; var until: Date }
    private var holds: [Int: Hold] = [:]

    func hold(_ issue: Issue) {
        holds[issue.id] = Hold(issue: issue, until: Date().addingTimeInterval(120))
    }

    private func applyHolds(_ fetched: [Issue], state: String, label: String) -> [Issue] {
        holds = holds.filter { $0.value.until > Date() }
        guard !holds.isEmpty else { return fetched }
        let fetchedIds = Set(fetched.map(\.id))
        var result: [Issue] = []
        var extra: [Issue] = []
        for issue in fetched {
            if let held = holds[issue.id] {
                if held.issue.state == state {
                    // 목록이 따라잡았다.
                    if issue.updatedAt >= held.issue.updatedAt { holds[issue.id] = nil }
                    result.append(issue.updatedAt >= held.issue.updatedAt ? issue : held.issue)
                }
                // 상태가 다르면(방금 닫았는데 아직 열린 목록에 나오면) 뺀다.
                continue
            }
            result.append(issue)
        }
        for held in holds.values where held.issue.state == state && !fetchedIds.contains(held.issue.id) {
            if label.isEmpty || held.issue.labels.contains(where: { LabelNames.same($0.name, label) }) { extra.append(held.issue) }
        }
        // 상태가 다른 붙든 노트가 목록에서 사라졌으면 목록이 따라잡은 것이다.
        for (id, held) in holds where held.issue.state != state && !fetchedIds.contains(id) && label.isEmpty { holds[id] = nil }
        return extra.sorted { $0.updatedAt > $1.updatedAt } + result
    }

    /// 다른 화면(음성·병합)이 새로 만든 노트를 목록에 올리고 고른다.
    func insertCreated(_ issue: Issue) {
        hold(issue)
        if scope != .notes { scope = .notes }
        if !issues.contains(where: { $0.id == issue.id }) { issues.insert(issue, at: 0) }
        totalCount = totalCount.map { $0 + 1 }
        open(issue.id)
    }

    private func scheduleRetry() {
        guard retryAttempt < Self.retryDelays.count else { return }
        let delay = Self.retryDelays[retryAttempt]
        retryAttempt += 1
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(delay))
            await self?.load(background: !(self?.issues.isEmpty ?? true))
        }
    }

    func loadMore() async {
        guard !loading, !loadingMore, hasMore, activeQuery.isEmpty else { return }
        loadingMore = true
        defer { loadingMore = false }
        let version = requestVersion
        do {
            let result = try await client.listIssuesPage(
                state: scope == .trash ? "closed" : "open", label: labelFilter ?? "",
                page: page + 1, pageSize: preferences.notesPerPage)
            guard version == requestVersion else { return }
            let known = Set(issues.map(\.id))
            issues += result.items.filter { !known.contains($0.id) }
            page += 1
            hasMore = result.hasMore
        } catch {
            errorMessage = friendly(error)
        }
    }

    private func pruneSelection() {
        let ids = Set(displayedIssues.map(\.id))
        selection = selection.filter { ids.contains($0) || $0 < 0 }
        // 열어 둔 노트는 목록(검색 결과·첫 쪽)에서 빠져도 닫지 않는다(웹과 같음). 세션이 없을 때만 닫는다.
        if let opened = openedId, opened >= 0, !ids.contains(opened), issue(id: opened) == nil { openedId = nil }
    }

    // MARK: - 열린 노트

    func session(for issue: Issue) -> NoteSession {
        if let existing = sessions[issue.number] { return existing }
        let session = NoteSession(workspace: self, issue: issue)
        sessions[issue.number] = session
        return session
    }

    func session(number: Int) -> NoteSession? {
        if let existing = sessions[number] { return existing }
        guard let issue = displayedIssues.first(where: { $0.number == number }) else { return nil }
        return session(for: issue)
    }

    /// 새 노트: 화면에 바로 띄우고, 빈 이슈를 만들어 번호를 받는다. 지금 거는 태그 필터는 미리 붙인다.
    func createNote(body: String = "", files: [URL] = []) -> NoteSession? {
        DebugTrace.log("createNote existing=\(newNote != nil) number=\(newNote?.number.map(String.init) ?? "nil")")
        if let newNote, newNote.number == nil {
            // 번호를 못 받았어도 쓰던 내용을 버리지 않는다. 다시 받아 본다.
            if newNote.allocationFailed { newNote.retryAllocation() }
            open(NoteSession.newNoteSelectionId)
            return newNote
        }
        if scope == .trash { scope = .notes }
        // 새 노트는 검색 결과가 아니라 전체(또는 지금 태그) 목록 위에 뜬다(웹 newNote).
        if !activeQuery.isEmpty || !searchText.isEmpty {
            searchText = ""
            activeQuery = ""
            Task { await reload() }
        }
        let labels = labelFilter.map { [$0] } ?? []
        let session = NoteSession(workspace: self, newNoteLabels: labels, body: body)
        newNote = session
        open(NoteSession.newNoteSelectionId)
        session.allocate(pendingFiles: files)
        return session
    }

    /// 번호를 받은 새 노트를 목록에 올린다.
    func promote(_ session: NoteSession, issue: Issue) {
        DebugTrace.log("promote #\(issue.number) isNewNote=\(newNote === session)")
        sessions[issue.number] = session
        hold(issue)
        if !issues.contains(where: { $0.id == issue.id }) { issues.insert(issue, at: 0) }
        totalCount = totalCount.map { $0 + 1 }
        if newNote === session { newNote = nil }
        if openedId == NoteSession.newNoteSelectionId { open(issue.id) }
        refreshCounts()
    }

    func discardNewNote() {
        newNote = nil
        if openedId == NoteSession.newNoteSelectionId { openedId = nil; selection = [] }
    }

    /// 저장 결과를 목록에 반영한다.
    func apply(_ issue: Issue) {
        // 태그가 바뀌면 GitHub 목록 API가 한동안 옛 태그로 걸러 준다. 붙들어 둬서 태그로 걸러도 바로 보이게 한다.
        if let previous = issues.first(where: { $0.id == issue.id }) ?? pinned.first(where: { $0.id == issue.id }),
           Set(previous.labels.map(\.name)) != Set(issue.labels.map(\.name)) {
            hold(issue)
        }
        if let index = issues.firstIndex(where: { $0.id == issue.id }) { issues[index] = issue }
        if let index = pinned.firstIndex(where: { $0.id == issue.id }) { pinned[index] = issue }
        if issue.isPinned, !pinned.contains(where: { $0.id == issue.id }), issue.state == (scope == .trash ? "closed" : "open") {
            pinned.insert(issue, at: 0)
        } else if !issue.isPinned {
            pinned.removeAll { $0.id == issue.id }
        }
        if holds[issue.id] != nil { hold(issue) }
        // 다른 기기에서 닫힌 노트는 노트 목록에서 뺀다.
        if issue.isClosed && scope == .notes || !issue.isClosed && scope == .trash {
            hold(issue)
            issues.removeAll { $0.id == issue.id }
            pinned.removeAll { $0.id == issue.id }
        }
    }

    // MARK: - 휴지통

    /// 휴지통으로 옮기기 전 유예 시간(웹 DELETE_DELAY_MS).
    static let trashDelay: Double = 2

    /// 휴지통 이동 대기열 항목(웹 deletion-queue). 한 번에 지운 노트들이 한 항목이다.
    struct TrashEntry: Identifiable, Equatable {
        let id: Int
        let issueIds: Set<Int>
        /// GitHub에 보내는 중. 이때는 취소할 수 없다.
        var inFlight = false
    }

    private(set) var trashQueue: [TrashEntry] = []
    private var trashSequence = 0

    /// 이 노트가 대기열에 있으면 그 항목.
    func trashEntry(for issueId: Int) -> TrashEntry? {
        trashQueue.first { $0.issueIds.contains(issueId) }
    }

    /// 노트를 휴지통으로 보낸다. 2초 유예 동안 취소할 수 있고(⎋는 가장 최근 것부터, 또는 취소 버튼),
    /// 지나면 옮긴다. 이미 대기 중인 노트는 다시 넣지 않는다.
    func moveToTrash(_ targets: [Issue], undoManager: UndoManager?) async {
        let queued = Set(trashQueue.flatMap(\.issueIds))
        let fresh = targets.filter { !queued.contains($0.id) }
        guard !fresh.isEmpty else { return }
        trashSequence += 1
        let entryId = trashSequence
        trashQueue.append(TrashEntry(id: entryId, issueIds: Set(fresh.map(\.id))))
        try? await Task.sleep(for: .seconds(Self.trashDelay))
        guard let index = trashQueue.firstIndex(where: { $0.id == entryId }) else { return } // 취소됨
        trashQueue[index].inFlight = true
        defer { trashQueue.removeAll { $0.id == entryId } }
        await performTrash(fresh, undoManager: undoManager)
    }

    /// 대기 중인 항목 하나를 취소한다. 보내는 중이면 취소하지 않는다.
    @discardableResult
    func cancelTrash(entry id: Int) -> Bool {
        guard let index = trashQueue.firstIndex(where: { $0.id == id }), !trashQueue[index].inFlight else { return false }
        trashQueue.remove(at: index)
        return true
    }

    /// ⎋: 가장 최근에 넣은(보내는 중이 아닌) 항목을 취소한다. 취소한 것이 있으면 true.
    @discardableResult
    func cancelMostRecentTrash() -> Bool {
        guard let entry = trashQueue.last(where: { !$0.inFlight }) else { return false }
        return cancelTrash(entry: entry.id)
    }

    /// 저장소를 바꾸거나 앱을 닫을 때 대기 중인 이동을 모두 취소한다(웹 cancelAll).
    func cancelAllTrash() {
        trashQueue.removeAll { !$0.inFlight }
    }

    /// 편집 중이면 먼저 저장하고, 저장에 실패하면 옮기지 않는다.
    private func performTrash(_ targets: [Issue], undoManager: UndoManager?) async {
        var moved: [Issue] = []
        for issue in targets {
            if let session = sessions[issue.number] {
                await session.attachments.commitPendingNow()
                guard await session.flush() else {
                    errorMessage = String(localized: "GitHub에 저장하지 못해 휴지통으로 옮기지 않았습니다.")
                    continue
                }
            }
            do {
                let closed = try await client.setState(issue.number, state: "closed")
                moved.append(closed)
                hold(closed)
                issues.removeAll { $0.id == issue.id }
                pinned.removeAll { $0.id == issue.id }
                totalCount = totalCount.map { max(0, $0 - 1) }
                sessions[issue.number] = nil
            } catch {
                errorMessage = friendly(error)
            }
        }
        selection.subtract(moved.map(\.id))
        adjustCounts(for: moved, toTrash: true)
        refreshCounts()
        if let opened = openedId, moved.contains(where: { $0.id == opened }) { openedId = nil }
        guard !moved.isEmpty, let undoManager else { return }
        undoManager.registerUndo(withTarget: self) { model in
            Task { @MainActor in await model.restore(moved, undoManager: undoManager) }
        }
        undoManager.setActionName(moved.count == 1 ? String(localized: "휴지통으로 이동") : String(localized: "\(moved.count)개 노트를 휴지통으로 이동"))
    }

    func restore(_ targets: [Issue], undoManager: UndoManager?) async {
        var restored: [Issue] = []
        for issue in targets {
            do {
                let reopened = try await client.setState(issue.number, state: "open")
                restored.append(reopened)
                hold(reopened)
                issues.removeAll { $0.id == issue.id }
                if scope == .notes { issues.insert(reopened, at: 0) }
                // 목록 머리의 개수: 노트 목록이면 하나 늘고, 휴지통 목록이면 하나 준다.
                totalCount = totalCount.map { scope == .notes ? $0 + 1 : max(0, $0 - 1) }
                if reopened.isPinned, scope == .notes, !pinned.contains(where: { $0.id == reopened.id }) { pinned.insert(reopened, at: 0) }
                sessions[issue.number] = nil
            } catch {
                errorMessage = friendly(error)
            }
        }
        selection.subtract(restored.map(\.id))
        adjustCounts(for: restored, toTrash: false)
        refreshCounts()
        if let opened = openedId, restored.contains(where: { $0.id == opened }) { openedId = nil }
        guard !restored.isEmpty, let undoManager else { return }
        undoManager.registerUndo(withTarget: self) { model in
            Task { @MainActor in await model.moveToTrash(restored, undoManager: undoManager) }
        }
        undoManager.setActionName(String(localized: "복원"))
    }

    // MARK: - 고정

    /// 화면을 먼저 바꾸고, 실패하면 되돌린다. 한 번에 하나만 처리한다.
    func togglePin(_ target: Issue) async {
        guard !pinMutation else { return }
        pinMutation = true
        defer { pinMutation = false }
        // 부르는 쪽이 들고 있던 이슈는 고정 직후의 옛 값일 수 있다(노트 화면의 session.issue). 지금 목록의 값과
        // 열린 노트의 태그로 고정 여부를 정한다. 옛 값으로 정하면 고정한 노트를 다시 눌러도 풀리지 않는다.
        let issue = self.issue(id: target.id) ?? target
        let wasPinned = sessions[issue.number]?.isPinned ?? issue.isPinned
        var optimistic = issue
        optimistic.labels = issue.labels.filter { !PinLabel.isPin($0.name) } + (wasPinned ? [] : [GitHubLabel(name: PinLabel.name)])
        apply(optimistic)
        sessions[issue.number]?.setPinnedLabel(!wasPinned)
        do {
            if wasPinned {
                do { try await client.removeLabelFromIssue(issue.number, label: PinLabel.name) }
                catch let error as GitHubError where error.status == 404 {}
            } else {
                if !labels.contains(where: { PinLabel.isPin($0.name) }) {
                    labels.append(try await client.createLabel(PinLabel.name))
                }
                try await client.addLabel(issue.number, label: PinLabel.name)
            }
        } catch {
            apply(issue)
            sessions[issue.number]?.setPinnedLabel(wasPinned)
            errorMessage = friendly(error)
        }
    }

    // MARK: - 태그

    func ensureLabels(_ names: [String]) async throws {
        let known = Set(labels.map { $0.name.lowercased() })
        for name in names where !PinLabel.isPin(name) && !known.contains(name.lowercased()) {
            let created = try await client.createLabel(name)
            labels.append(created)
        }
        labels.sort { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }

    func createLabel(definition: String) async throws -> GitHubLabel {
        let parsed = TagDefinition.parse(definition)
        let limited = TagDefinition.limit(name: NoteText.normalizeTagName(parsed.name), description: parsed.description)
        guard !limited.name.isEmpty else { throw GitHubError(status: 0, message: String(localized: "태그 이름을 입력하세요.")) }
        let created = try await client.createLabel(limited.name, description: limited.description)
        if !labels.contains(where: { LabelNames.same($0.name, created.name) }) { labels.append(created) }
        labels.sort { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
        return created
    }

    func renameLabel(_ label: GitHubLabel, definition: String) async throws {
        let parsed = TagDefinition.parse(definition, currentName: label.name)
        let limited = TagDefinition.limit(name: parsed.name, description: parsed.description)
        guard !limited.name.isEmpty else { throw GitHubError(status: 0, message: String(localized: "태그 이름을 입력하세요.")) }
        guard limited.name != label.name || limited.description != (label.description ?? "") else { return }
        let renamed = try await client.renameLabel(label.name, to: limited.name, description: limited.description)
        replaceLabel(label.name, with: renamed)
    }

    func deleteLabel(_ label: GitHubLabel) async throws {
        try await client.deleteLabel(label.name)
        replaceLabel(label.name, with: nil)
    }

    /// 태그 이름 바꾸기·삭제를 불러온 노트·고정·열린 노트·초안·필터에 반영한다.
    private func replaceLabel(_ currentName: String, with next: GitHubLabel?) {
        labels.removeAll { LabelNames.same($0.name, currentName) }
        if let next { labels.append(next) }
        labels.sort { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
        let rewrite = { (issue: Issue) -> Issue in
            var copy = issue
            copy.labels = issue.labels.compactMap { label in
                guard LabelNames.same(label.name, currentName) else { return label }
                return next
            }
            return copy
        }
        issues = issues.map(rewrite)
        pinned = pinned.map(rewrite)
        for session in sessions.values { session.renameLabel(currentName, to: next?.name) }
        newNote?.renameLabel(currentName, to: next?.name)
        app.localState.renameDraftLabels(repo: repo, from: currentName, to: next?.name)
        if let filter = labelFilter, LabelNames.same(filter, currentName) { labelFilter = next?.name }
        refreshCounts()
    }

    // MARK: - 첨부 정리

    /// 보관 기간이 지난 휴지통 노트의 첨부 폴더를 하루 한 번 지운다. 열려 있는 노트는 건너뛴다.
    func pruneExpiredAttachments() {
        guard app.localState.shouldPruneAttachments(repo: repo) else { return }
        let client = client
        let openNumbers = Set(sessions.keys)
        Task.detached { [weak self] in
            do {
                for expired in try await client.listExpiredClosedIssues() where !openNumbers.contains(expired.number) {
                    _ = try await client.purgeAttachments(issueNumber: expired.number)
                }
                await self?.app.localState.markAttachmentsPruned(repo: client.repo)
            } catch {
                // 실패하면 다음 연결 때 다시 시도한다.
            }
        }
    }

    // MARK: - 오류 문구

    func friendly(_ error: Error) -> String {
        if let github = error as? GitHubError {
            switch github.status {
            case 401: return String(localized: "PAT가 올바르지 않거나 폐기되었습니다.")
            case 403:
                if github.rateLimitRemaining == "0" { return String(localized: "GitHub API 요청 한도에 도달했습니다. 잠시 후 다시 시도하세요.") }
                return String(localized: "권한이 없습니다. PAT의 Issues·Contents 권한을 확인하세요.")
            case 404: return String(localized: "저장소나 노트를 찾을 수 없습니다.")
            case 0: return String(localized: "GitHub에 연결하지 못했습니다. 네트워크를 확인하세요.")
            default: return github.message
            }
        }
        return error.localizedDescription
    }
}
