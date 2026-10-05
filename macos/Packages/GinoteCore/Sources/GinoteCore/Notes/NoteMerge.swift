import Foundation

/// 여러 노트를 하나로 합치는 규칙. 웹 `src/lib/note-merge.js`.
/// 원본 본문은 시간순으로 새 노트 본문에, 원본 댓글은 새 노트의 댓글로 시간순으로 옮긴다.
public enum NoteMerge {
    public struct Entry: Equatable, Sendable {
        public enum Kind: String, Sendable { case body, comment }
        public let kind: Kind
        public let createdAt: String
        public let author: String
        public let body: String
        public let issueNumber: Int
        public let issueTitle: String
    }

    public struct Source: Sendable {
        public struct Comment: Sendable {
            public let createdAt: String
            public let author: String
            public let body: String
            public init(createdAt: String, author: String, body: String) {
                self.createdAt = createdAt; self.author = author; self.body = body
            }
        }

        public let number: Int
        public let title: String
        public let createdAt: String
        public let author: String
        public let body: String
        public let comments: [Comment]

        public init(number: Int, title: String, createdAt: String, author: String, body: String, comments: [Comment]) {
            self.number = number; self.title = title; self.createdAt = createdAt
            self.author = author; self.body = body; self.comments = comments
        }
    }

    static func comparableDate(_ value: String) -> Double {
        GitHubDate.parse(value).map { $0.timeIntervalSince1970 * 1000 } ?? Double(Int.max)
    }

    public static func earliest(_ sources: [Source]) -> Source? {
        sources.sorted { left, right in
            let l = comparableDate(left.createdAt), r = comparableDate(right.createdAt)
            return l != r ? l < r : left.number < right.number
        }.first
    }

    /// 병합 노트 본문이 될 원본 본문들(시간순).
    public static func timeline(_ sources: [Source]) -> [Entry] {
        sortedByTime(sources.map {
            Entry(kind: .body, createdAt: $0.createdAt, author: $0.author, body: $0.body,
                  issueNumber: $0.number, issueTitle: $0.title)
        })
    }

    /// 병합 노트에 댓글로 다시 남길 원본 댓글들(시간순). 내용이 빈 댓글은 GitHub가 받지 않으므로 뺀다.
    public static func comments(_ sources: [Source]) -> [Entry] {
        sortedByTime(sources.flatMap { source in
            source.comments.map {
                Entry(kind: .comment, createdAt: $0.createdAt, author: $0.author, body: $0.body,
                      issueNumber: source.number, issueTitle: source.title)
            }
        }.filter { !JSText.trim($0.body).isEmpty })
    }

    private static func sortedByTime(_ entries: [Entry]) -> [Entry] {
        // JavaScript의 sort는 안정 정렬이다. 같은 키의 원래 순서를 지키도록 위치를 함께 비교한다.
        entries.enumerated().sorted { left, right in
            let l = comparableDate(left.element.createdAt), r = comparableDate(right.element.createdAt)
            if l != r { return l < r }
            if left.element.issueNumber != right.element.issueNumber { return left.element.issueNumber < right.element.issueNumber }
            return left.offset < right.offset
        }.map(\.element)
    }

    public static func replaceAttachmentURLs(_ body: String, repo: String, replacements: [(String, String)]) -> String {
        var result = body
        for (source, target) in replacements {
            result = result.components(separatedBy: AttachmentLinks.rawURL(repo: repo, path: source))
                .joined(separator: AttachmentLinks.rawURL(repo: repo, path: target))
        }
        return result
    }

    public static func formatBody(_ entries: [Entry], timeZone: TimeZone = .current) -> String {
        entries.map { entry in
            let trimmed = JSText.trim(entry.body)
            let content = trimmed.isEmpty ? "_내용 없음_" : trimmed
            let author = entry.author.isEmpty ? "" : " @\(entry.author)"
            return "## \(formatTimestamp(entry.createdAt, timeZone: timeZone))\(author)\n\n\(content)"
        }.joined(separator: "\n\n")
    }

    public static func formatTimestamp(_ value: String, timeZone: TimeZone = .current) -> String {
        guard let date = GitHubDate.parse(value) else { return "알 수 없는 시각" }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let c = calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: date)
        return String(format: "%04d-%02d-%02d %02d:%02d:%02d",
                      c.year ?? 0, c.month ?? 0, c.day ?? 0, c.hour ?? 0, c.minute ?? 0, c.second ?? 0)
    }
}

/// GitHub API의 ISO 8601 시각.
public enum GitHubDate {
    public static func parse(_ value: String) -> Date? {
        let plain = ISO8601DateFormatter()
        if let date = plain.date(from: value) { return date }
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractional.date(from: value)
    }
}
