import { createHash } from "node:crypto";
import { z } from "zod";
import { CapabilityManifestSchema } from "./capabilityManifest.js";

const IdSchema = z.string().min(1).max(120).regex(/^[a-zA-Z0-9_.-]+$/);
const RelativePathSchema = z.string().min(1).max(240).refine((value) => !value.startsWith("/") && !value.includes(".."), {
  message: "Path must be relative and stay inside the configured output directory."
});
const BlendPathSchema = RelativePathSchema.refine((value) => value.toLowerCase().endsWith(".blend"), {
  message: "sourceBlendPath must point to a locked .blend source scene."
});
const LockedBlendSourcePathSchema = BlendPathSchema.refine((value) => value.startsWith("sources/") || value.startsWith("measurement-projects/"), {
  message: "sourceBlendPath must reference a locked source scene under sources/ or measurement-projects/."
});
const RenderImageOutputPathSchema = RelativePathSchema.refine((value) => /\.(png|jpe?g|webp|tiff?)$/i.test(value), {
  message: "render outputPath must point to an image artifact."
}).refine((value) => value.startsWith("renders/"), {
  message: "render outputPath must stay under renders/."
});
const ConfidenceSchema = z.enum(["high", "medium", "low"]);
const VerificationSchema = z.enum(["verified", "missing", "assumed"]);
const SurfaceFaceSchema = z.enum(["front", "rear", "left", "right", "top", "bottom"]);
const DeliveryTierSchema = z.enum(["draft-preview", "standard-viewing", "premium-sales"]);
const CaptureAngleTypeSchema = z.enum(["orthogonal", "three-quarter", "detail", "interior", "context"]);
const CaptureCameraModeSchema = z.enum(["orthographic-reference", "perspective-reference", "macro-detail"]);
const CapturePitchGuidanceSchema = z.enum(["level", "slightly-down", "slightly-up", "surface-normal"]);
const CaptureLensGuidanceSchema = z.enum(["normal-35-70mm-equivalent", "wide-allowed-context-only", "macro-detail"]);
const CaptureCoverageSchema = z.enum(["full-object", "full-sector", "material-surface", "condition-detail"]);
const CaptureOcclusionPolicySchema = z.enum(["avoid", "document-if-unavoidable"]);
const CaptureLightingReferenceSchema = z.enum(["daylight", "overcast", "studio-controlled", "mixed-measured", "specified"]);
const CaptureColorReferenceSchema = z.enum(["gray-card", "color-checker", "known-white-reference", "manufacturer-spec", "manual-white-balance"]);
const MaterialCaptureQualityProfileRequirementSchema = z.enum([
  "full-sector-or-surface",
  "cross-polarization-recommended",
  "white-balance-required",
  "exposure-required",
  "glare-control-required",
  "reflection-angle-required",
  "raking-light-recommended"
]);
const ConditionCaptureQualityProfileRequirementSchema = z.enum([
  "macro-detail-required",
  "condition-detail-coverage-required",
  "min-short-side-1024px",
  "surface-placement-required",
  "material-surface-binding-required",
  "medium-high-scale-required",
  "medium-high-lighting-required",
  "medium-high-white-balance-required",
  "medium-high-exposure-required"
]);
const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const DigitalViewingCustomerSurfaceSchema = z.enum(["internal-review", "sales-listing", "showroom", "broker-preview", "permit-support"]);
export type DigitalViewingCustomerSurface = z.infer<typeof DigitalViewingCustomerSurfaceSchema>;
const MaterialPresetIdSchema = z.enum([
  "automotive-white-paint",
  "automotive-metallic-paint",
  "marine-gelcoat",
  "clear-glass",
  "dark-rubber",
  "brushed-metal",
  "black-leather",
  "natural-wood",
  "painted-wood",
  "stone-masonry",
  "matte-plastic"
]);
const MaterialCategorySchema = z.enum([
  "paint",
  "wood",
  "metal",
  "glass",
  "fabric",
  "leather",
  "gelcoat",
  "stone",
  "plastic",
  "rubber",
  "composite",
  "unknown"
]);
const TextureMapTypeSchema = z.enum(["baseColor", "roughness", "metallic", "normal", "height", "alpha", "ambientOcclusion"]);
export const DigitalViewingOutputTargetSchema = z.enum(["blend", "glb", "usdz", "web-viewer", "photoreal-render", "technical-views", "material-condition-report"]);
export type DigitalViewingOutputTarget = z.infer<typeof DigitalViewingOutputTargetSchema>;
const DeliveryTargetSortOrder: DigitalViewingOutputTarget[] = ["photoreal-render", "material-condition-report", "blend", "glb", "usdz", "web-viewer", "technical-views"];

export const TextureMapSchema = z.object({
  type: TextureMapTypeSchema,
  path: RelativePathSchema,
  provenance: z.enum(["photo_observed", "measured", "specified"]),
  confidence: ConfidenceSchema,
  colorSpace: z.enum(["sRGB", "Non-Color"]).default("sRGB"),
  scaleMm: z.number().finite().positive().optional(),
  pixelWidth: z.number().int().positive().optional(),
  pixelHeight: z.number().int().positive().optional(),
  sourcePhoto: RelativePathSchema.optional()
}).strict();
export type TextureMap = z.infer<typeof TextureMapSchema>;

export const DigitalViewingMaterialSurfaceMappingSchema = z.object({
  projection: z.enum(["uv", "box", "planar"]),
  faces: z.array(SurfaceFaceSchema).min(1),
  scaleMm: z.number().finite().positive(),
  rotationDeg: z.number().finite().default(0),
  sourcePhoto: RelativePathSchema.optional()
}).strict();
export type DigitalViewingMaterialSurfaceMapping = z.infer<typeof DigitalViewingMaterialSurfaceMappingSchema>;

export const DigitalViewingMaterialAppearanceCalibrationSchema = z.object({
  method: z.enum(["color-chart", "white-balance-reference", "manufacturer-spec", "manual-specified"]),
  sourcePhoto: RelativePathSchema.optional(),
  illuminant: z.enum(["daylight", "studio", "overcast", "mixed", "specified"]).optional(),
  confidence: ConfidenceSchema
}).strict();
export type DigitalViewingMaterialAppearanceCalibration = z.infer<typeof DigitalViewingMaterialAppearanceCalibrationSchema>;

export const DigitalAssetTypeSchema = z.enum(["vehicle", "boat", "property", "exterior-structure", "product", "custom"]);
export type DigitalAssetType = z.infer<typeof DigitalAssetTypeSchema>;

export const DigitalViewingMeasurementPlacementSchema = z.object({
  hostElementId: IdSchema,
  axis: z.enum(["x", "y", "z", "slope", "distance"]),
  from: z.string().min(1).max(120),
  to: z.string().min(1).max(120),
  referenceFrame: z.enum(["asset-local", "site-local", "world"]).default("asset-local")
}).strict();
export type DigitalViewingMeasurementPlacement = z.infer<typeof DigitalViewingMeasurementPlacementSchema>;

export const DigitalViewingMeasurementSchema = z.object({
  id: IdSchema,
  label: z.string().min(1).max(160),
  value: z.number().finite(),
  unit: z.enum(["mm", "deg", "percent"]),
  tolerance: z.number().finite().positive().optional(),
  confidence: ConfidenceSchema,
  verified: z.boolean(),
  source: z.enum(["manual_measurement", "drawing", "calibrated_anchor"]),
  placement: DigitalViewingMeasurementPlacementSchema.optional(),
  affectsGeometry: z.literal(true)
}).strict();
export type DigitalViewingMeasurement = z.infer<typeof DigitalViewingMeasurementSchema>;

export const DigitalViewingModelElementSchema = z.object({
  id: IdSchema,
  kind: z.enum(["body", "frame", "wheelbase", "seat", "roof", "foundation", "stair", "wall", "panel", "surface", "context", "custom"]),
  renderable: z.boolean().default(true),
  confidence: ConfidenceSchema,
  source: z.enum(["measured_geometry", "locked_blender", "specified", "photo_reference"])
}).strict();
export type DigitalViewingModelElement = z.infer<typeof DigitalViewingModelElementSchema>;

export const DigitalViewingPhotoSchema = z.object({
  path: RelativePathSchema,
  sector: z.string().min(1).max(80),
  role: z.enum(["geometry_alignment", "material", "condition", "context", "validation"]),
  verified: z.boolean(),
  anchorsVisible: z.boolean().default(false),
  pixelWidth: z.number().int().positive().optional(),
  pixelHeight: z.number().int().positive().optional(),
  captureMetadata: z.object({
    angleType: CaptureAngleTypeSchema,
    cameraMode: CaptureCameraModeSchema,
    yawDeg: z.number().finite().min(-180).max(180).optional(),
    pitchDeg: z.number().finite().min(-90).max(90).optional(),
    pitchGuidance: CapturePitchGuidanceSchema,
    lensGuidance: CaptureLensGuidanceSchema,
    coverage: CaptureCoverageSchema,
    occluded: z.boolean().default(false),
    focalLength35mmEquivalent: z.number().finite().positive().optional(),
    cameraDistanceMm: z.number().finite().positive().optional(),
    lightingReference: CaptureLightingReferenceSchema.optional(),
    colorReference: CaptureColorReferenceSchema.optional(),
    materialCategories: z.array(MaterialCategorySchema).default([]),
    whiteBalanceKelvin: z.number().finite().positive().min(1000).max(40000).optional(),
    exposureEv: z.number().finite().optional()
  }).strict().optional(),
  confidence: ConfidenceSchema.default("low"),
  notes: z.string().min(1).max(500).optional()
}).strict();
export type DigitalViewingPhoto = z.infer<typeof DigitalViewingPhotoSchema>;

export const PbrMaterialSchema = z.object({
  materialId: IdSchema,
  hostElementId: IdSchema.optional(),
  presetId: MaterialPresetIdSchema.optional(),
  materialSurfaces: z.array(IdSchema).default([]),
  category: MaterialCategorySchema,
  baseColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  roughness: z.number().finite().min(0).max(1).optional(),
  metallic: z.number().finite().min(0).max(1).optional(),
  specular: z.number().finite().min(0).max(1).optional(),
  transmission: z.number().finite().min(0).max(1).optional(),
  normalSource: z.enum(["photo", "procedural", "none", "unknown"]).default("unknown"),
  textureScaleMm: z.number().finite().positive().optional(),
  surfaceMapping: DigitalViewingMaterialSurfaceMappingSchema.optional(),
  appearanceCalibration: DigitalViewingMaterialAppearanceCalibrationSchema.optional(),
  textureMaps: z.array(TextureMapSchema).default([]),
  provenance: z.enum(["measured", "specified", "photo_observed", "inferred", "unknown"]),
  confidence: ConfidenceSchema,
  photoSources: z.array(RelativePathSchema).default([]),
  notes: z.string().min(1).max(500).optional()
}).strict();
export type PbrMaterial = z.infer<typeof PbrMaterialSchema>;

export const ConditionEvidenceSchema = z.object({
  id: IdSchema,
  hostElementId: IdSchema.optional(),
  type: z.enum(["scratch", "dent", "stain", "crack", "fading", "oxidation", "patina", "seam", "repair", "wear", "unknown"]),
  severity: z.enum(["low", "medium", "high", "unknown"]).default("unknown"),
  locationHint: z.string().min(1).max(160),
  confidence: ConfidenceSchema,
  verification: VerificationSchema,
  source: z.enum(["photo", "user_note", "inspection"]),
  photoSources: z.array(RelativePathSchema).default([]),
  materialSurface: IdSchema.optional(),
  surfacePlacement: z.object({
    hostElementId: IdSchema,
    face: SurfaceFaceSchema,
    u: z.number().finite().min(0).max(1),
    v: z.number().finite().min(0).max(1),
    widthMm: z.number().finite().positive(),
    heightMm: z.number().finite().positive(),
    rotationDeg: z.number().finite().default(0)
  }).strict().optional(),
  notes: z.string().min(1).max(500).optional()
}).strict();
export type ConditionEvidence = z.infer<typeof ConditionEvidenceSchema>;

export const DigitalViewingConditionInspectionSchema = z.object({
  id: IdSchema,
  zone: IdSchema,
  hostElementId: IdSchema.optional(),
  materialCategory: PbrMaterialSchema.shape.category.optional(),
  status: z.enum(["clear", "defect-found", "not-inspected"]),
  verified: z.boolean(),
  sourcePhotos: z.array(RelativePathSchema).default([]),
  conditionIds: z.array(IdSchema).default([]),
  confidence: ConfidenceSchema,
  notes: z.string().min(1).max(500).optional()
}).strict();
export type DigitalViewingConditionInspection = z.infer<typeof DigitalViewingConditionInspectionSchema>;

export const DigitalViewingCaptureSchema = z.object({
  schemaVersion: z.literal(1),
  captureId: IdSchema,
  projectId: IdSchema,
  assetType: DigitalAssetTypeSchema,
  unit: z.literal("mm"),
  requiredSectors: z.array(z.string().min(1).max(80)).min(1),
  measurements: z.array(DigitalViewingMeasurementSchema).min(1),
  modelElements: z.array(DigitalViewingModelElementSchema).default([]),
  photos: z.array(DigitalViewingPhotoSchema).min(1),
  materials: z.array(PbrMaterialSchema).default([]),
  conditions: z.array(ConditionEvidenceSchema).default([]),
  conditionInspections: z.array(DigitalViewingConditionInspectionSchema).default([]),
  assumptions: z.array(z.object({
    id: IdSchema,
    text: z.string().min(1).max(500),
    affectsGeometry: z.boolean(),
    confidence: ConfidenceSchema
  }).strict()).default([]),
  outputTargets: z.array(DigitalViewingOutputTargetSchema).min(1)
}).strict();
export type DigitalViewingCapture = z.infer<typeof DigitalViewingCaptureSchema>;

export const DigitalViewingValidationResultSchema = z.object({
  ok: z.boolean(),
  blocking: z.array(z.object({
    id: z.string(),
    code: z.enum([
      "geometry_not_verified",
      "required_sector_missing",
      "required_sector_unverified",
      "material_source_missing",
      "condition_source_missing",
      "geometry_assumption_unverified"
    ]),
    message: z.string()
  }).strict()),
  warnings: z.array(z.object({
    id: z.string(),
    code: z.enum(["material_low_confidence", "condition_not_verified", "photo_not_authoritative", "material_inferred_or_unknown"]),
    message: z.string()
  }).strict())
}).strict();
export type DigitalViewingValidationResult = z.infer<typeof DigitalViewingValidationResultSchema>;

