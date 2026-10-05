import Foundation
import TOMLKit

/// 설정 파일(config.toml) 형식. 웹 `src/lib/app-config.js`를 따르되 맥에서 뜻이 없는 키
/// (언어, 목록 폭, 웹 글꼴)는 빼고 맥 전용 키를 더했다(macos/DESIGN.md §8). 사람과 에이전트가
/// 이 파일 하나로 값을 바꿀 수 있도록 키마다 뜻·허용값·기본값·적용 시점을 주석으로 단다.
public enum AppConfig {
    public static let version = 1

    public struct SyntaxError: Error, LocalizedError, Sendable {
        public let message: String
        public var errorDescription: String? { message }
    }

    public struct ParseResult: Sendable {
        public var settings: AppSettings
        public var problems: [String]
        /// 앱이 고친 값(새 워크스페이스 id 등)을 파일에 바로 다시 써야 하면 true.
        public var rewrite: Bool
    }

    // MARK: - 항목 정의

    enum Value: Equatable {
        case string(String), int(Int), double(Double), bool(Bool)

        var toml: String {
            switch self {
            case .string(let text): return tomlString(text)
            case .int(let number): return String(number)
            case .double(let number): return formatDouble(number)
            case .bool(let flag): return flag ? "true" : "false"
            }
        }

        var described: String {
            switch self {
            case .string(let text): return jsonQuoted(text)
            case .int(let number): return String(number)
            case .double(let number): return formatDouble(number)
            case .bool(let flag): return flag ? "true" : "false"
            }
        }
    }

    struct Entry {
        let path: [String]
        let doc: [String]
        let get: (AppSettings) -> Value
        /// 파일 값 → 허용 값. 맞지 않으면 기본값이나 가장 가까운 값을 돌려준다.
        let set: (inout AppSettings, TOMLValueConvertible) -> Value
    }

    static func pick(_ allowed: [String], _ fallback: String, _ raw: TOMLValueConvertible) -> String {
        if let text = raw.string, allowed.contains(text) { return text }
        return fallback
    }

    static func number(_ raw: TOMLValueConvertible) -> Double? {
        if let value = raw.int { return Double(value) }
        return raw.double
    }

    static func intRange(_ minimum: Int, _ maximum: Int, _ fallback: Int, _ raw: TOMLValueConvertible) -> Int {
        guard let value = number(raw), value.isFinite else { return fallback }
        return Int(TagColor.jsRound(min(Double(maximum), max(Double(minimum), value))))
    }

    static func doubleRange(_ minimum: Double, _ maximum: Double, _ fallback: Double, _ raw: TOMLValueConvertible) -> Double {
        guard let value = number(raw), value.isFinite else { return fallback }
        return TagColor.jsRound(min(maximum, max(minimum, value)) * 100) / 100
    }

    static func flag(_ fallback: Bool, _ raw: TOMLValueConvertible) -> Bool { raw.bool ?? fallback }

    static func normalizeFont(_ raw: TOMLValueConvertible) -> String {
        guard let value = raw.string else { return "system" }
        if Preferences.fixedFonts.contains(value) { return value }
        if value.hasPrefix("local:"), !value.dropFirst(6).trimmingCharacters(in: .whitespaces).isEmpty { return value }
        return "system"
    }

