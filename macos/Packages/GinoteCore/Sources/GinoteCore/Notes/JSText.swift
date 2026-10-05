import Foundation

// 웹 코드(JavaScript)와 같은 결과를 내기 위한 문자열 도구. JavaScript 문자열 위치는 UTF-16
// 단위이고 `Array.from`은 코드 포인트 단위라서, 그 차이를 여기서 맞춘다.
enum JSText {
    /// 정규식 치환. `template`은 NSRegularExpression 형식(`$1`)이다.
    static func replace(_ text: String, _ pattern: String, _ template: String, options: NSRegularExpression.Options = []) -> String {
        let regex = cachedRegex(pattern, options)
        return regex.stringByReplacingMatches(
            in: text, range: NSRange(text.startIndex..., in: text), withTemplate: template
        )
    }

    static func matches(_ text: String, _ pattern: String, options: NSRegularExpression.Options = []) -> [NSTextCheckingResult] {
        cachedRegex(pattern, options).matches(in: text, range: NSRange(text.startIndex..., in: text))
    }

    static func firstMatch(_ text: String, _ pattern: String, options: NSRegularExpression.Options = []) -> NSTextCheckingResult? {
        cachedRegex(pattern, options).firstMatch(in: text, range: NSRange(text.startIndex..., in: text))
    }

    static func group(_ match: NSTextCheckingResult, _ index: Int, in text: String) -> String? {
        let range = match.range(at: index)
        guard range.location != NSNotFound, let swiftRange = Range(range, in: text) else { return nil }
        return String(text[swiftRange])
    }

    /// `Array.from(value).slice(0, n).join('')`
    static func prefixCodePoints(_ text: String, _ count: Int) -> String {
        var scalars = String.UnicodeScalarView()
        scalars.append(contentsOf: text.unicodeScalars.prefix(max(0, count)))
        return String(scalars)
    }

    static func codePointCount(_ text: String) -> Int { text.unicodeScalars.count }

    /// `String.prototype.trim`: 앞뒤 공백과 줄 끝 문자를 지운다.
    static func trim(_ text: String) -> String {
        text.trimmingCharacters(in: jsWhitespace)
    }

    static let jsWhitespace: CharacterSet = {
        var set = CharacterSet.whitespacesAndNewlines
        set.insert(charactersIn: "\u{FEFF}")
        return set
    }()

    /// `encodeURIComponent`
    static func encodeURIComponent(_ text: String) -> String {
        text.addingPercentEncoding(withAllowedCharacters: uriComponentAllowed) ?? text
    }

    /// `decodeURIComponent`. 잘못된 퍼센트 인코딩이면 원문을 그대로 둔다.
    static func decodeURIComponent(_ text: String) -> String {
        text.removingPercentEncoding ?? text
    }

    private static let uriComponentAllowed: CharacterSet = {
        var set = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")
        set.insert(charactersIn: "-_.!~*'()")
        return set
    }()

    /// `URLSearchParams`의 직렬화(application/x-www-form-urlencoded).
    static func formEncode(_ text: String) -> String {
        var result = ""
        for byte in Array(text.utf8) {
            switch byte {
            case UInt8(ascii: "a")...UInt8(ascii: "z"), UInt8(ascii: "A")...UInt8(ascii: "Z"),
                 UInt8(ascii: "0")...UInt8(ascii: "9"), UInt8(ascii: "*"), UInt8(ascii: "-"),
                 UInt8(ascii: "."), UInt8(ascii: "_"):
                result.append(Character(UnicodeScalar(byte)))
            case UInt8(ascii: " "):
                result.append("+")
            default:
                result.append(String(format: "%%%02X", byte))
            }
        }
        return result
    }

    private static let regexCache = RegexCache()

    private static func cachedRegex(_ pattern: String, _ options: NSRegularExpression.Options) -> NSRegularExpression {
        regexCache.regex(pattern, options)
    }
}

private final class RegexCache: @unchecked Sendable {
    private var cache: [String: NSRegularExpression] = [:]
    private let lock = NSLock()

    func regex(_ pattern: String, _ options: NSRegularExpression.Options) -> NSRegularExpression {
        let key = "\(options.rawValue)|\(pattern)"
        lock.lock()
        defer { lock.unlock() }
        if let cached = cache[key] { return cached }
        // 패턴은 모두 코드에 고정된 값이라 실패하면 프로그램 오류다.
        let regex = try! NSRegularExpression(pattern: pattern, options: options)
        cache[key] = regex
        return regex
    }
}
