import Foundation
import Security

/// macOS Keychain의 일반 암호 항목. PAT와 OpenAI 키를 둔다(macos/DESIGN.md §8).
public struct Keychain: Sendable {
    public static let service = "net.gitools.note.mac"
    /// Tauri 앱이 쓰는 서비스. 처음 실행 때 한 번 읽어 온다.
    public static let tauriService = "net.gitools.note"

    public let service: String

    public init(service: String = Keychain.service) {
        self.service = service
    }

    public static func patAccount(_ workspaceId: String) -> String { "github-pat:\(workspaceId)" }
    public static let openAIAccount = "openai-api-key"

    public func read(_ account: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    @discardableResult
    public func write(_ account: String, _ value: String) -> Bool {
        guard !value.isEmpty else { return delete(account) }
        let base: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        let data = Data(value.utf8)
        let update = SecItemUpdate(base as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if update == errSecSuccess { return true }
        guard update == errSecItemNotFound else { return false }
        var add = base
        add[kSecValueData as String] = data
        add[kSecAttrLabel as String] = "Ginote Native (\(account.split(separator: ":").first ?? ""))"
        return SecItemAdd(add as CFDictionary, nil) == errSecSuccess
    }

    @discardableResult
    public func delete(_ account: String) -> Bool {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        let status = SecItemDelete(query as CFDictionary)
        return status == errSecSuccess || status == errSecItemNotFound
    }
}
