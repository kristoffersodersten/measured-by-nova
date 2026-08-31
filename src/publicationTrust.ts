import { createHash, createPublicKey, verify as verifySignature, type KeyObject } from "node:crypto";
import { z } from "zod";

const IdSchema = z.string().min(1).max(120).regex(/^[a-zA-Z0-9_.-]+$/);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const RelativePathSchema = z.string().min(1).max(240).refine(
  (value) => !value.startsWith("/") && !value.split("/").includes(".."),
  "Artifact paths must be relative and stay inside the capture package."
);
export const PublicationEvidenceScopeSchema = z.object({
  id: IdSchema,
  kind: z.enum(["measurement", "material_source", "known_deviation"]),
  required: z.boolean(),
  verified: z.boolean()
}).strict();

export const CaptureArtifactManifestEntrySchema = z.object({
  path: RelativePathSchema,
  sha256: Sha256Schema,
  sizeBytes: z.number().int().nonnegative()
}).strict();

export const CapturePackageBindingSchema = z.object({
  schemaVersion: z.literal(1),
  packageId: IdSchema,
  projectId: IdSchema,
  objectId: IdSchema,
  captureProtocolId: IdSchema,
  kitId: IdSchema,
  commissioningPartyId: IdSchema,
  capturedAt: z.string().datetime({ offset: true }),
  evidenceScopes: z.array(PublicationEvidenceScopeSchema).min(1).max(10_000),
  manifest: z.array(CaptureArtifactManifestEntrySchema).min(1).max(10_000)
}).strict().superRefine((value, context) => {
  const paths = new Set<string>();
  for (const entry of value.manifest) {
    if (paths.has(entry.path)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["manifest"],
        message: `Duplicate artifact path: ${entry.path}`
      });
    }
    paths.add(entry.path);
  }
  const scopeIds = new Set<string>();
  for (const scope of value.evidenceScopes) {
    if (scopeIds.has(scope.id)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["evidenceScopes"], message: `Duplicate evidence scope ID: ${scope.id}` });
    }
    scopeIds.add(scope.id);
  }
});
export type CapturePackageBinding = z.infer<typeof CapturePackageBindingSchema>;

const NativeCapturePackageSchema = z.object({
  source: z.literal("native_app"),
  binding: CapturePackageBindingSchema,
  signature: z.object({
    algorithm: z.literal("Ed25519"),
    keyId: IdSchema,
    publicKeyFingerprintSha256: Sha256Schema,
    signedPayloadSha256: Sha256Schema,
    valueBase64: z.string().min(1).max(512).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)
  }).strict(),
  nativeEvidence: z.object({
    adapter: z.literal("measured-native-macos"),
    adapterVersion: z.literal(1),
    platform: z.literal("macos"),
    consent: z.object({
      method: z.literal("device_owner_authentication"),
      eventId: z.string().uuid(),
      occurredAt: z.string().datetime({ offset: true })
    }).strict()
  }).strict()
}).strict();

const ManualCapturePackageSchema = z.object({
  source: z.literal("manual_upload"),
  binding: CapturePackageBindingSchema
}).strict();

export const PublicationCapturePackageSchema = z.discriminatedUnion("source", [
  NativeCapturePackageSchema,
  ManualCapturePackageSchema
]);
export type PublicationCapturePackage = z.infer<typeof PublicationCapturePackageSchema>;
type NativeCapturePackage = Extract<PublicationCapturePackage, { source: "native_app" }>;

export interface CaptureArtifactContent {
  path: string;
  content?: Uint8Array;
  observedSha256?: string;
  observedSizeBytes?: number;
}

export const CapturePackageVerificationCodeSchema = z.enum([
  "manual_upload",
  "artifact_duplicate",
  "artifact_missing",
  "artifact_unexpected",
  "artifact_size_mismatch",
  "artifact_hash_mismatch",
  "signed_payload_hash_mismatch",
  "signing_key_unknown",
  "signing_key_revoked",
  "signing_key_fingerprint_mismatch",
  "signature_invalid"
]);
export type CapturePackageVerificationCode = z.infer<typeof CapturePackageVerificationCodeSchema>;

