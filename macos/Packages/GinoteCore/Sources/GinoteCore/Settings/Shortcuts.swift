import Foundation

/// 바꿀 수 있는 메뉴 단축키(설정 → 단축키, config.toml `[shortcuts]`). rawValue가 설정 파일의 키다.
/// 저장소 전환(⌘1–⌘9)과 ⌘Z·⌘C 같은 시스템 편집 단축키는 여기 넣지 않는다.
public enum ShortcutCommand: String, CaseIterable, Sendable {
    case newNote = "new_note"
    case newVoiceNote = "new_voice_note"
    case openInNewWindow = "open_in_new_window"
    case saveNow = "save_now"
    case find
    case findNext = "find_next"
    case findPrevious = "find_previous"
    case useSelectionForFind = "use_selection_for_find"
    case searchNotes = "search_notes"
    case replace
    case zoomIn = "zoom_in"
    case zoomOut = "zoom_out"
    case actualSize = "actual_size"
    case preview
    case refresh
    case tags
    case attachFiles = "attach_files"
    case voiceRecording = "voice_recording"
    case lock
    case pin
    case copyIssueNumber = "copy_issue_number"
    case openOnGitHub = "open_on_github"
    case moveToTrash = "move_to_trash"

    public var defaultSpec: String {
        switch self {
        case .newNote: return "cmd+n"
        case .newVoiceNote: return "option+cmd+n"
        case .openInNewWindow: return "option+return"
        case .saveNow: return "cmd+s"
        case .find: return "cmd+f"
        case .findNext: return "cmd+g"
        case .findPrevious: return "shift+cmd+g"
        case .useSelectionForFind: return "cmd+e"
        case .searchNotes: return "shift+cmd+f"
        case .replace: return "option+cmd+f"
        case .zoomIn: return "cmd+plus"
        case .zoomOut: return "cmd+minus"
        case .actualSize: return "cmd+0"
        case .preview: return "shift+cmd+m"
        case .refresh: return "cmd+r"
        case .tags: return "shift+cmd+t"
        case .attachFiles: return "shift+cmd+a"
        case .voiceRecording: return "shift+cmd+e"
        case .lock: return "shift+cmd+l"
        case .pin: return "shift+cmd+p"
        case .copyIssueNumber: return "ctrl+cmd+c"
        case .openOnGitHub: return "shift+cmd+o"
        case .moveToTrash: return "cmd+delete"
        }
    }

    /// 설정 파일 주석에 쓰는 영어 이름.
    public var englishName: String {
        switch self {
        case .newNote: return "New note"
        case .newVoiceNote: return "New voice note"
        case .openInNewWindow: return "Open the note in a new window"
        case .saveNow: return "Save now"
        case .find: return "Find in the note"
        case .findNext: return "Find next"
        case .findPrevious: return "Find previous"
        case .useSelectionForFind: return "Use selection for find"
        case .searchNotes: return "Search notes"
        case .replace: return "Find and replace"
        case .zoomIn: return "Zoom in"
        case .zoomOut: return "Zoom out"
        case .actualSize: return "Actual size"
        case .preview: return "Markdown preview"
        case .refresh: return "Refresh"
        case .tags: return "Tags"
        case .attachFiles: return "Attach files"
        case .voiceRecording: return "Voice recording (append to the note)"
        case .lock: return "Lock / unlock"
        case .pin: return "Pin / unpin"
        case .copyIssueNumber: return "Copy issue number"
        case .openOnGitHub: return "View on GitHub"
        case .moveToTrash: return "Move to Trash / restore"
        }
    }

    public static var defaults: [ShortcutCommand: String] {
        Dictionary(uniqueKeysWithValues: allCases.map { ($0, $0.defaultSpec) })
    }
}

/// 키 하나와 보조키. 설정 파일에는 `option+cmd+t`처럼 쓴다(보조키는 ctrl, option, shift, cmd 순서).
public struct KeyShortcut: Equatable, Hashable, Sendable {
    public var key: String
    public var control = false
    public var option = false
    public var shift = false
    public var command = false

    public init(key: String, control: Bool = false, option: Bool = false, shift: Bool = false, command: Bool = false) {
        self.key = key; self.control = control; self.option = option; self.shift = shift; self.command = command
    }

    /// 글자 대신 이름으로 쓰는 키. `+`는 구분자라 `plus`, 보기 좋게 `-`도 `minus`로 쓴다.
    public static let namedKeys: [String: String] = [
        "return": "⏎", "delete": "⌫", "forward_delete": "⌦", "escape": "⎋", "tab": "⇥", "space": "Space",
        "up": "↑", "down": "↓", "left": "←", "right": "→", "home": "↖", "end": "↘", "page_up": "⇞", "page_down": "⇟",
        "plus": "+", "minus": "-"
    ]
    static let modifierAliases: [String: WritableKeyPath<KeyShortcut, Bool>] = [
        "ctrl": \.control, "control": \.control, "option": \.option, "opt": \.option, "alt": \.option,
        "shift": \.shift, "cmd": \.command, "command": \.command
    ]

    /// 빈 글은 nil. 형식이 틀려도 nil이다(호출하는 쪽이 빈 값과 구분한다).
    public static func parse(_ text: String) -> KeyShortcut? {
        let parts = text.trimmingCharacters(in: .whitespaces).lowercased().split(separator: "+", omittingEmptySubsequences: false)
            .map { $0.trimmingCharacters(in: .whitespaces) }
        guard let last = parts.last, !last.isEmpty, parts.dropLast().allSatisfy({ !$0.isEmpty }) else { return nil }
        var shortcut = KeyShortcut(key: "")
        for part in parts.dropLast() {
            guard let keyPath = modifierAliases[part], !shortcut[keyPath: keyPath] else { return nil }
            shortcut[keyPath: keyPath] = true
        }
        if last == "-" {
            shortcut.key = "minus"
        } else if namedKeys[last] != nil {
            shortcut.key = last
        } else if last.count == 1, let scalar = last.unicodeScalars.first, scalar.isASCII, scalar.value > 0x20, scalar.value < 0x7f {
            shortcut.key = last
        } else {
            return nil
        }
        return shortcut
    }

    public var spec: String {
        var parts: [String] = []
        if control { parts.append("ctrl") }
        if option { parts.append("option") }
        if shift { parts.append("shift") }
        if command { parts.append("cmd") }
        return (parts + [key]).joined(separator: "+")
    }

    /// 메뉴와 같은 기호(⌃⌥⇧⌘ + 키).
    public var symbol: String {
        var text = ""
        if control { text += "⌃" }
        if option { text += "⌥" }
        if shift { text += "⇧" }
        if command { text += "⌘" }
        return text + (Self.namedKeys[key] ?? key.uppercased())
    }

    /// ⌘·⌃·⌥ 없는 단축키는 글을 칠 때 가로채므로 받지 않는다.
    public var hasCommandModifier: Bool { command || control || option }
}

extension AppSettings {
    /// 명령의 단축키. 비어 있으면(끔) nil.
    public func shortcut(_ command: ShortcutCommand) -> KeyShortcut? {
        KeyShortcut.parse(shortcuts[command] ?? command.defaultSpec)
    }
}
