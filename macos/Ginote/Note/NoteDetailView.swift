import GinoteCore
import SwiftUI

/// 오른쪽 칸(또는 별도 창)의 노트 하나.
struct NoteDetailView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.undoManager) private var undoManager
    @Bindable var session: NoteSession
    /// 여러 개를 고르는 중 마지막으로 누른 노트: 첨부·기록까지 읽기 전용으로 보인다(웹과 같음).
    var readOnly = false
    /// 따로 연 창처럼 처음부터 본문에 포커스를 둘 때.
    var focusOnAppear = false
    @State private var bodyText = ""
    @State private var focusRequest = 0
    @State private var showingTags = false
    @State private var showingReplace = false
    @State private var previewing = false
    /// 파일을 노트 위로 끌어 온 중(웹 is-dragging-files: 점선 테두리와 옅은 배경).
    @State private var dropTargeted = false
    @State private var editorDropTargeted = false

    private var preferences: Preferences { app.settings.preferences }
    private var showsPreview: Bool { previewing || readOnly }
    private var editable: Bool { session.isEditable && !readOnly }

    var body: some View {
        VStack(spacing: 0) {
            if let message = session.errorMessage { errorBanner(message) }
            header
            Divider().opacity(0.4)
            content
        }
        .overlay { deletionOverlay }
        .overlay {
            if (dropTargeted || editorDropTargeted) && editable {
                RoundedRectangle(cornerRadius: 10)
                    .strokeBorder(Color.accentColor, style: StrokeStyle(lineWidth: 2, dash: [6, 4]))
                    .background(RoundedRectangle(cornerRadius: 10).fill(Color.accentColor.opacity(0.06)))
                    .padding(8)
                    .allowsHitTesting(false)
            }
        }
        .navigationTitle(session.displayTitle)
        .navigationSubtitle(statusText)
        .toolbar { if !readOnly { toolbar } }
        // 노트 영역 어디에 놓아도 첨부한다(본문 편집기는 놓은 위치에 링크를 넣는다).
        .dropDestination(for: URL.self) { urls, _ in
            guard editable, !urls.isEmpty else { return false }
            session.addAttachments(urls.filter(\.isFileURL))
            return true
        } isTargeted: { dropTargeted = $0 }
        .focusedSceneValue(\.noteSession, readOnly ? nil : session)
        .focusedSceneValue(\.noteCommands, readOnly ? nil : NoteCommandHandlers(
            showTags: { showingTags = true },
            togglePreview: { previewing.toggle() },
            showReplace: { showingReplace = true },
            focusEditor: { focusRequest += 1 }))
        .onAppear {
            bodyText = session.body
            if app.pendingEditorFocus {
                app.pendingEditorFocus = false
                if session.lockState == .locked { session.lockPrompt = .unlock(message: nil) } else { focusRequest += 1 }
            }
            if focusOnAppear, session.lockState != .locked { focusRequest += 1 }
            else if session.isNew || session.issue?.body?.isEmpty == true { focusRequest += 1 }
        }
        .onChange(of: session.body) { _, value in if value != bodyText { bodyText = value } }
        .onChange(of: app.editorFocusRequest) { _, _ in
            if session.lockState == .locked { session.lockPrompt = .unlock(message: nil) } else { focusRequest += 1 }
        }
        .sheet(item: Binding(get: { session.lockPrompt.map(LockPromptItem.init) }, set: { if $0 == nil { session.lockPrompt = nil } })) { item in
            LockSheet(session: session, prompt: item.prompt)
        }
        .sheet(isPresented: $showingReplace) {
            ReplaceSheet(session: session)
        }
        .task(id: session.number) { await session.loadDetails() }
        .onDisappear { Task { await session.flush() } }
    }

    // MARK: - 위쪽: 제목, 태그

    @ViewBuilder
    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            if preferences.titleMode == .separate {
                TextField("제목", text: Binding(get: { session.title }, set: { session.edit(title: $0) }))
                    .textFieldStyle(.plain)
                    .font(.system(size: CGFloat(preferences.editorFontSize) * 1.4 * UIScale.value, weight: .bold))
                    .disabled(!editable)
            }
            // 미리보기 중에는 태그 ×/+와 첨부 추가·삭제를 숨긴다(웹과 같음).
            TagRowView(session: session, showingPicker: $showingTags, editable: editable && !showsPreview)
                .disabled(readOnly)
            if session.lockState != .locked {
                AttachmentStripView(store: session.attachments, editable: editable && !showsPreview) { session.chooseAttachments() }
                if let message = session.attachments.errorMessage {
                    HStack {
                        Text(message).font(.caption).foregroundStyle(.red)
                        Button { session.attachments.errorMessage = nil } label: { Image(systemName: "xmark") }.buttonStyle(.borderless)
                    }
                }
            }
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 10)
        .frame(maxWidth: CGFloat(preferences.editorMaxWidth) + 48, alignment: .leading)
        .frame(maxWidth: .infinity)
        // 잠금 노트(잠김·열림)는 머리 띠를 황금빛으로 칠해 일반 노트와 구분한다(웹 툴바 is-lock-protected).
        .background(session.lockState == .plain ? Color.clear : LockTint.band)
    }

    // MARK: - 본문

    @ViewBuilder
    private var content: some View {
        if session.lockState == .locked {
            LockedPlaceholder(session: session)
        } else if showsPreview {
            MarkdownPreview(markdown: AttachmentLinks.expand(session.body, repo: session.repo),
                            title: preferences.titleMode == .separate ? session.title : nil,
                            maxWidth: CGFloat(preferences.editorMaxWidth),
                            initialScrollRatio: session.scrollRatio,
                            onScroll: { session.scrollRatio = $0 },
                            footer: commentsFooter)
                .onExitCommand { previewing = false }
        } else {
            EditorTextView(
                text: $bodyText,
                style: EditorStyle(preferences),
                editable: session.isEditable,
                lockTinted: session.lockState != .plain,
                placeholder: preferences.titleMode == .firstLine ? String(localized: "첫 줄이 제목이 됩니다…") : String(localized: "내용을 입력하세요…"),
                focusRequest: focusRequest,
                onEdit: { text, composing in session.edit(body: text, composing: composing) },
                onBlur: { Task { await session.flush() } },
                onSaveShortcut: { session.saveNow() },
                onEscape: {
                    Task { await session.flush() }
                    app.listFocusRequest += 1
                },
                initialScrollRatio: session.scrollRatio,
                onScroll: { session.scrollRatio = $0 },
                onFiles: { urls in session.addAttachments(urls) },
                onImages: { images in session.addAttachments(images.compactMap { TemporaryFiles.write($0) }) },
                onDragTargeted: { editorDropTargeted = $0 },
                footer: commentsFooter
            )
        }
    }

    /// 본문 바로 아래에 붙는 기록(댓글). 웹과 같은 배치다.
    private var commentsFooter: AnyView {
        AnyView(CommentsSection(session: session, store: session.comments, rendered: showsPreview, readOnly: readOnly,
                                maxWidth: CGFloat(preferences.editorMaxWidth)))
    }

    /// 이 노트를 휴지통으로 옮기는 중이면 노트 전체를 덮는다. 보내는 중에는 취소를 숨긴다(웹과 같음).
    @ViewBuilder
    private var deletionOverlay: some View {
        if !readOnly, let id = session.issue?.id, let entry = session.workspace.trashEntry(for: id) {
            ZStack {
                Rectangle().fill(.regularMaterial)
                HStack(spacing: 10) {
                    ProgressView().controlSize(.small)
                    Text("삭제 중…").font(UIScale.font(13, weight: .medium))
                    Button("취소") { session.workspace.cancelTrash(entry: entry.id) }
                        .opacity(entry.inFlight ? 0 : 1)
                        .disabled(entry.inFlight)
                }
            }
        }
    }

    // MARK: - 툴바

    private var attachmentsFull: Bool { session.totalAttachmentCount >= AttachmentLinks.maxPerNote }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        // 미리보기 중에는 가운데에 닫기 버튼을 둔다(웹 "닫기 (M)").
        ToolbarItem(placement: .principal) {
            if previewing {
                Button { previewing = false } label: { Label("미리보기 닫기", systemImage: "xmark") .labelStyle(.titleAndIcon) }
                    .help("미리보기 닫기 (⇧⌘M)")
            }
        }
        ToolbarItemGroup(placement: .primaryAction) {
            // 올리는 중이거나 30개를 채우면 끈다(웹과 같음).
            Button { session.chooseAttachments() } label: { Label("첨부", systemImage: "paperclip") }
                .help(session.attachments.uploadingNames.isEmpty
                      ? (attachmentsFull ? String(localized: "노트당 첨부파일은 최대 \(AttachmentLinks.maxPerNote)개까지 추가할 수 있습니다.") : String(localized: "파일 첨부 (⇧⌘A)"))
                      : String(localized: "업로드 중 (\(session.attachments.uploadingNames.count)개)"))
                .disabled(!session.isEditable || !session.attachments.uploadingNames.isEmpty || attachmentsFull)
            Button { VoiceLauncher.start(.body, session: session) } label: { Label("음성 녹음", systemImage: "mic") }
                .voiceAvailability(app.openAIKey, help: String(localized: "음성 녹음 (⇧⌘E)"))
                .disabled(!session.isEditable || session.number == nil)
            Button { showingTags = true } label: { Label("태그", systemImage: "tag") }
                .help("태그 (⇧⌘T)")
                .disabled(!session.isEditable)
            Toggle(isOn: $previewing) { Label("미리보기", systemImage: "eye") }
                .toggleStyle(.button)
                .help("Markdown 미리보기 (⇧⌘M)")
                .disabled(session.lockState == .locked)
            Button { session.requestLock() } label: {
                Label(lockLabel, systemImage: session.lockState == .plain ? "lock.open" : session.lockState == .locked ? "lock.fill" : "lock.open.fill")
                    .foregroundStyle(session.lockState == .plain ? AnyShapeStyle(.primary) : AnyShapeStyle(LockTint.icon))
            }
            .help(lockLabel + " (⇧⌘L)")
            .disabled(session.isArchived)
            if let issue = session.issue, !session.isArchived {
                Button { Task { await session.workspace.togglePin(issue) } } label: {
                    Label(pinLabel, systemImage: session.isPinned ? "pin.fill" : "pin")
                }
                .help(pinLabel + " (⇧⌘P)")
                .disabled(session.workspace.pinMutation)
            }
            Menu {
                if let issue = session.issue {
                    Button("이슈 번호 복사") { NoteActions.copyIssueNumber(number: issue.number, title: NoteLock.removeLock(from: session.displayTitle)) }
                    Button("GitHub에서 보기") { NoteActions.openOnGitHub(issue, repo: session.repo) }
                    Button("찾아 바꾸기…") { showingReplace = true }.disabled(!session.isEditable)
                    Button("GitHub에서 다시 불러오기") { Task { await session.reloadFromGitHub() } }
                    Divider()
                    if session.isArchived {
                        Button("복원") { Task { await session.workspace.restore([issue], undoManager: undoManager) } }
                    } else {
                        Button("휴지통으로 이동", role: .destructive) { Task { await session.workspace.moveToTrash([issue], undoManager: undoManager) } }
                    }
                    Divider()
                    Text("만든 시각: \(dateText(issue.createdAt))")
                    Text("고친 시각: \(dateText(issue.updatedAt))")
                } else {
                    Text("번호를 받는 중…")
                }
            } label: {
                Label("더 보기", systemImage: "ellipsis.circle")
            }
        }
    }

    private var lockLabel: String {
        switch session.lockState {
        case .plain: return String(localized: "잠금")
        case .locked: return String(localized: "잠금 열기")
        case .unlocked: return String(localized: "잠금 풀기")
        }
    }

    private var pinLabel: String {
        session.isPinned ? String(localized: "고정 해제") : String(localized: "고정")
    }

    private var statusText: String {
        var parts: [String] = []
        if let number = session.number { parts.append("#\(number)") } else { parts.append(session.allocationFailed ? String(localized: "번호를 받지 못함") : String(localized: "새 노트")) }
        if let issue = session.issue { parts.append(String(localized: "수정 \(dateText(issue.updatedAt))")) }
        if session.isArchived || readOnly { parts.append(String(localized: "읽기만 가능")) }
        else if session.saving { parts.append(String(localized: "저장 중…")) }
        else if session.saveFailed { parts.append(String(localized: "저장 실패")) }
        else if session.dirty { parts.append(String(localized: "저장 대기")) }
        else if session.issue != nil { parts.append(String(localized: "저장됨")) }
        return parts.joined(separator: " · ")
    }

    private func dateText(_ value: String) -> String {
        GitHubDate.parse(value)?.formatted(date: .abbreviated, time: .shortened) ?? value
    }

    private func errorBanner(_ message: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
            Text(message).font(.callout)
            Spacer()
            if session.allocationFailed {
                Button("다시 시도") { session.allocate(pendingFiles: session.takePendingFiles()) }.controlSize(.small)
            }
            Button { session.errorMessage = nil } label: { Image(systemName: "xmark") }.buttonStyle(.borderless)
        }
        .padding(.horizontal, 14).padding(.vertical, 8)
        .background(Color.orange.opacity(0.12))
    }
}

