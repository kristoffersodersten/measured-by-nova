import { createHash, randomUUID } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, open, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { BlenderConfig } from "./contracts.js";
import { safeOutputPath } from "./blenderRunner.js";
import type { MeasurementProject } from "./measurementContracts.js";

const RelativePathSchema = z.string().min(1).max(500).refine((value) => !path.isAbsolute(value) && !value.split(/[\\/]/).includes(".."));
const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const FormatSchema = z.enum(["blend", "glb", "obj", "mtl", "usdz"]);
export const PortableExportEvidenceSchema = z.object({
  schemaVersion: z.literal(1),
  projectId: z.string().min(1).max(120),
  sourceBlendPath: RelativePathSchema,
  modelHash: HashSchema,
  requestedFormats: z.array(z.enum(["blend", "glb", "obj", "usdz"])).min(1).max(4),
  artifacts: z.array(z.object({ format: FormatSchema, path: RelativePathSchema, sizeBytes: z.number().int().positive().max(4 * 1024 * 1024 * 1024), sha256: HashSchema }).strict()).min(1).max(5),
  execution: z.object({ tool: z.literal("export_model"), fallbackUsed: z.literal(false), geometryMutation: z.literal(false) }).strict()
}).strict();
export type PortableExportEvidence = z.infer<typeof PortableExportEvidenceSchema>;
export type PortableExportLiveState = { status: "ready"; evidence: PortableExportEvidence } | { status: "missing" | "blocked"; code: string };
export type PortableExportFormat = z.infer<typeof FormatSchema>;

