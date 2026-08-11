import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { captureToFixture, RealCarportCaptureSchema } from "../src/captureToFixture.js";
import { qualityGate } from "../src/measurementTools.js";

function loadCapture(): unknown {
  return JSON.parse(readFileSync("fixtures/real-capture-carport-minimal.json", "utf8")) as unknown;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

describe("real capture to fixture pipeline", () => {
  it("maps verified real capture into the same measurement project contract", () => {
    const result = captureToFixture(loadCapture());

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected capture conversion to pass.");
    }
    expect(result.captureValidation).toMatchObject({ ok: true, blocking: [] });
    expect(result.project.projectId).toBe("real-carport-minimal");
    expect(result.project.photos).toHaveLength(4);
    expect(result.project.photos.every((photo) => photo.confidence === "low")).toBe(true);
    expect(result.project.materialNotes).toHaveLength(2);
    expect(result.project.facadeLevels.map((level) => level.facade)).toEqual(["north", "south", "east", "west"]);
    expect(result.project.openings).toContainEqual(expect.objectContaining({ hostElementId: "south-facade", openType: "open", confidence: "high" }));
    expect(result.project.elements).toContainEqual(expect.objectContaining({
      id: "measured-southwest-post",
      kind: "post",
      metadata: { captureContractV2: true, memberType: "post", role: "structural" }
    }));
    expect(result.project.elements).toContainEqual(expect.objectContaining({
      id: "measured-south-bar",
      kind: "beam",
      metadata: { captureContractV2: true, memberType: "bar", role: "decorative" }
    }));
    expect(result.project.steps).toContainEqual(expect.objectContaining({ id: "capture-step-1", confidence: "medium", facade: "south", direction: "south" }));
    expect(result.project.profiles[0]).toMatchObject({
      profile: "carport",
      confidence: "high",
      parameters: {
        widthMm: 7676,
        depthMm: 6240,
        roofSlopePercent: 3.7,
        westHighSideHeightMm: 3455,
        eastLowSideHeightMm: 3174
      }
    });
    expect(result.project.modelLock.locked).toBe(false);
    expect(qualityGate(result.project).ok).toBe(true);
  });

  it("is deterministic for identical real capture input", () => {
    const first = captureToFixture(loadCapture());
    const second = captureToFixture(loadCapture());

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(stableJson(second)).toBe(stableJson(first));
  });

  it("keeps photo evidence secondary and unable to alter measured geometry", () => {
    const capture = RealCarportCaptureSchema.parse(loadCapture());
    const first = captureToFixture(capture);
    const second = captureToFixture({
      ...capture,
      photos: capture.photos.map((photo) => ({ ...photo, path: `alternate/${photo.view}.jpg`, confidence: "medium" as const }))
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error("Expected verified captures to convert.");
    expect(stableJson(second.project.elements)).toBe(stableJson(first.project.elements));
    expect(stableJson(second.project.openings)).toBe(stableJson(first.project.openings));
    expect(second.project.photos.map((photo) => photo.path)).not.toEqual(first.project.photos.map((photo) => photo.path));
  });

  it("blocks unverified geometry before project creation", () => {
    const capture = RealCarportCaptureSchema.parse(loadCapture());
    const result = captureToFixture({
      ...capture,
      dimensions: {
        ...capture.dimensions,
        width: { ...capture.dimensions.width, verified: false }
      }
    });

    expect(result.ok).toBe(false);
    expect(result.captureValidation.blocking).toContainEqual({
      id: "width",
      code: "geometry_not_verified",
      message: "Geometry-impacting capture fields must be verified before export."
    });
  });

  it("blocks missing required facade photos before project creation", () => {
    const capture = RealCarportCaptureSchema.parse(loadCapture());
    const result = captureToFixture({
      ...capture,
      photos: capture.photos.filter((photo) => photo.view !== "west")
    });

    expect(result.ok).toBe(false);
    expect(result.captureValidation.blocking).toContainEqual({
      id: "photo-west",
      code: "required_capture_missing",
      message: "Required capture field is missing."
    });
  });

  it("blocks unverified foundation geometry before project creation", () => {
    const capture = RealCarportCaptureSchema.parse(loadCapture());
    const result = captureToFixture({
      ...capture,
      foundationHeights: {
        ...capture.foundationHeights,
        southwest: {
          ...capture.foundationHeights?.southwest,
          middle: { ...capture.foundationHeights?.southwest.middle, verified: false }
        }
      }
    });
    expect(result.ok).toBe(false);
    expect(result.captureValidation.blocking).toContainEqual({
      id: "foundation-southwest-middle",
      code: "geometry_not_verified",
      message: "Geometry-impacting capture fields must be verified before export."
    });
  });

  it.each([
    ["opening-south-drive-in", (capture: ReturnType<typeof RealCarportCaptureSchema.parse>) => ({
      ...capture,
      openings: capture.openings.map((opening) => ({ ...opening, verified: false }))
    })],
    ["member-measured-southwest-post", (capture: ReturnType<typeof RealCarportCaptureSchema.parse>) => ({
      ...capture,
      members: capture.members.map((member) => member.memberType === "post" ? { ...member, verified: false } : member)
    })],
    ["facade-west-top-level", (capture: ReturnType<typeof RealCarportCaptureSchema.parse>) => ({
      ...capture,
      facadeLevels: capture.facadeLevels.map((level) => level.facade === "west" ? { ...level, topLevel: { ...level.topLevel, verified: false } } : level)
    })]
  ])("blocks unverified capture v2 geometry %s", (id, mutate) => {
    const result = captureToFixture(mutate(RealCarportCaptureSchema.parse(loadCapture())));
    expect(result.ok).toBe(false);
    expect(result.captureValidation.blocking).toContainEqual({
      id,
      code: "geometry_not_verified",
      message: "Geometry-impacting capture fields must be verified before export."
    });
  });

  it("reports missing opening geometry as a UI-ready blocker", () => {
    const capture = RealCarportCaptureSchema.parse(loadCapture());
    const result = captureToFixture({ ...capture, openings: [] });
    expect(result.ok).toBe(false);
    expect(result.captureValidation.blocking).toContainEqual({
      id: "openings",
      code: "required_capture_missing",
      message: "Required capture field is missing."
    });
  });
});
