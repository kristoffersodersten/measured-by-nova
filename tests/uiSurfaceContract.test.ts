import { describe, expect, it } from "vitest";
import { buildMeasuredUiSurface } from "../src/uiSurfaceContract.js";

function surface() {
  return {
    schemaVersion: 1,
    designDoctrine: { system: "MUE", nativeFirst: true, gridBasePx: 8, subgridPx: 4, motionDurationMs: 120, decorativeStatesAllowed: false },
    panels: [
      { id: "capture-contract", title: "Capture Contract", order: 1, states: [
        { id: "capture", label: "Capture complete", topology: "system", status: "ready", confidence: "high", provenance: "signed-capture-package", operatorApprovalRequired: false },
        { id: "validation", label: "Validation passed", topology: "execution", status: "ready", provenance: "capture-contract-v2", operatorApprovalRequired: false }
      ] },
      { id: "model-review", title: "Model Review", order: 2, states: [
        { id: "blender", label: "Blender idle", topology: "infrastructure", status: "ready", provenance: "local-blender", operatorApprovalRequired: false },
        { id: "model-lock", label: "Operator lock required", topology: "human-intervention", status: "review-required", provenance: "model-lock-contract", operatorApprovalRequired: true }
      ] },
      { id: "export-delivery", title: "Export / Delivery", order: 3, states: [
        { id: "preview", label: "Photorealistic preview - not verified truth", topology: "execution", status: "pending", confidence: "medium", provenance: "preview-render-manifest", operatorApprovalRequired: false }
      ] }
    ],
    environmentTruth: {
      provider: "local Blender",
      engine: "Blender",
      endpoint: "local-process",
      executionGeography: "local",
      owner: "user-local-runtime",
      costClass: "local-compute",
      latencyClass: "long-running",
      fallbackUsed: false,
      dataScope: ["project-json", "photos", "textures", "blend", "exports"],
      privacyBoundary: "user-owned-hardware",
      operatorApprovalRequired: true,
      auditNotes: []
    },
    outputTruth: {
      technicalLabel: "Verified technical output",
      previewLabel: "Photorealistic preview - not verified truth",
      previewPermitAuthority: false,
      previewGeometryAuthority: false
    },
    manualOverrideAvailable: true
  };
}

describe("Measured UI surface contract", () => {
  it("builds the ordered three-panel MUE and Environment Truth surface", () => {
    const result = buildMeasuredUiSurface(surface());
    expect(result.panels.map((panel) => panel.id)).toEqual(["capture-contract", "model-review", "export-delivery"]);
    expect(result.outputTruth.previewLabel).toContain("not verified truth");
    expect(result.environmentTruth).toMatchObject({ executionGeography: "local", costClass: "local-compute", fallbackUsed: false });
  });

  it.each([
    ["hidden fallback", { environmentTruth: { ...surface().environmentTruth, fallbackUsed: true } }],
    ["unknown cost", { environmentTruth: { ...surface().environmentTruth, costClass: "unknown" } }],
    ["missing topology", { panels: surface().panels.map((panel) => ({ ...panel, states: panel.states.filter((state) => state.topology !== "human-intervention") })) }],
    ["misordered panels", { panels: [surface().panels[1], surface().panels[0], surface().panels[2]] }],
    ["hidden preview label", { outputTruth: { ...surface().outputTruth, previewLabel: "Photorealistic preview - not verified truth" }, panels: surface().panels.map((panel) => ({ ...panel, states: panel.states.map((state) => state.id === "preview" ? { ...state, label: "Render ready" } : state) })) }]
  ])("rejects %s", (_name, override) => {
    expect(() => buildMeasuredUiSurface({ ...surface(), ...override })).toThrow();
  });

  it("rejects hidden blocker causes and implicit operator approval", () => {
    const blocked = surface();
    blocked.panels[0]?.states.push({ id: "missing-measurement", label: "Measurement missing", topology: "human-intervention", status: "blocked", operatorApprovalRequired: false } as never);
    expect(() => buildMeasuredUiSurface(blocked)).toThrow();

    const review = surface();
    if (review.panels[1]?.states[1]) review.panels[1].states[1].operatorApprovalRequired = false;
    expect(() => buildMeasuredUiSurface(review)).toThrow();
  });

  it("rejects more than five simultaneous visible states", () => {
    const crowded = surface();
    crowded.panels[2]?.states.push({ id: "extra", label: "Extra state", topology: "execution", status: "pending", provenance: "test", operatorApprovalRequired: false });
    expect(() => buildMeasuredUiSurface(crowded)).toThrow();
  });
});
