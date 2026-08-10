import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MeasurementProjectSchema } from "../src/measurementContracts.js";
import { qualityGate } from "../src/measurementTools.js";

const fixturePath = path.resolve("fixtures/synthetic-carport-project.json");

function loadFixture() {
  return MeasurementProjectSchema.parse(JSON.parse(readFileSync(fixturePath, "utf8")));
}

describe("MVP quality gates", () => {
  it("passes a complete synthetic facade-completion project", () => {
    const project = loadFixture();

    const result = qualityGate(project);

    expect(result).toEqual({ ok: true, blocking: [], warnings: [] });
  });

  it("fails when facade reference labels are incomplete", () => {
    const project = loadFixture();
    const result = qualityGate({ ...project, photos: project.photos.filter((photo) => photo.view !== "west") });

    expect(result.ok).toBe(false);
    expect(result.blocking).toContainEqual({
      code: "facade_reference_missing",
      message: "Missing facade reference labels for: west."
    });
  });

  it("fails when low-confidence assumptions affect geometry", () => {
    const project = loadFixture();
    const result = qualityGate({
      ...project,
      assumptions: [
        ...project.assumptions,
        {
          id: "unknown-roof-height",
          text: "Roof height guessed from a reference photo.",
          confidence: "low",
          source: "photo_reference",
          affectsGeometry: true
        }
      ]
    });

    expect(result.ok).toBe(false);
    expect(result.blocking).toContainEqual({
      code: "low_confidence_geometry_assumption",
      message: "Low-confidence assumptions affecting geometry must be resolved or explicitly upgraded before export."
    });
  });

  it("fails when validation is not passing", () => {
    const project = loadFixture();
    const result = qualityGate({ ...project, validation: { ...project.validation, ok: false } });

    expect(result.ok).toBe(false);
    expect(result.blocking).toContainEqual({
      code: "validation_failed",
      message: "Project validation is not passing."
    });
  });
});
