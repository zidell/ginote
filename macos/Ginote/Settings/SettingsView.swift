import AppKit
import GinoteCore
import SwiftUI

enum SettingsTab: String, Hashable { case general, editor, list, workspaces, voice, shortcuts }

/// 설정 창(⌘,). 바꾸는 즉시 반영하고 config.toml에 쓴다(macos/DESIGN.md §5.5).
struct SettingsView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        @Bindable var app = app
        TabView(selection: $app.settingsTab) {
            GeneralSettings().tabItem { Label("일반", systemImage: "gearshape") }.tag(SettingsTab.general)
            EditorSettings().tabItem { Label("편집기", systemImage: "textformat") }.tag(SettingsTab.editor)
            ListSettings().tabItem { Label("목록", systemImage: "list.bullet") }.tag(SettingsTab.list)
            WorkspaceSettings().tabItem { Label("저장소", systemImage: "externaldrive.connected.to.line.below") }.tag(SettingsTab.workspaces)
            VoiceSettingsView().tabItem { Label("음성", systemImage: "mic") }.tag(SettingsTab.voice)
            ShortcutSettings().tabItem { Label("단축키", systemImage: "keyboard") }.tag(SettingsTab.shortcuts)
        }
        .frame(width: 600)
        .frame(minHeight: 420)
    }
}

private func minutesLabel(_ minutes: Int) -> String {
    DurationText.minutes(minutes)
}

struct GeneralSettings: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        Form {
            Picker("테마", selection: binding(\.preferences.theme)) {
                Text("시스템 설정 따름").tag(Theme.system)
                Text("라이트").tag(Theme.light)
                Text("다크").tag(Theme.dark)
            }
            Stepper("자동 저장: 입력이 멈추고 \(app.settings.preferences.autoSaveSeconds)초 뒤",
                    value: binding(\.preferences.autoSaveSeconds), in: 3...30)
            Stepper("목록에서 한 번에 읽는 노트: \(app.settings.preferences.notesPerPage)개",
                    value: binding(\.preferences.notesPerPage), in: 10...100, step: 10)
            Picker("저장소 목록 기억", selection: binding(\.preferences.workspaceCacheMinutes)) {
                ForEach(Preferences.workspaceCacheOptions, id: \.self) { Text(minutesLabel($0)).tag($0) }
            }
            Text("※ 이 시간 안에 저장소로 돌아오면 마지막으로 보던 목록을 다시 보여줍니다.")
                .font(.caption).foregroundStyle(.secondary)
            Picker("잠금 숫자 기억", selection: binding(\.preferences.lockSessionMinutes)) {
                ForEach(Preferences.lockSessionOptions, id: \.self) { Text(minutesLabel($0)).tag($0) }
            }
            Text("※ 입력한 잠금 숫자를 이 시간 동안 다시 묻지 않고 씁니다. 시간이 지나면 잠긴 노트를 열 때 다시 입력해야 합니다.")
                .font(.caption).foregroundStyle(.secondary)
            Toggle("화면 잠금·잠자기 때 잠금 숫자 지우기", isOn: binding(\.preferences.clearLockOnSleep))
            Section {
                LabeledContent("설정 파일") {
                    Button("Finder에서 보기") { NSWorkspace.shared.activateFileViewerSelecting([app.configStore.configURL]) }
                }
                Text("언어는 시스템 설정 → 일반 → 언어 및 지역 → 앱별 언어에서 바꿉니다.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
    }

    private func binding<Value>(_ keyPath: WritableKeyPath<AppSettings, Value>) -> Binding<Value> {
        Binding { app.settings[keyPath: keyPath] } set: { value in app.updateSettings { $0[keyPath: keyPath] = value } }
    }
}

struct EditorSettings: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        Form {
            Picker("제목", selection: binding(\.preferences.titleMode)) {
                Text("첫 줄 50자를 제목으로").tag(TitleMode.firstLine)
                Text("제목을 따로 입력").tag(TitleMode.separate)
            }
            LabeledContent("글꼴") {
                HStack {
                    Picker("", selection: binding(\.preferences.editorFont)) {
                        Text("시스템").tag("system")
                        Text("세리프").tag("serif")
                        Text("고정폭").tag("mono")
                        let current = app.settings.preferences.editorFont
                        if !Preferences.fixedFonts.contains(current) {
                            Text(String(current.dropFirst(6))).tag(current)
                        }
                    }
                    .labelsHidden()
                    .frame(width: 180)
                    Button("다른 글꼴…") { FontChooser.shared.choose(current: EditorStyle(app.settings.preferences).font) { family in
                        app.updateSettings { $0.preferences.editorFont = "local:\(family)" }
                    } }
                }
            }
            Stepper("크기: \(app.settings.preferences.editorFontSize)pt", value: binding(\.preferences.editorFontSize), in: 12...32)
            LabeledContent("줄 간격: \(String(format: "%.1f", app.settings.preferences.editorLineHeight))") {
                Slider(value: binding(\.preferences.editorLineHeight), in: 1.2...2.5, step: 0.1).frame(width: 220)
            }
            LabeledContent("본문 최대 폭: \(app.settings.preferences.editorMaxWidth)pt") {
                Slider(value: Binding(get: { Double(app.settings.preferences.editorMaxWidth) },
                                      set: { value in app.updateSettings { $0.preferences.editorMaxWidth = Int(value / 10) * 10 } }),
                       in: 480...1600).frame(width: 220)
            }
        }
        .formStyle(.grouped)
    }

    private func binding<Value>(_ keyPath: WritableKeyPath<AppSettings, Value>) -> Binding<Value> {
        Binding { app.settings[keyPath: keyPath] } set: { value in app.updateSettings { $0[keyPath: keyPath] = value } }
    }
}

