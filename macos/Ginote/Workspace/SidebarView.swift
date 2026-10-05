import GinoteCore
import SwiftUI

enum SidebarItem: Hashable {
    case workspace(String), notes, trash, tag(String)
}

/// 왼쪽 칸: 저장소, 보관함(노트·휴지통), 태그.
struct SidebarView: View {
    private var app: AppModel { .shared }
    @Bindable var workspace: WorkspaceModel
    var pane: FocusState<PaneFocus?>.Binding

    /// 키보드 커서. ↑↓는 커서만 옮기고 ⏎·클릭으로 적용한다(목록과 같은 정책). 화살표마다 저장소가 바뀌거나
    /// 목록을 다시 읽지 않게 하려는 것이다.
    @State private var cursor: SidebarItem?

    private var activeItem: SidebarItem {
        if let label = workspace.labelFilter { return .tag(label) }
        return workspace.scope == .trash ? .trash : .notes
    }

    private func apply(_ item: SidebarItem) {
        switch item {
        case .workspace(let id): app.switchWorkspace(to: id)
        case .notes: workspace.labelFilter = nil; workspace.scope = .notes
        case .trash: workspace.labelFilter = nil; workspace.scope = .trash
        case .tag(let name): workspace.labelFilter = name
        }
    }

    private func isActive(_ item: SidebarItem) -> Bool {
        if case .workspace(let id) = item { return id == workspace.workspace.id }
        return item == activeItem
    }

    /// 이미 보고 있는 저장소·보관함·태그를 다시 누르거나 ⏎를 누르면 새로 읽는다. 다른 항목은 기억해 둔 목록을 바로 보인다.
    private func choose(_ item: SidebarItem) {
        if isActive(item) {
            Task { await workspace.refresh(background: false) }
        } else {
            apply(item)
        }
    }

    /// 개수 배지(macOS 사이드바 기본 모양).
    private func countBadge(_ count: Int?) -> some View {
        Text(count.flatMap { $0 > 0 ? String($0) : nil } ?? "")
            .font(UIScale.font(12).monospacedDigit())
            .foregroundStyle(.secondary)
    }

    private func activeBackground(_ active: Bool) -> some View {
        RoundedRectangle(cornerRadius: 6)
            .fill(active ? Color.black.opacity(0.14) : .clear)
            .padding(.horizontal, 4)
    }

