import AppKit
import GinoteCore
import SwiftUI
import UniformTypeIdentifiers

@MainActor
enum NoteActions {
    /// `Issue #N : 제목 앞 12자..` 형식으로 복사한다(웹과 같음).
    static func copyIssueNumber(_ issue: Issue) {
        copyIssueNumber(number: issue.number, title: NoteLock.removeLock(from: issue.title))
    }

    static func copyIssueNumber(number: Int, title: String) {
        let characters = Array(title.trimmingCharacters(in: .whitespacesAndNewlines))
        let short = String(characters.prefix(12)) + (characters.count > 12 ? ".." : "")
        SystemActions.copy("Issue #\(number)\(short.isEmpty ? "" : " : \(short)")")
    }

    static func openOnGitHub(_ issue: Issue, repo: String) {
        let url = issue.htmlUrl.flatMap(URL.init(string:)) ?? URL(string: "https://github.com/\(repo)/issues/\(issue.number)")!
        SystemActions.open(url)
    }
}

/// 노트를 열지 않은 상태에서 붙여넣으면 그 글·파일로 새 노트를 만든다.
@MainActor
enum PasteImporter {
    static func newNote(from providers: [NSItemProvider], workspace: WorkspaceModel) {
        Task {
            var text = ""
            var files: [URL] = []
            for provider in providers {
                if let url = await loadFileURL(provider) {
                    files.append(url)
                } else if let data = await imageData(provider),
                          let image = NSImage(data: data), let url = TemporaryFiles.write(image) {
                    files.append(url)
                } else if let string = await loadText(provider) {
                    text += string
                }
            }
            guard !text.isEmpty || !files.isEmpty else { return }
            if let opened = workspace.openedId {
                let session = opened == NoteSession.newNoteSelectionId
                    ? workspace.newNote : workspace.issue(id: opened).map(workspace.session(for:))
                if let session {
                    // 휴지통 노트에는 파일을 붙이지 않는다. 글은 위치를 정해야 하므로 안내만 한다.
                    if !files.isEmpty, !session.isArchived {
                        // 번호가 있으면 올리기와 저장을 기다린다. 저장이 오류 문구를 지우므로 안내는 그 뒤에 띄운다.
                        if session.number != nil { await session.attachments.add(files) } else { session.addAttachments(files) }
                    }
                    if !text.isEmpty { session.errorMessage = String(localized: "붙여넣을 위치를 먼저 클릭하세요.") }
                    return
                }
            }
            _ = workspace.createNote(body: text, files: files)
        }
    }
}

@MainActor
func loadFileURL(_ provider: NSItemProvider) async -> URL? {
    guard provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier),
          let item = try? await provider.loadItem(forTypeIdentifier: UTType.fileURL.identifier) else { return nil }
    if let url = item as? URL { return url }
    if let data = item as? Data { return URL(dataRepresentation: data, relativeTo: nil) }
    return nil
}

@MainActor
func imageData(_ provider: NSItemProvider) async -> Data? {
    if let png = await loadData(provider, type: .png) { return png }
    return await loadData(provider, type: .tiff)
}

@MainActor
func loadData(_ provider: NSItemProvider, type: UTType) async -> Data? {
    guard provider.hasItemConformingToTypeIdentifier(type.identifier) else { return nil }
    return try? await provider.loadItem(forTypeIdentifier: type.identifier) as? Data
}

@MainActor
func loadText(_ provider: NSItemProvider) async -> String? {
    guard provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier),
          let item = try? await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) else { return nil }
    if let string = item as? String { return string }
    if let data = item as? Data { return String(data: data, encoding: .utf8) }
    return nil
}

enum TemporaryFiles {
    static func write(_ data: Data, name: String) -> URL? {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("ginote-paste-\(UUID().uuidString)")
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let url = directory.appendingPathComponent(name)
        return (try? data.write(to: url)) != nil ? url : nil
    }

    static func write(_ image: NSImage, name: String = "image.png") -> URL? {
        guard let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff),
              let png = bitmap.representation(using: .png, properties: [:]) else { return nil }
        return write(png, name: name)
    }
}

/// 여러 노트를 시간순 기록 하나로 합친다. 웹 `src/lib/merge-notes.js`.
/// 새 노트가 완성되기 전에는 원본을 닫지 않으므로, 어느 단계가 실패해도 원본은 그대로 남는다.
@MainActor
enum MergeRunner {
    static let placeholderBody = "> 병합 기록을 준비하는 중입니다."

