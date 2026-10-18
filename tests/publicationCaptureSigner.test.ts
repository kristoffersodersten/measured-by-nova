import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  NATIVE_SIGNER_MAX_BUFFER_BYTES,
  resolveNativeSignerExecutable,
  signNativePublicationCapture
} from "../src/publicationCaptureSigner.js";

const artifact = Buffer.from("measured native evidence");
const binding = {
  schemaVersion: 1 as const, packageId: "native-capture-1", projectId: "measured-project-1",
  objectId: "object-1", captureProtocolId: "protocol-1", kitId: "kit-1",
  commissioningPartyId: "party-1", capturedAt: "2026-08-30T10:00:00.000Z",
  evidenceScopes: [{ id: "dimensions", kind: "measurement" as const, required: true, verified: true }],
  manifest: [{ path: "evidence.json", sha256: createHash("sha256").update(artifact).digest("hex"), sizeBytes: artifact.byteLength }]
};

describe("native publication capture signer adapter", () => {
  it("fails closed outside the required macOS native runtime", async () => {
    await expect(signNativePublicationCapture({
      binding, keyId: "native-key-1", executablePath: "/not/invoked", expectedExecutableSha256: "0".repeat(64)
    })).rejects.toThrow("publication_native_signer_macos_required");
  });

  it("rejects malformed identity and ambiguous binding before execution", async () => {
    await expect(signNativePublicationCapture({
      binding, keyId: "../escape", executablePath: "/not/invoked", expectedExecutableSha256: "0".repeat(64)
    })).rejects.toThrow();
    await expect(signNativePublicationCapture({
      binding: { ...binding, evidenceScopes: [binding.evidenceScopes[0], binding.evidenceScopes[0]] },
      keyId: "native-key-1", executablePath: "/not/invoked", expectedExecutableSha256: "0".repeat(64)
    })).rejects.toThrow("Duplicate evidence scope ID");
  });

  it("allows canonicalized parent paths but rejects a symlinked signer file", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "measured-signer-path-"));
    try {
      const realDirectory = path.join(root, "real");
      const aliasDirectory = path.join(root, "alias");
      const executable = path.join(realDirectory, "signer");
      await mkdir(realDirectory);
      await writeFile(executable, "signer");
      await symlink(realDirectory, aliasDirectory, "dir");

      await expect(resolveNativeSignerExecutable(path.join(aliasDirectory, "signer"))).resolves.toBe(executable);

      const signerLink = path.join(root, "signer-link");
      await symlink(executable, signerLink, "file");
      await expect(resolveNativeSignerExecutable(signerLink)).rejects.toThrow("publication_native_signer_symlink_forbidden");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("sizes the native signer buffer above the maximum schema-valid package", () => {
    const evidenceScopes = Array.from({ length: 10_000 }, (_, index) => ({
      id: `scope-${String(index).padStart(5, "0")}-${"x".repeat(108)}`,
      kind: "known_deviation" as const,
      required: true,
      verified: true
    }));
    const manifest = Array.from({ length: 10_000 }, (_, index) => ({
      path: `${String(index).padStart(5, "0")}-${"x".repeat(234)}`,
      sha256: "f".repeat(64),
      sizeBytes: Number.MAX_SAFE_INTEGER
    }));
    const maximumPackage = {
      source: "native_app",
      binding: { ...binding, evidenceScopes, manifest },
      signature: {
        algorithm: "Ed25519",
        keyId: "k".repeat(120),
        publicKeyFingerprintSha256: "f".repeat(64),
        signedPayloadSha256: "f".repeat(64),
        valueBase64: "A".repeat(512)
      },
      nativeEvidence: {
        adapter: "measured-native-macos",
        adapterVersion: 1,
        platform: "macos",
        consent: {
          method: "device_owner_authentication",
          eventId: "6e5a0fe7-23a7-4ac5-87ea-61b4654df129",
          occurredAt: "2026-08-31T20:00:00.000Z"
        }
      }
    };

    expect(Buffer.byteLength(JSON.stringify(maximumPackage))).toBeLessThan(NATIVE_SIGNER_MAX_BUFFER_BYTES);
  });
});