    static let entries: [Entry] = {
        var list: [Entry] = [
            Entry(path: ["display", "theme"],
                  doc: ["Color theme. \"system\" follows the macOS appearance.",
                        "Allowed: \"system\", \"light\", \"dark\". Default: \"system\". Applied immediately."],
                  get: { .string($0.preferences.theme.rawValue) },
                  set: { s, raw in s.preferences.theme = Theme(rawValue: pick(Theme.allCases.map(\.rawValue), "system", raw))!; return .string(s.preferences.theme.rawValue) }),
            Entry(path: ["display", "title_mode"],
                  doc: ["How a note gets its title.",
                        "\"first-line\": the first 50 characters of the first line become the title.",
                        "\"separate\": the title is typed in its own field.",
                        "Default: \"first-line\". Applied immediately."],
                  get: { .string($0.preferences.titleMode.rawValue) },
                  set: { s, raw in s.preferences.titleMode = TitleMode(rawValue: pick(["first-line", "separate"], "first-line", raw))!; return .string(s.preferences.titleMode.rawValue) }),
            Entry(path: ["display", "editor_font"],
                  doc: ["Editor font.",
                        "Allowed: \"system\", \"sans\", \"serif\", \"mono\", or \"local:<font family installed on this Mac>\", e.g. \"local:Menlo\".",
                        "Default: \"system\". Applied immediately."],
                  get: { .string($0.preferences.editorFont) },
                  set: { s, raw in s.preferences.editorFont = normalizeFont(raw); return .string(s.preferences.editorFont) }),
            Entry(path: ["display", "editor_font_size"],
                  doc: ["Editor font size in points. Integer 12..32. Default: 16. Applied immediately."],
                  get: { .int($0.preferences.editorFontSize) },
                  set: { s, raw in s.preferences.editorFontSize = intRange(12, 32, 16, raw); return .int(s.preferences.editorFontSize) }),
            Entry(path: ["display", "ui_scale"],
                  doc: ["Text zoom of the note list, editor, comments and preview (View > Zoom In/Out, ⌘+ / ⌘- / ⌘0).",
                        "Number 0.8..1.6. Default: 1.0. Applied immediately."],
                  get: { .double($0.preferences.uiScale) },
                  set: { s, raw in s.preferences.uiScale = doubleRange(0.8, 1.6, 1.0, raw); return .double(s.preferences.uiScale) }),
            Entry(path: ["display", "editor_line_height"],
                  doc: ["Editor line height as a multiple of the font size. Number 1.2..2.5. Default: 1.8. Applied immediately."],
                  get: { .double($0.preferences.editorLineHeight) },
                  set: { s, raw in s.preferences.editorLineHeight = doubleRange(1.2, 2.5, 1.8, raw); return .double(s.preferences.editorLineHeight) }),
            Entry(path: ["display", "editor_max_width"],
                  doc: ["Maximum width of the note text column in points. Integer 480..1600. Default: 840. Applied immediately."],
                  get: { .int($0.preferences.editorMaxWidth) },
                  set: { s, raw in s.preferences.editorMaxWidth = intRange(480, 1600, 840, raw); return .int(s.preferences.editorMaxWidth) })
        ]
        let rowDocs = [
            "title": "Show the note title in each row of the note list.",
            "summary": "Show the first lines of the note body in each row of the note list.",
            "meta": "Show the time information (created or updated) in each row of the note list.",
            "tags": "Show the tags in each row of the note list."
        ]
        let rowKeys: [(String, WritableKeyPath<ListRowFields, Bool>)] = [("title", \.title), ("summary", \.summary), ("meta", \.meta), ("tags", \.tags)]
        for (key, keyPath) in rowKeys {
            list.append(Entry(path: ["display", "list_row", key],
                              doc: [rowDocs[key]!, "true / false. Default: true. Applied immediately."],
                              get: { .bool($0.preferences.listRow[keyPath: keyPath]) },
                              set: { s, raw in s.preferences.listRow[keyPath: keyPath] = flag(true, raw); return .bool(s.preferences.listRow[keyPath: keyPath]) }))
        }
        list += [
            Entry(path: ["behavior", "auto_save_seconds"],
                  doc: ["Seconds of inactivity before an edited note is saved to GitHub. Integer 3..30. Default: 5. Applied immediately."],
                  get: { .int($0.preferences.autoSaveSeconds) },
                  set: { s, raw in s.preferences.autoSaveSeconds = intRange(3, 30, 5, raw); return .int(s.preferences.autoSaveSeconds) }),
            Entry(path: ["behavior", "notes_per_page"],
                  doc: ["Number of notes loaded at a time in the note list. Integer 10..100. Default: 30. The list reloads when it changes."],
                  get: { .int($0.preferences.notesPerPage) },
                  set: { s, raw in s.preferences.notesPerPage = intRange(10, 100, 30, raw); return .int(s.preferences.notesPerPage) }),
            Entry(path: ["behavior", "lock_session_minutes"],
                  doc: ["Minutes that locked (encrypted) notes stay readable after you enter the lock number.",
                        "Allowed: \(Preferences.lockSessionOptions.map(String.init).joined(separator: ", ")). Default: 60. Applied immediately."],
                  get: { .int($0.preferences.lockSessionMinutes) },
                  set: { s, raw in
                      let value = raw.int ?? -1
                      s.preferences.lockSessionMinutes = Preferences.lockSessionOptions.contains(value) ? value : 60
                      return .int(s.preferences.lockSessionMinutes)
                  }),
            Entry(path: ["behavior", "clear_lock_on_sleep"],
                  doc: ["Forget the lock number when the screen locks or the Mac sleeps. true / false. Default: true. Applied immediately."],
                  get: { .bool($0.preferences.clearLockOnSleep) },
                  set: { s, raw in s.preferences.clearLockOnSleep = flag(true, raw); return .bool(s.preferences.clearLockOnSleep) }),
            Entry(path: ["behavior", "workspace_cache_minutes"],
                  doc: ["Minutes a workspace's note list is kept in memory, so switching back to it shows the list instantly.",
                        "Allowed: \(Preferences.workspaceCacheOptions.map(String.init).joined(separator: ", ")). Default: 60. Applied immediately."],
                  get: { .int($0.preferences.workspaceCacheMinutes) },
                  set: { s, raw in
                      let value = raw.int ?? -1
                      s.preferences.workspaceCacheMinutes = Preferences.workspaceCacheOptions.contains(value) ? value : 60
                      return .int(s.preferences.workspaceCacheMinutes)
                  }),
            Entry(path: ["voice", "transcription_model"],
                  doc: ["OpenAI model that turns a voice recording into text, e.g. \"gpt-transcribe\", \"gpt-4o-transcribe\".",
                        "Default: \"\(VoicePresets.defaultTranscriptionModel)\". Applied to the next recording.",
                        "Voice notes also need an OpenAI API key, which can only be entered in the app."],
                  get: { .string($0.voice.transcriptionModel) },
                  set: { s, raw in s.voice.transcriptionModel = raw.string.map { JSText.trim($0) } ?? VoicePresets.defaultTranscriptionModel; return .string(s.voice.transcriptionModel) }),
            Entry(path: ["voice", "refinement_model"],
                  doc: ["OpenAI model that tidies the transcript using refinement_prompt below.",
                        "\"\" (empty) keeps the raw transcript. Default: \"\(VoicePresets.defaultRefinementModel)\". Applied to the next recording."],
                  get: { .string($0.voice.refinementModel) },
                  set: { s, raw in s.voice.refinementModel = raw.string.map { JSText.trim($0) } ?? VoicePresets.defaultRefinementModel; return .string(s.voice.refinementModel) }),
            Entry(path: ["voice", "preserve_original_audio"],
                  doc: ["Attach the original recording to the note after a successful voice note. true / false. Default: false."],
                  get: { .bool($0.voice.preserveOriginalAudio) },
                  set: { s, raw in s.voice.preserveOriginalAudio = flag(false, raw); return .bool(s.voice.preserveOriginalAudio) }),
            Entry(path: ["voice", "refinement_prompt"],
                  doc: ["Instructions given to refinement_model, in any language. Empty restores the default",
                        "(fix obvious transcription errors and punctuation only). Applied to the next recording."],
                  get: { .string($0.voice.refinementPrompt) },
                  set: { s, raw in
                      let text = raw.string.map { JSText.trim($0) } ?? ""
                      s.voice.refinementPrompt = text.isEmpty ? VoicePresets.defaultRefinementPrompt : VoicePresets.upgrade(text)
                      return .string(s.voice.refinementPrompt)
                  })
        ]
        for command in ShortcutCommand.allCases {
            list.append(Entry(path: ["shortcuts", command.rawValue],
                              doc: ["\(command.englishName). Default: \(jsonQuoted(command.defaultSpec)). Applied immediately."],
                              get: { .string($0.shortcuts[command] ?? command.defaultSpec) },
                              set: { s, raw in
                                  let text = raw.string?.trimmingCharacters(in: .whitespaces) ?? command.defaultSpec
                                  if text.isEmpty { s.shortcuts[command] = ""; return .string("") }
                                  guard let shortcut = KeyShortcut.parse(text), shortcut.hasCommandModifier else {
                                      s.shortcuts[command] = command.defaultSpec
                                      return .string(command.defaultSpec)
                                  }
                                  // 보조키 순서·별칭(alt, command 등)만 다르면 받아들이고, 다음에 쓸 때 정리한 형식으로 쓴다.
                                  s.shortcuts[command] = shortcut.spec
                                  return .string(raw.string ?? shortcut.spec)
                              }))
        }
        return list
    }()

