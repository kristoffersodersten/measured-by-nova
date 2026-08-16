import { createHash, createPublicKey, randomUUID, type KeyObject } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { BlenderConfig } from "./contracts.js";
import { safeOutputPath } from "./blenderRunner.js";
import { ExecutionIntentSchema } from "./executionGate.js";
import {
  classifyPublicTrust,
  type CaptureArtifactContent,
  PublicationCapturePackageSchema,
  PublicationDisputeSchema,
  verifyPublicationCapturePackage
} from "./publicationTrust.js";

const RelativePathSchema = z.string().min(1).max(240).refine((value) => !value.startsWith("/") && !value.split("/").includes(".."));
const RevokedKeyRegistrySchema = z.object({
  schemaVersion: z.literal(1),
  revokedKeyIds: z.array(z.string().min(1).max(120).regex(/^[A-Za-z0-9_.-]+$/))
}).strict();
export const VerifyPublicationCaptureInputSchema = z.object({
  projectId: z.string().min(1).max(120).regex(/^[A-Za-z0-9_.-]+$/),
  executionIntent: ExecutionIntentSchema,
  packageManifestPath: RelativePathSchema,
  publicKeyPath: RelativePathSchema.optional(),
  disputes: z.array(PublicationDisputeSchema).default([])
}).strict();

const StoredPublicationTrustSchema = z.object({
  schemaVersion: z.literal(1),
  projectId: z.string(),
  packageManifestPath: RelativePathSchema,
  publicKeyPath: RelativePathSchema.optional(),
  packageManifestSha256: z.string().length(64),
  disputes: z.array(PublicationDisputeSchema),
  verification: z.object({ valid: z.boolean(), codes: z.array(z.string()), verifiedBindings: z.array(z.string()) }).strict(),
  classification: z.object({ category: z.enum(["verified", "partially_verified", "reference", "disputed"]), verifiedScopeIds: z.array(z.string()), unverifiedRequiredScopeIds: z.array(z.string()), disputedScopeIds: z.array(z.string()) }).strict()
}).strict();
export type StoredPublicationTrust = z.infer<typeof StoredPublicationTrustSchema>;

