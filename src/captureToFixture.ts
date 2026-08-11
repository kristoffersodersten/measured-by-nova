import { z } from "zod";
import { CaptureContractSchema, validateCaptureContract, type CaptureValidationResult } from "./captureContracts.js";
import {
  AssumptionSchema,
  ConfidenceSchema,
  FacadeLevelSchema,
  MaterialNoteSchema,
  MeasurementProjectSchema,
  PhotoReferenceSchema,
  type MeasurementProject
} from "./measurementContracts.js";
import { materializeProfiles } from "./profileGenerator.js";

const IdSchema = z.string().min(1).max(80).regex(/^[a-zA-Z0-9_.-]+$/);
const PositiveMmSchema = z.number().finite().positive();
const MmSchema = z.number().finite().nonnegative();
const VerifiedMeasurementSchema = z.object({
  valueMm: PositiveMmSchema,
  confidence: z.enum(["high", "medium"]),
  source: z.enum(["permit_pdf", "manual_measurement"]),
  verified: z.boolean()
}).strict();
const VerifiedMmSchema = VerifiedMeasurementSchema.extend({ valueMm: MmSchema }).strict();
const VerifiedSignedMmSchema = VerifiedMeasurementSchema.extend({ valueMm: z.number().finite() }).strict();
const VerifiedNumberSchema = z.object({
  value: z.number().finite(),
  confidence: z.enum(["high", "medium"]),
  source: z.enum(["permit_pdf", "manual_measurement"]),
  verified: z.boolean()
}).strict();
const VerifiedPhotoSchema = PhotoReferenceSchema.extend({
  view: z.enum(["north", "south", "east", "west"]),
  verified: z.boolean()
}).strict();

export const RealCarportCaptureSchema = z.object({
  schemaVersion: z.literal(2),
  captureId: IdSchema,
  projectId: IdSchema,
  projectType: z.literal("carport"),
  unit: z.literal("mm"),
  dimensions: z.object({
    width: VerifiedMeasurementSchema,
    depth: VerifiedMeasurementSchema,
    westHighSideHeight: VerifiedMeasurementSchema,
    eastLowSideHeight: VerifiedMeasurementSchema,
    roofSlopePercent: VerifiedNumberSchema
  }).strict(),
  foundationHeights: z.object({
    southwest: z.object({ roadSide: VerifiedMmSchema, middle: VerifiedMmSchema, inner: VerifiedMmSchema }).strict(),
    northeast: z.object({ outerTowardRoad: VerifiedMmSchema, middle: VerifiedMmSchema, inner: VerifiedMmSchema }).strict()
  }).strict().optional(),
  facadeLevels: z.array(z.object({
    facade: z.enum(["north", "south", "east", "west"]),
    baseLevel: VerifiedSignedMmSchema,
    topLevel: VerifiedSignedMmSchema
  }).strict()).max(4).default([]),
  openings: z.array(z.object({
    id: IdSchema,
    hostElementId: IdSchema,
    facade: z.enum(["north", "south", "east", "west"]),
    boundsMm: z.object({ x: z.number().finite(), y: z.number().finite(), z: z.number().finite(), width: PositiveMmSchema, height: PositiveMmSchema }).strict(),
    openType: z.enum(["open", "door", "window"]),
    confidence: z.enum(["high", "medium"]),
    source: z.enum(["permit_pdf", "manual_measurement"]),
    verified: z.boolean()
  }).strict()).default([]),
  members: z.array(z.object({
    id: IdSchema,
    memberType: z.enum(["post", "bar"]),
    role: z.enum(["structural", "decorative"]),
    boundsMm: z.object({ x: z.number().finite(), y: z.number().finite(), z: z.number().finite(), width: PositiveMmSchema, depth: PositiveMmSchema, height: PositiveMmSchema }).strict(),
    confidence: z.enum(["high", "medium"]),
    source: z.enum(["permit_pdf", "manual_measurement"]),
    verified: z.boolean()
  }).strict()).default([]),
  steps: z.array(z.object({
    stepDepthMm: PositiveMmSchema,
    stepHeightMm: PositiveMmSchema,
    count: z.number().int().positive().max(100),
    locationHint: z.string().min(1).max(160).optional(),
    facade: z.enum(["north", "south", "east", "west"]),
    direction: z.enum(["north", "south", "east", "west", "up", "down"]),
    confidence: ConfidenceSchema,
    verified: z.boolean()
  }).strict()).default([]),
  neighborBoundary: z.object({
    from: z.string().min(1).max(120),
    distanceMm: PositiveMmSchema,
    confidence: ConfidenceSchema,
    verified: z.boolean()
  }).strict().optional(),
  photos: z.array(VerifiedPhotoSchema).min(1),
  materialNotes: z.array(MaterialNoteSchema).min(1),
  assumptions: z.array(AssumptionSchema).default([])
}).strict();
export type RealCarportCapture = z.infer<typeof RealCarportCaptureSchema>;