    static let sectionDocs = [
        "display": "Appearance of Ginote Native on this Mac.",
        "display.list_row": "Items shown in each row of the note list.",
        "behavior": "Saving, loading and locking.",
        "voice": "Voice notes (OpenAI). The API key is stored in the macOS Keychain, not here.",
        "shortcuts": [
            "Menu keyboard shortcuts (Settings > Shortcuts).",
            "# Format: modifiers then a key, joined by \"+\": \"shift+cmd+t\", \"option+t\", \"ctrl+option+cmd+n\".",
            "# Modifiers: ctrl, option, shift, cmd. Keys: a letter, digit or punctuation character, or one of",
            "# return, delete, forward_delete, escape, tab, space, up, down, left, right, home, end, page_up, page_down,",
            "# plus, minus. Every shortcut needs cmd, ctrl or option. \"\" (empty) removes the shortcut.",
            "# cmd+1..cmd+9 always switch workspaces."
        ].joined(separator: "\n")
    ]

    static let header = [
        "Ginote Native settings (macOS)",
        "",
        "This is the active settings file of the Ginote Native app on this Mac. Ginote rewrites the",
        "whole file (with these comments) whenever settings change in the app, so comments you add",
        "and key order are not kept; values are.",
        "",
        "Editing: change values while Ginote is running or not. The running app applies a saved",
        "change within about a second. Afterwards read config-status.txt in this folder: it records",
        "when Ginote last loaded this file and lists any value it rejected (and the value it used",
        "instead). Invalid TOML is ignored as a whole and the previous settings stay in effect.",
        "",
        "Credentials: GitHub personal access tokens and the OpenAI API key are NOT in this file.",
        "They are kept in the macOS Keychain and can only be entered in the app.",
        "",
        "Format: TOML 1.0 (https://toml.io). Lines starting with # are comments."
    ]

