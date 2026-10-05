import GinoteCore
import SwiftUI

/// 가운데 칸: 노트 목록. 고정 노트는 위 섹션, 끝에 닿으면 더 읽는다.
struct NoteListView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.openWindow) private var openWindow
    @Environment(\.undoManager) private var undoManager
    @Bindable var workspace: WorkspaceModel
    var pane: FocusState<PaneFocus?>.Binding

    static let searchRowId = "list-search"
    /// 키 창의 첫 응답자가 글 입력칸(검색칸 등)인지.
    static var typingInField: Bool { NSApp.keyWindow?.firstResponder is NSText }
    static let pinnedHeaderId = "list-pinned-header"

    var body: some View {
        ScrollViewReader { proxy in
            list
                // 저장소를 다시 열면 마지막에 열어 둔 노트가 보이게 한다(웹은 스크롤 위치를 기억한다).
                // 열어 둔 노트가 없으면 검색칸을 위로 숨긴 채 시작한다.
                .onAppear {
                    DispatchQueue.main.async {
                        if let opened = workspace.openedId { proxy.scrollTo(opened, anchor: .center) } else { hideSearch(proxy) }
                    }
                }
                // 목록을 새로 받으면(저장소·노트/휴지통 전환 등) 검색칸을 다시 숨긴다.
                .onChange(of: workspace.showingSkeleton) { _, loading in
                    if !loading { DispatchQueue.main.async { hideSearch(proxy) } }
                }
                // 기억해 둔 목록을 바로 다시 보일 때(노트·휴지통·태그 전환)는 자리표시를 거치지 않으므로 따로 숨긴다.
                .onChange(of: workspace.scope) { _, _ in DispatchQueue.main.async { hideSearch(proxy) } }
                .onChange(of: workspace.labelFilter) { _, _ in DispatchQueue.main.async { hideSearch(proxy) } }
                // ↑(목록 맨 위)·⇧⌘F로 검색칸에 갈 때는 드러낸다.
                // 움직임 없이 바로 드러낸다(스크롤하는 동안 포커스가 옮겨 가면 첫 키를 놓친다).
                .onChange(of: app.searchFocusRequest) { _, _ in proxy.scrollTo(Self.searchRowId, anchor: .top) }
        }
    }

    /// 검색어·태그 필터가 없으면 첫 노트를 맨 위로 올려 검색칸을 가린다(위로 스크롤하면 드러난다).
    private func hideSearch(_ proxy: ScrollViewProxy) {
        guard workspace.searchText.isEmpty, workspace.activeQuery.isEmpty, workspace.labelFilter == nil else { return }
        let first: Int? = workspace.displayedPinned.first?.id
            ?? (workspace.newNote != nil ? NoteSession.newNoteSelectionId : workspace.displayedRegular.first?.id)
        guard let first else { return }
        // 고정 섹션이 있으면 그 머리줄("고정됨")을 맨 위에 둔다. 첫 줄을 올리면 머리줄이 그 제목을 덮는다.
        if !workspace.displayedPinned.isEmpty {
            proxy.scrollTo(Self.pinnedHeaderId, anchor: .top)
        } else {
            proxy.scrollTo(first, anchor: .top)
        }
    }

    private var list: some View {
        List(selection: $workspace.selection) {
            // 검색칸은 목록 첫 줄이다. 줄 여백을 없애 검색칸 좌우 끝을 노트 줄의 글 끝에 맞춘다(목록이 주는 기본 여백만 남김).
            ListSearchBar(workspace: workspace, pane: pane)
                .listRowInsets(EdgeInsets(top: 2, leading: 0, bottom: 2, trailing: 0))
                .listRowSeparator(.hidden)
            .id(Self.searchRowId)
            if workspace.showingSkeleton || (!workspace.hasLoaded && workspace.errorMessage == nil) {
                ForEach(0..<9, id: \.self) { index in SkeletonRow(seed: index, scale: CGFloat(app.settings.preferences.uiScale)) }
            } else {
                listRows
            }
        }
        .listStyle(.inset)
        .focused(pane, equals: .list)
        // ←: 사이드바로. →: 커서의 노트를 열고 본문으로.
        // 검색칸(목록 첫 줄)에서 친 키는 목록이 가로채지 않는다(←→는 글자 이동, ⏎는 검색).
        .onKeyPress(.leftArrow) {
            if Self.typingInField { return .ignored }
            pane.wrappedValue = .sidebar
            return .handled
        }
        .onKeyPress(.rightArrow) {
            if Self.typingInField { return .ignored }
            guard workspace.selection.count == 1, let id = workspace.selection.first else { return .ignored }
            let opening = workspace.openedId != id
            if opening { workspace.openedId = id }
            app.focusEditor(openingNew: opening)
            return .handled
        }
        // ⏎: 커서의 노트를 연다. 이미 열려 있으면 본문으로 포커스를 옮긴다(웹과 같은 정책).
        .onKeyPress(.return) {
            if Self.typingInField { return .ignored }
            guard workspace.selection.count == 1, let id = workspace.selection.first else { return .ignored }
            if workspace.openedId == id { app.editorFocusRequest += 1 } else { workspace.openedId = id }
            return .handled
        }        // ⎋: 휴지통으로 옮기는 중이면 취소하고, 아니면 선택을 푼다(웹과 같음).
        .onExitCommand { workspace.selection = [] }
        .animation(.easeOut(duration: 0.18), value: workspace.showingSkeleton)
        .overlay { if !workspace.showingSkeleton { emptyState } }
        .safeAreaInset(edge: .bottom) { errorBanner }

        .onAppear { ListKeyboard.install() }
        .navigationTitle(navigationTitle)
        .navigationSubtitle(countText)
        .toolbar {
            ToolbarItemGroup {
                Button { VoiceLauncher.start(.newNote, workspace: workspace) } label: { Label("음성으로 새 노트", systemImage: "mic") }
                    .voiceAvailability(app.openAIKey, help: String(localized: "음성으로 새 노트") + app.shortcutHint(.newVoiceNote))
                    .overlay { KeyFocusRing(visible: app.toolbarKeyFocus == .voice) }
                    .disabled(workspace.newNoteBlocked)
                Button { _ = workspace.createNote() } label: { Label("새 노트", systemImage: "square.and.pencil") }
                    .help(String(localized: "새 노트") + app.shortcutHint(.newNote))
                    .disabled(workspace.newNoteBlocked)
                    .overlay { KeyFocusRing(visible: app.toolbarKeyFocus == .newNote) }
            }
        }
        .contextMenu(forSelectionType: Int.self) { ids in
            contextMenu(for: ids)
        } primaryAction: { ids in
            guard ids.count == 1, let id = ids.first, let issue = workspace.issue(id: id) else { return }
            openWindow(id: "note", value: issue.number)
        }
        .onDeleteCommand {
            let targets = workspace.selection.compactMap { workspace.issue(id: $0) }
            guard !targets.isEmpty else { return }
            Task {
                if workspace.scope == .trash { await workspace.restore(targets, undoManager: undoManager) }
                else { await workspace.moveToTrash(targets, undoManager: undoManager) }
            }
        }
        // 클릭으로 하나를 고르면 바로 연다. ↑↓(목록 기본 동작)로 옮긴 커서는 열지 않는다(웹과 같은 정책).
        .onChange(of: workspace.selection) { old, selection in
            if selection.count > 1 { workspace.selectionPreviewId = selection.subtracting(old).first ?? workspace.selectionPreviewId }
            guard !ListKeyboard.movedRecently else { return }
            if selection.count == 1, let id = selection.first, workspace.openedId != id { workspace.openedId = id }
        }
        .onPasteCommand(of: [.fileURL, .plainText, .png, .tiff]) { providers in
            PasteImporter.newNote(from: providers, workspace: workspace)
        }
    }

    @ViewBuilder
    private var listRows: some View {
        // "고정됨"·"노트" 머리는 고를 수 없는 보통 줄이다. 섹션 머리(떠 있는 머리)에 식별자를 달면 SwiftUI 목록이
        // 갱신 중에 죽는다(검색칸을 숨기려고 머리줄로 스크롤해야 한다).
        if !workspace.displayedPinned.isEmpty {
            groupHeader("고정됨").id(Self.pinnedHeaderId)
            ForEach(workspace.displayedPinned) { issue in row(issue) }
            groupHeader("노트")
        }
        // 번호를 받기 전의 새 노트는 고정 노트 아래, 보통 노트 맨 위에 둔다. 번호를 받으면 같은 자리(보통 노트 맨 앞)에
        // 들어가므로 줄이 움직이지 않는다.
        if let newNote = workspace.newNote {
            NoteRowView(title: newNote.displayTitle, issue: nil, session: newNote, preferences: app.settings.preferences,
                        isOpened: workspace.openedId == NoteSession.newNoteSelectionId)
                .tag(NoteSession.newNoteSelectionId)
        }
        regularRows
    }

    private func groupHeader(_ title: LocalizedStringKey) -> some View {
        Text(title)
            .font(.system(size: 11 * CGFloat(app.settings.preferences.uiScale), weight: .semibold))
            .foregroundStyle(.secondary)
            .padding(.top, 6)
            .selectionDisabled()
            .listRowSeparator(.hidden)
    }

    @ViewBuilder
    private var regularRows: some View {
                ForEach(workspace.displayedRegular) { issue in
                    row(issue)
                        .onAppear {
                            if issue.id == workspace.displayedRegular.last?.id { Task { await workspace.loadMore() } }
                        }
                }
                if workspace.loadingMore {
                    HStack { Spacer(); ProgressView().controlSize(.small); Spacer() }
                }
                if workspace.searchLimitReached {
                    Text("검색 결과는 최대 100개까지 표시합니다.").font(.caption).foregroundStyle(.secondary)
                }
    }

    private func row(_ issue: Issue) -> some View {
        NoteRowView(title: nil, issue: issue, session: workspace.sessions[issue.number], preferences: app.settings.preferences,
                    isOpened: workspace.openedId == issue.id,
                    deletion: workspace.trashEntry(for: issue.id).map { $0.inFlight ? .inFlight : .pending },
                    onCancelDeletion: { if let entry = workspace.trashEntry(for: issue.id) { workspace.cancelTrash(entry: entry.id) } })
            .tag(issue.id)
            .id(issue.id)
    }

    @ViewBuilder
    private func contextMenu(for ids: Set<Int>) -> some View {
        let targets = ids.compactMap { workspace.issue(id: $0) }
        if targets.count == 1, let issue = targets.first {
            Button("새 창에서 열기") { openWindow(id: "note", value: issue.number) }
            Divider()
            if workspace.scope == .notes {
                Button(issue.isPinned ? "고정 해제" : "고정") { Task { await workspace.togglePin(issue) } }
            }
            Button("이슈 번호 복사") { NoteActions.copyIssueNumber(issue) }
            Button("GitHub에서 보기") { NoteActions.openOnGitHub(issue, repo: workspace.repo) }
            Divider()
        }
        if !targets.isEmpty {
            if workspace.scope == .notes {
                if targets.count >= 2 {
                    Button("\(targets.count)개 노트 병합…") { Task { await MergeRunner.run(targets, workspace: workspace) } }
                }
                Button(targets.count == 1 ? String(localized: "휴지통으로 이동") : String(localized: "\(targets.count)개 노트를 휴지통으로 이동")) {
                    Task { await workspace.moveToTrash(targets, undoManager: undoManager) }
                }
            } else {
                Button(targets.count == 1 ? String(localized: "복원") : String(localized: "\(targets.count)개 노트 복원")) {
                    Task { await workspace.restore(targets, undoManager: undoManager) }
                }
            }
        }
    }

    private var navigationTitle: String {
        if let label = workspace.labelFilter { return "#\(label)" }
        return workspace.scope == .trash ? String(localized: "휴지통") : String(localized: "노트")
    }

    private var countText: String {
        guard let total = workspace.totalCount else { return "" }
        return String(localized: "노트 \(total)개")
    }

    @ViewBuilder
    private var emptyState: some View {
        if workspace.hasLoaded && !workspace.loading && workspace.displayedIssues.isEmpty && workspace.newNote == nil && workspace.errorMessage == nil {
            // 태그로 걸렀을 때도 검색 결과로 본다(웹과 같음).
            if !workspace.activeQuery.isEmpty || workspace.labelFilter != nil {
                ContentUnavailableView.search(text: workspace.activeQuery.isEmpty ? "#\(workspace.labelFilter ?? "")" : workspace.activeQuery)
            } else if workspace.scope == .trash {
                ContentUnavailableView("지난 30일 동안 지운 노트가 없습니다", systemImage: "trash")
            } else {
                ContentUnavailableView("노트가 아직 없습니다", systemImage: "note.text", description: Text("⌘N으로 새 노트를 만드세요."))
            }
        }
    }

    @ViewBuilder
    private var errorBanner: some View {
        if let message = workspace.errorMessage {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                Text(message).font(.callout).fixedSize(horizontal: false, vertical: true)
                Spacer()
                Button("다시 시도") { Task { if workspace.connected { await workspace.reload() } else { await workspace.connect() } } }.controlSize(.small)
                Button { workspace.errorMessage = nil } label: { Image(systemName: "xmark") }
                    .buttonStyle(.borderless)
            }
            .padding(10)
            .background(.bar)
        }
    }
}

