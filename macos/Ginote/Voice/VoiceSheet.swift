import AppKit
import GinoteCore
import SwiftUI

/// 음성 기록을 어디로 보낼지. 웹과 같은 네 가지다.
struct VoiceRequest: Identifiable {
    enum Target { case newNote, body, newComment, comment(CommentItem) }
    let id = UUID()
    let target: Target
    let workspace: WorkspaceModel
    let session: NoteSession?
}

@MainActor
enum VoiceLauncher {
    typealias Target = VoiceRequest.Target

    static func start(_ target: Target, workspace: WorkspaceModel) {
        AppModel.shared.voiceRequest = VoiceRequest(target: target, workspace: workspace, session: nil)
    }

    static func start(_ target: Target, session: NoteSession) {
        AppModel.shared.voiceRequest = VoiceRequest(target: target, workspace: session.workspace, session: session)
    }
}

/// 녹음 → 전사 → 정제 → 노트에 넣기.
struct VoiceSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openSettings) private var openSettings
    let request: VoiceRequest
    @State private var recorder = VoiceRecorder()
    @State private var phase: Phase = .recording
    @State private var audio: Data?
    /// 키보드 포커스는 완료 버튼에 둔다(닫기·일시정지 버튼은 포커스를 받지 않는다).
    @FocusState private var doneFocused: Bool

    enum Phase: Equatable { case recording, transcribing, refining, delivering, failed(String) }
    /// 처리 단계를 한 번 다시 시도하는 중이면 그 안내(웹 "…에 실패해 한 번 더 시도하는 중…").
    @State private var retryNotice: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Label(title, systemImage: "mic.fill").font(.headline)
                Spacer()
                Button { close() } label: { Image(systemName: "xmark") }
                    .disabled(processing)
                    .buttonStyle(.borderless)
                    .focusable(false)
                    .keyboardShortcut(.cancelAction)
            }
            if app.openAIKey.isEmpty {
                missingKey
            } else {
                content
            }
        }
        .padding(20)
        .frame(width: 460)
        .interactiveDismissDisabled()
        .task {
            guard !app.openAIKey.isEmpty else { return }
            recorder.onLimitReached = { finish() }
            await request.workspace.voiceHints.load()
            await recorder.start()
        }
    }

    private var title: String {
        switch request.target {
        case .newNote: return String(localized: "음성으로 새 노트")
        case .body: return String(localized: "음성을 본문에 추가")
        case .newComment: return String(localized: "음성으로 기록 추가")
        case .comment: return String(localized: "음성을 기록에 추가")
        }
    }

    private var missingKey: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("음성 녹음을 사용하려면 OpenAI API 키를 발급한 뒤 설정의 음성 탭에 입력하세요.")
            HStack {
                Spacer()
                Button("설정 열기") {
                    AppModel.shared.settingsTab = .voice
                    AppModel.shared.voiceAfterSettings = request
                    openSettings()
                    dismiss()
                }
                    .keyboardShortcut(.defaultAction)
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch phase {
        case .recording:
            switch recorder.state {
            case .denied:
                Text("마이크 권한이 없습니다. 시스템 설정 → 개인정보 보호 및 보안 → 마이크에서 Ginote Native를 허용하세요.")
                    .foregroundStyle(.red)
            case .failed(let message):
                Text(message).foregroundStyle(.red)
            default:
                // 녹음 상태를 글로도 알린다(웹 VoiceRecorder status).
                Text(recorderStatus).font(.callout).foregroundStyle(.secondary)
                Waveform(levels: recorder.levels, active: recorder.state == .recording)
                    .frame(height: 64)
                HStack {
                    Button { recorder.togglePause() } label: {
                        Image(systemName: recorder.state == .paused ? "record.circle" : "pause.circle")
                            .font(.system(size: 28))
                            .foregroundStyle(recorder.state == .paused ? .red : .primary)
                    }
                    .buttonStyle(.plain)
                    .focusable(false)
                    .help(recorder.state == .paused ? "이어서 녹음" : "일시정지")
                    Text(timeText).font(.title3.monospacedDigit())
                    Spacer()
                    Button("완료") { finish() }
                        .keyboardShortcut(.defaultAction)
                        .disabled(!recorder.hasAudio)
                        .focused($doneFocused)
                        .onChange(of: recorder.hasAudio) { _, ready in if ready { doneFocused = true } }
                }
            }
        case .transcribing:
            ProgressView("전사하는 중…")
            if let retryNotice { Text(retryNotice).font(.callout).foregroundStyle(.secondary) }
        case .refining:
            ProgressView("다듬는 중…")
            if let retryNotice { Text(retryNotice).font(.callout).foregroundStyle(.secondary) }
        case .delivering:
            ProgressView("노트에 넣는 중…")
        case .failed(let message):
            VStack(alignment: .leading, spacing: 10) {
                Text(message).foregroundStyle(.red)
                HStack {
                    Button("원본 음성 저장…") { saveAudio() }
                    Spacer()
                    Button("다시 시도") { Task { await process() } }.keyboardShortcut(.defaultAction)
                }
            }
        }
    }

    private var timeText: String {
        let seconds = Int(recorder.elapsed)
        return String(format: "%02d:%02d", seconds / 60, seconds % 60)
    }

    private func finish() {
        guard phase == .recording else { return }
        audio = recorder.finish()
        Task { await process() }
    }

    private var processing: Bool { [.transcribing, .refining, .delivering].contains(phase) }

    private func close() {
        // 처리 중에는 닫지 않는다. 실패한 뒤에는 녹음이 사라지므로 묻는다(웹과 같음).
        guard !processing else { return }
        let failed: Bool = { if case .failed = phase { return true }; return false }()
        guard failed || (phase == .recording && recorder.hasAudio) else { recorder.discard(); dismiss(); return }
        Task {
            if await Dialogs.confirm(String(localized: "기록하지 않은 녹음을 전부 취소하시겠습니까?"), confirmTitle: String(localized: "녹음 취소"), destructive: true) {
                recorder.discard()
                dismiss()
            }
        }
    }

    private func saveAudio() {
        guard let audio else { return }
        let panel = NSSavePanel()
        panel.nameFieldStringValue = VoiceNotes.audioFileName()
        if panel.runModal() == .OK, let url = panel.url { try? audio.write(to: url) }
    }

    private var recorderStatus: String {
        switch recorder.state {
        case .idle, .preparing: return String(localized: "녹음을 시작하는 중…")
        case .recording: return String(localized: "녹음 중")
        case .paused: return String(localized: "재개하시거나 완료하세요.")
        default: return ""
        }
    }

    /// 각 단계는 한 번 다시 시도하고, 그동안 다시 시도한다고 알린다.
    private func retrying<T>(_ label: String, _ work: () async throws -> T) async throws -> T {
        retryNotice = nil
        do { return try await work() } catch {
            retryNotice = String(localized: "\(label)에 실패해 한 번 더 시도하는 중…")
            defer { retryNotice = nil }
            return try await work()
        }
    }

    private func process() async {
        guard let audio else { return }
        let client = OpenAIVoiceClient(apiKey: app.openAIKey)
        let voice = app.settings.voice
        let workspace = request.workspace
        do {
            phase = .transcribing
            let transcript = try await retrying(String(localized: "음성 전사")) {
                try await client.transcribe(audio: audio, fileName: "recording.m4a", mimeType: "audio/mp4",
                                            model: voice.transcriptionModel,
                                            language: Locale.preferredLanguages.first,
                                            hints: workspace.voiceHints.value)
            }
            guard !transcript.isEmpty else { throw GitHubError(status: 0, message: String(localized: "음성에서 텍스트를 찾지 못했습니다.")) }
            var refinement = OpenAIVoiceClient.Refinement(title: "", body: transcript, tags: [])
            if !voice.refinementModel.isEmpty {
                phase = .refining
                let tags = workspace.visibleLabels.map { OpenAIVoiceClient.TagCandidate(name: $0.name, description: $0.description ?? "") }
                refinement = try await retrying(String(localized: "텍스트 정제")) {
                    try await client.refine(transcript: transcript, rules: voice.refinementPrompt, model: voice.refinementModel, tags: tags)
                }
            }
            let knownTags = VoiceNotes.knownTagNames(refinement.tags, labels: workspace.visibleLabels.map(\.name))
            if VoiceNotes.normalizeParagraphs(refinement.body).isEmpty && knownTags.isEmpty {
                throw GitHubError(status: 0, message: String(localized: "정제된 텍스트와 선택된 태그가 모두 비어 있습니다."))
            }
            phase = .delivering
            try await VoiceDelivery.deliver(
                body: VoiceNotes.normalizeParagraphs(refinement.body),
                tags: VoiceNotes.knownTagNames(refinement.tags, labels: workspace.visibleLabels.map(\.name)),
                suggestedTitle: VoiceNotes.normalizeSuggestedTitle(refinement.title),
                audio: voice.preserveOriginalAudio ? audio : nil,
                request: request)
            recorder.discard()
            dismiss()
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }
}

