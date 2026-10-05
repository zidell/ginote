import Foundation
import XCTest
@testable import GinoteCore

/// OpenAI 전사·정제·모델 목록 요청을 가짜 OpenAI로 검사한다.
final class OpenAIVoiceClientTests: XCTestCase {
    var client: OpenAIVoiceClient!

    override func setUp() {
        FakeOpenAI.reset()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [FakeOpenAI.self]
        client = OpenAIVoiceClient(apiKey: "sk-test", session: URLSession(configuration: configuration))
    }

    func testTranscribeSendsMultipartWithLanguageAndHints() async throws {
        FakeOpenAI.reply = ["text": "  안녕하세요  "]
        let text = try await client.transcribe(audio: Data("AUDIO".utf8), fileName: "v.m4a", mimeType: "audio/mp4",
                                               model: "gpt-transcribe", language: "ko-KR", hints: " 지노트 ")
        XCTAssertEqual(text, "안녕하세요")
        let request = try XCTUnwrap(FakeOpenAI.lastRequest)
        XCTAssertEqual(request.url?.path, "/v1/audio/transcriptions")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer sk-test")
        let body = String(decoding: FakeOpenAI.lastBody, as: UTF8.self)
        XCTAssertTrue(body.contains("name=\"language\"\r\n\r\nko\r\n"))
        XCTAssertTrue(body.contains("name=\"prompt\"\r\n\r\n지노트\r\n"))
        XCTAssertTrue(body.contains("filename=\"v.m4a\""))
        XCTAssertTrue(body.contains("AUDIO"))
    }

    func testTranscribeWithoutLanguageOrHints() async throws {
        FakeOpenAI.reply = [:]
        let text = try await client.transcribe(audio: Data(), fileName: "v.m4a", mimeType: "audio/mp4", model: "m", language: nil, hints: "")
        XCTAssertEqual(text, "")
        let body = String(decoding: FakeOpenAI.lastBody, as: UTF8.self)
        XCTAssertFalse(body.contains("name=\"language\""))
        XCTAssertFalse(body.contains("name=\"prompt\""))
    }

    func testListModels() async throws {
        FakeOpenAI.reply = ["data": [["id": "gpt-transcribe"], ["id": ""], ["object": "x"]]]
        let models = try await client.listModels()
        XCTAssertEqual(models, ["gpt-transcribe"])
    }

    func testRefineParsesStructuredReply() async throws {
        let content = #"{"title":"회의","body":"정리된 본문","tags":["Bug","없는태그"]}"#
        FakeOpenAI.reply = ["choices": [["message": ["content": content]]]]
        let result = try await client.refine(transcript: "원문", rules: " 규칙 ", model: "gpt-5",
                                             tags: [.init(name: "bug", description: "결함"), .init(name: " "), .init(name: "BUG")])
        XCTAssertEqual(result.title, "회의")
        XCTAssertEqual(result.body, "정리된 본문")
        XCTAssertEqual(result.tags, ["bug"], "후보에 있는 태그만, 후보의 표기로")
        let sent = try XCTUnwrap(JSONSerialization.jsonObject(with: FakeOpenAI.lastBody) as? [String: Any])
        XCTAssertEqual(sent["model"] as? String, "gpt-5")
        XCTAssertNotNil(sent["response_format"])
    }

    func testRefineWithoutChoicesKeepsTranscript() async throws {
        FakeOpenAI.reply = [:]
        let result = try await client.refine(transcript: "그대로", rules: "", model: "m", tags: [])
        XCTAssertEqual(result.body, "그대로")
    }

    func testErrorsUseOpenAIMessageOrDefault() async {
        FakeOpenAI.status = 401
        FakeOpenAI.reply = ["error": ["message": "Incorrect API key provided"]]
        do { _ = try await client.listModels(); XCTFail() } catch let error as GitHubError {
            XCTAssertEqual(error.status, 401)
            XCTAssertEqual(error.message, "Incorrect API key provided")
        } catch { XCTFail("\(error)") }

        FakeOpenAI.status = 500
        FakeOpenAI.reply = [:]
        do { _ = try await client.listModels(); XCTFail() } catch let error as GitHubError {
            XCTAssertTrue(error.message.contains("500"))
        } catch { XCTFail("\(error)") }
    }

    func testDefaultSessionIsShared() {
        XCTAssertTrue(OpenAIVoiceClient(apiKey: "k").session === URLSession.shared)
    }
}

final class FakeOpenAI: URLProtocol {
    nonisolated(unsafe) static var reply: [String: Any] = [:]
    nonisolated(unsafe) static var status = 200
    nonisolated(unsafe) static var lastRequest: URLRequest?
    nonisolated(unsafe) static var lastBody = Data()

    static func reset() { reply = [:]; status = 200; lastRequest = nil; lastBody = Data() }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func stopLoading() {}

    override func startLoading() {
        Self.lastRequest = request
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
        Self.lastBody = body
        let data = (try? JSONSerialization.data(withJSONObject: Self.reply)) ?? Data()
        let response = HTTPURLResponse(url: request.url!, statusCode: Self.status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }
}
