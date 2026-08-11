import path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { evaluateFacadeQaManifest } from "../src/facadeQa.js";
import { MeasurementProjectSchema } from "../src/measurementContracts.js";
import { hashSourceProject } from "../src/modelLock.js";

const modelHash = "a".repeat(64);

function project() {
  const base = MeasurementProjectSchema.parse({
    schemaVersion: 1,
    projectId: "qa-fixture",
    unit: "mm",
    modelLock: { locked: true, modelHash, sourceProjectHash: "b".repeat(64), modelArtifact: "models/locked.blend" }
  });
  return base;
}

function manifest() {
  const artifacts = Object.fromEntries(["north", "south", "east", "west"].map((view) => [`${view}Png`, `qa-fixture-${view}.png`]));
  return {
    modelLock: { modelHash },
    artifacts,
    artifactIdentities: Object.fromEntries(Object.entries(artifacts).map(([key, artifact]) => [key, { path: artifact, sha256: "c".repeat(64) }])),
    strategies: ["blender-orthographic-camera", "freestyle", "pdf-layout"],
    outputClassification: {
      purpose: "technical-permit-support",
      authority: "locked-blender-orthographic-line-artifacts",
      visualMode: "technical-line",
      photorealismAuthoritative: false,
      previewRenderAcceptedAsSourceOfTruth: false
    },
    geometryMutationAllowed: false
  };
}

async function evaluate(overrides: Record<string, unknown> = {}) {
  const value = project();
  const exportOutputDir = await mkdtemp(path.join(tmpdir(), "measured-facade-qa-"));
  const candidate = { ...manifest(), ...overrides };
  for (const artifactPath of Object.values(candidate.artifacts as Record<string, unknown>)) {
    if (typeof artifactPath === "string" && !artifactPath.includes("..") && !path.isAbsolute(artifactPath)) {
      await writeFile(path.join(exportOutputDir, artifactPath), "view", "utf8");
    }
  }
  return await evaluateFacadeQaManifest({
    manifest: candidate,
    project: value,
    requiredViews: ["north", "south", "east", "west"],
    exportOutputDir,
    sourceProjectHashBefore: hashSourceProject(value)
  });
}

describe("facade QA manifest gates", () => {
  it("accepts a locked, complete, path-safe, geometry-read-only manifest", async () => {
    expect(await evaluate()).toEqual({ ok: true, blocking: [], visualDiff: { requiredForContract: false, evaluated: false } });
  });

  it.each([
    [{ modelLock: {} }, "manifest_model_hash_missing"],
    [{ modelLock: { modelHash: "d".repeat(64) } }, "manifest_model_hash_mismatch"],
    [{ artifacts: { ...manifest().artifacts, northPng: undefined } }, "required_view_missing"],
    [{ artifactIdentities: {} }, "required_view_identity_missing"],
    [{ strategies: ["export-stage-geometry-reconstruction"] }, "export_geometry_strategy_prohibited"],
    [{ artifacts: { ...manifest().artifacts, northPng: "../escaped.png" } }, "output_path_unsafe"],
    [{ geometryMutationAllowed: true }, "geometry_mutation_declared"],
    [{ outputClassification: { purpose: "photorealistic-preview", authority: "preview-only" } }, "technical_output_classification_invalid"]
  ])("fails closed with machine-readable code %s", async (overrides, code) => {
    expect((await evaluate(overrides)).blocking.map((reason) => reason.code)).toContain(code);
  });

  it("detects project source mutation since the pre-export hash", async () => {
    const value = project();
    const exportOutputDir = await mkdtemp(path.join(tmpdir(), "measured-facade-qa-"));
    for (const artifactPath of Object.values(manifest().artifacts)) await writeFile(path.join(exportOutputDir, artifactPath), "view", "utf8");
    const result = await evaluateFacadeQaManifest({
      manifest: manifest(),
      project: { ...value, dimensions: [{ label: "mutated", valueMm: 1, confidence: "high", source: "permit_pdf" }] },
      requiredViews: ["north", "south", "east", "west"],
      exportOutputDir,
      sourceProjectHashBefore: hashSourceProject(value)
    });
    expect(result.blocking).toContainEqual({ code: "source_geometry_mutated", message: "Project source geometry changed during facade export." });
  });
});
