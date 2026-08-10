import { z } from "zod";

export const ConfidenceSchema = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof ConfidenceSchema>;

const IdSchema = z.string().min(1).max(80).regex(/^[a-zA-Z0-9_.-]+$/);
const RelativePathSchema = z.string().min(1).max(240).refine((value) => !value.startsWith("/") && !value.includes(".."), {
  message: "Path must be relative and stay inside the configured output directory."
});
const MmSchema = z.number().finite();
const PositiveMmSchema = z.number().finite().positive();
const Vec3Schema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);

export const ToolEnvelopeSchema = z.object({
  projectId: IdSchema
}).strict();

export const PhotoReferenceSchema = z.object({
  path: RelativePathSchema,
  view: z.string().min(1).max(80).optional(),
  role: z.enum(["reference", "validation"]).default("reference"),
  confidence: ConfidenceSchema.default("low")
}).strict();
export type PhotoReference = z.infer<typeof PhotoReferenceSchema>;

export const KnownDimensionSchema = z.object({
  label: z.string().min(1).max(120),
  valueMm: PositiveMmSchema,
  confidence: ConfidenceSchema,
  endpoints: z.tuple([z.string().min(1), z.string().min(1)]).optional(),
  source: z.enum(["permit_pdf", "manual_measurement", "photo_inferred", "unknown"]).default("unknown")
}).strict();
export type KnownDimension = z.infer<typeof KnownDimensionSchema>;

export const ReferencePlaneSchema = z.object({
  id: IdSchema,
  orientation: z.enum(["horizontal", "vertical_x", "vertical_y", "custom"]),
  confidence: ConfidenceSchema,
  originMm: Vec3Schema.optional(),
  normal: Vec3Schema.optional()
}).strict();
export type ReferencePlane = z.infer<typeof ReferencePlaneSchema>;

export const OpeningConstraintSchema = z.object({
  projectId: IdSchema,
  hostElementId: IdSchema,
  boundsMm: z.object({ x: MmSchema, y: MmSchema, z: MmSchema, width: PositiveMmSchema, height: PositiveMmSchema }).strict(),
  openType: z.enum(["open", "door", "window"]),
  confidence: ConfidenceSchema
}).strict();
export type OpeningConstraint = Omit<z.infer<typeof OpeningConstraintSchema>, "projectId">;

export const StepRunSchema = z.object({
  id: IdSchema,
  stepDepthMm: PositiveMmSchema,
  stepHeightMm: PositiveMmSchema,
  count: z.number().int().positive().max(100),
  locationHint: z.string().min(1).max(160).optional(),
  confidence: ConfidenceSchema
}).strict();
export type StepRun = z.infer<typeof StepRunSchema>;

export const AssumptionSchema = z.object({
  id: IdSchema,
  text: z.string().min(1).max(500),
  confidence: ConfidenceSchema,
  source: z.enum(["user_declared", "photo_reference", "municipal_requirement", "system_generated"]),
  affectsGeometry: z.boolean().default(false)
}).strict();
export type Assumption = z.infer<typeof AssumptionSchema>;

export const CarportProfileParametersSchema = z.object({
  widthMm: PositiveMmSchema,
  depthMm: PositiveMmSchema,
  roofSlopePercent: z.number().finite(),
  westHighSideHeightMm: PositiveMmSchema,
  eastLowSideHeightMm: PositiveMmSchema,
  foundationHeights: z.object({
    southwest: z.object({ roadSideMm: MmSchema, middleMm: MmSchema, innerMm: MmSchema }).strict(),
    northeast: z.object({ outerTowardRoadMm: MmSchema, middleMm: MmSchema, innerMm: MmSchema }).strict()
  }).strict().optional(),
  steps: z.array(z.object({
    stepDepthMm: PositiveMmSchema,
    stepHeightMm: PositiveMmSchema,
    count: z.number().int().positive().max(100),
    locationHint: z.string().min(1).max(160).optional()
  }).strict()).default([]),
  neighborBoundary: z.object({ from: z.string().min(1).max(120), distanceMm: PositiveMmSchema }).strict().optional(),
  claddingDirection: z.enum(["horizontal", "vertical", "unknown"]).default("horizontal")
}).strict();
export type CarportProfileParameters = z.infer<typeof CarportProfileParametersSchema>;

