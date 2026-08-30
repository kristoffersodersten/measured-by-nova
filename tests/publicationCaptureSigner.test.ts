import { createHash, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signNativePublicationCapture } from "../src/publicationCaptureSigner.js";
import { verifyPublicationCapturePackage } from "../src/publicationTrust.js";

const artifact = Buffer.from("measured native evidence");
const binding = {
  schemaVersion: 1 as const, packageId: "native-capture-1", projectId: "measured-project-1",
  objectId: "object-1", captureProtocolId: "protocol-1", kitId: "kit-1",
  commissioningPartyId: "party-1", capturedAt: "2026-08-30T10:00:00.000Z",
  evidenceScopes: [{ id: "dimensions", kind: "measurement" as const, required: true, verified: true }],
  manifest: [{ path: "evidence.json", sha256: createHash("sha256").update(artifact).digest("hex"), sizeBytes: artifact.byteLength }]
};

describe("native publication capture signer", () => {
  it("signs an exact binding that the production verifier accepts", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const capturePackage = signNativePublicationCapture({ binding, keyId: "native-key-1", privateKey });
    expect(verifyPublicationCapturePackage(capturePackage, [{ path: "evidence.json", content: artifact }], (keyId) => keyId === "native-key-1" ? publicKey : undefined)).toMatchObject({ valid: true, codes: [] });
    expect(JSON.stringify(capturePackage)).not.toContain("PRIVATE KEY");
  });

  it("rejects wrong key classes, malformed identifiers and ambiguous bindings", () => {
    const { privateKey: rsaKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const { privateKey } = generateKeyPairSync("ed25519");
    expect(() => signNativePublicationCapture({ binding, keyId: "native-key-1", privateKey: rsaKey })).toThrow("publication_signer_ed25519_private_key_required");
    expect(() => signNativePublicationCapture({ binding, keyId: "../escape", privateKey })).toThrow();
    expect(() => signNativePublicationCapture({ binding: { ...binding, evidenceScopes: [binding.evidenceScopes[0], binding.evidenceScopes[0]] }, keyId: "native-key-1", privateKey })).toThrow("Duplicate evidence scope ID");
  });

  it("makes post-signing binding mutation fail closed", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const capturePackage = signNativePublicationCapture({ binding, keyId: "native-key-1", privateKey });
    const mutated = { ...capturePackage, binding: { ...capturePackage.binding, objectId: "different-object" } };
    expect(verifyPublicationCapturePackage(mutated, [{ path: "evidence.json", content: artifact }], () => publicKey)).toMatchObject({ valid: false, codes: ["signed_payload_hash_mismatch"] });
  });
});