export const DigitalViewingDeliveryReadinessResultSchema = z.object({
  ok: z.boolean(),
  deliveryTier: DeliveryTierSchema,
  blocking: z.array(z.object({
    id: z.string(),
    code: z.enum([
      "geometry_not_verified",
      "required_sector_missing",
      "required_sector_unverified",
      "material_source_missing",
      "condition_source_missing",
      "geometry_assumption_unverified",
      "measurement_placement_missing",
      "measurement_tolerance_missing",
      "model_element_registry_missing",
      "measurement_host_unknown",
      "material_missing",
      "material_host_missing",
      "material_host_unknown",
      "material_source_photo_material_category_mismatch",
      "material_source_photo_face_mismatch",
      "material_surface_mapping_missing",
      "material_surface_mapping_source_photo_invalid",
      "material_surface_mapping_source_photo_face_mismatch",
      "material_appearance_calibration_missing",
      "material_appearance_calibration_illuminant_missing",
      "material_appearance_calibration_source_photo_invalid",
      "material_appearance_calibration_source_photo_face_mismatch",
      "material_appearance_calibration_photo_metadata_missing",
      "material_appearance_calibration_photo_normalization_missing",
      "material_appearance_calibration_material_category_mismatch",
      "material_appearance_calibration_reference_incompatible",
      "material_preset_missing",
      "texture_evidence_missing",
      "texture_source_missing",
      "condition_placement_missing",
      "condition_host_unknown",
      "condition_material_surface_missing",
      "condition_material_surface_unknown",
      "condition_surface_face_unmapped",
      "photo_resolution_missing",
      "condition_source_photo_material_category_mismatch",
      "condition_source_photo_face_mismatch",
      "condition_detail_photo_invalid",
      "condition_detail_photo_material_category_mismatch",
      "condition_detail_photo_resolution_too_low",
      "condition_detail_photo_quality_missing",
      "photo_capture_metadata_missing",
      "photo_angle_mismatch",
      "photo_camera_mode_mismatch",
      "photo_yaw_out_of_tolerance",
      "photo_pitch_missing",
      "photo_pitch_out_of_tolerance",
      "photo_camera_calibration_missing",
      "photo_coverage_mismatch",
      "photo_occluded",
      "photo_measured_endpoints_missing",
      "capture_preset_missing"
    ]),
    message: z.string()
  }).strict()),
  warnings: z.array(z.object({
    id: z.string(),
    code: z.enum([
      "material_low_confidence",
      "condition_not_verified",
      "photo_not_authoritative",
      "material_inferred_or_unknown",
      "texture_evidence_missing",
      "condition_placement_missing"
    ]),
    message: z.string()
  }).strict())
}).strict();
export type DigitalViewingDeliveryReadinessResult = z.infer<typeof DigitalViewingDeliveryReadinessResultSchema>;

export const DigitalViewingCapturePresetSchema = z.object({
  presetId: IdSchema,
  assetType: DigitalAssetTypeSchema,
  deliveryTier: DeliveryTierSchema,
  requiredSectors: z.array(z.string().min(1).max(80)).min(1),
  requiredMeasurements: z.array(IdSchema).min(1),
  requiredPhotoRoles: z.array(DigitalViewingPhotoSchema.shape.role).min(1),
  requiredMaterialCategories: z.array(PbrMaterialSchema.shape.category).default([]),
  requiredInspectionZones: z.array(IdSchema).default([]),
  conditionEvidenceRequired: z.boolean(),
  textureEvidenceRequired: z.boolean()
}).strict();
export type DigitalViewingCapturePreset = z.infer<typeof DigitalViewingCapturePresetSchema>;

export const DigitalViewingCapturePresetReadinessResultSchema = z.object({
  ok: z.boolean(),
  presetId: IdSchema,
  blocking: z.array(z.object({
    id: z.string(),
    code: z.enum([
      "asset_type_mismatch",
      "preset_delivery_tier_mismatch",
      "required_sector_missing",
      "required_photo_role_missing",
      "required_measurement_missing",
      "required_measurement_unverified",
      "required_material_category_missing",
      "required_material_surface_missing",
      "material_source_photo_material_category_mismatch",
      "material_capture_quality_missing",
      "texture_evidence_missing",
      "condition_evidence_missing",
      "photo_capture_metadata_missing",
      "photo_angle_mismatch",
      "photo_camera_mode_mismatch",
      "photo_yaw_out_of_tolerance",
      "photo_pitch_missing",
      "photo_pitch_out_of_tolerance",
      "photo_camera_calibration_missing",
      "photo_coverage_mismatch",
      "photo_occluded",
      "photo_measured_endpoints_missing",
      "required_inspection_zone_missing",
      "inspection_zone_unverified",
      "inspection_source_missing",
      "inspection_source_photo_invalid",
      "inspection_source_photo_material_category_mismatch",
      "inspection_source_photo_face_mismatch",
      "inspection_condition_evidence_missing"
    ]),
    message: z.string()
  }).strict()),
  warnings: z.array(z.object({
    id: z.string(),
    code: z.enum(["texture_evidence_missing", "condition_evidence_missing"]),
    message: z.string()
  }).strict())
}).strict();
export type DigitalViewingCapturePresetReadinessResult = z.infer<typeof DigitalViewingCapturePresetReadinessResultSchema>;

export const DigitalViewingCaptureRepairSectionSchema = z.enum(["measurements", "photos", "materials", "inspections", "conditions", "outputs"]);
export type DigitalViewingCaptureRepairSection = z.infer<typeof DigitalViewingCaptureRepairSectionSchema>;

export const DigitalViewingCaptureRepairSummarySchema = z.object({
  ready: z.boolean(),
  sections: z.array(z.object({
    section: DigitalViewingCaptureRepairSectionSchema,
    blockingCount: z.number().int().nonnegative(),
    blockingIds: z.array(z.string())
  }).strict())
}).strict();
export type DigitalViewingCaptureRepairSummary = z.infer<typeof DigitalViewingCaptureRepairSummarySchema>;

export const DigitalViewingCaptureGuideSchema = z.object({
  schemaVersion: z.literal(1),
  guideType: z.literal("digital-viewing-capture-guide"),
  presetId: IdSchema,
  assetType: DigitalAssetTypeSchema,
  deliveryTier: DeliveryTierSchema,
  sourceOfTruth: z.object({
    measurements: z.literal("primary-geometry-truth"),
    photos: z.literal("material-condition-context-reference"),
    guide: z.literal("capture-instructions-no-geometry-inference")
  }).strict(),
  requiredMeasurements: z.array(IdSchema),
  requiredMaterialCategories: z.array(PbrMaterialSchema.shape.category),
  requiredInspectionZones: z.array(IdSchema),
  conditionEvidenceRequired: z.boolean(),
  textureEvidenceRequired: z.boolean(),
  measurementChecklist: z.array(z.object({
    measurementId: IdSchema,
    required: z.literal(true),
    geometryAuthority: z.literal(true),
    verificationRequired: z.literal(true),
    placementRequired: z.boolean(),
    unit: DigitalViewingMeasurementSchema.shape.unit,
    instructions: z.array(z.string().min(1)).min(1)
  }).strict()),
  materialChecklist: z.array(z.object({
    category: PbrMaterialSchema.shape.category,
    required: z.literal(true),
    textureEvidenceRequired: z.boolean(),
    surfaceMappingRequired: z.boolean(),
    appearanceCalibrationRequired: z.boolean(),
    requiredMaps: z.array(TextureMapTypeSchema),
    materialSurfaces: z.array(IdSchema).min(1),
    captureQualityProfile: z.array(MaterialCaptureQualityProfileRequirementSchema).min(1),
    instructions: z.array(z.string().min(1)).min(1)
  }).strict()),
  inspectionChecklist: z.array(z.object({
    zone: IdSchema,
    required: z.literal(true),
    allowedStatuses: z.array(DigitalViewingConditionInspectionSchema.shape.status).min(1),
    sourcePhotosRequired: z.boolean(),
    conditionEvidenceRequiredWhenDefectFound: z.boolean(),
    conditionCaptureQualityProfile: z.array(ConditionCaptureQualityProfileRequirementSchema).min(1),
    instructions: z.array(z.string().min(1)).min(1)
  }).strict()),
  shotList: z.array(z.object({
    shotId: IdSchema,
    sector: z.string().min(1).max(80),
    requiredRoles: z.array(DigitalViewingPhotoSchema.shape.role).min(1),
    required: z.literal(true),
    anchorsRecommended: z.boolean(),
    purpose: z.enum(["geometry-alignment", "material-evidence", "condition-evidence", "context-review"]),
    captureRequirements: z.object({
      angleType: CaptureAngleTypeSchema,
      cameraMode: CaptureCameraModeSchema,
      targetYawDeg: z.number().finite().min(-180).max(180).optional(),
      yawToleranceDeg: z.number().finite().positive().max(90).optional(),
      pitchGuidance: CapturePitchGuidanceSchema,
      lensGuidance: CaptureLensGuidanceSchema,
      coverage: CaptureCoverageSchema,
      occlusionPolicy: CaptureOcclusionPolicySchema,
      measuredEndpointsVisible: z.boolean(),
      textureEvidenceRequired: z.boolean(),
      notes: z.array(z.string().min(1)).default([])
    }).strict(),
    instructions: z.array(z.string().min(1)).min(1)
  }).strict()),
  invariants: z.array(z.string().min(1)).min(1)
}).strict();
export type DigitalViewingCaptureGuide = z.infer<typeof DigitalViewingCaptureGuideSchema>;

export const DigitalViewingRenderPresetSchema = z.object({
  presetId: IdSchema,
  deliveryTier: DeliveryTierSchema.default("standard-viewing"),
  renderer: z.enum(["cycles", "eevee"]),
  resolution: z.object({
    width: z.number().int().positive().max(16384),
    height: z.number().int().positive().max(16384)
  }).strict(),
  camera: z.object({
    mode: z.enum(["perspective", "orthographic"]),
    sector: z.string().min(1).max(80),
    focalLengthMm: z.number().finite().positive().optional(),
    orthoScaleMm: z.number().finite().positive().optional(),
    referencePhoto: RelativePathSchema.optional()
  }).strict(),
  lighting: z.object({
    environment: z.enum(["studio", "overcast", "site-reference", "neutral"]),
    colorTemperatureK: z.number().int().min(1000).max(20000).default(6500),
    intensity: z.number().finite().positive().default(1),
    referencePhoto: RelativePathSchema.optional()
  }).strict(),
  outputPath: RenderImageOutputPathSchema
}).strict();
export type DigitalViewingRenderPreset = z.infer<typeof DigitalViewingRenderPresetSchema>;

export const DigitalViewingRenderManifestSchema = z.object({
  schemaVersion: z.literal(1),
  captureId: IdSchema,
  projectId: IdSchema,
  assetType: DigitalAssetTypeSchema,
  outputClassification: z.object({
    purpose: z.literal("photorealistic-preview"),
    authority: z.literal("preview-only"),
    previewOnly: z.literal(true),
    permitSourceOfTruth: z.literal(false),
    geometryAuthority: z.literal(false),
    validationStatus: z.literal("not-separately-validated")
  }).strict(),
  notGeometryAuthority: z.literal(true),
  sourceOfTruth: z.object({
    geometry: z.literal("verified-measurements"),
    visualEvidence: z.literal("structured-photos-material-condition-context"),
    renderableTruth: z.literal("locked-blender-geometry-required"),
    exportStage: z.literal("formatting-only-no-geometry-reconstruction")
  }).strict(),
  capabilityManifest: CapabilityManifestSchema,
  capturePreset: DigitalViewingCapturePresetSchema,
  hashes: z.object({
    captureHash: z.string().length(64),
    geometryHash: z.string().length(64),
    materialConditionHash: z.string().length(64),
    materialAuthoringPlanHash: z.string().length(64),
    presetHash: z.string().length(64),
    manifestHash: z.string().length(64).optional()
  }).strict(),
  renderPreset: DigitalViewingRenderPresetSchema,
  cameraReference: z.object({
    sourceOfTruth: z.literal("derived-from-verified-capture-photo-camera-metadata"),
    referencePhoto: RelativePathSchema,
    sector: z.string().min(1).max(80),
    cameraMode: DigitalViewingRenderPresetSchema.shape.camera.shape.mode,
    focalLength35mmEquivalent: z.number().finite().positive(),
    cameraDistanceMm: z.number().finite().positive()
  }).strict().optional(),
  lightingReference: z.object({
    sourceOfTruth: z.literal("derived-from-verified-capture-photo-lighting-metadata"),
    referencePhoto: RelativePathSchema,
    sector: z.string().min(1).max(80),
    lightingReference: CaptureLightingReferenceSchema,
    colorReference: CaptureColorReferenceSchema,
    whiteBalanceKelvin: z.number().finite().positive().min(1000).max(40000),
    exposureEv: z.number().finite()
  }).strict().optional(),
  modelElements: z.array(DigitalViewingModelElementSchema),
  measurementAnchors: z.array(z.object({
    measurementId: IdSchema,
    hostElementId: IdSchema,
    axis: DigitalViewingMeasurementPlacementSchema.shape.axis,
    referenceFrame: DigitalViewingMeasurementPlacementSchema.shape.referenceFrame,
    value: DigitalViewingMeasurementSchema.shape.value,
    unit: DigitalViewingMeasurementSchema.shape.unit,
    tolerance: DigitalViewingMeasurementSchema.shape.tolerance,
    sourceOfTruth: z.literal("declared-measurement-value-used-by-blender")
  }).strict()),
  materials: z.array(z.object({
    materialId: IdSchema,
    hostElementId: IdSchema.optional(),
    presetId: MaterialPresetIdSchema.optional(),
    category: PbrMaterialSchema.shape.category,
    provenance: PbrMaterialSchema.shape.provenance,
    confidence: ConfidenceSchema,
    materialSurfaces: z.array(IdSchema),
    photoSources: z.array(RelativePathSchema),
    pbr: z.object({
      baseColor: z.string().optional(),
      roughness: z.number().optional(),
      metallic: z.number().optional(),
      specular: z.number().optional(),
      transmission: z.number().optional(),
      normalSource: PbrMaterialSchema.shape.normalSource,
      textureScaleMm: z.number().optional()
    }).strict(),
    surfaceMapping: DigitalViewingMaterialSurfaceMappingSchema.optional(),
    appearanceCalibration: DigitalViewingMaterialAppearanceCalibrationSchema.optional(),
    textureMaps: z.array(TextureMapSchema)
  }).strict()),
  conditions: z.array(z.object({
    id: IdSchema,
    hostElementId: IdSchema.optional(),
    type: ConditionEvidenceSchema.shape.type,
    severity: ConditionEvidenceSchema.shape.severity,
    confidence: ConfidenceSchema,
    verification: VerificationSchema,
    source: ConditionEvidenceSchema.shape.source,
    photoSources: z.array(RelativePathSchema),
    materialSurface: ConditionEvidenceSchema.shape.materialSurface,
    surfacePlacement: ConditionEvidenceSchema.shape.surfacePlacement
  }).strict()),
  conditionVisibilityChecklist: z.array(z.object({
    conditionId: IdSchema,
    hostElementId: IdSchema.optional(),
    type: ConditionEvidenceSchema.shape.type,
    severity: ConditionEvidenceSchema.shape.severity,
    verification: VerificationSchema,
    mustBeVisible: z.boolean(),
    sourceOfTruth: z.literal("verified-condition-evidence"),
    sourcePhotos: z.array(RelativePathSchema),
    inspectionZones: z.array(IdSchema),
    materialSurface: ConditionEvidenceSchema.shape.materialSurface,
    surfacePlacement: ConditionEvidenceSchema.shape.surfacePlacement
  }).strict()),
  conditionInspections: z.array(z.object({
    id: IdSchema,
    zone: IdSchema,
    hostElementId: IdSchema.optional(),
    materialCategory: PbrMaterialSchema.shape.category.optional(),
    status: DigitalViewingConditionInspectionSchema.shape.status,
    verified: z.boolean(),
    sourcePhotos: z.array(RelativePathSchema),
    conditionIds: z.array(IdSchema),
    confidence: ConfidenceSchema
  }).strict()),
  warnings: z.array(z.string()),
  blenderExecution: z.object({
    measurementApplication: z.object({
      applied: z.array(z.object({
        measurementId: IdSchema,
        hostElementId: IdSchema,
        referenceFrame: DigitalViewingMeasurementPlacementSchema.shape.referenceFrame,
        value: DigitalViewingMeasurementSchema.shape.value.optional(),
        unit: DigitalViewingMeasurementSchema.shape.unit.optional(),
        tolerance: DigitalViewingMeasurementSchema.shape.tolerance,
        sourceOfTruth: z.literal("declared-measurement-value-used-by-blender").optional()
      }).strict()).default([])
    }).strict().optional(),
    assetBundle: z.object({
      manifestType: z.literal("digital-viewing-asset-bundle"),
      ready: z.boolean(),
      assetBundleHash: z.string().length(64),
      requiredCount: z.number().int().nonnegative(),
      missingCount: z.number().int().nonnegative(),
      verifiedContentCount: z.number().int().nonnegative().optional()
    }).strict().optional(),
    renderQuality: z.object({
      renderer: DigitalViewingRenderPresetSchema.shape.renderer,
      samples: z.number().int().positive().optional(),
      denoise: z.boolean().optional(),
      resolution: DigitalViewingRenderPresetSchema.shape.resolution,
      filmTransparent: z.boolean(),
      viewTransform: z.string().min(1).max(120).optional(),
      look: z.string().min(1).max(120).optional(),
      exposure: z.number().finite().optional(),
      gamma: z.number().finite().positive().optional(),
      worldColor: HexColorSchema.optional()
    }).strict().optional(),
    renderArtifact: z.object({
      path: RelativePathSchema,
      sizeBytes: z.number().int().nonnegative(),
      sha256: z.string().length(64),
      width: z.number().int().positive().optional(),
      height: z.number().int().positive().optional()
    }).strict().optional()
  }).passthrough().optional(),
  artifacts: z.object({
    render: RelativePathSchema,
    manifest: RelativePathSchema
  }).strict()
}).strict();
export type DigitalViewingRenderManifest = z.infer<typeof DigitalViewingRenderManifestSchema>;

