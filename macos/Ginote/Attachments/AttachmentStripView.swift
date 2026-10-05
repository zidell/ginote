import AppKit
import GinoteCore
import Quartz
import SwiftUI

/// 노트 위쪽의 첨부 썸네일 줄. Space·더블클릭은 Quick Look, 우클릭은 복사·본문삽입·내려받기·삭제.
struct AttachmentStripView: View {
    @Environment(\.undoManager) private var undoManager
    @Bindable var store: AttachmentStore
    var editable: Bool
    var onAdd: () -> Void

    /// 처음 읽는 동안에는 본문에 첨부 링크가 있을 때만(첨부가 있을 게 확실할 때만) 같은 크기의 빈 칸을
    /// 그려 둔다. 첨부 없는 노트에서 스피너·추가 칸이 떴다 사라지지 않게 하려는 것이다.
    private var placeholderCount: Int {
        guard !store.loaded, store.items.isEmpty, store.session.lockState != .locked else { return 0 }
        return min(store.session.expectedAttachmentCount, 6)
    }

    var body: some View {
        if !store.items.isEmpty || !store.uploadingNames.isEmpty || placeholderCount > 0 {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(store.items) { item in
                        AttachmentTile(store: store, item: item, editable: editable)
                    }
                    ForEach(Array(store.uploadingNames.enumerated()), id: \.offset) { _, name in
                        VStack(spacing: 4) {
                            ProgressView().controlSize(.small).frame(width: UIScale.size(64), height: UIScale.size(64))
                                .background(RoundedRectangle(cornerRadius: 8).fill(Color.secondary.opacity(0.12)))
                            Text(name).font(UIScale.font(10)).lineLimit(1).frame(width: UIScale.size(72))
                        }
                    }
                    ForEach(0..<placeholderCount, id: \.self) { _ in
                        VStack(spacing: 4) {
                            RoundedRectangle(cornerRadius: 8).fill(Color.secondary.opacity(0.12)).frame(width: UIScale.size(64), height: UIScale.size(64))
                            Text(" ").font(UIScale.font(10)).frame(width: UIScale.size(72))
                        }
                    }
                    // 30개를 채우면 추가 칸을 숨긴다(웹과 같음).
                    if editable, store.session.totalAttachmentCount < AttachmentLinks.maxPerNote {
                        // 썸네일 칸과 같은 틀(64pt 칸 + 이름 줄)로 맞춘다.
                        Button(action: onAdd) {
                            VStack(spacing: 4) {
                                Image(systemName: "plus")
                                    .frame(width: UIScale.size(64), height: UIScale.size(64))
                                    .background(RoundedRectangle(cornerRadius: 8).strokeBorder(style: StrokeStyle(lineWidth: 1, dash: [4])).foregroundStyle(.tertiary))
                                Text("추가").font(UIScale.font(10)).foregroundStyle(.secondary).frame(width: UIScale.size(72))
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .help("파일 첨부 (⇧⌘A)")
                    }
                }
                .padding(.vertical, 2)
            }
            if !store.uploadingNames.isEmpty {
                Text("업로드 중 (\(store.uploadingNames.count)개)").font(.caption).foregroundStyle(.secondary)
            }
        }
    }
}

struct AttachmentTile: View {
    @Environment(\.undoManager) private var undoManager
    @Bindable var store: AttachmentStore
    let item: Attachment
    let editable: Bool
    @State private var thumbnail: NSImage?

    private var pending: Bool { store.pendingDeletes[item.path] != nil }

