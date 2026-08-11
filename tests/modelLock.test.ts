import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MeasurementProjectSchema } from "../src/measurementContracts.js";
import { buildModelLock, validateModelLock } from "../src/modelLock.js";

async function lockedFixture() {
  const outputDir = await mkdtemp(path.join(tmpdir(), "nova-model-lock-"));
  const modelArtifact = "measurement-projects/fixture/artifacts/fixture.blend";
  await mkdir(path.dirname(path.join(outputDir, modelArtifact)), { recursive: true });
  await writeFile(path.join(outputDir, modelArtifact), "reviewed blender bytes");
  const project = MeasurementProjectSchema.parse({
    schemaVersion: 1,
    projectId: "fixture",
    unit: "mm",
    dimensions: [{ label: "width", valueMm: 1000, confidence: "high", source: "manual_measurement" }],
    artifacts: { blend: modelArtifact }
  });
  const modelLock = await buildModelLock({ outputDir, timeoutMs: 120_000 }, project, {
    lockedAt: "2026-08-11T07:00:00.000Z",
    lockedBy: "reviewer",
    reason: "Reviewed"
  });
  return { outputDir, project: { ...project, modelLock }, modelArtifact };
}

describe("reviewed Blender model lock", () => {
  it("validates unchanged project source and Blender content", async () => {
    const fixture = await lockedFixture();
    expect(await validateModelLock({ outputDir: fixture.outputDir, timeoutMs: 120_000 }, fixture.project)).toEqual({ ok: true, blocking: [] });
    expect(fixture.project.modelLock.modelHash).toHaveLength(64);
    expect(fixture.project.modelLock.sourceProjectHash).toHaveLength(64);
  });

  it("fails closed when project geometry source changes", async () => {
    const fixture = await lockedFixture();
    const mutated = { ...fixture.project, dimensions: [{ ...fixture.project.dimensions[0], valueMm: 1001 }] };
    const result = await validateModelLock({ outputDir: fixture.outputDir, timeoutMs: 120_000 }, mutated);
    expect(result.blocking.map((reason) => reason.code)).toEqual(["source_project_mutated"]);
  });

  it("fails closed when reviewed Blender content changes", async () => {
    const fixture = await lockedFixture();
    await writeFile(path.join(fixture.outputDir, fixture.modelArtifact), "mutated blender bytes");
    const result = await validateModelLock({ outputDir: fixture.outputDir, timeoutMs: 120_000 }, fixture.project);
    expect(result.blocking.map((reason) => reason.code)).toEqual(["locked_model_mutated"]);
  });
});
