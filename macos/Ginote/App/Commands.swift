import AppKit
import GinoteCore
import SwiftUI

struct NoteCommandHandlers {
    var showTags: () -> Void
    var togglePreview: () -> Void
    var showReplace: () -> Void
    var focusEditor: () -> Void
}

extension FocusedValues {
    @Entry var workspace: WorkspaceModel?
    @Entry var noteSession: NoteSession?
    @Entry var noteCommands: NoteCommandHandlers?
}

/// 메뉴바 명령(macos/DESIGN.md §5.4). 웹의 한 글자 단축키를 ⌘ 조합으로 옮겼고, 설정 → 단축키에서 바꿀 수 있다.
/// 각 항목이 하는 일과 켜짐 조건은 CommandActions에 있다(키 창 없이도 검사할 수 있게).
struct GinoteCommands: Commands {
    @FocusedValue(\.workspace) private var workspace
    @FocusedValue(\.noteSession) private var session
    @FocusedValue(\.noteCommands) private var handlers
    @Environment(\.openWindow) private var openWindow

    private var actions: CommandActions { CommandActions(workspace: workspace, session: session, handlers: handlers) }

    var body: some Commands {
        // 메뉴 명령은 창이 하나도 없어도 만들어진다. AppDelegate가 메인 창 없이 시작했을 때 쓰도록 창 열기를 넘겨 둔다.
        let _ = AppModel.shared.openMainWindow = { [openWindow] in openWindow(id: "main") }
        CommandGroup(replacing: .newItem) {
            Button("새 노트") { actions.newNote() }
                .shortcut(.newNote)
                .disabled(!actions.canCreateNote)
            Button("음성으로 새 노트") { actions.newVoiceNote() }
                .shortcut(.newVoiceNote)
                .disabled(!actions.canCreateVoiceNote)
            Button("새 창에서 열기") { actions.openInNewWindow(openWindow) }
                .shortcut(.openInNewWindow)
                .disabled(!actions.hasNumber)
            // .saveItem 묶음은 문서 앱에만 있어 그 뒤에 두면 메뉴에 나오지 않는다. 새 노트 묶음 끝에 둔다.
            Divider()
            Button("지금 저장") { actions.saveNow() }
                .shortcut(.saveNow)
                .disabled(!actions.hasSession)
        }

        CommandGroup(after: .textEditing) {
            // 본문 찾기 막대(NSTextView 기본 찾기). 메뉴가 없으면 ⌘F가 아무 일도 하지 않는다.
            Button("찾기…") { TextFind.perform(.showFindInterface) }
                .shortcut(.find)
            Button("다음 찾기") { TextFind.perform(.nextMatch) }
                .shortcut(.findNext)
            Button("이전 찾기") { TextFind.perform(.previousMatch) }
                .shortcut(.findPrevious)
            Button("선택 항목으로 찾기") { TextFind.perform(.setSearchString) }
                .shortcut(.useSelectionForFind)
            Divider()
            Button("노트 검색") { AppModel.shared.searchFocusRequest += 1 }
                .shortcut(.searchNotes)
                .disabled(!actions.hasWorkspace)
            Button("찾아 바꾸기…") { actions.showReplace() }
                .shortcut(.replace)
                .disabled(!actions.canEdit)
        }
        CommandGroup(after: .toolbar) {
            Button("확대") { AppModel.shared.zoom(by: 0.1) }
                .shortcut(.zoomIn)
            Button("축소") { AppModel.shared.zoom(by: -0.1) }
                .shortcut(.zoomOut)
            Button("실제 크기") { AppModel.shared.resetZoom() }
                .shortcut(.actualSize)
            Divider()
        }
        CommandGroup(after: .sidebar) {
            Button("Markdown 미리보기") { actions.togglePreview() }
                .shortcut(.preview)
                .disabled(!actions.canPreview)
            Button("새로고침") { Task { await actions.refresh() } }
                .shortcut(.refresh)
                .disabled(!actions.hasWorkspace)
        }
        CommandMenu("노트") {
            Button("태그…") { actions.showTags() }
                .shortcut(.tags)
                .disabled(!actions.canEdit)
            Button("파일 첨부…") { actions.attachFiles() }
                .shortcut(.attachFiles)
                .disabled(!actions.canEdit)
            Button("음성 녹음") { actions.recordVoice() }
                .shortcut(.voiceRecording)
                .disabled(!actions.canRecordVoice)
            Divider()
            Button(actions.lockTitle) { actions.lock() }
                .shortcut(.lock)
                .disabled(!actions.canLock)
            Button(actions.pinTitle) { actions.togglePin() }
                .shortcut(.pin)
                .disabled(!actions.canPin)
            Divider()
            Button("이슈 번호 복사") { actions.copyIssueNumber() }
                .shortcut(.copyIssueNumber)
                .disabled(!actions.hasNumber)
            Button("GitHub에서 보기") { actions.openOnGitHub() }
                .shortcut(.openOnGitHub)
                .disabled(!actions.hasIssue)
            Divider()
            Button(actions.trashTitle) { actions.toggleTrash(undoManager: NSApp.keyWindow?.undoManager) }
                .shortcut(.moveToTrash)
                .disabled(!actions.hasIssue)
        }
        CommandMenu("저장소") {
            ForEach(Array(AppModel.shared.settings.workspaces.prefix(9).enumerated()), id: \.element.id) { index, item in
                Button(item.title) { AppModel.shared.switchWorkspace(to: item.id) }
                    .keyboardShortcut(KeyEquivalent(Character("\(index + 1)")))
            }
            Divider()
            Button("저장소 추가…") { AppModel.shared.showingAddWorkspace = true }
        }
        CommandGroup(replacing: .help) {
            Button("Ginote 도움말") { SystemActions.openWindow(openWindow, id: "help") }
        }
    }
}

