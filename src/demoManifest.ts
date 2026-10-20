import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { safeOutputPath } from "./blenderRunner.js";

const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const GitShaSchema = z.string().regex(/^[a-f0-9]{40}$/);
const RelativePathSchema = z.string().min(1).max(500).refine((value) => !path.isAbsolute(value) && !value.split(/[\\/]/).includes(".."));

export const CarportDemoManifestSchema = z.object({
  schemaVersion: z.literal(1),
  manifestType: z.literal("measured-carport-premium-demo"),
  createdAt: z.string().datetime({ offset: true }),
  source: z.object({
    sourceSha: GitShaSchema,
    legalBaseSha: GitShaSchema,
    legalBaseIncluded: z.literal(true),
    unauthorizedSignerCommitIncluded: z.literal(false),
    unauthorizedSignerToolExposed: z.literal(false)
  }).strict(),
  fixture: z.object({ path: RelativePathSchema, sha256: HashSchema, captureId: z.string().min(1), projectId: z.string().min(1) }).strict(),
  failClosedProof: z.object({
    attemptedField: z.literal("dimensions.width"),
    expectedErrorCode: z.literal("capture_contract_failed"),
    observedErrorCode: z.literal("capture_contract_failed"),
    blockerId: z.literal("width"),
    recoverySucceeded: z.literal(true)
  }).strict(),
  humanReview: z.object({ reviewer: z.string().min(1).max(120), confirmation: z.literal("reviewed-generated-blend-before-lock") }).strict(),
  modelLock: z.object({ artifact: RelativePathSchema, modelHash: HashSchema, sourceProjectHash: HashSchema }).strict(),
  runtime: z.object({ node: z.string().min(1), pnpm: z.string().min(1), blender: z.string().min(1), platform: z.string().min(1), arch: z.string().min(1) }).strict(),
  execution: z.object({ locality: z.literal("local-only"), telemetry: z.literal(false), fallback: z.literal("none"), geometryMutation: z.literal(false) }).strict(),
  timingsMs: z.record(z.number().int().nonnegative()),
  artifacts: z.array(z.object({ role: z.string().min(1), path: RelativePathSchema, sizeBytes: z.number().int().positive(), sha256: HashSchema }).strict()).min(1)
}).strict();

export type CarportDemoManifest = z.infer<typeof CarportDemoManifestSchema>;

export async function identifyDemoArtifact(outputRoot: string, role: string, relativePath: string) {
  const parsedPath = RelativePathSchema.parse(relativePath.replaceAll(path.sep, "/"));
  const absolutePath = safeOutputPath(outputRoot, parsedPath);
  const [bytes, metadata] = await Promise.all([readFile(absolutePath), stat(absolutePath)]);
  if (!metadata.isFile() || bytes.byteLength === 0) throw new Error(`demo_artifact_invalid:${parsedPath}`);
  return { role, path: parsedPath, sizeBytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") };
}

export function serializeCarportDemoManifest(value: CarportDemoManifest): string {
  return `${JSON.stringify(CarportDemoManifestSchema.parse(value), null, 2)}\n`;
}