/// 목록 한 줄. 마감 배지, 제목, 요약, `#번호 · 날짜`, 태그, 고정·잠금 아이콘.
struct NoteRowView: View {
    let title: String?
    let issue: Issue?
    let session: NoteSession?
    let preferences: Preferences
    /// 오른쪽에 열린 노트. 키보드 커서(목록 선택 강조)와 따로, 왼쪽 강조색 막대로 표시한다.
    var isOpened = false
    /// 휴지통으로 옮기는 중: 유예 중이면 취소 버튼, 보내는 중이면 표시만(웹 note-row-deletion-overlay).
    enum Deletion { case pending, inFlight }
    var deletion: Deletion?
    var onCancelDeletion: () -> Void = {}

    private var scale: CGFloat { CGFloat(preferences.uiScale) }

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            if preferences.listRow.title {
                HStack(spacing: 5) {
                    if let badge { badgeView(badge) }
                    Text(displayTitle).font(.system(size: 13 * scale, weight: .semibold)).lineLimit(1)
                    Spacer(minLength: 0)
                    if issue?.isPinned == true { Image(systemName: "pin.fill").font(.caption2).foregroundStyle(.red) }
                    if issue?.isLocked == true { Image(systemName: "lock.fill").font(.caption2).foregroundStyle(LockTint.icon) }
                    // 저장 중이거나, 노트를 열며 GitHub에서 다시 읽는 중(웹 note-row-refresh-spinner).
                    if session?.saving == true || session?.refreshing == true { ProgressView().controlSize(.mini) }
                }
            }
            if preferences.listRow.summary {
                Text(summary).font(.system(size: 12 * scale)).foregroundStyle(.secondary).lineLimit(1)
            }
            if preferences.listRow.meta {
                Text(meta).font(.system(size: 10.5 * scale)).foregroundStyle(.tertiary).lineLimit(1)
            }
            // 태그는 날짜 아래 줄에 따로 둔다(웹 note-row-labels와 같은 자리).
            let tags = issue?.visibleLabels.map(\.name) ?? session?.visibleLabels ?? []
            if preferences.listRow.tags, !tags.isEmpty {
                HStack(spacing: 6) {
                    ForEach(tags, id: \.self) { name in
                        Text("#\(name)").font(.system(size: 10.5 * scale)).foregroundStyle(Color(hex: TagColor.hex(for: name)))
                    }
                }
                .lineLimit(1)
            }
        }
        .padding(.vertical, 3)
        .opacity(issue?.isClosed == true ? 0.75 : 1)
        .overlay(alignment: .leading) {
            if isOpened {
                Capsule().fill(Color.accentColor).frame(width: 4).padding(.vertical, 1).offset(x: -10)
            }
        }
        .overlay {
            if let deletion {
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Text("삭제 중…").font(.system(size: 12 * scale, weight: .medium))
                    if deletion == .pending {
                        Button("취소", action: onCancelDeletion).controlSize(.small)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(RoundedRectangle(cornerRadius: 6).fill(.regularMaterial))
            }
        }
        .accessibilityAddTraits(isOpened ? .isSelected : [])
    }

    private var displayTitle: String {
        if let title { return title }
        guard let issue else { return "" }
        if let session, session.dirty { return NoteText.markdownToPlainText(session.displayTitle) }
        let plain = NoteText.markdownToPlainText(NoteLock.removeLock(from: issue.title))
        return plain.isEmpty ? NoteSession.placeholderTitle : plain
    }

    private var bodyText: String {
        if let session, session.dirty || issue == nil { return session.body }
        return issue?.body ?? ""
    }

    private var summary: String {
        if issue?.isLocked == true { return String(localized: "잠긴 노트입니다") }
        // 이름 없는 첨부 링크(`[](…)`)는 요약에서 뺀다. 그대로 두면 긴 주소가 보인다.
        let text = AttachmentLinks.stripManagedBlocks(bodyText)
            .replacingOccurrences(of: #"!?\[\]\([^)\s]*\)"#, with: "", options: .regularExpression)
        var lines = text.components(separatedBy: "\n")
        // 첫 줄 제목 방식이면 제목 줄은 요약에서 뺀다.
        let title = issue.map { NoteLock.removeLock(from: $0.title) } ?? session?.displayTitle ?? ""
        if let first = lines.first, !title.isEmpty, NoteText.automaticTitle(first) == title { lines.removeFirst() }
        let plain = NoteText.markdownToPlainText(lines.joined(separator: "\n"))
        return plain.isEmpty ? String(localized: "내용 없음") : String(plain.prefix(160))
    }

    private var meta: String {
        guard let issue else { return String(localized: "로컬 초안") }
        let date = GitHubDate.parse(issue.updatedAt).map { $0.formatted(.dateTime.month(.abbreviated).day().hour().minute()) } ?? ""
        return "#\(issue.number) · \(date)"
    }

    private var badge: DueDate.Badge? {
        guard issue?.isLocked != true else { return nil }
        return DueDate.badge(AttachmentLinks.stripManagedBlocks(bodyText))
    }

    private func badgeView(_ badge: DueDate.Badge) -> some View {
        Text(badge.label)
            .font(.caption2.weight(.bold))
            .padding(.horizontal, 5).padding(.vertical, 1)
            .background(Capsule().fill(badge.days <= 3 ? Color.red.opacity(0.85) : Color.secondary.opacity(0.25)))
            .foregroundStyle(badge.days <= 3 ? Color.white : Color.primary)
            .help("마감 \(badge.date)")
    }
}

