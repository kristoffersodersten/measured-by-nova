import { sign, type KeyObject } from "node:crypto";
import { z } from "zod";
import {
  capturePackagePayloadSha256,
  PublicationCapturePackageSchema,
  type CapturePackageBinding,
  type PublicationCapturePackage
} from "./publicationTrust.js";

const KeyIdSchema = z.string().min(1).max(120).regex(/^[A-Za-z0-9_.-]+$/);

/** Signs a validated binding without reading or serializing private key material. */
export function signNativePublicationCapture(input: {
  binding: CapturePackageBinding;
  keyId: string;
  privateKey: KeyObject;
}): PublicationCapturePackage {
  const keyId = KeyIdSchema.parse(input.keyId);
  if (input.privateKey.type !== "private" || input.privateKey.asymmetricKeyType !== "ed25519") {
    throw new Error("publication_signer_ed25519_private_key_required");
  }
  const binding = PublicationCapturePackageSchema.parse({ source: "manual_upload", binding: input.binding }).binding;
  const signedPayloadSha256 = capturePackagePayloadSha256(binding);
  const valueBase64 = sign(null, Buffer.from(signedPayloadSha256, "hex"), input.privateKey).toString("base64");
  return PublicationCapturePackageSchema.parse({
    source: "native_app",
    binding,
    signature: { algorithm: "Ed25519", keyId, signedPayloadSha256, valueBase64 }
  });
}