export const DigitalViewingMaterialConditionReportSchema = z.object({
  schemaVersion: z.literal(1),
  reportType: z.literal("material-condition-report"),
  captureId: IdSchema,
  projectId: IdSchema,
  assetType: DigitalAssetTypeSchema,
  deliveryTier: DeliveryTierSchema,
  notGeometryAuthority: z.literal(true),
  sourceOfTruth: z.object({
    measurements: z.literal("geometry-and-scale"),
    photos: z.literal("material-condition-context-evidence"),
    blender: z.literal("renderable-truth-when-locked"),
    report: z.literal("evidence-summary-no-geometry-reconstruction")
  }).strict(),
  readiness: DigitalViewingDeliveryReadinessResultSchema,
  measurements: z.array(z.object({
    id: IdSchema,
    label: z.string(),
    value: z.number(),
    tolerance: DigitalViewingMeasurementSchema.shape.tolerance,
    unit: DigitalViewingMeasurementSchema.shape.unit,
    confidence: ConfidenceSchema,
    source: DigitalViewingMeasurementSchema.shape.source,
    placement: DigitalViewingMeasurementPlacementSchema.optional()
  }).strict()),
  photoEvidence: z.array(z.object({
    path: RelativePathSchema,
    sector: z.string(),
    role: DigitalViewingPhotoSchema.shape.role,
    verified: z.boolean(),
    materialCategories: z.array(MaterialCategorySchema)
  }).strict()),
  materials: z.array(z.object({
    materialId: IdSchema,
    hostElementId: IdSchema.optional(),
    category: PbrMaterialSchema.shape.category,
    presetId: MaterialPresetIdSchema.optional(),
    provenance: PbrMaterialSchema.shape.provenance,
    confidence: ConfidenceSchema,
    materialSurfaces: z.array(IdSchema),
    photoSources: z.array(RelativePathSchema),
    pbr: z.object({
      baseColor: z.string().optional(),
      roughness: z.number().optional(),
      metallic: z.number().optional(),
      specular: z.number().optional(),
      transmission: z.number().optional(),
      normalSource: PbrMaterialSchema.shape.normalSource,
      textureScaleMm: z.number().optional()
    }).strict(),
    surfaceMapping: DigitalViewingMaterialSurfaceMappingSchema.optional(),
    appearanceCalibration: DigitalViewingMaterialAppearanceCalibrationSchema.optional(),
    textureMaps: z.array(z.object({
      type: TextureMapTypeSchema,
      path: RelativePathSchema,
      provenance: TextureMapSchema.shape.provenance,
      confidence: ConfidenceSchema,
      sourcePhoto: RelativePathSchema.optional(),
      renderStatus: z.enum(["declared", "applied", "missing", "skipped"])
    }).strict())
  }).strict()),
  conditions: z.array(z.object({
    id: IdSchema,
    hostElementId: IdSchema.optional(),
    type: ConditionEvidenceSchema.shape.type,
    severity: ConditionEvidenceSchema.shape.severity,
    confidence: ConfidenceSchema,
    verification: VerificationSchema,
    source: ConditionEvidenceSchema.shape.source,
    photoSources: z.array(RelativePathSchema),
    sourcePhotoEvidence: z.array(z.object({
      path: RelativePathSchema,
      verified: z.boolean(),
      materialCategories: z.array(MaterialCategorySchema)
    }).strict()),
    materialSurface: ConditionEvidenceSchema.shape.materialSurface,
    surfacePlacement: ConditionEvidenceSchema.shape.surfacePlacement,
    renderStatus: z.enum(["declared", "overlay-applied", "missing-host", "skipped"])
  }).strict()),
  conditionVisibilityChecklist: z.array(z.object({
    conditionId: IdSchema,
    hostElementId: IdSchema.optional(),
    type: ConditionEvidenceSchema.shape.type,
    severity: ConditionEvidenceSchema.shape.severity,
    verification: VerificationSchema,
    mustBeVisible: z.boolean(),
    sourceOfTruth: z.literal("verified-condition-evidence"),
    sourcePhotos: z.array(RelativePathSchema),
    sourcePhotoEvidence: z.array(z.object({
      path: RelativePathSchema,
      verified: z.boolean(),
      materialCategories: z.array(MaterialCategorySchema)
    }).strict()),
    inspectionZones: z.array(IdSchema),
    materialSurface: ConditionEvidenceSchema.shape.materialSurface,
    surfacePlacement: ConditionEvidenceSchema.shape.surfacePlacement,
    renderStatus: z.enum(["declared", "overlay-applied", "missing-host", "skipped"])
  }).strict()),
  conditionInspections: z.array(z.object({
    id: IdSchema,
    zone: IdSchema,
    hostElementId: IdSchema.optional(),
    materialCategory: PbrMaterialSchema.shape.category.optional(),
    status: DigitalViewingConditionInspectionSchema.shape.status,
    verified: z.boolean(),
    sourcePhotos: z.array(RelativePathSchema),
    sourcePhotoEvidence: z.array(z.object({
      path: RelativePathSchema,
      sector: z.string(),
      role: DigitalViewingPhotoSchema.shape.role,
      verified: z.boolean(),
      materialCategories: z.array(MaterialCategorySchema)
    }).strict()),
    conditionIds: z.array(IdSchema),
    confidence: ConfidenceSchema
  }).strict()),
  hashes: z.object({
    captureHash: z.string().length(64),
    reportHash: z.string().length(64).optional()
  }).strict()
}).strict();
export type DigitalViewingMaterialConditionReport = z.infer<typeof DigitalViewingMaterialConditionReportSchema>;

export const DigitalViewingMaterialAuthoringPlanSchema = z.object({
  schemaVersion: z.literal(1),
  planType: z.literal("material-authoring-plan"),
  captureId: IdSchema,
  projectId: IdSchema,
  assetType: DigitalAssetTypeSchema,
  deliveryTier: DeliveryTierSchema,
  notGeometryAuthority: z.literal(true),
  sourceOfTruth: z.object({
    measurements: z.literal("geometry-and-scale-only"),
    photos: z.literal("material-texture-condition-evidence"),
    plan: z.literal("pre-render-authoring-requirements-no-geometry-reconstruction")
  }).strict(),
  materials: z.array(z.object({
    materialId: IdSchema,
    hostElementId: IdSchema.optional(),
    category: PbrMaterialSchema.shape.category,
    presetId: MaterialPresetIdSchema.optional(),
    provenance: PbrMaterialSchema.shape.provenance,
    confidence: ConfidenceSchema,
    materialSurfaces: z.array(IdSchema),
    surfaceMapping: DigitalViewingMaterialSurfaceMappingSchema.optional(),
    appearanceCalibration: DigitalViewingMaterialAppearanceCalibrationSchema.optional(),
    requiredMaps: z.array(TextureMapTypeSchema),
    presentMaps: z.array(TextureMapTypeSchema),
    missingMaps: z.array(TextureMapTypeSchema),
    pbrFields: z.object({
      baseColor: z.enum(["declared", "missing"]),
      roughness: z.enum(["declared", "missing"]),
      metallic: z.enum(["declared", "missing"]),
      specular: z.enum(["declared", "missing"]),
      transmission: z.enum(["declared", "missing"]),
      normalSource: z.enum(["declared", "missing"]),
      textureScaleMm: z.enum(["declared", "missing"])
    }).strict(),
    sourcePhotos: z.array(RelativePathSchema),
    textureSources: z.array(z.object({
      type: TextureMapTypeSchema,
      path: RelativePathSchema,
      confidence: ConfidenceSchema,
      scaleMm: z.number().finite().positive().optional(),
      pixelWidth: z.number().int().positive().optional(),
      pixelHeight: z.number().int().positive().optional(),
      sourcePhoto: RelativePathSchema.optional()
    }).strict()),
    authoringStatus: z.enum(["ready", "incomplete"]),
    blocking: z.array(z.object({
      id: z.string(),
      code: z.enum([
        "required_texture_map_missing",
        "texture_source_missing",
        "texture_source_photo_invalid",
        "texture_source_photo_face_mismatch",
        "texture_scale_missing",
        "texture_resolution_missing",
        "texture_color_space_invalid",
        "material_host_missing",
        "material_preset_missing",
        "material_source_photo_material_category_mismatch",
        "material_source_photo_face_mismatch",
        "material_surface_mapping_missing",
        "material_surface_mapping_source_photo_invalid",
        "material_surface_mapping_source_photo_face_mismatch",
        "material_appearance_calibration_missing",
        "material_appearance_calibration_illuminant_missing",
        "material_appearance_calibration_source_photo_invalid",
        "material_appearance_calibration_source_photo_face_mismatch",
        "material_appearance_calibration_photo_metadata_missing",
        "material_appearance_calibration_photo_normalization_missing",
        "material_appearance_calibration_material_category_mismatch",
        "material_appearance_calibration_reference_incompatible"
      ]),
      message: z.string()
    }).strict()),
    warnings: z.array(z.object({
      id: z.string(),
      code: z.enum(["material_low_confidence", "photo_evidence_missing", "procedural_or_unknown_normal", "texture_maps_not_required_for_tier"]),
      message: z.string()
    }).strict())
  }).strict()),
  summary: z.object({
    ready: z.boolean(),
    blockingCount: z.number().int().nonnegative(),
    warningCount: z.number().int().nonnegative()
  }).strict(),
  hashes: z.object({
    captureHash: z.string().length(64),
    planHash: z.string().length(64).optional()
  }).strict()
}).strict();
export type DigitalViewingMaterialAuthoringPlan = z.infer<typeof DigitalViewingMaterialAuthoringPlanSchema>;

export const DigitalViewingDeliveryPackageTargetSchema = z.object({
  target: DigitalViewingOutputTargetSchema,
  required: z.boolean(),
  status: z.enum(["ready", "missing", "not-requested"]),
  artifactType: z.enum(["render", "render-manifest", "asset-bundle-manifest", "material-authoring-plan", "material-condition-report", "blend", "glb", "usdz", "web-viewer", "technical-views"]).optional(),
  path: RelativePathSchema.optional(),
  hash: z.string().length(64).optional(),
  message: z.string().min(1).max(240)
}).strict();
export type DigitalViewingDeliveryPackageTarget = z.infer<typeof DigitalViewingDeliveryPackageTargetSchema>;

export const DigitalViewingDeliveryArtifactSchema = z.object({
  target: DigitalViewingOutputTargetSchema,
  path: RelativePathSchema,
  hash: z.string().length(64).optional()
}).strict();
export type DigitalViewingDeliveryArtifact = z.infer<typeof DigitalViewingDeliveryArtifactSchema>;

