import AVKit
import CryptoKit
import GinoteCore
import SwiftUI

/// 본문 아래의 기록(댓글) 영역(웹 note-comments-section). 구분선 아래로 시간순 기록이 이어지고,
/// 맨 아래에 기록 추가·음성 추가가 있다. 미리보기 중에는 기록을 Markdown으로 그리고 추가 버튼을 숨긴다.
struct CommentsSection: View {
    @Bindable var session: NoteSession
    @Bindable var store: CommentStore
    var rendered = false
    var readOnly = false
    var maxWidth: CGFloat = 840

    private var canAdd: Bool { session.isEditable && !readOnly && !rendered && session.number != nil }
    /// 아직 기록을 받지 못했고 GitHub가 기록이 있다고 알려 준 동안. 그 수만큼(최대 3개) 자리표시를 보인다.
    private var loadingFirst: Bool { !store.loaded && store.items.isEmpty && (session.issue?.comments ?? 0) > 0 }

    var body: some View {
        if session.lockState != .locked, loadingFirst || !store.items.isEmpty || canAdd {
            VStack(alignment: .leading, spacing: 0) {
                Divider()
                if loadingFirst {
                    ForEach(0..<min(session.issue?.comments ?? 0, 3), id: \.self) { index in
                        if index > 0 { Divider().opacity(0.5) }
                        CommentSkeleton(seed: index)
                    }
                }
                ForEach(Array(store.items.enumerated()), id: \.element.id) { index, item in
                    if index > 0 { Divider().opacity(0.5) }
                    CommentCard(session: session, store: store, item: item, rendered: rendered, readOnly: readOnly)
                }
                if let message = store.errorMessage {
                    Text(message).font(.caption).foregroundStyle(.red).padding(.vertical, 4)
                }
                if canAdd {
                    HStack {
                        Button { store.add() } label: { Label("기록 추가", systemImage: "plus") }
                        Spacer()
                        Button { VoiceLauncher.start(.newComment, session: session) } label: { Label("음성 추가", systemImage: "mic.fill") }
                            .voiceAvailability(AppModel.shared.openAIKey, help: String(localized: "음성 추가"))
                    }
                    .buttonStyle(.borderless)
                    .foregroundStyle(.secondary)
                    .font(UIScale.font(12))
                    .padding(.top, 10)
                }
            }
            .padding(.top, 10)
            .padding(.bottom, 24)
            // 기록을 받아 줄이 바뀔 때는 움직이지 않고 바로 바꾼다(움직이는 동안 줄끼리 겹쳐 보인다).
            .transaction { $0.animation = nil }
            .frame(maxWidth: maxWidth)
            .padding(.horizontal, 24)
            .frame(maxWidth: .infinity)
        }
    }
}

