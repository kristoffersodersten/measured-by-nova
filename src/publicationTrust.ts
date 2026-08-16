import { createHash, verify as verifySignature, type KeyObject } from "node:crypto";
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

const CapturePackageBindingSchema = z.object({
  schemaVersion: z.literal(1),
  packageId: IdSchema,
  projectId: IdSchema,
  objectId: IdSchema,
  captureProtocolId: IdSchema,
  kitId: IdSchema,
  commissioningPartyId: IdSchema,
  capturedAt: z.string().datetime({ offset: true }),
  evidenceScopes: z.array(PublicationEvidenceScopeSchema).min(1),
  manifest: z.array(CaptureArtifactManifestEntrySchema).min(1)
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
});

const NativeCapturePackageSchema = z.object({
  source: z.literal("native_app"),
  binding: CapturePackageBindingSchema,
  signature: z.object({
    algorithm: z.literal("Ed25519"),
    keyId: IdSchema,
    signedPayloadSha256: Sha256Schema,
    valueBase64: z.string().min(1)
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

export interface CaptureArtifactContent {
  path: string;
  content: Uint8Array;
}

export const CapturePackageVerificationCodeSchema = z.enum([
  "manual_upload",
  "artifact_missing",
  "artifact_unexpected",
  "artifact_size_mismatch",
  "artifact_hash_mismatch",
  "signed_payload_hash_mismatch",
  "signing_key_unknown",
  "signing_key_revoked",
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

export function verifyPublicationCapturePackage(
  packageInput: unknown,
  artifacts: CaptureArtifactContent[],
  resolveSigningKey: SigningKeyResolver
): CapturePackageVerificationResult {
  const capturePackage = PublicationCapturePackageSchema.parse(packageInput);
  const codes: CapturePackageVerificationCode[] = [];
  const artifactByPath = new Map(artifacts.map((artifact) => [artifact.path, artifact]));
  const manifestPaths = new Set(capturePackage.binding.manifest.map((entry) => entry.path));

  for (const entry of capturePackage.binding.manifest) {
    const artifact = artifactByPath.get(entry.path);
    if (!artifact) {
      codes.push("artifact_missing");
      continue;
    }
    if (artifact.content.byteLength !== entry.sizeBytes) {
      codes.push("artifact_size_mismatch");
    }
    if (sha256(artifact.content) !== entry.sha256) {
      codes.push("artifact_hash_mismatch");
    }
  }

  if (artifacts.some((artifact) => !manifestPaths.has(artifact.path))) {
    codes.push("artifact_unexpected");
  }

  if (capturePackage.source === "manual_upload") {
    codes.push("manual_upload");
  } else {
    const payloadHash = capturePackagePayloadSha256(capturePackage.binding);
    if (capturePackage.signature.signedPayloadSha256 !== payloadHash) {
      codes.push("signed_payload_hash_mismatch");
    } else {
      const signingKey = resolveSigningKey(capturePackage.signature.keyId);
      if (!signingKey) {
        codes.push("signing_key_unknown");
      } else {
        try {
          const signatureValid = verifySignature(
            null,
            Buffer.from(payloadHash, "hex"),
            signingKey,
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
  const verifiedScopeIds = scopes.filter((scope) => scope.verified).map((scope) => scope.id).sort();
  const unverifiedRequiredScopeIds = scopes
    .filter((scope) => scope.required && !scope.verified)
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