export const DigitalViewingAssetBundleManifestObjectSchema = z.object({
  schemaVersion: z.literal(1),
  manifestType: z.literal("digital-viewing-asset-bundle"),
  captureId: IdSchema,
  projectId: IdSchema,
  assetType: DigitalAssetTypeSchema,
  deliveryTier: DeliveryTierSchema,
  notGeometryAuthority: z.literal(true),
  sourceOfTruth: z.object({
    measurements: z.literal("geometry-scale-placement"),
    photos: z.literal("material-condition-context-evidence-files"),
    textures: z.literal("material-finish-evidence-files"),
    bundle: z.literal("pre-render-file-readiness-no-geometry-reconstruction")
  }).strict(),
  assets: z.array(z.object({
    path: RelativePathSchema,
    assetType: z.enum(["photo", "texture", "render-output"]),
    required: z.boolean(),
    status: z.enum(["present", "missing", "expected"]),
    sizeBytes: z.number().int().nonnegative().optional(),
    sha256: z.string().length(64).optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    usedBy: z.array(z.string().min(1)).min(1)
  }).strict()),
  summary: z.object({
    ready: z.boolean(),
    requiredCount: z.number().int().nonnegative(),
    missingCount: z.number().int().nonnegative(),
    warningCount: z.number().int().nonnegative()
  }).strict(),
  qualityGates: z.object({
    ready: z.boolean(),
    blocking: z.array(z.object({
      id: RelativePathSchema,
      code: z.enum(["asset_file_missing"]),
      message: z.string()
    }).strict()),
    warnings: z.array(z.object({
      id: RelativePathSchema,
      code: z.enum(["asset_optional_missing"]),
      message: z.string()
    }).strict())
  }).strict(),
  hashes: z.object({
    captureHash: z.string().length(64),
    renderManifestHash: z.string().length(64),
    assetBundleHash: z.string().length(64).optional()
  }).strict()
}).strict();
export const DigitalViewingAssetBundleManifestSchema = DigitalViewingAssetBundleManifestObjectSchema.superRefine((manifest, ctx) => {
  const requiredAssetCount = manifest.assets.filter((asset) => asset.required).length;
  const missingRequiredAssets = manifest.assets.filter((asset) => asset.required && asset.status === "missing");
  const blockingCount = manifest.qualityGates.blocking.length;
  const expectedReady = missingRequiredAssets.length === 0 && blockingCount === 0;

  if (manifest.summary.requiredCount !== requiredAssetCount) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["summary", "requiredCount"],
      message: `assetBundle summary requiredCount must equal required assets: expected ${requiredAssetCount}, received ${manifest.summary.requiredCount}`
    });
  }

  if (manifest.summary.missingCount !== missingRequiredAssets.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["summary", "missingCount"],
      message: `assetBundle summary missingCount must equal missing required assets: expected ${missingRequiredAssets.length}, received ${manifest.summary.missingCount}`
    });
  }

  if (manifest.summary.ready !== expectedReady || manifest.qualityGates.ready !== expectedReady) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["qualityGates", "ready"],
      message: `assetBundle ready flags must match missing assets and blocking gates: expected ${expectedReady}`
    });
  }

  if (manifest.hashes.assetBundleHash) {
    const hashesWithoutBundleHash = {
      captureHash: manifest.hashes.captureHash,
      renderManifestHash: manifest.hashes.renderManifestHash
    };
    const manifestCandidateWithoutHash = {
      schemaVersion: manifest.schemaVersion,
      manifestType: manifest.manifestType,
      captureId: manifest.captureId,
      projectId: manifest.projectId,
      assetType: manifest.assetType,
      deliveryTier: manifest.deliveryTier,
      notGeometryAuthority: manifest.notGeometryAuthority,
      sourceOfTruth: manifest.sourceOfTruth,
      assets: manifest.assets,
      summary: manifest.summary,
      qualityGates: manifest.qualityGates
    };
    const manifestWithoutHash = DigitalViewingAssetBundleManifestObjectSchema.omit({ hashes: true }).parse(manifestCandidateWithoutHash);
    const expectedAssetBundleHash = contractSha256({
      ...manifestWithoutHash,
      hashes: hashesWithoutBundleHash
    });
    if (manifest.hashes.assetBundleHash !== expectedAssetBundleHash) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["hashes", "assetBundleHash"],
        message: "assetBundleHash must match manifest contents"
      });
    }
  }
});
export type DigitalViewingAssetBundleManifest = z.infer<typeof DigitalViewingAssetBundleManifestSchema>;

export const DigitalViewingDeliveryProfileSchema = z.object({
  profileId: IdSchema,
  customerSurface: DigitalViewingCustomerSurfaceSchema,
  positioning: z.string().min(1).max(240),
  requiredTargets: z.array(DigitalViewingOutputTargetSchema).min(1),
  optionalTargets: z.array(DigitalViewingOutputTargetSchema).default([]),
  notGeometryAuthority: z.literal(true),
  sourceOfTruth: z.object({
    measurements: z.literal("geometry-scale-placement"),
    photos: z.literal("material-condition-context-evidence"),
    blender: z.literal("locked-renderable-scene"),
    profile: z.literal("customer-surface-target-contract-no-geometry-reconstruction")
  }).strict()
}).strict();
export type DigitalViewingDeliveryProfile = z.infer<typeof DigitalViewingDeliveryProfileSchema>;

export const DigitalViewingDeliveryProfileReadinessResultSchema = z.object({
  ok: z.boolean(),
  customerSurface: DigitalViewingCustomerSurfaceSchema,
  profileId: IdSchema,
  requiredTargets: z.array(z.object({
    target: DigitalViewingOutputTargetSchema,
    declaredInCapture: z.boolean()
  }).strict()),
  optionalTargets: z.array(z.object({
    target: DigitalViewingOutputTargetSchema,
    declaredInCapture: z.boolean()
  }).strict()),
  blocking: z.array(z.object({
    id: z.string(),
    code: z.enum(["profile_target_not_declared"]),
    message: z.string()
  }).strict()),
  warnings: z.array(z.object({
    id: z.string(),
    code: z.enum(["optional_profile_target_not_declared"]),
    message: z.string()
  }).strict())
}).strict();
export type DigitalViewingDeliveryProfileReadinessResult = z.infer<typeof DigitalViewingDeliveryProfileReadinessResultSchema>;