struct CommentCard: View {
    @Environment(\.undoManager) private var undoManager
    @Bindable var session: NoteSession
    @Bindable var store: CommentStore
    @Bindable var item: CommentItem
    var rendered = false
    var readOnly = false
    @FocusState private var focused: Bool
    @State private var choosingFiles = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Text(item.author).font(UIScale.font(11, weight: .semibold)).foregroundStyle(.secondary)
                Text(dateText).font(UIScale.font(11)).foregroundStyle(.tertiary)
                if item.saving { ProgressView().controlSize(.mini) }
                if item.saveFailed { Text("저장 실패").font(.caption).foregroundStyle(.red) }
                Spacer()
                if session.isEditable && !readOnly && !rendered && !item.deleting {
                    Menu {
                        // 키가 없으면 메뉴에서도 알린다(웹은 흐리게 표시). 누르면 키 안내 시트가 뜬다.
                        Button(AppModel.shared.openAIKey.isEmpty ? "음성 녹음 추가 (OpenAI 키 필요)" : "음성 녹음 추가") {
                            VoiceLauncher.start(.comment(item), session: session)
                        }
                            .disabled(item.remoteId == nil)
                        Button("파일 첨부…") { choosingFiles = true }
                            .disabled(item.remoteId == nil)
                        Divider()
                        Button("삭제", role: .destructive) { store.scheduleDelete(item, undoManager: undoManager) }
                    } label: { Image(systemName: "ellipsis") }
                    .menuStyle(.borderlessButton)
                    .menuIndicator(.hidden)
                    .foregroundStyle(.secondary)
                    .fixedSize()
                }
            }
            if rendered, item.lockedPayload == nil, !item.text.isEmpty {
                Text(Self.markdown(item.text))
                    .font(Self.noteFont)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
            ZStack(alignment: .topLeading) {
                if item.lockedPayload != nil {
                    Label("잠긴 기록", systemImage: "lock.fill").font(Self.noteFont).foregroundStyle(.secondary).padding(.top, 1)
                } else if item.text.isEmpty {
                    Text("기록을 입력하세요…").font(Self.noteFont).foregroundStyle(.tertiary).padding(.top, 1)
                }
                TextEditor(text: Binding(get: { item.text }, set: { store.edit(item, text: $0) }))
                    .font(Self.noteFont)
                    .scrollContentBackground(.hidden)
                    .scrollDisabled(true)
                    .frame(minHeight: 24)
                    // TextEditor 안쪽 여백만큼 당겨 메타 줄과 왼쪽을 맞춘다.
                    .padding(.horizontal, -5)
                    // 본문처럼 포커스가 없으면 조금 어둡게 한다(보는 중과 고치는 중을 구분).
                    .opacity(focused ? 1 : GinoteTextView.unfocusedAlpha)
                    .animation(.easeOut(duration: 0.15), value: focused)
                    .fixedSize(horizontal: false, vertical: true)
                    .focused($focused)
                    .disabled(!session.isEditable || readOnly || item.lockedPayload != nil || item.deleting)
                    .onChange(of: focused) { _, isFocused in
                        if !isFocused { Task { await store.save(item) } }
                    }
            }
            }
            ForEach(item.audioMarkup.flatMap(VoiceNotes.audioSources), id: \.self) { url in
                AudioAttachmentPlayer(session: session, rawURL: url)
            }
            if !item.attachments.isEmpty || !item.uploading.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(item.attachments) { attachment in
                            CommentAttachmentChip(session: session, store: store, item: item, attachment: attachment)
                        }
                        ForEach(item.uploading, id: \.self) { _ in ProgressView().controlSize(.small).frame(width: 44, height: 44) }
                    }
                }
            }
        }
        .padding(.vertical, 10)
        // 지우는 동안 카드 전체를 덮는다. GitHub에서 지우는 중에는 취소를 숨긴다(웹 comment-deletion-overlay).
        .overlay {
            if item.deleting {
                ZStack {
                    RoundedRectangle(cornerRadius: 6).fill(.regularMaterial)
                    HStack(spacing: 8) {
                        ProgressView().controlSize(.small)
                        Text("삭제 중…").font(UIScale.font(12, weight: .medium))
                        Button("취소") { store.cancelDelete(item) }
                            .controlSize(.small)
                            .opacity(item.deleteInFlight ? 0 : 1)
                            .disabled(item.deleteInFlight)
                    }
                }
            }
        }
        .background(GeometryReader { proxy in
            Color.clear.onAppear {
                guard !item.text.contains("\n"), item.attachments.isEmpty, item.audioMarkup.isEmpty else { return }
                CommentSkeleton.measured(proxy.size.height, scale: CGFloat(AppModel.shared.settings.preferences.uiScale))
            }
        })
        .fileImporter(isPresented: $choosingFiles, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
            if case .success(let urls) = result { Task { await store.addAttachments(urls, to: item) } }
        }
        .onAppear {
            guard store.focusedCommentId == item.localId else { return }
            store.focusedCommentId = nil
            // 본문 아래 기록 영역은 AppKit 문서 뷰 안에 있어 @FocusState로는 포커스가 가지 않는다.
            // 문서 뷰가 새로 생긴 빈 입력칸을 찾아 첫 응답자로 삼는다.
            NotificationCenter.default.post(name: NoteDocumentView.focusNewCommentNotification, object: nil)
        }
    }

    /// 기록도 본문과 같은 글꼴·크기로 쓴다(웹과 같음).
    static var noteFont: Font { Font(EditorStyle(AppModel.shared.settings.preferences).font) }

    /// 기록용 Markdown: 줄바꿈은 그대로 두고 강조·링크·코드를 그린다. 첨부 주소는 원래 주소로 편다.
    static func markdown(_ text: String) -> AttributedString {
        let options = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        let expanded = AttachmentLinks.expand(text, repo: AppModel.shared.workspace?.repo ?? "")
        return (try? AttributedString(markdown: expanded, options: options)) ?? AttributedString(text)
    }

    private var dateText: String {
        GitHubDate.parse(item.updatedAt).map { $0.formatted(date: .numeric, time: .shortened) } ?? ""
    }
}

struct CommentAttachmentChip: View {
    @Environment(\.undoManager) private var undoManager
    @Bindable var session: NoteSession
    @Bindable var store: CommentStore
    @Bindable var item: CommentItem
    let attachment: Attachment

    private var pending: Bool { item.pendingAttachmentDeletes[attachment.path] != nil }
    private var inFlight: Bool { item.deletingAttachmentPath == attachment.path }