export async function verifyAndStorePublicationTrust(config: BlenderConfig, input: unknown): Promise<StoredPublicationTrust> {
  const payload = VerifyPublicationCaptureInputSchema.parse(input);
  const existing = await readStoredPublicationTrust(config, payload.projectId);
  const disputes = [...new Map([...(existing?.disputes ?? []), ...payload.disputes].map((dispute) => [dispute.scopeId, dispute])).values()];
  const evaluated = await evaluatePublicationTrust(config, { ...payload, disputes });
  const evidencePath = trustEvidencePath(config, payload.projectId);
  await assertProjectIdentity(config, payload.projectId);
  const temporary = `${evidencePath}.tmp-${randomUUID()}`;
  try {
    await writeFile(temporary, `${JSON.stringify(evaluated, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temporary, evidencePath);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return evaluated;
}

export async function readLivePublicationTrust(config: BlenderConfig, projectId: string): Promise<StoredPublicationTrust | null> {
  const stored = await readStoredPublicationTrust(config, projectId);
  if (!stored) return null;
  if (stored.projectId !== projectId) throw new Error("publication_trust_project_mismatch");
  let live: StoredPublicationTrust;
  try { live = await evaluatePublicationTrust(config, stored); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code === "ENOENT"
      ? "artifact_missing"
      : error instanceof Error && error.message.startsWith("publication_trust_")
        ? error.message
        : "publication_trust_revalidation_failed";
    return StoredPublicationTrustSchema.parse({ ...stored, verification: { valid: false, codes: [code], verifiedBindings: [] }, classification: { ...stored.classification, category: "disputed", disputedScopeIds: [...new Set([...stored.classification.disputedScopeIds, ...stored.classification.verifiedScopeIds])].sort() } });
  }
  if (live.packageManifestSha256 !== stored.packageManifestSha256) {
    return StoredPublicationTrustSchema.parse({ ...live, verification: { ...live.verification, valid: false, codes: [...new Set([...live.verification.codes, "signed_payload_hash_mismatch"])] }, classification: { ...live.classification, category: "disputed", disputedScopeIds: [...new Set([...live.classification.disputedScopeIds, ...stored.classification.verifiedScopeIds])].sort() } });
  }
  if (["verified", "partially_verified"].includes(stored.classification.category) && !live.verification.valid) {
    return StoredPublicationTrustSchema.parse({ ...live, classification: { ...live.classification, category: "disputed", disputedScopeIds: [...new Set([...live.classification.disputedScopeIds, ...stored.classification.verifiedScopeIds])].sort() } });
  }
  return live;
}

type PublicationTrustEvaluationInput = Pick<z.infer<typeof VerifyPublicationCaptureInputSchema>, "projectId" | "packageManifestPath" | "publicKeyPath" | "disputes">;

async function evaluatePublicationTrust(config: BlenderConfig, input: PublicationTrustEvaluationInput): Promise<StoredPublicationTrust> {
  const manifestPath = safeOutputPath(config.outputDir, input.packageManifestPath);
  await assertWithinRoot(config.outputDir, manifestPath);
  const manifestBytes = await readFile(manifestPath);
  const capturePackage = PublicationCapturePackageSchema.parse(JSON.parse(manifestBytes.toString("utf8")));
  if (capturePackage.binding.projectId !== input.projectId) throw new Error("publication_trust_project_mismatch");
  const packageDirectory = path.dirname(manifestPath);
  const actual = (await listFiles(packageDirectory)).filter((entry) => entry !== path.basename(manifestPath));
  const artifacts: CaptureArtifactContent[] = [];
  for (const relative of actual.sort()) {
    const artifactPath = path.join(packageDirectory, relative);
    await assertWithinRoot(packageDirectory, artifactPath);
    const hash = createHash("sha256");
    let observedSizeBytes = 0;
    for await (const chunk of createReadStream(artifactPath) as AsyncIterable<Buffer>) { hash.update(chunk); observedSizeBytes += chunk.length; }
    artifacts.push({ path: relative, observedSha256: hash.digest("hex"), observedSizeBytes });
  }
  let publicKey: KeyObject | undefined;
  let keyRevoked = false;
  if (capturePackage.source === "native_app") {
    if (!input.publicKeyPath) throw new Error("publication_trust_public_key_required");
    if (!input.publicKeyPath.startsWith("publication-keys/")) throw new Error("publication_trust_public_key_scope_invalid");
    const keyRoot = safeOutputPath(config.outputDir, "publication-keys");
    const keyPath = safeOutputPath(config.outputDir, input.publicKeyPath);
    await assertDirectSubdirectory(config.outputDir, keyRoot);
    await assertWithinRoot(keyRoot, keyPath);
    if (path.basename(input.publicKeyPath, path.extname(input.publicKeyPath)) !== capturePackage.signature.keyId) throw new Error("publication_trust_key_identity_mismatch");
    const keyPem = await readFile(keyPath, "utf8");
    if (/-----BEGIN [^-]*PRIVATE KEY-----/.test(keyPem)) throw new Error("publication_trust_private_key_forbidden");
    try { publicKey = createPublicKey(keyPem); } catch { throw new Error("publication_trust_public_key_invalid"); }
    if (publicKey.asymmetricKeyType !== "ed25519") throw new Error("publication_trust_key_algorithm_invalid");
    keyRevoked = await isKeyRevoked(config, capturePackage.signature.keyId);
  }
  const evaluatedVerification = verifyPublicationCapturePackage(capturePackage, artifacts, (keyId) => capturePackage.source === "native_app" && !keyRevoked && keyId === capturePackage.signature.keyId ? publicKey : undefined);
  const verification = keyRevoked
    ? { ...evaluatedVerification, codes: [...new Set(evaluatedVerification.codes.map((code) => code === "signing_key_unknown" ? "signing_key_revoked" as const : code))] }
    : evaluatedVerification;
  const classified = classifyPublicTrust({ capturePackage, packageVerification: verification, disputes: input.disputes });
  const integrityInvalid = verification.codes.some((code) => code !== "manual_upload");
  const classification = (capturePackage.source === "native_app" && !verification.valid) || (capturePackage.source === "manual_upload" && integrityInvalid)
    ? { ...classified, category: "disputed" as const, disputedScopeIds: [...new Set([...classified.disputedScopeIds, ...capturePackage.binding.evidenceScopes.map((scope) => scope.id)])].sort() }
    : classified;
  return StoredPublicationTrustSchema.parse({ schemaVersion: 1, projectId: input.projectId, packageManifestPath: input.packageManifestPath, ...(input.publicKeyPath ? { publicKeyPath: input.publicKeyPath } : {}), packageManifestSha256: createHash("sha256").update(manifestBytes).digest("hex"), disputes: input.disputes, verification, classification });
}

async function listFiles(root: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(path.join(root, prefix), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relative = path.join(prefix, entry.name);
    if (entry.isSymbolicLink()) throw new Error("publication_trust_symlink_forbidden");
    if (entry.isDirectory()) files.push(...await listFiles(root, relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files;
}
async function assertProjectIdentity(config: BlenderConfig, projectId: string): Promise<void> {
  const project = JSON.parse(await readFile(safeOutputPath(config.outputDir, path.join("measurement-projects", projectId, "project.json")), "utf8")) as { projectId?: unknown };
  if (project.projectId !== projectId) throw new Error("publication_trust_project_mismatch");
}
async function assertWithinRoot(root: string, target: string): Promise<void> {
  const [canonicalRoot, canonicalTarget] = await Promise.all([realpath(root), realpath(target)]);
  if (canonicalTarget !== canonicalRoot && !canonicalTarget.startsWith(`${canonicalRoot}${path.sep}`)) throw new Error("publication_trust_path_escape");
  if (!(await stat(canonicalTarget)).isFile()) throw new Error("publication_trust_path_invalid");
}
async function assertDirectSubdirectory(root: string, child: string): Promise<void> {
  const [canonicalRoot, canonicalChild] = await Promise.all([realpath(root), realpath(child)]);
  if (canonicalChild !== path.join(canonicalRoot, path.basename(child))) throw new Error("publication_trust_key_root_escape");
}
async function isKeyRevoked(config: BlenderConfig, keyId: string): Promise<boolean> {
  const registryPath = safeOutputPath(config.outputDir, path.join("publication-keys", "revoked-key-ids.json"));
  try {
    const registry = RevokedKeyRegistrySchema.parse(JSON.parse(await readFile(registryPath, "utf8")));
    return registry.revokedKeyIds.includes(keyId);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw new Error("publication_trust_revocation_registry_invalid");
  }
}
async function readStoredPublicationTrust(config: BlenderConfig, projectId: string): Promise<StoredPublicationTrust | null> {
  try {
    const stored = StoredPublicationTrustSchema.parse(JSON.parse(await readFile(trustEvidencePath(config, projectId), "utf8")));
    if (stored.projectId !== projectId) throw new Error("publication_trust_project_mismatch");
    return stored;
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    if (error instanceof Error && error.message === "publication_trust_project_mismatch") throw error;
    throw new Error("publication_trust_evidence_invalid");
  }
}
function trustEvidencePath(config: BlenderConfig, projectId: string): string { return safeOutputPath(config.outputDir, path.join("measurement-projects", projectId, ".publication-trust.json")); }