    // MARK: - 쓰기

    public static func render(_ settings: AppSettings) -> String {
        var out = [comment(header), "", "version = \(version)", ""]
        out.append(comment(["id of the workspace opened at launch (one of the [[workspaces]] ids below).",
                            "Changing it switches the running app to that workspace."]))
        out.append("active_workspace = \(tomlString(settings.activeWorkspaceId))")
        var currentTable = ""
        for entry in entries {
            let table = entry.path.dropLast().joined(separator: ".")
            if table != currentTable {
                currentTable = table
                out += ["", "# \(sectionDocs[table] ?? table)", "[\(table)]"]
            }
            out += ["", comment(entry.doc), "\(entry.path.last!) = \(entry.get(settings).toml)"]
        }
        out += ["", comment([
            "Workspaces: GitHub repositories whose issues hold notes, in the order shown in the app.",
            "id         Stable identifier. Leave it as is; for a new workspace you may omit it.",
            "repo       \"owner/name\" of the GitHub repository.",
            "name       Display name; \"\" shows the repository address.",
            "remember_token  Keep this workspace's token in the Keychain across launches.",
            "           false forgets the stored token at once; it can only be entered again in the app.",
            "Reordering, renaming and removing take effect immediately. A workspace added here asks",
            "for its token in the app when opened."
        ])]
        for workspace in settings.workspaces {
            out += ["", "[[workspaces]]",
                    "id = \(tomlString(workspace.id))",
                    "repo = \(tomlString(workspace.repo))",
                    "name = \(tomlString(workspace.displayName))",
                    "remember_token = \(workspace.rememberToken)"]
        }
        return out.joined(separator: "\n") + "\n"
    }

