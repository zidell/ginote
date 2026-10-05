import CommonCrypto
import CryptoKit
import Foundation

public enum NoteLockError: Error, Equatable {
    case invalidPin
    case invalidIssueNumber
    case unreadablePayload
    case unsupportedPayload
    case wrongPinOrNotLocked
}

/// 노트 잠금의 암호화 형식. 웹 `src/lib/note-lock.js`와 같은 규약이며 docs/ENCRYPTION.md가 원본이다.
/// 저장값 = Base64(버전 1B + salt 16B + IV 12B + AES-GCM 암호문·태그),
/// 키 = PBKDF2-SHA256(`pepper:이슈번호:PIN`, salt, 600,000회) → AES-256.
public struct NoteLock: Sendable {
    /// 웹 `DEFAULT_APP_PEPPER`와 같은 값. 바꾸면 기존 잠금 노트를 읽지 못한다.
    public static let defaultPepper = "issue-note-lock::7b1f4e93c8a642d5a0ef36b91472c85d"
    public static let lockPrefix = "🔒"

    static let formatVersion: UInt8 = 2
    static let saltBytes = 16
    static let ivBytes = 12
    static let headerBytes = 1 + saltBytes + ivBytes
    static let iterations: UInt32 = 600_000

    /// 암호화에 쓰는 pepper. 빌드에 값이 없으면 기본값이다.
    public let pepper: String

    public init(pepper: String? = nil) {
        let trimmed = pepper?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        self.pepper = trimmed.isEmpty ? Self.defaultPepper : trimmed
    }

    // MARK: - PIN과 제목

    /// 숫자만 남겨 앞 6자리를 쓴다. 6자리가 안 되면 nil.
    public static func normalizePin(_ value: String) -> String? {
        let digits = String(value.unicodeScalars.filter { $0.properties.numericType == .decimal && $0.isASCII }.map(Character.init))
        let pin = String(digits.prefix(6))
        return pin.count == 6 ? pin : nil
    }

    public static func isLockedTitle(_ title: String) -> Bool {
        title.hasPrefix(lockPrefix)
    }

    public static func addLock(to title: String) -> String {
        let plain = removeLock(from: title)
        var result = "\(lockPrefix) \(plain)"
        while let last = result.unicodeScalars.last, JSText.jsWhitespace.contains(last) {
            result.unicodeScalars.removeLast()
        }
        return prefixUTF16(result, 256)
    }

    public static func removeLock(from title: String) -> String {
        JSText.replace(title, "^🔒\\s*", "")
    }

    public static func isLockedPayload(_ value: String) -> Bool {
        guard let packed = decodeBase64(value) else { return false }
        return packed.first == formatVersion && packed.count > headerBytes
    }

    // MARK: - 암호화

    public func encrypt(_ body: String, pin: String, issueNumber: Int) throws -> String {
        let pin = try Self.requirePin(pin)
        let context = try Self.requireIssueNumber(issueNumber)
        let salt = Self.randomBytes(Self.saltBytes)
        let iv = Self.randomBytes(Self.ivBytes)
        let key = Self.deriveKey(pin: pin, issueNumber: context, pepper: pepper, salt: salt)
        let sealed = try AES.GCM.seal(Data(body.utf8), using: key, nonce: AES.GCM.Nonce(data: iv))
        var packed = Data([Self.formatVersion])
        packed.append(salt)
        packed.append(iv)
        packed.append(sealed.ciphertext)
        packed.append(sealed.tag)
        return packed.base64EncodedString()
    }

    public func decrypt(_ payload: String, pin: String, issueNumber: Int) throws -> String {
        let pin = try Self.requirePin(pin)
        let context = try Self.requireIssueNumber(issueNumber)
        guard let packed = Self.decodeBase64(payload) else { throw NoteLockError.unreadablePayload }
        guard packed.first == Self.formatVersion, packed.count > Self.headerBytes else {
            throw NoteLockError.unsupportedPayload
        }
        let bytes = [UInt8](packed)
        let salt = Data(bytes[1..<(1 + Self.saltBytes)])
        let iv = Data(bytes[(1 + Self.saltBytes)..<Self.headerBytes])
        let encrypted = Data(bytes[Self.headerBytes...])
        guard encrypted.count >= 16 else { throw NoteLockError.wrongPinOrNotLocked }
        let ciphertext = encrypted.prefix(encrypted.count - 16)
        let tag = encrypted.suffix(16)

        // 설정된 pepper로 먼저 열고, 안 되면 기본값으로 연다(웹과 같은 순서).
        let peppers = pepper == Self.defaultPepper ? [pepper] : [pepper, Self.defaultPepper]
        for candidate in peppers {
            let key = Self.deriveKey(pin: pin, issueNumber: context, pepper: candidate, salt: salt)
            guard let box = try? AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: iv), ciphertext: ciphertext, tag: tag),
                  let plain = try? AES.GCM.open(box, using: key) else { continue }
            return String(decoding: plain, as: UTF8.self)
        }
        throw NoteLockError.wrongPinOrNotLocked
    }

    // MARK: - 내부

    static func requirePin(_ pin: String) throws -> String {
        guard let normalized = normalizePin(pin) else { throw NoteLockError.invalidPin }
        return normalized
    }

    static func requireIssueNumber(_ number: Int) throws -> String {
        guard number > 0 else { throw NoteLockError.invalidIssueNumber }
        return String(number)
    }

    static func deriveKey(pin: String, issueNumber: String, pepper: String, salt: Data) -> SymmetricKey {
        let material = Array("\(pepper):\(issueNumber):\(pin)".utf8)
        var derived = [UInt8](repeating: 0, count: 32)
        let saltBytes = [UInt8](salt)
        let status = material.withUnsafeBufferPointer { password in
            CCKeyDerivationPBKDF(
                CCPBKDFAlgorithm(kCCPBKDF2),
                password.baseAddress.map { UnsafeRawPointer($0).assumingMemoryBound(to: CChar.self) },
                material.count,
                saltBytes, saltBytes.count,
                CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256),
                iterations,
                &derived, derived.count
            )
        }
        precondition(status == kCCSuccess, "PBKDF2 failed: \(status)")
        return SymmetricKey(data: derived)
    }

    static func randomBytes(_ count: Int) -> Data {
        var bytes = [UInt8](repeating: 0, count: count)
        let status = SecRandomCopyBytes(kSecRandomDefault, count, &bytes)
        precondition(status == errSecSuccess, "random bytes unavailable")
        return Data(bytes)
    }

    /// 브라우저 `atob`처럼 공백을 무시하고 빠진 `=`를 채워 읽는다.
    static func decodeBase64(_ value: String) -> Data? {
        var text = value.filter { !$0.isWhitespace }
        if text.count % 4 == 1 { return nil }
        while text.count % 4 != 0 { text.append("=") }
        return Data(base64Encoded: text)
    }

    static func prefixUTF16(_ text: String, _ count: Int) -> String {
        let units = Array(text.utf16.prefix(count))
        return String(decoding: units, as: UTF16.self)
    }
}
