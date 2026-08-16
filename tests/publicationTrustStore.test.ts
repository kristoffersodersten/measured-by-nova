import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { capturePackagePayloadSha256 } from "../src/publicationTrust.js";
import { readLivePublicationTrust, verifyAndStorePublicationTrust } from "../src/publicationTrustStore.js";

const intent = { intentId: "trust-proof", operation: "verify-publication-capture" as const, objective: "Verify exact capture publication evidence", writeScope: ["project-state", "manifest"] as const, forbiddenScope: ["source-measurements", "locked-geometry"] as const, selectedToolPath: "mcp:nova-measured" as const, acceptanceChecks: ["schema", "quality-gate", "manifest"] as const, executionPolicy: { locality: "local-only" as const, telemetry: false, fallback: "none" as const, geometryMutation: false } };

describe("publication trust store", () => {
  it("persists verified native evidence and disputes later byte mutation", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "publication-trust-"));
    const projectId = "trust-project";
    const packageDir = path.join(outputDir, "captures", "native-1");
    await mkdir(path.join(outputDir, "measurement-projects", projectId), { recursive: true });
    await mkdir(packageDir, { recursive: true });
    await mkdir(path.join(outputDir, "publication-keys"));
    await writeFile(path.join(outputDir, "measurement-projects", projectId, "project.json"), JSON.stringify({ projectId }));
    const artifact = Buffer.from("signed capture evidence");
    await writeFile(path.join(packageDir, "evidence.json"), artifact);
    const binding = { schemaVersion: 1 as const, packageId: "native-1", projectId, objectId: "object-1", captureProtocolId: "protocol-1", kitId: "kit-1", commissioningPartyId: "party-1", capturedAt: "2026-08-16T00:00:00.000Z", manifest: [{ path: "evidence.json", sha256: createHash("sha256").update(artifact).digest("hex"), sizeBytes: artifact.byteLength }] };
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const payloadHash = capturePackagePayloadSha256(binding);
    await writeFile(path.join(outputDir, "publication-keys", "native-key-1.pem"), publicKey.export({ type: "spki", format: "pem" }));
    await writeFile(path.join(packageDir, "capture-package.json"), JSON.stringify({ source: "native_app", binding, signature: { algorithm: "Ed25519", keyId: "native-key-1", signedPayloadSha256: payloadHash, valueBase64: sign(null, Buffer.from(payloadHash, "hex"), privateKey).toString("base64") } }));
    const input = { projectId, executionIntent: intent, packageManifestPath: "captures/native-1/capture-package.json", publicKeyPath: "publication-keys/native-key-1.pem", evidenceScopes: [{ id: "dimensions", kind: "measurement" as const, required: true, verified: true }], disputes: [] };
    expect((await verifyAndStorePublicationTrust({ outputDir, timeoutMs: 1 }, input)).classification.category).toBe("verified");
    await writeFile(path.join(packageDir, "evidence.json"), "mutated");
    expect((await readLivePublicationTrust({ outputDir, timeoutMs: 1 }, projectId))?.classification.category).toBe("disputed");
    await rm(path.join(packageDir, "evidence.json"));
    expect((await readLivePublicationTrust({ outputDir, timeoutMs: 1 }, projectId))?.verification.codes).toContain("artifact_missing");
    await writeFile(path.join(packageDir, "evidence.json"), artifact);
    await writeFile(path.join(packageDir, "undeclared.txt"), "unexpected");
    expect((await readLivePublicationTrust({ outputDir, timeoutMs: 1 }, projectId))?.verification.codes).toContain("artifact_unexpected");
    await rm(path.join(packageDir, "undeclared.txt"));
    await writeFile(path.join(outputDir, "publication-keys", "revoked-key-ids.json"), JSON.stringify({ schemaVersion: 1, revokedKeyIds: ["native-key-1"] }));
    const revoked = await verifyAndStorePublicationTrust({ outputDir, timeoutMs: 1 }, input);
    expect(revoked.classification.category).toBe("disputed");
    expect(revoked.verification.codes).toContain("signing_key_revoked");
    await writeFile(path.join(outputDir, "publication-keys", "native-key-1.pem"), privateKey.export({ type: "pkcs8", format: "pem" }));
    await expect(verifyAndStorePublicationTrust({ outputDir, timeoutMs: 1 }, input)).rejects.toThrow("publication_trust_private_key_forbidden");
  });

  it("keeps manual packages reference even with verified scopes", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "publication-reference-"));
    const projectId = "reference-project";
    const packageDir = path.join(outputDir, "captures", "manual-1");
    await mkdir(path.join(outputDir, "measurement-projects", projectId), { recursive: true });
    await mkdir(packageDir, { recursive: true });
    await writeFile(path.join(outputDir, "measurement-projects", projectId, "project.json"), JSON.stringify({ projectId }));
    await writeFile(path.join(packageDir, "evidence.json"), "manual");
    const content = Buffer.from("manual");
    const binding = { schemaVersion: 1, packageId: "manual-1", projectId, objectId: "object-1", captureProtocolId: "protocol-1", kitId: "kit-1", commissioningPartyId: "party-1", capturedAt: "2026-08-16T00:00:00.000Z", manifest: [{ path: "evidence.json", sha256: createHash("sha256").update(content).digest("hex"), sizeBytes: content.byteLength }] };
    await writeFile(path.join(packageDir, "capture-package.json"), JSON.stringify({ source: "manual_upload", binding }));
    const result = await verifyAndStorePublicationTrust({ outputDir, timeoutMs: 1 }, { projectId, executionIntent: intent, packageManifestPath: "captures/manual-1/capture-package.json", evidenceScopes: [{ id: "dimensions", kind: "measurement", required: true, verified: true }] });
    expect(result.classification.category).toBe("reference");
    expect(result.verification.codes).toContain("manual_upload");
  });
});
