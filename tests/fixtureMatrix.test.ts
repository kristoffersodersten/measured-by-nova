import { readFileSync } from "node:fs";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { MeasurementProjectSchema, type MeasurementProject } from "../src/measurementContracts.js";
import { qualityGate } from "../src/measurementTools.js";

const FixtureMatrixSchema = z.object({
  schemaVersion: z.literal(1),
  matrixId: z.string(),
  cases: z.array(z.object({
    id: z.string(),
    projectPath: z.string(),
    mutations: z.array(z.record(z.unknown())).default([]),
    expected: z.object({
      ok: z.boolean(),
      reason: z.string()
    }).strict()
  }).strict()).min(1)
}).strict();

function loadJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function applyMutations(project: MeasurementProject, mutations: Array<Record<string, unknown>>): MeasurementProject {
  let next = project;
  for (const mutation of mutations) {
    if (mutation.type === "removePhotoView") {
      next = { ...next, photos: next.photos.filter((photo) => photo.view !== mutation.view) };
    } else if (mutation.type === "addAssumption") {
      next = MeasurementProjectSchema.parse({ ...next, assumptions: [...next.assumptions, mutation.assumption] });
    } else if (mutation.type === "setCarportRoofSlopePercent") {
      next = MeasurementProjectSchema.parse({
        ...next,
        profiles: next.profiles.map((profile) => profile.profile === "carport"
          ? { ...profile, parameters: { ...profile.parameters, roofSlopePercent: mutation.value } }
          : profile)
      });
    } else if (mutation.type === "setProjectId") {
      next = MeasurementProjectSchema.parse({ ...next, projectId: mutation.value });
    } else if (mutation.type === "setProfile") {
      next = MeasurementProjectSchema.parse({
        ...next,
        profiles: [{
          id: `profile-${String(mutation.profile)}`,
          profile: mutation.profile,
          confidence: "medium",
          parameters: {}
        }]
      });
    } else {
      throw new Error(`Unsupported fixture mutation: ${String(mutation.type)}`);
    }
  }
  return next;
}

describe("fixture matrix", () => {
  it("declares explicit expected outcomes for every fixture", () => {
    const matrix = FixtureMatrixSchema.parse(loadJson("fixtures/fixture-matrix.json"));

    expect(matrix.matrixId).toBe("measured-mvp-fixture-matrix-v1");
    expect(matrix.cases.map((fixture) => fixture.id)).toEqual([
      "synthetic-carport-basic",
      "synthetic-carport-missing-facade",
      "synthetic-carport-low-confidence-geometry",
      "synthetic-carport-extreme-roof-slope",
      "synthetic-shed-basic"
    ]);
  });

  it("matches expected quality gate outcomes", () => {
    const matrix = FixtureMatrixSchema.parse(loadJson("fixtures/fixture-matrix.json"));

    for (const fixture of matrix.cases) {
      const baseProject = MeasurementProjectSchema.parse(loadJson(fixture.projectPath));
      const project = applyMutations(baseProject, fixture.mutations);
      const result = qualityGate(project);

      expect(result.ok, `${fixture.id}: ${fixture.expected.reason}`).toBe(fixture.expected.ok);
    }
  });
});