export const DigitalViewingDeliveryPackageManifestObjectSchema = z.object({
  schemaVersion: z.literal(1),
  packageType: z.literal("digital-viewing-delivery-package"),
  captureId: IdSchema,
  projectId: IdSchema,
  assetType: DigitalAssetTypeSchema,
  deliveryTier: DeliveryTierSchema,
  customerSurface: DigitalViewingCustomerSurfaceSchema,
  notGeometryAuthority: z.literal(true),
  sourceOfTruth: z.object({
    measurements: z.literal("geometry-scale-placement"),
    photos: z.literal("material-condition-context-evidence"),
    blender: z.literal("locked-renderable-scene"),
    package: z.literal("delivery-index-no-geometry-reconstruction")
  }).strict(),
  includedArtifacts: z.array(z.object({
    artifactType: z.enum(["render", "render-manifest", "asset-bundle-manifest", "material-authoring-plan", "material-condition-report"]),
    path: RelativePathSchema.optional(),
    hash: z.string().length(64).optional(),
    required: z.boolean()
  }).strict()),
  deliveryTargets: z.array(DigitalViewingDeliveryPackageTargetSchema),
  sourceTraceIndex: z.object({
    sourceOfTruth: z.literal("derived-from-existing-package-coverage-without-geometry-reconstruction"),
    entryCount: z.number().int().nonnegative(),
    entries: z.array(z.object({
      sourceId: IdSchema,
      sourceType: z.enum(["capture-shot", "measurement", "material", "condition", "delivery-target"]),
      sourceCoverage: z.enum([
        "captureAngleCoverage",
        "dimensionOverlayCoverage",
        "pbrMaterialCompletenessCoverage",
        "materialRenderCoverage+pbrMaterialCompletenessCoverage",
        "conditionOverlayCoverage",
        "deliveryTargets"
      ]),
      label: z.string().min(1).max(200),
      status: z.enum(["matched", "missing", "mismatched", "ready", "blocked", "complete", "incomplete", "not-requested"]),
      path: RelativePathSchema.optional(),
      hash: z.string().length(64).optional(),
      evidencePaths: z.array(RelativePathSchema).optional()
    }).strict())
  }).strict(),
  customerReadinessSummary: z.object({
    customerSurface: DigitalViewingCustomerSurfaceSchema,
    status: z.enum(["ready", "blocked"]),
    requiredTargetCount: z.number().int().nonnegative(),
    readyRequiredTargetCount: z.number().int().nonnegative(),
    missingRequiredTargetCount: z.number().int().nonnegative(),
    qualityCheckCount: z.number().int().nonnegative(),
    passedQualityCheckCount: z.number().int().nonnegative(),
    failedQualityCheckCount: z.number().int().nonnegative(),
    blockingCount: z.number().int().nonnegative(),
    warningCount: z.number().int().nonnegative(),
    nextActions: z.array(z.string().min(1).max(240)),
    sourceOfTruth: z.literal("derived-from-delivery-targets-quality-checks-gates-asset-bundle-render-execution-photo-evidence-capture-angles-material-categories-material-calibration-pbr-materials-material-render-material-character-inspection-zones-condition-render-condition-overlays-render-quality-and-reference-comparison")
  }).strict(),
  evidenceHealthSummary: z.object({
    sourceOfTruth: z.literal("derived-from-source-trace-index-quality-gates-and-customer-readiness"),
    status: z.enum(["ready", "blocked"]),
    indexedSourceCount: z.number().int().nonnegative(),
    readyEvidenceCount: z.number().int().nonnegative(),
    blockedEvidenceCount: z.number().int().nonnegative(),
    missingEvidenceCount: z.number().int().nonnegative(),
    evidencePathCount: z.number().int().nonnegative(),
    warningCount: z.number().int().nonnegative(),
    sections: z.array(z.object({
      section: z.enum(["capture-shots", "measurements", "materials", "conditions", "delivery-targets"]),
      status: z.enum(["ready", "blocked"]),
      indexedSourceCount: z.number().int().nonnegative(),
      readyEvidenceCount: z.number().int().nonnegative(),
      blockedEvidenceCount: z.number().int().nonnegative(),
      missingEvidenceCount: z.number().int().nonnegative(),
      evidencePathCount: z.number().int().nonnegative()
    }).strict())
  }).strict(),
  renderQualityCoverage: z.object({
    sourceOfTruth: z.literal("derived-from-render-preset-and-blender-render-settings"),
    status: z.enum(["ready", "blocked", "missing-execution"]),
    declared: z.object({
      assetType: DigitalAssetTypeSchema,
      renderer: DigitalViewingRenderPresetSchema.shape.renderer,
      resolution: DigitalViewingRenderPresetSchema.shape.resolution,
      deliveryTier: DeliveryTierSchema,
      qualityProfile: z.object({
        minWidth: z.number().int().positive(),
        minHeight: z.number().int().positive()
      }).strict()
    }).strict(),
    executed: z.object({
      renderer: DigitalViewingRenderPresetSchema.shape.renderer.optional(),
      samples: z.number().int().positive().optional(),
      denoise: z.boolean().optional(),
      resolution: DigitalViewingRenderPresetSchema.shape.resolution.optional(),
      filmTransparent: z.boolean().optional(),
      viewTransform: z.string().min(1).max(120).optional(),
      look: z.string().min(1).max(120).optional(),
      exposure: z.number().finite().optional(),
      gamma: z.number().finite().positive().optional(),
      worldColor: HexColorSchema.optional()
    }).strict(),
    checks: z.array(z.object({
      check: z.enum(["renderer", "sampling", "resolution", "color-management", "background"]),
      status: z.enum(["passed", "failed"]),
      evidence: z.string().min(1).max(240)
    }).strict())
  }).strict(),
  renderReferenceComparisonCoverage: z.object({
    sourceOfTruth: z.literal("derived-from-render-artifact-reference-photo-and-blender-comparison-metadata"),
    required: z.boolean(),
    referencePhoto: RelativePathSchema.optional(),
    renderPath: RelativePathSchema,
    method: z.enum(["reference-metadata-alignment", "average-color-rmse", "luma-grid-rmse", "ssim", "pixel-diff", "feature-alignment"]).optional(),
    comparisonMethodTier: z.enum(["none", "metadata-only", "color-only", "structural", "perceptual"]),
    requiredComparisonMethodTier: z.enum(["structural", "perceptual"]),
    comparisonMethodTierStatus: z.enum(["satisfies-required", "below-required", "not-required"]),
    score: z.number().finite().min(0).max(1).optional(),
    threshold: z.number().finite().min(0).max(1).optional(),
    minimumRequiredThreshold: z.number().finite().min(0).max(1),
    status: z.enum(["matched", "mismatched", "missing-execution", "not-required"]),
    evidence: z.string().min(1).max(240)
  }).strict(),
  viewerLayerCoverage: z.object({
    sourceOfTruth: z.literal("derived-from-delivery-targets-render-evidence-overlays-and-condition-report"),
    layerCount: z.number().int().nonnegative(),
    readyLayerCount: z.number().int().nonnegative(),
    blockedLayerCount: z.number().int().nonnegative(),
    notRequestedLayerCount: z.number().int().nonnegative(),
    entries: z.array(z.object({
      layer: z.enum(["photoreal-scene", "material-fidelity", "condition-disclosure", "dimension-overlays", "web-delivery"]),
      required: z.boolean(),
      status: z.enum(["ready", "blocked", "not-requested"]),
      sourceIds: z.array(IdSchema),
      evidence: z.string().min(1).max(240)
    }).strict())
  }).strict(),
  customerViewingChecklist: z.object({
    sourceOfTruth: z.literal("derived-from-capture-angles-materials-dimensions-conditions-render-quality-and-delivery-targets"),
    ready: z.boolean(),
    itemCount: z.number().int().nonnegative(),
    readyItemCount: z.number().int().nonnegative(),
    blockedItemCount: z.number().int().nonnegative(),
    notRequestedItemCount: z.number().int().nonnegative(),
    items: z.array(z.object({
      item: z.enum(["reference-photos", "dimension-overlays", "material-fidelity", "condition-disclosure", "photoreal-render", "model-artifact", "web-model"]),
      category: z.enum(["capture", "measurements", "materials", "conditions", "render", "delivery"]),
      sourceCoverage: z.enum([
        "captureAngleCoverage",
        "dimensionOverlayCoverage",
        "materialCalibrationCoverage+pbrMaterialCompletenessCoverage",
        "materialRenderCoverage+materialCalibrationCoverage+pbrMaterialCompletenessCoverage",
        "conditionInspectionCoverage+conditionOverlayCoverage",
        "renderQualityCoverage",
        "deliveryTargets"
      ]),
      required: z.boolean(),
      status: z.enum(["ready", "blocked", "not-requested"]),
      sourceIds: z.array(IdSchema),
      evidence: z.string().min(1).max(240)
    }).strict())
  }).strict(),
  photoEvidenceCoverage: z.object({
    sourceOfTruth: z.literal("derived-from-capture-photos-render-preset-materials-textures-and-conditions"),
    verifiedPhotoCount: z.number().int().nonnegative(),
    evidenceCount: z.number().int().nonnegative(),
    missingEvidenceCount: z.number().int().nonnegative(),
    entries: z.array(z.object({
      usage: z.enum([
        "camera-reference",
        "lighting-reference",
        "material-source",
        "surface-mapping",
        "appearance-calibration",
        "texture-source",
        "condition-evidence",
        "inspection-source"
      ]),
      targetId: z.string().min(1).max(160),
      path: RelativePathSchema,
      sector: z.string().min(1).max(80).optional(),
      role: DigitalViewingPhotoSchema.shape.role.optional(),
      verified: z.boolean()
    }).strict())
  }).strict(),
  captureAngleCoverage: z.object({
    sourceOfTruth: z.literal("derived-from-domain-capture-preset-and-verified-photo-metadata"),
    presetId: IdSchema,
    requiredShotCount: z.number().int().nonnegative(),
    matchedShotCount: z.number().int().nonnegative(),
    missingShotCount: z.number().int().nonnegative(),
    mismatchedShotCount: z.number().int().nonnegative(),
    entries: z.array(z.object({
      shotId: IdSchema,
      sector: z.string().min(1).max(80),
      requiredRoles: z.array(DigitalViewingPhotoSchema.shape.role).min(1),
      selectedPhotoPath: RelativePathSchema.optional(),
      selectedPhotoRole: DigitalViewingPhotoSchema.shape.role.optional(),
      status: z.enum(["matched", "missing", "mismatched"]),
      expected: z.object({
        angleType: CaptureAngleTypeSchema,
        cameraMode: CaptureCameraModeSchema,
        targetYawDeg: z.number().finite().min(-180).max(180).optional(),
        yawToleranceDeg: z.number().finite().positive().max(90).optional(),
        pitchGuidance: CapturePitchGuidanceSchema,
        lensGuidance: CaptureLensGuidanceSchema,
        coverage: CaptureCoverageSchema,
        occlusionPolicy: CaptureOcclusionPolicySchema,
        measuredEndpointsVisible: z.boolean()
      }).strict(),
      actual: z.object({
        angleType: CaptureAngleTypeSchema.optional(),
        cameraMode: CaptureCameraModeSchema.optional(),
        yawDeg: z.number().finite().min(-180).max(180).optional(),
        pitchDeg: z.number().finite().min(-90).max(90).optional(),
        pitchGuidance: CapturePitchGuidanceSchema.optional(),
        lensGuidance: CaptureLensGuidanceSchema.optional(),
        coverage: CaptureCoverageSchema.optional(),
        occluded: z.boolean().optional(),
        anchorsVisible: z.boolean().optional(),
        verified: z.boolean().optional()
      }).strict()
    }).strict())
  }).strict(),
  cameraReferenceCoverage: z.object({
    sourceOfTruth: z.literal("derived-from-render-camera-reference-photo-and-capture-metadata"),
    required: z.boolean(),
    status: z.enum(["ready", "blocked", "missing-reference", "not-required"]),
    sector: z.string().min(1).max(80),
    cameraMode: DigitalViewingRenderPresetSchema.shape.camera.shape.mode,
    referencePhoto: RelativePathSchema.optional(),
    metadataStatus: z.enum(["ready", "missing-photo", "missing-metadata", "missing-calibration", "not-required"]),
    calibrationProfile: z.object({
      requiredFields: z.array(z.enum(["cameraDistanceMm", "focalLength35mmEquivalent"])).min(1)
    }).strict().optional(),
    missingCalibrationFields: z.array(z.enum(["cameraDistanceMm", "focalLength35mmEquivalent"])),
    focalLength35mmEquivalent: z.number().finite().positive().optional(),
    cameraDistanceMm: z.number().finite().positive().optional()
  }).strict(),
  measurementEvidenceCoverage: z.object({
    sourceOfTruth: z.literal("derived-from-verified-measurements-and-blender-anchor-application"),
    geometryMeasurementCount: z.number().int().nonnegative(),
    appliedAnchorCount: z.number().int().nonnegative(),
    missingAnchorCount: z.number().int().nonnegative(),
    entries: z.array(z.object({
      measurementId: IdSchema,
      label: z.string().min(1).max(160),
      value: z.number().finite(),
      tolerance: DigitalViewingMeasurementSchema.shape.tolerance,
      unit: DigitalViewingMeasurementSchema.shape.unit,
      confidence: ConfidenceSchema,
      source: DigitalViewingMeasurementSchema.shape.source,
      hostElementId: IdSchema.optional(),
      axis: DigitalViewingMeasurementPlacementSchema.shape.axis.optional(),
      referenceFrame: DigitalViewingMeasurementPlacementSchema.shape.referenceFrame.optional(),
      blenderAnchorStatus: z.enum(["applied", "missing"])
    }).strict())
  }).strict(),
  dimensionOverlayCoverage: z.object({
    sourceOfTruth: z.literal("derived-from-verified-measurement-placement-and-blender-anchor-application"),
    overlayCandidateCount: z.number().int().nonnegative(),
    overlayReadyCount: z.number().int().nonnegative(),
    overlayBlockedCount: z.number().int().nonnegative(),
    entries: z.array(z.object({
      measurementId: IdSchema,
      label: z.string().min(1).max(160),
      value: z.number().finite(),
      tolerance: DigitalViewingMeasurementSchema.shape.tolerance,
      unit: DigitalViewingMeasurementSchema.shape.unit,
      hostElementId: IdSchema.optional(),
      axis: DigitalViewingMeasurementPlacementSchema.shape.axis.optional(),
      referenceFrame: DigitalViewingMeasurementPlacementSchema.shape.referenceFrame.optional(),
      from: z.string().min(1).max(120).optional(),
      to: z.string().min(1).max(120).optional(),
      overlayStatus: z.enum(["ready", "missing-placement", "missing-anchor"]),
      displayLabel: z.string().min(1).max(200),
      annotation: z.object({
        text: z.string().min(1).max(200),
        value: z.number().finite(),
        tolerance: DigitalViewingMeasurementSchema.shape.tolerance,
        unit: DigitalViewingMeasurementSchema.shape.unit,
        axis: DigitalViewingMeasurementPlacementSchema.shape.axis,
        hostElementId: IdSchema,
        referenceFrame: DigitalViewingMeasurementPlacementSchema.shape.referenceFrame,
        from: z.string().min(1).max(120),
        to: z.string().min(1).max(120),
        source: DigitalViewingMeasurementSchema.shape.source,
        confidence: ConfidenceSchema
      }).strict().optional()
    }).strict())
  }).strict(),
  materialRenderCoverage: z.object({
    sourceOfTruth: z.literal("derived-from-material-authoring-report-and-blender-material-application"),
    materialCount: z.number().int().nonnegative(),
    hostTargetedMaterialCount: z.number().int().nonnegative(),
    appliedMaterialCount: z.number().int().nonnegative(),
    missingMaterialCount: z.number().int().nonnegative(),
    textureMapCount: z.number().int().nonnegative(),
    appliedTextureMapCount: z.number().int().nonnegative(),
    missingTextureMapCount: z.number().int().nonnegative(),
    textureColorSpaceMatchedCount: z.number().int().nonnegative(),
    textureColorSpaceMismatchCount: z.number().int().nonnegative(),
    surfaceMappingMatchedCount: z.number().int().nonnegative(),
    surfaceMappingMismatchCount: z.number().int().nonnegative(),
    appearanceCalibrationMatchedCount: z.number().int().nonnegative(),
    appearanceCalibrationMismatchCount: z.number().int().nonnegative(),
    materialFidelityReadyCount: z.number().int().nonnegative(),
    materialFidelityBlockedCount: z.number().int().nonnegative(),
    entries: z.array(z.object({
      materialId: IdSchema,
      hostElementId: IdSchema.optional(),
      presetId: MaterialPresetIdSchema.optional(),
      category: PbrMaterialSchema.shape.category,
      provenance: PbrMaterialSchema.shape.provenance,
      confidence: ConfidenceSchema,
      materialRenderStatus: z.enum(["applied", "missing-host", "missing-execution"]),
      textureMapCount: z.number().int().nonnegative(),
      appliedTextureMapCount: z.number().int().nonnegative(),
      missingTextureMapCount: z.number().int().nonnegative(),
      textureColorSpaceStatus: z.enum(["matched", "mismatched", "missing-execution", "not-required"]),
	      surfaceMappingExecutionStatus: z.enum(["matched", "mismatched", "missing-execution", "not-required"]),
	      appearanceCalibrationExecutionStatus: z.enum(["matched", "mismatched", "missing-execution", "not-required"]),
	      surfaceMappingStatus: z.enum(["declared", "missing"]),
	      appearanceCalibrationStatus: z.enum(["declared", "missing"]),
	      surfaceMappingReadback: DigitalViewingMaterialSurfaceMappingSchema.optional(),
	      appearanceCalibrationReadback: DigitalViewingMaterialAppearanceCalibrationSchema.optional(),
	      sourcePhotoEvidenceCount: z.number().int().nonnegative(),
      sourcePhotoEvidenceStatus: z.enum(["ready", "missing"]),
      pbrReadback: z.object({
        sourceOfTruth: z.literal("read-from-blender-material-node-values-after-application"),
        fields: z.array(z.enum(["baseColor", "metallic", "normalSource", "roughness", "specular", "textureScaleMm", "transmission"])),
        values: z.object({
          baseColor: z.string().optional(),
          roughness: z.number().optional(),
          metallic: z.number().optional(),
          specular: z.number().optional(),
          transmission: z.number().optional(),
          normalSource: PbrMaterialSchema.shape.normalSource.optional(),
          textureScaleMm: z.number().optional()
        }).strict()
      }).strict().optional(),
      materialFidelityStatus: z.enum(["ready", "blocked"]),
      materialFidelityIssues: z.array(z.enum([
        "material-missing-host",
        "material-missing-execution",
        "texture-maps-missing",
        "texture-color-space-mismatched",
        "texture-color-space-missing-execution",
        "surface-mapping-mismatched",
        "surface-mapping-missing-execution",
        "appearance-calibration-mismatched",
        "appearance-calibration-missing-execution",
        "source-photo-evidence-missing"
	      ])),
	      sourcePhotos: z.array(RelativePathSchema),
	      sourcePhotoEvidence: z.array(z.object({
	        path: RelativePathSchema,
	        sector: z.string(),
	        role: DigitalViewingPhotoSchema.shape.role,
	        verified: z.boolean(),
	        materialCategories: z.array(MaterialCategorySchema)
	      }).strict())
	    }).strict())
	  }).strict(),
  materialCalibrationCoverage: z.object({
    sourceOfTruth: z.literal("derived-from-photo-observed-materials-and-verified-appearance-calibration"),
    materialCount: z.number().int().nonnegative(),
    calibrationCandidateCount: z.number().int().nonnegative(),
    calibrationReadyCount: z.number().int().nonnegative(),
    calibrationBlockedCount: z.number().int().nonnegative(),
    entries: z.array(z.object({
      materialId: IdSchema,
      presetId: MaterialPresetIdSchema.optional(),
      category: PbrMaterialSchema.shape.category,
      provenance: PbrMaterialSchema.shape.provenance,
      calibrationStatus: z.enum(["ready", "missing", "invalid-source"]),
      method: DigitalViewingMaterialAppearanceCalibrationSchema.shape.method.optional(),
      sourcePhoto: RelativePathSchema.optional(),
      photoRole: DigitalViewingPhotoSchema.shape.role.optional(),
      lightingReference: CaptureLightingReferenceSchema.optional(),
      colorReference: CaptureColorReferenceSchema.optional(),
      whiteBalanceKelvin: DigitalViewingPhotoSchema.shape.captureMetadata.unwrap().shape.whiteBalanceKelvin,
      exposureEv: DigitalViewingPhotoSchema.shape.captureMetadata.unwrap().shape.exposureEv,
      verified: z.boolean()
    }).strict())
  }).strict(),
  materialCategoryCoverage: z.object({
    sourceOfTruth: z.literal("derived-from-domain-capture-preset-and-render-manifest-material-categories"),
    requiredCategoryCount: z.number().int().nonnegative(),
    coveredCategoryCount: z.number().int().nonnegative(),
    missingCategoryCount: z.number().int().nonnegative(),
    entries: z.array(z.object({
      category: PbrMaterialSchema.shape.category,
      required: z.boolean(),
      status: z.enum(["ready", "missing"]),
      materialIds: z.array(IdSchema)
    }).strict())
  }).strict(),
  pbrMaterialCompletenessCoverage: z.object({
    sourceOfTruth: z.literal("derived-from-render-manifest-pbr-fields-and-premium-texture-requirements"),
    materialCount: z.number().int().nonnegative(),
    completeMaterialCount: z.number().int().nonnegative(),
    incompleteMaterialCount: z.number().int().nonnegative(),
    photoNormalSourceCount: z.number().int().nonnegative(),
    textureScaleDeclaredCount: z.number().int().nonnegative(),
    entries: z.array(z.object({
      materialId: IdSchema,
      presetId: MaterialPresetIdSchema.optional(),
      category: PbrMaterialSchema.shape.category,
      completenessStatus: z.enum(["complete", "incomplete"]),
      requiredTextureTypes: z.array(TextureMapSchema.shape.type),
      presentTextureTypes: z.array(TextureMapSchema.shape.type),
      missingTextureTypes: z.array(TextureMapSchema.shape.type),
      pbrFields: z.object({
        baseColor: z.enum(["declared", "missing"]),
        roughness: z.enum(["declared", "missing"]),
        metallic: z.enum(["declared", "missing"]),
        specular: z.enum(["declared", "missing"]),
        transmission: z.enum(["declared", "missing"]),
        normalSource: z.enum(["declared", "missing"]),
        textureScaleMm: z.enum(["declared", "missing"])
      }).strict(),
      normalSource: PbrMaterialSchema.shape.normalSource,
      textureScaleMm: z.number().finite().positive().optional(),
      finishProfile: z.object({
        profileId: z.string().min(1).max(120),
        roughness: z.object({
          min: z.number().finite().min(0).max(1),
          max: z.number().finite().min(0).max(1)
        }).strict(),
        metallic: z.object({
          min: z.number().finite().min(0).max(1),
          max: z.number().finite().min(0).max(1)
        }).strict()
      }).strict().optional(),
      finishProfileStatus: z.enum(["in-range", "out-of-range", "not-profiled"]),
      finishProfileIssues: z.array(z.string().min(1).max(240)),
      textureEvidence: z.array(z.object({
        type: TextureMapSchema.shape.type,
        path: RelativePathSchema,
        provenance: TextureMapSchema.shape.provenance,
        confidence: ConfidenceSchema,
        colorSpace: TextureMapSchema.shape.colorSpace,
        scaleMm: z.number().finite().positive().optional(),
        pixelWidth: z.number().int().positive().optional(),
        pixelHeight: z.number().int().positive().optional(),
        sourcePhoto: RelativePathSchema.optional()
      }).strict())
    }).strict())
  }).strict(),
  renderExecutionCoverage: z.object({
    sourceOfTruth: z.literal("derived-from-render-manifest-and-blender-execution-metadata"),
    renderer: z.string().min(1).max(80),
    renderPath: RelativePathSchema,
    manifestPath: RelativePathSchema,
    camera: z.object({
      declaredSector: z.string().min(1).max(80),
      declaredMode: z.string().min(1).max(80),
      declaredReferencePhoto: RelativePathSchema.optional(),
      executedSector: z.string().min(1).max(80).optional(),
      executedMode: z.string().min(1).max(80).optional(),
      executedReferencePhoto: RelativePathSchema.optional(),
      status: z.enum(["matched", "mismatched", "missing-execution"])
    }).strict(),
    lighting: z.object({
      declaredEnvironment: z.string().min(1).max(80),
      declaredReferencePhoto: RelativePathSchema.optional(),
      declaredLightingReference: CaptureLightingReferenceSchema.optional(),
      declaredColorReference: CaptureColorReferenceSchema.optional(),
      declaredWhiteBalanceKelvin: z.number().finite().positive().min(1000).max(40000).optional(),
      declaredExposureEv: z.number().finite().optional(),
      executedEnvironment: z.string().min(1).max(80).optional(),
      executedReferencePhoto: RelativePathSchema.optional(),
      executedLightingReference: CaptureLightingReferenceSchema.optional(),
      executedColorReference: CaptureColorReferenceSchema.optional(),
      executedWhiteBalanceKelvin: z.number().finite().positive().min(1000).max(40000).optional(),
      executedExposureEv: z.number().finite().optional(),
      status: z.enum(["matched", "mismatched", "missing-execution"])
    }).strict(),
    assetBundle: z.object({
      status: z.enum(["matched", "mismatched", "missing-execution", "not-declared"]),
      declaredHash: z.string().length(64).optional(),
      executedHash: z.string().length(64).optional(),
      manifestPath: RelativePathSchema.optional()
    }).strict(),
    renderArtifact: z.object({
      declaredPath: RelativePathSchema,
      declaredWidth: z.number().int().positive().optional(),
      declaredHeight: z.number().int().positive().optional(),
      executedPath: RelativePathSchema.optional(),
      sizeBytes: z.number().int().nonnegative().optional(),
      sha256: z.string().length(64).optional(),
      executedWidth: z.number().int().positive().optional(),
      executedHeight: z.number().int().positive().optional(),
      status: z.enum(["matched", "mismatched", "missing-execution"])
    }).strict()
  }).strict(),
  conditionInspectionCoverage: z.object({
    sourceOfTruth: z.literal("derived-from-domain-capture-preset-and-condition-inspection-evidence"),
    requiredZoneCount: z.number().int().nonnegative(),
    verifiedZoneCount: z.number().int().nonnegative(),
    missingZoneCount: z.number().int().nonnegative(),
    defectFoundZoneCount: z.number().int().nonnegative(),
    entries: z.array(z.object({
      zone: IdSchema,
      required: z.boolean(),
      status: z.enum(["verified", "unverified", "missing"]),
      inspectionStatus: z.union([DigitalViewingConditionInspectionSchema.shape.status, z.literal("missing")]),
      conditionIds: z.array(IdSchema),
      sourcePhotos: z.array(RelativePathSchema),
      sourcePhotoEvidence: z.array(z.object({
        path: RelativePathSchema,
        sector: z.string(),
        role: DigitalViewingPhotoSchema.shape.role,
        verified: z.boolean(),
        materialCategories: z.array(MaterialCategorySchema)
      }).strict())
    }).strict())
  }).strict(),
  conditionRenderCoverage: z.object({
    sourceOfTruth: z.literal("derived-from-condition-evidence-inspection-zones-and-blender-condition-application"),
    verifiedConditionCount: z.number().int().nonnegative(),
    visibleConditionCount: z.number().int().nonnegative(),
    appliedConditionCount: z.number().int().nonnegative(),
    missingConditionCount: z.number().int().nonnegative(),
    inspectionZoneCount: z.number().int().nonnegative(),
    verifiedInspectionZoneCount: z.number().int().nonnegative(),
    defectFoundZoneCount: z.number().int().nonnegative(),
    entries: z.array(z.object({
      conditionId: IdSchema,
      hostElementId: IdSchema.optional(),
      type: ConditionEvidenceSchema.shape.type,
      severity: ConditionEvidenceSchema.shape.severity,
      verification: VerificationSchema,
      mustBeVisible: z.boolean(),
      sourcePhotos: z.array(RelativePathSchema),
      sourcePhotoEvidence: z.array(z.object({
        path: RelativePathSchema,
        verified: z.boolean(),
        materialCategories: z.array(MaterialCategorySchema)
      }).strict()),
      inspectionZones: z.array(IdSchema),
      conditionRenderStatus: z.enum(["applied", "missing-host", "missing-execution"]),
      placementStatus: z.enum(["matched", "mismatched", "missing-placement", "not-declared"]),
      visibilityProofStatus: z.enum(["matched", "missing", "mismatched", "not-required"]),
      materialSurface: ConditionEvidenceSchema.shape.materialSurface,
      surfacePlacement: ConditionEvidenceSchema.shape.surfacePlacement,
      visibilityProof: z.object({
        sourceOfTruth: z.literal("created-visible-blender-overlay-object"),
        objectName: z.string().min(1).max(160),
        materialName: z.string().min(1).max(160).optional(),
        visibleInRender: z.boolean(),
        dimensionsMm: z.object({
          widthMm: z.number().finite().positive(),
          heightMm: z.number().finite().positive()
        }).strict(),
        materialReadback: z.object({
          sourceOfTruth: z.literal("read-from-blender-condition-material-after-application"),
          baseColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
          alpha: z.number().finite().min(0).max(1),
          roughness: z.number().finite().min(0).max(1),
          metallic: z.number().finite().min(0).max(1),
          conditionType: ConditionEvidenceSchema.shape.type,
          severity: ConditionEvidenceSchema.shape.severity
        }).strict()
      }).strict().optional()
    }).strict()),
    inspectionZones: z.array(z.object({
      zone: IdSchema,
      status: DigitalViewingConditionInspectionSchema.shape.status,
      verified: z.boolean(),
      conditionIds: z.array(IdSchema),
      sourcePhotos: z.array(RelativePathSchema),
      sourcePhotoEvidence: z.array(z.object({
        path: RelativePathSchema,
        sector: z.string(),
        role: DigitalViewingPhotoSchema.shape.role,
        verified: z.boolean(),
        materialCategories: z.array(MaterialCategorySchema)
      }).strict())
    }).strict())
  }).strict(),
  conditionOverlayCoverage: z.object({
    sourceOfTruth: z.literal("derived-from-visible-condition-placement-photos-and-blender-condition-application"),
    overlayCandidateCount: z.number().int().nonnegative(),
    overlayReadyCount: z.number().int().nonnegative(),
    overlayBlockedCount: z.number().int().nonnegative(),
    entries: z.array(z.object({
      conditionId: IdSchema,
      hostElementId: IdSchema.optional(),
      type: ConditionEvidenceSchema.shape.type,
      severity: ConditionEvidenceSchema.shape.severity,
      verification: VerificationSchema,
      sourcePhotos: z.array(RelativePathSchema),
      sourcePhotoEvidence: z.array(z.object({
        path: RelativePathSchema,
        verified: z.boolean(),
        materialCategories: z.array(MaterialCategorySchema)
      }).strict()),
      inspectionZones: z.array(IdSchema),
      materialSurface: ConditionEvidenceSchema.shape.materialSurface,
      surfacePlacement: ConditionEvidenceSchema.shape.surfacePlacement,
      overlayStatus: z.enum(["ready", "missing-placement", "missing-render", "insufficient-visibility"]),
      displayLabel: z.string().min(1).max(200),
      disclosureProfile: z.object({
        profileId: z.string().min(1).max(120),
        minAreaMm2: z.number().finite().positive(),
        minLongestDimensionMm: z.number().finite().positive()
      }).strict(),
      disclosureProfileIssues: z.array(z.string().min(1).max(240)),
      disclosure: z.object({
        title: z.string().min(1).max(200),
        conditionId: IdSchema,
        type: ConditionEvidenceSchema.shape.type,
        severity: ConditionEvidenceSchema.shape.severity,
        verification: VerificationSchema,
        hostElementId: IdSchema,
        inspectionZones: z.array(IdSchema),
        sourcePhotos: z.array(RelativePathSchema),
        sourcePhotoEvidence: z.array(z.object({
          path: RelativePathSchema,
          verified: z.boolean(),
          materialCategories: z.array(MaterialCategorySchema)
        }).strict()),
        materialSurface: ConditionEvidenceSchema.shape.materialSurface,
        surfacePlacement: ConditionEvidenceSchema.shape.surfacePlacement
      }).strict().optional()
    }).strict())
  }).strict(),
  photorealQualityChecklist: z.array(z.object({
    check: z.enum(["asset-bundle", "render-output", "measurements", "materials", "textures", "conditions", "camera", "lighting"]),
    status: z.enum(["passed", "failed"]),
    evidence: z.string().min(1).max(240),
    trace: z.object({
      captureHash: z.string().length(64),
      renderManifestHash: z.string().length(64),
      materialConditionReportHash: z.string().length(64).optional(),
      assetBundleHash: z.string().length(64).optional()
    }).strict()
  }).strict()),
  qualityGates: z.object({
    ready: z.boolean(),
    blocking: z.array(z.object({
      id: z.string(),
      code: z.enum([
        "capture_hash_mismatch",
        "material_authoring_hash_mismatch",
        "material_authoring_not_ready",
        "material_calibration_not_ready",
        "material_categories_not_ready",
        "pbr_materials_not_ready",
        "photo_evidence_not_ready",
        "material_report_not_ready",
        "asset_bundle_required",
        "asset_bundle_not_ready",
        "asset_bundle_capture_hash_mismatch",
        "asset_bundle_render_manifest_hash_mismatch",
        "render_asset_bundle_missing",
        "render_asset_bundle_hash_mismatch",
        "render_artifact_identity_missing",
        "render_artifact_hash_mismatch",
        "render_artifact_resolution_mismatch",
        "render_reference_comparison_missing",
        "render_reference_comparison_mismatch",
        "render_material_application_incomplete",
        "render_material_pbr_mismatch",
        "render_material_pbr_readback_missing",
        "render_material_source_photo_identity_missing",
        "render_material_calibration_incomplete",
        "render_material_surface_mapping_incomplete",
        "render_texture_application_incomplete",
        "render_texture_scale_incomplete",
        "render_texture_color_space_incomplete",
        "render_texture_file_identity_missing",
        "render_condition_application_incomplete",
        "render_condition_visibility_incomplete",
        "render_condition_placement_mismatch",
        "render_condition_overlay_visibility_missing",
        "render_condition_overlay_material_readback_missing",
        "render_condition_source_photo_identity_missing",
        "render_quality_not_ready",
        "render_camera_execution_mismatch",
        "render_camera_angle_readback_missing",
        "render_camera_reference_photo_identity_missing",
        "render_camera_reference_calibration_missing",
        "render_camera_reference_missing",
        "render_lighting_reference_missing",
        "render_lighting_reference_photo_identity_missing",
        "render_lighting_reference_mismatch",
        "render_measurement_application_missing",
        "render_measurement_application_incomplete",
        "render_measurement_value_readback_missing",
        "dimension_overlays_not_ready",
        "capture_angles_not_ready",
        "render_manifest_not_geometry_authority",
        "capture_preset_mismatch",
        "condition_inspection_zones_not_ready",
        "condition_overlays_not_ready",
        "delivery_target_missing",
        "delivery_artifact_hash_missing",
        "web_viewer_model_artifact_missing"
      ]),
      message: z.string()
    }).strict()),
    warnings: z.array(z.object({
      id: z.string(),
      code: z.enum(["render_warning", "report_warning"]),
      message: z.string()
    }).strict())
  }).strict(),
  hashes: z.object({
    captureHash: z.string().length(64),
    renderManifestHash: z.string().length(64),
    materialAuthoringPlanHash: z.string().length(64),
    materialConditionReportHash: z.string().length(64),
    packageHash: z.string().length(64).optional()
  }).strict()
}).strict();
type DigitalViewingDeliveryPackageManifestObject = z.infer<typeof DigitalViewingDeliveryPackageManifestObjectSchema>;