    var body: some View {
        List(selection: $cursor) {
            Section("저장소") {
                ForEach(Array(app.settings.workspaces.enumerated()), id: \.element.id) { index, item in
                    HStack(spacing: 8) {
                        AvatarView(owner: item.owner, size: UIScale.size(18))
                        // 표시 이름 아래에 저장소 주소를 둔다(웹 WorkspaceSwitcher).
                        VStack(alignment: .leading, spacing: 0) {
                            Text(item.title).lineLimit(1).truncationMode(.middle)
                            if item.title != item.repo {
                                Text(item.repo).font(UIScale.font(10)).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
                            }
                        }
                        Spacer(minLength: 4)
                        countBadge(app.workspaceNoteCounts[item.id])
                        if index < 9 {
                            Text("⌘\(index + 1)").font(UIScale.font(10)).foregroundStyle(.tertiary)
                        }
                    }
                    .tag(SidebarItem.workspace(item.id))
                    .listRowBackground(activeBackground(item.id == workspace.workspace.id))
                    .help(item.repo)
                }
            }
            Section("보관함") {
                HStack { Label("노트", systemImage: "note.text"); Spacer(); countBadge(workspace.counts?.notes) }
                    .tag(SidebarItem.notes)
                    .listRowBackground(activeBackground(activeItem == .notes))
                HStack { Label("휴지통", systemImage: "trash"); Spacer(); countBadge(workspace.counts?.trash) }
                    .tag(SidebarItem.trash)
                    .listRowBackground(activeBackground(activeItem == .trash))
                    .help("휴지통에는 지난 30일 동안 옮긴 노트만 보입니다.")
            }
            if !workspace.visibleLabels.isEmpty {
                Section("태그") {
                    ForEach(workspace.visibleLabels, id: \.name) { label in
                        HStack {
                            Label {
                                Text(label.name).lineLimit(1)
                            } icon: {
                                Circle().fill(Color(hex: TagColor.hex(for: label.name))).frame(width: UIScale.size(9), height: UIScale.size(9))
                            }
                            Spacer()
                            countBadge(workspace.counts?.labels[label.name])
                        }
                        .tag(SidebarItem.tag(label.name))
                        .listRowBackground(activeBackground(activeItem == .tag(label.name)))
                        .help(label.description ?? label.name)
                    }
                }
            }
        }
        .onAppear { ListKeyboard.markMoved(); cursor = activeItem; app.loadOtherWorkspaceCounts() }
        // 클릭은 바로 적용한다. ↑↓로 옮긴 커서는 ⏎를 기다린다.
        .onChange(of: cursor) { _, item in
            DebugTrace.log("sidebar cursor \(String(describing: item)) keyboard=\(ListKeyboard.movedRecently)")
            guard !ListKeyboard.movedRecently, let item else { return }
            apply(item)
        }
        .onChange(of: activeItem) { _, item in
            // 다른 곳(태그 칩, 검색 등)에서 바뀐 필터를 커서에도 반영한다.
            if case .workspace = cursor { return }
            if cursor != item { ListKeyboard.markMoved(); cursor = item }
        }
        .onKeyPress(.return) {
            if let cursor { choose(cursor) }
            return .handled
        }
        // 이미 선택된 줄을 다시 누르면 목록 선택이 바뀌지 않아 위 onChange가 오지 않는다. 마우스 이벤트에서 알아낸다
        // (ListKeyboard). 줄마다 탭 제스처를 달면 macOS 목록의 선택 처리가 막혀 선택 표시가 따라오지 않는다.
        .onReceive(NotificationCenter.default.publisher(for: ListKeyboard.sidebarReclick)) { _ in
            if let cursor { choose(cursor) }
        }
        .listStyle(.sidebar)
        .font(UIScale.font(13))
        .focused(pane, equals: .sidebar)
        // →: 목록으로. 커서가 없으면 열린 노트(없으면 첫 노트)에 둔다.
        .onKeyPress(.rightArrow) {
            pane.wrappedValue = .list
            if workspace.selection.isEmpty, let id = workspace.openedId ?? workspace.displayedIssues.first?.id {
                ListKeyboard.markMoved()
                workspace.selection = [id]
            }
            return .handled
        }
        .safeAreaInset(edge: .bottom) {
            ProfileSettingsButton(login: workspace.user?.login)
        }
    }
}

struct AvatarView: View {
    let owner: String
    let size: CGFloat

    var body: some View {
        AsyncImage(url: SystemActions.avatarURL(owner: owner, size: Int(size * 2))) { image in
            image.resizable()
        } placeholder: {
            Image(systemName: "person.crop.circle").resizable().foregroundStyle(.secondary)
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
    }
}

extension Color {
    init(hex: String) {
        let value = UInt32(hex.trimmingCharacters(in: CharacterSet(charactersIn: "#")), radix: 16) ?? 0x888888
        self.init(.sRGB, red: Double((value >> 16) & 0xff) / 255, green: Double((value >> 8) & 0xff) / 255,
                  blue: Double(value & 0xff) / 255)
    }
}

/// 사이드바 맨 아래 프로필. 사진·이름·톱니바퀴 블록 전체가 설정을 연다.
struct ProfileSettingsButton: View {
    @Environment(\.openSettings) private var openSettings
    let login: String?
    @State var hovering = false

    var body: some View {
        Button {
            AppModel.shared.settingsTab = .general
            SystemActions.openSettings(openSettings)
        } label: {
            HStack(spacing: 6) {
                if let login {
                    AvatarView(owner: login, size: UIScale.size(16))
                    Text(login).font(UIScale.font(11)).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer()
                Image(systemName: "gearshape").font(UIScale.font(13)).foregroundStyle(.secondary)
            }
            .padding(.horizontal, 8).padding(.vertical, 6)
            .background(RoundedRectangle(cornerRadius: 6).fill(Color.secondary.opacity(hovering ? 0.12 : 0)))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .help("설정 (⌘,)")
        .padding(.horizontal, 6).padding(.vertical, 4)
    }
}
