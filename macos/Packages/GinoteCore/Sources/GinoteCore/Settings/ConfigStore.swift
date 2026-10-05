import Foundation

/// 설정 파일 읽기·쓰기·감시와 자격 증명. 웹 `settings-backend.js`와 Tauri `settings.rs`의 역할이다.
public final class ConfigStore: @unchecked Sendable {
    public static let bundleIdentifier = "net.gitools.note.mac"

    public let directory: URL
    public let keychain: Keychain
    /// 처음 실행할 때 Tauri 앱 설정·자격 증명을 가져올지. 디버그 자가 점검은 사람의 설정·키체인을 건드리지 않게 끈다.
    public let importsTauri: Bool
    public var configURL: URL { directory.appendingPathComponent("config.toml") }
    public var statusURL: URL { directory.appendingPathComponent("config-status.txt") }
    public var lastGoodURL: URL { directory.appendingPathComponent("state/last-good-config.toml") }

    private var lastWritten: String?
    private var watchTimer: DispatchSourceTimer?
    private var lastModified: Date?

    public init(directory: URL = ConfigStore.defaultDirectory, keychain: Keychain = Keychain(), importsTauri: Bool = true) {
        self.importsTauri = importsTauri
        self.directory = directory
        self.keychain = keychain
        try? FileManager.default.createDirectory(at: directory.appendingPathComponent("state"), withIntermediateDirectories: true)
    }

    public static var defaultDirectory: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent(bundleIdentifier)
    }

    /// Tauri 앱의 설정 폴더. 처음 실행 때 워크스페이스를 가져올 때만 읽는다.
    public static var tauriDirectory: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("net.gitools.note")
    }

    public enum LoadResult {
        case loaded(AppSettings, problems: [String])
        /// 문법 오류. 마지막 정상 설정으로 띄운다.
        case syntaxError(String, fallback: AppSettings)
    }

    /// 시작할 때 읽는다. 파일이 없으면 Tauri 설정을 가져오거나 기본값으로 만든다.
    public func load() -> LoadResult {
        if !FileManager.default.fileExists(atPath: configURL.path) {
            let settings = (importsTauri ? importFromTauri() : nil) ?? AppSettings()
            write(settings)
            writeStatus(problems: [])
            return .loaded(settings, problems: [])
        }
        return read()
    }

    func read() -> LoadResult {
        let source = (try? String(contentsOf: configURL, encoding: .utf8)) ?? ""
        lastModified = modificationDate()
        do {
            let result = try AppConfig.parse(source)
            writeStatus(problems: result.problems)
            if result.rewrite { write(result.settings) } else { saveLastGood(source) }
            return .loaded(result.settings, problems: result.problems)
        } catch let error as AppConfig.SyntaxError {
            writeStatus(problems: [], syntaxError: error.message)
            let fallback = (try? String(contentsOf: lastGoodURL, encoding: .utf8)).flatMap { try? AppConfig.parse($0).settings } ?? AppSettings()
            return .syntaxError(error.message, fallback: fallback)
        } catch {
            return .syntaxError(error.localizedDescription, fallback: AppSettings())
        }
    }

    /// 앱에서 바꾼 설정을 파일 전체로 다시 쓴다(주석은 늘 남는다).
    public func write(_ settings: AppSettings) {
        let text = AppConfig.render(settings)
        guard text != lastWritten || !FileManager.default.fileExists(atPath: configURL.path) else { return }
        lastWritten = text
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try? text.write(to: configURL, atomically: true, encoding: .utf8)
        lastModified = modificationDate()
        saveLastGood(text)
    }

    func saveLastGood(_ text: String) {
        try? text.write(to: lastGoodURL, atomically: true, encoding: .utf8)
    }

    func writeStatus(problems: [String], syntaxError: String? = nil) {
        let text = AppConfig.renderStatus(loadedAt: Date(), problems: problems, syntaxError: syntaxError)
        try? text.write(to: statusURL, atomically: true, encoding: .utf8)
    }

    func modificationDate() -> Date? {
        (try? FileManager.default.attributesOfItem(atPath: configURL.path))?[.modificationDate] as? Date
    }

    /// 바깥에서 파일을 고치면 1초 안에 `onChange`를 부른다. 앱이 방금 쓴 내용과 같으면 무시한다.
    public func startWatching(onChange: @escaping @MainActor (LoadResult) -> Void) {
        // 주 스레드에서 돈다. write()도 주 스레드에서 불리므로 lastWritten·lastModified를 함께 써도 경합이 없다.
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now() + 1, repeating: 1)
        timer.setEventHandler { [weak self] in
            guard let self else { return }
            let modified = self.modificationDate()
            guard modified != self.lastModified else { return }
            self.lastModified = modified
            let source = (try? String(contentsOf: self.configURL, encoding: .utf8)) ?? ""
            guard source != self.lastWritten else { return }
            self.lastWritten = source
            let result = self.read()
            MainActor.assumeIsolated { onChange(result) }
        }
        timer.resume()
        watchTimer = timer
    }

    // MARK: - Tauri 앱에서 가져오기

    /// Tauri 앱의 config.toml이 있으면 워크스페이스와 설정을 가져오고, PAT·OpenAI 키를 이 앱의 Keychain 항목으로 복사한다.
    /// 원본은 건드리지 않는다. macOS가 처음 한 번 Keychain 접근을 물을 수 있다.
    func importFromTauri() -> AppSettings? {
        let url = Self.tauriDirectory.appendingPathComponent("config.toml")
        guard let source = try? String(contentsOf: url, encoding: .utf8),
              let parsed = try? AppConfig.parse(source) else { return nil }
        var settings = parsed.settings
        // Tauri의 테마는 dark/light뿐이라 그대로 따르면 시스템 모양을 무시하게 된다. 맥 기본값(시스템)으로 시작한다.
        settings.preferences.theme = .system
        // 웹·Tauri 기본 본문 크기(17)는 사용자가 고른 값이 아니므로 맥 기본값(16)을 쓴다.
        if settings.preferences.editorFontSize == 17 { settings.preferences.editorFontSize = Preferences().editorFontSize }
        let tauri = Keychain(service: Keychain.tauriService)
        for workspace in settings.workspaces where workspace.rememberToken {
            if let token = tauri.read(Keychain.patAccount(workspace.id)) {
                keychain.write(Keychain.patAccount(workspace.id), token)
            }
        }
        if let key = tauri.read(Keychain.openAIAccount) {
            keychain.write(Keychain.openAIAccount, key)
        }
        return settings
    }
}