/// 여러 노트를 골랐을 때 오른쪽 칸.
struct SelectionSummaryView: View {
    @Environment(\.undoManager) private var undoManager
    @Bindable var workspace: WorkspaceModel
    @State private var showingTags = false

    private var targets: [Issue] { workspace.selection.compactMap { workspace.issue(id: $0) } }

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "square.stack.3d.up").font(.system(size: 44)).foregroundStyle(.secondary)
            Text("\(targets.count)개 노트를 선택했습니다").font(.title3)
            HStack {
                if workspace.scope == .notes {
                    Button("태그…") { showingTags = true }
                        .popover(isPresented: $showingTags) {
                            BulkTagPanel(workspace: workspace, targets: targets).frame(width: 300, height: 360)
                        }
                    Button("병합…") { Task { await MergeRunner.run(targets, workspace: workspace) } }
                        .disabled(targets.count < 2)
                        .help(targets.count < 2 ? "병합하려면 노트를 두 개 이상 선택하세요." : "시간순 기록 하나로 합칩니다.")
                    Button("휴지통으로 이동", role: .destructive) {
                        Task { await workspace.moveToTrash(targets, undoManager: undoManager) }
                    }
                } else {
                    Button("복원") { Task { await workspace.restore(targets, undoManager: undoManager) } }
                }
            }
            .disabled(workspace.merging)
            Text("⌘클릭·⇧클릭으로 선택을 바꿉니다. ⎋로 선택을 해제합니다. 아래는 마지막으로 누른 노트입니다.").font(.caption).foregroundStyle(.secondary)
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onExitCommand { workspace.selection = [] }
    }
}

