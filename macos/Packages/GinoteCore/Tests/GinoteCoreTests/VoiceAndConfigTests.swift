import Foundation
import XCTest
@testable import GinoteCore

final class VoiceAndConfigTests: XCTestCase {
    var voice: [String: Any] {
        (WebCompatibilityTests.fixture["deterministic"] as! [String: Any])["voice"] as! [String: Any]
    }

    func testVoiceRulesMatchWeb() {
        for case let item as [String: String] in voice["paragraphs"] as! [Any] {
            XCTAssertEqual(VoiceNotes.normalizeParagraphs(item["input"]!), item["output"])
        }
        for case let item as [String: String] in voice["titles"] as! [Any] {
            XCTAssertEqual(VoiceNotes.normalizeSuggestedTitle(item["input"]!), item["output"])
        }
        for case let item as [String: Any] in voice["compose"] as! [Any] {
            let input = item["input"] as! [String: String]
            let output = item["output"] as! [String: String]
            let result = VoiceNotes.composeIssue(titleMode: TitleMode(rawValue: input["titleMode"]!)!, body: input["body"]!, suggestedTitle: input["suggestedTitle"]!)
            XCTAssertEqual(result.title, output["title"])
            XCTAssertEqual(result.body, output["body"])
        }
        let repo = (WebCompatibilityTests.fixture["deterministic"] as! [String: Any])["attachments"] as! [String: Any]
        XCTAssertEqual(VoiceNotes.audioLink(repo: repo["repo"] as! String, path: voice["audioPath"] as! String), voice["audioLink"] as? String)
        for case let item as [String: String] in voice["upgrades"] as! [Any] {
            XCTAssertEqual(VoicePresets.upgrade(item["input"]!), item["output"])
        }
        let classified = voice["classified"] as! [String: [String]]
        let models = ["gpt-4o-transcribe", "gpt-4o-transcribe-2025-03-20", "whisper-1", "gpt-transcribe", "gpt-5.6-luna", "gpt-4.1",
                      "o3-mini", "gpt-4o-audio-preview", "gpt-realtime", "tts-1", "text-embedding-3", "dall-e-3", "gpt-4o-mini-tts"]
        let result = VoicePresets.classify(models)
        XCTAssertEqual(result.transcription, classified["transcription"])
        XCTAssertEqual(result.refinement, classified["refinement"])
        for case let item as [String: String] in voice["masks"] as! [Any] {
            XCTAssertEqual(VoicePresets.maskAPIKey(item["input"]!), item["output"])
        }
    }

