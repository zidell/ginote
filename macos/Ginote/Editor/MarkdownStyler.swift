import AppKit
import GinoteCore

/// 편집기의 가벼운 Markdown 강조. 글자는 바꾸지 않고 속성만 입힌다.
@MainActor
enum MarkdownStyler {
    private static let heading = try! NSRegularExpression(pattern: #"^(#{1,6})\s+.*$"#, options: .anchorsMatchLines)
    private static let bold = try! NSRegularExpression(pattern: #"(\*\*|__)(?=\S)(.+?)(?<=\S)\1"#)
    private static let italic = try! NSRegularExpression(pattern: #"(?<![*\w])([*_])(?=\S)(.+?)(?<=\S)\1(?![*\w])"#)
    private static let code = try! NSRegularExpression(pattern: #"`[^`\n]+`"#)
    private static let fence = try! NSRegularExpression(pattern: #"^(```|~~~).*$"#, options: .anchorsMatchLines)
    private static let quote = try! NSRegularExpression(pattern: #"^\s{0,3}>.*$"#, options: .anchorsMatchLines)
    private static let listMarker = try! NSRegularExpression(pattern: #"^\s*(?:[-+*]|\d+[.)])(?:\s+\[[ xX]\])?\s"#, options: .anchorsMatchLines)
    private static let link = try! NSRegularExpression(pattern: #"\[[^\]\n]*\]\([^)\s]+[^)]*\)|https?://[^\s<>"'`)\]]+"#)
    private static let strike = try! NSRegularExpression(pattern: #"~~(?=\S)(.+?)(?<=\S)~~"#)

    static func restyle(_ textView: NSTextView, style: EditorStyle) {
        let storage = textView.textStorage!
        apply(storage, range: NSRange(location: 0, length: storage.length), style: style)
    }

    /// 방금 고친 문단만 다시 칠한다.
    static func restyleEditedParagraphs(_ textView: NSTextView, style: EditorStyle) {
        let storage = textView.textStorage!
        let text = storage.string as NSString
        let selection = textView.selectedRange()
        let start = max(0, selection.location - 1)
        var range = text.paragraphRange(for: NSRange(location: min(start, text.length), length: 0))
        range = NSUnionRange(range, text.paragraphRange(for: NSRange(location: min(selection.location, text.length), length: 0)))
        // 코드 블록 경계가 바뀌면 전체를 다시 칠해야 한다.
        if text.substring(with: range).contains("```") || text.substring(with: range).contains("~~~") {
            range = NSRange(location: 0, length: text.length)
        }
        apply(storage, range: range, style: style)
    }

    private static func apply(_ storage: NSTextStorage, range: NSRange, style: EditorStyle) {
        let base = style.font
        let paragraph = style.paragraphStyle
        let text = storage.string
        storage.beginEditing()
        storage.setAttributes([.font: base, .paragraphStyle: paragraph, .foregroundColor: NSColor.textColor], range: range)

        for match in heading.matches(in: text, range: range) {
            let level = match.range(at: 1).length
            let scale: CGFloat = [1.5, 1.3, 1.15, 1.05, 1, 1][min(level, 6) - 1]
            let font = NSFontManager.shared.convert(base, toHaveTrait: .boldFontMask).withSize(base.pointSize * scale)
            storage.addAttribute(.font, value: font, range: match.range)
            storage.addAttribute(.foregroundColor, value: NSColor.secondaryLabelColor, range: match.range(at: 1))
        }
        for match in bold.matches(in: text, range: range) {
            // 위에서 모든 글자에 글꼴을 넣었다.
            let current = storage.attribute(.font, at: match.range.location, effectiveRange: nil) as! NSFont
            storage.addAttribute(.font, value: NSFontManager.shared.convert(current, toHaveTrait: .boldFontMask), range: match.range)
        }
        for match in italic.matches(in: text, range: range) {
            let current = storage.attribute(.font, at: match.range.location, effectiveRange: nil) as! NSFont
            storage.addAttribute(.font, value: NSFontManager.shared.convert(current, toHaveTrait: .italicFontMask), range: match.range)
        }
        for match in strike.matches(in: text, range: range) {
            storage.addAttribute(.strikethroughStyle, value: NSUnderlineStyle.single.rawValue, range: match.range)
        }
        for match in quote.matches(in: text, range: range) {
            storage.addAttribute(.foregroundColor, value: NSColor.secondaryLabelColor, range: match.range)
        }
        for match in listMarker.matches(in: text, range: range) {
            storage.addAttribute(.foregroundColor, value: NSColor.controlAccentColor, range: match.range)
        }
        let mono = NSFont.monospacedSystemFont(ofSize: base.pointSize * 0.92, weight: .regular)
        for match in code.matches(in: text, range: range) {
            storage.addAttributes([.font: mono, .ginoteInlineCode: true], range: match.range)
        }
        for match in link.matches(in: text, range: range) {
            storage.addAttributes([.foregroundColor: NSColor.linkColor, .underlineStyle: NSUnderlineStyle.single.rawValue], range: match.range)
        }
        styleCodeBlocks(storage, text: text, mono: mono)
        storage.endEditing()
    }

    /// ``` 사이는 고정폭으로만 보인다.
    private static func styleCodeBlocks(_ storage: NSTextStorage, text: String, mono: NSFont) {
        let nsText = text as NSString
        var openStart: Int?
        for match in fence.matches(in: text, range: NSRange(location: 0, length: nsText.length)) {
            if let start = openStart {
                let block = NSRange(location: start, length: NSMaxRange(match.range) - start)
                storage.setAttributes([.font: mono, .foregroundColor: NSColor.secondaryLabelColor,
                                       .paragraphStyle: storage.attribute(.paragraphStyle, at: start, effectiveRange: nil)!],
                                      range: block)
                openStart = nil
            } else {
                openStart = match.range.location
            }
        }
    }
}