export const DigitalViewingDeliveryPackageManifestSchema = DigitalViewingDeliveryPackageManifestObjectSchema.superRefine((manifest, ctx) => {
  const indexedSourceIds = new Set(manifest.sourceTraceIndex.entries.map((entry) => entry.sourceId));
  const duplicateSourceIds = manifest.sourceTraceIndex.entries
    .map((entry) => entry.sourceId)
    .filter((sourceId, index, sourceIds) => sourceIds.indexOf(sourceId) !== index);
  const duplicateDeliveryTargetIds = manifest.deliveryTargets
    .map((target) => target.target)
    .filter((target, index, targets) => targets.indexOf(target) !== index);
  const unresolvedViewerIds = manifest.viewerLayerCoverage.entries
    .flatMap((entry) => entry.sourceIds)
    .filter((sourceId) => !indexedSourceIds.has(sourceId));
  const unresolvedChecklistIds = manifest.customerViewingChecklist.items
    .flatMap((item) => item.sourceIds)
    .filter((sourceId) => !indexedSourceIds.has(sourceId));
  const unresolvedIds = Array.from(new Set([...unresolvedViewerIds, ...unresolvedChecklistIds])).sort((left, right) => left.localeCompare(right));

  if (unresolvedIds.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sourceTraceIndex"],
      message: `sourceIds must resolve in sourceTraceIndex: ${unresolvedIds.join(", ")}`
    });
  }

  if (manifest.sourceTraceIndex.entryCount !== manifest.sourceTraceIndex.entries.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sourceTraceIndex", "entryCount"],
      message: `sourceTraceIndex entryCount must equal entries length: expected ${manifest.sourceTraceIndex.entries.length}, received ${manifest.sourceTraceIndex.entryCount}`
    });
  }

  if (duplicateSourceIds.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sourceTraceIndex", "entries"],
      message: `sourceTraceIndex sourceIds must be unique: ${Array.from(new Set(duplicateSourceIds)).sort((left, right) => left.localeCompare(right)).join(", ")}`
    });
  }

  if (duplicateDeliveryTargetIds.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["deliveryTargets"],
      message: `deliveryTargets target ids must be unique: ${Array.from(new Set(duplicateDeliveryTargetIds)).sort((left, right) => left.localeCompare(right)).join(", ")}`
    });
  }

  if (!isSortedDeliveryTargetList(manifest.deliveryTargets)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["deliveryTargets"],
      message: "deliveryTargets must be sorted in deterministic target order"
    });
  }

  if (!isSortedSourceTraceEntryList(manifest.sourceTraceIndex.entries)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sourceTraceIndex", "entries"],
      message: "sourceTraceIndex entries must be sorted by sourceType and sourceId"
    });
  }

  const mismatchedSourceTraceCoverageEntries = manifest.sourceTraceIndex.entries
    .filter((entry) => !isAlignedSourceTraceCoverage(entry))
    .map((entry) => entry.sourceId);
  if (mismatchedSourceTraceCoverageEntries.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sourceTraceIndex", "entries"],
      message: `sourceTraceIndex sourceCoverage must match sourceType: ${mismatchedSourceTraceCoverageEntries.sort((left, right) => left.localeCompare(right)).join(", ")}`
    });
  }

  const mismatchedSourceTraceStatusEntries = manifest.sourceTraceIndex.entries
    .filter((entry) => !isAlignedSourceTraceStatus(entry))
    .map((entry) => entry.sourceId);
  if (mismatchedSourceTraceStatusEntries.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sourceTraceIndex", "entries"],
      message: `sourceTraceIndex status must match sourceType: ${mismatchedSourceTraceStatusEntries.sort((left, right) => left.localeCompare(right)).join(", ")}`
    });
  }

  const nondeterministicSourceTraceEvidenceEntries = manifest.sourceTraceIndex.entries
    .filter((entry) => entry.evidencePaths && !isUniqueSortedRelativePathList(entry.evidencePaths))
    .map((entry) => entry.sourceId);
  if (nondeterministicSourceTraceEvidenceEntries.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sourceTraceIndex", "entries"],
      message: `sourceTraceIndex evidencePaths must be unique and sorted: ${nondeterministicSourceTraceEvidenceEntries.sort((left, right) => left.localeCompare(right)).join(", ")}`
    });
  }

  const disallowedSourceTraceEvidencePathEntries = manifest.sourceTraceIndex.entries
    .filter((entry) => entry.evidencePaths && !allowsSourceTraceEvidencePaths(entry))
    .map((entry) => entry.sourceId);
  if (disallowedSourceTraceEvidencePathEntries.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sourceTraceIndex", "entries"],
      message: `sourceTraceIndex evidencePaths are only allowed for material and condition entries: ${disallowedSourceTraceEvidencePathEntries.sort((left, right) => left.localeCompare(right)).join(", ")}`
    });
  }

  const misalignedSourceTracePathEntries = manifest.sourceTraceIndex.entries
    .filter((entry) => !isAlignedSourceTracePath(entry))
    .map((entry) => entry.sourceId);
  if (misalignedSourceTracePathEntries.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sourceTraceIndex", "entries"],
      message: `sourceTraceIndex path must match first evidencePath: ${misalignedSourceTracePathEntries.sort((left, right) => left.localeCompare(right)).join(", ")}`
    });
  }

  const missingReadyDeliveryTargetPathEntries = manifest.sourceTraceIndex.entries
    .filter((entry) => entry.sourceType === "delivery-target" && entry.status === "ready" && requiresSourceTraceArtifactPath(entry) && !entry.path)
    .map((entry) => entry.sourceId);
  if (missingReadyDeliveryTargetPathEntries.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sourceTraceIndex", "entries"],
      message: `sourceTraceIndex ready file delivery targets must include artifact paths: ${missingReadyDeliveryTargetPathEntries.sort((left, right) => left.localeCompare(right)).join(", ")}`
    });
  }

  const deliveryTargetById = new Map(manifest.deliveryTargets.map((target) => [target.target, target]));
  const indexedDeliveryTargetIds = new Set(manifest.sourceTraceIndex.entries
    .filter((entry) => entry.sourceType === "delivery-target")
    .map((entry) => entry.sourceId));
  const missingSourceTraceDeliveryTargetEntries = manifest.deliveryTargets
    .filter((target) => !indexedDeliveryTargetIds.has(target.target))
    .map((target) => target.target);
  if (missingSourceTraceDeliveryTargetEntries.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sourceTraceIndex", "entries"],
      message: `sourceTraceIndex must include deliveryTargets: ${missingSourceTraceDeliveryTargetEntries.sort((left, right) => left.localeCompare(right)).join(", ")}`
    });
  }

  const unknownSourceTraceDeliveryTargetEntries = manifest.sourceTraceIndex.entries
    .filter((entry) => entry.sourceType === "delivery-target" && !deliveryTargetById.has(entry.sourceId as DigitalViewingOutputTarget))
    .map((entry) => entry.sourceId);
  if (unknownSourceTraceDeliveryTargetEntries.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sourceTraceIndex", "entries"],
      message: `sourceTraceIndex delivery target entries must exist in deliveryTargets: ${unknownSourceTraceDeliveryTargetEntries.sort((left, right) => left.localeCompare(right)).join(", ")}`
    });
  }

  const mismatchedSourceTraceDeliveryTargetStatusEntries = manifest.sourceTraceIndex.entries
    .filter((entry) => entry.sourceType === "delivery-target" && entry.status !== deliveryTargetById.get(entry.sourceId as DigitalViewingOutputTarget)?.status)
    .map((entry) => entry.sourceId);
  if (mismatchedSourceTraceDeliveryTargetStatusEntries.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sourceTraceIndex", "entries"],
      message: `sourceTraceIndex delivery target statuses must match deliveryTargets: ${mismatchedSourceTraceDeliveryTargetStatusEntries.sort((left, right) => left.localeCompare(right)).join(", ")}`
    });
  }

  const mismatchedSourceTraceDeliveryTargetPathEntries = manifest.sourceTraceIndex.entries
    .filter((entry) => entry.sourceType === "delivery-target" && entry.path !== deliveryTargetById.get(entry.sourceId as DigitalViewingOutputTarget)?.path)
    .map((entry) => entry.sourceId);
  if (mismatchedSourceTraceDeliveryTargetPathEntries.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sourceTraceIndex", "entries"],
      message: `sourceTraceIndex delivery target paths must match deliveryTargets: ${mismatchedSourceTraceDeliveryTargetPathEntries.sort((left, right) => left.localeCompare(right)).join(", ")}`
    });
  }

  const mismatchedSourceTraceDeliveryTargetHashEntries = manifest.sourceTraceIndex.entries
    .filter((entry) => entry.sourceType === "delivery-target" && entry.hash !== deliveryTargetById.get(entry.sourceId as DigitalViewingOutputTarget)?.hash)
    .map((entry) => entry.sourceId);
  if (mismatchedSourceTraceDeliveryTargetHashEntries.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sourceTraceIndex", "entries"],
      message: `sourceTraceIndex delivery target hashes must match deliveryTargets: ${mismatchedSourceTraceDeliveryTargetHashEntries.sort((left, right) => left.localeCompare(right)).join(", ")}`
    });
  }

  const materialRenderEntries = manifest.materialRenderCoverage.entries;
  const materialCoverageCounts = {
    materialCount: materialRenderEntries.length,
    hostTargetedMaterialCount: materialRenderEntries.filter((entry) => entry.hostElementId).length,
    appliedMaterialCount: materialRenderEntries.filter((entry) => entry.materialRenderStatus === "applied").length,
    missingMaterialCount: materialRenderEntries.filter((entry) => entry.materialRenderStatus !== "applied").length,
    textureMapCount: materialRenderEntries.reduce((sum, entry) => sum + entry.textureMapCount, 0),
    appliedTextureMapCount: materialRenderEntries.reduce((sum, entry) => sum + entry.appliedTextureMapCount, 0),
    missingTextureMapCount: materialRenderEntries.reduce((sum, entry) => sum + entry.missingTextureMapCount, 0),
    surfaceMappingMatchedCount: materialRenderEntries.filter((entry) => entry.surfaceMappingExecutionStatus === "matched").length,
    surfaceMappingMismatchCount: materialRenderEntries.filter((entry) =>
      entry.surfaceMappingExecutionStatus !== "matched" && entry.surfaceMappingExecutionStatus !== "not-required"
    ).length,
    appearanceCalibrationMatchedCount: materialRenderEntries.filter((entry) => entry.appearanceCalibrationExecutionStatus === "matched").length,
    appearanceCalibrationMismatchCount: materialRenderEntries.filter((entry) =>
      entry.appearanceCalibrationExecutionStatus !== "matched" && entry.appearanceCalibrationExecutionStatus !== "not-required"
    ).length
  };
  const mismatchedMaterialCoverageCounts = Object.entries(materialCoverageCounts)
    .filter(([field, expected]) => manifest.materialRenderCoverage[field as keyof typeof materialCoverageCounts] !== expected)
    .map(([field]) => field)
    .sort((left, right) => left.localeCompare(right));
  if (mismatchedMaterialCoverageCounts.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["materialRenderCoverage"],
      message: `materialRenderCoverage counts must match entries: ${mismatchedMaterialCoverageCounts.join(", ")}`
    });
  }
  const mismatchedMaterialSourcePhotoEvidenceEntries = materialRenderEntries.filter((entry) => {
    const expectedEvidenceStatus = entry.sourcePhotos.length > 0 ? "ready" : "missing";
    return entry.sourcePhotoEvidenceCount !== entry.sourcePhotos.length
      || entry.sourcePhotoEvidenceStatus !== expectedEvidenceStatus;
  });
  if (mismatchedMaterialSourcePhotoEvidenceEntries.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["materialRenderCoverage", "entries"],
      message: `materialRenderCoverage source photo evidence must match sourcePhotos: ${mismatchedMaterialSourcePhotoEvidenceEntries.map((entry) => entry.materialId).sort((left, right) => left.localeCompare(right)).join(", ")}`
    });
  }
  const nondeterministicMaterialSourcePhotoEntries = materialRenderEntries.filter((entry) => {
    const sortedUniqueSourcePhotos = Array.from(new Set(entry.sourcePhotos)).sort((left, right) => left.localeCompare(right));
    return sortedUniqueSourcePhotos.length !== entry.sourcePhotos.length
      || sortedUniqueSourcePhotos.some((sourcePhoto, index) => sourcePhoto !== entry.sourcePhotos[index]);
  });
  if (nondeterministicMaterialSourcePhotoEntries.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["materialRenderCoverage", "entries"],
      message: `materialRenderCoverage sourcePhotos must be unique and sorted: ${nondeterministicMaterialSourcePhotoEntries.map((entry) => entry.materialId).sort((left, right) => left.localeCompare(right)).join(", ")}`
    });
  }

  const materialFidelityReadyCount = manifest.materialRenderCoverage.entries.filter((entry) => entry.materialFidelityStatus === "ready").length;
  const materialFidelityBlockedCount = manifest.materialRenderCoverage.entries.filter((entry) => entry.materialFidelityStatus === "blocked").length;
  if (
    manifest.materialRenderCoverage.materialFidelityReadyCount !== materialFidelityReadyCount
    || manifest.materialRenderCoverage.materialFidelityBlockedCount !== materialFidelityBlockedCount
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["materialRenderCoverage"],
      message: `materialRenderCoverage materialFidelity counts must match entries: expected ready ${materialFidelityReadyCount} and blocked ${materialFidelityBlockedCount}, received ready ${manifest.materialRenderCoverage.materialFidelityReadyCount} and blocked ${manifest.materialRenderCoverage.materialFidelityBlockedCount}`
    });
  }
  const mismatchedMaterialFidelityEntries = manifest.materialRenderCoverage.entries.filter((entry) =>
    entry.materialFidelityStatus === "ready"
      ? entry.materialFidelityIssues.length > 0
      : entry.materialFidelityIssues.length === 0
  );
  if (mismatchedMaterialFidelityEntries.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["materialRenderCoverage", "entries"],
      message: `materialRenderCoverage materialFidelityStatus must match issues: ${mismatchedMaterialFidelityEntries.map((entry) => entry.materialId).sort((left, right) => left.localeCompare(right)).join(", ")}`
    });
  }

  if (manifest.evidenceHealthSummary.indexedSourceCount !== manifest.sourceTraceIndex.entryCount) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["evidenceHealthSummary", "indexedSourceCount"],
      message: `evidenceHealthSummary indexedSourceCount must equal sourceTraceIndex entryCount: expected ${manifest.sourceTraceIndex.entryCount}, received ${manifest.evidenceHealthSummary.indexedSourceCount}`
    });
  }

  const sectionReadyEvidenceCount = manifest.evidenceHealthSummary.sections.reduce((sum, section) => sum + section.readyEvidenceCount, 0);
  const sectionBlockedEvidenceCount = manifest.evidenceHealthSummary.sections.reduce((sum, section) => sum + section.blockedEvidenceCount, 0);
  const sectionMissingEvidenceCount = manifest.evidenceHealthSummary.sections.reduce((sum, section) => sum + section.missingEvidenceCount, 0);
  const sectionEvidencePathCount = manifest.evidenceHealthSummary.sections.reduce((sum, section) => sum + section.evidencePathCount, 0);
  if (
    manifest.evidenceHealthSummary.readyEvidenceCount !== sectionReadyEvidenceCount
    || manifest.evidenceHealthSummary.blockedEvidenceCount !== sectionBlockedEvidenceCount
    || manifest.evidenceHealthSummary.missingEvidenceCount !== sectionMissingEvidenceCount
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["evidenceHealthSummary"],
      message: "evidenceHealthSummary total counts must equal section sums"
    });
  }
  if (manifest.evidenceHealthSummary.evidencePathCount !== sectionEvidencePathCount) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["evidenceHealthSummary", "evidencePathCount"],
      message: `evidenceHealthSummary evidencePathCount must equal section sums: expected ${sectionEvidencePathCount}, received ${manifest.evidenceHealthSummary.evidencePathCount}`
    });
  }

  const expectedEvidenceHealthStatus = manifest.qualityGates.ready
    && manifest.customerReadinessSummary.status === "ready"
    && manifest.evidenceHealthSummary.blockedEvidenceCount === 0
    && manifest.evidenceHealthSummary.missingEvidenceCount === 0
    ? "ready"
    : "blocked";
  if (manifest.evidenceHealthSummary.status !== expectedEvidenceHealthStatus) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["evidenceHealthSummary", "status"],
      message: `evidenceHealthSummary status must match derived readiness: expected ${expectedEvidenceHealthStatus}, received ${manifest.evidenceHealthSummary.status}`
    });
  }

  if (manifest.evidenceHealthSummary.warningCount !== manifest.qualityGates.warnings.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["evidenceHealthSummary", "warningCount"],
      message: `evidenceHealthSummary warningCount must equal qualityGates warnings length: expected ${manifest.qualityGates.warnings.length}, received ${manifest.evidenceHealthSummary.warningCount}`
    });
  }

  const duplicateHealthSections = manifest.evidenceHealthSummary.sections
    .map((section) => section.section)
    .filter((sectionName, index, sectionNames) => sectionNames.indexOf(sectionName) !== index);
  if (duplicateHealthSections.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["evidenceHealthSummary", "sections"],
      message: `evidenceHealthSummary sections must be unique: ${Array.from(new Set(duplicateHealthSections)).sort((left, right) => left.localeCompare(right)).join(", ")}`
    });
  }

  const healthSectionByName = new Map(manifest.evidenceHealthSummary.sections.map((section) => [section.section, section]));
  for (const [sectionName, sourceType] of [
    ["capture-shots", "capture-shot"],
    ["measurements", "measurement"],
    ["materials", "material"],
    ["conditions", "condition"],
    ["delivery-targets", "delivery-target"]
  ] as const) {
    const section = healthSectionByName.get(sectionName);
    if (!section) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidenceHealthSummary", "sections"],
        message: `evidenceHealthSummary section ${sectionName} is required`
      });
      continue;
    }

    const sourceEntries = manifest.sourceTraceIndex.entries.filter((entry) => entry.sourceType === sourceType);
    const expectedIndexedCount = sourceEntries.length;
    const expectedReadyCount = sourceEntries.filter((entry) => isReadySourceTraceStatus(entry.status)).length;
    const expectedBlockedCount = sourceEntries.filter((entry) => isBlockedSourceTraceStatus(entry.status)).length;
    const expectedMissingCount = sourceEntries.filter((entry) => isMissingSourceTraceStatus(entry.status)).length;
    const expectedEvidencePathCount = sourceEntries.reduce((sum, entry) => sum + sourceTraceEntryEvidencePathCount(entry), 0);
    if (
      section.indexedSourceCount !== expectedIndexedCount
      || section.readyEvidenceCount !== expectedReadyCount
      || section.blockedEvidenceCount !== expectedBlockedCount
      || section.missingEvidenceCount !== expectedMissingCount
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidenceHealthSummary", "sections", sectionName],
        message: `evidenceHealthSummary section ${sectionName} counts must match sourceTraceIndex`
      });
    }
    if (section.evidencePathCount !== expectedEvidencePathCount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidenceHealthSummary", "sections", sectionName, "evidencePathCount"],
        message: `evidenceHealthSummary section ${sectionName} path count must match sourceTraceIndex: expected ${expectedEvidencePathCount}, received ${section.evidencePathCount}`
      });
    }

    const expectedSectionStatus = expectedBlockedCount === 0 && expectedMissingCount === 0 ? "ready" : "blocked";
    if (section.status !== expectedSectionStatus) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidenceHealthSummary", "sections", sectionName, "status"],
        message: `evidenceHealthSummary section ${sectionName} status must match counts: expected ${expectedSectionStatus}, received ${section.status}`
      });
    }
  }
});
export type DigitalViewingDeliveryPackageManifest = z.infer<typeof DigitalViewingDeliveryPackageManifestSchema>;

