import CryptoKit
import Darwin
import Foundation
import LocalAuthentication
import MeasuredSignerCore
import Security

private let service = "com.namaka.measured-by-nova.publication-signing"

private enum CliError: Error {
    case invalidArguments
    case identityExists
    case identityMissing
    case consentDenied
    case keychainFailure(OSStatus)
}

private struct Arguments {
    let command: String
    let keyId: String
    let bindingFile: String?
    let outputFile: String?

    init(_ values: [String]) throws {
        guard values.count >= 2 else { throw CliError.invalidArguments }
        command = values[1]
        func value(_ flag: String) -> String? {
            guard let index = values.firstIndex(of: flag), values.indices.contains(index + 1) else { return nil }
            return values[index + 1]
        }
        guard let keyId = value("--key-id") else { throw CliError.invalidArguments }
        self.keyId = keyId
        bindingFile = value("--binding-file")
        outputFile = value("--output-file")
        try PublicationSigner.validateKeyId(keyId)
    }
}

@main
private enum Main {
    static func main() async {
        do {
            let args = try Arguments(CommandLine.arguments)
            switch args.command {
            case "enroll":
                let context = try await authorize("Create a Measured by Nova publication signing identity")
                guard try loadKey(args.keyId, context: context, allowMissing: true) == nil else { throw CliError.identityExists }
                let key = Curve25519.Signing.PrivateKey()
                try storeKey(key.rawRepresentation, keyId: args.keyId, context: context)
                try emit(PublicationSigner.publicIdentity(keyId: args.keyId, privateKey: key), outputFile: args.outputFile)
            case "identity":
                let context = try await authorize("Read the Measured by Nova publication signer identity")
                let key = try requiredKey(args.keyId, context: context)
                try emit(PublicationSigner.publicIdentity(keyId: args.keyId, privateKey: key), outputFile: args.outputFile)
            case "sign":
                guard let bindingFile = args.bindingFile else { throw CliError.invalidArguments }
                let binding = try JSONDecoder().decode(CaptureBinding.self, from: Data(contentsOf: URL(fileURLWithPath: bindingFile)))
                let context = try await authorize("Sign capture package \(binding.packageId) for project \(binding.projectId)")
                let key = try requiredKey(args.keyId, context: context)
                let package = try PublicationSigner.sign(
                    binding: binding,
                    keyId: args.keyId,
                    privateKey: key,
                    consentEventId: UUID().uuidString.lowercased(),
                    consentOccurredAt: ISO8601DateFormatter().string(from: Date())
                )
                try emit(package, outputFile: args.outputFile)
            case "revoke-local":
                let context = try await authorize("Remove the local Measured by Nova publication signing identity")
                _ = try requiredKey(args.keyId, context: context)
                let status = SecItemDelete(keyQuery(args.keyId) as CFDictionary)
                guard status == errSecSuccess else { throw CliError.keychainFailure(status) }
                try emit(["keyId": args.keyId, "removed": "true"], outputFile: args.outputFile)
            default:
                throw CliError.invalidArguments
            }
        } catch {
            FileHandle.standardError.write(Data("measured_publication_signer_failed:\(publicError(error))\n".utf8))
            Foundation.exit(EXIT_FAILURE)
        }
    }
}

private func authorize(_ reason: String) async throws -> LAContext {
    let context = LAContext()
    context.localizedReason = reason
    var authError: NSError?
    guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &authError) else { throw CliError.consentDenied }
    let allowed = try await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason)
    guard allowed else { throw CliError.consentDenied }
    return context
}

private func keyQuery(_ keyId: String) -> [String: Any] {
    [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: service,
        kSecAttrAccount as String: keyId,
        kSecUseDataProtectionKeychain as String: true
    ]
}

private func storeKey(_ bytes: Data, keyId: String, context: LAContext) throws {
    var error: Unmanaged<CFError>?
    guard let access = SecAccessControlCreateWithFlags(
        nil,
        kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        [.userPresence],
        &error
    ) else {
        if let error { throw error.takeRetainedValue() }
        throw CliError.consentDenied
    }
    var query = keyQuery(keyId)
    query[kSecAttrAccessControl as String] = access
    query[kSecUseAuthenticationContext as String] = context
    query[kSecValueData as String] = bytes
    let status = SecItemAdd(query as CFDictionary, nil)
    guard status == errSecSuccess else { throw CliError.keychainFailure(status) }
}

private func loadKey(_ keyId: String, context: LAContext, allowMissing: Bool = false) throws -> Data? {
    var query = keyQuery(keyId)
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    query[kSecUseAuthenticationContext as String] = context
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound, allowMissing { return nil }
    guard status == errSecSuccess, let data = result as? Data else {
        if status == errSecItemNotFound { throw CliError.identityMissing }
        throw CliError.keychainFailure(status)
    }
    return data
}

private func requiredKey(_ keyId: String, context: LAContext) throws -> Curve25519.Signing.PrivateKey {
    guard let bytes = try loadKey(keyId, context: context) else { throw CliError.identityMissing }
    return try Curve25519.Signing.PrivateKey(rawRepresentation: bytes)
}

private func emit<T: Encodable>(_ value: T, outputFile: String?) throws {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    let data = try encoder.encode(value) + Data([0x0a])
    if let outputFile {
        try data.write(to: URL(fileURLWithPath: outputFile), options: [.atomic, .withoutOverwriting])
    } else {
        FileHandle.standardOutput.write(data)
    }
}

private func publicError(_ error: Error) -> String {
    switch error {
    case CliError.invalidArguments: return "invalid_arguments"
    case CliError.identityExists: return "identity_exists"
    case CliError.identityMissing: return "identity_missing"
    case CliError.consentDenied: return "consent_denied"
    case CliError.keychainFailure: return "keychain_failure"
    case PublicationSignerError.invalidIdentifier: return "invalid_identifier"
    case PublicationSignerError.invalidBinding: return "invalid_binding"
    default: return "operation_failed"
    }
}
