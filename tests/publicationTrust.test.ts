import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  capturePackageSignaturePayloadSha256,
  classifyPublicTrust,
  customerRatingVisibility,
  InternalTrustScoresSchema,
  PublicationCapturePackageSchema,
  verifyPublicationCapturePackage
} from "../src/publicationTrust.js";

const content = Buffer.from("native capture evidence");
const artifact = { path: "capture/evidence.json", content };
const binding = {
  schemaVersion: 1 as const,
  packageId: "package-1",
  projectId: "project-1",
  objectId: "object-1",
  captureProtocolId: "protocol-1",
  kitId: "kit-1",
  commissioningPartyId: "customer-1",
  capturedAt: "2026-08-05T10:00:00.000Z",
  evidenceScopes: [
    { id: "dimensions", kind: "measurement" as const, required: true, verified: true },
    { id: "materials", kind: "material_source" as const, required: true, verified: true }
  ],
  manifest: [{
    path: artifact.path,
    sha256: createHash("sha256").update(content).digest("hex"),
    sizeBytes: content.byteLength
  }]
};

function signedPackage() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicKeyFingerprintSha256 = createHash("sha256").update(publicKey.export({ type: "spki", format: "der" })).digest("hex");
  const nativeEvidence = { adapter: "measured-native-macos" as const, adapterVersion: 1 as const, platform: "macos" as const, consent: { method: "device_owner_authentication" as const, eventId: "6e5a0fe7-23a7-4ac5-87ea-61b4654df129", occurredAt: "2026-08-31T20:00:00.000Z" } };
  const payloadHash = capturePackageSignaturePayloadSha256({ binding, keyId: "native-key-1", publicKeyFingerprintSha256, nativeEvidence });
  const capturePackage = PublicationCapturePackageSchema.parse({
    source: "native_app",
    binding,
    signature: {
      algorithm: "Ed25519",
      keyId: "native-key-1",
      publicKeyFingerprintSha256,
      signedPayloadSha256: payloadHash,
      valueBase64: sign(null, Buffer.from(payloadHash, "hex"), privateKey).toString("base64")
    },
    nativeEvidence
  });
  return { capturePackage, publicKey };
}

