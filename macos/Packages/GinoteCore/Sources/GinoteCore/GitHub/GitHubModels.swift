import Foundation

public struct GitHubUser: Codable, Hashable, Sendable {
    public var login: String
    public var avatarUrl: String?
}

public struct GitHubLabel: Codable, Hashable, Sendable {
    public var name: String
    public var color: String?
    public var description: String?

    public init(name: String, color: String? = nil, description: String? = nil) {
        self.name = name; self.color = color; self.description = description
    }
}

public struct GitHubRepository: Codable, Hashable, Sendable {
    public var fullName: String
    public var defaultBranch: String?
    public var `private`: Bool?
}

/// 노트 하나 = GitHub 이슈 하나. 열린 이슈는 노트, 닫힌 이슈는 휴지통이다.
public struct Issue: Codable, Hashable, Identifiable, Sendable {
    public var id: Int
    public var number: Int
    public var title: String
    public var body: String?
    public var state: String
    public var labels: [GitHubLabel]
    public var createdAt: String
    public var updatedAt: String
    public var closedAt: String?
    public var comments: Int?
    public var user: GitHubUser?
    public var htmlUrl: String?
    public var pullRequest: PullRequestRef?

    public struct PullRequestRef: Codable, Hashable, Sendable {
        public var url: String?
    }

    public init(id: Int, number: Int, title: String, body: String?, state: String = "open", labels: [GitHubLabel] = [],
                createdAt: String, updatedAt: String, closedAt: String? = nil, comments: Int? = 0,
                user: GitHubUser? = nil, htmlUrl: String? = nil) {
        self.id = id; self.number = number; self.title = title; self.body = body; self.state = state
        self.labels = labels; self.createdAt = createdAt; self.updatedAt = updatedAt; self.closedAt = closedAt
        self.comments = comments; self.user = user; self.htmlUrl = htmlUrl; self.pullRequest = nil
    }

    public var isClosed: Bool { state == "closed" }
    public var isPinned: Bool { labels.contains { PinLabel.isPin($0.name) } }
    public var isLocked: Bool { NoteLock.isLockedTitle(title) }
    public var visibleLabels: [GitHubLabel] { labels.filter { !PinLabel.isPin($0.name) } }
}

public struct IssueComment: Codable, Hashable, Identifiable, Sendable {
    public var id: Int
    public var body: String?
    public var user: GitHubUser?
    public var createdAt: String
    public var updatedAt: String
    public var htmlUrl: String?

    public var author: String { user?.login ?? "" }
}

/// 첨부 브랜치의 파일.
public struct RepoFile: Codable, Hashable, Sendable {
    public var name: String
    public var path: String
    public var sha: String
    public var size: Int
    public var htmlUrl: String?
    public var type: String?
}

public struct IssuePage: Sendable {
    public var items: [Issue]
    public var hasMore: Bool
    public var totalCount: Int?
}

public struct NoteDraft: Sendable {
    public var title: String
    public var body: String
    public var labels: [String]
    public var state: String?

    public init(title: String, body: String, labels: [String], state: String? = nil) {
        self.title = title; self.body = body; self.labels = labels; self.state = state
    }
}

public struct GitHubError: Error, LocalizedError, Sendable {
    public var status: Int
    public var message: String
    public var rateLimitRemaining: String?

    public init(status: Int, message: String, rateLimitRemaining: String? = nil) {
        self.status = status
        self.message = message
        self.rateLimitRemaining = rateLimitRemaining
    }

    public var errorDescription: String? { message }
    public var isRetryable: Bool { status == 0 || status >= 500 }
}