/// 목록의 ↑↓·Page·Home·End는 macOS 목록이 직접 처리한다. 그 키로 선택이 바뀌었는지 알려고 마지막 이동 키 시각을 기록한다.
@MainActor
enum ListKeyboard {
    private static var lastMove = Date.distantPast
    private static var monitor: Any?
    static let navigationKeys: Set<UInt16> = [125, 126, 115, 119, 116, 121]

    static var movedRecently: Bool { Date().timeIntervalSince(lastMove) < 0.5 }

    /// 코드가 커서를 옮길 때도 열지 않게 표시한다.
    static func markMoved() { lastMove = Date() }

    static func install() {
        guard monitor == nil else { return }
        monitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .leftMouseDown]) { event in
            MainActor.assumeIsolated { handle(event) }
        }
    }

    private static func handle(_ event: NSEvent) -> NSEvent? {
        let app = AppModel.shared
        if event.type == .leftMouseDown {
            app.toolbarKeyFocus = nil
            return event
        }
        // macOS 목록은 글자를 누르면 그 글자로 시작하는 행으로 선택을 옮긴다(type-select). ⌥T 같은 조합도 글자(†)로
        // 받아 노트가 바뀌므로 사이드바·노트 목록에서 끈다. 단축키는 메뉴(설정 → 단축키)로만 받는다.
        if let table = event.window?.firstResponder as? NSTableView, table.allowsTypeSelect {
            table.allowsTypeSelect = false
        }
        let plain = event.modifierFlags.intersection([.command, .shift, .option, .control]).isEmpty
        // 병합하는 동안에는 메뉴 단축키까지 모든 키를 막는다(웹과 같음).
        if app.workspace?.merging == true { return nil }
        // 기록 입력칸에서 글을 고른 채 Tab·⇧Tab: 줄마다 들여쓰거나 내어 쓴다(본문과 같음, 웹 기록 입력칸).
        if event.keyCode == 48, let text = event.window?.firstResponder as? NSTextView, !(text is GinoteTextView), !text.isFieldEditor,
           text.isEditable, text.selectedRange().length > 0,
           event.modifierFlags.intersection([.command, .option, .control]).isEmpty,
           GinoteTextView.indentLines(of: text, outdent: event.modifierFlags.contains(.shift)) {
            return nil
        }
        // ⎋는 포커스를 정리하기 전에 휴지통 이동부터 가장 최근 것 하나를 되돌린다(웹과 같음).
        // 한글 조합 중이면 입력기가 먼저 쓴다.
        if event.keyCode == 53, plain, (event.window?.firstResponder as? NSTextView)?.hasMarkedText() != true,
           app.workspace?.cancelMostRecentTrash() == true {
            return nil
        }
        // 툴바 버튼 포커스: ↑는 새 노트 → 음성 녹음(맨 위에서 멈춤), ↓는 거꾸로 내려와 검색칸까지.
        // ⏎·Space는 그 버튼을 누르고, ⎋는 검색칸으로 돌아간다.
        if let focus = app.toolbarKeyFocus, plain {
            switch (event.keyCode, focus) {
            case (36, .newNote), (49, .newNote):
                app.toolbarKeyFocus = nil
                _ = app.workspace?.createNote()
            case (36, .voice), (49, .voice):
                app.toolbarKeyFocus = nil
                if let workspace = app.workspace { VoiceLauncher.start(.newNote, workspace: workspace) }
            case (126, .newNote):
                app.toolbarKeyFocus = .voice
            case (126, .voice):
                break
            case (125, .voice):
                app.toolbarKeyFocus = .newNote
            case (125, .newNote), (53, _):
                app.toolbarKeyFocus = nil
                app.searchFocusRequest += 1
            default:
                app.toolbarKeyFocus = nil
                return event
            }
            return nil
        }
        if navigationKeys.contains(event.keyCode) { lastMove = Date() }
        // 목록 맨 위에서 ↑: 검색칸으로(목록이 직접 ↑를 처리하므로 여기서 가로챈다).
        if event.keyCode == 126, plain, app.activePane == .list,
           event.window?.firstResponder is NSTableView, let workspace = app.workspace {
            let top = workspace.displayedPinned.first?.id
                ?? (workspace.newNote != nil ? NoteSession.newNoteSelectionId : workspace.displayedIssues.first?.id)
            if workspace.selection.isEmpty || (workspace.selection.count == 1 && workspace.selection.first == top) {
                app.searchFocusRequest += 1
                return nil
            }
        }
        return event
    }
}

