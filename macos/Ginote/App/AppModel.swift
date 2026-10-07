import AppKit
import GinoteCore
import Network
import Observation

/// 앱 전체 상태: 설정, 자격 증명, 잠금 세션, 활성 워크스페이스.
@MainActor
@Observable
final class AppModel {
    static let shared = AppModel()

    let configStore = ConfigStore(directory: AppModel.configDirectory, keychain: Keychain(service: AppModel.keychainService),
                                  importsTauri: !AppModel.isSelfTest)
    let localState = LocalState(directory: AppModel.configDirectory.appendingPathComponent("state"))

    /// 디버그 빌드의 자가 점검은 사용자 설정·키체인과 섞이지 않게 따로 둔다(Debug/SelfTest.swift).
    /// 단위 테스트(XCTest)가 앱을 띄운 경우. 창을 띄우지 않고 사용자 설정·키체인을 건드리지 않는다.
    nonisolated static var isUnitTest: Bool {
        #if DEBUG
        return ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil
        #else
        return false
        #endif
    }

    static var configDirectory: URL {
        #if DEBUG
        if let path = ProcessInfo.processInfo.environment["GINOTE_CONFIG_DIR"] { return URL(fileURLWithPath: path) }
        if isUnitTest {
            return FileManager.default.temporaryDirectory.appendingPathComponent("ginote-unit-tests-\(ProcessInfo.processInfo.processIdentifier)")
        }
        #endif
        return ConfigStore.defaultDirectory
    }

    /// 자가 점검(GINOTE_CONFIG_DIR로 따로 둔 설정 폴더)으로 실행 중인지.
    static var isSelfTest: Bool {
        #if DEBUG
        return ProcessInfo.processInfo.environment["GINOTE_CONFIG_DIR"] != nil || isUnitTest
        #else
        return false
        #endif
    }

    static var skipsKeychain: Bool {
        #if DEBUG
        return ProcessInfo.processInfo.environment["GINOTE_SELF_TEST"] == "ui" || isUnitTest
        #else
        return false
        #endif
    }

    static var keychainService: String {
        #if DEBUG
        if isUnitTest { return Keychain.service + ".unittest" }
        if ProcessInfo.processInfo.environment["GINOTE_CONFIG_DIR"] != nil { return Keychain.service + ".selftest" }
        #endif
        return Keychain.service
    }
    let noteLock = NoteLock(pepper: BuildPepper.value)
    let lockSession = LockSession()

    private(set) var settings = AppSettings()
    /// 워크스페이스 id → PAT. 기억하지 않는 토큰도 실행 중에는 여기 둔다.
    private(set) var tokens: [String: String] = [:]
    var openAIKey: String = "" {
        didSet {
            guard openAIKey != oldValue else { return }
            configStore.keychain.write(Keychain.openAIAccount, openAIKey)
        }
    }

    private(set) var workspace: WorkspaceModel?
    private var cachedWorkspaces: [String: (model: WorkspaceModel, cachedAt: Date)] = [:]

    /// 시작 화면에서 띄울 설정 파일 문제(문법 오류).
    var configNotice: String?
    var tokenPromptWorkspace: Workspace?
    var showingAddWorkspace = false
    var voiceRequest: VoiceRequest?
    /// 저장소 id → 열린 노트 수(사이드바 배지).
    var workspaceNoteCounts: [String: Int] = [:]

    /// 연결하지 않은 다른 저장소의 노트 수도 기억한 토큰으로 한 번 센다.
    func loadOtherWorkspaceCounts() {
        for item in settings.workspaces where workspaceNoteCounts[item.id] == nil && item.id != workspace?.workspace.id {
            guard let token = tokens[item.id] else { continue }
            Task {
                if let counts = try? await GitHubClient(token: token, repo: item.repo).noteCounts() {
                    workspaceNoteCounts[item.id] = counts.notes
                }
            }
        }
    }
    /// 목록에서 ⏎를 누르면 열린 노트의 편집기로 포커스를 옮긴다.
    var editorFocusRequest = 0
    /// 노트를 여는 동시에 본문으로 들어갈 때. 새로 뜬 노트 화면이 받아 간다.
    var pendingEditorFocus = false
    /// 받았지만 아직 처리하지 않은 ginote:// 링크(docs/DEEP_LINK.md). 링크 기능을 붙일 때 여기서 꺼내 쓴다.
    var pendingDeepLinks: [URL] = []
    /// 메뉴 명령(GinoteCommands)이 넘겨 둔 메인 창 열기. 메인 창 없이 시작했을 때 쓴다.
    @ObservationIgnored var openMainWindow: (() -> Void)?

