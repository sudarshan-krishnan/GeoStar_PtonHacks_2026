import Foundation
import Security

/// The gateway access code lives in the Keychain, not in UserDefaults.
enum Keychain {
  private static let service = "dev.plotstar.mobile.gateway"

  private static func query(_ account: String) -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
  }

  static func save(_ value: String, account: String) {
    SecItemDelete(query(account) as CFDictionary)
    var item = query(account)
    item[kSecValueData as String] = Data(value.utf8)
    item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    SecItemAdd(item as CFDictionary, nil)
  }

  static func load(account: String) -> String? {
    var item = query(account)
    item[kSecReturnData as String] = true
    item[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: AnyObject?
    guard SecItemCopyMatching(item as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
    return String(data: data, encoding: .utf8)
  }

  static func delete(account: String) {
    SecItemDelete(query(account) as CFDictionary)
  }
}