    var body: some View {
        HStack(spacing: 6) {
            Text(attachment.name).font(.caption).lineLimit(1).opacity(pending ? 0.5 : 1)
            // 삭제 대기 중이면 칩에 바로 보인다(웹 AttachmentGrid의 삭제 중 덮개).
            if pending {
                ProgressView().controlSize(.mini)
                Text("삭제 중…").font(.caption2).foregroundStyle(.secondary)
                if !inFlight {
                    Button("취소") { store.cancelAttachmentDelete(attachment, in: item) }
                        .buttonStyle(.borderless).font(.caption2)
                }
            }
        }
            .padding(.horizontal, 8).padding(.vertical, 4)
            .background(Capsule().fill(Color.secondary.opacity(0.15)))
            .onTapGesture { QuickLook.show(items: item.attachments, start: attachment, session: session) }
            .contextMenu {
                Button("미리보기") { QuickLook.show(items: item.attachments, start: attachment, session: session) }
                Button("Markdown 복사") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(AttachmentLinks.composeLink(repo: session.repo, path: attachment.path, name: attachment.name, type: attachment.type), forType: .string)
                }
                if session.isEditable {
                    if item.pendingAttachmentDeletes[attachment.path] != nil {
                        Button("삭제 취소") { store.cancelAttachmentDelete(attachment, in: item) }
                    } else {
                        Button("삭제", role: .destructive) { store.scheduleAttachmentDelete(attachment, in: item, undoManager: undoManager) }
                    }
                }
            }
    }
}

/// 댓글에 붙은 원본 음성. 인증된 다운로드로 받아 재생한다.
struct AudioAttachmentPlayer: View {
    @Bindable var session: NoteSession
    let rawURL: String
    @State private var player: AVPlayer?
    @State private var failed = false

    var body: some View {
        Group {
            if let player {
                AudioPlayerBar(player: player).frame(height: 30)
            } else if failed {
                Text("원본 음성을 불러오지 못했습니다.").font(.caption).foregroundStyle(.red)
            } else {
                HStack { ProgressView().controlSize(.small); Text("원본 음성").font(.caption).foregroundStyle(.secondary) }
            }
        }
        .task(id: rawURL) {
            guard let path = CommentStore.path(fromRawURL: rawURL) else { failed = true; return }
            do {
                let data = try await session.workspace.client.downloadAttachment(path: path)
                let name = AttachmentLinks.displayName(fromPath: path)
                let url = await ThumbnailCache.shared.store(data, sha: "audio-" + SHA256.hash(data: Data(path.utf8)).map { String(format: "%02x", $0) }.joined(), name: name)
                player = AVPlayer(url: url)
            } catch {
                failed = true
            }
        }
    }
}

/// 맥 기본 재생 막대(AVPlayerView, 인라인 컨트롤).
struct AudioPlayerBar: NSViewRepresentable {
    let player: AVPlayer

    func makeNSView(context: Context) -> AVPlayerView {
        let view = AVPlayerView()
        view.controlsStyle = .inline
        view.showsFullScreenToggleButton = false
        view.player = player
        return view
    }

    func updateNSView(_ view: AVPlayerView, context: Context) {
        if view.player !== player { view.player = player }
    }
}

/// 기록을 불러오는 동안의 자리표시. 목록 스켈레톤(SkeletonRow)과 같은 막대·깜빡임을 쓴다.
struct CommentSkeleton: View {
    /// 실제 한 줄 기록의 높이(확대 1배 기준). 자리표시를 같은 높이로 잡아 기록이 오면 아래 줄이 튀지 않게 한다.
    /// 처음에는 어림값을 쓰고, 기록을 한 번 그리면 잰 값으로 바꾼다.
    @MainActor static var rowHeight: CGFloat = 64

    @MainActor static func measured(_ height: CGFloat, scale: CGFloat) {
        let unit = height / max(scale, 0.1)
        // 여러 줄 기록이 아니라 한 줄 기록의 높이를 쓴다.
        if unit > 30, unit < rowHeight || rowHeight == 64 { rowHeight = unit }
    }

    let seed: Int

    var body: some View {
        let scale = CGFloat(AppModel.shared.settings.preferences.uiScale)
        let widths: [CGFloat] = [340, 230, 290]
        // 깜빡임은 시계로 밝기만 계산한다. 암시적 반복 애니메이션은 처음 자리 잡는 이동까지 끝없이 되풀이해
        // 막대가 구분선 위로 올라가거나 사라진다.
        TimelineView(.animation(minimumInterval: 1.0 / 30)) { context in
            let phase = context.date.timeIntervalSinceReferenceDate / 1.8 * 2 * .pi - Double(seed) * 0.4
            VStack(alignment: .leading, spacing: 10 * scale) {
                bar(width: 130 * scale, height: 8 * scale)
                bar(width: widths[seed % widths.count] * scale, height: 11 * scale)
            }
            .opacity(0.725 + 0.275 * cos(phase))
        }
        .padding(.top, 14 * scale)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .frame(height: Self.rowHeight * scale, alignment: .top)
        .accessibilityHidden(true)
    }

    private func bar(width: CGFloat, height: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: height / 2)
            .fill(Color.secondary.opacity(0.22))
            .frame(maxWidth: width)
            .frame(height: height)
    }
}