describe("publication trust contract", () => {
  it("verifies a complete unchanged native capture package and classifies it as verified", () => {
    const { capturePackage, publicKey } = signedPackage();
    const verification = verifyPublicationCapturePackage(capturePackage, [artifact], () => publicKey);

    expect(verification.valid).toBe(true);
    expect(verification.verifiedBindings).toEqual([
      "project", "object", "capture_protocol", "kit", "commissioning_party", "content", "signature"
    ]);
    expect(classifyPublicTrust({
      capturePackage,
      packageVerification: verification
    }).category).toBe("verified");
  });

  it("fails closed when signed capture content is changed", () => {
    const { capturePackage, publicKey } = signedPackage();
    const verification = verifyPublicationCapturePackage(
      capturePackage,
      [{ path: artifact.path, content: Buffer.from("mutated evidence") }],
      () => publicKey
    );

    expect(verification.valid).toBe(false);
    expect(verification.codes).toEqual(expect.arrayContaining(["artifact_size_mismatch", "artifact_hash_mismatch"]));
    expect(classifyPublicTrust({
      capturePackage,
      packageVerification: verification
    })).toMatchObject({ category: "reference", verifiedScopeIds: [], unverifiedRequiredScopeIds: ["dimensions", "materials"] });
  });

  it("fails closed when native consent or approved identity evidence is changed", () => {
    const { capturePackage, publicKey } = signedPackage();
    if (capturePackage.source !== "native_app") throw new Error("test_native_package_required");
    const changedConsent = {
      ...capturePackage,
      nativeEvidence: {
        ...capturePackage.nativeEvidence,
        consent: { ...capturePackage.nativeEvidence.consent, eventId: "3ad10b99-988d-4281-adf1-b3eed4f42859" }
      }
    };
    expect(verifyPublicationCapturePackage(changedConsent, [artifact], () => publicKey).codes)
      .toContain("signed_payload_hash_mismatch");
    const changedFingerprint = {
      ...capturePackage,
      signature: { ...capturePackage.signature, publicKeyFingerprintSha256: "0".repeat(64) }
    };
    expect(verifyPublicationCapturePackage(changedFingerprint, [artifact], () => publicKey).codes)
      .toEqual(expect.arrayContaining(["signed_payload_hash_mismatch", "signing_key_fingerprint_mismatch"]));
  });

  it("keeps manual uploads as reference regardless of verified evidence declarations", () => {
    const capturePackage = PublicationCapturePackageSchema.parse({ source: "manual_upload", binding });
    const verification = verifyPublicationCapturePackage(capturePackage, [artifact], () => undefined);

    expect(verification.codes).toContain("manual_upload");
    expect(classifyPublicTrust({
      capturePackage,
      packageVerification: verification
    }).category).toBe("reference");
  });

  it("derives partial verification and disputes from exact evidence scopes", () => {
    const { capturePackage, publicKey } = signedPackage();
    const verification = verifyPublicationCapturePackage(capturePackage, [artifact], () => publicKey);
    const evidenceScopes = [
      { id: "dimensions", kind: "measurement" as const, required: true, verified: true },
      { id: "materials", kind: "material_source" as const, required: true, verified: false }
    ];

    const partialPackage = { ...capturePackage, binding: { ...capturePackage.binding, evidenceScopes } };
    expect(classifyPublicTrust({ capturePackage: partialPackage, packageVerification: verification })).toMatchObject({
      category: "partially_verified",
      verifiedScopeIds: ["dimensions"],
      unverifiedRequiredScopeIds: ["materials"]
    });
    expect(classifyPublicTrust({
      capturePackage: partialPackage,
      packageVerification: verification,
      disputes: [{ scopeId: "dimensions", status: "open", reason: "Measurement is contested." }]
    })).toMatchObject({ category: "disputed", disputedScopeIds: ["dimensions"] });
  });

  it("keeps internal scores and customer ratings outside public classification", () => {
    expect(InternalTrustScoresSchema.parse({ risk: 0.92, fidelity: 0.18, visibility: "internal_only" })).toEqual({
      risk: 0.92,
      fidelity: 0.18,
      visibility: "internal_only"
    });
    expect(customerRatingVisibility({ average: 4.8, count: 4, minimumDisplayCount: 5 })).toEqual({
      visible: false,
      count: 4
    });
    expect(customerRatingVisibility({ average: 4.8, count: 5, minimumDisplayCount: 5 })).toEqual({
      visible: true,
      average: 4.8,
      count: 5
    });
  });

  it("rejects ambiguous duplicate signed evidence scope IDs", () => {
    expect(() => PublicationCapturePackageSchema.parse({ source: "manual_upload", binding: { ...binding, evidenceScopes: [binding.evidenceScopes[0], { ...binding.evidenceScopes[0], verified: false }] } })).toThrow("Duplicate evidence scope ID");
  });

  it("rejects duplicate observed artifact paths and non-canonical signature payloads", () => {
    const { capturePackage, publicKey } = signedPackage();
    if (capturePackage.source !== "native_app") throw new Error("test_native_package_required");
    expect(verifyPublicationCapturePackage(capturePackage, [artifact, artifact], () => publicKey))
      .toMatchObject({ valid: false, codes: ["artifact_duplicate"] });
    expect(() => PublicationCapturePackageSchema.parse({
      ...capturePackage,
      signature: { ...capturePackage.signature, valueBase64: "not base64!!" }
    })).toThrow();
    expect(() => PublicationCapturePackageSchema.parse({
      ...capturePackage,
      signature: { ...capturePackage.signature, valueBase64: "A".repeat(516) }
    })).toThrow();
  });

  it("fails closed for a deterministic hostile signature corpus", () => {
    const { capturePackage } = signedPackage();
    if (capturePackage.source !== "native_app") throw new Error("test_native_package_required");
    const hostile = ["", "=", "A", "AAAA=", "AAAA===", "../secret", "\u0000", "🔥", "A".repeat(513)];
    for (let repeat = 0; repeat < 100; repeat += 1) {
      for (const valueBase64 of hostile) {
        expect(() => PublicationCapturePackageSchema.parse({
          ...capturePackage,
          signature: { ...capturePackage.signature, valueBase64 }
        })).toThrow();
      }
    }
  });
});