export async function writePortableExportEvidence(config: BlenderConfig, evidence: PortableExportEvidence): Promise<string> {
  const parsed = PortableExportEvidenceSchema.parse(evidence);
  const relative = path.join("measurement-projects", parsed.projectId, "artifacts", "portable-export-manifest.json");
  const target = safeOutputPath(config.outputDir, relative);
  const temporary = `${target}.tmp-${randomUUID()}`;
  try {
    await writeFile(temporary, `${JSON.stringify(parsed, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temporary, target);
  } catch (error) { await rm(temporary, { force: true }); throw error; }
  return relative;
}

export async function readLivePortableExportEvidence(config: BlenderConfig, project: MeasurementProject): Promise<PortableExportLiveState> {
  const manifestRelative = project.artifacts.portableExportManifest;
  if (!manifestRelative) return { status: "missing", code: "portable_export_manifest_missing" };
  try {
    const expectedManifest = path.join("measurement-projects", project.projectId, "artifacts", "portable-export-manifest.json");
    if (manifestRelative !== expectedManifest) return { status: "blocked", code: "portable_export_manifest_path_mismatch" };
    const manifestPath = safeOutputPath(config.outputDir, manifestRelative);
    await assertCanonicalFile(config.outputDir, manifestPath);
    if ((await stat(manifestPath)).size > 1024 * 1024) return { status: "blocked", code: "portable_export_manifest_too_large" };
    const evidence = PortableExportEvidenceSchema.parse(JSON.parse((await readStableFile(manifestPath)).toString("utf8")));
    if (evidence.projectId !== project.projectId || evidence.sourceBlendPath !== project.modelLock.modelArtifact || evidence.modelHash !== project.modelLock.modelHash) return { status: "blocked", code: "portable_export_model_lock_mismatch" };
    if (new Set(evidence.requestedFormats).size !== evidence.requestedFormats.length || new Set(evidence.artifacts.map((artifact) => artifact.format)).size !== evidence.artifacts.length) return { status: "blocked", code: "portable_export_artifact_duplicate" };
    const artifactFormats = new Set(evidence.artifacts.map((artifact) => artifact.format));
    const expectedFormats = new Set(["blend", ...evidence.requestedFormats, ...(evidence.requestedFormats.includes("obj") ? ["mtl"] : [])]);
    if (artifactFormats.size !== expectedFormats.size || [...expectedFormats].some((format) => !artifactFormats.has(format as z.infer<typeof FormatSchema>))) return { status: "blocked", code: "portable_export_artifact_set_mismatch" };
    let aggregateBytes = 0;
    for (const artifact of evidence.artifacts) {
      const artifactPath = safeOutputPath(config.outputDir, artifact.path);
      await assertCanonicalFile(config.outputDir, artifactPath);
      const identity = await streamIdentity(artifactPath);
      aggregateBytes += identity.sizeBytes;
      if (aggregateBytes > 8 * 1024 * 1024 * 1024) return { status: "blocked", code: "portable_export_bytes_exceeded" };
      if (identity.sizeBytes !== artifact.sizeBytes || identity.sha256 !== artifact.sha256) return { status: "blocked", code: "portable_export_artifact_drift" };
      if (artifact.format === "blend" && identity.sha256 !== evidence.modelHash) return { status: "blocked", code: "portable_export_blend_model_lock_mismatch" };
    }
    return { status: "ready", evidence };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: "blocked", code: "portable_export_artifact_missing" };
    if (error instanceof Error && error.message === "portable_export_path_invalid") return { status: "blocked", code: "portable_export_artifact_path_invalid" };
    if (error instanceof Error && error.message === "portable_export_artifact_changed_during_validation") return { status: "blocked", code: "portable_export_artifact_unstable" };
    return { status: "blocked", code: error instanceof z.ZodError || error instanceof SyntaxError ? "portable_export_manifest_invalid" : "portable_export_revalidation_failed" };
  }
}

export async function readVerifiedPortableExportArtifact(config: BlenderConfig, project: MeasurementProject, format: PortableExportFormat): Promise<{ bytes: Buffer; filename: string; contentType: string; sha256: string }> {
  const live = await readLivePortableExportEvidence(config, project);
  if (live.status !== "ready") throw new Error(live.code);
  const artifact = live.evidence.artifacts.find((entry) => entry.format === format);
  if (!artifact) throw new Error("workspace_delivery_artifact_undeclared");
  if (artifact.sizeBytes > 256 * 1024 * 1024) throw new Error("workspace_delivery_artifact_too_large");
  const artifactPath = safeOutputPath(config.outputDir, artifact.path);
  await assertCanonicalFile(config.outputDir, artifactPath);
  const bytes = await readStableFile(artifactPath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (bytes.byteLength !== artifact.sizeBytes || sha256 !== artifact.sha256 || (format === "blend" && sha256 !== live.evidence.modelHash)) throw new Error("workspace_delivery_artifact_drift");
  const filename = path.basename(artifact.path);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(filename)) throw new Error("workspace_delivery_filename_invalid");
  return { bytes, filename, contentType: contentTypeFor(format), sha256 };
}

function contentTypeFor(format: PortableExportFormat): string {
  if (format === "glb") return "model/gltf-binary";
  if (format === "obj") return "model/obj";
  if (format === "mtl") return "text/plain; charset=utf-8";
  if (format === "usdz") return "model/vnd.usdz+zip";
  return "application/octet-stream";
}

async function assertCanonicalFile(root: string, file: string): Promise<void> {
  const relative = path.relative(path.resolve(root), path.resolve(file));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("portable_export_path_invalid");
  let cursor = path.resolve(root);
  for (const component of relative.split(path.sep)) {
    cursor = path.join(cursor, component);
    if ((await lstat(cursor)).isSymbolicLink()) throw new Error("portable_export_path_invalid");
  }
  const [canonicalRoot, canonicalFile] = await Promise.all([realpath(root), realpath(file)]);
  if (!canonicalFile.startsWith(`${canonicalRoot}${path.sep}`) || !(await stat(canonicalFile)).isFile()) throw new Error("portable_export_path_invalid");
}

async function streamIdentity(file: string): Promise<{ sizeBytes: number; sha256: string }> {
  const beforePath = await stat(file, { bigint: true });
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const beforeHandle = await handle.stat({ bigint: true });
    if (!sameFileState(beforePath, beforeHandle)) throw new Error("portable_export_artifact_changed_during_validation");
    const hash = createHash("sha256");
    let sizeBytes = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false }) as AsyncIterable<Buffer>) { hash.update(chunk); sizeBytes += chunk.length; }
    const [afterHandle, afterPath] = await Promise.all([handle.stat({ bigint: true }), stat(file, { bigint: true })]);
    if (!sameFileState(beforeHandle, afterHandle) || !sameFileState(afterHandle, afterPath)) throw new Error("portable_export_artifact_changed_during_validation");
    return { sizeBytes, sha256: hash.digest("hex") };
  } finally { await handle.close(); }
}

async function readStableFile(file: string): Promise<Buffer> {
  const beforePath = await stat(file, { bigint: true });
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const beforeHandle = await handle.stat({ bigint: true });
    if (!sameFileState(beforePath, beforeHandle)) throw new Error("portable_export_artifact_changed_during_validation");
    const contents = await handle.readFile();
    const [afterHandle, afterPath] = await Promise.all([handle.stat({ bigint: true }), stat(file, { bigint: true })]);
    if (!sameFileState(beforeHandle, afterHandle) || !sameFileState(afterHandle, afterPath)) throw new Error("portable_export_artifact_changed_during_validation");
    return contents;
  } finally { await handle.close(); }
}

function sameFileState(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}
