import AppKit
import GinoteCore
import SwiftUI

/// 6자리 잠금 숫자 시트. 숫자만 받고, 열 때는 6번째 숫자에서 바로 제출한다.
struct LockSheet: View {
    private var app: AppModel { .shared }
    @Environment(\.dismiss) private var dismiss
    @Bindable var session: NoteSession
    let prompt: NoteSession.LockPrompt
    @State var pin = ""
    @State private var errorMessage: String?
    @State var busy = false

    private var isLocking: Bool { prompt == .lock }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label(isLocking ? "노트 잠금" : "잠긴 노트", systemImage: "lock.fill").font(.headline)
            Text(isLocking ? lockHelp : String(localized: "내용을 보려면 계정에서 사용한 6자리 숫자를 입력하세요."))
                .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            PinField(text: $pin, onSubmit: { submit() })
                .frame(height: 30)
                .padding(.vertical, 8)
                .padding(.horizontal, 10)
                .background(RoundedRectangle(cornerRadius: 8).fill(Color(nsColor: .textBackgroundColor)))
                .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Color.secondary.opacity(0.35)))
                .onChange(of: pin) { _, value in
                    let digits = String(value.filter(\.isASCII).filter(\.isNumber).prefix(6))
                    if digits != value { pin = digits }
                    if !isLocking, digits.count == 6 { submit() }
                }
            if let message = errorMessage ?? initialMessage {
                Text(message).font(.callout).foregroundStyle(.red)
            }
            HStack {
                Spacer()
                Button("취소") { session.lockPrompt = nil; dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button(isLocking ? (busy ? "처리 중…" : "잠그기") : "열기") { submit() }
                    .keyboardShortcut(.defaultAction)
                    .disabled(pin.count != 6 || busy)
            }
        }
        .padding(20)
        .frame(width: 380)
    }

    private var initialMessage: String? {
        if case .unlock(let message) = prompt { return message }
        return nil
    }

    private var lockHelp: String {
        let minutes = app.settings.preferences.lockSessionMinutes
        let duration = DurationText.minutes(minutes)
        return String(localized: "모든 잠금 노트에 같은 6자리 숫자를 사용하세요. 숫자는 저장되지 않고 \(duration) 동안만 재사용되며, 잊으면 내용을 복구할 수 없습니다.")
    }

    private func submit() {
        guard pin.count == 6, !busy else { return }
        busy = true
        errorMessage = nil
        if isLocking {
            let value = pin
            Task {
                await session.lock(pin: value)
                busy = false
                if session.lockState == .unlocked { dismiss() }
            }
        } else {
            do {
                try session.unlock(pin: pin)
                busy = false
                dismiss()
            } catch {
                busy = false
                errorMessage = String(localized: "6자리 숫자가 맞지 않거나 잠긴 이슈가 아닙니다.")
                pin = ""
            }
        }
    }
}

/// 본문 찾아 바꾸기. `/패턴/플래그`는 정규식, 그 밖은 글자 그대로. 첨부 주소(`{repo}/`)는 바꾸지 않는다.
struct ReplaceSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Bindable var session: NoteSession
    @State var search = ""
    @State var replacement = ""

    private var result: (count: Int, example: String?, output: String?, error: String?) {
        guard !search.isEmpty else { return (0, nil, nil, nil) }
        do {
            let regex = try FindReplace.regex(for: search)
            let outcome = FindReplace.apply(regex, template: FindReplace.template(for: search, replacement), to: session.body)
            return (outcome.count, outcome.example, outcome.text, nil)
        } catch {
            return (0, nil, nil, String(localized: "정규식이 올바르지 않습니다."))
        }
    }

    var body: some View {
        let current = result
        VStack(alignment: .leading, spacing: 12) {
            Text("찾아 바꾸기").font(.headline)
            TextField("찾을 내용 (정규식은 /패턴/플래그)", text: $search).textFieldStyle(.roundedBorder)
            TextField("바꿀 내용 ($1 사용 가능)", text: $replacement).textFieldStyle(.roundedBorder)
                .onSubmit { apply(current) }
            if let error = current.error {
                Text(error).foregroundStyle(.red).font(.callout)
            } else if !search.isEmpty {
                Text("\(current.count)개 일치").font(.callout).foregroundStyle(.secondary)
                if let example = current.example { Text(example).font(.callout.monospaced()).foregroundStyle(.secondary).lineLimit(2) }
            }
            HStack {
                Spacer()
                Button("취소") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("모두 바꾸기") { apply(current) }
                    .keyboardShortcut(.defaultAction)
                    .disabled(current.count == 0 || current.error != nil)
            }
        }
        .padding(20)
        .frame(width: 440)
        .onChange(of: session.lockState) { _, state in if state == .locked { dismiss() } }
    }

    private func apply(_ current: (count: Int, example: String?, output: String?, error: String?)) {
        guard let output = current.output, current.count > 0 else { return }
        session.edit(body: output)
        dismiss()
    }
}

