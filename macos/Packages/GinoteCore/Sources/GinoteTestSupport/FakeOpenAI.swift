import Foundation

/// 테스트용 OpenAI. `OpenAIVoiceClient.sessionOverride = FakeOpenAI.session`으로 끼우면 api.openai.com 요청을 여기서 받는다.
/// 경로별 답(`replies`)이 있으면 그것을, 없으면 `reply`·`status`를 돌려준다. 받은 요청은 `requests`에 남는다.
public final class FakeOpenAI: URLProtocol {
    nonisolated(unsafe) public static var reply: [String: Any] = [:]
    nonisolated(unsafe) public static var status = 200
    /// 경로(`/v1/models` 등) → (상태, 본문). 같은 경로에 여러 답을 넣으면 차례로 하나씩 쓴다.
    nonisolated(unsafe) public static var replies: [String: [(Int, Any)]] = [:]
    nonisolated(unsafe) public static var lastRequest: URLRequest?
    nonisolated(unsafe) public static var lastBody = Data()
    nonisolated(unsafe) public static var requests: [String] = []
    private static let lock = NSLock()

    public static var session: URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [FakeOpenAI.self]
        return URLSession(configuration: configuration)
    }

    public static func reset() {
        lock.withLock { reply = [:]; status = 200; replies = [:]; lastRequest = nil; lastBody = Data(); requests = [] }
    }

    public static func answer(_ path: String, status: Int = 200, _ json: Any) {
        lock.withLock { replies[path, default: []].append((status, json)) }
    }

    override public class func canInit(with request: URLRequest) -> Bool { true }
    override public class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override public func stopLoading() {}

    override public func startLoading() {
        var body = request.httpBody ?? Data()
        if body.isEmpty, let stream = request.httpBodyStream {
            stream.open()
            var buffer = [UInt8](repeating: 0, count: 65_536)
            while stream.hasBytesAvailable {
                let read = stream.read(&buffer, maxLength: buffer.count)
                if read <= 0 { break }
                body.append(buffer, count: read)
            }
            stream.close()
        }
        let path = request.url?.path ?? ""
        let (code, payload): (Int, Any) = Self.lock.withLock {
            Self.lastRequest = request
            Self.lastBody = body
            Self.requests.append(path)
            if var queue = Self.replies[path], !queue.isEmpty {
                let next = queue.removeFirst()
                Self.replies[path] = queue.isEmpty ? nil : queue
                return next
            }
            return (Self.status, Self.reply)
        }
        let data = (try? JSONSerialization.data(withJSONObject: payload)) ?? Data()
        let response = HTTPURLResponse(url: request.url!, statusCode: code, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }
}