    static func run(_ targets: [Issue], workspace: WorkspaceModel) async {
        guard targets.count >= 2, !workspace.merging else { return }
        guard targets.allSatisfy({ !$0.isClosed }) else {
            Dialogs.inform(String(localized: "휴지통의 노트는 복원한 뒤 병합하세요."))
            return
        }
        guard await Dialogs.confirm(String(localized: "\(targets.count)개 노트를 시간순 기록 하나로 병합할까요? 원본 노트는 휴지통으로 옮깁니다."), confirmTitle: String(localized: "병합")) else { return }
        workspace.merging = true
        defer { workspace.merging = false }
        for issue in targets { await workspace.sessions[issue.number]?.flush() }

        let client = workspace.client
        let repo = workspace.repo
        var draft: Issue?
        do {
            var details: [(issue: Issue, comments: [IssueComment], files: [RepoFile])] = []
            for target in targets {
                let issue = try await client.getIssue(target.number)
                async let comments = client.listComments(target.number)
                async let files = client.listAllAttachmentFiles(issueNumber: target.number)
                details.append((issue, try await comments, try await files))
            }
            let sources = details.map { source(from: $0.issue, comments: $0.comments, replacements: []) }
            let earliest = NoteMerge.earliestTitle(sources)
            let title = earliest.isEmpty ? String(localized: "병합 노트") : earliest
            let labels = LabelNames.unique(details.map(\.issue))
            try assertLength(NoteMerge.formatBody(NoteMerge.timeline(sources)))

            let created = try await client.createIssue(NoteDraft(title: title, body: placeholderBody, labels: labels))
            draft = created
            var replacements: [(String, String)] = []
            for detail in details {
                for file in detail.files {
                    let data = try await client.downloadAttachment(path: file.path)
                    let name = AttachmentLinks.displayName(fromPath: file.path)
                    let copied = try await client.uploadAttachment(issueNumber: created.number, fileName: name,
                                                                   type: AttachmentLinks.inferredType(name: name), data: data)
                    replacements.append((file.path, copied.path))
                }
            }
            let rewritten = details.map { source(from: $0.issue, comments: $0.comments, replacements: replacements, repo: repo) }
            let body = NoteMerge.formatBody(NoteMerge.timeline(rewritten))
            try assertLength(body)
            var merged = try await client.updateIssue(created.number, NoteDraft(title: title, body: body, labels: labels))
            // 원본 댓글은 본문에 넣지 않고 새 노트의 댓글로 옮긴다(기록 패널에 따로 보인다).
            let comments = NoteMerge.comments(rewritten)
            for comment in comments { _ = try await client.createComment(created.number, body: comment.body) }
            if !comments.isEmpty { merged = try await client.getIssue(created.number) }

            var failures: [Int] = []
            var closed: [Issue] = []
            for target in targets {
                do {
                    let issue = try await client.setState(target.number, state: "closed")
                    workspace.hold(issue)
                    closed.append(issue)
                } catch { failures.append(target.number) }
            }
            // 목록을 다시 읽지 않고 바로 반영한다. 방금 닫은 직후의 GitHub 목록·개수는 아직 옛 값이다.
            workspace.applyMerge(created: merged, closed: closed)
            if failures.isEmpty {
                Dialogs.inform(String(localized: "병합 노트 #\(merged.number)을(를) 만들었습니다."))
            } else {
                let numbers = failures.map { "#\($0)" }.joined(separator: ", ")
                Dialogs.inform(String(localized: "병합 노트는 만들었지만 \(numbers)을(를) 휴지통으로 옮기지 못했습니다. 직접 닫아주세요."))
            }
        } catch {
            if let draft {
                _ = try? await client.setState(draft.number, state: "closed")
                Dialogs.inform(String(localized: "병합을 완료하지 못했습니다. 불완전한 병합 노트 #\(draft.number)은(는) 휴지통으로 옮겼고 원본 노트는 그대로 남겼습니다."),
                               detail: workspace.friendly(error))
            } else {
                Dialogs.inform(String(localized: "노트를 병합하지 못했습니다. 원본 노트는 휴지통으로 옮기지 않았습니다."), detail: workspace.friendly(error))
            }
        }
    }