/// 시스템 글꼴 패널로 설치된 글꼴을 고른다.
@MainActor
final class FontChooser: NSObject, NSFontChanging {
    static let shared = FontChooser()
    private var onChoose: ((String) -> Void)?
    private var current = NSFont.systemFont(ofSize: 17)

    func choose(current: NSFont, onChoose: @escaping (String) -> Void) {
        self.current = current
        self.onChoose = onChoose
        let manager = NSFontManager.shared
        manager.target = self
        manager.setSelectedFont(current, isMultiple: false)
        manager.orderFrontFontPanel(nil)
    }

    nonisolated func changeFont(_ sender: NSFontManager?) {
        MainActor.assumeIsolated {
            guard let sender else { return }
            let font = sender.convert(current)
            current = font
            if let family = font.familyName { onChoose?(family) }
        }
    }

    nonisolated func validModesForFontPanel(_ fontPanel: NSFontPanel) -> NSFontPanel.ModeMask { [.collection, .face] }
}

struct ListSettings: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        Form {
            Section("목록의 각 줄에 보일 항목") {
                Toggle("제목", isOn: binding(\.preferences.listRow.title))
                Toggle("요약", isOn: binding(\.preferences.listRow.summary))
                Toggle("날짜와 번호", isOn: binding(\.preferences.listRow.meta))
                Toggle("태그", isOn: binding(\.preferences.listRow.tags))
            }
        }
        .formStyle(.grouped)
    }

    private func binding<Value>(_ keyPath: WritableKeyPath<AppSettings, Value>) -> Binding<Value> {
        Binding { app.settings[keyPath: keyPath] } set: { value in app.updateSettings { $0[keyPath: keyPath] = value } }
    }
}

struct WorkspaceSettings: View {
    private var selectedIndex: Int? { app.settings.workspaces.firstIndex { $0.id == selection } }

    @Environment(AppModel.self) private var app
    @State private var selection: String?
    /// 태그를 보이는 저장소. 태그는 저장소마다 따로라 고른 저장소의 것만 다룬다(없으면 지금 저장소).
    @State private var tagModel: WorkspaceModel?

