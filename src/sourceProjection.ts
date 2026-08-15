import { createHash } from "node:crypto";
import { z } from "zod";

const RelativePathSchema = z.string().min(1).max(240).refine((value) => !value.startsWith("/") && !value.split(/[\\/]/).includes(".."), {
  message: "Path must be relative and stay inside the configured output directory."
});
const BlendPathSchema = RelativePathSchema.refine((value) => value.toLowerCase().endsWith(".blend"), {
  message: "Path must identify a .blend artifact."
});
const PointSchema = z.object({ x: z.number().finite().nonnegative(), y: z.number().finite().nonnegative() }).strict();

export const SourceProjectionInputSchema = z.object({
  schemaVersion: z.literal(1),
  projectId: z.string().min(1).max(120).regex(/^[a-zA-Z0-9_.-]+$/),
  sourceBlendPath: BlendPathSchema.refine((value) => value.startsWith("sources/") || value.startsWith("measurement-projects/")),
  outputBlendPath: BlendPathSchema.refine((value) => value.startsWith("projections/")),
  outputReportPath: RelativePathSchema.refine((value) => value.startsWith("projections/") && value.endsWith(".json")),
  sourcePhoto: z.object({
    path: RelativePathSchema,
    sizeBytes: z.number().int().positive(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    pixelWidth: z.number().int().positive(),
    pixelHeight: z.number().int().positive()
  }).strict(),
  target: z.object({
    hostElementId: z.string().min(1).max(120).regex(/^[a-zA-Z0-9_.-]+$/),
    face: z.enum(["front", "rear", "left", "right", "top", "bottom"]),
    widthMm: z.number().finite().positive(),
    heightMm: z.number().finite().positive(),
    dimensionToleranceMm: z.number().finite().positive().max(100).default(2)
  }).strict(),
  anchors: z.array(z.object({
    id: z.string().min(1).max(80).regex(/^[a-zA-Z0-9_.-]+$/),
    sourcePx: PointSchema,
    targetMm: PointSchema,
    uncertaintyPx: z.number().finite().nonnegative().max(100)
  }).strict()).min(4).max(64),
  thresholds: z.object({
    inlierErrorPx: z.number().finite().positive().max(100),
    maxRmsePx: z.number().finite().positive().max(100),
    minInlierRatio: z.number().finite().min(0.5).max(1)
  }).strict()
}).strict();

export type SourceProjectionInput = z.infer<typeof SourceProjectionInputSchema>;

function assertProjectionContract(input: SourceProjectionInput): void {
  if (input.sourceBlendPath === input.outputBlendPath) throw new SourceProjectionError("alignment_contract_invalid", "Projection output must not overwrite locked source geometry.");
  const ids = new Set<string>();
  const sourcePoints = new Set<string>();
  const targetPoints = new Set<string>();
  input.anchors.forEach((anchor) => {
    if (ids.has(anchor.id)) throw new SourceProjectionError("alignment_contract_invalid", `Anchor ID must be unique: ${anchor.id}`);
    ids.add(anchor.id);
    const sourceKey = `${anchor.sourcePx.x}:${anchor.sourcePx.y}`;
    const targetKey = `${anchor.targetMm.x}:${anchor.targetMm.y}`;
    if (sourcePoints.has(sourceKey)) throw new SourceProjectionError("alignment_contract_invalid", `Source anchor coordinates must be unique: ${sourceKey}`);
    if (targetPoints.has(targetKey)) throw new SourceProjectionError("alignment_contract_invalid", `Target anchor coordinates must be unique: ${targetKey}`);
    sourcePoints.add(sourceKey); targetPoints.add(targetKey);
    if (anchor.sourcePx.x > input.sourcePhoto.pixelWidth || anchor.sourcePx.y > input.sourcePhoto.pixelHeight) {
      throw new SourceProjectionError("alignment_contract_invalid", `Source anchor lies outside the declared image: ${anchor.id}`);
    }
    if (anchor.targetMm.x > input.target.widthMm || anchor.targetMm.y > input.target.heightMm) {
      throw new SourceProjectionError("alignment_contract_invalid", `Target anchor lies outside the declared surface: ${anchor.id}`);
    }
  });
}

export const SourceProjectionManifestSchema = z.object({
  schemaVersion: z.literal(1),
  method: z.literal("normalized-planar-homography-v1"),
  authority: z.object({ visualEvidenceOnly: z.literal(true), geometryAuthority: z.literal(false), geometryMutationAllowed: z.literal(false) }).strict(),
  sourcePhoto: SourceProjectionInputSchema.shape.sourcePhoto,
  target: SourceProjectionInputSchema.shape.target,
  anchors: SourceProjectionInputSchema.shape.anchors,
  transform: z.object({
    targetNormalizedToSourceUv: z.array(z.array(z.number().finite()).length(3)).length(3),
    sourceCoordinateSystem: z.literal("pixel-top-left"),
    blenderUvCoordinateSystem: z.literal("normalized-bottom-left")
  }).strict(),
  quality: z.object({
    status: z.literal("aligned"),
    anchorCount: z.number().int().min(4),
    inlierCount: z.number().int().min(4),
    inlierRatio: z.number().finite().min(0).max(1),
    rmsePx: z.number().finite().nonnegative(),
    maxErrorPx: z.number().finite().nonnegative(),
    inlierErrorPx: z.number().finite().positive(),
    maxRmsePx: z.number().finite().positive(),
    minInlierRatio: z.number().finite().min(0.5).max(1),
    uncertaintyPx: z.object({ min: z.number().finite().nonnegative(), max: z.number().finite().nonnegative(), mean: z.number().finite().nonnegative() }).strict()
  }).strict(),
  provenance: z.object({ source: z.literal("explicit-operator-anchors"), deterministic: z.literal(true), localOnly: z.literal(true), telemetry: z.literal(false), fallbackUsed: z.literal(false) }).strict(),
  manifestHash: z.string().regex(/^[a-f0-9]{64}$/)
}).strict();

export type SourceProjectionManifest = z.infer<typeof SourceProjectionManifestSchema>;

export const SourceProjectionBlenderJobSchema = z.object({
  mode: z.literal("measurement_project"),
  operation: z.literal("source_projection"),
  sourceBlendPath: SourceProjectionInputSchema.shape.sourceBlendPath,
  outputReportPath: SourceProjectionInputSchema.shape.outputReportPath,
  alignment: SourceProjectionManifestSchema,
  executionPlacement: z.object({
    sourceOfTruth: z.literal("source-projection-contract"),
    controlPlane: z.literal("mcp-client"),
    heavyComputeRole: z.literal("blender-worker"),
    preferredGeography: z.literal("hetzner-ubuntu"),
    remoteExecutionRequiresExplicitSelection: z.literal(true),
    fallbackAllowed: z.literal(false),
    geometryMutationAllowed: z.literal(false)
  }).strict()
}).strict();

export type SourceProjectionBlenderJob = z.infer<typeof SourceProjectionBlenderJobSchema>;

export const SourceProjectionExecutionReportSchema = z.object({
  schemaVersion: z.literal(1),
  operation: z.literal("source_projection"),
  ok: z.literal(true),
  alignmentManifestHash: z.string().regex(/^[a-f0-9]{64}$/),
  sourcePhotoIdentity: z.object({ path: RelativePathSchema, sizeBytes: z.number().int().positive(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  sourceBlendPath: SourceProjectionInputSchema.shape.sourceBlendPath,
  projectedObject: z.string().min(1),
  hostElementId: SourceProjectionInputSchema.shape.target.shape.hostElementId,
  face: SourceProjectionInputSchema.shape.target.shape.face,
  selectedPolygonCount: z.number().int().positive(),
  roundTripVerified: z.literal(true),
  uvRange: z.object({ minU: z.number().min(0).max(1), maxU: z.number().min(0).max(1), minV: z.number().min(0).max(1), maxV: z.number().min(0).max(1) }).strict(),
  geometry: z.object({ sourceHashBefore: z.string().length(64), sourceHashAfter: z.string().length(64), projectedCopyHash: z.string().length(64), mutationDetected: z.literal(false) }).strict(),
  authority: SourceProjectionManifestSchema.shape.authority,
  executionPlacement: SourceProjectionBlenderJobSchema.shape.executionPlacement
}).strict().superRefine((report, ctx) => {
  if (report.geometry.sourceHashBefore !== report.geometry.sourceHashAfter || report.geometry.sourceHashBefore !== report.geometry.projectedCopyHash) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["geometry"], message: "Projection execution must preserve every geometry coordinate." });
  }
});

export type SourceProjectionExecutionReport = z.infer<typeof SourceProjectionExecutionReportSchema>;

export class SourceProjectionError extends Error {
  constructor(readonly code: "alignment_contract_invalid" | "alignment_degenerate" | "reprojection_threshold_exceeded" | "inlier_ratio_below_threshold", message: string) {
    super(message);
  }
}

export function buildSourceProjectionManifest(input: unknown): SourceProjectionManifest {
  const parsed = SourceProjectionInputSchema.parse(input);
  assertProjectionContract(parsed);
  const rows: number[][] = [];
  const values: number[] = [];
  for (const anchor of parsed.anchors) {
    const x = anchor.targetMm.x / parsed.target.widthMm;
    const y = anchor.targetMm.y / parsed.target.heightMm;
    const u = anchor.sourcePx.x / parsed.sourcePhoto.pixelWidth;
    const v = 1 - anchor.sourcePx.y / parsed.sourcePhoto.pixelHeight;
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y], [0, 0, 0, x, y, 1, -v * x, -v * y]);
    values.push(u, v);
  }
  const solved = solveLeastSquares(rows, values);
  const matrix = [solved.slice(0, 3), solved.slice(3, 6), [solved[6] ?? 0, solved[7] ?? 0, 1]].map((row) => row.map(round12));
  const errors = parsed.anchors.map((anchor) => reprojectionErrorPx(matrix, parsed, anchor));
  const inlierCount = errors.filter((error) => error <= parsed.thresholds.inlierErrorPx).length;
  const inlierRatio = inlierCount / errors.length;
  const maxErrorPx = Math.max(...errors);
  const rmsePx = Math.sqrt(errors.reduce((sum, error) => sum + error ** 2, 0) / errors.length);
  if (rmsePx > parsed.thresholds.maxRmsePx) {
    throw new SourceProjectionError("reprojection_threshold_exceeded", `Reprojection RMSE ${round6(rmsePx)}px exceeds ${parsed.thresholds.maxRmsePx}px.`);
  }
  if (inlierRatio < parsed.thresholds.minInlierRatio) {
    throw new SourceProjectionError("inlier_ratio_below_threshold", `Inlier ratio ${round6(inlierRatio)} is below ${parsed.thresholds.minInlierRatio}.`);
  }
  const uncertainties = parsed.anchors.map((anchor) => anchor.uncertaintyPx);
  const withoutHash: Omit<SourceProjectionManifest, "manifestHash"> = {
    schemaVersion: 1,
    method: "normalized-planar-homography-v1",
    authority: { visualEvidenceOnly: true, geometryAuthority: false, geometryMutationAllowed: false },
    sourcePhoto: parsed.sourcePhoto,
    target: parsed.target,
    anchors: parsed.anchors,
    transform: { targetNormalizedToSourceUv: matrix, sourceCoordinateSystem: "pixel-top-left", blenderUvCoordinateSystem: "normalized-bottom-left" },
    quality: { status: "aligned", anchorCount: parsed.anchors.length, inlierCount, inlierRatio: round6(inlierRatio), rmsePx: round6(rmsePx), maxErrorPx: round6(maxErrorPx), inlierErrorPx: parsed.thresholds.inlierErrorPx, maxRmsePx: parsed.thresholds.maxRmsePx, minInlierRatio: parsed.thresholds.minInlierRatio, uncertaintyPx: { min: round6(Math.min(...uncertainties)), max: round6(Math.max(...uncertainties)), mean: round6(uncertainties.reduce((sum, value) => sum + value, 0) / uncertainties.length) } },
    provenance: { source: "explicit-operator-anchors", deterministic: true, localOnly: true, telemetry: false, fallbackUsed: false }
  };
  return SourceProjectionManifestSchema.parse({ ...withoutHash, manifestHash: hashStable(withoutHash) });
}

