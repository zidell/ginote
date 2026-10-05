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
            RootView()
                .environment(AppModel.shared)
                .frame(minWidth: 720, minHeight: 480)
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
    func applicationDidFinishLaunching(_ notification: Notification) {
        Task { @MainActor in
            AppModel.shared.applyTheme()
            // ⌘= (Shift 없이 누른 +/= 키)도 확대로 받는다. 메뉴의 ⌘+는 Shift가 필요한 배열이 많다.
            NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
                let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask).subtracting([.numericPad, .function])
                if flags == .command, event.charactersIgnoringModifiers == "=" {
                    MainActor.assumeIsolated { AppModel.shared.zoom(by: 0.1) }
                    return nil
                }
                return event
            }
            #if DEBUG
            NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
                let responder = event.window?.firstResponder.map { String(describing: type(of: $0)) } ?? "nil"
                DebugTrace.log("key \(event.keyCode) window=\(event.window?.title ?? "nil") responder=\(responder)")
                return event
            }
            if ProcessInfo.processInfo.environment["GINOTE_SELF_TEST"] != nil { await SelfTest.run() }
            #endif
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
        let arguments = CommandLine.arguments.dropFirst()
        if arguments.contains("--config-path") {
            print(ConfigStore.defaultDirectory.appendingPathComponent("config.toml").path)
            exit(0)
        }
        if arguments.contains("--help") || arguments.contains("-h") {
            print("""
            Usage: Ginote [--config-path] [--help]

              --config-path  Print the path of the settings file (config.toml) and exit.
              --help         Show this help and exit.

            Settings live in config.toml (documented by its own comments); the running app
            applies changes within about a second and writes config-status.txt next to it.
            GitHub tokens and the OpenAI API key are kept in the macOS Keychain.
            """)
            exit(0)
        }
    }
}