    private var tagWorkspaceId: String? { selection ?? app.settings.activeWorkspace?.id }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // 표(Table)·목록(List) 대신 단순 세로 목록으로 그린다. 설정 탭을 넘길 때 SwiftUI 표와 목록이 한꺼번에
            // 바뀌며 앱이 죽는다(AppKitOutlineTableCoordinator, 2026-10-05 재현).
            HStack {
                Text("표시 이름").frame(maxWidth: .infinity, alignment: .leading)
                Text("저장소").frame(maxWidth: .infinity, alignment: .leading)
            }
            .font(.caption).foregroundStyle(.secondary)
            .padding(.horizontal, 8)
            ScrollView {
                VStack(spacing: 0) {
                    ForEach(app.settings.workspaces) { workspace in
                        HStack {
                            TextField(workspace.repo, text: Binding(get: { workspace.displayName }, set: { value in
                                app.updateSettings { settings in
                                    if let index = settings.workspaces.firstIndex(where: { $0.id == workspace.id }) {
                                        settings.workspaces[index].displayName = String(value.prefix(80))
                                    }
                                }
                            }))
                            .textFieldStyle(.plain)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            HStack {
                                Text(workspace.repo).lineLimit(1).truncationMode(.middle)
                                if workspace.id == app.settings.activeWorkspace?.id { Text("현재").font(.caption).foregroundStyle(.secondary) }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .padding(.horizontal, 8).padding(.vertical, 6)
                        .background(RoundedRectangle(cornerRadius: 5).fill(selection == workspace.id ? Color.accentColor.opacity(0.2) : .clear))
                        .contentShape(Rectangle())
                        .onTapGesture { selection = workspace.id }
                    }
                }
            }
            .frame(maxHeight: 150)
            .background(RoundedRectangle(cornerRadius: 6).fill(Color(nsColor: .controlBackgroundColor)))
            HStack {
                Button { app.showingAddWorkspace = true } label: { Image(systemName: "plus") }
                Button { Task { await disconnect() } } label: { Image(systemName: "minus") }
                    .disabled(selection == nil)
                Divider().frame(height: 16)
                // 맨 위·맨 아래면 끈다.
                Button("위로") { move(-1) }.disabled(selectedIndex.map { $0 == 0 } ?? true)
                Button("아래로") { move(1) }.disabled(selectedIndex.map { $0 == app.settings.workspaces.count - 1 } ?? true)
                Spacer()
                Button("열기") { if let selection { app.switchWorkspace(to: selection) } }.disabled(selection == nil)
                Button("토큰 바꾸기…") {
                    if let selection, let workspace = app.settings.workspaces.first(where: { $0.id == selection }) {
                        app.tokenPromptWorkspace = workspace
                    }
                }
                .disabled(selection == nil)
            }
            Divider().padding(.vertical, 4)
            if let tagModel {
                WorkspaceTags(workspace: tagModel)
                    .id(tagModel.workspace.id)
            } else {
                ContentUnavailableView("이 저장소의 토큰이 없어 태그를 읽을 수 없습니다", systemImage: "tag")
            }
        }
        .padding()
        .task(id: tagWorkspaceId) {
            tagModel = tagWorkspaceId.flatMap { app.model(forWorkspace: $0) }
            if let tagModel, tagModel.labels.isEmpty { await tagModel.loadLabels() }
        }
    }

    private func move(_ offset: Int) {
        guard let selection else { return }
        app.updateSettings { settings in
            guard let index = settings.workspaces.firstIndex(where: { $0.id == selection }) else { return }
            let target = index + offset
            guard settings.workspaces.indices.contains(target) else { return }
            settings.workspaces.swapAt(index, target)
        }
    }

    private func disconnect() async {
        guard let selection, let workspace = app.settings.workspaces.first(where: { $0.id == selection }) else { return }
        let confirmed = await Dialogs.confirm(String(localized: "\(workspace.repo) 연결을 해제할까요? 이 Mac에 저장된 토큰도 지웁니다. GitHub의 노트는 그대로 남습니다."),
                                              confirmTitle: String(localized: "연결 해제"), destructive: true)
        guard confirmed else { return }
        app.removeWorkspace(selection)
        self.selection = nil
    }
}