struct LockPromptItem: Identifiable {
    let prompt: NoteSession.LockPrompt
    var id: String { "\(prompt)" }
}

/// 노트의 태그 칩과 선택기.
struct TagRowView: View {
    @Bindable var session: NoteSession
    @Binding var showingPicker: Bool
    /// 미리보기·읽기 전용이면 ×/+를 숨긴다.
    var editable = true

    var body: some View {
        HStack(spacing: 6) {
            ForEach(session.visibleLabels, id: \.self) { name in
                HStack(spacing: 3) {
                    Button("#\(name)") { session.workspace.labelFilter = name }
                        .buttonStyle(.plain)
                        .help("#\(name) 태그로 거르기")
                    if session.isEditable && editable {
                        Button {
                            session.setLabels(session.visibleLabels.filter { $0 != name }, saveNow: false)
                        } label: { Image(systemName: "xmark").font(UIScale.font(8, weight: .bold)) }
                        .buttonStyle(.plain)
                        .help("\(name) 태그 제거")
                    }
                }
                .font(UIScale.font(12))
                .padding(.horizontal, 7).padding(.vertical, 2)
                .background(Capsule().fill(Color(hex: TagColor.hex(for: name)).opacity(0.22)))
            }
            if session.isEditable && editable {
                Button { showingPicker = true } label: {
                    Label(session.visibleLabels.isEmpty ? "태그" : "", systemImage: "plus")
                        .labelStyle(.titleAndIcon)
                        .font(UIScale.font(12))
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .popover(isPresented: $showingPicker, arrowEdge: .bottom) {
                    TagPickerView(session: session).frame(width: 300, height: 340)
                }
            }
            Spacer()
        }
    }
}

/// 노트 태그 선택기. 최대 12개 후보, `이름: 설명`으로 새 태그 만들기.
struct TagPickerView: View {
    @Bindable var session: NoteSession
    @State private var search = ""
    @State private var errorMessage: String?
    @State private var busy = false
    @State private var highlighted = -1
    @FocusState private var focused: Bool

