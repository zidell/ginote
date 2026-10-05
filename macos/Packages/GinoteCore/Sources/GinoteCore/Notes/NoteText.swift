import Foundation

/// 노트 본문에서 제목·미리보기·링크를 뽑는 함수. 웹 `src/lib/notes.js`와 같은 결과를 낸다.
public enum NoteText {
    public static let titleMaxLength = 50
    public static let tagNameMaxLength = 50

    /// 첫 줄을 다듬어 최대 `maxLength` 코드 포인트까지 쓴다(첫 줄 제목 방식).
    public static func automaticTitle(_ value: String, maxLength: Int = titleMaxLength) -> String {
        let firstLine: String
        if let match = JSText.firstMatch(value, #"\r?\n"#), let range = Range(match.range, in: value) {
            firstLine = String(value[..<range.lowerBound])
        } else {
            firstLine = value
        }
        return JSText.prefixCodePoints(JSText.trim(firstLine), maxLength)
    }

    public static func markdownToPlainText(_ value: String) -> String {
        var text = value
        text = JSText.replace(text, "```[^\\n]*\\n?", "")
        text = JSText.replace(text, "~~~[^\\n]*\\n?", "")
        text = JSText.replace(text, #"!\[([^\]]*)\]\([^)]*\)"#, "$1")
        text = JSText.replace(text, #"\[([^\]]+)\]\([^)]*\)"#, "$1")
        text = JSText.replace(text, #"^\s*\[[^\]]+\]:\s+\S+.*$"#, "", options: .anchorsMatchLines)
        text = JSText.replace(text, "<[^>]+>", "")
        text = JSText.replace(text, #"^\s{0,3}(?:#{1,6}\s+|>\s?|[-+*]\s+|\d+[.)]\s+)"#, "", options: .anchorsMatchLines)
        text = JSText.replace(text, #"^\s*[-*_]{3,}\s*$"#, "", options: .anchorsMatchLines)
        text = JSText.replace(text, #"\[([ xX])\]\s*"#, "")
        text = JSText.replace(text, "`([^`]*)`", "$1")
        text = JSText.replace(text, "[*~_]", "")
        text = JSText.replace(text, #"\\([\\`*{}\[\]()#+\-.!_>])"#, "$1")
        text = JSText.replace(text, #"\s+"#, " ")
        return JSText.trim(text)
    }

    public static func firstLinePreview(_ value: String, maxLength: Int = titleMaxLength) -> String {
        let firstLine = value.components(separatedBy: CharacterSet(charactersIn: "\n")).first ?? ""
        let line = firstLine.hasSuffix("\r") ? String(firstLine.dropLast()) : firstLine
        return JSText.prefixCodePoints(markdownToPlainText(line), maxLength)
    }

    public struct Link: Equatable, Sendable {
        public let url: String
        /// UTF-16 위치(웹과 같음).
        public let start: Int
        public let end: Int
    }

    /// 커서(UTF-16 위치)가 놓인 링크. Markdown 링크를 먼저, 그다음 일반 URL을 본다. 이미지는 제외한다.
    public static func linkAtCursor(_ value: String, cursor: Int) -> Link? {
        let length = value.utf16.count
        guard cursor >= 0, cursor <= length else { return nil }

        let markdownLink = #"(?<!!)\[[^\]\n]*\]\(\s*(https?://[^\s)]+)(?:\s+["'][^"']*["'])?\s*\)"#
        for match in JSText.matches(value, markdownLink, options: .caseInsensitive) {
            let start = match.range.location
            let end = start + match.range.length
            if cursor >= start, cursor <= end, let url = JSText.group(match, 1, in: value) {
                return Link(url: url, start: start, end: end)
            }
        }

        for match in JSText.matches(value, #"https?://[^\s<>"'`]+"#, options: .caseInsensitive) {
            guard let raw = JSText.group(match, 0, in: value) else { continue }
            let url = JSText.replace(raw, #"[\].,;:!?)}]+$"#, "")
            let start = match.range.location
            let end = start + url.utf16.count
            if cursor >= start, cursor <= end { return Link(url: url, start: start, end: end) }
        }
        return nil
    }

    /// 가운데를 `…`로 줄인다(코드 포인트 기준).
    public static func shortenMiddle(_ value: String, maxLength: Int = 64) -> String {
        let scalars = Array(value.unicodeScalars)
        guard scalars.count > maxLength else { return value }
        let available = max(2, maxLength - 1)
        let leading = Int((Double(available) / 2).rounded(.up))
        let trailing = available / 2
        var result = String.UnicodeScalarView()
        result.append(contentsOf: scalars.prefix(leading))
        result.append("…")
        result.append(contentsOf: scalars.suffix(trailing))
        return String(result)
    }

    /// 새 태그 이름: 앞 `#`을 떼고 공백은 `-`, 최대 50 코드 포인트.
    public static func normalizeTagName(_ value: String) -> String {
        var text = JSText.trim(value)
        text = JSText.replace(text, "^#+", "")
        text = JSText.replace(text, #"\s+"#, "-")
        return JSText.prefixCodePoints(text, tagNameMaxLength)
    }

    /// GitHub 본문 길이 상한(65,536)의 90%. 웹 `github-limits.js`.
    public static let maxBodyLength = Int(Double(65_536) * 0.9)

    /// 본문 길이(웹 `maxlength`와 같은 UTF-16 단위).
    public static func length(_ value: String) -> Int { value.utf16.count }
}