enum FindReplace {
    struct Outcome { var text: String; var count: Int; var example: String? }

    /// `/pattern/flags`면 정규식, 아니면 글자 그대로 찾는다.
    static func regex(for search: String) throws -> NSRegularExpression {
        if search.count > 2, search.hasPrefix("/"), let close = search.lastIndex(of: "/"), close > search.startIndex {
            let pattern = String(search[search.index(after: search.startIndex)..<close])
            let flags = search[search.index(after: close)...]
            var options: NSRegularExpression.Options = []
            if flags.contains("i") { options.insert(.caseInsensitive) }
            if flags.contains("m") { options.insert(.anchorsMatchLines) }
            if flags.contains("s") { options.insert(.dotMatchesLineSeparators) }
            return try NSRegularExpression(pattern: pattern, options: options)
        }
        return try NSRegularExpression(pattern: NSRegularExpression.escapedPattern(for: search))
    }

    static func template(for search: String, _ replacement: String) -> String {
        let isRegex = search.count > 2 && search.hasPrefix("/") && search.dropFirst().contains("/")
        return isRegex ? replacement : NSRegularExpression.escapedTemplate(for: replacement)
    }

    /// `{repo}/`로 줄인 첨부 주소 안은 건드리지 않는다.
    static func apply(_ regex: NSRegularExpression, template: String, to text: String) -> Outcome {
        let ns = text as NSString
        let protected = try! NSRegularExpression(pattern: #"\{repo\}/[^\s)]*"#)
            .matches(in: text, range: NSRange(location: 0, length: ns.length)).map(\.range)
        var output = ""
        var cursor = 0
        var count = 0
        var example: String?
        for match in regex.matches(in: text, range: NSRange(location: 0, length: ns.length)) where match.range.length > 0 {
            if protected.contains(where: { NSIntersectionRange($0, match.range).length > 0 }) { continue }
            output += ns.substring(with: NSRange(location: cursor, length: match.range.location - cursor))
            let replaced = regex.replacementString(for: match, in: text, offset: 0, template: template)
            if example == nil { example = "“\(ns.substring(with: match.range))” → “\(replaced)”" }
            output += replaced
            cursor = NSMaxRange(match.range)
            count += 1
        }
        output += ns.substring(from: cursor)
        return Outcome(text: output, count: count, example: example)
    }
}

/// 잠금 숫자 입력칸. 한글 입력기가 켜져 있어도 영문·숫자로 받는다(이 칸이 포커스를 가진 동안만 로마자 입력기만 허용).
struct PinField: NSViewRepresentable {
    @Binding var text: String
    var onSubmit: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeNSView(context: Context) -> NSSecureTextField {
        let field = RomanSecureField()
        field.delegate = context.coordinator
        field.placeholderString = "000000"
        field.alignment = .center
        field.font = .monospacedSystemFont(ofSize: 24, weight: .medium)
        field.isBordered = false
        field.drawsBackground = false
        field.focusRingType = .none
        DispatchQueue.main.async { field.window?.makeFirstResponder(field) }
        return field
    }

    func updateNSView(_ field: NSSecureTextField, context: Context) {
        context.coordinator.parent = self
        if field.stringValue != text { field.stringValue = text }
    }

    final class Coordinator: NSObject, NSTextFieldDelegate {
        var parent: PinField
        init(_ parent: PinField) { self.parent = parent }

        func controlTextDidChange(_ notification: Notification) {
            guard let field = notification.object as? NSTextField else { return }
            parent.text = field.stringValue
        }

        func control(_ control: NSControl, textView: NSTextView, doCommandBy selector: Selector) -> Bool {
            guard selector == #selector(NSResponder.insertNewline(_:)) else { return false }
            parent.onSubmit()
            return true
        }
    }
}

/// 포커스를 받으면 입력 컨텍스트를 로마자 입력기로 묶는다.
final class RomanSecureField: NSSecureTextField {
    override func becomeFirstResponder() -> Bool {
        let accepted = super.becomeFirstResponder()
        if accepted { (currentEditor() as? NSTextView)?.inputContext?.allowedInputSourceLocales = [NSAllRomanInputSourcesLocaleIdentifier] }
        return accepted
    }
}