export function buildSourceProjectionBlenderJob(input: SourceProjectionInput, alignment = buildSourceProjectionManifest(input)): SourceProjectionBlenderJob {
  return SourceProjectionBlenderJobSchema.parse({
    mode: "measurement_project",
    operation: "source_projection",
    sourceBlendPath: input.sourceBlendPath,
    outputReportPath: input.outputReportPath,
    alignment,
    executionPlacement: { sourceOfTruth: "source-projection-contract", controlPlane: "mcp-client", heavyComputeRole: "blender-worker", preferredGeography: "hetzner-ubuntu", remoteExecutionRequiresExplicitSelection: true, fallbackAllowed: false, geometryMutationAllowed: false }
  });
}

function solveLeastSquares(rows: number[][], values: number[]): number[] {
  const size = 8;
  const normal = Array.from({ length: size }, () => Array<number>(size).fill(0));
  const right = Array<number>(size).fill(0);
  rows.forEach((row, rowIndex) => {
    for (let column = 0; column < size; column += 1) {
      right[column] = (right[column] ?? 0) + (row[column] ?? 0) * (values[rowIndex] ?? 0);
      for (let other = 0; other < size; other += 1) normal[column][other] = (normal[column][other] ?? 0) + (row[column] ?? 0) * (row[other] ?? 0);
    }
  });
  for (let pivot = 0; pivot < size; pivot += 1) {
    let best = pivot;
    for (let row = pivot + 1; row < size; row += 1) if (Math.abs(normal[row][pivot] ?? 0) > Math.abs(normal[best][pivot] ?? 0)) best = row;
    if (Math.abs(normal[best][pivot] ?? 0) < 1e-10) throw new SourceProjectionError("alignment_degenerate", "Anchor geometry cannot determine a stable planar homography.");
    [normal[pivot], normal[best]] = [normal[best], normal[pivot]]; [right[pivot], right[best]] = [right[best] ?? 0, right[pivot] ?? 0];
    const divisor = normal[pivot][pivot] ?? 1;
    for (let column = pivot; column < size; column += 1) normal[pivot][column] = (normal[pivot][column] ?? 0) / divisor;
    right[pivot] = (right[pivot] ?? 0) / divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === pivot) continue;
      const factor = normal[row][pivot] ?? 0;
      for (let column = pivot; column < size; column += 1) normal[row][column] = (normal[row][column] ?? 0) - factor * (normal[pivot][column] ?? 0);
      right[row] = (right[row] ?? 0) - factor * (right[pivot] ?? 0);
    }
  }
  return right;
}

