import CryptoKit
import XCTest
@testable import MeasuredSignerCore

final class PublicationSignerTests: XCTestCase {
    private let binding = CaptureBinding(
        schemaVersion: 1,
        packageId: "native-capture-1",
        projectId: "measured-project-1",
        objectId: "object-1",
        captureProtocolId: "protocol-1",
        kitId: "kit-1",
        commissioningPartyId: "party-1",
        capturedAt: "2026-08-30T10:00:00Z",
        evidenceScopes: [EvidenceScope(id: "dimensions", kind: "measurement", required: true, verified: true)],
        manifest: [ManifestEntry(path: "evidence.json", sha256: String(repeating: "a", count: 64), sizeBytes: 24)]
    )

    func testCanonicalPayloadMatchesNodeContract() throws {
        XCTAssertEqual(
            try PublicationSigner.payloadHashHex(binding),
            "c2f969f693421acac495f4f3c07a480c42df346adc000c610deb594e2be4f404"
        )
    }

    func testSignatureBindsIdentityAndConsent() throws {
        let key = try Curve25519.Signing.PrivateKey(rawRepresentation: Data(repeating: 7, count: 32))
        let package = try PublicationSigner.sign(
            binding: binding,
            keyId: "native-key-1",
            privateKey: key,
            consentEventId: "6e5a0fe7-23a7-4ac5-87ea-61b4654df129",
            consentOccurredAt: "2026-08-31T20:00:00Z"
        )
        XCTAssertEqual(package.source, "native_app")
        XCTAssertEqual(package.nativeEvidence.consent.method, "device_owner_authentication")
        XCTAssertEqual(package.signature.publicKeyFingerprintSha256.count, 64)
        XCTAssertTrue(key.publicKey.isValidSignature(Data(base64Encoded: package.signature.valueBase64)!, for: Data(hex: package.signature.signedPayloadSha256)!))
    }

    func testRejectsAmbiguousBinding() throws {
        let duplicate = CaptureBinding(
            schemaVersion: binding.schemaVersion,
            packageId: binding.packageId,
            projectId: binding.projectId,
            objectId: binding.objectId,
            captureProtocolId: binding.captureProtocolId,
            kitId: binding.kitId,
            commissioningPartyId: binding.commissioningPartyId,
            capturedAt: binding.capturedAt,
            evidenceScopes: binding.evidenceScopes + binding.evidenceScopes,
            manifest: binding.manifest
        )
        XCTAssertThrowsError(try PublicationSigner.canonicalPayload(duplicate))
    }
}

private extension Data {
    init?(hex: String) {
        guard hex.count.isMultiple(of: 2) else { return nil }
        var bytes: [UInt8] = []
        var index = hex.startIndex
        while index < hex.endIndex {
            let next = hex.index(index, offsetBy: 2)
            guard let byte = UInt8(hex[index..<next], radix: 16) else { return nil }
            bytes.append(byte)
            index = next
        }
        self.init(bytes)
    }
}