    private var matches: [GitHubLabel] {
        let term = search.trimmingCharacters(in: .whitespaces).drop { $0 == "#" }.lowercased()
        let name = TagDefinition.parse(String(term)).name.lowercased()
        let known = session.workspace.visibleLabels
        let extra = session.visibleLabels
            .filter { tag in !known.contains { LabelNames.same($0.name, tag) } }
            .map { GitHubLabel(name: $0) }
        return Array((known + extra).filter { name.isEmpty || $0.name.lowercased().contains(name) }.prefix(12))
    }

    private var newName: String { NoteText.normalizeTagName(TagDefinition.parse(search).name) }
    private var canCreate: Bool {
        !newName.isEmpty && !PinLabel.isPin(newName) && !session.workspace.visibleLabels.contains(where: { LabelNames.same($0.name, newName) })
    }
    /// ↑↓로 고를 수 있는 줄 수(후보 + "만들기").
    private var rowCount: Int { matches.count + (canCreate ? 1 : 0) }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            TextField("태그 검색 또는 ‘이름: 설명’으로 만들기", text: $search)
                .textFieldStyle(.roundedBorder)
                .focused($focused)
                .onSubmit { submit() }
                .onChange(of: search) { _, _ in highlighted = -1 }
                // 끝에서 처음으로 돈다(웹 TagPicker).
                .onKeyPress(.downArrow) { if rowCount > 0 { highlighted = (highlighted + 1) % rowCount }; return .handled }
                .onKeyPress(.upArrow) { if rowCount > 0 { highlighted = highlighted <= 0 ? rowCount - 1 : highlighted - 1 }; return .handled }
            List {
                ForEach(Array(matches.enumerated()), id: \.element.name) { index, label in
                    Button { toggle(label.name) } label: {
                        HStack {
                            Circle().fill(Color(hex: TagColor.hex(for: label.name))).frame(width: 8, height: 8)
                            Text("#\(label.name)")
                            if let description = label.description, !description.isEmpty {
                                Text(description).foregroundStyle(.secondary).lineLimit(1)
                            }
                            Spacer()
                            if session.visibleLabels.contains(where: { LabelNames.same($0, label.name) }) {
                                Image(systemName: "checkmark")
                            }
                        }
                        .padding(.horizontal, 4)
                        .background(RoundedRectangle(cornerRadius: 4).fill(index == highlighted ? Color.accentColor.opacity(0.25) : .clear))
                    }
                    .buttonStyle(.plain)
                }
                if canCreate {
                    Button { Task { await create() } } label: {
                        Text("#\(newName) 태그 만들기")
                            .padding(.horizontal, 4)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(RoundedRectangle(cornerRadius: 4).fill(highlighted == matches.count ? Color.accentColor.opacity(0.25) : .clear))
                    }
                    .buttonStyle(.plain)
                }
                if matches.isEmpty && !canCreate {
                    Text("추가할 태그가 없습니다.").foregroundStyle(.secondary)
                }
            }
            if let errorMessage { Text(errorMessage).foregroundStyle(.red).font(.caption) }
        }
        .padding(10)
        .disabled(busy)
        .onAppear { focused = true }
    }

    private func submit() {
        if matches.indices.contains(highlighted) { toggle(matches[highlighted].name); return }
        if canCreate, highlighted == matches.count { Task { await create() }; return }
        if let exact = session.workspace.visibleLabels.first(where: { LabelNames.same($0.name, newName) }) {
            toggle(exact.name)
        } else if !newName.isEmpty {
            Task { await create() }
        } else if let first = matches.first {
            toggle(first.name)
        }
    }

    private func toggle(_ name: String) {
        var names = session.visibleLabels
        if let index = names.firstIndex(where: { LabelNames.same($0, name) }) { names.remove(at: index) } else { names.append(name) }
        session.setLabels(names, saveNow: true)
        search = ""
        focused = true
    }

    private func create() async {
        busy = true
        defer { busy = false }
        do {
            let label = try await session.workspace.createLabel(definition: search)
            toggle(label.name)
        } catch {
            errorMessage = session.workspace.friendly(error)
        }
    }
}