function reprojectionErrorPx(matrix: number[][], input: SourceProjectionInput, anchor: SourceProjectionInput["anchors"][number]): number {
  const x = anchor.targetMm.x / input.target.widthMm;
  const y = anchor.targetMm.y / input.target.heightMm;
  const denominator = (matrix[2]?.[0] ?? 0) * x + (matrix[2]?.[1] ?? 0) * y + (matrix[2]?.[2] ?? 1);
  if (Math.abs(denominator) < 1e-10) throw new SourceProjectionError("alignment_degenerate", "Homography maps an anchor to infinity.");
  const projectedX = (((matrix[0]?.[0] ?? 0) * x + (matrix[0]?.[1] ?? 0) * y + (matrix[0]?.[2] ?? 0)) / denominator) * input.sourcePhoto.pixelWidth;
  const projectedY = (1 - ((matrix[1]?.[0] ?? 0) * x + (matrix[1]?.[1] ?? 0) * y + (matrix[1]?.[2] ?? 0)) / denominator) * input.sourcePhoto.pixelHeight;
  return Math.hypot(projectedX - anchor.sourcePx.x, projectedY - anchor.sourcePx.y);
}

function hashStable(value: unknown): string { return createHash("sha256").update(stableJson(value)).digest("hex"); }
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  return JSON.stringify(value);
}
function round12(value: number): number { const rounded = Number(value.toFixed(12)); return Object.is(rounded, -0) ? 0 : rounded; }
function round6(value: number): number { return Number(value.toFixed(6)); }
