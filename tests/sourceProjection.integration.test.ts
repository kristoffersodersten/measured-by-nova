import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { runBlenderJob } from "../src/blenderRunner.js";
import { buildSourceProjectionBlenderJob, buildSourceProjectionManifest, SourceProjectionExecutionReportSchema, type SourceProjectionInput } from "../src/sourceProjection.js";

describe("source projection Blender runtime", () => {
  it("persists an exact photo projection without changing geometry and fails closed on drift", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "nova-source-projection-"));
    const config = { outputDir, timeoutMs: 120_000 };
    const sourceBlendPath = "sources/projection-proof.locked.blend";
    const source = await runBlenderJob(config, {
      mode: "measurement_project",
      operation: "generate_model",
      project: {
        projectId: "projection-proof",
        elements: [{ id: "Facade", kind: "panel", boundsMm: { x: 0, y: 0, z: 0, width: 1000, depth: 100, height: 500 }, confidence: "high", source: "measurement" }]
      }
    }, sourceBlendPath);
    expect(source.ok, source.stderr).toBe(true);

    const photo = pngWithDimensions(100, 100);
    const photoPath = "photos/facade.png";
    await mkdir(path.join(outputDir, "photos"), { recursive: true });
    await writeFile(path.join(outputDir, photoPath), photo);
    const projectionInput = input(sourceBlendPath, photoPath, photo);
    const alignment = buildSourceProjectionManifest(projectionInput);
    const projected = await runBlenderJob(config, buildSourceProjectionBlenderJob(projectionInput, alignment), projectionInput.outputBlendPath);
    expect(projected.ok, projected.stderr).toBe(true);
    const report = SourceProjectionExecutionReportSchema.parse(JSON.parse(await readFile(path.join(outputDir, projectionInput.outputReportPath), "utf8")));
    expect(report).toMatchObject({ ok: true, roundTripVerified: true, sourcePhotoPacked: true, alignmentManifestHash: alignment.manifestHash, hostElementId: "Facade", face: "front", selectedPolygonCount: 1, uvRange: { minU: 0.1, maxU: 0.9, minV: 0.1, maxV: 0.9 }, geometry: { mutationDetected: false } });
    expect(report.geometry.sourceHashBefore).toBe(report.geometry.sourceHashAfter);
    expect(report.geometry.sourceHashBefore).toBe(report.geometry.projectedCopyHash);
    expect((await readdir(path.join(outputDir, "projections"))).some((entry) => entry.includes("validation.blend"))).toBe(false);

    await writeFile(path.join(outputDir, photoPath), Buffer.concat([photo, Buffer.from("tampered")]));
    const driftInput = { ...projectionInput, outputBlendPath: "projections/drift.blend", outputReportPath: "projections/drift.json" };
    const drifted = await runBlenderJob(config, buildSourceProjectionBlenderJob(driftInput, alignment), driftInput.outputBlendPath);
    expect(drifted.ok).toBe(false);
    expect(drifted.stderr).toContain("Source projection photo identity mismatch");
    expect(await exists(path.join(outputDir, driftInput.outputBlendPath))).toBe(false);
    expect(await exists(path.join(outputDir, driftInput.outputReportPath))).toBe(false);

    await writeFile(path.join(outputDir, photoPath), photo);
    const dimensionInput = input(sourceBlendPath, photoPath, photo, 900);
    dimensionInput.outputBlendPath = "projections/dimension-mismatch.blend";
    dimensionInput.outputReportPath = "projections/dimension-mismatch.json";
    const dimensionAlignment = buildSourceProjectionManifest(dimensionInput);
    const mismatched = await runBlenderJob(config, buildSourceProjectionBlenderJob(dimensionInput, dimensionAlignment), dimensionInput.outputBlendPath);
    expect(mismatched.ok).toBe(false);
    expect(mismatched.stderr).toContain("Source projection target dimensions mismatch");
    expect(await exists(path.join(outputDir, dimensionInput.outputBlendPath))).toBe(false);
    expect(await exists(path.join(outputDir, dimensionInput.outputReportPath))).toBe(false);
  }, 120_000);
});

function input(sourceBlendPath: string, photoPath: string, photo: Buffer, widthMm = 1000): SourceProjectionInput {
  return {
    schemaVersion: 1,
    projectId: "projection-proof",
    sourceBlendPath,
    outputBlendPath: "projections/projection-proof.projected.blend",
    outputReportPath: "projections/projection-proof.report.json",
    sourcePhoto: { path: photoPath, sizeBytes: photo.byteLength, sha256: createHash("sha256").update(photo).digest("hex"), pixelWidth: 100, pixelHeight: 100 },
    target: { hostElementId: "Facade", face: "front", widthMm, heightMm: 500, dimensionToleranceMm: 2 },
    anchors: [
      { id: "bottom-left", sourcePx: { x: 10, y: 90 }, targetMm: { x: 0, y: 0 }, uncertaintyPx: 0.25 },
      { id: "bottom-right", sourcePx: { x: 90, y: 90 }, targetMm: { x: widthMm, y: 0 }, uncertaintyPx: 0.25 },
      { id: "top-right", sourcePx: { x: 90, y: 10 }, targetMm: { x: widthMm, y: 500 }, uncertaintyPx: 0.5 },
      { id: "top-left", sourcePx: { x: 10, y: 10 }, targetMm: { x: 0, y: 500 }, uncertaintyPx: 0.5 }
    ],
    thresholds: { inlierErrorPx: 0.5, maxRmsePx: 0.5, minInlierRatio: 1 }
  };
}

function pngWithDimensions(width: number, height: number): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const row = Buffer.alloc(1 + width * 4, 0xff); row[0] = 0;
  return Buffer.concat([signature, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))), chunk("IEND", Buffer.alloc(0))]);
}

function chunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type, "ascii"); const length = Buffer.alloc(4); length.writeUInt32BE(data.length); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}

async function exists(filePath: string): Promise<boolean> { try { return (await stat(filePath)).isFile(); } catch { return false; } }
