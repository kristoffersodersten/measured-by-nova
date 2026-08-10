import { z } from "zod";
import { CaptureContractSchema, validateCaptureContract, type CaptureValidationResult } from "./captureContracts.js";
import {
  AssumptionSchema,
  ConfidenceSchema,
  MeasurementProjectSchema,
  PhotoReferenceSchema,
  type MeasurementProject
} from "./measurementContracts.js";
import { materializeProfiles } from "./profileGenerator.js";

const IdSchema = z.string().min(1).max(80).regex(/^[a-zA-Z0-9_.-]+$/);
const PositiveMmSchema = z.number().finite().positive();
const MmSchema = z.number().finite();
const VerifiedMeasurementSchema = z.object({
  valueMm: PositiveMmSchema,
  confidence: z.enum(["high", "medium"]),
  source: z.enum(["permit_pdf", "manual_measurement"]),
  verified: z.boolean()
}).strict();
const VerifiedNumberSchema = z.object({
  value: z.number().finite(),
  confidence: z.enum(["high", "medium"]),
  source: z.enum(["permit_pdf", "manual_measurement"]),
  verified: z.boolean()
}).strict();
const VerifiedPhotoSchema = PhotoReferenceSchema.omit({ confidence: true }).extend({
  view: z.enum(["north", "south", "east", "west"]),
  verified: z.boolean()
}).strict();

export const RealCarportCaptureSchema = z.object({
  schemaVersion: z.literal(1),
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
    southwest: z.object({ roadSideMm: MmSchema, middleMm: MmSchema, innerMm: MmSchema }).strict(),
    northeast: z.object({ outerTowardRoadMm: MmSchema, middleMm: MmSchema, innerMm: MmSchema }).strict()
  }).strict().optional(),
  steps: z.array(z.object({
    stepDepthMm: PositiveMmSchema,
    stepHeightMm: PositiveMmSchema,
    count: z.number().int().positive().max(100),
    locationHint: z.string().min(1).max(160).optional(),
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
      confidence: "low"
    })),
    dimensions: [
      dimension("width", capture.dimensions.width),
      dimension("depth", capture.dimensions.depth),
      dimension("west-high-side-height", capture.dimensions.westHighSideHeight),
      dimension("east-low-side-height", capture.dimensions.eastLowSideHeight)
    ],
    assumptions: capture.assumptions,
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
        foundationHeights: capture.foundationHeights,
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
  const requirements = [
    requirement("width", "Overall width", "geometry", capture.dimensions.width.verified),
    requirement("depth", "Overall depth", "geometry", capture.dimensions.depth.verified),
    requirement("west-high-side-height", "West/high side height", "geometry", capture.dimensions.westHighSideHeight.verified),
    requirement("east-low-side-height", "East/low side height", "geometry", capture.dimensions.eastLowSideHeight.verified),
    requirement("roof-slope-percent", "Roof slope", "geometry", capture.dimensions.roofSlopePercent.verified),
    ...(["north", "south", "east", "west"] as const).map((view) =>
      requirement(`photo-${view}`, `${view} facade reference photo`, "perception", photoViews.get(view) === true)
    ),
    ...capture.steps.map((step, index) => requirement(`step-run-${index + 1}`, `Step run ${index + 1}`, "geometry", step.verified)),
    ...(capture.neighborBoundary ? [requirement("neighbor-boundary", "Neighbor boundary distance", "geometry", capture.neighborBoundary.verified)] : [])
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