export type CaptureToFixtureResult =
  | { ok: true; captureValidation: CaptureValidationResult; project: MeasurementProject }
  | { ok: false; captureValidation: CaptureValidationResult };

export function captureToFixture(input: unknown): CaptureToFixtureResult {
  const capture = RealCarportCaptureSchema.parse(input);
  const captureValidation = validateCaptureContract(buildCaptureContract(capture));
  if (!captureValidation.ok) {
    return { ok: false, captureValidation };
  }

  const project = materializeProfiles(MeasurementProjectSchema.parse({
    schemaVersion: 1,
    projectId: capture.projectId,
    unit: "mm",
    photos: capture.photos.map((photo) => ({
      path: photo.path,
      view: photo.view,
      role: photo.role,
      confidence: photo.confidence
    })),
    materialNotes: capture.materialNotes,
    facadeLevels: capture.facadeLevels.map((level) => FacadeLevelSchema.parse({
      facade: level.facade,
      baseLevelMm: level.baseLevel.valueMm,
      topLevelMm: level.topLevel.valueMm,
      confidence: minConfidence([level.baseLevel.confidence, level.topLevel.confidence]),
      source: level.baseLevel.source
    })),
    dimensions: [
      dimension("width", capture.dimensions.width),
      dimension("depth", capture.dimensions.depth),
      dimension("west-high-side-height", capture.dimensions.westHighSideHeight),
      dimension("east-low-side-height", capture.dimensions.eastLowSideHeight)
    ],
    assumptions: capture.assumptions,
    openings: capture.openings.map((opening) => ({
      hostElementId: opening.hostElementId,
      boundsMm: opening.boundsMm,
      openType: opening.openType,
      confidence: opening.confidence
    })),
    elements: capture.members.map((member) => ({
      id: member.id,
      kind: member.memberType === "post" ? "post" : "beam",
      boundsMm: member.boundsMm,
      confidence: member.confidence,
      source: member.source === "manual_measurement" ? "manual" : "dimension",
      metadata: { captureContractV2: true, memberType: member.memberType, role: member.role }
    })),
    steps: capture.steps.map((step, index) => ({
      id: `capture-step-${index + 1}`,
      stepDepthMm: step.stepDepthMm,
      stepHeightMm: step.stepHeightMm,
      count: step.count,
      locationHint: step.locationHint,
      facade: step.facade,
      direction: step.direction,
      confidence: step.confidence
    })),
    profiles: [{
      id: "profile-carport",
      profile: "carport",
      confidence: minConfidence([
        capture.dimensions.width.confidence,
        capture.dimensions.depth.confidence,
        capture.dimensions.westHighSideHeight.confidence,
        capture.dimensions.eastLowSideHeight.confidence,
        capture.dimensions.roofSlopePercent.confidence
      ]),
      parameters: {
        widthMm: capture.dimensions.width.valueMm,
        depthMm: capture.dimensions.depth.valueMm,
        roofSlopePercent: capture.dimensions.roofSlopePercent.value,
        westHighSideHeightMm: capture.dimensions.westHighSideHeight.valueMm,
        eastLowSideHeightMm: capture.dimensions.eastLowSideHeight.valueMm,
        foundationHeights: capture.foundationHeights ? {
          southwest: {
            roadSideMm: capture.foundationHeights.southwest.roadSide.valueMm,
            middleMm: capture.foundationHeights.southwest.middle.valueMm,
            innerMm: capture.foundationHeights.southwest.inner.valueMm
          },
          northeast: {
            outerTowardRoadMm: capture.foundationHeights.northeast.outerTowardRoad.valueMm,
            middleMm: capture.foundationHeights.northeast.middle.valueMm,
            innerMm: capture.foundationHeights.northeast.inner.valueMm
          }
        } : undefined,
        steps: capture.steps.map((step) => ({
          stepDepthMm: step.stepDepthMm,
          stepHeightMm: step.stepHeightMm,
          count: step.count,
          locationHint: step.locationHint
        })),
        neighborBoundary: capture.neighborBoundary
          ? { from: capture.neighborBoundary.from, distanceMm: capture.neighborBoundary.distanceMm }
          : undefined,
        claddingDirection: "horizontal"
      }
    }],
    validation: {
      ok: true,
      checks: [
        { name: "capture:width", ok: true, message: `width=${capture.dimensions.width.valueMm}mm`, confidence: capture.dimensions.width.confidence },
        { name: "capture:depth", ok: true, message: `depth=${capture.dimensions.depth.valueMm}mm`, confidence: capture.dimensions.depth.confidence },
        { name: "capture:photos", ok: true, message: "All four facade reference views are present.", confidence: "low" }
      ],
      warnings: ["Capture photos are non-authoritative reference inputs."]
    },
    modelLock: { locked: false },
    artifacts: {}
  }));

  return { ok: true, captureValidation, project };
}