/// 목록을 읽는 동안의 자리표시 행. 실제 행과 같은 높이·구성으로 은은하게 깜빡인다.
struct SkeletonRow: View {
    let seed: Int
    let scale: CGFloat
    @State private var dim = false

    private var widths: (CGFloat, CGFloat, CGFloat) {
        let titles: [CGFloat] = [0.55, 0.7, 0.45, 0.62, 0.5, 0.66, 0.4, 0.58, 0.52]
        let summaries: [CGFloat] = [0.92, 0.8, 0.86, 0.74, 0.9, 0.68, 0.84, 0.78, 0.88]
        return (titles[seed % titles.count], summaries[seed % summaries.count], 0.32)
    }

    var body: some View {
        GeometryReader { proxy in
            VStack(alignment: .leading, spacing: 7 * scale) {
                bar(width: proxy.size.width * widths.0, height: 11 * scale)
                bar(width: proxy.size.width * widths.1, height: 9 * scale)
                bar(width: proxy.size.width * widths.2, height: 8 * scale)
            }
            .padding(.vertical, 6)
        }
        .frame(height: 58 * scale)
        .opacity(dim ? 0.45 : 1)
        .onAppear {
            withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true).delay(Double(seed) * 0.06)) { dim = true }
        }
        .accessibilityHidden(true)
    }

    private func bar(width: CGFloat, height: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: height / 2)
            .fill(Color.secondary.opacity(0.22))
            .frame(width: width, height: height)
    }
}

/// 툴바 버튼의 키보드 포커스 표시.
struct KeyFocusRing: View {
    let visible: Bool
    var body: some View {
        RoundedRectangle(cornerRadius: 6).strokeBorder(Color.accentColor, lineWidth: 2)
            .padding(-3)
            .opacity(visible ? 1 : 0)
    }
}