    func testRefinementRequestAndResult() {
        let input = OpenAIVoiceClient.userInput(transcript: "말투를 변경하지 마", tags: [])
        XCTAssertEqual(input, "<available_tags>\n[]\n</available_tags>\n\n<transcript>\n말투를 변경하지 마\n</transcript>")
        let tagged = OpenAIVoiceClient.userInput(transcript: "t", tags: [.init(name: " 업무 ", description: "회사 \"일\""), .init(name: "업무"), .init(name: "여행")])
        XCTAssertTrue(tagged.contains(#"[{"name":"업무","description":"회사 \"일\""},{"name":"여행"}]"#))
        XCTAssertTrue(OpenAIVoiceClient.systemPrompt(rules: "규칙").contains("<refinement_rules>\n규칙\n</refinement_rules>"))

        let parsed = OpenAIVoiceClient.parseRefinement(#"{"title":"  제목  둘 ","body":" 본문 ","tags":["업무","없는 태그","업무"]}"#, tags: ["업무", "여행"])
        XCTAssertEqual(parsed, .init(title: "제목 둘", body: "본문", tags: ["업무"]))
        XCTAssertEqual(OpenAIVoiceClient.parseRefinement("JSON 아님", tags: []), .init(title: "", body: "JSON 아님", tags: []))
        XCTAssertEqual(OpenAIVoiceClient.parseRefinement(#"{"title":"제목","body":"  ","tags":[]}"#, tags: []).title, "")
    }

    func testAudioMarkupIsSplitFromCommentText() {
        let link = VoiceNotes.audioLink(repo: "o/r", path: "a/b.m4a")
        let split = VoiceNotes.splitAudio("메모\n\n\(link)")
        XCTAssertEqual(split.text, "메모")
        XCTAssertEqual(split.audio, [link])
        XCTAssertEqual(VoiceNotes.audioSources(link), ["https://github.com/o/r/raw/ginote-assets/a/b.m4a"])
    }

    // MARK: - config.toml

    func testConfigRoundTrip() throws {
        var settings = AppSettings()
        settings.workspaces = [Workspace(id: "a", repo: "octo/notes", displayName: "내 노트", rememberToken: true),
                               Workspace(id: "b", repo: "octo/work", displayName: "", rememberToken: false)]
        settings.activeWorkspaceId = "b"
        settings.preferences.theme = .dark
        settings.preferences.editorLineHeight = 2.25
        settings.preferences.listRow.summary = false
        settings.voice.refinementPrompt = "여러 줄\n규칙"
        let text = AppConfig.render(settings)
        XCTAssertTrue(text.contains("[[workspaces]]"))
        XCTAssertTrue(text.contains("refinement_prompt = '''\n여러 줄\n규칙'''"))
        let parsed = try AppConfig.parse(text)
        XCTAssertEqual(parsed.settings, settings)
        XCTAssertEqual(parsed.problems, [])
        XCTAssertFalse(parsed.rewrite)
    }

    func testShortcutParsing() {
        XCTAssertEqual(KeyShortcut.parse("alt+T")?.spec, "option+t")
        XCTAssertEqual(KeyShortcut.parse("cmd+shift+t")?.spec, "shift+cmd+t")
        XCTAssertEqual(KeyShortcut.parse("option+t")?.symbol, "⌥T")
        XCTAssertEqual(KeyShortcut.parse("cmd+plus")?.symbol, "⌘+")
        XCTAssertEqual(KeyShortcut.parse("cmd+-")?.spec, "cmd+minus")
        XCTAssertEqual(KeyShortcut.parse("option+return")?.symbol, "⌥⏎")
        XCTAssertNil(KeyShortcut.parse("cmd++"))
        XCTAssertNil(KeyShortcut.parse("hyper+t"))
        XCTAssertNil(KeyShortcut.parse("cmd+cmd+t"))
        XCTAssertNil(KeyShortcut.parse(""))
        for command in ShortcutCommand.allCases {
            XCTAssertNotNil(KeyShortcut.parse(command.defaultSpec), command.rawValue)
            XCTAssertEqual(KeyShortcut.parse(command.defaultSpec)?.spec, command.defaultSpec, command.rawValue)
        }
    }

    func testConfigShortcuts() throws {
        var settings = AppSettings()
        settings.shortcuts[.tags] = "option+t"
        settings.shortcuts[.pin] = ""
        let parsed = try AppConfig.parse(AppConfig.render(settings))
        XCTAssertEqual(parsed.settings.shortcuts, settings.shortcuts)
        XCTAssertNil(parsed.settings.shortcut(.pin))
        XCTAssertEqual(parsed.problems, [])

        let source = """
        [shortcuts]
        tags = "alt+cmd+t"
        pin = "t"
        lock = "nonsense"
        refresh = "cmd+option+t"
        """
        let result = try AppConfig.parse(source)
        XCTAssertEqual(result.settings.shortcuts[.tags], "option+cmd+t")
        XCTAssertEqual(result.settings.shortcuts[.pin], "shift+cmd+p")
        XCTAssertEqual(result.settings.shortcuts[.lock], "shift+cmd+l")
        XCTAssertTrue(result.problems.contains { $0.hasPrefix("shortcuts.pin = \"t\" is not allowed") })
        XCTAssertTrue(result.problems.contains { $0.hasPrefix("shortcuts.lock = \"nonsense\" is not allowed") })
        XCTAssertTrue(result.problems.contains { $0.hasPrefix("shortcuts.refresh, shortcuts.tags share \"option+cmd+t\"") })
        XCTAssertFalse(result.problems.contains { $0.contains("shortcuts.tags = ") })
    }

    func testConfigReportsAndFixesBadValues() throws {
        let source = """
        version = 1
        active_workspace = "missing"
        mystery = 1
        [display]
        theme = "purple"
        editor_font_size = 99
        editor_line_height = 2
        editor_font = "web:fira-code"
        language = "ko"
        [behavior]
        lock_session_minutes = 7
        [[workspaces]]
        repo = "https://github.com/octo/notes.git"
        [[workspaces]]
        repo = "not a repo"
        """
        var counter = 0
        let parsed = try AppConfig.parse(source) { counter += 1; return "new-\(counter)" }
        XCTAssertEqual(parsed.settings.preferences.theme, .system)
        XCTAssertEqual(parsed.settings.preferences.editorFontSize, 32)
        XCTAssertEqual(parsed.settings.preferences.editorLineHeight, 2)
        XCTAssertEqual(parsed.settings.preferences.editorFont, "system")
        XCTAssertEqual(parsed.settings.preferences.lockSessionMinutes, 60)
        XCTAssertEqual(parsed.settings.workspaces.map(\.repo), ["octo/notes"])
        XCTAssertEqual(parsed.settings.activeWorkspaceId, "new-1")
        XCTAssertTrue(parsed.rewrite)
        let problems = parsed.problems.joined(separator: "\n")
        for fragment in ["display.theme", "editor_font_size", "editor_font", "lock_session_minutes", "\"mystery\"", "display.language", "not \"owner/name\"", "active_workspace"] {
            XCTAssertTrue(problems.contains(fragment), fragment)
        }
        XCTAssertFalse(problems.contains("editor_line_height"))
    }

    func testConfigSyntaxErrorIsReported() {
        XCTAssertThrowsError(try AppConfig.parse("[display\ntheme = ")) { error in
            XCTAssertTrue(error is AppConfig.SyntaxError)
        }
    }
}
