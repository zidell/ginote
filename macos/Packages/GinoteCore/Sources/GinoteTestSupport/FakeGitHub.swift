import Foundation

/// 테스트용 메모리 GitHub. `GitHubClient.sessionOverride = FakeGitHub.session`으로 끼우면 api.github.com 요청을 여기서 받는다.
/// 이슈·라벨·댓글, 개수(GraphQL·검색), 첨부 브랜치와 파일(contents API), git 데이터 API를 흉내 낸다.
/// - `freezeCounts()`: 개수를 그 시점 값으로 묶어 쓰기 직후 GitHub 개수가 늦게 따라오는 상황을 만든다.
/// - `fail(_:status:message:times:)`: 경로에 맞는 요청을 정한 횟수만큼 오류로 답한다.
/// - `emptyRepository`: 커밋이 하나도 없는 저장소(git 데이터 API가 409, 브랜치 없음).
public final class FakeGitHub: URLProtocol {
    public static let repo = "tester/notes"
    public static let branch = "ginote-assets"

    private struct Failure { var pathContains: String; var method: String?; var status: Int; var message: String; var remaining: Int }
    private struct File { var data: Data; var sha: String }

    private static let lock = NSLock()
    nonisolated(unsafe) private static var issues: [Int: [String: Any]] = [:]
    nonisolated(unsafe) private static var labels: [String: String] = [:]
    nonisolated(unsafe) private static var comments: [Int: [[String: Any]]] = [:]
    nonisolated(unsafe) private static var files: [String: File] = [:]
    nonisolated(unsafe) private static var nextNumber = 1
    nonisolated(unsafe) private static var nextCommentId = 1
    nonisolated(unsafe) private static var clock = 0
    nonisolated(unsafe) private static var shaCounter = 0
    nonisolated(unsafe) private static var frozen: (notes: Int, trash: Int, labels: [String: Int])?
    nonisolated(unsafe) private static var failures: [Failure] = []
    nonisolated(unsafe) private static var overrides: [String: (Int, Any)] = [:]
    nonisolated(unsafe) private static var log: [String] = []
    nonisolated(unsafe) private static var branchExists = true
    nonisolated(unsafe) private static var isEmpty = false
    nonisolated(unsafe) private static var rawAsJSON = false