@MainActor
enum VoiceDelivery {
    static func deliver(body: String, tags: [String], suggestedTitle: String, audio: Data?, request: VoiceRequest) async throws {
        let workspace = request.workspace
        let client = workspace.client
        let fileName = VoiceNotes.audioFileName()

        // 원본 음성 보존을 켰는데 올리지 못하면 단계 전체를 실패로 돌려 내려받기를 권한다(웹과 같음).
        func uploadAudio(_ number: Int) async throws -> GitHubClient.UploadedAttachment? {
            guard let audio else { return nil }
            return try await client.uploadAttachment(issueNumber: number, fileName: fileName, type: "audio/mp4", data: audio)
        }

        switch request.target {
        case .newNote:
            let composed = VoiceNotes.composeIssue(titleMode: workspace.preferences.titleMode, body: body, suggestedTitle: suggestedTitle)
            try await workspace.ensureLabels(tags)
            let created = try await client.createIssue(NoteDraft(title: composed.title, body: composed.body, labels: tags))
            _ = try await uploadAudio(created.number)
            workspace.insertCreated(created)

        case .body:
            guard let session = request.session, let number = session.number else { return }
            let uploaded = try await uploadAudio(number)
            session.appendVoice(body, tags: tags)
            if uploaded != nil { await session.attachments.load() }
            session.saveNow()

        case .newComment:
            guard let session = request.session, let number = session.number else { return }
            if !tags.isEmpty { session.appendVoice("", tags: tags); session.saveNow() }
            let uploaded = try await uploadAudio(number)
            guard !body.isEmpty || uploaded != nil else { return }
            await session.comments.createVoiceComment(text: body, audioLink: uploaded.map { VoiceNotes.audioLink(repo: session.repo, path: $0.path) })

        case .comment(let item):
            guard let session = request.session, let number = session.number else { return }
            if !tags.isEmpty { session.appendVoice("", tags: tags); session.saveNow() }
            let uploaded = try await uploadAudio(number)
            await session.comments.appendVoice(body, audio: uploaded.map { VoiceNotes.audioLink(repo: session.repo, path: $0.path) }, to: item)
        }
    }
}