    public static func renderStatus(loadedAt: Date, problems: [String], syntaxError: String? = nil) -> String {
        var lines = ["Ginote Native settings status", "Last loaded: \(ISO8601DateFormatter().string(from: loadedAt))", ""]
        if let syntaxError {
            lines += ["Result: config.toml is not valid TOML. The previous settings are still in effect.", "Error: \(syntaxError)"]
        } else if problems.isEmpty {
            lines.append("Result: loaded; every value was accepted.")
        } else {
            lines.append("Result: loaded with the following values rejected:")
            lines += problems.map { "- \($0)" }
        }
        return lines.joined(separator: "\n") + "\n"
    }

    // MARK: - 읽기

    public static func parse(_ source: String, createId: () -> String = { UUID().uuidString.lowercased() }) throws -> ParseResult {
        let table: TOMLTable
        do {
            table = try TOMLTable(string: source)
        } catch {
            // TOMLKit은 TOMLParseError만 던진다. 혹시 다른 오류가 와도 문법 오류로 알린다.
            throw SyntaxError(message: (error as? TOMLParseError)?.debugDescription ?? String(describing: error))
        }
        var settings = AppSettings()
        var problems: [String] = []
        var rewrite = false

        for entry in entries {
            guard let raw = lookup(table, entry.path) else { continue }
            let normalized = entry.set(&settings, raw)
            if let original = rawValue(raw), !same(original, normalized) {
                problems.append("\(entry.path.joined(separator: ".")) = \(original.described) is not allowed; using \(normalized.described). \(entry.doc.joined(separator: " "))")
            } else if rawValue(raw) == nil {
                problems.append("\(entry.path.joined(separator: ".")) has an unsupported type; using \(normalized.described). \(entry.doc.joined(separator: " "))")
            }
        }

        var seen = Set<String>()
        if let rawWorkspaces = table["workspaces"] {
            if let array = rawWorkspaces.array {
                for (index, item) in array.enumerated() {
                    let label = "workspaces[\(index)]"
                    guard let workspace = item.table else { problems.append("\(label) is not a table; ignored."); continue }
                    guard let repoText = workspace["repo"]?.string, let address = RepoAddress.parse(repoText) else {
                        problems.append("\(label).repo = \(workspace["repo"]?.string.map(jsonQuoted) ?? "missing") is not \"owner/name\"; this workspace is ignored.")
                        continue
                    }
                    var id = workspace["id"]?.string?.trimmingCharacters(in: .whitespaces) ?? ""
                    if id.isEmpty || seen.contains(id) {
                        if !id.isEmpty { problems.append("\(label).id = \(jsonQuoted(id)) is used twice; a new id was assigned.") }
                        id = createId()
                        rewrite = true
                    }
                    seen.insert(id)
                    settings.workspaces.append(Workspace(
                        id: id, repo: address.fullName,
                        displayName: workspace["name"]?.string?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "",
                        rememberToken: workspace["remember_token"]?.bool ?? true))
                }
            } else {
                problems.append("workspaces must be an array of [[workspaces]] tables; ignored.")
            }
        }

        let active = table["active_workspace"]?.string ?? ""
        if settings.workspaces.contains(where: { $0.id == active }) {
            settings.activeWorkspaceId = active
        } else {
            settings.activeWorkspaceId = settings.workspaces.first?.id ?? ""
            if !active.isEmpty {
                problems.append("active_workspace = \(jsonQuoted(active)) matches no workspace; using \(jsonQuoted(settings.activeWorkspaceId)).")
            }
        }

        let used = ShortcutCommand.allCases.compactMap { command in settings.shortcut(command).map { ($0, command) } }
        for (shortcut, commands) in Dictionary(grouping: used, by: \.0) where commands.count > 1 {
            let names = commands.map { "shortcuts.\($0.1.rawValue)" }.sorted().joined(separator: ", ")
            problems.append("\(names) share \(jsonQuoted(shortcut.spec)); only one of them responds to it.")
        }

        let known: Set<String> = ["version", "active_workspace", "workspaces", "display", "behavior", "voice", "shortcuts"]
        for key in table.keys where !known.contains(key) { problems.append("Unknown key \"\(key)\" is ignored.") }
        for section in ["display", "behavior", "voice", "shortcuts"] {
            for key in table[section]?.table?.keys ?? [] {
                let isKnown = entries.contains { $0.path[0] == section && $0.path[1] == key }
                if !isKnown { problems.append("Unknown key \"\(section).\(key)\" is ignored.") }
            }
        }
        for key in table["display"]?.table?["list_row"]?.table?.keys ?? [] where !["title", "summary", "meta", "tags"].contains(key) {
            problems.append("Unknown key \"display.list_row.\(key)\" is ignored.")
        }
        return ParseResult(settings: settings, problems: problems, rewrite: rewrite)
    }