    public static var session: URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [FakeGitHub.self]
        return URLSession(configuration: configuration)
    }

    public static func reset() {
        lock.withLock {
            issues = [:]; labels = [:]; comments = [:]; files = [:]
            nextNumber = 1; nextCommentId = 1; clock = 0; shaCounter = 0
            frozen = nil; failures = []; overrides = [:]; log = []
            branchExists = true; isEmpty = false; rawAsJSON = false
        }
    }

    // MARK: - 상태 준비

    @discardableResult
    public static func addIssue(title: String, body: String = "", labels names: [String] = [], state: String = "open") -> Int {
        lock.withLock {
            for name in names where labels[name] == nil { labels[name] = "" }
            let number = nextNumber
            nextNumber += 1
            issues[number] = makeIssue(number: number, title: title, body: body, labels: names, state: state)
            return number
        }
    }

    public static func addLabel(_ name: String, description: String = "") { lock.withLock { labels[name] = description } }

    @discardableResult
    public static func addComment(to number: Int, body: String) -> Int {
        lock.withLock { addCommentUnlocked(number, body: body)["id"] as! Int }
    }

    public static func putFile(_ path: String, data: Data) { lock.withLock { files[path] = File(data: data, sha: nextSha()) } }

    /// 첨부 브랜치가 아직 없는 저장소.
    public static var attachmentBranchExists: Bool {
        get { lock.withLock { branchExists } }
        set { lock.withLock { branchExists = newValue } }
    }

    /// 커밋이 하나도 없는 빈 저장소. 기본 브랜치도 첨부 브랜치도 없다.
    public static var emptyRepository: Bool {
        get { lock.withLock { isEmpty } }
        set { lock.withLock { isEmpty = newValue; if newValue { branchExists = false } } }
    }

    /// raw로 요청한 파일을 Contents JSON(base64)으로 답한다(GitHub가 가끔 그렇게 답한다).
    public static var answerRawAsJSON: Bool {
        get { lock.withLock { rawAsJSON } }
        set { lock.withLock { rawAsJSON = newValue } }
    }

    /// 이 경로(정확히 같은 path)의 응답을 통째로 바꾼다. 깨진 응답을 흉내 낼 때 쓴다.
    public static func override(_ path: String, status: Int = 200, json: Any) { lock.withLock { overrides[path] = (status, json) } }

    public static func fail(_ pathContains: String, method: String? = nil, status: Int, message: String = "", times: Int = 1) {
        lock.withLock { failures.append(Failure(pathContains: pathContains, method: method, status: status, message: message, remaining: times)) }
    }

    // MARK: - 상태 읽기

    public static func issue(_ number: Int) -> [String: Any]? { lock.withLock { issues[number] } }
    public static func state(_ number: Int) -> String? { issue(number)?["state"] as? String }
    public static func title(_ number: Int) -> String? { issue(number)?["title"] as? String }
    public static func body(_ number: Int) -> String? { issue(number)?["body"] as? String }
    public static func labelNames(_ number: Int) -> [String] {
        ((issue(number)?["labels"] as? [[String: Any]]) ?? []).compactMap { $0["name"] as? String }
    }
    public static func commentBodies(_ number: Int) -> [String] { lock.withLock { (comments[number] ?? []).compactMap { $0["body"] as? String } } }
    public static var labelList: [String] { lock.withLock { labels.keys.sorted() } }
    public static func labelDescription(_ name: String) -> String? { lock.withLock { labels[name] } }
    public static var openCount: Int { lock.withLock { issues.values.filter { $0["state"] as? String == "open" }.count } }
    public static func file(_ path: String) -> Data? { lock.withLock { files[path]?.data } }
    public static var filePaths: [String] { lock.withLock { files.keys.sorted() } }
    public static var requests: [String] { lock.withLock { log } }

    public static func freezeCounts() { lock.withLock { frozen = countsUnlocked() } }
    public static func unfreezeCounts() { lock.withLock { frozen = nil } }

    // MARK: - URLProtocol

    override public class func canInit(with request: URLRequest) -> Bool { request.url?.host == "api.github.com" }
    override public class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override public func stopLoading() {}

    override public func startLoading() {
        let (status, payload, headers) = Self.lock.withLock { Self.respond(request) }
        let data: Data
        if let raw = payload as? Data { data = raw } else {
            data = (try? JSONSerialization.data(withJSONObject: payload, options: [.fragmentsAllowed])) ?? Data()
        }
        var fields = ["Content-Type": payload is Data ? "application/octet-stream" : "application/json"]
        fields.merge(headers) { $1 }
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: fields)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }

    private static func respond(_ request: URLRequest) -> (Int, Any, [String: String]) {
        let method = request.httpMethod ?? "GET"
        let path = request.url!.path
        log.append("\(method) \(path)")
        if let index = failures.firstIndex(where: { path.contains($0.pathContains) && ($0.method == nil || $0.method == method) }) {
            let failure = failures[index]
            failures[index].remaining -= 1
            if failures[index].remaining <= 0 { failures.remove(at: index) }
            let message: Any = failure.message == "<empty>" ? "" as Any : failure.message.isEmpty ? NSNull() as Any : failure.message as Any
            return (failure.status, ["message": message], ["x-ratelimit-remaining": "0"])
        }
        if let (status, json) = overrides[path] { return (status, json, [:]) }
        return route(request, method: method, path: path)
    }

    // MARK: - 라우팅 (lock 안)

    private static func route(_ request: URLRequest, method: String, path: String) -> (Int, Any, [String: String]) {
        let url = request.url!
        let query = Dictionary(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.map { ($0.name, $0.value ?? "") } ?? [],
                               uniquingKeysWith: { $1 })
        let body = bodyJSON(request)
        let base = "/repos/\(repo)"
        let parts = path.split(separator: "/").map(String.init)
        let notFound: (Int, Any, [String: String]) = (404, ["message": "Not Found"], [:])

        if path == "/user" { return (200, ["login": "tester", "avatar_url": "https://example.com/a.png"], [:]) }
        if path == base { return (200, ["full_name": repo, "private": true, "default_branch": "main"], [:]) }
        if path == "/graphql" { return (200, graphCounts(), [:]) }
        if path == "/search/issues" { return search(query) }

        // git 데이터 API
        if path.hasPrefix("\(base)/git/ref/heads/") {
            let name = String(path.dropFirst("\(base)/git/ref/heads/".count))
            if name == branch { return branchExists ? (200, ["ref": "refs/heads/\(branch)"], [:]) : notFound }
            return isEmpty ? (409, ["message": "Git Repository is empty."], [:]) : (200, ["ref": "refs/heads/\(name)"], [:])
        }
        if path == "\(base)/git/trees" { return isEmpty ? (409, ["message": "Git Repository is empty."], [:]) : (201, ["sha": nextSha()], [:]) }
        if path == "\(base)/git/commits" { return (201, ["sha": nextSha()], [:]) }
        if path == "\(base)/git/refs" {
            if branchExists { return (422, ["message": "Reference already exists"], [:]) }
            branchExists = true
            return (201, ["ref": "refs/heads/\(branch)"], [:])
        }

        // contents API
        if path.hasPrefix("\(base)/contents/") {
            let filePath = String(path.dropFirst("\(base)/contents/".count)).removingPercentEncoding ?? ""
            return contents(filePath, method: method, accept: request.value(forHTTPHeaderField: "Accept") ?? "", body: body)
        }

        // 라벨
        if path == "\(base)/labels" {
            if method == "POST", let name = body["name"] as? String {
                if labels[name] != nil { return (422, ["message": "Validation Failed"], [:]) }
                labels[name] = body["description"] as? String ?? ""
                return (201, labelJSON(name), [:])
            }
            return (200, labels.keys.sorted().map(labelJSON), [:])
        }
        if path.hasPrefix("\(base)/labels/") {
            let name = parts.last!.removingPercentEncoding ?? parts.last!
            guard labels[name] != nil else { return notFound }
            if method == "DELETE" {
                labels[name] = nil
                for (number, var issue) in issues {
                    issue["labels"] = names(of: issue).filter { $0 != name }.map(labelJSON)
                    issues[number] = issue
                }
                return (204, NSNull(), [:])
            }
            if method == "PATCH" {
                let newName = body["new_name"] as? String ?? name
                let description = body["description"] as? String ?? labels[name] ?? ""
                labels[name] = nil
                labels[newName] = description
                for (number, var issue) in issues {
                    issue["labels"] = names(of: issue).map { $0 == name ? newName : $0 }.map(labelJSON)
                    issues[number] = issue
                }
                return (200, labelJSON(newName), [:])
            }
            return (200, labelJSON(name), [:])
        }

        // 댓글 하나
        if path.hasPrefix("\(base)/issues/comments/"), let id = Int(parts.last!) {
            for (number, list) in comments {
                guard let index = list.firstIndex(where: { $0["id"] as? Int == id }) else { continue }
                if method == "DELETE" { comments[number]!.remove(at: index); return (204, NSNull(), [:]) }
                tick()
                comments[number]![index]["body"] = body["body"] as? String ?? ""
                comments[number]![index]["updated_at"] = now()
                return (200, comments[number]![index], [:])
            }
            return notFound
        }

        // 이슈 목록·만들기
        if path == "\(base)/issues" {
            if method == "POST" {
                let number = nextNumber
                nextNumber += 1
                let names = body["labels"] as? [String] ?? []
                for name in names where labels[name] == nil { labels[name] = "" }
                issues[number] = makeIssue(number: number, title: body["title"] as? String ?? "", body: body["body"] as? String ?? "",
                                           labels: names, state: "open")
                return (201, issues[number]!, [:])
            }
            return listIssues(query)
        }

        // 이슈 하나와 그 하위
        guard parts.count >= 5, parts[3] == "issues", let number = Int(parts[4]), var issue = issues[number] else { return notFound }
        if parts.count == 5 {
            if method == "PATCH" {
                tick()
                if let title = body["title"] as? String { issue["title"] = title }
                if let text = body["body"] as? String { issue["body"] = text }
                if let names = body["labels"] as? [String] {
                    for name in names where labels[name] == nil { labels[name] = "" }
                    issue["labels"] = names.map(labelJSON)
                }
                if let state = body["state"] as? String {
                    issue["state"] = state
                    issue["closed_at"] = state == "closed" ? now() : NSNull()
                }
                issue["updated_at"] = now()
                issues[number] = issue
            }
            return (200, issue, [:])
        }
        if parts[5] == "labels" {
            var current = names(of: issue)
            if method == "POST" {
                for name in body["labels"] as? [String] ?? [] where !current.contains(name) {
                    current.append(name)
                    if labels[name] == nil { labels[name] = "" }
                }
            } else if method == "DELETE", parts.count == 7 {
                let name = parts[6].removingPercentEncoding ?? parts[6]
                current.removeAll { $0 == name }
            }
            tick()
            issue["labels"] = current.map(labelJSON)
            issue["updated_at"] = now()
            issues[number] = issue
            return (200, current.map(labelJSON), [:])
        }
        if parts[5] == "comments" {
            if method == "POST" { return (201, addCommentUnlocked(number, body: body["body"] as? String ?? ""), [:]) }
            let perPage = Int(query["per_page"] ?? "30") ?? 30
            let page = Int(query["page"] ?? "1") ?? 1
            let list = comments[number] ?? []
            let start = (page - 1) * perPage
            let slice = Array(list.dropFirst(start).prefix(perPage))
            let more = list.count > start + perPage
            return (200, slice, more ? ["Link": "<https://api.github.com/next>; rel=\"next\""] : [:])
        }
        return notFound
    }

    private static func contents(_ filePath: String, method: String, accept: String, body: [String: Any]) -> (Int, Any, [String: String]) {
        let notFound: (Int, Any, [String: String]) = (404, ["message": "Not Found"], [:])
        switch method {
        case "PUT":
            guard let content = body["content"] as? String, let data = Data(base64Encoded: content) else { return (422, ["message": "Invalid"], [:]) }
            if (body["branch"] as? String) == nil { isEmpty = false }
            if let existing = files[filePath], body["sha"] as? String != existing.sha { return (409, ["message": "sha mismatch"], [:]) }
            let sha = nextSha()
            files[filePath] = File(data: data, sha: sha)
            return (201, ["content": ["sha": sha, "size": data.count, "path": filePath, "html_url": "https://github.com/\(repo)/blob/\(branch)/\(filePath)"]], [:])
        case "DELETE":
            guard let existing = files[filePath], body["sha"] as? String == existing.sha else { return notFound }
            files[filePath] = nil
            return (200, ["commit": ["sha": nextSha()]], [:])
        default:
            if let file = files[filePath] {
                if accept.contains("raw"), !rawAsJSON { return (200, file.data, [:]) }
                return (200, ["name": (filePath as NSString).lastPathComponent, "path": filePath, "sha": file.sha, "size": file.data.count,
                              "type": "file", "encoding": "base64", "content": file.data.base64EncodedString(options: .lineLength76Characters)], [:])
            }
            let prefix = filePath.hasSuffix("/") ? filePath : filePath + "/"
            var entries: [String: [String: Any]] = [:]
            for (path, file) in files where path.hasPrefix(prefix) {
                let rest = path.dropFirst(prefix.count)
                if let slash = rest.firstIndex(of: "/") {
                    let name = String(rest[..<slash])
                    entries[name] = ["name": name, "path": prefix + name, "sha": "dir", "size": 0, "type": "dir"]
                } else {
                    entries[String(rest)] = ["name": String(rest), "path": path, "sha": file.sha, "size": file.data.count, "type": "file"]
                }
            }
            return entries.isEmpty ? notFound : (200, entries.keys.sorted().map { entries[$0]! }, [:])
        }
    }

    private static func listIssues(_ query: [String: String]) -> (Int, Any, [String: String]) {
        let state = query["state"] ?? "open"
        let label = query["labels"] ?? ""
        let perPage = Int(query["per_page"] ?? "30") ?? 30
        let page = Int(query["page"] ?? "1") ?? 1
        let matched = issues.values
            .filter { ($0["state"] as? String) == state && (label.isEmpty || names(of: $0).contains(label)) }
            .sorted { ($0["updated_at"] as? String ?? "") > ($1["updated_at"] as? String ?? "") }
        let start = (page - 1) * perPage
        let slice = Array(matched.dropFirst(start).prefix(perPage))
        let more = matched.count > start + perPage
        return (200, slice, more ? ["Link": "<https://api.github.com/next>; rel=\"next\""] : [:])
    }

    private static func search(_ query: [String: String]) -> (Int, Any, [String: String]) {
        var state = "open", label = "", expiredOnly = false
        var terms: [String] = []
        for token in tokenize(query["q"] ?? "") {
            if token == "is:open" { state = "open" } else if token == "is:closed" { state = "closed" }
            else if token.hasPrefix("label:") { label = String(token.dropFirst(6)).trimmingCharacters(in: CharacterSet(charactersIn: "\"")) }
            else if token.hasPrefix("closed:<") { expiredOnly = true }
            else if token.hasPrefix("repo:") || token.hasPrefix("is:") || token.hasPrefix("closed:") { continue }
            else { terms.append(token) }
        }
        let perPage = Int(query["per_page"] ?? "30") ?? 30
        if let frozen, perPage == 1, terms.isEmpty {
            let total = state == "closed" ? frozen.trash : label.isEmpty ? frozen.notes : frozen.labels[label] ?? 0
            return (200, ["total_count": total, "items": []], [:])
        }
        let matched = issues.values.filter { issue in
            guard issue["state"] as? String == state else { return false }
            if expiredOnly { return (issue["title"] as? String ?? "").contains("[expired]") }
            if !label.isEmpty, !names(of: issue).contains(label) { return false }
            let text = "\(issue["title"] as? String ?? "") \(issue["body"] as? String ?? "")"
            return terms.allSatisfy { text.localizedCaseInsensitiveContains($0) }
        }.sorted { ($0["updated_at"] as? String ?? "") > ($1["updated_at"] as? String ?? "") }
        return (200, ["total_count": matched.count, "items": Array(matched.prefix(perPage))], [:])
    }

    private static func graphCounts() -> Any {
        let counts = frozen ?? countsUnlocked()
        let nodes = labels.keys.sorted().map { name in ["name": name, "issues": ["totalCount": counts.labels[name] ?? 0]] as [String: Any] }
        return ["data": ["repository": ["issues": ["totalCount": counts.notes], "labels": ["nodes": nodes]]]]
    }

    private static func countsUnlocked() -> (notes: Int, trash: Int, labels: [String: Int]) {
        let open = issues.values.filter { $0["state"] as? String == "open" }
        var byLabel: [String: Int] = [:]
        for issue in open { for name in names(of: issue) { byLabel[name, default: 0] += 1 } }
        return (open.count, issues.values.filter { $0["state"] as? String == "closed" }.count, byLabel)
    }

    // MARK: - 도우미

    private static func addCommentUnlocked(_ number: Int, body: String) -> [String: Any] {
        tick()
        let comment: [String: Any] = ["id": nextCommentId, "body": body, "user": ["login": "tester"],
                                      "created_at": now(), "updated_at": now(), "html_url": "https://github.com/\(repo)/issues/\(number)"]
        nextCommentId += 1
        comments[number, default: []].append(comment)
        return comment
    }

    private static func makeIssue(number: Int, title: String, body: String, labels names: [String], state: String) -> [String: Any] {
        tick()
        return ["id": 100_000 + number, "number": number, "title": title, "body": body, "state": state,
                "labels": names.map(labelJSON), "created_at": now(), "updated_at": now(),
                "closed_at": state == "closed" ? now() as Any : NSNull(), "comments": 0, "user": ["login": "tester"],
                "html_url": "https://github.com/\(repo)/issues/\(number)"]
    }

    private static func labelJSON(_ name: String) -> [String: Any] {
        ["name": name, "color": "888888", "description": labels[name] ?? ""]
    }

    private static func names(of issue: [String: Any]) -> [String] {
        ((issue["labels"] as? [[String: Any]]) ?? []).compactMap { $0["name"] as? String }
    }

    private static func nextSha() -> String { shaCounter += 1; return String(format: "%040x", shaCounter) }
    private static func tick() { clock += 1 }

    /// 쓰기마다 1초씩 흐르는 시계. 목록의 updated_at 정렬이 결정적이 된다.
    private static func now() -> String {
        ISO8601DateFormatter().string(from: Date(timeIntervalSince1970: 1_790_000_000 + Double(clock)))
    }

    private static func tokenize(_ query: String) -> [String] {
        var tokens: [String] = [], current = "", quoted = false
        for character in query {
            if character == "\"" { quoted.toggle(); current.append(character) }
            else if character == " ", !quoted { if !current.isEmpty { tokens.append(current) }; current = "" }
            else { current.append(character) }
        }
        if !current.isEmpty { tokens.append(current) }
        return tokens
    }

    private static func bodyJSON(_ request: URLRequest) -> [String: Any] {
        var data = request.httpBody
        if data == nil, let stream = request.httpBodyStream {
            stream.open()
            var buffer = [UInt8](repeating: 0, count: 65_536)
            var collected = Data()
            while stream.hasBytesAvailable {
                let read = stream.read(&buffer, maxLength: buffer.count)
                if read <= 0 { break }
                collected.append(buffer, count: read)
            }
            stream.close()
            data = collected
        }
        guard let data, let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
        return object
    }
}
