import { describe, expect, it } from "vitest";
import {
  assertNoProhibitedStrategy,
  assertTemplateSupported,
  CapabilityManifestSchema,
  DefaultCapabilityManifest,
  evaluateCapabilityExecution
} from "../src/capabilityManifest.js";

describe("capability manifest", () => {
  it("declares deterministic export capabilities", () => {
    const manifest = CapabilityManifestSchema.parse(DefaultCapabilityManifest);

    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.supportedTemplates).toContain("gothenburg-permit");
    expect(manifest.supportedTemplates).toContain("measured-digital-viewing");
    expect(manifest.allowedStrategies.viewGeneration).toEqual(["blender-orthographic-camera"]);
    expect(manifest.allowedStrategies.digitalViewingRender).toEqual([
      "locked-blender-source",
      "pbr-materials",
      "texture-map-application",
      "condition-overlays",
      "blender-camera",
      "blender-lighting",
      "render-manifest"
    ]);
    expect(manifest.prohibitedStrategies).toContain("export-stage-geometry-reconstruction");
    expect(manifest.prohibitedStrategies).toContain("photoreal-geometry-inference");
  });

  it("rejects unsupported templates", () => {
    expect(() => assertTemplateSupported(DefaultCapabilityManifest, "unknown-template")).toThrow("Unsupported export template");
  });

  it("rejects prohibited strategies", () => {
    expect(() => assertNoProhibitedStrategy(DefaultCapabilityManifest, ["manifest", "export-stage-geometry-reconstruction"])).toThrow("Prohibited export strategies requested");
  });

  it("allows a supported measured visualization export strategy set", () => {
    const result = evaluateCapabilityExecution(DefaultCapabilityManifest, {
      template: "gothenburg-permit",
      strategies: ["parametric-profile", "blender-orthographic-camera", "freestyle", "manifest", "pdf-layout", "svg-layout", "png-render"]
    });

    expect(result).toEqual({ ok: true, blocking: [], warnings: [] });
  });

  it("blocks unsupported templates with a machine-readable reason", () => {
    const result = evaluateCapabilityExecution(
      { ...DefaultCapabilityManifest, supportedTemplates: ["measured-visualization"] },
      {
        template: "gothenburg-permit",
        strategies: ["parametric-profile", "blender-orthographic-camera", "freestyle", "manifest"]
      }
    );

    expect(result.ok).toBe(false);
    expect(result.blocking).toContainEqual({
      code: "template_not_supported",
      message: "Export template is not supported by this capability manifest.",
      template: "gothenburg-permit"
    });
  });

  it("blocks prohibited export strategies with a machine-readable reason", () => {
    const result = evaluateCapabilityExecution(DefaultCapabilityManifest, {
      template: "gothenburg-permit",
      strategies: ["manifest", "export-stage-geometry-reconstruction"]
    });

    expect(result.ok).toBe(false);
    expect(result.blocking).toContainEqual({
      code: "strategy_prohibited",
      message: "Requested export strategy is explicitly prohibited by this capability manifest.",
      strategy: "export-stage-geometry-reconstruction"
    });
  });

  it("allows the measured digital viewing render strategy set", () => {
    const result = evaluateCapabilityExecution(DefaultCapabilityManifest, {
      template: "measured-digital-viewing",
      strategies: [
        "locked-blender-source",
        "pbr-materials",
        "texture-map-application",
        "condition-overlays",
        "blender-camera",
        "blender-lighting",
        "render-manifest"
      ]
    });

    expect(result).toEqual({ ok: true, blocking: [], warnings: [] });
  });
});
