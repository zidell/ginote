import Foundation

/// 설정이 아닌 앱 상태(초안, 대기 작업, 정리 시각, 모델 목록 캐시, 아직 못 올린 전사 단어).
/// 웹은 `localStorage`에 두던 것을 `state/` 폴더의 JSON 파일로 둔다(macos/DESIGN.md §8).
public final class LocalState: @unchecked Sendable {
    public let directory: URL
    private let lock = NSLock()

    public init(directory: URL) {
        self.directory = directory
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    // MARK: - 파일

    func load<T: Decodable>(_ name: String, as type: T.Type, default fallback: T) -> T {
        lock.lock(); defer { lock.unlock() }
        guard let data = try? Data(contentsOf: directory.appendingPathComponent(name)),
              let value = try? JSONDecoder().decode(T.self, from: data) else { return fallback }
        return value
    }

    func save<T: Encodable>(_ name: String, _ value: T) {
        lock.lock(); defer { lock.unlock() }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let data = try? encoder.encode(value) else { return }
        try? data.write(to: directory.appendingPathComponent(name), options: .atomic)
    }

    // MARK: - 초안 (웹 issue-note.drafts.v1)

    public struct Draft: Codable, Equatable, Sendable {
        public var title: String
        public var body: String
        public var labels: [String]
        public var savedAt: Double

        public init(title: String, body: String, labels: [String], savedAt: Date = Date()) {
            self.title = title; self.body = body; self.labels = labels; self.savedAt = savedAt.timeIntervalSince1970 * 1000
        }
    }

    typealias DraftStore = [String: [String: Draft]]

    public func draft(repo: String, id: String) -> Draft? {
        load("drafts.json", as: DraftStore.self, default: [:])[repo]?[id]
    }

    public func setDraft(repo: String, id: String, _ draft: Draft?) {
        var store = load("drafts.json", as: DraftStore.self, default: [:])
        var repoDrafts = store[repo] ?? [:]
        repoDrafts[id] = draft
        store[repo] = repoDrafts.isEmpty ? nil : repoDrafts
        save("drafts.json", store)
    }

    /// 새 노트가 번호를 받으면 초안 키를 `new.*`에서 `issue.N`으로 옮긴다(충돌 뒤 복구가 이 키를 본다).
    public func moveDraft(repo: String, from oldId: String, to newId: String) {
        var store = load("drafts.json", as: DraftStore.self, default: [:])
        guard var repoDrafts = store[repo], let draft = repoDrafts.removeValue(forKey: oldId) else { return }
        repoDrafts[newId] = draft
        store[repo] = repoDrafts
        save("drafts.json", store)
    }

    /// 저장소 태그 이름이 바뀌거나 지워지면 그 저장소 초안의 태그도 맞춘다.
    public func renameDraftLabels(repo: String, from currentName: String, to nextName: String?) {
        var store = load("drafts.json", as: DraftStore.self, default: [:])
        guard var repoDrafts = store[repo] else { return }
        for (id, var draft) in repoDrafts {
            draft.labels = LabelNames.replace(draft.labels, currentName, nextName)
            repoDrafts[id] = draft
        }
        store[repo] = repoDrafts
        save("drafts.json", store)
    }

    // MARK: - 대기 작업 (웹 issue-note.pending-work.v1)

    public struct PendingAttachmentDelete: Codable, Equatable, Sendable {
        public var path: String
        public var sha: String
        public var name: String
        public var commentId: Int?
        public var expiresAt: Double

        public init(path: String, sha: String, name: String, commentId: Int?, expiresAt: Date) {
            self.path = path; self.sha = sha; self.name = name; self.commentId = commentId
            self.expiresAt = expiresAt.timeIntervalSince1970 * 1000
        }
    }

    public struct PendingComment: Codable, Equatable, Sendable {
        /// 서버 댓글 id. 아직 저장 전인 새 댓글이면 nil.
        public var id: Int?
        public var localId: String
        public var body: String

        public init(id: Int?, localId: String, body: String) {
            self.id = id; self.localId = localId; self.body = body
        }
    }

    public struct PendingWork: Codable, Equatable, Sendable {
        public var attachmentDeletes: [PendingAttachmentDelete] = []
        public var commentDrafts: [PendingComment] = []
        public var updatedAt: Double = 0

        public init() {}

        var isEmpty: Bool { attachmentDeletes.isEmpty && commentDrafts.isEmpty }
    }

    static func scope(repo: String, issueNumber: Int) -> String { "\(repo)#\(issueNumber)" }

    public func pendingWork(repo: String, issueNumber: Int) -> PendingWork? {
        load("pending-work.json", as: [String: PendingWork].self, default: [:])[Self.scope(repo: repo, issueNumber: issueNumber)]
    }

    public func updatePendingWork(repo: String, issueNumber: Int, _ change: (inout PendingWork) -> Void) {
        var store = load("pending-work.json", as: [String: PendingWork].self, default: [:])
        let key = Self.scope(repo: repo, issueNumber: issueNumber)
        var work = store[key] ?? PendingWork()
        change(&work)
        work.updatedAt = Date().timeIntervalSince1970 * 1000
        store[key] = work.isEmpty ? nil : work
        save("pending-work.json", store)
    }

    // MARK: - 첨부 정리 시각 (하루 한 번)

    public static let pruneInterval: TimeInterval = 24 * 60 * 60

    public func shouldPruneAttachments(repo: String, now: Date = Date()) -> Bool {
        guard let last = load("attachment-prune.json", as: [String: Double].self, default: [:])[repo] else { return true }
        return now.timeIntervalSince1970 * 1000 - last >= Self.pruneInterval * 1000
    }

    public func markAttachmentsPruned(repo: String, now: Date = Date()) {
        var store = load("attachment-prune.json", as: [String: Double].self, default: [:])
        store[repo] = now.timeIntervalSince1970 * 1000
        save("attachment-prune.json", store)
    }

    // MARK: - OpenAI 모델 목록 캐시

    public struct ModelLists: Codable, Equatable, Sendable {
        public var transcription: [String]
        public var refinement: [String]

        public init(transcription: [String], refinement: [String]) {
            self.transcription = transcription
            self.refinement = refinement
        }
    }

    public var voiceModelLists: ModelLists {
        get {
            let saved = load("voice-models.json", as: ModelLists?.self, default: nil)
            let clean = { (models: [String]?, fallback: [String]) in
                Array(NSOrderedSet(array: (models ?? fallback).map { JSText.trim($0) }.filter { !$0.isEmpty && !VoicePresets.isDatedSnapshot($0) })) as! [String]
            }
            return ModelLists(transcription: clean(saved?.transcription, VoicePresets.defaultTranscriptionModels),
                              refinement: clean(saved?.refinement, VoicePresets.defaultRefinementModels))
        }
        set { save("voice-models.json", newValue) }
    }

    // MARK: - 아직 GitHub에 못 올린 전사 단어 (저장소별)

    public func pendingVoiceHints(repo: String) -> String? {
        load("voice-hints-pending.json", as: [String: String].self, default: [:])[repo]
    }

    public func setPendingVoiceHints(repo: String, _ hints: String?) {
        var store = load("voice-hints-pending.json", as: [String: String].self, default: [:])
        store[repo] = hints
        save("voice-hints-pending.json", store)
    }
}

/// 라벨 이름 목록 다루기. 웹 `issue-labels.js`.
public enum LabelNames {
    public static func same(_ left: String, _ right: String) -> Bool { left.lowercased() == right.lowercased() }

    /// nextName이 nil이나 빈 값이면 태그를 떼고, 있으면 그 이름으로 바꾼다.
    public static func replace(_ names: [String], _ currentName: String, _ nextName: String?) -> [String] {
        let next = nextName ?? ""
        return names.filter { !next.isEmpty || !same($0, currentName) }.map { same($0, currentName) ? next : $0 }
    }

    /// 여러 노트의 태그를 대소문자 구분 없이 합친다. 고정 라벨은 뺀다.
    public static func unique(_ issues: [Issue]) -> [String] {
        var seen: [String: String] = [:]
        var order: [String] = []
        for issue in issues {
            for label in issue.labels where !PinLabel.isPin(label.name) {
                let name = JSText.trim(label.name)
                guard !name.isEmpty else { continue }
                if seen[name.lowercased()] == nil { order.append(name.lowercased()) }
                seen[name.lowercased()] = name
            }
        }
        return order.compactMap { seen[$0] }
    }
}
