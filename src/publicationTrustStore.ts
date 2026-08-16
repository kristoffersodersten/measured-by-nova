import { createHash, createPublicKey } from "node:crypto";
import { readFile, readdir, realpath, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { BlenderConfig } from "./contracts.js";
import { safeOutputPath } from "./blenderRunner.js";
import { ExecutionIntentSchema } from "./executionGate.js";
import {
  classifyPublicTrust,
  PublicationCapturePackageSchema,
  PublicationDisputeSchema,
  PublicationEvidenceScopeSchema,
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
  evidenceScopes: z.array(PublicationEvidenceScopeSchema).min(1),
  disputes: z.array(PublicationDisputeSchema).default([])
}).strict();

const StoredPublicationTrustSchema = z.object({
  schemaVersion: z.literal(1),
  projectId: z.string(),
  packageManifestPath: RelativePathSchema,
  publicKeyPath: RelativePathSchema.optional(),
  packageManifestSha256: z.string().length(64),
  evidenceScopes: z.array(PublicationEvidenceScopeSchema),
  disputes: z.array(PublicationDisputeSchema),
  verification: z.object({ valid: z.boolean(), codes: z.array(z.string()), verifiedBindings: z.array(z.string()) }).strict(),
  classification: z.object({ category: z.enum(["verified", "partially_verified", "reference", "disputed"]), verifiedScopeIds: z.array(z.string()), unverifiedRequiredScopeIds: z.array(z.string()), disputedScopeIds: z.array(z.string()) }).strict()
}).strict();
export type StoredPublicationTrust = z.infer<typeof StoredPublicationTrustSchema>;

export async function verifyAndStorePublicationTrust(config: BlenderConfig, input: unknown): Promise<StoredPublicationTrust> {
  const payload = VerifyPublicationCaptureInputSchema.parse(input);
  const evaluated = await evaluatePublicationTrust(config, payload);
  const evidencePath = trustEvidencePath(config, payload.projectId);
  await assertProjectIdentity(config, payload.projectId);
  const temporary = `${evidencePath}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(evaluated, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  await rename(temporary, evidencePath);
  return evaluated;
}

export async function readLivePublicationTrust(config: BlenderConfig, projectId: string): Promise<StoredPublicationTrust | null> {
  let stored: StoredPublicationTrust;
  try { stored = StoredPublicationTrustSchema.parse(JSON.parse(await readFile(trustEvidencePath(config, projectId), "utf8"))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw new Error("publication_trust_evidence_invalid"); }
  if (stored.projectId !== projectId) throw new Error("publication_trust_project_mismatch");
  let live: StoredPublicationTrust;
  try { live = await evaluatePublicationTrust(config, stored); }
  catch {
    return StoredPublicationTrustSchema.parse({ ...stored, verification: { valid: false, codes: ["artifact_missing"], verifiedBindings: [] }, classification: { ...stored.classification, category: "disputed", disputedScopeIds: [...new Set([...stored.classification.disputedScopeIds, ...stored.classification.verifiedScopeIds])].sort() } });
  }
  if (["verified", "partially_verified"].includes(stored.classification.category) && !live.verification.valid) {
    return StoredPublicationTrustSchema.parse({ ...live, classification: { ...live.classification, category: "disputed", disputedScopeIds: [...new Set([...live.classification.disputedScopeIds, ...stored.classification.verifiedScopeIds])].sort() } });
  }
  return live;
}

async function evaluatePublicationTrust(config: BlenderConfig, input: z.infer<typeof VerifyPublicationCaptureInputSchema>): Promise<StoredPublicationTrust> {
  const manifestPath = safeOutputPath(config.outputDir, input.packageManifestPath);
  await assertWithinRoot(config.outputDir, manifestPath);
  const manifestBytes = await readFile(manifestPath);
  const capturePackage = PublicationCapturePackageSchema.parse(JSON.parse(manifestBytes.toString("utf8")));
  if (capturePackage.binding.projectId !== input.projectId) throw new Error("publication_trust_project_mismatch");
  const packageDirectory = path.dirname(manifestPath);
  const actual = (await listFiles(packageDirectory)).filter((entry) => entry !== path.basename(manifestPath));
  const artifacts = await Promise.all(actual.sort().map(async (relative) => {
    const artifactPath = path.join(packageDirectory, relative);
    await assertWithinRoot(packageDirectory, artifactPath);
    return { path: relative, content: await readFile(artifactPath) };
  }));
  let publicKey: string | undefined;
  if (capturePackage.source === "native_app") {
    if (!input.publicKeyPath) throw new Error("publication_trust_public_key_required");
    if (!input.publicKeyPath.startsWith("publication-keys/")) throw new Error("publication_trust_public_key_scope_invalid");
    const keyPath = safeOutputPath(config.outputDir, input.publicKeyPath);
    await assertWithinRoot(safeOutputPath(config.outputDir, "publication-keys"), keyPath);
    if (path.basename(input.publicKeyPath, path.extname(input.publicKeyPath)) !== capturePackage.signature.keyId) throw new Error("publication_trust_key_identity_mismatch");
    publicKey = await readFile(keyPath, "utf8");
    try { createPublicKey(publicKey); } catch { throw new Error("publication_trust_public_key_invalid"); }
    if (await isKeyRevoked(config, capturePackage.signature.keyId)) throw new Error("publication_trust_key_revoked");
  }
  const verification = verifyPublicationCapturePackage(capturePackage, artifacts, (keyId) => capturePackage.source === "native_app" && keyId === capturePackage.signature.keyId ? publicKey : undefined);
  const classified = classifyPublicTrust({ capturePackage, packageVerification: verification, evidenceScopes: input.evidenceScopes, disputes: input.disputes });
  const classification = capturePackage.source === "native_app" && !verification.valid
    ? { ...classified, category: "disputed" as const, disputedScopeIds: [...new Set([...classified.disputedScopeIds, ...input.evidenceScopes.map((scope) => scope.id)])].sort() }
    : classified;
  return StoredPublicationTrustSchema.parse({ schemaVersion: 1, projectId: input.projectId, packageManifestPath: input.packageManifestPath, ...(input.publicKeyPath ? { publicKeyPath: input.publicKeyPath } : {}), packageManifestSha256: createHash("sha256").update(manifestBytes).digest("hex"), evidenceScopes: input.evidenceScopes, disputes: input.disputes, verification, classification });
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
  if (!(await stat(canonicalTarget)).isFile() && canonicalTarget === target) throw new Error("publication_trust_path_invalid");
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
function trustEvidencePath(config: BlenderConfig, projectId: string): string { return safeOutputPath(config.outputDir, path.join("measurement-projects", projectId, ".publication-trust.json")); }
