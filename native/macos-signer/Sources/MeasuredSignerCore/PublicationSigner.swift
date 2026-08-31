import CryptoKit
import Foundation

public enum PublicationSignerError: Error, Equatable {
    case invalidIdentifier
    case invalidBinding
}

public struct EvidenceScope: Codable, Equatable, Sendable {
    public let id: String
    public let kind: String
    public let required: Bool
    public let verified: Bool
}

public struct ManifestEntry: Codable, Equatable, Sendable {
    public let path: String
    public let sha256: String
    public let sizeBytes: Int64
}

public struct CaptureBinding: Codable, Equatable, Sendable {
    public let schemaVersion: Int
    public let packageId: String
    public let projectId: String
    public let objectId: String
    public let captureProtocolId: String
    public let kitId: String
    public let commissioningPartyId: String
    public let capturedAt: String
    public let evidenceScopes: [EvidenceScope]
    public let manifest: [ManifestEntry]
}

public struct ConsentEvidence: Codable, Equatable, Sendable {
    public let method: String
    public let eventId: String
    public let occurredAt: String
}

public struct NativeEvidence: Codable, Equatable, Sendable {
    public let adapter: String
    public let adapterVersion: Int
    public let platform: String
    public let consent: ConsentEvidence
}

public struct CaptureSignature: Codable, Equatable, Sendable {
    public let algorithm: String
    public let keyId: String
    public let publicKeyFingerprintSha256: String
    public let signedPayloadSha256: String
    public let valueBase64: String
}

public struct SignedCapturePackage: Codable, Equatable, Sendable {
    public let source: String
    public let binding: CaptureBinding
    public let signature: CaptureSignature
    public let nativeEvidence: NativeEvidence
}

public struct PublicIdentity: Codable, Equatable, Sendable {
    public let schemaVersion: Int
    public let algorithm: String
    public let keyId: String
    public let publicKeyFingerprintSha256: String
    public let publicKeyPem: String
}

public enum PublicationSigner {
    public static let adapterName = "measured-native-macos"
    public static let adapterVersion = 1

    public static func validateKeyId(_ keyId: String) throws {
        guard !keyId.isEmpty, keyId.count <= 120,
              keyId.range(of: "^[A-Za-z0-9_.-]+$", options: .regularExpression) != nil else {
            throw PublicationSignerError.invalidIdentifier
        }
    }

    public static func canonicalPayload(_ binding: CaptureBinding) throws -> Data {
        try validate(binding)
        let scopes = binding.evidenceScopes.sorted { $0.id < $1.id }.map { scope in
            "{\"id\":\(quoted(scope.id)),\"kind\":\(quoted(scope.kind)),\"required\":\(scope.required),\"verified\":\(scope.verified)}"
        }.joined(separator: ",")
        let manifest = binding.manifest.sorted { $0.path < $1.path }.map { entry in
            "{\"path\":\(quoted(entry.path)),\"sha256\":\(quoted(entry.sha256)),\"sizeBytes\":\(entry.sizeBytes)}"
        }.joined(separator: ",")
        let json = "{\"schemaVersion\":\(binding.schemaVersion),\"packageId\":\(quoted(binding.packageId)),\"projectId\":\(quoted(binding.projectId)),\"objectId\":\(quoted(binding.objectId)),\"captureProtocolId\":\(quoted(binding.captureProtocolId)),\"kitId\":\(quoted(binding.kitId)),\"commissioningPartyId\":\(quoted(binding.commissioningPartyId)),\"capturedAt\":\(quoted(binding.capturedAt)),\"evidenceScopes\":[\(scopes)],\"manifest\":[\(manifest)]}"
        guard let data = json.data(using: .utf8) else { throw PublicationSignerError.invalidBinding }
        return data
    }

    public static func payloadHash(_ binding: CaptureBinding) throws -> Data {
        Data(SHA256.hash(data: try canonicalPayload(binding)))
    }

    public static func payloadHashHex(_ binding: CaptureBinding) throws -> String {
        try payloadHash(binding).hex
    }