/// 메뉴 항목이 하는 일과 켜짐 조건. 지금 창의 저장소·노트(포커스 값)를 받아 쓴다.
@MainActor
struct CommandActions {
    let workspace: WorkspaceModel?
    let session: NoteSession?
    let handlers: NoteCommandHandlers?

    var hasWorkspace: Bool { workspace != nil }
    var hasSession: Bool { session != nil }
    var hasNumber: Bool { session?.number != nil }
    var hasIssue: Bool { session?.issue != nil }
    var canEdit: Bool { session?.isEditable == true }
    private var selectingSeveral: Bool { (workspace?.selection.count ?? 0) > 1 }
    var canCreateNote: Bool { workspace.map { !$0.newNoteBlocked } ?? false }
    var canCreateVoiceNote: Bool { workspace.map { $0.newNote == nil } ?? false && !selectingSeveral }
    var canPreview: Bool { session.map { $0.lockState != .locked } ?? false }
    var canRecordVoice: Bool { canEdit && hasNumber && !selectingSeveral }
    var canLock: Bool { session.map { !$0.isArchived } ?? false }
    var canPin: Bool { hasIssue && session?.isArchived != true && workspace?.pinMutation != true }

    var lockTitle: String {
        switch session?.lockState {
        case .locked?: return String(localized: "잠금 열기")
        case .unlocked?: return String(localized: "잠금 풀기")
        default: return String(localized: "잠금")
        }
    }

    var pinTitle: String { session?.isPinned == true ? String(localized: "고정 해제") : String(localized: "고정") }
    var trashTitle: String { session?.isArchived == true ? String(localized: "복원") : String(localized: "휴지통으로 이동") }

    func newNote() { _ = workspace?.createNote() }
    func newVoiceNote() { if let workspace { VoiceLauncher.start(.newNote, workspace: workspace) } }

    func openInNewWindow(_ openWindow: OpenWindowAction) {
        if let number = session?.number { SystemActions.openWindow(openWindow, id: "note", value: number) }
    }

    func saveNow() { session?.saveNow() }
    func showReplace() { handlers?.showReplace() }
    func togglePreview() { handlers?.togglePreview() }
    func showTags() { handlers?.showTags() }
    func attachFiles() { session?.chooseAttachments() }
    func recordVoice() { if let session { VoiceLauncher.start(.body, session: session) } }
    func lock() { session?.requestLock() }

    func refresh() async {
        await workspace?.refresh(background: false)
        await session?.reloadFromGitHub()
    }

    func togglePin() {
        if let workspace, let issue = session?.issue { Task { await workspace.togglePin(issue) } }
    }

    func copyIssueNumber() {
        if let session, let number = session.number { NoteActions.copyIssueNumber(number: number, title: session.displayTitle) }
    }

    func openOnGitHub() {
        if let session, let issue = session.issue { NoteActions.openOnGitHub(issue, repo: session.repo) }
    }

    func toggleTrash(undoManager: UndoManager?) {
        guard let workspace, let issue = session?.issue else { return }
        Task {
            if issue.isClosed { await workspace.restore([issue], undoManager: undoManager) }
            else { await workspace.moveToTrash([issue], undoManager: undoManager) }
        }
    }
}

/// 첫 응답자(본문 편집기)에 표준 찾기 동작을 보낸다. 태그로 동작을 고르는 AppKit 규약을 따른다.
/// 목록·사이드바에 포커스가 있으면 받을 곳이 없어 아무 일도 일어나지 않으므로, 먼저 열린 노트의 본문(또는 미리보기)으로
/// 포커스를 옮긴다. 커서 위치와 스크롤은 그대로 둔다.
@MainActor
enum TextFind {
    static func perform(_ action: NSTextFinder.Action) {
        let window = SystemActions.keyWindow()
        if let window, !((window.firstResponder as? NSTextView)?.usesFindBar ?? false),
           let target = noteTextView(in: window.contentView) {
            window.makeFirstResponder(target)
        }
        let item = NSMenuItem()
        item.tag = action.rawValue
        let selector = #selector(NSTextView.performFindPanelAction(_:))
        // 키 창의 첫 응답자부터 응답자 사슬을 따라 보낸다(to: nil과 같다).
        if window?.firstResponder?.tryToPerform(selector, with: item) == true { return }
        NSApp.sendAction(selector, to: nil, from: item)
    }

    private static func noteTextView(in view: NSView?) -> NSTextView? {
        guard let view else { return nil }
        if let text = view as? DocumentTextView, text.usesFindBar, !text.isHiddenOrHasHiddenAncestor { return text }
        for sub in view.subviews { if let found = noteTextView(in: sub) { return found } }
        return nil
    }
}
