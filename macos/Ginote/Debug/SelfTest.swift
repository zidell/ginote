import AppKit

/// 디버그 빌드에서 화면 상태 변화를 GINOTE_TRACE_LOG 파일에 남긴다. 릴리스 빌드에서는 아무것도 하지 않는다.
enum DebugTrace {
    /// 디버그 빌드는 늘 기록한다. GINOTE_TRACE_LOG가 없으면 ~/Library/Logs/Ginote Native/debug.log에 쓰고,
    /// 5MB를 넘으면 debug.1.log로 한 번 넘긴다(최근 기록만 남는다).
    static let path: String? = {
        #if DEBUG
        if let path = ProcessInfo.processInfo.environment["GINOTE_TRACE_LOG"] { return path }
        let folder = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/Ginote Native")
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        return folder.appendingPathComponent("debug.log").path
        #else
        return nil
        #endif
    }()

    static func log(_ message: @autoclosure () -> String) {
        #if DEBUG
        guard let path else { return }
        if let size = (try? FileManager.default.attributesOfItem(atPath: path))?[.size] as? Int, size > 5_000_000 {
            let previous = (path as NSString).deletingPathExtension + ".1.log"
            try? FileManager.default.removeItem(atPath: previous)
            try? FileManager.default.moveItem(atPath: path, toPath: previous)
        }
        let line = "\(Date().timeIntervalSince1970) \(message())\n"
        if let handle = FileHandle(forWritingAtPath: path) {
            handle.seekToEndOfFile()
            handle.write(Data(line.utf8))
            try? handle.close()
        } else {
            try? line.write(toFile: path, atomically: true, encoding: .utf8)
        }
        #endif
    }
}

#if DEBUG

/// 디버그 앱의 선택 E2E·화면 점검 실행기. 사용자 설정·키체인은 쓰지 않는다.
@MainActor
enum SelfTest {
    static var passed = 0
    static var failed = 0
    static var lines: [String] = []
    static let values = ProcessInfo.processInfo.environment

    static func report(_ line: String) {
        print(line)
        lines.append(line)
        if let path = values["GINOTE_SELF_TEST_LOG"] {
            try? (lines.joined(separator: "\n") + "\n").write(toFile: path, atomically: true, encoding: .utf8)
        }
    }

    static func check(_ condition: Bool, _ name: String, _ detail: @autoclosure () -> String = "") {
        if condition { passed += 1; report("PASS \(name)") } else { failed += 1; report("FAIL \(name) \(detail())") }
    }

    static func wait(_ name: String, timeout: Double = 30, _ condition: () async -> Bool) async -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if await condition() { return true }
            try? await Task.sleep(for: .milliseconds(250))
        }
        report("TIMEOUT \(name)")
        return false
    }

    static func step(_ name: String, _ body: () async throws -> Void) async {
        report("== \(name)")
        do { try await body() } catch { failed += 1; report("FAIL \(name) threw: \(error)") }
    }

    static let runId = String(Int(Date().timeIntervalSince1970) % 100000)

    static func run() async {
        guard let repo = values["GINOTE_TEST_REPO"], let token = values["GINOTE_DEBUG_TOKEN"] else {
            report("FAIL missing GINOTE_TEST_REPO / GINOTE_DEBUG_TOKEN"); exit(2)
        }
        let app = AppModel.shared
        if values["GINOTE_SELF_TEST"] == "e2e" { await E2E.run(app: app, repo: repo, token: token); return }
        guard values["GINOTE_SELF_TEST"] == "ui" else {
            report("FAIL unknown GINOTE_SELF_TEST mode")
            exit(2)
        }
        if app.settings.workspaces.isEmpty { app.addWorkspace(repo: repo, token: token, remember: false) }
        // 화면 점검 모드: 시험 저장소에 연결만 하고 앱을 그대로 둔다.
        if let number = values["GINOTE_UI_SELECT"].flatMap(Int.init),
           await wait("ui list", { app.workspace?.issues.isEmpty == false }),
           let issue = app.workspace?.displayedIssues.first(where: { $0.number == number }) {
            app.workspace?.open(issue.id)
            if values["GINOTE_UI_IME"]?.isEmpty == false { await simulateKoreanInput(number: number) }
        }
    }

    /// 입력기가 보내는 것과 같은 순서로 한글을 조합해 넣는다: ㅎ→하→한(조합 중) → 확정 → 줄바꿈 → 글 → 확정.
    /// 마지막 글자를 조합하는 중에 줄바꿈해도 글자가 남고 줄이 바뀌는지, 저장된 본문이 맞는지 본다.
    static func simulateKoreanInput(number: Int) async {
        try? await Task.sleep(for: .seconds(3))
        guard let window = NSApp.windows.first(where: { $0.isVisible && $0.title != "" || $0.isMainWindow }),
              let textView = findTextView(in: window.contentView) else { report("FAIL ime: no editor"); return }
        window.makeKeyAndOrderFront(nil)
        window.makeFirstResponder(textView)
        textView.setSelectedRange(NSRange(location: (textView.string as NSString).length, length: 0))
        let before = textView.string
        textView.insertNewline(nil)
        for (marked, commit) in [(["ㅎ", "하", "한"], "한"), (["ㄱ", "그", "글"], "글")] {
            for syllable in marked {
                textView.setMarkedText(syllable, selectedRange: NSRange(location: (syllable as NSString).length, length: 0), replacementRange: NSRange(location: NSNotFound, length: 0))
                try? await Task.sleep(for: .milliseconds(80))
            }
            check(textView.hasMarkedText(), "ime composing \(commit)")
            textView.insertText(commit, replacementRange: textView.markedRange())
            if commit == "한" { textView.insertNewline(nil) }
        }
        check(textView.string == before + "\n한\n글", "ime text", textView.string.debugDescription)
        guard let session = AppModel.shared.workspace?.sessions[number] else { report("FAIL ime: no session"); return }
        check(session.body == textView.string, "ime session body", session.body.debugDescription)
        _ = await wait("ime save", timeout: 20) { !session.dirty && !session.saving }
        let remote = (try? await AppModel.shared.workspace!.client.getIssue(number).body) ?? ""
        check(remote.hasSuffix("\n한\n글"), "ime saved to GitHub", remote.debugDescription)
        report("RESULT ime passed=\(passed) failed=\(failed)")
    }

    static func findTextView(in view: NSView?) -> GinoteTextView? {
        guard let view else { return nil }
        if let textView = view as? GinoteTextView { return textView }
        for subview in view.subviews { if let found = findTextView(in: subview) { return found } }
        return nil
    }

    static func finish() {
        report("RESULT passed=\(passed) failed=\(failed)")
        for line in Dialogs.log { report("dialog: \(line)") }
        exit(failed == 0 ? 0 : 1)
    }
}
#endif
