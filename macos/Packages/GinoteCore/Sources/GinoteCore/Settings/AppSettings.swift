import Foundation

/// 저장소 하나(노트 묶음). 토큰은 여기 두지 않고 Keychain에 둔다.
public struct Workspace: Codable, Equatable, Hashable, Identifiable, Sendable {
    public var id: String
    public var repo: String
    public var displayName: String
    public var rememberToken: Bool

    public init(id: String = UUID().uuidString.lowercased(), repo: String, displayName: String = "", rememberToken: Bool = true) {
        self.id = id; self.repo = repo; self.displayName = displayName; self.rememberToken = rememberToken
    }

    /// 표시 이름이 비면 저장소 주소를 쓴다.
    public var title: String {
        let trimmed = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? repo : trimmed
    }

    public var owner: String { RepoAddress.parse(repo)?.owner ?? "" }
}

public enum Theme: String, CaseIterable, Sendable { case system, light, dark }
public enum TitleMode: String, CaseIterable, Sendable { case firstLine = "first-line", separate }

public struct ListRowFields: Equatable, Sendable {
    public var title = true
    public var summary = true
    public var meta = true
    public var tags = true
    public init() {}
}

public struct Preferences: Equatable, Sendable {
    public static let lockSessionOptions = [5, 15, 30, 60, 180, 480, 720, 1440]
    public static let workspaceCacheOptions = [5, 15, 30, 60, 180, 360, 720, 1440]
    public static let fixedFonts = ["system", "sans", "serif", "mono"]

    public var theme: Theme = .system
    public var titleMode: TitleMode = .firstLine
    /// "system", "sans", "serif", "mono" 또는 "local:<설치된 글꼴 이름>".
    public var editorFont = "system"
    public var editorFontSize = 16
    /// ⌘+ / ⌘- 로 바꾸는 내용 글자 배율(본문·목록·기록·미리보기). 0.8~1.6, 0.1 단위.
    public var uiScale = 1.0
    public static let uiScaleRange = 0.8...1.6
    public var editorLineHeight = 1.8
    public var editorMaxWidth = 840
    public var listRow = ListRowFields()
    public var autoSaveSeconds = 5
    public var notesPerPage = 30
    public var lockSessionMinutes = 60
    public var workspaceCacheMinutes = 60
    public var clearLockOnSleep = true

    public init() {}
}

public struct VoicePreferences: Equatable, Sendable {
    public var transcriptionModel = VoicePresets.defaultTranscriptionModel
    /// 빈 값이면 정제하지 않고 전사문만 쓴다.
    public var refinementModel = VoicePresets.defaultRefinementModel
    public var preserveOriginalAudio = false
    public var refinementPrompt = VoicePresets.defaultRefinementPrompt

    public init() {}
}

/// `config.toml`에 담기는 설정 전체. 자격 증명(PAT, OpenAI 키)은 들어 있지 않다.
public struct AppSettings: Equatable, Sendable {
    public var workspaces: [Workspace] = []
    public var activeWorkspaceId = ""
    public var preferences = Preferences()
    public var voice = VoicePreferences()
    /// 메뉴 단축키(`option+cmd+t` 형식). 빈 글이면 그 명령에 단축키가 없다.
    public var shortcuts = ShortcutCommand.defaults

    public init() {}

    public var activeWorkspace: Workspace? {
        workspaces.first { $0.id == activeWorkspaceId } ?? workspaces.first
    }
}