function buildCaptureContract(capture: RealCarportCapture) {
  const photoViews = new Map(capture.photos.map((photo) => [photo.view, photo.verified]));
  const facadeLevels = new Map(capture.facadeLevels.map((level) => [level.facade, level]));
  const requirements = [
    requirement("width", "Overall width", "geometry", capture.dimensions.width.verified),
    requirement("depth", "Overall depth", "geometry", capture.dimensions.depth.verified),
    requirement("west-high-side-height", "West/high side height", "geometry", capture.dimensions.westHighSideHeight.verified),
    requirement("east-low-side-height", "East/low side height", "geometry", capture.dimensions.eastLowSideHeight.verified),
    requirement("roof-slope-percent", "Roof slope", "geometry", capture.dimensions.roofSlopePercent.verified),
    ...(["north", "south", "east", "west"] as const).flatMap((facade) => [
      requirement(`facade-${facade}-base-level`, `${facade} facade base level`, "geometry", facadeLevels.get(facade)?.baseLevel.verified === true),
      requirement(`facade-${facade}-top-level`, `${facade} facade top level`, "geometry", facadeLevels.get(facade)?.topLevel.verified === true)
    ]),
    ...(capture.openings.length === 0
      ? [requirement("openings", "Measured facade openings", "geometry", false)]
      : capture.openings.map((opening) => requirement(`opening-${opening.id}`, `Measured opening ${opening.id}`, "geometry", opening.verified))),
    ...(capture.members.length === 0
      ? [requirement("members", "Measured posts and bars", "geometry", false)]
      : capture.members.map((member) => requirement(`member-${member.id}`, `${member.role} ${member.memberType} ${member.id}`, "geometry", member.verified))),
    ...(["north", "south", "east", "west"] as const).map((view) =>
      requirement(`photo-${view}`, `${view} facade reference photo`, "perception", photoViews.get(view) === true)
    ),
    ...capture.steps.map((step, index) => requirement(`step-run-${index + 1}`, `Step run ${index + 1}`, "geometry", step.verified)),
    ...(capture.foundationHeights ? [
      requirement("foundation-southwest-road-side", "Southwest foundation road-side height", "geometry", capture.foundationHeights.southwest.roadSide.verified),
      requirement("foundation-southwest-middle", "Southwest foundation middle height", "geometry", capture.foundationHeights.southwest.middle.verified),
      requirement("foundation-southwest-inner", "Southwest foundation inner height", "geometry", capture.foundationHeights.southwest.inner.verified),
      requirement("foundation-northeast-outer", "Northeast foundation outer height", "geometry", capture.foundationHeights.northeast.outerTowardRoad.verified),
      requirement("foundation-northeast-middle", "Northeast foundation middle height", "geometry", capture.foundationHeights.northeast.middle.verified),
      requirement("foundation-northeast-inner", "Northeast foundation inner height", "geometry", capture.foundationHeights.northeast.inner.verified)
    ] : []),
    ...(capture.neighborBoundary ? [requirement("neighbor-boundary", "Neighbor boundary distance", "geometry", capture.neighborBoundary.verified)] : []),
    ...capture.materialNotes.map((note, index) => requirement(`material-note-${index + 1}`, `Material note ${index + 1}`, "perception", note.verified))
  ];

  return CaptureContractSchema.parse({
    schemaVersion: 1,
    contractId: `${capture.captureId}-contract`,
    projectType: "carport",
    requirements,
    exportPolicy: {
      blockUnverifiedGeometry: true,
      allowPerceptionAssumptions: true,
      photosAuthoritative: false
    }
  });
}

function requirement(id: string, label: string, impact: "geometry" | "perception", verified: boolean) {
  return {
    id,
    label,
    kind: "required" as const,
    impact,
    verification: verified ? "verified" as const : "missing" as const,
    source: impact === "geometry" ? "measurement" as const : "photo" as const
  };
}

function dimension(label: string, measurement: z.infer<typeof VerifiedMeasurementSchema>) {
  return {
    label,
    valueMm: measurement.valueMm,
    confidence: measurement.confidence,
    source: measurement.source
  };
}

function minConfidence(confidences: Array<"high" | "medium">): "high" | "medium" {
  return confidences.includes("medium") ? "medium" : "high";
}