    static func lookup(_ table: TOMLTable, _ path: [String]) -> TOMLValueConvertible? {
        var current: TOMLValueConvertible = table
        for key in path {
            guard let next = current.table?[key] else { return nil }
            current = next
        }
        return current
    }

    static func rawValue(_ raw: TOMLValueConvertible) -> Value? {
        if let text = raw.string { return .string(text) }
        if let flag = raw.bool { return .bool(flag) }
        if let number = raw.int { return .int(number) }
        if let number = raw.double { return .double(number) }
        return nil
    }

    static func same(_ original: Value, _ normalized: Value) -> Bool {
        switch (original, normalized) {
        case (.int(let a), .double(let b)): return abs(Double(a) - b) < 1e-9
        case (.double(let a), .int(let b)): return abs(a - Double(b)) < 1e-9
        case (.double(let a), .double(let b)): return abs(a - b) < 1e-9
        default: return original == normalized
        }
    }

    // MARK: - TOML 글자

    static func comment(_ lines: [String]) -> String {
        lines.map { $0.isEmpty ? "#" : "# \($0)" }.joined(separator: "\n")
    }

    static func tomlString(_ value: String) -> String {
        // 여러 줄 문자열은 읽기 쉽게 리터럴 블록으로 쓴다.
        let hasControl = value.unicodeScalars.contains { ($0.value < 0x20 && $0 != "\n" && $0 != "\t") || $0.value == 0x7f }
        if value.contains("\n"), !value.contains("'''"), !hasControl {
            return "'''\n\(value)'''"
        }
        return jsonQuoted(value)
    }

    static func jsonQuoted(_ value: String) -> String {
        var out = "\""
        for scalar in value.unicodeScalars {
            switch scalar {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            case "\u{08}": out += "\\b"
            case "\u{0C}": out += "\\f"
            default:
                if scalar.value < 0x20 || scalar.value == 0x7f {
                    out += String(format: "\\u%04X", scalar.value)
                } else {
                    out.unicodeScalars.append(scalar)
                }
            }
        }
        return out + "\""
    }

    static func formatDouble(_ value: Double) -> String {
        if value == value.rounded(), abs(value) < 1e15 { return String(format: "%.1f", value) }
        var text = String(format: "%.2f", value)
        if text.hasSuffix("0") { text.removeLast() }
        return text
    }
}
