import { describe, expect, it } from "vitest";
import { CarportProfileParametersSchema, CreateMeasurementProjectSchema, ExportFacadeCompletionPackSchema, ExportProjectTemplateSchema, ImportReferencePhotosSchema, MeasurementProjectSchema, UnsafeRunPythonSchema } from "../src/measurementContracts.js";

const fixture = {
  widthMm: 7676,
  depthMm: 6240,
  roofSlopePercent: 3.7,
  westHighSideHeightMm: 3455,
  eastLowSideHeightMm: 3174,
  foundationHeights: {
    southwest: { roadSideMm: 0, middleMm: 685, innerMm: 695 },
    northeast: { outerTowardRoadMm: 530, middleMm: 500, innerMm: 630 }
  },
  steps: [{ stepDepthMm: 295, stepHeightMm: 140, count: 3, locationHint: "entrance/platform" }],
  neighborBoundary: { from: "outermost_southwest_post", distanceMm: 7692 }
};

describe("measurement contracts", () => {
  it("accepts the carport fixture", () => {
    expect(CarportProfileParametersSchema.parse(fixture).widthMm).toBe(7676);
  });

  it("rejects unknown fields", () => {
    expect(() => CreateMeasurementProjectSchema.parse({ projectId: "x", unit: "mm", extra: true })).toThrow();
  });

  it("rejects escaping photo paths", () => {
    expect(() => ImportReferencePhotosSchema.parse({ projectId: "x", photos: [{ path: "../secret.jpeg" }] })).toThrow();
  });

  it("requires explicit unsafe opt-in", () => {
    expect(() => UnsafeRunPythonSchema.parse({ code: "print('x')" })).toThrow();
    expect(UnsafeRunPythonSchema.parse({ code: "print('x')", unsafeAllowExecution: true }).unsafeAllowExecution).toBe(true);
  });

  it("accepts recipient-specific export templates", () => {
    const result = ExportProjectTemplateSchema.parse({
      projectId: "carport-fixture",
      template: "gothenburg-permit"
    });

    expect(result.template).toBe("gothenburg-permit");
    expect(result.options).toEqual({});
  });

  it("keeps cad-simulated only as a legacy export template", () => {
    const result = ExportProjectTemplateSchema.parse({
      projectId: "carport-fixture",
      template: "cad-simulated"
    });

    expect(result.template).toBe("cad-simulated");
  });

  it("defaults source-of-truth policy for measurement projects", () => {
    const project = MeasurementProjectSchema.parse({ schemaVersion: 1, projectId: "x", unit: "mm" });

    expect(project.sourceOfTruthPolicy).toMatchObject({
      measurementModel: "explicit_measurements_and_constraints",
      photos: "non_authoritative_reference_only",
      blenderGeometry: "only_renderable_geometry_truth",
      exportStage: "formatting_only_no_geometry_reconstruction",
      llmRole: "optional_orchestration_never_authoritative",
      nonGoal: "not_cad_not_bim_not_survey"
    });
  });

  it("defaults new projects to unlocked exports and empty assumptions", () => {
    const project = MeasurementProjectSchema.parse({ schemaVersion: 1, projectId: "x", unit: "mm" });

    expect(project.modelLock).toEqual({ locked: false });
    expect(project.assumptions).toEqual([]);
  });

  it("accepts the primary facade completion export contract", () => {
    const result = ExportFacadeCompletionPackSchema.parse({ projectId: "carport-fixture" });

    expect(result.template).toBe("permit-facade-pack");
    expect(result.views).toEqual(["north", "south", "east", "west"]);
    expect(result.scale).toBe("1:100");
  });

  it("requires exactly four standard facade views for facade completion export", () => {
    expect(() => ExportFacadeCompletionPackSchema.parse({
      projectId: "carport-fixture",
      views: ["north", "south", "east"]
    })).toThrow();
  });
});