/// 잠긴 노트 자리.
/// 잠금 노트 색(웹 --ui-lock 황금빛).
enum LockTint {
    static let icon = Color(nsColor: .systemOrange)
    /// 머리 띠(웹 툴바와 같은 12%).
    static let band = Color(nsColor: .systemOrange).opacity(0.12)
    /// 본문 배경(읽는 중). 편집 중에는 편집 배경에 같은 빛을 섞는다.
    static let body = NSColor.systemOrange.withAlphaComponent(0.06)
}

struct LockedPlaceholder: View {
    @Bindable var session: NoteSession

    var body: some View {
        placeholder
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color(nsColor: LockTint.body))
    }

    @ViewBuilder
    private var placeholder: some View {
        VStack(spacing: 12) {
            Image(systemName: "lock.fill").font(.system(size: 40)).foregroundStyle(.secondary)
            if session.reusingPin {
                ProgressView("기억한 숫자로 여는 중…")
            } else {
                Text("잠긴 노트").font(.title3)
                Button("잠금 열기…") { session.lockPrompt = .unlock(message: nil) }
                    .keyboardShortcut(.defaultAction)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

extension View {
    /// OpenAI 키가 없으면 음성 버튼을 흐리게 하고 키 안내를 툴팁으로 단다(누르면 키 안내 시트가 뜬다).
    func voiceAvailability(_ key: String, help: String) -> some View {
        let missing = key.trimmingCharacters(in: .whitespaces).isEmpty
        return self
            .opacity(missing ? 0.3 : 1)
            .help(missing ? String(localized: "OpenAI API 키가 없습니다. 설정 → 음성에서 입력하세요.") : help)
    }
}
