import AppKit
import GinoteCore
import SwiftUI

@main
struct GinoteApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate

    init() {
        CommandLineInterface.handle()
    }

    var body: some Scene {
        WindowGroup("Ginote", id: "main") {
            // 단위 테스트로 띄운 앱은 메인 화면을 그리지 않는다. 그리면 테스트가 바꾼 상태(설정 오류 알림·음성 요청 등)를 보고
            // 닫아 둔 창을 다시 화면에 올린다.
            if !AppModel.isUnitTest {
                RootView()
                    .environment(AppModel.shared)
                    .frame(minWidth: 720, minHeight: 480)
            }
        }
        .defaultSize(width: 1180, height: 780)
        .commands { GinoteCommands() }

        WindowGroup("노트", id: "note", for: Int.self) { $number in
            if let number {
                NoteWindowView(number: number)
                    .environment(AppModel.shared)
            }
        }
        .defaultSize(width: 760, height: 720)

        Settings {
            SettingsView()
                .environment(AppModel.shared)
        }

        Window("Ginote 도움말", id: "help") {
            HelpView()
                .environment(AppModel.shared)
        }
        .defaultSize(width: 640, height: 640)
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    /// 단위 테스트가 띄운 앱은 Dock에 나오지 않고 앞으로 오지 않으며 창도 닫는다. 테스트하는 동안 화면을 차지하지 않게 한다.
    /// 창은 내리기만 하지 않고 닫는다. 살아 있는 메인 화면이 테스트가 바꾼 상태(음성 요청·저장소 추가 등)를 보고 시트를
    /// 띄우거나, 테스트의 화면 검사 훅에 대신 답하지 않게 한다.
    func applicationWillFinishLaunching(_ notification: Notification) {
        if AppModel.isUnitTest { NSApp.setActivationPolicy(.prohibited) }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        if AppModel.isUnitTest {
            DispatchQueue.main.async { NSApp.windows.forEach { $0.close() } }
            return
        }
        Task { @MainActor in await Self.start() }
    }

    /// 창 복원이 끝나기를 잠깐 기다렸다가, 메인 창이 없으면 연다.
    @MainActor
    static func ensureMainWindow() async {
        try? await Task.sleep(for: .milliseconds(500))
        AppModel.shared.openMainWindowIfMissing()
    }

    /// 앱이 뜬 뒤 한 번: 테마, 메뉴 단축키, 키 감시.
    @MainActor
    static func start() async {
        AppModel.shared.applyTheme()
        MenuShortcuts.install()
        Task { await ensureMainWindow() }
        NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in MainActor.assumeIsolated { zoomKey(event) } }
        #if DEBUG
        NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in MainActor.assumeIsolated { traceKey(event) } }
        if ProcessInfo.processInfo.environment["GINOTE_SELF_TEST"] != nil { await SelfTest.run() }
        #endif
    }

    /// ⌘= (Shift 없이 누른 +/= 키)도 확대로 받는다. 메뉴의 ⌘+는 Shift가 필요한 배열이 많다.
    /// 확대 단축키를 바꿨으면 그 조합만 쓴다.
    @MainActor
    static func zoomKey(_ event: NSEvent) -> NSEvent? {
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask).subtracting([.numericPad, .function])
        guard flags == .command, event.charactersIgnoringModifiers == "=",
              AppModel.shared.shortcut(.zoomIn)?.spec == ShortcutCommand.zoomIn.defaultSpec else { return event }
        AppModel.shared.zoom(by: 0.1)
        return nil
    }

    /// 디버그 빌드: 누른 키와 받는 곳을 기록한다(DebugTrace).
    @MainActor
    static func traceKey(_ event: NSEvent) -> NSEvent? {
        let responder = event.window?.firstResponder.map { String(describing: type(of: $0)) } ?? "nil"
        DebugTrace.log("key \(event.keyCode) window=\(event.window?.title ?? "nil") responder=\(responder)")
        return event
    }

    /// ginote:// 링크(docs/DEEP_LINK.md). 아직 링크로 하는 일이 없어 쌓아 두고 메인 창만 앞으로 가져온다.
    /// 이 메서드가 있으면 SwiftUI가 링크마다 새 창을 열지 않는다.
    func application(_ application: NSApplication, open urls: [URL]) {
        let links = urls.filter { $0.scheme?.lowercased() == "ginote" }
        guard !links.isEmpty else { return }
        Task { @MainActor in
            AppModel.shared.pendingDeepLinks.append(contentsOf: links)
            #if DEBUG
            DebugTrace.log("deep link \(links.map(\.absoluteString))")
            #endif
            NSApp.activate(ignoringOtherApps: true)
            AppModel.shared.openMainWindowIfMissing()
        }
    }

    /// 종료 전에 남은 저장을 끝낸다.
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        Task { @MainActor in
            await AppModel.shared.flushAll()
            sender.reply(toApplicationShouldTerminate: true)
        }
        return .terminateLater
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
}

/// `Ginote Native.app/Contents/MacOS/Ginote --config-path`, `--help`. 창을 띄우기 전에 처리하고 끝낸다.
enum CommandLineInterface {
    static func handle() {
        guard let text = output(for: Array(CommandLine.arguments.dropFirst())) else { return }
        print(text)
        exit(0)
    }

    /// 처리할 인자면 출력할 글, 아니면 nil(앱을 띄운다).
    static func output(for arguments: [String]) -> String? {
        if arguments.contains("--config-path") {
            return ConfigStore.defaultDirectory.appendingPathComponent("config.toml").path
        }
        if arguments.contains("--help") || arguments.contains("-h") {
            return """
            Usage: Ginote [--config-path] [--help]

              --config-path  Print the path of the settings file (config.toml) and exit.
              --help         Show this help and exit.

            Settings live in config.toml (documented by its own comments); the running app
            applies changes within about a second and writes config-status.txt next to it.
            GitHub tokens and the OpenAI API key are kept in the macOS Keychain.
            """
        }
        return nil
    }
}
