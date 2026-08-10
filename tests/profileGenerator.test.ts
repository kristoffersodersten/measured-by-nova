import { describe, expect, it } from "vitest";
import { materializeProfiles } from "../src/profileGenerator.js";
import { MeasurementProjectSchema } from "../src/measurementContracts.js";

const project = MeasurementProjectSchema.parse({
  schemaVersion: 1,
  projectId: "carport-fixture",
  unit: "mm",
  photos: [],
  dimensions: [],
  planes: [],
  elements: [],
  openings: [],
  steps: [],
  profiles: [{
    id: "profile-carport",
    profile: "carport",
    confidence: "high",
    parameters: { widthMm: 7676, depthMm: 6240, roofSlopePercent: 3.7, westHighSideHeightMm: 3455, eastLowSideHeightMm: 3174, steps: [], claddingDirection: "horizontal" }
  }],
  validation: { ok: true, checks: [], warnings: [] },
  artifacts: {}
});

describe("profile generator", () => {
  it("generates carport extents and roof metadata", () => {
    const generated = materializeProfiles(project);
    const roof = generated.elements.find((element) => element.id === "roof");
    expect(roof?.boundsMm.width).toBe(7676);
    expect(roof?.boundsMm.depth).toBe(6240);
    expect(roof?.metadata).toMatchObject({ highSideHeightMm: 3455, lowSideHeightMm: 3174 });
  });

  it("extends carport stairs to the measured southwest foundation height", () => {
    const generated = materializeProfiles({
      ...project,
      profiles: [{
        id: "profile-carport",
        profile: "carport",
        confidence: "high",
        parameters: {
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
          claddingDirection: "horizontal"
        }
      }]
    });
    const stairs = generated.elements.find((element) => element.id === "steps-1");
    expect(stairs?.boundsMm.height).toBe(695);
    expect(stairs?.metadata).toMatchObject({ count: 5, totalHeightMm: 695 });
  });

  it("adds a measured rear foundation wall from the northeast constraints", () => {
    const generated = materializeProfiles({
      ...project,
      profiles: [{
        id: "profile-carport",
        profile: "carport",
        confidence: "high",
        parameters: {
          widthMm: 7676,
          depthMm: 6240,
          roofSlopePercent: 3.7,
          westHighSideHeightMm: 3455,
          eastLowSideHeightMm: 3174,
          foundationHeights: {
            southwest: { roadSideMm: 0, middleMm: 685, innerMm: 695 },
            northeast: { outerTowardRoadMm: 530, middleMm: 500, innerMm: 630 }
          },
          steps: [],
          claddingDirection: "horizontal"
        }
      }]
    });
    const rear = generated.elements.find((element) => element.id === "foundation-rear");
    expect(rear?.boundsMm.y).toBe(6060);
    expect(rear?.boundsMm.height).toBe(630);
    expect(rear?.metadata).toMatchObject({ facade: "rear", innerMm: 630 });
  });

  it("creates connected foundation walls without side overlap through corners", () => {
    const generated = materializeProfiles({
      ...project,
      profiles: [{
        id: "profile-carport",
        profile: "carport",
        confidence: "high",
        parameters: {
          widthMm: 7676,
          depthMm: 6240,
          roofSlopePercent: 3.7,
          westHighSideHeightMm: 3455,
          eastLowSideHeightMm: 3174,
          foundationHeights: {
            southwest: { roadSideMm: 0, middleMm: 685, innerMm: 695 },
            northeast: { outerTowardRoadMm: 530, middleMm: 500, innerMm: 630 }
          },
          steps: [],
          claddingDirection: "horizontal"
        }
      }]
    });
    const west = generated.elements.find((element) => element.id === "foundation-west-side");
    const east = generated.elements.find((element) => element.id === "foundation-northeast");
    expect(west?.boundsMm.y).toBe(180);
    expect(east?.boundsMm.y).toBe(180);
    expect(west?.boundsMm.depth).toBe(5880);
    expect(east?.boundsMm.depth).toBe(5880);
  });

  it("adds wood panels only where facade photos show wood, leaving openings as gaps", () => {
    const generated = materializeProfiles({
      ...project,
      profiles: [{
        id: "profile-carport",
        profile: "carport",
        confidence: "high",
        parameters: {
          widthMm: 7676,
          depthMm: 6240,
          roofSlopePercent: 3.7,
          westHighSideHeightMm: 3455,
          eastLowSideHeightMm: 3174,
          foundationHeights: {
            southwest: { roadSideMm: 0, middleMm: 685, innerMm: 695 },
            northeast: { outerTowardRoadMm: 530, middleMm: 500, innerMm: 630 }
          },
          steps: [],
          claddingDirection: "horizontal"
        }
      }]
    });
    const panels = generated.elements.filter((element) => element.kind === "panel");
    expect(panels.map((panel) => panel.id)).toEqual(expect.arrayContaining([
      "southwest-left-low-panel",
      "southwest-right-low-panel",
      "northeast-full-height-panel"
    ]));
    expect(panels).toHaveLength(3);
    expect(panels.every((panel) => panel.metadata.material === "white-painted-wood")).toBe(true);
  });

  it("keeps southwest front drive-in open and adds a driveable floor", () => {
    const generated = materializeProfiles({
      ...project,
      profiles: [{
        id: "profile-carport",
        profile: "carport",
        confidence: "high",
        parameters: {
          widthMm: 7676,
          depthMm: 6240,
          roofSlopePercent: 3.7,
          westHighSideHeightMm: 3455,
          eastLowSideHeightMm: 3174,
          foundationHeights: {
            southwest: { roadSideMm: 0, middleMm: 685, innerMm: 695 },
            northeast: { outerTowardRoadMm: 530, middleMm: 500, innerMm: 630 }
          },
          steps: [],
          claddingDirection: "horizontal"
        }
      }]
    });
    const floor = generated.elements.find((element) => element.id === "driveable-gravel-floor");
    const leftPanel = generated.elements.find((element) => element.id === "southwest-left-low-panel");
    const rightPanel = generated.elements.find((element) => element.id === "southwest-right-low-panel");
    expect(floor?.metadata).toMatchObject({ material: "driveable-gravel-floor" });
    expect(leftPanel?.boundsMm.x).toBe(145);
    expect(rightPanel?.boundsMm.x).toBeCloseTo(4605.6);
    expect((rightPanel?.boundsMm.x ?? 0) - ((leftPanel?.boundsMm.x ?? 0) + (leftPanel?.boundsMm.width ?? 0))).toBeGreaterThan(1500);
  });
});