/// 저장소 하나의 태그(설정 → 저장소에서 고른 저장소).
struct WorkspaceTags: View {
    @Bindable var workspace: WorkspaceModel
    @State private var newTag = ""
    /// 마지막 안내. 성공은 초록, 오류는 빨강(웹 설정의 성공 안내 상자).
    @State private var notice: (text: String, isError: Bool)?
    @State private var busy = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
                Text("\(workspace.workspace.title)의 태그. ‘이름: 설명’ 형식으로 쓰면 설명이 음성 정제의 태그 분류에도 쓰입니다.")
                    .font(.caption).foregroundStyle(.secondary)
                HStack {
                    TextField("새 태그 (이름: 설명)", text: $newTag).onSubmit { Task { await add(workspace) } }
                    Button("추가") { Task { await add(workspace) } }.disabled(newTag.trimmingCharacters(in: .whitespaces).isEmpty || busy)
                }
                // List 대신 단순 세로 목록(위 저장소 탭 주석과 같은 이유).
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(workspace.visibleLabels, id: \.name) { label in
                            TagSettingsRow(workspace: workspace, label: label) { notice = ($0, $1) }
                                .padding(.horizontal, 8).padding(.vertical, 5)
                            Divider()
                        }
                    }
                }
                .background(RoundedRectangle(cornerRadius: 6).fill(Color(nsColor: .controlBackgroundColor)))
                if let notice { Text(notice.text).foregroundStyle(notice.isError ? .red : .green).font(.caption) }
        }
    }

    private func add(_ workspace: WorkspaceModel) async {
        busy = true
        defer { busy = false }
        do {
            let label = try await workspace.createLabel(definition: newTag)
            newTag = ""
            notice = (String(localized: "#\(label.name) 태그를 추가했습니다."), false)
        } catch {
            notice = (workspace.friendly(error), true)
        }
    }
}

struct TagSettingsRow: View {
    @Bindable var workspace: WorkspaceModel
    let label: GitHubLabel
    /// (안내, 오류인지)
    let report: (String, Bool) -> Void
    @State private var text = ""
    @State private var saving = false

    var body: some View {
        HStack {
            Circle().fill(Color(hex: TagColor.hex(for: label.name))).frame(width: 10, height: 10)
            TextField("", text: $text)
                .textFieldStyle(.plain)
                .onSubmit { Task { await rename() } }
            if saving { ProgressView().controlSize(.small) }
            Button(role: .destructive) { Task { await delete() } } label: { Image(systemName: "trash") }
                .buttonStyle(.borderless)
        }
        .onAppear { text = TagDefinition.format(name: label.name, description: label.description) }
    }

    private func rename() async {
        saving = true
        defer { saving = false }
        do {
            try await workspace.renameLabel(label, definition: text)
            let parsed = TagDefinition.parse(text, currentName: label.name)
            if parsed.name != label.name { report(String(localized: "#\(label.name) 태그 이름을 #\(parsed.name)로 바꿨습니다."), false) }
        } catch {
            report(workspace.friendly(error), true)
            text = TagDefinition.format(name: label.name, description: label.description)
        }
    }

    private func delete() async {
        guard await Dialogs.confirm(String(localized: "#\(label.name) 태그를 모든 노트에서 삭제할까요?"), confirmTitle: String(localized: "삭제"), destructive: true) else { return }
        do {
            try await workspace.deleteLabel(label)
            report(String(localized: "#\(label.name) 태그를 삭제했습니다."), false)
        } catch {
            report(workspace.friendly(error), true)
        }
    }
}

struct VoiceSettingsView: View {
    @Environment(AppModel.self) private var app
    @State private var keyInput = ""
    @State private var editingKey = false
    @State private var models = AppModel.shared.localState.voiceModelLists
    @State private var refreshing = false
    @State private var modelError: String?

