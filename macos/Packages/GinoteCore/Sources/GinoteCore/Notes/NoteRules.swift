import Foundation

/// 마감일 표기. 본문 첫 줄 `due: YYYY-MM-DD` → D-n / D-DAY / D+n. 웹 `src/lib/due-date.js`.
public enum DueDate {
    public struct Badge: Equatable, Sendable {
        public let days: Int
        public let label: String
        public let date: String
    }

    public static func parse(_ value: String, calendar: Calendar = .current) -> DateComponents? {
        let firstLine = value.components(separatedBy: "\n").first.map { $0.hasSuffix("\r") ? String($0.dropLast()) : $0 } ?? ""
        let plain = NoteText.markdownToPlainText(firstLine)
        guard let match = JSText.firstMatch(plain, #"^due\s*:\s*(\d{4})-(\d{1,2})-(\d{1,2})$"#, options: .caseInsensitive),
              let year = JSText.group(match, 1, in: plain).flatMap(Int.init),
              let month = JSText.group(match, 2, in: plain).flatMap(Int.init),
              let day = JSText.group(match, 3, in: plain).flatMap(Int.init) else { return nil }
        let components = DateComponents(year: year, month: month, day: day)
        guard let date = calendar.date(from: components) else { return nil }
        let check = calendar.dateComponents([.year, .month, .day], from: date)
        guard check.year == year, check.month == month, check.day == day else { return nil }
        return components
    }

    public static func label(days: Int) -> String {
        if days == 0 { return "D-DAY" }
        return days > 0 ? "D-\(days)" : "D+\(-days)"
    }

    public static func badge(_ value: String, now: Date = Date(), calendar: Calendar = .current) -> Badge? {
        guard let due = parse(value, calendar: calendar),
              let dueDate = calendar.date(from: due) else { return nil }
        let today = calendar.startOfDay(for: now)
        let days = calendar.dateComponents([.day], from: today, to: calendar.startOfDay(for: dueDate)).day ?? 0
        let date = String(format: "%04d-%02d-%02d", due.year ?? 0, due.month ?? 0, due.day ?? 0)
        return Badge(days: days, label: label(days: days), date: date)
    }
}

/// 태그 색. GitHub 라벨을 만들 때 보내는 값이며 웹 `src/lib/colors.js`와 같다.
public enum TagColor {
    public static func hex(for name: String) -> String {
        var hash: UInt32 = 0
        for scalar in name.precomposedStringWithCanonicalMapping.unicodeScalars {
            hash = hash &* 31 &+ scalar.value
        }
        return hslToHex(hue: Double(hash % 360), saturation: 64, lightness: 58)
    }

    static func hslToHex(hue: Double, saturation: Double, lightness: Double) -> String {
        let s = saturation / 100
        let l = lightness / 100
        let chroma = (1 - abs(2 * l - 1)) * s
        let section = hue / 60
        let secondary = chroma * (1 - abs(section.truncatingRemainder(dividingBy: 2) - 1))
        let rgb: (Double, Double, Double)
        switch section {
        case ..<1: rgb = (chroma, secondary, 0)
        case ..<2: rgb = (secondary, chroma, 0)
        case ..<3: rgb = (0, chroma, secondary)
        case ..<4: rgb = (0, secondary, chroma)
        case ..<5: rgb = (secondary, 0, chroma)
        default: rgb = (chroma, 0, secondary)
        }
        let offset = l - chroma / 2
        return [rgb.0, rgb.1, rgb.2]
            .map { String(format: "%02x", Int(jsRound(($0 + offset) * 255))) }
            .joined()
    }

    /// JavaScript `Math.round`(0.5는 위로).
    static func jsRound(_ value: Double) -> Double { (value + 0.5).rounded(.down) }
}

/// 태그 정의 `이름: 설명`. 웹 `src/lib/tag-definition.js`, `issue-labels.js`.
public enum TagDefinition {
    public static let nameMaxLength = 50
    public static let descriptionMaxLength = 100

    public static func format(name: String, description: String?) -> String {
        guard let description, !description.isEmpty else { return name }
        return "\(name): \(description)"
    }

    /// 화면이 만든 "기존 이름: 설명"은 기존 이름(`:`가 들어 있어도)을 지키고, 새 입력은 첫 `:`로 나눈다.
    public static func parse(_ value: String, currentName: String? = nil) -> (name: String, description: String) {
        let source = JSText.trim(value)
        let current = JSText.trim(currentName ?? "")
        if !current.isEmpty, source == current { return (current, "") }
        if !current.isEmpty, source.hasPrefix("\(current):") {
            return (current, JSText.trim(String(source.dropFirst(current.count + 1))))
        }
        guard let separator = source.firstIndex(of: ":") else { return (JSText.trim(source), "") }
        return (JSText.trim(String(source[..<separator])), JSText.trim(String(source[source.index(after: separator)...])))
    }

    /// GitHub 라벨 길이 제한에 맞춘다(코드 포인트 기준).
    public static func limit(name: String, description: String) -> (name: String, description: String) {
        (JSText.prefixCodePoints(JSText.trim(name), nameMaxLength),
         JSText.prefixCodePoints(JSText.trim(description), descriptionMaxLength))
    }
}

/// 고정 상태를 나타내는 내부 라벨. 화면에는 보이지 않는다. 웹 `src/lib/pin-label.js`.
public enum PinLabel {
    public static let name = "ginote:pin"

    public static func isPin(_ labelName: String) -> Bool {
        labelName.lowercased() == name
    }
}

/// 저장소 주소와 토큰 입력. 웹 `src/lib/repo-address.js`.
public enum RepoAddress {
    public struct Address: Equatable, Sendable {
        public let owner: String
        public let name: String
        public var fullName: String { "\(owner)/\(name)" }
    }

    public static func parse(_ value: String) -> Address? {
        var cleaned = JSText.trim(value)
        cleaned = JSText.replace(cleaned, #"^https?://github\.com/"#, "", options: .caseInsensitive)
        cleaned = JSText.replace(cleaned, #"\.git$"#, "", options: .caseInsensitive)
        cleaned = JSText.replace(cleaned, "^/+|/+$", "")
        guard JSText.firstMatch(cleaned, #"^[^/\s]+/[^/\s]+$"#) != nil else { return nil }
        let parts = cleaned.split(separator: "/")
        return Address(owner: String(parts[0]), name: String(parts[1]))
    }

    public static func normalizeToken(_ value: String) -> String {
        JSText.trim(JSText.replace(value, "[\\u200B-\\u200D\\u2060\\uFEFF]", ""))
    }

    /// 그 저장소 범위의 fine-grained PAT를 만드는 GitHub 화면 주소.
    public static func patCreationURL(_ value: String) -> String {
        let selected = parse(value)
        let name = JSText.prefixUTF16("Ginote\(selected.map { " - \($0.name)" } ?? "")", 40)
        var params: [(String, String)] = [
            ("name", name),
            ("description", selected.map { "Ginote access for \($0.fullName)" } ?? "Ginote repository access"),
            ("expires_in", "none"),
            ("issues", "write"),
            ("contents", "write")
        ]
        if let selected { params.append(("target_name", selected.owner)) }
        let query = params.map { "\(JSText.formEncode($0.0))=\(JSText.formEncode($0.1))" }.joined(separator: "&")
        return "https://github.com/settings/personal-access-tokens/new?\(query)"
    }
}

extension JSText {
    static func prefixUTF16(_ text: String, _ count: Int) -> String {
        String(decoding: Array(text.utf16.prefix(count)), as: UTF16.self)
    }
}
