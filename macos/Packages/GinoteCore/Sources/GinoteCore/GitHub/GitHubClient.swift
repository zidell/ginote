import Foundation

/// GitHub REST API. 웹 `src/lib/github.js`와 같은 요청을 보낸다.
public final class GitHubClient: @unchecked Sendable {
    public static let pageSizeDefault = 30
    public static let hybridSearchMax = 100
    public static let closedRetentionDays = 30
    static let apiRoot = URL(string: "https://api.github.com")!
    static let storageMarker = ".issue-note-assets/.ginote-storage"
    static let storageMarkerContent = "Ginote attachment storage. Do not delete this branch.\n"
    static let voiceHintsPath = ".issue-note-assets/voice-hints.json"

    public let token: String
    public let repo: String
    let session: URLSession

    /// GitHub 응답은 `Cache-Control: max-age=60`이라 기본 캐시를 쓰면 1분 동안 옛 목록이 나온다. 캐시 없는 세션을 쓴다.
    public static let uncachedSession: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: configuration)
    }()

    public init(token: String, repo: String, session: URLSession = GitHubClient.uncachedSession) {
        self.token = token
        self.repo = repo
        self.session = session
    }

    // MARK: - 요청

    static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return decoder
    }()

    struct Response {
        let data: Data
        let http: HTTPURLResponse
    }

    func send(_ path: String, method: String = "GET", json: Any? = nil, accept: String = "application/vnd.github+json") async throws -> Response {
        guard let url = URL(string: Self.apiRoot.absoluteString + path) else {
            throw GitHubError(status: 0, message: "Invalid request path")
        }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData)
        request.httpMethod = method
        request.setValue(accept, forHTTPHeaderField: "Accept")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("2022-11-28", forHTTPHeaderField: "X-GitHub-Api-Version")
        if let json {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: json)
        }
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw GitHubError(status: 0, message: error.localizedDescription)
        }
        guard let http = response as? HTTPURLResponse else {
            throw GitHubError(status: 0, message: "No HTTP response")
        }
        guard (200..<300).contains(http.statusCode) else {
            let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            let message = (payload?["message"] as? String).flatMap { $0.isEmpty ? nil : $0 }
                ?? HTTPURLResponse.localizedString(forStatusCode: http.statusCode)
            throw GitHubError(status: http.statusCode, message: message,
                              rateLimitRemaining: http.value(forHTTPHeaderField: "x-ratelimit-remaining"))
        }
        return Response(data: data, http: http)
    }

    func get<T: Decodable>(_ path: String, as type: T.Type = T.self) async throws -> T {
        try Self.decoder.decode(T.self, from: try await send(path).data)
    }

    func call<T: Decodable>(_ path: String, method: String, json: Any? = nil, as type: T.Type = T.self) async throws -> T {
        try Self.decoder.decode(T.self, from: try await send(path, method: method, json: json).data)
    }

    static func hasNextPage(_ link: String?) -> Bool {
        (link ?? "").split(separator: ",").contains { $0.contains("rel=\"next\"") }
    }

    static func query(_ items: [(String, String)]) -> String {
        items.map { "\($0.0)=\(JSText.encodeURIComponent($0.1))" }.joined(separator: "&")
    }

    static func issuesOnly(_ items: [Issue]) -> [Issue] { items.filter { $0.pullRequest == nil } }

    static func closedCutoff(_ now: Date) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        let cutoff = calendar.date(byAdding: .day, value: -closedRetentionDays, to: now)!
        let c = calendar.dateComponents([.year, .month, .day], from: cutoff)
        return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
    }

    static func quoted(_ label: String) -> String {
        let data = try! JSONSerialization.data(withJSONObject: [label])
        let text = String(decoding: data, as: UTF8.self)
        return String(text.dropFirst().dropLast())
    }

    var repoPath: String { "/repos/\(repo)" }

    // MARK: - 연결

    public func verify() async throws -> (user: GitHubUser, repository: GitHubRepository) {
        let user: GitHubUser = try await get("/user")
        let repository: GitHubRepository = try await get(repoPath)
        return (user, repository)
    }

    // MARK: - 이슈

    public func listIssuesPage(state: String = "open", label: String = "", page: Int = 1,
                               pageSize: Int = pageSizeDefault, now: Date = Date()) async throws -> IssuePage {
        if state == "closed" {
            return try await searchIssuesPage(state: state, term: "", label: label, now: now)
        }
        var params = [("state", state), ("sort", "updated"), ("direction", "desc"),
                      ("per_page", String(pageSize)), ("page", String(page))]
        if !label.isEmpty { params.append(("labels", label)) }
        let countQuery = "repo:\(repo) is:issue is:\(state)\(label.isEmpty ? "" : " label:\(Self.quoted(label))")"
        let pagePath = "\(repoPath)/issues?\(Self.query(params))"
        async let pageResponse = send(pagePath)
        async let countResponse: SearchResult? = page == 1
            ? get("/search/issues?\(Self.query([("q", countQuery), ("per_page", "1")]))")
            : nil
        let response = try await pageResponse
        let items = try Self.decoder.decode([Issue].self, from: response.data)
        let count = try await countResponse
        return IssuePage(items: Self.issuesOnly(items),
                         hasMore: Self.hasNextPage(response.http.value(forHTTPHeaderField: "link")),
                         totalCount: count?.totalCount)
    }

    struct SearchResult: Decodable {
        var totalCount: Int
        var items: [Issue]
    }

    /// GitHub 웹 검색과 같은 hybrid 검색. 한 페이지(최대 100개)만 준다.
    public func searchIssuesPage(state: String, term: String, label: String = "", now: Date = Date()) async throws -> IssuePage {
        let labelQuery = label.isEmpty ? "" : " label:\(Self.quoted(label))"
        let termQuery = JSText.trim(term)
        let cutoff = state == "closed" ? " closed:>=\(Self.closedCutoff(now))" : ""
        let query = "\(termQuery.isEmpty ? "" : "\(termQuery) ")repo:\(repo) is:issue is:\(state)\(cutoff)\(labelQuery)"
        let result: SearchResult = try await get("/search/issues?\(Self.query([("q", query), ("search_type", "hybrid"), ("per_page", String(Self.hybridSearchMax)), ("page", "1")]))")
        var items = Self.issuesOnly(result.items)
        if state == "closed" {
            items.sort { ($0.closedAt ?? "") > ($1.closedAt ?? "") }
        }
        return IssuePage(items: items, hasMore: false, totalCount: result.totalCount)
    }

    public func listExpiredClosedIssues(now: Date = Date(), pageSize: Int = 100) async throws -> [Issue] {
        let query = "repo:\(repo) is:issue is:closed closed:<\(Self.closedCutoff(now))"
        let result: SearchResult = try await get("/search/issues?\(Self.query([("q", query), ("sort", "updated"), ("order", "asc"), ("per_page", String(pageSize)), ("page", "1")]))")
        return Self.issuesOnly(result.items)
    }

    public func getIssue(_ number: Int) async throws -> Issue {
        try await get("\(repoPath)/issues/\(number)")
    }

    public func createIssue(_ note: NoteDraft) async throws -> Issue {
        try await call("\(repoPath)/issues", method: "POST",
                       json: ["title": note.title, "body": note.body, "labels": note.labels])
    }

    public func updateIssue(_ number: Int, _ note: NoteDraft) async throws -> Issue {
        var payload: [String: Any] = ["title": note.title, "body": note.body, "labels": note.labels]
        if let state = note.state { payload["state"] = state }
        return try await call("\(repoPath)/issues/\(number)", method: "PATCH", json: payload)
    }

    public func addLabel(_ number: Int, label: String) async throws {
        _ = try await send("\(repoPath)/issues/\(number)/labels", method: "POST", json: ["labels": [label]])
    }

    public func removeLabelFromIssue(_ number: Int, label: String) async throws {
        _ = try await send("\(repoPath)/issues/\(number)/labels/\(JSText.encodeURIComponent(label))", method: "DELETE")
    }

    public func setState(_ number: Int, state: String) async throws -> Issue {
        try await call("\(repoPath)/issues/\(number)", method: "PATCH", json: ["state": state])
    }

    // MARK: - 개수(사이드바 배지)

    public struct NoteCounts: Equatable, Sendable {
        public var notes: Int
        public var trash: Int
        /// 태그 이름 → 열린 노트 수.
        public var labels: [String: Int]
    }

    /// 열린 노트 수와 태그별 열린 노트 수는 GraphQL 한 번, 휴지통(30일) 수는 검색 한 번으로 센다.
    /// 태그마다 검색하면 검색 요청 한도(분당 30회)에 금방 걸린다.
    public func noteCounts(now: Date = Date()) async throws -> NoteCounts {
        guard let address = RepoAddress.parse(repo) else { throw GitHubError(status: 0, message: "Invalid repository") }
        let query = """
        query($owner: String!, $name: String!) {
          repository(owner: $owner, name: $name) {
            issues(states: OPEN) { totalCount }
            labels(first: 100) { nodes { name issues(states: OPEN) { totalCount } } }
          }
        }
        """
        async let graph = send("/graphql", method: "POST", json: ["query": query, "variables": ["owner": address.owner, "name": address.name]])
        let trashQuery = "repo:\(repo) is:issue is:closed closed:>=\(Self.closedCutoff(now))"
        async let trash: SearchResult = get("/search/issues?\(Self.query([("q", trashQuery), ("per_page", "1")]))")
        let payload = try JSONSerialization.jsonObject(with: try await graph.data) as? [String: Any]
        let repository = (payload?["data"] as? [String: Any])?["repository"] as? [String: Any]
        let notes = ((repository?["issues"] as? [String: Any])?["totalCount"] as? Int) ?? 0
        var labels: [String: Int] = [:]
        for node in ((repository?["labels"] as? [String: Any])?["nodes"] as? [[String: Any]]) ?? [] {
            if let name = node["name"] as? String, let count = (node["issues"] as? [String: Any])?["totalCount"] as? Int {
                labels[name] = count
            }
        }
        return NoteCounts(notes: notes, trash: try await trash.totalCount, labels: labels)
    }

    // MARK: - 라벨(태그)

    public func listLabels() async throws -> [GitHubLabel] {
        try await get("\(repoPath)/labels?per_page=100")
    }

    public func createLabel(_ name: String, description: String = "") async throws -> GitHubLabel {
        var payload: [String: Any] = ["name": name, "color": TagColor.hex(for: name)]
        if !description.isEmpty { payload["description"] = description }
        do {
            return try await call("\(repoPath)/labels", method: "POST", json: payload)
        } catch let error as GitHubError where error.status == 422 {
            // 다른 창이나 기기에서 같은 라벨을 먼저 만든 경우 그 라벨을 쓴다.
            return try await get("\(repoPath)/labels/\(JSText.encodeURIComponent(name))")
        }
    }

    public func renameLabel(_ currentName: String, to newName: String, description: String?) async throws -> GitHubLabel {
        var payload: [String: Any] = ["new_name": newName]
        if let description { payload["description"] = description }
        return try await call("\(repoPath)/labels/\(JSText.encodeURIComponent(currentName))", method: "PATCH", json: payload)
    }

    public func deleteLabel(_ name: String) async throws {
        _ = try await send("\(repoPath)/labels/\(JSText.encodeURIComponent(name))", method: "DELETE")
    }

    // MARK: - 댓글

    public func listComments(_ number: Int) async throws -> [IssueComment] {
        var comments: [IssueComment] = []
        var page = 1
        while true {
            let response = try await send("\(repoPath)/issues/\(number)/comments?per_page=100&page=\(page)")
            let pageItems = try Self.decoder.decode([IssueComment].self, from: response.data)
            comments.append(contentsOf: pageItems)
            let hasNext = Self.hasNextPage(response.http.value(forHTTPHeaderField: "link")) || pageItems.count == 100
            if !hasNext || pageItems.isEmpty { break }
            page += 1
        }
        return comments
    }

    public func createComment(_ number: Int, body: String) async throws -> IssueComment {
        try await call("\(repoPath)/issues/\(number)/comments", method: "POST", json: ["body": body])
    }

    public func updateComment(_ id: Int, body: String) async throws -> IssueComment {
        try await call("\(repoPath)/issues/comments/\(id)", method: "PATCH", json: ["body": body])
    }

    public func deleteComment(_ id: Int) async throws {
        _ = try await send("\(repoPath)/issues/comments/\(id)", method: "DELETE")
    }

    // MARK: - 첨부 브랜치

    func contentsPath(_ path: String, ref: Bool = true) -> String {
        let base = "\(repoPath)/contents/\(AttachmentLinks.encodedPath(path))"
        return ref ? "\(base)?ref=\(JSText.encodeURIComponent(AttachmentLinks.branch))" : base
    }

    func attachmentBranchExists() async throws -> Bool {
        do {
            _ = try await send("\(repoPath)/git/ref/heads/\(AttachmentLinks.branch)")
            return true
        } catch let error as GitHubError where error.status == 404 || error.status == 409 {
            return false
        }
    }

    func repositoryHasNoBranches() async throws -> Bool {
        let repository: GitHubRepository = try await get(repoPath)
        let branch = (repository.defaultBranch ?? "main").split(separator: "/").map { JSText.encodeURIComponent(String($0)) }.joined(separator: "/")
        do {
            _ = try await send("\(repoPath)/git/ref/heads/\(branch)")
            return false
        } catch let error as GitHubError where error.status == 404 || error.status == 409 {
            return true
        }
    }

    struct ShaObject: Decodable { var sha: String }

    /// 첫 첨부 때 코드 없는 orphan 브랜치를 만든다(docs/ATTACHMENTS.md).
    public func ensureAttachmentBranch() async throws {
        if try await attachmentBranchExists() { return }
        let createTree = { [self] () async throws -> ShaObject in
            try await call("\(repoPath)/git/trees", method: "POST", json: [
                "tree": [["path": Self.storageMarker, "mode": "100644", "type": "blob", "content": Self.storageMarkerContent]]
            ])
        }
        let tree: ShaObject
        do {
            tree = try await createTree()
        } catch let error as GitHubError where error.status == 409 {
            // 커밋이 하나도 없는 빈 저장소는 git 데이터 API(트리·커밋)를 쓸 수 없다("Git Repository is empty").
            // 기본 브랜치를 marker 파일 하나로 한 번 초기화한 뒤 다시 만든다. 빈 저장소라 깨울 workflow도 없다.
            guard try await repositoryHasNoBranches() else { throw error }
            try await initializeEmptyRepository()
            tree = try await createTree()
        }
        let commit: ShaObject = try await call("\(repoPath)/git/commits", method: "POST", json: [
            "message": "Initialize Ginote attachment storage", "tree": tree.sha, "parents": [String]()
        ])
        let createRef = { [self] in
            _ = try await send("\(repoPath)/git/refs", method: "POST",
                               json: ["ref": "refs/heads/\(AttachmentLinks.branch)", "sha": commit.sha])
        }
        do {
            try await createRef()
        } catch let error as GitHubError {
            if (error.status == 409 || error.status == 422), try await attachmentBranchExists() { return }
            // 브랜치가 하나도 없는 빈 저장소는 root commit ref를 못 만든다. 이때만 기본 브랜치를 marker로 초기화한다.
            guard error.status == 422, try await repositoryHasNoBranches() else { throw error }
            try await initializeEmptyRepository()
            do {
                try await createRef()
            } catch let retry as GitHubError where (retry.status == 409 || retry.status == 422) {
                if try await attachmentBranchExists() { return }
                throw retry
            }
        }
    }

    private func initializeEmptyRepository() async throws {
        _ = try await send(contentsPath(Self.storageMarker, ref: false), method: "PUT", json: [
            "message": "Initialize empty repository for Ginote attachment storage",
            "content": Data(Self.storageMarkerContent.utf8).base64EncodedString()
        ])
    }

    struct ContentsPutResult: Decodable {
        struct Content: Decodable { var sha: String; var size: Int; var htmlUrl: String?; var path: String }
        var content: Content
    }

    public struct UploadedAttachment: Sendable, Hashable {
        public var name: String
        public var type: String
        public var path: String
        public var sha: String
        public var size: Int
    }

    public func uploadAttachment(issueNumber: Int, commentId: Int? = nil, fileName: String, type: String, data: Data) async throws -> UploadedAttachment {
        let path = AttachmentLinks.path(issueNumber: issueNumber, commentId: commentId, fileName: fileName)
        try await ensureAttachmentBranch()
        let result: ContentsPutResult = try await call(contentsPath(path, ref: false), method: "PUT", json: [
            "message": "Add Ginote attachment: \(fileName)",
            "content": data.base64EncodedString(),
            "branch": AttachmentLinks.branch
        ])
        return UploadedAttachment(name: fileName, type: type, path: path, sha: result.content.sha, size: result.content.size)
    }

    func listDirectory(_ directory: String) async throws -> [RepoFile] {
        do {
            let entries: [RepoFile] = try await get(contentsPath(directory))
            return entries
        } catch let error as GitHubError where error.status == 404 {
            return []
        } catch is DecodingError {
            return []
        }
    }

    /// 본문 첨부 폴더의 파일(댓글 하위 폴더 제외).
    public func listAttachmentFiles(issueNumber: Int, commentId: Int? = nil) async throws -> [RepoFile] {
        try await ensureAttachmentBranch()
        return try await listDirectory(AttachmentLinks.directory(issueNumber: issueNumber, commentId: commentId))
            .filter { $0.type == "file" }
    }

    /// 댓글 하위 폴더까지 포함한 전체 파일(병합·정리용).
    public func listAllAttachmentFiles(issueNumber: Int) async throws -> [RepoFile] {
        try await ensureAttachmentBranch()
        func visit(_ directory: String) async throws -> [RepoFile] {
            let entries = try await listDirectory(directory)
            var files = entries.filter { $0.type == "file" }
            for folder in entries where folder.type == "dir" {
                files += try await visit(folder.path)
            }
            return files
        }
        return try await visit(AttachmentLinks.directory(issueNumber: issueNumber))
    }

    public func downloadAttachment(path: String) async throws -> Data {
        let response = try await send(contentsPath(path), accept: "application/vnd.github.raw+json")
        // 일부 응답은 raw를 요청해도 Contents JSON을 돌려준다.
        if (response.http.value(forHTTPHeaderField: "content-type") ?? "").contains("application/json"),
           let payload = try? JSONSerialization.jsonObject(with: response.data) as? [String: Any],
           let content = payload["content"] as? String, payload["encoding"] as? String == "base64",
           let decoded = Data(base64Encoded: content.filter { !$0.isWhitespace }) {
            return decoded
        }
        return response.data
    }

    public func deleteAttachment(path: String, sha: String, name: String) async throws {
        _ = try await send(contentsPath(path, ref: false), method: "DELETE", json: [
            "message": "Delete Ginote attachment: \(name)", "sha": sha, "branch": AttachmentLinks.branch
        ])
    }

    public func purgeAttachments(issueNumber: Int) async throws -> Int {
        let files = try await listAllAttachmentFiles(issueNumber: issueNumber)
        for file in files { try await deleteAttachment(path: file.path, sha: file.sha, name: file.name) }
        return files.count
    }

    // MARK: - 전사 단어

    public func loadVoiceHints() async throws -> String {
        do {
            let response = try await send(contentsPath(Self.voiceHintsPath))
            guard let payload = try JSONSerialization.jsonObject(with: response.data) as? [String: Any],
                  let content = payload["content"] as? String,
                  let data = Data(base64Encoded: content.filter { !$0.isWhitespace }),
                  let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return "" }
            return parsed["hints"] as? String ?? ""
        } catch let error as GitHubError where error.status == 404 {
            return ""
        }
    }

    public func saveVoiceHints(_ hints: String) async throws -> String {
        let value = JSText.trim(hints)
        try await ensureAttachmentBranch()
        var sha: String?
        do {
            let current: ShaObject = try await get(contentsPath(Self.voiceHintsPath))
            sha = current.sha
        } catch let error as GitHubError where error.status == 404 {}
        let json = try JSONSerialization.data(withJSONObject: ["version": 1, "hints": value], options: [.prettyPrinted, .sortedKeys])
        var payload: [String: Any] = [
            "message": "Update Ginote voice transcription hints",
            "content": (json + Data("\n".utf8)).base64EncodedString(),
            "branch": AttachmentLinks.branch
        ]
        if let sha { payload["sha"] = sha }
        _ = try await send(contentsPath(Self.voiceHintsPath, ref: false), method: "PUT", json: payload)
        return value
    }
}