export const ProfileInstanceSchema = z.discriminatedUnion("profile", [
  z.object({ id: IdSchema.default("profile-carport"), profile: z.literal("carport"), parameters: CarportProfileParametersSchema, confidence: ConfidenceSchema.default("high") }).strict(),
  z.object({ id: IdSchema.default("profile-simple-shed"), profile: z.literal("simple-shed"), parameters: z.record(z.unknown()), confidence: ConfidenceSchema.default("medium") }).strict(),
  z.object({ id: IdSchema.default("profile-generic-structure"), profile: z.literal("generic-structure"), parameters: z.record(z.unknown()), confidence: ConfidenceSchema.default("medium") }).strict()
]);
export type ProfileInstance = z.infer<typeof ProfileInstanceSchema>;

export const ParametricElementSchema = z.object({
  id: IdSchema,
  kind: z.enum(["slab", "post", "beam", "roof", "wall", "foundation", "stairs", "opening", "panel", "terrain", "context"]),
  boundsMm: z.object({ x: MmSchema, y: MmSchema, z: MmSchema, width: PositiveMmSchema, depth: PositiveMmSchema, height: PositiveMmSchema }).strict(),
  confidence: ConfidenceSchema,
  source: z.enum(["profile", "dimension", "manual", "photo_reference"]).default("profile"),
  metadata: z.record(z.unknown()).default({})
}).strict();
export type ParametricElement = z.infer<typeof ParametricElementSchema>;

export const ValidationReportSchema = z.object({
  ok: z.boolean().default(true),
  checks: z.array(z.object({ name: z.string(), ok: z.boolean(), message: z.string(), confidence: ConfidenceSchema.optional() }).strict()).default([]),
  warnings: z.array(z.string()).default([])
}).strict();
export type ValidationReport = z.infer<typeof ValidationReportSchema>;

export const ArtifactIndexSchema = z.record(z.string(), z.string()).default({});
export type ArtifactIndex = z.infer<typeof ArtifactIndexSchema>;

export const ModelLockSchema = z.object({
  locked: z.boolean().default(false),
  lockedAt: z.string().datetime().optional(),
  lockedBy: z.string().min(1).max(120).optional(),
  reason: z.string().min(1).max(500).optional()
}).strict();
export type ModelLock = z.infer<typeof ModelLockSchema>;

export const SourceOfTruthPolicySchema = z.object({
  measurementModel: z.literal("explicit_measurements_and_constraints").default("explicit_measurements_and_constraints"),
  photos: z.literal("non_authoritative_reference_only").default("non_authoritative_reference_only"),
  blenderGeometry: z.literal("only_renderable_geometry_truth").default("only_renderable_geometry_truth"),
  exportStage: z.literal("formatting_only_no_geometry_reconstruction").default("formatting_only_no_geometry_reconstruction"),
  llmRole: z.literal("optional_orchestration_never_authoritative").default("optional_orchestration_never_authoritative"),
  nonGoal: z.literal("not_cad_not_bim_not_survey").default("not_cad_not_bim_not_survey")
}).strict();
export type SourceOfTruthPolicy = z.infer<typeof SourceOfTruthPolicySchema>;

export const ExportTemplateSchema = z.enum([
  "permit",
  "permit-facade-pack",
  "swedish-municipality",
  "gothenburg-permit",
  "measured-visualization",
  "cad-simulated",
  "client-preview",
  "fabrication",
  "qa-validation",
  "site-context",
  "photo-alignment",
  "measurement-book",
  "web-viewer",
  "archive"
]);
export type ExportTemplate = z.infer<typeof ExportTemplateSchema>;