export interface CapturePackageVerificationResult {
  valid: boolean;
  codes: CapturePackageVerificationCode[];
  verifiedBindings: string[];
}

export type SigningKeyResolver = (keyId: string) => KeyObject | string | undefined;

function sha256(content: Uint8Array | string): string {
  return createHash("sha256").update(content).digest("hex");
}

function canonicalBinding(binding: z.infer<typeof CapturePackageBindingSchema>): string {
  return JSON.stringify({
    schemaVersion: binding.schemaVersion,
    packageId: binding.packageId,
    projectId: binding.projectId,
    objectId: binding.objectId,
    captureProtocolId: binding.captureProtocolId,
    kitId: binding.kitId,
    commissioningPartyId: binding.commissioningPartyId,
    capturedAt: binding.capturedAt,
    evidenceScopes: [...binding.evidenceScopes].sort((left, right) => left.id.localeCompare(right.id)),
    manifest: [...binding.manifest]
      .sort((left, right) => left.path.localeCompare(right.path))
      .map(({ path, sha256: artifactHash, sizeBytes }) => ({ path, sha256: artifactHash, sizeBytes }))
  });
}

export function capturePackagePayloadSha256(
  binding: z.infer<typeof CapturePackageBindingSchema>
): string {
  return sha256(canonicalBinding(CapturePackageBindingSchema.parse(binding)));
}

export function capturePackageSignaturePayloadSha256(input: {
  binding: CapturePackageBinding;
  keyId: string;
  publicKeyFingerprintSha256: string;
  nativeEvidence: NativeCapturePackage["nativeEvidence"];
}): string {
  const bindingHash = capturePackagePayloadSha256(input.binding);
  const keyId = IdSchema.parse(input.keyId);
  const fingerprint = Sha256Schema.parse(input.publicKeyFingerprintSha256);
  const evidence = NativeCapturePackageSchema.shape.nativeEvidence.parse(input.nativeEvidence);
  return sha256([
    "MeasuredByNovaPublicationSignatureV1",
    bindingHash,
    keyId,
    fingerprint,
    evidence.adapter,
    String(evidence.adapterVersion),
    evidence.platform,
    evidence.consent.method,
    evidence.consent.eventId,
    evidence.consent.occurredAt,
    ""
  ].join("\n"));
}

export function verifyPublicationCapturePackage(
  packageInput: unknown,
  artifacts: CaptureArtifactContent[],
  resolveSigningKey: SigningKeyResolver
): CapturePackageVerificationResult {
  const capturePackage = PublicationCapturePackageSchema.parse(packageInput);
  const codes: CapturePackageVerificationCode[] = [];
  const artifactByPath = new Map(artifacts.map((artifact) => [artifact.path, artifact]));
  if (artifactByPath.size !== artifacts.length) {
    codes.push("artifact_duplicate");
  }
  const manifestPaths = new Set(capturePackage.binding.manifest.map((entry) => entry.path));

  for (const entry of capturePackage.binding.manifest) {
    const artifact = artifactByPath.get(entry.path);
    if (!artifact) {
      codes.push("artifact_missing");
      continue;
    }
    const observedSizeBytes = artifact.observedSizeBytes ?? artifact.content?.byteLength;
    const observedSha256 = artifact.observedSha256 ?? (artifact.content ? sha256(artifact.content) : undefined);
    if (observedSizeBytes !== entry.sizeBytes) {
      codes.push("artifact_size_mismatch");
    }
    if (observedSha256 !== entry.sha256) {
      codes.push("artifact_hash_mismatch");
    }
  }

  if (artifacts.some((artifact) => !manifestPaths.has(artifact.path))) {
    codes.push("artifact_unexpected");
  }

  if (capturePackage.source === "manual_upload") {
    codes.push("manual_upload");
  } else {
    const payloadHash = capturePackageSignaturePayloadSha256({
      binding: capturePackage.binding,
      keyId: capturePackage.signature.keyId,
      publicKeyFingerprintSha256: capturePackage.signature.publicKeyFingerprintSha256,
      nativeEvidence: capturePackage.nativeEvidence
    });
    if (capturePackage.signature.signedPayloadSha256 !== payloadHash) {
      codes.push("signed_payload_hash_mismatch");
    } else {
      const signingKey = resolveSigningKey(capturePackage.signature.keyId);
      if (!signingKey) {
        codes.push("signing_key_unknown");
      } else {
        try {
          const publicKey = typeof signingKey === "string" || signingKey.type === "private"
            ? createPublicKey(signingKey)
            : signingKey;
          if (publicKey.asymmetricKeyType !== "ed25519") {
            codes.push("signature_invalid");
          } else if (sha256(publicKey.export({ type: "spki", format: "der" })) !== capturePackage.signature.publicKeyFingerprintSha256) {
            codes.push("signing_key_fingerprint_mismatch");
          }
          const signatureValid = verifySignature(
            null,
            Buffer.from(payloadHash, "hex"),
            publicKey,
            Buffer.from(capturePackage.signature.valueBase64, "base64")
          );
          if (!signatureValid) {
            codes.push("signature_invalid");
          }
        } catch {
          codes.push("signature_invalid");
        }
      }
    }
  }

  const uniqueCodes = [...new Set(codes)];
  return {
    valid: uniqueCodes.length === 0,
    codes: uniqueCodes,
    verifiedBindings: uniqueCodes.length === 0
      ? ["project", "object", "capture_protocol", "kit", "commissioning_party", "content", "signature"]
      : []
  };
}

