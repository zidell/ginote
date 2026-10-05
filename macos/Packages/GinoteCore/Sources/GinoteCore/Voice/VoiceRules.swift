import Foundation

extension VoicePresets {
    static let upgraded: [String: String] = {
        var map: [String: String] = [:]
        for prompt in supersededTypoPrompts { map[JSText.trim(prompt)] = typoCorrectionPrompt }
        for prompt in supersededWrittenPrompts { map[JSText.trim(prompt)] = writtenStylePrompt }
        for prompt in supersededConclusionPrompts { map[JSText.trim(prompt)] = conclusionFocusedPrompt }
        return map
    }()

    /// 손대지 않은 예전 프리셋 문구면 같은 프리셋의 새 문구로 올린다. 직접 고친 규칙은 그대로 둔다.
    public static func upgrade(_ prompt: String) -> String {
        let saved = JSText.trim(prompt)
        if saved.isEmpty { return defaultRefinementPrompt }
        return upgraded[saved] ?? saved
    }

    public static func isDatedSnapshot(_ model: String) -> Bool {
        JSText.firstMatch(JSText.trim(model), #"-\d{4}-\d{2}-\d{2}(?:$|[-_])"#) != nil
    }

    /// OpenAI 모델 목록을 전사용·정제용으로 나눈다. 날짜가 붙은 스냅샷은 뺀다.
    public static func classify(_ modelIds: [String]) -> (transcription: [String], refinement: [String]) {
        let sorted = Array(Set(modelIds.filter { !isDatedSnapshot($0) })).sorted { $0.compare($1, locale: Locale(identifier: "en")) == .orderedAscending }
        let transcription = sorted.filter { JSText.firstMatch($0, #"(?:^|-)transcribe(?:-|$)|^whisper-"#) != nil }
        let refinement = sorted.filter {
            JSText.firstMatch($0, #"^(gpt-(?:4|5)|o[1-4])"#) != nil
                && JSText.firstMatch($0, "(audio|realtime|transcribe|tts|image|moderation|embedding)") == nil
        }
        return (transcription, refinement)
    }

    public static func maskAPIKey(_ value: String) -> String {
        if value.isEmpty { return "" }
        let characters = Array(value)
        if characters.count <= 20 { return "••••••••••••" }
        return "\(String(characters.prefix(10)))...\(String(characters.suffix(10)))"
    }
}

/// 음성 기록 결과를 노트로 만드는 규칙. 웹 `src/lib/voice-notes.js`.
public enum VoiceNotes {
    public static let fallbackTitle = "음성 기록"

    public static func normalizeParagraphs(_ body: String) -> String {
        var text = JSText.replace(body, #"\r\n?"#, "\n")
        text = JSText.replace(text, #"\n+"#, "\n\n")
        return JSText.trim(text)
    }

    public static func normalizeSuggestedTitle(_ title: String) -> String {
        JSText.prefixUTF16(JSText.trim(JSText.replace(title, #"\s+"#, " ")), 50)
    }

    public static func knownTagNames(_ selected: [String], labels: [String]) -> [String] {
        selected.filter { name in labels.contains { $0.lowercased() == name.lowercased() } }
    }

    /// 음성으로 새 노트를 만들 때의 제목과 본문.
    public static func composeIssue(titleMode: TitleMode, body: String, suggestedTitle: String) -> (title: String, body: String) {
        let issueBody = titleMode == .firstLine && !body.isEmpty && !suggestedTitle.isEmpty ? "\(suggestedTitle)\n\n\(body)" : body
        let title: String
        if titleMode == .separate {
            title = [suggestedTitle, NoteText.automaticTitle(body)].first { !$0.isEmpty } ?? fallbackTitle
        } else {
            let automatic = NoteText.automaticTitle(issueBody)
            title = automatic.isEmpty ? fallbackTitle : automatic
        }
        return (title, issueBody)
    }

    public static func audioFileName(now: Date = Date(), fileExtension: String = "m4a") -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let stamp = formatter.string(from: now).replacingOccurrences(of: ":", with: "-").replacingOccurrences(of: ".", with: "-")
        return "voice-\(stamp).\(fileExtension)"
    }

    /// 댓글에 넣는 원본 음성 표기. 웹이 쓰는 형식 그대로다.
    public static func audioLink(repo: String, path: String) -> String {
        let url = AttachmentLinks.rawURL(repo: repo, path: path)
        return "<audio controls preload=\"metadata\" src=\"\(url)\"><a href=\"\(url)\">🎙 원본 음성 다운로드</a></audio>"
    }

    static let audioPattern = #"<audio\b[^>]*>[\s\S]*?</audio>"#

    /// 편집 화면에서 숨기는 `<audio>` 표기를 떼어 낸다.
    public static func splitAudio(_ body: String) -> (text: String, audio: [String]) {
        let matches = JSText.matches(body, audioPattern, options: .caseInsensitive)
        let audio = matches.compactMap { JSText.group($0, 0, in: body) }
        guard !audio.isEmpty else { return (body, []) }
        let text = JSText.trim(JSText.replace(JSText.replace(body, audioPattern, "", options: .caseInsensitive), #"\n{3,}"#, "\n\n"))
        return (text, audio)
    }

    public static func audioSources(_ markup: String) -> [String] {
        JSText.matches(markup, #"<audio\b[^>]*\bsrc="([^"]+)""#, options: .caseInsensitive).compactMap { JSText.group($0, 1, in: markup) }
    }
}

/// OpenAI 전사·정제·모델 목록. 웹 `src/lib/openai-voice.js`와 같은 요청을 보낸다.
public struct OpenAIVoiceClient: Sendable {
    static let root = "https://api.openai.com/v1"
    public let apiKey: String
    let session: URLSession

    public init(apiKey: String, session: URLSession = .shared) {
        self.apiKey = apiKey
        self.session = session
    }

    public struct Refinement: Equatable, Sendable {
        public var title: String
        public var body: String
        public var tags: [String]

        public init(title: String, body: String, tags: [String]) {
            self.title = title; self.body = body; self.tags = tags
        }
    }

    public struct TagCandidate: Sendable {
        public var name: String
        public var description: String
        public init(name: String, description: String = "") { self.name = name; self.description = description }
    }

    func perform(_ request: URLRequest) async throws -> [String: Any] {
        var request = request
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        let payload = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        guard (200..<300).contains(status) else {
            let message = (payload["error"] as? [String: Any])?["message"] as? String
            throw GitHubError(status: status, message: message?.isEmpty == false ? message! : "OpenAI 요청에 실패했습니다. (\(status))")
        }
        return payload
    }

    /// `language`는 ISO 639-1 코드(예: "ko")로 줄여 보낸다.
    public func transcribe(audio: Data, fileName: String, mimeType: String, model: String, language: String?, hints: String) async throws -> String {
        let boundary = "ginote-\(UUID().uuidString)"
        var body = Data()
        func field(_ name: String, _ value: String) {
            body.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n\(value)\r\n".utf8))
        }
        field("model", model)
        let languageHint = (language ?? "").trimmingCharacters(in: .whitespaces).split(separator: "-").first.map { $0.lowercased() } ?? ""
        if !languageHint.isEmpty { field("language", languageHint) }
        let trimmedHints = JSText.trim(hints)
        if !trimmedHints.isEmpty { field("prompt", trimmedHints) }
        field("response_format", "json")
        body.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(fileName)\"\r\nContent-Type: \(mimeType)\r\n\r\n".utf8))
        body.append(audio)
        body.append(Data("\r\n--\(boundary)--\r\n".utf8))

        var request = URLRequest(url: URL(string: "\(Self.root)/audio/transcriptions")!)
        request.httpMethod = "POST"
        request.timeoutInterval = 600
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        let payload = try await perform(request)
        return JSText.trim(payload["text"] as? String ?? "")
    }

    public func listModels() async throws -> [String] {
        let payload = try await perform(URLRequest(url: URL(string: "\(Self.root)/models")!))
        return (payload["data"] as? [[String: Any]] ?? []).compactMap { $0["id"] as? String }.filter { !$0.isEmpty }
    }

    public static func systemPrompt(rules: String) -> String {
        VoicePresets.systemPromptPrefix + rules + VoicePresets.systemPromptSuffix
    }

    /// 웹의 `JSON.stringify(availableTags)`와 같은 글자를 만든다.
    public static func userInput(transcript: String, tags: [TagCandidate]) -> String {
        let json = "[" + normalize(tags).map { tag in
            var fields = ["\"name\":\(AppConfig.jsonQuoted(tag.name))"]
            if !tag.description.isEmpty { fields.append("\"description\":\(AppConfig.jsonQuoted(tag.description))") }
            return "{" + fields.joined(separator: ",") + "}"
        }.joined(separator: ",") + "]"
        return VoicePresets.userInputPrefix + json + VoicePresets.userInputMiddle + transcript + VoicePresets.userInputSuffix
    }

    static func normalize(_ tags: [TagCandidate]) -> [TagCandidate] {
        var seen = Set<String>()
        var result: [TagCandidate] = []
        for tag in tags {
            let name = JSText.trim(tag.name)
            guard !name.isEmpty, seen.insert(name.lowercased()).inserted else { continue }
            result.append(TagCandidate(name: name, description: JSText.trim(tag.description)))
        }
        return result
    }

    public func refine(transcript: String, rules: String, model: String, tags: [TagCandidate]) async throws -> Refinement {
        let candidates = Self.normalize(tags)
        let responseFormat = try JSONSerialization.jsonObject(with: Data(VoicePresets.responseFormatJSON.utf8))
        var request = URLRequest(url: URL(string: "\(Self.root)/chat/completions")!)
        request.httpMethod = "POST"
        request.timeoutInterval = 600
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "model": model,
            "messages": [
                ["role": "system", "content": Self.systemPrompt(rules: JSText.trim(rules))],
                ["role": "user", "content": Self.userInput(transcript: transcript, tags: candidates)]
            ],
            "response_format": responseFormat
        ])
        let payload = try await perform(request)
        let content = ((payload["choices"] as? [[String: Any]])?.first?["message"] as? [String: Any])?["content"] as? String ?? transcript
        return Self.parseRefinement(content, tags: candidates.map(\.name))
    }

    public static func parseRefinement(_ content: String, tags: [String]) -> Refinement {
        let fallback = Refinement(title: "", body: JSText.trim(content), tags: [])
        guard let parsed = (try? JSONSerialization.jsonObject(with: Data(content.utf8))) as? [String: Any],
              let rawBody = parsed["body"] as? String else { return fallback }
        let known = Dictionary(tags.map { ($0.lowercased(), $0) }, uniquingKeysWith: { first, _ in first })
        var selected: [String] = []
        for name in parsed["tags"] as? [Any] ?? [] {
            if let match = known[String(describing: name).lowercased()], !selected.contains(match) { selected.append(match) }
        }
        let body = JSText.trim(rawBody)
        let title = !body.isEmpty ? JSText.prefixUTF16(JSText.trim(JSText.replace(parsed["title"] as? String ?? "", #"\s+"#, " ")), 50) : ""
        return Refinement(title: title, body: body, tags: selected)
    }
}