    /// 메인 창을 닫고(설정 창만 남기고) 끝내면 다음 실행에 창 복원이 아무 창도 되살리지 않는다. 그때 메인 창을 연다.
    func openMainWindowIfMissing() {
        guard !NSApp.windows.contains(where: { $0.isVisible && $0.identifier?.rawValue.hasPrefix("main") == true }) else { return }
        openMainWindow?()
    }

    /// 열린 노트의 본문으로 포커스를 옮긴다. 방금 연 노트면 화면이 뜬 뒤에 옮긴다.
    func focusEditor(openingNew: Bool) {
        if openingNew { pendingEditorFocus = true } else { editorFocusRequest += 1 }
    }
    /// 본문에서 ⎋를 누르면 목록으로 포커스를 돌린다.
    var listFocusRequest = 0
    /// 지금 키보드 포커스가 있는 칸(사이드바·목록). 목록 맨 위 ↑ 처리에 쓴다.
    var activePane: PaneFocus?
    /// 검색칸에서 ↑를 누르면 새 노트 버튼에 포커스를 둔다(⏎·Space로 만들기, ↓·⎋로 검색칸).
    var toolbarKeyFocus: ToolbarKeyFocus?

    /// 목록 위 툴바 버튼의 키보드 포커스(검색칸에서 ↑로 올라온다).
    enum ToolbarKeyFocus { case newNote, voice }
    /// ⇧⌘F: 목록 위 검색칸으로.
    var searchFocusRequest = 0
    /// 도움말 창에서 처음 보일 주제(빈 화면의 도움말 바로가기).
    var helpTopic: HelpView.Topic = .security

    /// ⌘+ / ⌘- / ⌘0: 내용 글자 배율. config.toml(display.ui_scale)에 기억한다.
    func zoom(by step: Double) {
        updateSettings { settings in
            let next = (settings.preferences.uiScale + step) * 10
            settings.preferences.uiScale = min(Preferences.uiScaleRange.upperBound, max(Preferences.uiScaleRange.lowerBound, next.rounded() / 10))
        }
    }

    func resetZoom() { updateSettings { $0.preferences.uiScale = 1.0 } }
    var settingsTab: SettingsTab = .general

    private var pathMonitor: NWPathMonitor?
    private var lastPathSatisfied = true

    private init() {
        switch configStore.load() {
        case .loaded(let loaded, _):
            settings = loaded
        case .syntaxError(let message, let fallback):
            settings = fallback
            configNotice = String(localized: "config.toml 문법이 틀려 마지막 정상 설정으로 열었습니다. 같은 폴더의 config-status.txt를 확인하세요.") + "\n" + message
        }
        // 화면 점검(GINOTE_SELF_TEST=ui)은 토큰을 환경변수로 받으므로 키체인을 읽지 않는다. 읽으면 시험용 항목의 접근
        // 허용을 묻는 창이 사람이 쓰는 화면에 뜬다.
        if !Self.skipsKeychain {
            for workspace in settings.workspaces where workspace.rememberToken {
                if let token = configStore.keychain.read(Keychain.patAccount(workspace.id)) { tokens[workspace.id] = token }
            }
            openAIKey = configStore.keychain.read(Keychain.openAIAccount) ?? ""
        }
        lockSession.minutes = settings.preferences.lockSessionMinutes
        // 앱 모델은 앱이 끝날 때까지 산다.
        lockSession.onExpire = { [unowned self] in
            let models = [self.workspace].compactMap { $0 } + self.cachedWorkspaces.values.map(\.model)
            for session in models.flatMap({ $0.sessions.values }) { Task { await session.expireLock() } }
        }
        applyTheme()
        configStore.startWatching { [weak self] result in self?.applyExternalConfig(result) }
        observeSystem()
        openActiveWorkspace()
    }

    // MARK: - 설정

    func updateSettings(_ change: (inout AppSettings) -> Void) {
        var next = settings
        change(&next)
        guard next != settings else { return }
        let previous = settings
        settings = next
        configStore.write(next)
        didChangeSettings(from: previous)
    }

