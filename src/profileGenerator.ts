import type { MeasurementProject, ParametricElement, ProfileInstance } from "./measurementContracts.js";

const POST = 145;
const INNER_POST = 95;
const BEAM_H = 220;
const ROOF_THICKNESS = 160;
const WALL_H = 1320;
const FOUNDATION_THICKNESS = 180;

function roofHeightAtX(x: number, width: number, high: number, low: number, offset = 0): number {
  return high + ((low - high) / width) * x + offset;
}

export function materializeProfiles(project: MeasurementProject): MeasurementProject {
  const elements: ParametricElement[] = [];
  for (const profile of project.profiles) {
    if (profile.profile === "carport") {
      elements.push(...carportElements(profile));
    }
  }
  return { ...project, elements };
}

function carportElements(profile: Extract<ProfileInstance, { profile: "carport" }>): ParametricElement[] {
  const p = profile.parameters;
  const width = p.widthMm;
  const depth = p.depthMm;
  const high = p.westHighSideHeightMm;
  const low = p.eastLowSideHeightMm;
  const delta = high - low;
  const roofConfidence = Math.abs((delta / depth) * 100 - p.roofSlopePercent) <= 1 ? "high" : "medium";
  const elements: ParametricElement[] = [];

  elements.push({ id: "roof", kind: "roof", boundsMm: { x: 0, y: 0, z: 0, width, depth, height: ROOF_THICKNESS }, confidence: roofConfidence, source: "profile", metadata: { highSideHeightMm: high, lowSideHeightMm: low, slopePercent: p.roofSlopePercent, overhangMm: 220 } });
  elements.push({ id: "north-beam", kind: "beam", boundsMm: { x: 0, y: depth - POST, z: low - BEAM_H, width, depth: POST, height: BEAM_H }, confidence: "high", source: "profile", metadata: {} });
  elements.push({ id: "south-beam", kind: "beam", boundsMm: { x: 0, y: 0, z: low - BEAM_H, width, depth: POST, height: BEAM_H }, confidence: "high", source: "profile", metadata: {} });

  const posts = [
    ["p1", 0, 0, POST, roofHeightAtX(0, width, high, low, -ROOF_THICKNESS)],
    ["p2", width - POST, 0, POST, roofHeightAtX(width - POST, width, high, low, -ROOF_THICKNESS)],
    ["p3", 0, depth - POST, POST, roofHeightAtX(0, width, high, low, -ROOF_THICKNESS)],
    ["p4", width - POST, depth - POST, POST, roofHeightAtX(width - POST, width, high, low, -ROOF_THICKNESS)],
    ["p5", width * 0.5 - INNER_POST / 2, 0, INNER_POST, roofHeightAtX(width * 0.5, width, high, low, -ROOF_THICKNESS)],
    ["p6", width * 0.62 - INNER_POST / 2, depth - INNER_POST, INNER_POST, roofHeightAtX(width * 0.62, width, high, low, -ROOF_THICKNESS)]
  ] as const;
  for (const [id, x, y, size, height] of posts) {
    elements.push({ id, kind: "post", boundsMm: { x, y, z: 0, width: size, depth: size, height }, confidence: "high", source: "profile", metadata: {} });
  }

  if (p.foundationHeights) {
    const sw = p.foundationHeights.southwest;
    const ne = p.foundationHeights.northeast;
    const swHeight = Math.max(sw.middleMm, sw.innerMm, sw.roadSideMm);
    const neHeight = Math.max(ne.outerTowardRoadMm, ne.middleMm, ne.innerMm);
    const sideDepth = depth - FOUNDATION_THICKNESS * 2;
    elements.push({ id: "foundation-southwest", kind: "foundation", boundsMm: { x: 0, y: 0, z: -swHeight, width, depth: FOUNDATION_THICKNESS, height: swHeight }, confidence: "medium", source: "manual", metadata: { ...sw, facade: "front", material: "dark-stone" } });
    elements.push({ id: "foundation-rear", kind: "foundation", boundsMm: { x: 0, y: depth - FOUNDATION_THICKNESS, z: -neHeight, width, depth: FOUNDATION_THICKNESS, height: neHeight }, confidence: "medium", source: "manual", metadata: { ...ne, facade: "rear", material: "dark-stone" } });
    elements.push({ id: "foundation-west-side", kind: "foundation", boundsMm: { x: 0, y: FOUNDATION_THICKNESS, z: -swHeight, width: FOUNDATION_THICKNESS, depth: sideDepth, height: swHeight }, confidence: "medium", source: "manual", metadata: { ...sw, facade: "west-side", material: "dark-stone" } });
    elements.push({ id: "foundation-northeast", kind: "foundation", boundsMm: { x: width - FOUNDATION_THICKNESS, y: FOUNDATION_THICKNESS, z: -neHeight, width: FOUNDATION_THICKNESS, depth: sideDepth, height: neHeight }, confidence: "medium", source: "manual", metadata: { ...ne, facade: "east-side", material: "dark-stone" } });

    elements.push({ id: "driveable-gravel-floor", kind: "slab", boundsMm: { x: 180, y: 180, z: 18, width: width - 360, depth: depth - 360, height: 35 }, confidence: "low", source: "photo_reference", metadata: { material: "driveable-gravel-floor", facade: "interior", approximate: true } });
    elements.push({ id: "southwest-left-low-panel", kind: "panel", boundsMm: { x: POST, y: 0, z: 0, width: width * 0.38 - POST, depth: 70, height: WALL_H }, confidence: "low", source: "photo_reference", metadata: { material: "white-painted-wood", cladding: p.claddingDirection, facade: "southwest", opening: "center-drive-in" } });
    elements.push({ id: "southwest-right-low-panel", kind: "panel", boundsMm: { x: width * 0.60, y: 0, z: 0, width: width * 0.40 - POST, depth: 70, height: WALL_H }, confidence: "low", source: "photo_reference", metadata: { material: "white-painted-wood", cladding: p.claddingDirection, facade: "southwest", opening: "center-drive-in" } });
    elements.push({ id: "northeast-full-height-panel", kind: "panel", boundsMm: { x: POST, y: depth - 70, z: 0, width: width * 0.58 - POST, depth: 70, height: roofHeightAtX(width * 0.29, width, high, low, -ROOF_THICKNESS) }, confidence: "low", source: "photo_reference", metadata: { material: "white-painted-wood", cladding: p.claddingDirection, facade: "northeast", opening: "one-large-opening" } });
  }

  p.steps.forEach((step, index) => {
    const foundationHeight = p.foundationHeights ? Math.max(p.foundationHeights.southwest.middleMm, p.foundationHeights.southwest.innerMm, p.foundationHeights.southwest.roadSideMm) : step.stepHeightMm * step.count;
    const count = Math.max(step.count, Math.ceil(foundationHeight / step.stepHeightMm));
    elements.push({
      id: `steps-${index + 1}`,
      kind: "stairs",
      boundsMm: { x: width * 0.5 - 520, y: -step.stepDepthMm * count, z: -foundationHeight, width: 1040, depth: step.stepDepthMm * count, height: foundationHeight },
      confidence: "medium",
      source: "manual",
      metadata: { ...step, count, totalHeightMm: foundationHeight, direction: "down_from_carport_to_ground" }
    });
  });

  if (p.neighborBoundary) {
    elements.push({ id: "neighbor-boundary-reference", kind: "context", boundsMm: { x: -p.neighborBoundary.distanceMm, y: 0, z: 0, width: 30, depth, height: 20 }, confidence: "medium", source: "manual", metadata: p.neighborBoundary });
  }

  return elements;
}
