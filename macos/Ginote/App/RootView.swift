import GinoteCore
import SwiftUI

/// 저장소가 없으면 시작 마법사, 있으면 3단 창.
struct RootView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        Group {
            if app.settings.workspaces.isEmpty {
                SetupView(mode: .firstRun)
            } else if let workspace = app.workspace {
                MainSplitView(workspace: workspace)
            } else {
                ContentUnavailableView {
                    Label("저장소에 연결하는 중", systemImage: "arrow.triangle.2.circlepath")
                } description: {
                    Text(app.settings.activeWorkspace?.title ?? "")
                }
            }
        }
        .sheet(item: Binding(get: { app.tokenPromptWorkspace }, set: { app.tokenPromptWorkspace = $0 })) { workspace in
            TokenPromptView(workspace: workspace)
                .environment(app)
        }
        .sheet(isPresented: Binding(get: { app.showingAddWorkspace }, set: { app.showingAddWorkspace = $0 })) {
            SetupView(mode: .addWorkspace)
                .environment(app)
                .frame(width: 560, height: 520)
        }
        .sheet(item: Binding(get: { app.voiceRequest }, set: { app.voiceRequest = $0 })) { request in
            VoiceSheet(request: request).environment(app)
        }
        .alert("설정 파일", isPresented: Binding(get: { app.configNotice != nil }, set: { if !$0 { app.configNotice = nil } })) {
            Button("확인") { app.configNotice = nil }
        } message: {
            Text(app.configNotice ?? "")
        }
    }
}

/// 키보드로 오가는 칸. 본문(편집기)은 AppKit 보기라 따로 포커스를 요청한다.
enum PaneFocus: Hashable { case sidebar, list }

struct MainSplitView: View {
    @Environment(AppModel.self) private var app
    @Bindable var workspace: WorkspaceModel
    @State private var columnVisibility = NavigationSplitViewVisibility.all
    @FocusState private var pane: PaneFocus?

    var body: some View {
        // 저장소를 바꾸면 목록·노트 칸만 새로 만든다. 분할 화면 자체를 새로 만들면(.id) SwiftUI가 사이드바 접기
        // 버튼을 10pt로 줄여 그려 버튼이 사라진다. 사이드바는 그대로 두어 키보드 커서가 고른 저장소에 남게 한다.
        NavigationSplitView(columnVisibility: $columnVisibility) {
            SidebarView(workspace: workspace, pane: $pane)
                .navigationSplitViewColumnWidth(min: 180, ideal: 220, max: 320)
        } content: {
            NoteListView(workspace: workspace, pane: $pane)
                .id(workspace.workspace.id)
                .navigationSplitViewColumnWidth(min: 260, ideal: 340, max: 520)
        } detail: {
            DetailView(workspace: workspace)
                .id(workspace.workspace.id)
        }
        .background(SidebarToggleAligner())
        .focusedSceneValue(\.workspace, workspace)
        .onChange(of: app.listFocusRequest) { _, _ in pane = .list }
        // 병합하는 동안에는 창을 막는다(웹과 같음).
        .overlay {
            if workspace.merging {
                ZStack {
                    Color.black.opacity(0.25)
                    ProgressView("노트를 병합하는 중…")
                        .padding(24)
                        .background(RoundedRectangle(cornerRadius: 12).fill(.regularMaterial))
                }
                .ignoresSafeArea()
                .allowsHitTesting(true)
            }
        }
        .onChange(of: pane) { _, value in
            app.activePane = value
            DebugTrace.log("pane \(String(describing: value))")
        }
    }
}

/// 오른쪽 칸: 노트 하나, 여러 노트 선택, 또는 빈 화면.
struct DetailView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.openWindow) private var openWindow
    @Bindable var workspace: WorkspaceModel

    private var openedSession: NoteSession? {
        if workspace.openedId == NoteSession.newNoteSelectionId { return workspace.newNote }
        guard let id = workspace.openedId, let issue = workspace.issue(id: id) else { return nil }
        return workspace.session(for: issue)
    }

    var body: some View {
        content
    }

    @ViewBuilder
    private var content: some View {
        if workspace.selection.count > 1 {
            VStack(spacing: 0) {
                SelectionSummaryView(workspace: workspace)
                    .frame(maxHeight: workspace.selectionPreviewId == nil ? .infinity : 190)
                if let id = workspace.selectionPreviewId, workspace.selection.contains(id), let issue = workspace.issue(id: id) {
                    Divider()
                    SelectionPreview(issue: issue, workspace: workspace)
                }
            }
            .toolbar { InactiveNoteToolbar() }
        } else if let session = openedSession {
            // 새 노트가 번호를 받으면 openedId가 바뀌지만 세션은 같은 객체다. 같은 화면(같은 id)으로 그려
            // 편집기를 다시 만들지 않는다. 다시 만들면 입력 중인 포커스를 잃는다.
            NoteDetailView(session: session)
                .id(session.id)
        } else {
            ContentUnavailableView {
                Label("노트를 고르세요", systemImage: "note.text")
            } description: {
                Text("목록에서 노트를 고르거나 ⌘N으로 새 노트를 만드세요.")
            } actions: {
                // 도움말 바로가기(웹 빈 화면의 보안 | MCP | 앱 | 키보드).
                HStack(spacing: 14) {
                    ForEach(HelpView.Topic.allCases) { topic in
                        Button { app.helpTopic = topic; openWindow(id: "help") } label: { Text(topic.title) }
                            .buttonStyle(.link)
                    }
                }
                .font(.callout)
            }
            // 노트가 없어도 노트 칸 툴바를 꺼진 채로 둔다(메일과 같음). 없으면 목록 칸의 버튼이 창 오른쪽 끝으로 밀리고
            // 제목 막대가 목록·노트로 나뉘지 않는다.
            .toolbar { InactiveNoteToolbar() }
        }
    }
}