function isReadySourceTraceStatus(status: DigitalViewingDeliveryPackageManifestObject["sourceTraceIndex"]["entries"][number]["status"]): boolean {
  return status === "matched" || status === "ready" || status === "complete";
}

function isBlockedSourceTraceStatus(status: DigitalViewingDeliveryPackageManifestObject["sourceTraceIndex"]["entries"][number]["status"]): boolean {
  return status === "mismatched" || status === "blocked" || status === "incomplete";
}

function isMissingSourceTraceStatus(status: DigitalViewingDeliveryPackageManifestObject["sourceTraceIndex"]["entries"][number]["status"]): boolean {
  return status === "missing" || status === "not-requested";
}

function sourceTraceEntryEvidencePathCount(
  entry: DigitalViewingDeliveryPackageManifestObject["sourceTraceIndex"]["entries"][number]
): number {
  return entry.evidencePaths?.length ?? (entry.path ? 1 : 0);
}

function isSortedSourceTraceEntryList(entries: DigitalViewingDeliveryPackageManifestObject["sourceTraceIndex"]["entries"]): boolean {
  return entries.every((entry, index) => {
    const previousEntry = entries[index - 1];
    return !previousEntry || sourceTraceEntrySortKey(previousEntry).localeCompare(sourceTraceEntrySortKey(entry)) <= 0;
  });
}

