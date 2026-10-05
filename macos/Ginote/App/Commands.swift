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
struct GinoteCommands: Commands {
    @FocusedValue(\.workspace) private var workspace
    @FocusedValue(\.noteSession) private var session
    @FocusedValue(\.noteCommands) private var handlers
    @Environment(\.openWindow) private var openWindow

    var body: some Commands {
        CommandGroup(replacing: .newItem) {
            Button("새 노트") { _ = workspace?.createNote() }
                .shortcut(.newNote)
                .disabled(workspace == nil || workspace?.newNoteBlocked == true)
            Button("음성으로 새 노트") { workspace.map { VoiceLauncher.start(.newNote, workspace: $0) } }
                .shortcut(.newVoiceNote)
                .disabled(workspace == nil || workspace?.newNote != nil || (workspace?.selection.count ?? 0) > 1)
            Button("새 창에서 열기") {
                if let number = session?.number { openWindow(id: "note", value: number) }
            }
            .shortcut(.openInNewWindow)
            .disabled(session?.number == nil)
        }
        CommandGroup(after: .saveItem) {
            Button("지금 저장") { session?.saveNow() }
                .shortcut(.saveNow)
                .disabled(session == nil)
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
                .disabled(workspace == nil)
            Button("찾아 바꾸기…") { handlers?.showReplace() }
                .shortcut(.replace)
                .disabled(session?.isEditable != true)
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
            Button("Markdown 미리보기") { handlers?.togglePreview() }
                .shortcut(.preview)
                .disabled(session == nil || session?.lockState == .locked)
            Button("새로고침") {
                Task {
                    await workspace?.refresh(background: false)
                    await session?.reloadFromGitHub()
                }
            }
            .shortcut(.refresh)
            .disabled(workspace == nil)
        }
        CommandMenu("노트") {
            Button("태그…") { handlers?.showTags() }
                .shortcut(.tags)
                .disabled(session?.isEditable != true)
            Button("파일 첨부…") { session?.chooseAttachments() }
                .shortcut(.attachFiles)
                .disabled(session?.isEditable != true)
            Button("음성 녹음") { session.map { VoiceLauncher.start(.body, session: $0) } }
                .shortcut(.voiceRecording)
                .disabled(session?.isEditable != true || session?.number == nil || (workspace?.selection.count ?? 0) > 1)
            Divider()
            Button(lockTitle) { session?.requestLock() }
                .shortcut(.lock)
                .disabled(session == nil || session?.isArchived == true)
            Button(session?.isPinned == true ? "고정 해제" : "고정") {
                if let workspace, let issue = session?.issue { Task { await workspace.togglePin(issue) } }
            }
            .shortcut(.pin)
            .disabled(session?.issue == nil || session?.isArchived == true || workspace?.pinMutation == true)
            Divider()
            Button("이슈 번호 복사") {
                if let session, let number = session.number { NoteActions.copyIssueNumber(number: number, title: session.displayTitle) }
            }
            .shortcut(.copyIssueNumber)
            .disabled(session?.number == nil)
            Button("GitHub에서 보기") {
                if let session, let issue = session.issue { NoteActions.openOnGitHub(issue, repo: session.repo) }
            }
            .shortcut(.openOnGitHub)
            .disabled(session?.issue == nil)
            Divider()
            Button(session?.isArchived == true ? "복원" : "휴지통으로 이동") {
                guard let workspace, let issue = session?.issue else { return }
                let undo = NSApp.keyWindow?.undoManager
                Task {
                    if issue.isClosed { await workspace.restore([issue], undoManager: undo) }
                    else { await workspace.moveToTrash([issue], undoManager: undo) }
                }
            }
            .shortcut(.moveToTrash)
            .disabled(session?.issue == nil)
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
            Button("Ginote 도움말") { openWindow(id: "help") }
        }
    }

    private var lockTitle: String {
        switch session?.lockState {
        case .locked?: return String(localized: "잠금 열기")
        case .unlocked?: return String(localized: "잠금 풀기")
        default: return String(localized: "잠금")
        }
    }
}

/// 첫 응답자(본문 편집기)에 표준 찾기 동작을 보낸다. 태그로 동작을 고르는 AppKit 규약을 따른다.
@MainActor
enum TextFind {
    static func perform(_ action: NSTextFinder.Action) {
        let item = NSMenuItem()
        item.tag = action.rawValue
        NSApp.sendAction(#selector(NSTextView.performFindPanelAction(_:)), to: nil, from: item)
    }
}
