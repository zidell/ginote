import AppKit

extension NSAttributedString.Key {
    static let ginoteInlineCode = NSAttributedString.Key("GinoteInlineCode")
}

/// NSTextView의 기본 backgroundColor는 줄 높이만큼 칠한다. 인라인 코드만 글자 높이로 그린다.
final class InlineCodeLayoutManager: NSLayoutManager {
    private static let codeBackground = NSColor(name: "GinoteInlineCodeBackground") { appearance in
        let dark = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
        return NSColor(white: dark ? 0.05 : 0.75, alpha: 1)
    }

    override func drawBackground(forGlyphRange glyphsToShow: NSRange, at origin: NSPoint) {
        guard let storage = textStorage, let container = textContainers.first, glyphsToShow.length > 0 else {
            super.drawBackground(forGlyphRange: glyphsToShow, at: origin)
            return
        }

        let characters = characterRange(forGlyphRange: glyphsToShow, actualGlyphRange: nil)
        storage.enumerateAttribute(.ginoteInlineCode, in: characters) { value, characterRange, _ in
            guard value != nil else { return }
            let codeGlyphs = NSIntersectionRange(glyphRange(forCharacterRange: characterRange, actualCharacterRange: nil), glyphsToShow)
            guard codeGlyphs.length > 0 else { return }
            let font = storage.attribute(.font, at: characterRange.location, effectiveRange: nil) as? NSFont
                ?? NSFont.monospacedSystemFont(ofSize: 14, weight: .regular)
            enumerateLineFragments(forGlyphRange: codeGlyphs) { lineRect, _, _, lineGlyphs, _ in
                let segment = NSIntersectionRange(codeGlyphs, lineGlyphs)
                guard segment.length > 0 else { return }
                let bounds = self.boundingRect(forGlyphRange: segment, in: container)
                let baseline = lineRect.minY + self.location(forGlyphAt: segment.location).y
                let height = font.capHeight - font.descender + 3
                let rect = NSRect(x: origin.x + bounds.minX - 3,
                                  y: origin.y + baseline - font.capHeight - 2,
                                  width: bounds.width + 6, height: height)
                Self.codeBackground.setFill()
                NSBezierPath(roundedRect: rect, xRadius: 2, yRadius: 2).fill()
            }
        }
        // 선택 영역은 코드 배경 위에 그려져야 한다.
        super.drawBackground(forGlyphRange: glyphsToShow, at: origin)
    }
}