export const PublicTrustCategorySchema = z.enum([
  "verified",
  "partially_verified",
  "reference",
  "disputed"
]);
export type PublicTrustCategory = z.infer<typeof PublicTrustCategorySchema>;

export const PublicationDisputeSchema = z.object({
  scopeId: IdSchema,
  status: z.literal("open"),
  reason: z.string().min(1).max(500)
}).strict();

export interface PublicTrustClassification {
  category: PublicTrustCategory;
  verifiedScopeIds: string[];
  unverifiedRequiredScopeIds: string[];
  disputedScopeIds: string[];
}

export function classifyPublicTrust(input: {
  capturePackage: PublicationCapturePackage;
  packageVerification: CapturePackageVerificationResult;
  disputes?: z.infer<typeof PublicationDisputeSchema>[];
}): PublicTrustClassification {
  const capturePackage = PublicationCapturePackageSchema.parse(input.capturePackage);
  const scopes = capturePackage.binding.evidenceScopes;
  const disputes = z.array(PublicationDisputeSchema).parse(input.disputes ?? []);
  const claimsAuthenticated = capturePackage.source === "native_app" && input.packageVerification.valid;
  const verifiedScopeIds = claimsAuthenticated ? scopes.filter((scope) => scope.verified).map((scope) => scope.id).sort() : [];
  const unverifiedRequiredScopeIds = scopes
    .filter((scope) => scope.required && (!claimsAuthenticated || !scope.verified))
    .map((scope) => scope.id)
    .sort();
  const disputedScopeIds = [...new Set(disputes.map((dispute) => dispute.scopeId))].sort();

  let category: PublicTrustCategory = "reference";
  if (disputedScopeIds.length > 0) {
    category = "disputed";
  } else if (capturePackage.source === "native_app" && input.packageVerification.valid) {
    category = unverifiedRequiredScopeIds.length === 0 ? "verified" : "partially_verified";
  }

  return { category, verifiedScopeIds, unverifiedRequiredScopeIds, disputedScopeIds };
}

export const InternalTrustScoresSchema = z.object({
  risk: z.number().finite().min(0).max(1),
  fidelity: z.number().finite().min(0).max(1),
  visibility: z.literal("internal_only")
}).strict();

export const CustomerRatingSummarySchema = z.object({
  average: z.number().finite().min(1).max(5),
  count: z.number().int().nonnegative(),
  minimumDisplayCount: z.number().int().positive()
}).strict();

export function customerRatingVisibility(input: unknown): { visible: boolean; average?: number; count: number } {
  const rating = CustomerRatingSummarySchema.parse(input);
  return rating.count >= rating.minimumDisplayCount
    ? { visible: true, average: rating.average, count: rating.count }
    : { visible: false, count: rating.count };
}
