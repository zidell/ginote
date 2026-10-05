import AppKit
import GinoteCore
import SwiftUI

extension ShortcutCommand {
    /// 화면에 보이는 이름(메뉴 항목과 같은 말).
    var title: String {
        switch self {
        case .newNote: return String(localized: "새 노트")
        case .newVoiceNote: return String(localized: "음성으로 새 노트")
        case .openInNewWindow: return String(localized: "새 창에서 열기")
        case .saveNow: return String(localized: "지금 저장")
        case .find: return String(localized: "찾기…")
        case .findNext: return String(localized: "다음 찾기")
        case .findPrevious: return String(localized: "이전 찾기")
        case .useSelectionForFind: return String(localized: "선택 항목으로 찾기")
        case .searchNotes: return String(localized: "노트 검색")
        case .replace: return String(localized: "찾아 바꾸기…")
        case .zoomIn: return String(localized: "확대")
        case .zoomOut: return String(localized: "축소")
        case .actualSize: return String(localized: "실제 크기")
        case .preview: return String(localized: "Markdown 미리보기")
        case .refresh: return String(localized: "새로고침")
        case .tags: return String(localized: "태그…")
        case .attachFiles: return String(localized: "파일 첨부…")
        case .voiceRecording: return String(localized: "음성 녹음")
        case .lock: return String(localized: "잠금")
        case .pin: return String(localized: "고정")
        case .copyIssueNumber: return String(localized: "이슈 번호 복사")
        case .openOnGitHub: return String(localized: "GitHub에서 보기")
        case .moveToTrash: return String(localized: "휴지통으로 이동")
        }
    }
}

extension KeyShortcut {
    /// SwiftUI 메뉴 단축키.
    var keyboardShortcut: KeyboardShortcut {
        let equivalent: KeyEquivalent
        switch key {
        case "return": equivalent = .return
        case "delete": equivalent = .delete
        case "forward_delete": equivalent = .deleteForward
        case "escape": equivalent = .escape
        case "tab": equivalent = .tab
        case "space": equivalent = .space
        case "up": equivalent = .upArrow
        case "down": equivalent = .downArrow
        case "left": equivalent = .leftArrow
        case "right": equivalent = .rightArrow
        case "home": equivalent = .home
        case "end": equivalent = .end
        case "page_up": equivalent = .pageUp
        case "page_down": equivalent = .pageDown
        case "plus": equivalent = "+"
        case "minus": equivalent = "-"
        default: equivalent = KeyEquivalent(Character(key))
        }
        var modifiers: EventModifiers = []
        if control { modifiers.insert(.control) }
        if option { modifiers.insert(.option) }
        if shift { modifiers.insert(.shift) }
        if command { modifiers.insert(.command) }
        return KeyboardShortcut(equivalent, modifiers: modifiers)
    }

    /// 입력기(한글 등)와 상관없이 자판 위치로 키를 읽는다. 메뉴 단축키도 같은 위치로 동작한다.
    static let keyCodes: [UInt16: String] = [
        0: "a", 11: "b", 8: "c", 2: "d", 14: "e", 3: "f", 5: "g", 4: "h", 34: "i", 38: "j", 40: "k", 37: "l", 46: "m",
        45: "n", 31: "o", 35: "p", 12: "q", 15: "r", 1: "s", 17: "t", 32: "u", 9: "v", 13: "w", 7: "x", 16: "y", 6: "z",
        29: "0", 18: "1", 19: "2", 20: "3", 21: "4", 23: "5", 22: "6", 26: "7", 28: "8", 25: "9",
        27: "minus", 24: "=", 33: "[", 30: "]", 41: ";", 39: "'", 43: ",", 47: ".", 44: "/", 50: "`", 42: "\\",
        36: "return", 76: "return", 51: "delete", 117: "forward_delete", 53: "escape", 48: "tab", 49: "space",
        126: "up", 125: "down", 123: "left", 124: "right", 115: "home", 119: "end", 116: "page_up", 121: "page_down"
    ]

    init?(event: NSEvent) {
        guard let key = Self.keyCodes[event.keyCode] else { return nil }
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        self.init(key: key, control: flags.contains(.control), option: flags.contains(.option),
                  shift: flags.contains(.shift), command: flags.contains(.command))
    }

    /// 저장소 전환(⌘1–⌘9)에 묶인 키.
    var isWorkspaceSwitch: Bool { command && !control && !option && !shift && ("1"..."9").contains(key) && key.count == 1 }
}

/// 메뉴 항목의 단축키를 설정대로 맞춘다. SwiftUI 메뉴(Commands)는 처음 만든 단축키를 나중에 바꾸지 않으므로
/// (2026-10-05 확인: 설정을 바꾸고 노트를 열어 메뉴를 다시 그려도 그대로) AppKit 메뉴 항목을 직접 고친다.
/// 메뉴 항목은 제목으로 찾는다. 상태에 따라 제목이 바뀌는 항목(잠금·고정·휴지통)은 바뀌는 제목을 모두 둔다.
@MainActor
enum MenuShortcuts {
    private static var observers: [NSObjectProtocol] = []
    private static var applying = false