struct Waveform: View {
    let levels: [Float]
    let active: Bool

    var body: some View {
        Canvas { context, size in
            let count = 120
            let width = size.width / CGFloat(count)
            let padded = Array(repeating: Float(0), count: max(0, count - levels.count)) + levels.suffix(count)
            for (index, level) in padded.enumerated() {
                let height = max(2, CGFloat(level) * size.height)
                let rect = CGRect(x: CGFloat(index) * width, y: (size.height - height) / 2, width: max(1, width - 1), height: height)
                context.fill(Path(roundedRect: rect, cornerRadius: 1), with: .color(active ? .red : .secondary))
            }
        }
    }
}

/// 저장소별 "자주 쓰는 전사 단어". 저장소에 두어 다른 기기와 함께 쓰고, 고친 값은 올릴 때까지 이 Mac에 둔다.
@MainActor
@Observable
final class VoiceHints {
    private(set) var value = ""
    private(set) var loadedRepo = ""
    private(set) var loading = false
    private(set) var saving = false
    var errorMessage: String?
    unowned let workspace: WorkspaceModel

    init(workspace: WorkspaceModel) { self.workspace = workspace }

    func load(force: Bool = false) async {
        let repo = workspace.repo
        if !force && loadedRepo == repo { return }
        if let pending = workspace.app.localState.pendingVoiceHints(repo: repo) {
            value = pending
            loadedRepo = repo
            return
        }
        loading = true
        defer { loading = false }
        do {
            value = try await workspace.client.loadVoiceHints()
            loadedRepo = repo
        } catch {
            errorMessage = String(localized: "전사 단어를 불러오지 못했습니다.")
        }
    }

    func stage(_ text: String) {
        value = text
        workspace.app.localState.setPendingVoiceHints(repo: workspace.repo, text)
    }

    func flush() async {
        let repo = workspace.repo
        guard !saving, let pending = workspace.app.localState.pendingVoiceHints(repo: repo) else { return }
        saving = true
        defer { saving = false }
        do {
            _ = try await workspace.client.saveVoiceHints(pending)
            workspace.app.localState.setPendingVoiceHints(repo: repo, nil)
            loadedRepo = repo
        } catch {
            errorMessage = String(localized: "전사 단어를 저장하지 못했습니다.")
        }
    }
}