function isSortedDeliveryTargetList(targets: DigitalViewingDeliveryPackageManifestObject["deliveryTargets"]): boolean {
  return targets.every((target, index) => {
    const previousTarget = targets[index - 1];
    return !previousTarget || deliveryTargetSortIndex(previousTarget.target) <= deliveryTargetSortIndex(target.target);
  });
}

function deliveryTargetSortIndex(target: DigitalViewingOutputTarget): number {
  return DeliveryTargetSortOrder.indexOf(target);
}

function sourceTraceEntrySortKey(entry: DigitalViewingDeliveryPackageManifestObject["sourceTraceIndex"]["entries"][number]): string {
  return `${entry.sourceType}:${entry.sourceId}`;
}

function isAlignedSourceTraceCoverage(entry: DigitalViewingDeliveryPackageManifestObject["sourceTraceIndex"]["entries"][number]): boolean {
  const sourceCoverageByType = {
    "capture-shot": "captureAngleCoverage",
    measurement: "dimensionOverlayCoverage",
    material: "materialRenderCoverage+pbrMaterialCompletenessCoverage",
    condition: "conditionOverlayCoverage",
    "delivery-target": "deliveryTargets"
  } as const;
  return entry.sourceCoverage === sourceCoverageByType[entry.sourceType];
}

function isAlignedSourceTraceStatus(entry: DigitalViewingDeliveryPackageManifestObject["sourceTraceIndex"]["entries"][number]): boolean {
  const sourceStatusByType = {
    "capture-shot": ["matched", "missing", "mismatched"],
    measurement: ["ready", "blocked"],
    material: ["ready", "blocked", "incomplete"],
    condition: ["ready", "blocked"],
    "delivery-target": ["ready", "missing", "not-requested"]
  } as const;
  return (sourceStatusByType[entry.sourceType] as readonly string[]).includes(entry.status);
}

function allowsSourceTraceEvidencePaths(entry: DigitalViewingDeliveryPackageManifestObject["sourceTraceIndex"]["entries"][number]): boolean {
  return entry.sourceType === "material" || entry.sourceType === "condition";
}

function isAlignedSourceTracePath(entry: DigitalViewingDeliveryPackageManifestObject["sourceTraceIndex"]["entries"][number]): boolean {
  return !entry.evidencePaths || entry.evidencePaths.length === 0 || entry.path === entry.evidencePaths[0];
}

function requiresSourceTraceArtifactPath(entry: DigitalViewingDeliveryPackageManifestObject["sourceTraceIndex"]["entries"][number]): boolean {
  return entry.sourceType === "delivery-target" && entry.sourceId !== "material-condition-report";
}

function isUniqueSortedRelativePathList(paths: string[]): boolean {
  const sortedUniquePaths = Array.from(new Set(paths)).sort((left, right) => left.localeCompare(right));
  return sortedUniquePaths.length === paths.length
    && sortedUniquePaths.every((path, index) => path === paths[index]);
}

function contractSha256(value: unknown): string {
  return createHash("sha256").update(contractStableJson(value)).digest("hex");
}

function contractStableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => contractStableJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${contractStableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export const MaterialPresetSchema = z.object({
  presetId: MaterialPresetIdSchema,
  category: PbrMaterialSchema.shape.category,
  pbr: z.object({
    baseColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    roughness: z.number().finite().min(0).max(1),
    metallic: z.number().finite().min(0).max(1),
    specular: z.number().finite().min(0).max(1),
    transmission: z.number().finite().min(0).max(1),
    normalSource: PbrMaterialSchema.shape.normalSource,
    textureScaleMm: z.number().finite().positive()
  }).strict()
}).strict();
export type MaterialPreset = z.infer<typeof MaterialPresetSchema>;

export const DigitalViewingBlenderRenderJobSchema = z.object({
  mode: z.literal("measurement_project"),
  operation: z.literal("digital_viewing_render"),
  sourceBlendPath: LockedBlendSourcePathSchema,
  executionPlacement: z.object({
    sourceOfTruth: z.literal("computed-from-digital-viewing-render-contract"),
    frontendRole: z.literal("control-plane-only"),
    termuxRole: z.literal("ssh-control-plane-only"),
    heavyComputeRole: z.literal("blender-render-worker"),
    preferredExecutionGeography: z.literal("hetzner-ubuntu"),
    fallbackExecutionGeography: z.literal("local-workstation"),
    remoteExecutionRequiresExplicitSelection: z.literal(true),
    geometryMutationAllowed: z.literal(false),
    exportGeometryReconstructionAllowed: z.literal(false)
  }).strict(),
  renderManifest: DigitalViewingRenderManifestSchema,
  materialAuthoring: z.object({
    sourceOfTruth: z.literal("derived-from-material-authoring-plan"),
    planHash: z.string().length(64),
    ready: z.boolean(),
    blockingCount: z.number().int().nonnegative(),
    warningCount: z.number().int().nonnegative()
  }).strict(),
  assetBundleManifest: DigitalViewingAssetBundleManifestSchema
}).strict();
export type DigitalViewingBlenderRenderJob = z.infer<typeof DigitalViewingBlenderRenderJobSchema>;

export const RenderDigitalViewingPreviewInputSchema = z.object({
  capture: DigitalViewingCaptureSchema,
  renderPreset: DigitalViewingRenderPresetSchema,
  sourceBlendPath: LockedBlendSourcePathSchema,
  assetBundleManifest: DigitalViewingAssetBundleManifestSchema,
  outputBlendPath: BlendPathSchema.optional()
}).strict();
export type RenderDigitalViewingPreviewInput = z.infer<typeof RenderDigitalViewingPreviewInputSchema>;

export const GetDigitalViewingCapturePresetInputSchema = z.object({
  assetType: DigitalAssetTypeSchema,
  deliveryTier: DeliveryTierSchema
}).strict();
export type GetDigitalViewingCapturePresetInput = z.infer<typeof GetDigitalViewingCapturePresetInputSchema>;

export const GetDigitalViewingCaptureGuideInputSchema = z.object({
  assetType: DigitalAssetTypeSchema,
  deliveryTier: DeliveryTierSchema
}).strict();
export type GetDigitalViewingCaptureGuideInput = z.infer<typeof GetDigitalViewingCaptureGuideInputSchema>;

export const ListDigitalViewingCapturePresetsInputSchema = z.object({}).strict();
export type ListDigitalViewingCapturePresetsInput = z.infer<typeof ListDigitalViewingCapturePresetsInputSchema>;

export const ValidateDigitalViewingCapturePresetInputSchema = z.object({
  capture: DigitalViewingCaptureSchema,
  deliveryTier: DeliveryTierSchema
}).strict();
export type ValidateDigitalViewingCapturePresetInput = z.infer<typeof ValidateDigitalViewingCapturePresetInputSchema>;

export const ListDigitalViewingDeliveryProfilesInputSchema = z.object({}).strict();
export type ListDigitalViewingDeliveryProfilesInput = z.infer<typeof ListDigitalViewingDeliveryProfilesInputSchema>;

export const GetDigitalViewingDeliveryProfileInputSchema = z.object({
  customerSurface: DigitalViewingCustomerSurfaceSchema
}).strict();
export type GetDigitalViewingDeliveryProfileInput = z.infer<typeof GetDigitalViewingDeliveryProfileInputSchema>;

export const EvaluateDigitalViewingDeliveryProfileInputSchema = z.object({
  capture: DigitalViewingCaptureSchema,
  customerSurface: DigitalViewingCustomerSurfaceSchema
}).strict();
export type EvaluateDigitalViewingDeliveryProfileInput = z.infer<typeof EvaluateDigitalViewingDeliveryProfileInputSchema>;

export const GenerateDigitalViewingMaterialReportInputSchema = z.object({
  capture: DigitalViewingCaptureSchema,
  deliveryTier: DeliveryTierSchema,
  renderManifest: DigitalViewingRenderManifestSchema.passthrough(),
  assetBundleManifest: DigitalViewingAssetBundleManifestSchema,
  assetBundleManifestPath: RelativePathSchema,
  outputPath: RelativePathSchema.optional()
}).strict();
export type GenerateDigitalViewingMaterialReportInput = z.infer<typeof GenerateDigitalViewingMaterialReportInputSchema>;

export const GenerateDigitalViewingMaterialAuthoringPlanInputSchema = z.object({
  capture: DigitalViewingCaptureSchema,
  deliveryTier: DeliveryTierSchema,
  outputPath: RelativePathSchema.optional()
}).strict();
export type GenerateDigitalViewingMaterialAuthoringPlanInput = z.infer<typeof GenerateDigitalViewingMaterialAuthoringPlanInputSchema>;

export const GenerateDigitalViewingDeliveryPackageInputSchema = z.object({
  capture: DigitalViewingCaptureSchema,
  renderManifest: DigitalViewingRenderManifestSchema,
  assetBundleManifest: DigitalViewingAssetBundleManifestSchema,
  assetBundleManifestPath: RelativePathSchema,
  customerSurface: DigitalViewingCustomerSurfaceSchema.optional(),
  deliveryTargets: z.array(DigitalViewingOutputTargetSchema).optional(),
  deliveryArtifacts: z.array(DigitalViewingDeliveryArtifactSchema).default([]),
  outputPath: RelativePathSchema.optional()
}).strict();
export type GenerateDigitalViewingDeliveryPackageInput = z.infer<typeof GenerateDigitalViewingDeliveryPackageInputSchema>;

export const GenerateDigitalViewingAssetBundleManifestInputSchema = z.object({
  capture: DigitalViewingCaptureSchema,
  renderManifest: DigitalViewingRenderManifestSchema,
  existingFiles: z.array(RelativePathSchema).default([]),
  scanOutputDir: z.boolean().default(false),
  outputPath: RelativePathSchema.optional()
}).strict();
export type GenerateDigitalViewingAssetBundleManifestInput = z.infer<typeof GenerateDigitalViewingAssetBundleManifestInputSchema>;

export {
  evaluateDigitalViewingDeliveryReadiness,
  validateDigitalViewingCapture
} from "./digitalViewingReadiness.js";

type DigitalViewingRepairReason = {
  id?: string;
  code: string;
};

export function buildDigitalViewingCaptureRepairSummary(blocking: DigitalViewingRepairReason[]): DigitalViewingCaptureRepairSummary {
  const order: DigitalViewingCaptureRepairSection[] = ["measurements", "photos", "materials", "inspections", "conditions", "outputs"];
  const grouped = new Map<DigitalViewingCaptureRepairSection, string[]>();
  for (const reason of blocking) {
    const section = digitalViewingRepairSectionFor(reason);
    grouped.set(section, [...(grouped.get(section) ?? []), reason.id ?? reason.code]);
  }
  return DigitalViewingCaptureRepairSummarySchema.parse({
    ready: blocking.length === 0,
    sections: order
      .filter((section) => grouped.has(section))
      .map((section) => {
        const blockingIds = grouped.get(section) ?? [];
        return { section, blockingCount: blockingIds.length, blockingIds };
      })
  });
}

function digitalViewingRepairSectionFor(reason: DigitalViewingRepairReason): DigitalViewingCaptureRepairSection {
  if (reason.id?.startsWith("inspection-zone-") || reason.code.includes("inspection")) {
    return "inspections";
  }
  if (reason.code.includes("measurement") || reason.code.includes("geometry")) {
    return "measurements";
  }
  if (reason.code.includes("material") || reason.code.includes("texture") || reason.id?.includes(":surface-mapping") || reason.id?.includes(":appearance-calibration")) {
    return "materials";
  }
  if (reason.code.includes("sector") || reason.code.includes("photo") || reason.code.includes("camera") || reason.code.includes("angle") || reason.code.includes("yaw") || reason.code.includes("coverage") || reason.code.includes("occluded")) {
    return "photos";
  }
  if (reason.code.includes("condition")) {
    return "conditions";
  }
  return "outputs";
}

export {
  buildDigitalViewingAssetBundleManifest,
  buildDigitalViewingDeliveryPackageManifest,
  evaluateDigitalViewingDeliveryProfileReadiness,
  getDigitalViewingDeliveryProfile,
  listDigitalViewingDeliveryProfiles,
  MinimumStructuralReferenceComparisonThreshold,
  serializeDigitalViewingAssetBundleManifest,
  serializeDigitalViewingDeliveryPackageManifest
} from "./digitalViewingPackage.js";

export {
  buildDigitalViewingMaterialAuthoringPlan,
  serializeDigitalViewingMaterialAuthoringPlan
} from "./digitalViewingMaterialPlan.js";

export {
  buildDigitalViewingMaterialConditionReport,
  serializeDigitalViewingMaterialConditionReport
} from "./digitalViewingReport.js";

export {
  buildDigitalViewingBlenderRenderJob,
  buildDigitalViewingRenderManifest,
  MaterialPresets
} from "./digitalViewingRender.js";

export {
  DigitalViewingCapturePresets,
  buildDigitalViewingCaptureGuide,
  evaluateDigitalViewingCapturePreset,
  getDigitalViewingCapturePreset,
  listDigitalViewingCapturePresets,
  requiredSectorsForAssetType
} from "./digitalViewingPresets.js";