    static func titles(_ command: ShortcutCommand) -> [String] {
        switch command {
        case .lock: return [String(localized: "잠금"), String(localized: "잠금 열기"), String(localized: "잠금 풀기")]
        case .pin: return [String(localized: "고정"), String(localized: "고정 해제")]
        case .moveToTrash: return [String(localized: "휴지통으로 이동"), String(localized: "복원")]
        default: return [command.title]
        }
    }

    /// 앱이 시작할 때 한 번. SwiftUI가 메뉴를 만들거나 고칠 때마다 다시 맞춘다.
    static func install() {
        guard observers.isEmpty else { return }
        for name in [NSMenu.didAddItemNotification, NSMenu.didChangeItemNotification] {
            observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { _ in
                MainActor.assumeIsolated { apply(AppModel.shared.settings) }
            })
        }
        apply(AppModel.shared.settings)
    }

    static func apply(_ settings: AppSettings, to target: NSMenu? = nil) {
        guard !applying, let menu = target ?? NSApp?.mainMenu else { return }
        applying = true
        defer { applying = false }
        var byTitle: [String: KeyShortcut?] = [:]
        for command in ShortcutCommand.allCases {
            for title in titles(command) { byTitle[title] = settings.shortcut(command) }
        }
        func walk(_ menu: NSMenu) {
            for item in menu.items {
                if let submenu = item.submenu { walk(submenu); continue }
                guard let entry = byTitle[item.title] else { continue }
                let equivalent = entry?.menuKeyEquivalent ?? ""
                let mask = entry?.menuModifierMask ?? []
                if item.keyEquivalent != equivalent { item.keyEquivalent = equivalent }
                if item.keyEquivalentModifierMask != mask { item.keyEquivalentModifierMask = mask }
            }
        }
        walk(menu)
    }
}

extension KeyShortcut {
    /// NSMenuItem의 keyEquivalent. 글자는 소문자로 두고 ⇧는 보조키로 준다(SwiftUI가 만드는 항목과 같은 방식).
    var menuKeyEquivalent: String {
        func function(_ key: Int) -> String { String(Character(UnicodeScalar(key)!)) }
        switch key {
        case "return": return "\r"
        case "delete": return "\u{8}"
        case "forward_delete": return function(NSDeleteFunctionKey)
        case "escape": return "\u{1b}"
        case "tab": return "\t"
        case "space": return " "
        case "up": return function(NSUpArrowFunctionKey)
        case "down": return function(NSDownArrowFunctionKey)
        case "left": return function(NSLeftArrowFunctionKey)
        case "right": return function(NSRightArrowFunctionKey)
        case "home": return function(NSHomeFunctionKey)
        case "end": return function(NSEndFunctionKey)
        case "page_up": return function(NSPageUpFunctionKey)
        case "page_down": return function(NSPageDownFunctionKey)
        case "plus": return "+"
        case "minus": return "-"
        default: return key
        }
    }

    var menuModifierMask: NSEvent.ModifierFlags {
        var mask: NSEvent.ModifierFlags = []
        if control { mask.insert(.control) }
        if option { mask.insert(.option) }
        if shift { mask.insert(.shift) }
        if command { mask.insert(.command) }
        return mask
    }
}

extension AppModel {
    func shortcut(_ command: ShortcutCommand) -> KeyShortcut? { settings.shortcut(command) }

    /// 툴팁 끝에 붙이는 " (⇧⌘T)". 단축키가 없으면 빈 글.
    func shortcutHint(_ command: ShortcutCommand) -> String {
        shortcut(command).map { " (\($0.symbol))" } ?? ""
    }
}

extension View {
    /// 실행할 때의 단축키를 메뉴 항목에 단다(끄면 단축키 없음). 이후 바뀐 값은 MenuShortcuts가 메뉴에 직접 반영한다.
    func shortcut(_ command: ShortcutCommand) -> some View {
        keyboardShortcut(AppModel.shared.shortcut(command)?.keyboardShortcut)
    }
}

/// 설정 → 단축키. 칸을 누르고 새 조합을 누르면 바뀐다.
struct ShortcutSettings: View {
    @Environment(AppModel.self) private var app
    @State private var recording: ShortcutCommand?
    @State private var message: String?

    private let groups: [(LocalizedStringKey, [ShortcutCommand])] = [
        ("파일", [.newNote, .newVoiceNote, .openInNewWindow, .saveNow]),
        ("편집", [.find, .findNext, .findPrevious, .useSelectionForFind, .searchNotes, .replace]),
        ("보기", [.zoomIn, .zoomOut, .actualSize, .preview, .refresh]),
        ("노트", [.tags, .attachFiles, .voiceRecording, .lock, .pin, .copyIssueNumber, .openOnGitHub, .moveToTrash])
    ]