    private func didChangeSettings(from previous: AppSettings) {
        if previous.shortcuts != settings.shortcuts { MenuShortcuts.apply(settings) }
        if previous.preferences.theme != settings.preferences.theme { applyTheme() }
        lockSession.minutes = settings.preferences.lockSessionMinutes
        if previous.preferences.notesPerPage != settings.preferences.notesPerPage {
            Task { await workspace?.reload() }
        }
        // 지운 워크스페이스나 토큰 기억을 끈 워크스페이스의 토큰은 Keychain에서 지운다.
        for old in previous.workspaces {
            let current = settings.workspaces.first { $0.id == old.id }
            if current == nil || current?.rememberToken == false {
                configStore.keychain.delete(Keychain.patAccount(old.id))
            }
            if current == nil {
                tokens[old.id] = nil
                cachedWorkspaces[old.id] = nil
            }
        }
        if let workspace, let current = settings.workspaces.first(where: { $0.id == workspace.workspace.id }) {
            if current.repo != workspace.workspace.repo {
                openActiveWorkspace()
            } else {
                workspace.workspace = current
            }
        }
        if settings.activeWorkspaceId != previous.activeWorkspaceId || workspace == nil
            || !settings.workspaces.contains(where: { $0.id == workspace?.workspace.id }) {
            openActiveWorkspace()
        }
    }

    private func applyExternalConfig(_ result: ConfigStore.LoadResult) {
        switch result {
        case .loaded(let loaded, _):
            let previous = settings
            settings = loaded
            didChangeSettings(from: previous)
        case .syntaxError:
            configNotice = String(localized: "config.toml 문법이 틀려 변경을 반영하지 않았습니다. 같은 폴더의 config-status.txt를 확인하세요.")
        }
    }

    func applyTheme() {
        switch settings.preferences.theme {
        case .system: NSApp?.appearance = nil
        case .light: NSApp?.appearance = NSAppearance(named: .aqua)
        case .dark: NSApp?.appearance = NSAppearance(named: .darkAqua)
        }
    }

    // MARK: - 워크스페이스

    /// 저장소의 화면 모델. 지금 저장소나 기억해 둔 모델이 있으면 그것을, 없으면 토큰으로 새로 만들어 기억한다
    /// (설정 → 저장소에서 다른 저장소의 태그를 다룰 때). 토큰이 없으면 nil.
    func model(forWorkspace id: String) -> WorkspaceModel? {
        if let workspace, workspace.workspace.id == id { return workspace }
        if let cached = cachedWorkspaces[id] { return cached.model }
        guard let record = settings.workspaces.first(where: { $0.id == id }), let token = tokens[id], !token.isEmpty else { return nil }
        let model = WorkspaceModel(workspace: record, token: token, app: self)
        cachedWorkspaces[id] = (model, .distantPast)
        return model
    }

    /// 연결 확인을 마친 새 저장소를 추가하고 그 저장소로 전환한다.
    func addWorkspace(repo: String, token: String, remember: Bool) {
        let record = Workspace(repo: repo, rememberToken: remember)
        tokens[record.id] = token
        if remember { configStore.keychain.write(Keychain.patAccount(record.id), token) }
        updateSettings {
            $0.workspaces.append(record)
            $0.activeWorkspaceId = record.id
        }
    }

    func setToken(_ token: String, for workspace: Workspace, remember: Bool) {
        tokens[workspace.id] = token
        updateSettings { settings in
            if let index = settings.workspaces.firstIndex(where: { $0.id == workspace.id }) {
                settings.workspaces[index].rememberToken = remember
            }
        }
        if remember { configStore.keychain.write(Keychain.patAccount(workspace.id), token) }
        tokenPromptWorkspace = nil
        openActiveWorkspace()
    }

    func switchWorkspace(to id: String) {
        guard id != settings.activeWorkspaceId else { return }
        updateSettings { $0.activeWorkspaceId = id }
    }

    func switchWorkspace(number: Int) {
        guard settings.workspaces.indices.contains(number - 1) else { return }
        switchWorkspace(to: settings.workspaces[number - 1].id)
    }

    func removeWorkspace(_ id: String) {
        updateSettings { settings in
            settings.workspaces.removeAll { $0.id == id }
            if settings.activeWorkspaceId == id { settings.activeWorkspaceId = settings.workspaces.first?.id ?? "" }
        }
    }