/// 노트를 고르지 않았을 때 노트 칸에 보이는 꺼진 툴바(노트 툴바와 같은 버튼).
struct InactiveNoteToolbar: ToolbarContent {
    var body: some ToolbarContent {
        ToolbarItemGroup(placement: .primaryAction) {
            ForEach([("첨부", "paperclip"), ("음성 녹음", "mic"), ("태그", "tag"), ("미리보기", "eye"),
                     ("잠금", "lock.open"), ("고정", "pin"), ("더 보기", "ellipsis.circle")], id: \.1) { item in
                Button {} label: { Label(LocalizedStringKey(item.0), systemImage: item.1) }
                    .disabled(true)
            }
        }
    }
}

/// 노트를 따로 연 창.
struct NoteWindowView: View {
    @Environment(AppModel.self) private var app
    let number: Int

    var body: some View {
        if let workspace = app.workspace, let session = workspace.session(number: number) {
            // 따로 연 창은 본문 끝에서 바로 이어 쓸 수 있게 시작한다(태그 버튼에 포커스가 가지 않게).
            NoteDetailView(session: session, focusOnAppear: true)
                .focusedSceneValue(\.workspace, workspace)
        } else {
            ContentUnavailableView("노트를 열 수 없습니다", systemImage: "exclamationmark.triangle",
                                   description: Text("이 노트가 지금 저장소의 목록에 없습니다."))
        }
    }
}

/// 여러 개를 고르는 중 마지막으로 누른 노트를 읽기 전용으로 보인다.
struct SelectionPreview: View {
    let issue: Issue
    let workspace: WorkspaceModel

    var body: some View {
        if issue.isLocked {
            ContentUnavailableView("잠긴 노트", systemImage: "lock.fill")
        } else {
            // 웹처럼 첨부·기록까지 담은 읽기 전용 노트로 보인다.
            let session = workspace.session(for: issue)
            NoteDetailView(session: session, readOnly: true)
                .id(session.id)
        }
    }
}

/// 화면 확대(⌘+/⌘-, `display.ui_scale`)를 반영한 글꼴·크기. 확대는 창 전체(사이드바·목록·노트·기록)에 적용한다.
@MainActor
enum UIScale {
    static var value: CGFloat { CGFloat(AppModel.shared.settings.preferences.uiScale) }
    static func font(_ size: CGFloat, weight: Font.Weight = .regular) -> Font { .system(size: size * value, weight: weight) }
    static func size(_ points: CGFloat) -> CGFloat { points * value }
}

/// 사이드바 접기 버튼을 사이드바 칸 오른쪽 끝으로 민다(메모 앱과 같은 자리). SwiftUI는 이 버튼을 신호등 바로 옆에
/// 고정해 좁은 사이드바에서 가운데처럼 어정쩡하게 보인다. 버튼 앞에 늘어나는 빈칸을 넣는다. SwiftUI가 툴바를 다시
/// 만들면 빈칸이 빠지므로 창이 갱신될 때마다 확인한다(첫 항목만 보는 가벼운 검사).
struct SidebarToggleAligner: NSViewRepresentable {
    func makeNSView(context: Context) -> AlignerView { AlignerView() }
    func updateNSView(_ view: AlignerView, context: Context) { view.align() }

    final class AlignerView: NSView {
        private static let toggleId = "com.apple.SwiftUI.navigationSplitView.toggleSidebar"
        private var observer: NSObjectProtocol?

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            if let observer { NotificationCenter.default.removeObserver(observer) }
            observer = nil
            guard let window else { return }
            observer = NotificationCenter.default.addObserver(forName: NSWindow.didUpdateNotification, object: window, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.align() }
            }
            align()
        }

        func align() {
            #if DEBUG
            if ProcessInfo.processInfo.environment["GINOTE_NO_SIDEBAR_ALIGN"] != nil { return }
            #endif
            guard let toolbar = window?.toolbar,
                  let index = toolbar.items.firstIndex(where: { $0.itemIdentifier.rawValue == Self.toggleId }) else { return }
            let hasSpace = index > 0 && toolbar.items[index - 1].itemIdentifier == .flexibleSpace
            // 사이드바를 접으면 빈칸이 목록 칸 툴바를 밀어내므로 뺀다. 펴면 다시 넣는다.
            if sidebarCollapsed {
                if hasSpace { toolbar.removeItem(at: index - 1) }
            } else if !hasSpace {
                toolbar.insertItem(withItemIdentifier: .flexibleSpace, at: index)
            }
        }

        /// 창의 첫 분할 칸(사이드바)이 접혔는지.
        private var sidebarCollapsed: Bool {
            func findSplit(_ view: NSView) -> NSSplitView? {
                if let split = view as? NSSplitView, split.arrangedSubviews.count >= 3 { return split }
                for sub in view.subviews { if let found = findSplit(sub) { return found } }
                return nil
            }
            guard let root = window?.contentView, let split = findSplit(root), let sidebar = split.arrangedSubviews.first else { return false }
            return split.isSubviewCollapsed(sidebar) || sidebar.isHidden || sidebar.frame.width < 1
        }
    }
}
