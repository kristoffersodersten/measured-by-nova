import { describe, expect, it } from "vitest";
import { buildSourceProjectionBlenderJob, buildSourceProjectionManifest, SourceProjectionError, SourceProjectionInputSchema } from "../src/sourceProjection.js";

function input() {
  return {
    schemaVersion: 1 as const,
    projectId: "projection-proof",
    sourceBlendPath: "sources/projection-proof.locked.blend",
    outputBlendPath: "projections/projection-proof.projected.blend",
    outputReportPath: "projections/projection-proof.report.json",
    sourcePhoto: { path: "photos/facade.png", sizeBytes: 1024, sha256: "a".repeat(64), pixelWidth: 100, pixelHeight: 100 },
    target: { hostElementId: "Facade", face: "front" as const, widthMm: 1000, heightMm: 500, dimensionToleranceMm: 2 },
    anchors: [
      { id: "bottom-left", sourcePx: { x: 10, y: 90 }, targetMm: { x: 0, y: 0 }, uncertaintyPx: 0.25 },
      { id: "bottom-right", sourcePx: { x: 90, y: 90 }, targetMm: { x: 1000, y: 0 }, uncertaintyPx: 0.25 },
      { id: "top-right", sourcePx: { x: 90, y: 10 }, targetMm: { x: 1000, y: 500 }, uncertaintyPx: 0.5 },
      { id: "top-left", sourcePx: { x: 10, y: 10 }, targetMm: { x: 0, y: 500 }, uncertaintyPx: 0.5 }
    ],
    thresholds: { inlierErrorPx: 0.5, maxRmsePx: 0.5, minInlierRatio: 1 }
  };
}

describe("source-backed planar projection", () => {
  it("builds a deterministic, geometry-subordinate homography and Blender job", () => {
    const first = buildSourceProjectionManifest(input());
    const second = buildSourceProjectionManifest(input());
    expect(first).toEqual(second);
    expect(first.transform.targetNormalizedToSourceUv).toEqual([[0.8, 0, 0.1], [0, 0.8, 0.1], [0, 0, 1]]);
    expect(first.quality).toMatchObject({ status: "aligned", anchorCount: 4, inlierCount: 4, rmsePx: 0, maxErrorPx: 0 });
    expect(first.authority).toEqual({ visualEvidenceOnly: true, geometryAuthority: false, geometryMutationAllowed: false });
    expect(buildSourceProjectionBlenderJob(input(), first)).toMatchObject({ operation: "source_projection", alignment: { manifestHash: first.manifestHash }, executionPlacement: { fallbackAllowed: false, geometryMutationAllowed: false } });
  });

  it("rejects degenerate anchors and out-of-bounds paths, points, and source overwrite", () => {
    const degenerate = input();
    degenerate.anchors = degenerate.anchors.map((anchor, index) => ({ ...anchor, targetMm: { x: index * 100, y: 0 } }));
    expect(() => buildSourceProjectionManifest(degenerate)).toThrowError(SourceProjectionError);
    expect(() => buildSourceProjectionManifest({ ...input(), outputBlendPath: input().sourceBlendPath })).toThrow();
    expect(() => SourceProjectionInputSchema.parse({ ...input(), sourcePhoto: { ...input().sourcePhoto, path: "../private.png" } })).toThrow();
    const outside = input(); outside.anchors[0] = { ...outside.anchors[0], sourcePx: { x: 101, y: 90 } };
    expect(() => buildSourceProjectionManifest(outside)).toThrow();
  });

  it("fails closed when reprojection RMSE exceeds the declared threshold", () => {
    const noisy = input();
    noisy.anchors.push({ id: "center", sourcePx: { x: 80, y: 50 }, targetMm: { x: 500, y: 250 }, uncertaintyPx: 1 });
    noisy.thresholds = { inlierErrorPx: 1, maxRmsePx: 2, minInlierRatio: 0.5 };
    expect(() => buildSourceProjectionManifest(noisy)).toThrowError(SourceProjectionError);
  });

  it("fails closed when the inlier ratio is below policy even if RMSE budget permits it", () => {
    const noisy = input();
    noisy.anchors.push({ id: "center", sourcePx: { x: 70, y: 50 }, targetMm: { x: 500, y: 250 }, uncertaintyPx: 1 });
    noisy.thresholds = { inlierErrorPx: 0.01, maxRmsePx: 100, minInlierRatio: 0.9 };
    expect(() => buildSourceProjectionManifest(noisy)).toThrowError(SourceProjectionError);
  });
});
