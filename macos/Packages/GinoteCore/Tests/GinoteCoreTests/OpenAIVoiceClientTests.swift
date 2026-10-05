import Foundation
import GinoteTestSupport
import XCTest
@testable import GinoteCore

/// OpenAI 전사·정제·모델 목록 요청을 가짜 OpenAI로 검사한다.
final class OpenAIVoiceClientTests: XCTestCase {
    var client: OpenAIVoiceClient!

    override func setUp() {
        FakeOpenAI.reset()
        client = OpenAIVoiceClient(apiKey: "sk-test", session: FakeOpenAI.session)
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

    func testDefaultSessionIsSharedUnlessOverridden() {
        XCTAssertTrue(OpenAIVoiceClient(apiKey: "k").session === URLSession.shared)
        let fake = FakeOpenAI.session
        OpenAIVoiceClient.sessionOverride = fake
        defer { OpenAIVoiceClient.sessionOverride = nil }
        XCTAssertTrue(OpenAIVoiceClient(apiKey: "k").session === fake)
    }

    func testQueuedRepliesPerPath() async throws {
        FakeOpenAI.answer("/v1/models", ["data": [["id": "first"]]])
        FakeOpenAI.answer("/v1/models", status: 500, ["error": ["message": "둘째 실패"]])
        let first = try await client.listModels()
        XCTAssertEqual(first, ["first"])
        do { _ = try await client.listModels(); XCTFail() } catch let error as GitHubError { XCTAssertEqual(error.message, "둘째 실패") }
        FakeOpenAI.reply = ["data": []]
        let fallback = try await client.listModels()
        XCTAssertEqual(fallback, [])
        XCTAssertEqual(FakeOpenAI.requests, ["/v1/models", "/v1/models", "/v1/models"])
    }
}
