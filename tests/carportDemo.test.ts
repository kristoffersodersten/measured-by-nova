import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CarportDemoManifestSchema, identifyDemoArtifact, serializeCarportDemoManifest } from "../src/demoManifest.js";
import { RealCarportCaptureSchema } from "../src/captureToFixture.js";
import { buildMissingWidthCapture, parseDemoArguments } from "../scripts/run-carport-demo.js";

describe("carport premium demo support", () => {
  it("parses explicit reset, Blender, and output options", () => {
    const result = parseDemoArguments(["--", "--prepare", "--reset", "--output-dir", "demo-output", "--blender", "runtime/blender"]);
    expect(result).toEqual({ reset: true, phase: "prepare", outputDir: path.resolve("demo-output"), blenderPath: path.resolve("runtime/blender"), reviewConfirmed: false });
  });

  it("requires an explicit human review attestation", () => {
    expect(() => parseDemoArguments(["--deliver", "--reviewed-by", "Kristoffer"])).toThrow("human_review_confirmation_required");
    expect(() => parseDemoArguments(["--deliver", "--confirm-reviewed-generated-blend"])).toThrow("reviewer_required");
    expect(parseDemoArguments(["--deliver", "--reviewed-by", "Kristoffer", "--confirm-reviewed-generated-blend"])).toMatchObject({ phase: "deliver", reviewedBy: "Kristoffer", reviewConfirmed: true });
  });

  it("creates the intended fail-closed capture without changing the measured value", async () => {
    const capture = RealCarportCaptureSchema.parse(JSON.parse(await readFile("fixtures/real-capture-carport-minimal.json", "utf8")));
    const negative = RealCarportCaptureSchema.parse(buildMissingWidthCapture(capture));
    expect(negative.dimensions.width.valueMm).toBe(7676);
    expect(negative.dimensions.width.verified).toBe(false);
    expect(capture.dimensions.width.verified).toBe(true);
  });

  it("identifies artifacts and serializes a strict manifest", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "nova-carport-demo-"));
    await mkdir(path.join(outputDir, "delivery"));
    await writeFile(path.join(outputDir, "delivery", "model.glb"), Buffer.from("glTFdemo"));
    const artifact = await identifyDemoArtifact(outputDir, "portable-glb", "delivery/model.glb");
    const hash = "a".repeat(64);
    const gitSha = "b".repeat(40);
    const manifest = CarportDemoManifestSchema.parse({
      schemaVersion: 1,
      manifestType: "measured-carport-premium-demo",
      createdAt: "2026-10-19T00:00:00.000Z",
      source: { sourceSha: gitSha, legalBaseSha: gitSha, legalBaseIncluded: true, unauthorizedSignerCommitIncluded: false, unauthorizedSignerToolExposed: false },
      fixture: { path: "fixtures/real-capture-carport-minimal.json", sha256: hash, captureId: "capture", projectId: "project" },
      failClosedProof: { attemptedField: "dimensions.width", expectedErrorCode: "capture_contract_failed", observedErrorCode: "capture_contract_failed", blockerId: "width", recoverySucceeded: true },
      humanReview: { reviewer: "Kristoffer", confirmation: "reviewed-generated-blend-before-lock" },
      modelLock: { artifact: "delivery/model.blend", modelHash: hash, sourceProjectHash: hash },
      runtime: { node: "v20", pnpm: "10", blender: "Blender 4", platform: "linux", arch: "x64" },
      execution: { locality: "local-only", telemetry: false, fallback: "none", geometryMutation: false },
      timingsMs: { total: 1 },
      artifacts: [artifact]
    });
    expect(artifact.sha256).toBe(createHash("sha256").update("glTFdemo").digest("hex"));
    expect(JSON.parse(serializeCarportDemoManifest(manifest))).toEqual(manifest);
  });
});