    var body: some View {
        VStack(spacing: 4) {
            ZStack {
                RoundedRectangle(cornerRadius: 8).fill(Color.secondary.opacity(0.12))
                if let thumbnail {
                    Image(nsImage: thumbnail).resizable().scaledToFill()
                } else if item.isImage {
                    ProgressView().controlSize(.small)
                } else {
                    Image(nsImage: NSWorkspace.shared.icon(for: .init(filenameExtension: (item.name as NSString).pathExtension) ?? .data))
                        .resizable().frame(width: UIScale.size(36), height: UIScale.size(36))
                }
                if pending || store.deletingPath == item.path {
                    Color.black.opacity(0.55)
                    VStack(spacing: 3) {
                        ProgressView().controlSize(.mini).tint(.white)
                        Text("삭제 중…").font(UIScale.font(10)).foregroundStyle(.white)
                        // GitHub에서 지우는 중에는 취소할 수 없다(웹과 같음).
                        if store.deletingPath != item.path {
                            Button("취소") { store.cancelDelete(item) }.controlSize(.mini)
                        }
                    }
                }
            }
            .frame(width: UIScale.size(64), height: UIScale.size(64))
            .clipShape(RoundedRectangle(cornerRadius: 8))
            Text(item.name).font(UIScale.font(10)).lineLimit(1).truncationMode(.middle).frame(width: UIScale.size(72))
        }
        .contentShape(Rectangle())
        // 누르면 칸이 키보드 포커스를 받고, Space로 Quick Look을 연다(Finder와 같음).
        .focusable()
        .focusEffectDisabled(false)
        .onKeyPress(.space) { QuickLook.show(store: store, start: item); return .handled }
        .onTapGesture { QuickLook.show(store: store, start: item) }
        .help(item.name)
        .onDrag { dragProvider() }
        .contextMenu {
            Button("미리보기") { QuickLook.show(store: store, start: item) }
            Button("Markdown 복사") { store.copyMarkdown(item) }
            if editable && !store.isLinkedInBody(item) {
                Button("본문에 넣기") { store.insertIntoBody(item) }
            }
            Button("내려받기") { Task { await store.download(item) } }
            if editable {
                Divider()
                if pending {
                    Button("삭제 취소") { store.cancelDelete(item) }
                } else {
                    Button("삭제", role: .destructive) { store.scheduleDelete(item, undoManager: undoManager) }
                }
            }
        }
        .task(id: item.sha) {
            guard item.isImage, let url = try? await store.localFile(item) else { return }
            thumbnail = await ThumbnailCache.shared.thumbnail(for: url, sha: item.sha, size: 64)
        }
    }

    /// Finder로 끌어내면 내려받은 파일을 건넨다.
    private func dragProvider() -> NSItemProvider {
        let provider = NSItemProvider()
        provider.suggestedName = item.name
        let store = store
        let item = item
        provider.registerFileRepresentation(forTypeIdentifier: UTType.data.identifier, fileOptions: [], visibility: .all) { completion in
            Task { @MainActor in
                do { completion(try await store.localFile(item), true, nil) } catch { completion(nil, false, error) }
            }
            return nil
        }
        return provider
    }
}

/// Quick Look 패널로 노트의 첨부를 넘겨 본다.
@MainActor
final class QuickLook: NSObject, QLPreviewPanelDataSource, QLPreviewPanelDelegate {
    static let shared = QuickLook()
    private var urls: [URL] = []

    static func show(store: AttachmentStore, start: Attachment) {
        show(items: store.items, start: start, session: store.session)
    }

    static func show(items: [Attachment], start: Attachment, session: NoteSession) {
        Task { @MainActor in
            var urls: [URL] = []
            var startIndex = 0
            for item in items {
                guard let url = try? await AttachmentStore.localFile(item, client: session.workspace.client) else { continue }
                if item.path == start.path { startIndex = urls.count }
                urls.append(url)
            }
            guard !urls.isEmpty, let panel = QLPreviewPanel.shared() else { return }
            shared.urls = urls
            panel.dataSource = shared
            panel.delegate = shared
            panel.reloadData()
            panel.currentPreviewItemIndex = startIndex
            panel.makeKeyAndOrderFront(nil)
            shared.observeFocusLoss()
        }
    }

    private var observers: [NSObjectProtocol] = []

    /// 미리보기 중에 다른 앱으로 가거나 앱의 다른 창을 누르면 패널을 닫는다.
    private func observeFocusLoss() {
        guard observers.isEmpty else { return }
        let center = NotificationCenter.default
        let close: (Notification) -> Void = { note in
            MainActor.assumeIsolated {
                guard QLPreviewPanel.sharedPreviewPanelExists(), let panel = QLPreviewPanel.shared(), panel.isVisible else { return }
                if let window = note.object as? NSWindow, window === panel { return }
                panel.orderOut(nil)
            }
        }
        observers.append(center.addObserver(forName: NSApplication.didResignActiveNotification, object: nil, queue: .main, using: close))
        observers.append(center.addObserver(forName: NSWindow.didBecomeKeyNotification, object: nil, queue: .main, using: close))
    }

    nonisolated func numberOfPreviewItems(in panel: QLPreviewPanel!) -> Int {
        MainActor.assumeIsolated { urls.count }
    }

    nonisolated func previewPanel(_ panel: QLPreviewPanel!, previewItemAt index: Int) -> (any QLPreviewItem)! {
        MainActor.assumeIsolated { urls[index] as NSURL }
    }
}