    var body: some View {
        Form {
            Section {
                Text("칸을 누른 뒤 새 조합을 누르세요. ⌘·⌃·⌥ 중 하나는 함께 눌러야 합니다. ⎋는 취소입니다. ⌘1–⌘9는 저장소 전환에 씁니다.")
                    .font(.caption).foregroundStyle(.secondary)
                if let message {
                    Text(message).font(.caption).foregroundStyle(.orange)
                }
            }
            ForEach(groups.indices, id: \.self) { index in
                Section(groups[index].0) {
                    ForEach(groups[index].1, id: \.self) { command in
                        LabeledContent(command.title) {
                            HStack(spacing: 6) {
                                ShortcutRecorder(command: command, recording: $recording, message: $message)
                                Button {
                                    app.updateSettings { $0.shortcuts[command] = "" }
                                } label: { Image(systemName: "xmark.circle.fill") }
                                    .buttonStyle(.borderless)
                                    .foregroundStyle(.secondary)
                                    .help("단축키 없애기")
                                    .opacity(app.shortcut(command) == nil ? 0 : 1)
                                    .disabled(app.shortcut(command) == nil)
                                Button {
                                    assign(command.defaultSpec, to: command)
                                } label: { Image(systemName: "arrow.uturn.backward") }
                                    .buttonStyle(.borderless)
                                    .help("기본값으로")
                                    .opacity(isDefault(command) ? 0 : 1)
                                    .disabled(isDefault(command))
                            }
                        }
                    }
                }
            }
            Section {
                Button("모두 기본값으로") {
                    message = nil
                    app.updateSettings { $0.shortcuts = ShortcutCommand.defaults }
                }
            }
        }
        .formStyle(.grouped)
        .onDisappear { recording = nil }
    }

    private func isDefault(_ command: ShortcutCommand) -> Bool {
        (app.settings.shortcuts[command] ?? command.defaultSpec) == command.defaultSpec
    }

    private func assign(_ spec: String, to command: ShortcutCommand) {
        message = ShortcutRecorder.assign(spec, to: command, app: app)
    }
}

/// 단축키 칸. 누르면 다음 키 조합을 받는다.
struct ShortcutRecorder: View {
    @Environment(AppModel.self) private var app
    let command: ShortcutCommand
    @Binding var recording: ShortcutCommand?
    @Binding var message: String?
    @State private var monitor: Any?

    private var isRecording: Bool { recording == command }

    var body: some View {
        Button {
            recording = isRecording ? nil : command
        } label: {
            Text(isRecording ? String(localized: "키를 누르세요…") : (app.shortcut(command)?.symbol ?? String(localized: "없음")))
                .font(.body.monospaced())
                .foregroundStyle(isRecording ? Color.accentColor : (app.shortcut(command) == nil ? .secondary : .primary))
                .frame(minWidth: 110)
        }
        .onChange(of: isRecording) { _, value in value ? start() : stop() }
        .onDisappear { stop() }
    }

    private func start() {
        stop()
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
            MainActor.assumeIsolated { handle(event) }
            return nil
        }
    }

    private func stop() {
        if let monitor { NSEvent.removeMonitor(monitor) }
        monitor = nil
    }

    private func handle(_ event: NSEvent) {
        let flags = event.modifierFlags.intersection([.command, .option, .control, .shift])
        if event.keyCode == 53, flags.isEmpty { recording = nil; return }
        guard let shortcut = KeyShortcut(event: event) else { NSSound.beep(); return }
        guard shortcut.hasCommandModifier else {
            message = String(localized: "⌘·⌃·⌥ 중 하나를 함께 누르세요.")
            return
        }
        guard !shortcut.isWorkspaceSwitch else {
            message = String(localized: "⌘1–⌘9는 저장소 전환에 씁니다.")
            return
        }
        message = Self.assign(shortcut.spec, to: command, app: app)
        recording = nil
    }

    /// 다른 명령이 같은 조합을 쓰고 있으면 그쪽을 비운다. 알릴 말을 돌려준다.
    static func assign(_ spec: String, to command: ShortcutCommand, app: AppModel) -> String? {
        let taken = ShortcutCommand.allCases.filter { $0 != command && app.settings.shortcut($0)?.spec == spec }
        app.updateSettings { settings in
            settings.shortcuts[command] = spec
            for other in taken { settings.shortcuts[other] = "" }
        }
        guard !taken.isEmpty else { return nil }
        let names = taken.map(\.title).joined(separator: ", ")
        return String(localized: "‘\(names)’에 쓰던 단축키라 그쪽은 비웠습니다.")
    }
}
