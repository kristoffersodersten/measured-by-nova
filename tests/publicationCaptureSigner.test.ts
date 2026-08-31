import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signNativePublicationCapture } from "../src/publicationCaptureSigner.js";

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
      binding, keyId: "native-key-1", executablePath: "/not/invoked"
    })).rejects.toThrow("publication_native_signer_macos_required");
  });

  it("rejects malformed identity and ambiguous binding before execution", async () => {
    await expect(signNativePublicationCapture({
      binding, keyId: "../escape", executablePath: "/not/invoked"
    })).rejects.toThrow();
    await expect(signNativePublicationCapture({
      binding: { ...binding, evidenceScopes: [binding.evidenceScopes[0], binding.evidenceScopes[0]] },
      keyId: "native-key-1", executablePath: "/not/invoked"
    })).rejects.toThrow("Duplicate evidence scope ID");
  });
});
