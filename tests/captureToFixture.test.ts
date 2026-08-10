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
});