    private func openActiveWorkspace() {
        if let current = workspace {
            current.cancelAllTrash()
            current.suspend()
            cachedWorkspaces[current.workspace.id] = (current, Date())
        }
        guard let active = settings.activeWorkspace else {
            workspace = nil
            return
        }
        guard let token = tokens[active.id], !token.isEmpty else {
            workspace = nil
            tokenPromptWorkspace = active
            return
        }
        let maxAge = TimeInterval(settings.preferences.workspaceCacheMinutes * 60)
        if let cached = cachedWorkspaces[active.id], Date().timeIntervalSince(cached.cachedAt) < maxAge,
           cached.model.client.token == token, cached.model.workspace.repo == active.repo {
            workspace = cached.model
            cached.model.workspace = active
            Task { await cached.model.refresh(background: true, ignoringCooldown: true) }
        } else {
            let model = WorkspaceModel(workspace: active, token: token, app: self)
            workspace = model
            Task { await model.connect() }
        }
    }

    /// 다른 워크스페이스로 전환하기 전·종료 전에 남은 저장을 끝낸다.
    func flushAll() async {
        await workspace?.flushAll()
        for entry in cachedWorkspaces.values { await entry.model.flushAll() }
    }

    // MARK: - 시스템 이벤트

    /// API 키가 없어 설정으로 보낸 음성 요청. 설정 창을 닫을 때 키가 있으면 다시 연다.
    var voiceAfterSettings: VoiceRequest?

    private func observeSystem() {
        let center = NotificationCenter.default
        center.addObserver(forName: NSWindow.willCloseNotification, object: nil, queue: .main) { [weak self] note in
            let isSettings = (note.object as? NSWindow)?.identifier?.rawValue.contains("Settings") == true
            Task { @MainActor in
                guard let self, isSettings, let request = self.voiceAfterSettings else { return }
                self.voiceAfterSettings = nil
                guard !self.openAIKey.trimmingCharacters(in: .whitespaces).isEmpty else { return }
                self.voiceRequest = VoiceRequest(target: request.target, workspace: request.workspace, session: request.session)
            }
        }
        center.addObserver(forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in await self?.workspace?.refresh(background: true) }
        }
        // 다른 앱으로 넘어가면 남은 저장을 바로 한다(웹의 visibilitychange hidden).
        center.addObserver(forName: NSApplication.didResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in await self?.workspace?.flushAll() }
        }
        NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in await self?.workspace?.refresh(background: true) }
        }
        NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.willSleepNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.clearLockOnSleepIfNeeded() }
        }
        DistributedNotificationCenter.default().addObserver(forName: Notification.Name("com.apple.screenIsLocked"), object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.clearLockOnSleepIfNeeded() }
        }
        let monitor = NWPathMonitor()
        monitor.pathUpdateHandler = { [weak self] path in
            let satisfied = path.status == .satisfied
            Task { @MainActor in await self?.networkChanged(satisfied: satisfied) }
        }
        monitor.start(queue: .global(qos: .utility))
        pathMonitor = monitor
    }

    /// 네트워크가 끊겼다 돌아오면 목록을 새로 읽는다.
    func networkChanged(satisfied: Bool) async {
        defer { lastPathSatisfied = satisfied }
        if satisfied && !lastPathSatisfied { await workspace?.refresh(background: true) }
    }

    func clearLockOnSleepIfNeeded() {
        guard settings.preferences.clearLockOnSleep else { return }
        lockSession.clear()
    }
}

/// 빌드 때 넣은 잠금 pepper(macos/DESIGN.md §7). 비어 있으면 NoteLock이 기본값을 쓴다.
enum BuildPepper {
    static var value: String? {
        guard let data = Data(base64Encoded: BuildLockPepper.base64), !data.isEmpty else { return nil }
        return String(data: data, encoding: .utf8)
    }
}

/// 입력한 잠금 숫자를 정해진 시간 동안만 기억한다. 숫자는 저장하지 않는다.
@MainActor
@Observable
final class LockSession {
    private(set) var pin: String?
    var minutes = 60 { didSet { if pin != nil, minutes != oldValue { restartTimer() } } }
    /// 세션이 끝날 때마다 바뀐다. 열린 노트가 이 값을 보고 다시 잠근다.
    private(set) var generation = 0
    private var timer: Task<Void, Never>?
    var onExpire: (() -> Void)?

    func remember(_ pin: String) {
        self.pin = pin
        restartTimer()
    }

    func clear() {
        timer?.cancel()
        guard pin != nil else { return }
        pin = nil
        generation += 1
        onExpire?()
    }

    private func restartTimer() {
        timer?.cancel()
        let seconds = minutes * 60
        timer = Task { [weak self] in
            try? await Task.sleep(for: .seconds(seconds))
            guard !Task.isCancelled else { return }
            self?.clear()
        }
    }
}