    private static func source(from issue: Issue, comments: [IssueComment], replacements: [(String, String)], repo: String = "") -> NoteMerge.Source {
        let replace = { (text: String) in replacements.isEmpty ? text : NoteMerge.replaceAttachmentURLs(text, repo: repo, replacements: replacements) }
        return NoteMerge.Source(
            number: issue.number, title: issue.title, createdAt: issue.createdAt, author: issue.author,
            body: replace(issue.bodyText),
            comments: comments.map { .init(createdAt: $0.createdAt, author: $0.author, body: replace($0.bodyText)) })
    }

    private static func assertLength(_ body: String) throws {
        if NoteText.length(body) > NoteText.maxBodyLength {
            throw AppError(message: String(localized: "병합 기록이 노트 최대 길이(\(NoteText.maxBodyLength)자)를 초과합니다."))
        }
    }
}

/// 여러 노트에 태그를 한꺼번에 붙이거나 뗀다.
struct BulkTagPanel: View {
    @Bindable var workspace: WorkspaceModel
    let targets: [Issue]
    @State var search = ""
    @State var busy = false
    @State private var errorMessage: String?

    /// 고른 노트의 지금 상태. 붙이거나 뗀 결과가 목록 모델에 반영되므로 처음 받은 값 대신 그것을 센다.
    private var current: [Issue] { targets.map { workspace.issue(id: $0.id) ?? $0 } }

    private var options: [(name: String, count: Int)] {
        let term = search.trimmingCharacters(in: .whitespaces).drop { $0 == "#" }.lowercased()
        let current = current
        return workspace.visibleLabels
            .map { label in (label.name, current.filter { $0.labels.contains { LabelNames.same($0.name, label.name) } }.count) }
            .filter { term.isEmpty || $0.0.lowercased().contains(term) }
            .sorted { ($0.1 > 0 ? 0 : 1, $0.0) < ($1.1 > 0 ? 0 : 1, $1.0) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                TextField("태그 검색 또는 새 태그", text: $search)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit { Task { await createAndApply() } }
                if busy { ProgressView().controlSize(.small) }
            }
            List {
                ForEach(options, id: \.name) { option in
                    Button {
                        Task { await toggle(option.name, allHave: option.count == targets.count) }
                    } label: {
                        HStack {
                            Image(systemName: option.count == targets.count ? "checkmark.square.fill" : option.count > 0 ? "minus.square" : "square")
                            Circle().fill(Color(hex: TagColor.hex(for: option.name))).frame(width: 8, height: 8)
                            Text("#\(option.name)")
                            Spacer()
                            Text("\(option.count)/\(targets.count)").foregroundStyle(.secondary).font(.caption)
                        }
                    }
                    .buttonStyle(.plain)
                }
                let name = NoteText.normalizeTagName(TagDefinition.parse(search).name)
                if !name.isEmpty, !workspace.visibleLabels.contains(where: { LabelNames.same($0.name, name) }) {
                    Button("#\(name) 태그 만들기") { Task { await createAndApply() } }
                }
                if workspace.visibleLabels.isEmpty && name.isEmpty {
                    Text("이 저장소에는 태그가 없습니다.").foregroundStyle(.secondary)
                }
            }
            if let errorMessage { Text(errorMessage).foregroundStyle(.red).font(.caption) }
        }
        .padding(10)
        .disabled(busy)
    }

    private func createAndApply() async {
        guard !search.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        busy = true
        defer { busy = false }
        do {
            let label = try await workspace.createLabel(definition: search)
            search = ""
            await toggle(label.name, allHave: false)
        } catch {
            errorMessage = workspace.friendly(error)
        }
    }

    /// 모두 붙어 있으면 떼고, 아니면 없는 노트에 붙인다. 노트마다 차례로 보낸다.
    private func toggle(_ name: String, allHave: Bool) async {
        busy = true
        defer {
            busy = false
            if allHave, let filter = workspace.labelFilter, LabelNames.same(filter, name) { Task { await workspace.reload() } }
            workspace.refreshCounts()
        }
        for target in targets {
            let current = workspace.issue(id: target.id) ?? target
            let has = current.labels.contains { LabelNames.same($0.name, name) }
            do {
                var updated = current
                if allHave && has {
                    try await workspace.client.removeLabelFromIssue(current.number, label: name)
                    updated.labels.removeAll { LabelNames.same($0.name, name) }
                } else if !allHave && !has {
                    try await workspace.client.addLabel(current.number, label: name)
                    updated.labels.append(GitHubLabel(name: name))
                } else { continue }
                workspace.apply(updated)
                workspace.sessions[current.number]?.adoptRemoteLabels(updated.labels.map(\.name))
            } catch {
                errorMessage = workspace.friendly(error)
            }
        }
    }
}