export const MeasurementProjectSchema = z.object({
  schemaVersion: z.literal(1),
  projectId: IdSchema,
  unit: z.literal("mm"),
  photos: z.array(PhotoReferenceSchema).default([]),
  dimensions: z.array(KnownDimensionSchema).default([]),
  planes: z.array(ReferencePlaneSchema).default([]),
  elements: z.array(ParametricElementSchema).default([]),
  openings: z.array(OpeningConstraintSchema.omit({ projectId: true })).default([]),
  steps: z.array(StepRunSchema).default([]),
  assumptions: z.array(AssumptionSchema).default([]),
  profiles: z.array(ProfileInstanceSchema).default([]),
  validation: ValidationReportSchema.default({ ok: true, checks: [], warnings: [] }),
  modelLock: ModelLockSchema.default({}),
  sourceOfTruthPolicy: SourceOfTruthPolicySchema.default({}),
  artifacts: ArtifactIndexSchema.default({})
}).strict();
export type MeasurementProject = z.infer<typeof MeasurementProjectSchema>;

export const CreateMeasurementProjectSchema = z.object({
  projectId: IdSchema,
  unit: z.literal("mm"),
  outputDir: RelativePathSchema.optional()
}).strict();
export const ImportReferencePhotosSchema = ToolEnvelopeSchema.extend({ photos: z.array(PhotoReferenceSchema.omit({ confidence: true })).min(1).max(200) }).strict();
export const DefineKnownDimensionSchema = ToolEnvelopeSchema.merge(KnownDimensionSchema).strict();
export const DefineReferencePlaneInputSchema = ToolEnvelopeSchema.merge(ReferencePlaneSchema).strict();
export const DefineOpeningSchema = OpeningConstraintSchema;
export const DefineStepRunSchema = ToolEnvelopeSchema.merge(StepRunSchema).strict();
export const DefineAssumptionSchema = ToolEnvelopeSchema.merge(AssumptionSchema).strict();
export const CreateParametricProfileSchema = ToolEnvelopeSchema.extend({ profile: z.enum(["carport", "simple-shed", "generic-structure"]), parameters: z.unknown() }).strict();
export const GenerateMeasuredModelSchema = ToolEnvelopeSchema.extend({ outputBlend: RelativePathSchema.optional() }).strict();
export const ValidateModelSchema = ToolEnvelopeSchema.extend({ checks: z.array(z.enum(["known_dimensions", "photo_orientation", "reprojection_error"])).min(1) }).strict();
export const GenerateElevationViewsSchema = ToolEnvelopeSchema.extend({ views: z.array(z.enum(["plan", "north", "south", "east", "west", "section_a_a"])).min(1) }).strict();
export const ExportMeasuredModelSchema = ToolEnvelopeSchema.extend({ formats: z.array(z.enum(["blend", "glb", "obj"])).min(1) }).strict();
export const ExportDimensionedDrawingsSchema = ToolEnvelopeSchema.extend({ outputPath: RelativePathSchema, scale: z.string().min(1).max(40), includeConfidenceLegend: z.boolean().default(true) }).strict();
export const LockModelForExportSchema = ToolEnvelopeSchema.extend({
  lockedBy: z.string().min(1).max(120),
  reason: z.string().min(1).max(500)
}).strict();
export const ExportFacadeCompletionPackSchema = ToolEnvelopeSchema.extend({
  template: z.enum(["permit-facade-pack", "swedish-municipality", "gothenburg-permit"]).default("permit-facade-pack"),
  outputDir: RelativePathSchema.optional(),
  scale: z.string().min(1).max(40).default("1:100"),
  views: z.array(z.enum(["north", "south", "east", "west"])).length(4).default(["north", "south", "east", "west"])
}).strict();
export const ExportProjectTemplateSchema = ToolEnvelopeSchema.extend({
  template: ExportTemplateSchema,
  outputDir: RelativePathSchema.optional(),
  options: z.record(z.unknown()).default({})
}).strict();

export const UnsafeRunPythonSchema = z.object({
  code: z.string().min(1).max(20_000),
  outputFile: RelativePathSchema.optional(),
  unsafeAllowExecution: z.literal(true)
}).strict();