    var body: some View {
        Form {
            Section("OpenAI") {
                if editingKey || app.openAIKey.isEmpty {
                    // 테두리 있는 입력칸으로 둔다. Form의 기본 입력칸은 테두리가 없어 칸이 있는지 알아보기 어렵다.
                    LabeledContent("API 키") {
                        HStack {
                            SecureField(text: $keyInput, prompt: Text(verbatim: "sk-…")) { Text("API 키") }
                                .labelsHidden()
                                .textFieldStyle(.roundedBorder)
                                .frame(width: 260)
                                .onSubmit { saveKey() }
                            Button("저장") { saveKey() }.disabled(keyInput.trimmingCharacters(in: .whitespaces).isEmpty)
                            if !app.openAIKey.isEmpty { Button("취소") { editingKey = false } }
                        }
                    }
                } else {
                    LabeledContent("API 키") {
                        HStack {
                            Text(VoicePresets.maskAPIKey(app.openAIKey)).font(.body.monospaced())
                            Button("바꾸기") { keyInput = ""; editingKey = true }
                            Button("지우기", role: .destructive) { app.openAIKey = ""; modelError = nil }
                        }
                    }
                }
                Text("키는 macOS 키체인에 둡니다. 음성과 전사문은 이 Mac에서 OpenAI로 바로 보냅니다.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Section("모델") {
                Picker("전사 모델", selection: binding(\.voice.transcriptionModel)) {
                    ForEach(withSelected(models.transcription, app.settings.voice.transcriptionModel), id: \.self) { Text($0).tag($0) }
                }
                Picker("정제 모델", selection: binding(\.voice.refinementModel)) {
                    Text("없음 (전사문 그대로)").tag("")
                    ForEach(withSelected(models.refinement, app.settings.voice.refinementModel), id: \.self) { Text($0).tag($0) }
                }
                HStack {
                    Button(refreshing ? "불러오는 중…" : "모델 목록 새로고침") { Task { await refreshModels() } }
                        .disabled(app.openAIKey.isEmpty || refreshing)
                    if let modelError { Text(modelError).foregroundStyle(.red).font(.caption) }
                }
            }
            if !app.settings.voice.refinementModel.isEmpty {
                Section("정제 규칙") {
                    HStack {
                        Button("약함") { setPrompt(VoicePresets.typoCorrectionPrompt) }
                        Button("중간") { setPrompt(VoicePresets.writtenStylePrompt) }
                        Button("강함") { setPrompt(VoicePresets.conclusionFocusedPrompt) }
                    }
                    TextEditor(text: Binding(get: { app.settings.voice.refinementPrompt },
                                             set: { value in app.updateSettings { $0.voice.refinementPrompt = String(value.prefix(1000)) } }))
                        .font(.callout)
                        .frame(minHeight: 140)
                }
            }
            Section {
                Toggle("원본 음성을 노트 첨부로 보존", isOn: binding(\.voice.preserveOriginalAudio))
            }
            if let workspace = app.workspace {
                Section("자주 쓰는 전사 단어 (\(workspace.workspace.title))") {
                    VoiceHintsEditor(hints: workspace.voiceHints)
                }
            }
        }
        .formStyle(.grouped)
    }

    private func withSelected(_ list: [String], _ selected: String) -> [String] {
        var models = list
        if !selected.isEmpty, !models.contains(selected), !VoicePresets.isDatedSnapshot(selected) { models.append(selected) }
        return models.sorted()
    }

    private func setPrompt(_ prompt: String) { app.updateSettings { $0.voice.refinementPrompt = prompt } }

    private func saveKey() {
        let key = keyInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !key.isEmpty else { return }
        app.openAIKey = key
        modelError = nil
        keyInput = ""
        editingKey = false
        Task { await refreshModels() }
    }

    private func refreshModels() async {
        refreshing = true
        defer { refreshing = false }
        do {
            let ids = try await OpenAIVoiceClient(apiKey: app.openAIKey).listModels()
            let classified = VoicePresets.classify(ids)
            models = LocalState.ModelLists(transcription: classified.transcription, refinement: classified.refinement)
            app.localState.voiceModelLists = models
            modelError = nil
        } catch {
            modelError = error.localizedDescription
        }
    }

    private func binding<Value>(_ keyPath: WritableKeyPath<AppSettings, Value>) -> Binding<Value> {
        Binding { app.settings[keyPath: keyPath] } set: { value in app.updateSettings { $0[keyPath: keyPath] = value } }
    }
}

struct VoiceHintsEditor: View {
    @Bindable var hints: VoiceHints
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            TextEditor(text: Binding(get: { hints.value }, set: { hints.stage(String($0.prefix(3000))) }))
                .font(.callout)
                .frame(minHeight: 70)
                .focused($focused)
                .onChange(of: focused) { _, isFocused in if !isFocused { Task { await hints.flush() } } }
            HStack {
                Text("고유명사·전문용어를 쉼표로 적으면 전사가 더 정확해집니다. 이 저장소를 쓰는 모든 기기가 같이 씁니다.")
                    .font(.caption).foregroundStyle(.secondary)
                if hints.saving || hints.loading { ProgressView().controlSize(.small) }
            }
            if let message = hints.errorMessage { Text(message).font(.caption).foregroundStyle(.red) }
        }
        .task { await hints.load(force: true) }
        .onDisappear { Task { await hints.flush() } }
    }
}
