import Foundation
import GinoteCore

/// 화면 모델 테스트용 메모리 GitHub. `GitHubClient.sessionOverride`로 끼우면 api.github.com 요청을 여기서 받는다.
/// 이슈·라벨·댓글과 개수(GraphQL·검색)를 흉내 낸다. `freezeCounts()`를 부르면 개수를 그 시점 값으로 묶어,
/// 쓰기 직후 GitHub 개수가 늦게 따라오는 상황을 만든다.
final class FakeGitHub: URLProtocol {
    static let repo = "tester/notes"
    private static let lock = NSLock()
    nonisolated(unsafe) private static var issues: [Int: [String: Any]] = [:]
    nonisolated(unsafe) private static var labels: [String: String] = [:]
    nonisolated(unsafe) private static var comments: [Int: [[String: Any]]] = [:]
    nonisolated(unsafe) private static var nextNumber = 1
    nonisolated(unsafe) private static var nextCommentId = 1
    nonisolated(unsafe) private static var clock = 0
    nonisolated(unsafe) private static var frozen: (notes: Int, trash: Int, labels: [String: Int])?
    nonisolated(unsafe) static var requests: [String] = []

    static var session: URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [FakeGitHub.self]
        return URLSession(configuration: configuration)
    }

    static func reset() {
        lock.withLock {
            issues = [:]; labels = [:]; comments = [:]; nextNumber = 1; nextCommentId = 1; clock = 0; frozen = nil; requests = []
        }
    }

    /// 열린 노트를 만든다. 번호를 돌려준다.
    @discardableResult
    static func addIssue(title: String, body: String = "", labels names: [String] = [], state: String = "open") -> Int {
        lock.withLock {
            for name in names where labels[name] == nil { labels[name] = "" }
            let number = nextNumber
            nextNumber += 1
            issues[number] = makeIssue(number: number, title: title, body: body, labels: names, state: state)
            return number
        }
    }

    static func addLabel(_ name: String) { lock.withLock { labels[name] = labels[name] ?? "" } }

    static func issue(_ number: Int) -> [String: Any]? { lock.withLock { issues[number] } }
    static func state(_ number: Int) -> String? { issue(number)?["state"] as? String }
    static func labelNames(_ number: Int) -> [String] {
        ((issue(number)?["labels"] as? [[String: Any]]) ?? []).compactMap { $0["name"] as? String }
    }
    static var openCount: Int { lock.withLock { issues.values.filter { $0["state"] as? String == "open" }.count } }

    /// 지금 개수로 묶는다. 이후 쓰기는 이슈에는 반영되지만 개수(GraphQL·검색 total_count)는 그대로다.
    static func freezeCounts() { lock.withLock { frozen = countsUnlocked() } }
    static func unfreezeCounts() { lock.withLock { frozen = nil } }

    // MARK: - URLProtocol

    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "api.github.com" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func stopLoading() {}

    override func startLoading() {
        let (status, payload, headers) = Self.lock.withLock { Self.route(request) }
        let data = (try? JSONSerialization.data(withJSONObject: payload, options: [.fragmentsAllowed])) ?? Data()
        var fields = ["Content-Type": "application/json"]
        fields.merge(headers) { $1 }
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: fields)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }

    // MARK: - 라우팅 (lock 안에서 부른다)

    private static func route(_ request: URLRequest) -> (Int, Any, [String: String]) {
        let url = request.url!
        let method = request.httpMethod ?? "GET"
        let path = url.path
        let query = Dictionary(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.map { ($0.name, $0.value ?? "") } ?? [],
                               uniquingKeysWith: { $1 })
        let body = bodyJSON(request)
        requests.append("\(method) \(path)")
        let base = "/repos/\(repo)"
        let parts = path.split(separator: "/").map(String.init)

        if path == "/user" { return (200, ["login": "tester"], [:]) }
        if path == base { return (200, ["full_name": repo, "private": true, "default_branch": "main"], [:]) }
        if path == "/graphql" { return (200, graphCounts(), [:]) }
        if path == "/search/issues" { return search(query) }
        if path.hasPrefix("\(base)/git/ref/") { return (200, ["ref": "refs/heads/ginote-assets"], [:]) }
        if path.hasPrefix("\(base)/contents") { return (404, ["message": "Not Found"], [:]) }

        // /repos/o/r/labels[/name]
        if path == "\(base)/labels" {
            if method == "POST", let name = body["name"] as? String {
                labels[name] = body["description"] as? String ?? ""
                return (201, labelJSON(name), [:])
            }
            return (200, labels.keys.sorted().map(labelJSON), [:])
        }
        if path.hasPrefix("\(base)/labels/") {
            let name = parts.last!.removingPercentEncoding ?? parts.last!
            if method == "DELETE" { labels[name] = nil; return (204, NSNull(), [:]) }
            guard labels[name] != nil else { return (404, ["message": "Not Found"], [:]) }
            return (200, labelJSON(name), [:])
        }

        // /repos/o/r/issues/comments/ID
        if path.hasPrefix("\(base)/issues/comments/"), let id = Int(parts.last!) {
            for (number, list) in comments {
                guard let index = list.firstIndex(where: { $0["id"] as? Int == id }) else { continue }
                if method == "DELETE" { comments[number]!.remove(at: index); return (204, NSNull(), [:]) }
                tick()
                comments[number]![index]["body"] = body["body"] as? String ?? ""
                comments[number]![index]["updated_at"] = now()
                return (200, comments[number]![index], [:])
            }
            return (404, ["message": "Not Found"], [:])
        }

        // /repos/o/r/issues
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

        // /repos/o/r/issues/N[/labels[/name] | /comments]
        guard parts.count >= 5, parts[3] == "issues", let number = Int(parts[4]), var issue = issues[number] else {
            return (404, ["message": "Not Found"], [:])
        }
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
            var names = ((issue["labels"] as? [[String: Any]]) ?? []).compactMap { $0["name"] as? String }
            if method == "POST" {
                for name in body["labels"] as? [String] ?? [] where !names.contains(name) {
                    names.append(name)
                    if labels[name] == nil { labels[name] = "" }
                }
            } else if method == "DELETE", parts.count == 7 {
                let name = parts[6].removingPercentEncoding ?? parts[6]
                names.removeAll { $0 == name }
            }
            tick()
            issue["labels"] = names.map(labelJSON)
            issue["updated_at"] = now()
            issues[number] = issue
            return (200, names.map(labelJSON), [:])
        }
        if parts[5] == "comments" {
            if method == "POST" {
                tick()
                let comment: [String: Any] = ["id": nextCommentId, "body": body["body"] as? String ?? "", "user": ["login": "tester"],
                                              "created_at": now(), "updated_at": now()]
                nextCommentId += 1
                comments[number, default: []].append(comment)
                return (201, comment, [:])
            }
            return (200, comments[number] ?? [], [:])
        }
        return (404, ["message": "Not Found"], [:])
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
        let matched = expiredOnly ? [] : issues.values.filter { issue in
            guard issue["state"] as? String == state else { return false }
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

    private static func makeIssue(number: Int, title: String, body: String, labels names: [String], state: String) -> [String: Any] {
        tick()
        return ["id": 100_000 + number, "number": number, "title": title, "body": body, "state": state,
                "labels": names.map(labelJSON), "created_at": now(), "updated_at": now(),
                "closed_at": state == "closed" ? now() as Any : NSNull(), "comments": 0, "user": ["login": "tester"]]
    }

    private static func labelJSON(_ name: String) -> [String: Any] {
        ["name": name, "color": "888888", "description": labels[name] ?? ""]
    }

    private static func names(of issue: [String: Any]) -> [String] {
        ((issue["labels"] as? [[String: Any]]) ?? []).compactMap { $0["name"] as? String }
    }

    private static func tick() { clock += 1 }

    /// 쓰기마다 1초씩 흐르는 시계. 목록의 updated_at 정렬이 결정적이 된다.
    private static func now() -> String {
        let date = Date(timeIntervalSince1970: 1_790_000_000 + Double(clock))
        return ISO8601DateFormatter().string(from: date)
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
