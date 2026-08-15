import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import {
  buildDigitalViewingDeliveryPackageManifest,
  buildDigitalViewingRenderManifest,
  DigitalViewingCaptureSchema,
  serializeDigitalViewingDeliveryPackageManifest,
  validateDigitalViewingCapture
} from "../src/digitalViewingContracts.js";
import { evaluatePerformanceEvidence, PerformanceEvidenceSchema } from "../src/performanceEvidence.js";
import { buildSourceProjectionManifest } from "../src/sourceProjection.js";

const samples = 50;
const outputArgument = process.argv[2] ?? "evidence/performance.json";
const outputPath = resolve(outputArgument);
const allowedRoot = resolve("evidence");
const outputRelative = relative(allowedRoot, outputPath);
if (outputRelative.startsWith("..") || outputRelative === "" || outputRelative.includes("/../")) {
  throw new Error("performance_output_path_outside_evidence_root");
}

const commit = process.env.GITHUB_SHA ?? process.env.MEASURED_COMMIT;
if (!commit) throw new Error("performance_commit_identity_missing");
const checkoutCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (checkoutCommit !== commit) throw new Error("performance_commit_identity_mismatch");
const worktreeState = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { encoding: "utf8" }).trim();
if (worktreeState !== "") throw new Error("performance_worktree_not_clean");

const capture = DigitalViewingCaptureSchema.parse(JSON.parse(await readFile("fixtures/digital-viewing-vehicle-capture.json", "utf8")));
const preset = {
  presetId: "vehicle-performance-preview",
  deliveryTier: "premium-sales",
  renderer: "cycles",
  resolution: { width: 1600, height: 1000 },
  camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
  lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 1 },
  outputPath: "renders/vehicle-performance.png"
};
const sourceProjectionInput = {
  schemaVersion: 1 as const, projectId: "benchmark", sourceBlendPath: "sources/benchmark.locked.blend", outputBlendPath: "projections/benchmark.blend", outputReportPath: "projections/benchmark.json",
  sourcePhoto: { path: "photos/benchmark.png", sizeBytes: 1024, sha256: "a".repeat(64), pixelWidth: 4000, pixelHeight: 3000 },
  target: { hostElementId: "BenchmarkSurface", face: "front" as const, widthMm: 2000, heightMm: 1000, dimensionToleranceMm: 2 },
  anchors: [
    { id: "a", sourcePx: { x: 200, y: 2800 }, targetMm: { x: 0, y: 0 }, uncertaintyPx: 0.25 },
    { id: "b", sourcePx: { x: 3800, y: 2800 }, targetMm: { x: 2000, y: 0 }, uncertaintyPx: 0.25 },
    { id: "c", sourcePx: { x: 3800, y: 200 }, targetMm: { x: 2000, y: 1000 }, uncertaintyPx: 0.25 },
    { id: "d", sourcePx: { x: 200, y: 200 }, targetMm: { x: 0, y: 1000 }, uncertaintyPx: 0.25 }
  ], thresholds: { inlierErrorPx: 0.5, maxRmsePx: 0.5, minInlierRatio: 1 }
};

function measure(operation: () => void): { samples: number; p95Ms: number } {
  const values: number[] = [];
  for (let index = 0; index < samples; index += 1) {
    const startedAt = performance.now();
    operation();
    values.push(performance.now() - startedAt);
  }
  values.sort((left, right) => left - right);
  return { samples, p95Ms: Number(values[Math.ceil(values.length * 0.95) - 1].toFixed(3)) };
}

for (let index = 0; index < 10; index += 1) validateDigitalViewingCapture(capture);
for (let index = 0; index < 10; index += 1) buildSourceProjectionManifest(sourceProjectionInput);
const warmedRenderManifest = buildDigitalViewingRenderManifest(capture, preset);
for (let index = 0; index < 10; index += 1) {
  buildDigitalViewingRenderManifest(capture, preset);
  buildDigitalViewingDeliveryPackageManifest(capture, warmedRenderManifest);
}
const rssBefore = process.memoryUsage().rss;
const captureValidation = measure(() => validateDigitalViewingCapture(capture));
const renderManifest = buildDigitalViewingRenderManifest(capture, preset);
const renderManifestMetric = measure(() => buildDigitalViewingRenderManifest(capture, preset));
const packageManifest = buildDigitalViewingDeliveryPackageManifest(capture, renderManifest);
const packageManifestMetric = measure(() => buildDigitalViewingDeliveryPackageManifest(capture, renderManifest));
const sourceProjectionAlignment = measure(() => buildSourceProjectionManifest(sourceProjectionInput));
const serializedPackage = serializeDigitalViewingDeliveryPackageManifest(packageManifest);
const rssDeltaBytes = Math.max(0, process.memoryUsage().rss - rssBefore);
const blenderRuntime = process.env.MEASURED_BLENDER_RUNTIME_MS;
if (!blenderRuntime) throw new Error("performance_blender_runtime_missing");

const evidence = evaluatePerformanceEvidence(commit, {
  captureValidation,
  renderManifest: renderManifestMetric,
  packageManifest: packageManifestMetric,
  sourceProjectionAlignment,
  rssDeltaBytes,
  packageBytes: Buffer.byteLength(serializedPackage),
  blenderRuntimeMs: Number(blenderRuntime)
});

PerformanceEvidenceSchema.parse(evidence);
const temporaryPath = `${outputPath}.tmp-${process.pid}`;
try {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(temporaryPath, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  await rename(temporaryPath, outputPath);
} catch (error) {
  await rm(temporaryPath, { force: true });
  throw error;
}

process.stdout.write(`${JSON.stringify(evidence)}\n`);
if (!evidence.ok) process.exitCode = 1;