    public static func publicIdentity(keyId: String, privateKey: Curve25519.Signing.PrivateKey) throws -> PublicIdentity {
        try validateKeyId(keyId)
        let der = ed25519SubjectPublicKeyInfo(privateKey.publicKey.rawRepresentation)
        return PublicIdentity(
            schemaVersion: 1,
            algorithm: "Ed25519",
            keyId: keyId,
            publicKeyFingerprintSha256: Data(SHA256.hash(data: der)).hex,
            publicKeyPem: pem(der)
        )
    }

    public static func sign(
        binding: CaptureBinding,
        keyId: String,
        privateKey: Curve25519.Signing.PrivateKey,
        consentEventId: String,
        consentOccurredAt: String
    ) throws -> SignedCapturePackage {
        try validateKeyId(keyId)
        guard UUID(uuidString: consentEventId) != nil,
              ISO8601DateFormatter().date(from: consentOccurredAt) != nil else {
            throw PublicationSignerError.invalidBinding
        }
        let hash = try payloadHash(binding)
        let identity = try publicIdentity(keyId: keyId, privateKey: privateKey)
        let signature = try privateKey.signature(for: hash)
        return SignedCapturePackage(
            source: "native_app",
            binding: binding,
            signature: CaptureSignature(
                algorithm: "Ed25519",
                keyId: keyId,
                publicKeyFingerprintSha256: identity.publicKeyFingerprintSha256,
                signedPayloadSha256: hash.hex,
                valueBase64: signature.base64EncodedString()
            ),
            nativeEvidence: NativeEvidence(
                adapter: adapterName,
                adapterVersion: adapterVersion,
                platform: "macos",
                consent: ConsentEvidence(
                    method: "device_owner_authentication",
                    eventId: consentEventId,
                    occurredAt: consentOccurredAt
                )
            )
        )
    }

    private static func validate(_ binding: CaptureBinding) throws {
        guard binding.schemaVersion == 1,
              !binding.evidenceScopes.isEmpty,
              !binding.manifest.isEmpty,
              Set(binding.evidenceScopes.map(\.id)).count == binding.evidenceScopes.count,
              Set(binding.manifest.map(\.path)).count == binding.manifest.count else {
            throw PublicationSignerError.invalidBinding
        }
        for id in [binding.packageId, binding.projectId, binding.objectId, binding.captureProtocolId, binding.kitId, binding.commissioningPartyId] {
            try validateKeyId(id)
        }
        for scope in binding.evidenceScopes {
            try validateKeyId(scope.id)
            guard ["measurement", "material_source", "known_deviation"].contains(scope.kind) else {
                throw PublicationSignerError.invalidBinding
            }
        }
        for entry in binding.manifest {
            guard !entry.path.isEmpty, !entry.path.hasPrefix("/"), !entry.path.split(separator: "/").contains(".."),
                  entry.sha256.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
                  entry.sizeBytes >= 0 else { throw PublicationSignerError.invalidBinding }
        }
    }

    private static func quoted(_ value: String) -> String {
        let data = try! JSONSerialization.data(withJSONObject: [value])
        let encoded = String(decoding: data, as: UTF8.self)
        return String(encoded.dropFirst().dropLast())
    }

    private static func ed25519SubjectPublicKeyInfo(_ raw: Data) -> Data {
        Data([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00]) + raw
    }

    private static func pem(_ der: Data) -> String {
        let base64 = der.base64EncodedString()
        let lines = stride(from: 0, to: base64.count, by: 64).map { offset -> String in
            let start = base64.index(base64.startIndex, offsetBy: offset)
            let end = base64.index(start, offsetBy: min(64, base64.distance(from: start, to: base64.endIndex)))
            return String(base64[start..<end])
        }
        return "-----BEGIN PUBLIC KEY-----\n\(lines.joined(separator: "\n"))\n-----END PUBLIC KEY-----\n"
    }
}

private extension Data {
    var hex: String { map { String(format: "%02x", $0) }.joined() }
}
