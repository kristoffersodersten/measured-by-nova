import { createHash } from "node:crypto";
import { z } from "zod";
import {
  DigitalViewingCaptureSchema,
  DigitalViewingAssetBundleManifestObjectSchema,
  DigitalViewingAssetBundleManifestSchema,
  DigitalViewingDeliveryPackageManifestObjectSchema,
  DigitalViewingDeliveryPackageManifestSchema,
  DigitalViewingDeliveryProfileSchema,
  DigitalViewingDeliveryProfileReadinessResultSchema,
  DigitalViewingCustomerSurfaceSchema,
  DigitalViewingDeliveryArtifactSchema,
  DigitalViewingOutputTargetSchema,
  DigitalViewingRenderManifestSchema,
  type DigitalViewingAssetBundleManifest,
  type DigitalViewingDeliveryArtifact,
  type DigitalViewingDeliveryPackageManifest,
  type DigitalViewingDeliveryPackageTarget,
  type DigitalViewingDeliveryProfile,
  type DigitalViewingDeliveryProfileReadinessResult,
  type DigitalViewingCustomerSurface,
  type DigitalViewingOutputTarget
} from "./digitalViewingContracts.js";
import { buildDigitalViewingMaterialAuthoringPlan } from "./digitalViewingMaterialPlan.js";
import { buildDigitalViewingCaptureGuide, getDigitalViewingCapturePreset } from "./digitalViewingPresets.js";
import { buildDigitalViewingMaterialConditionReport } from "./digitalViewingReport.js";

const DefaultPackageTargets: DigitalViewingOutputTarget[] = ["photoreal-render", "material-condition-report"];
const TargetSortOrder: DigitalViewingOutputTarget[] = ["photoreal-render", "material-condition-report", "blend", "glb", "usdz", "web-viewer", "technical-views"];
type RenderManifest = ReturnType<typeof DigitalViewingRenderManifestSchema.parse>;
type LightingReferenceMetadata = NonNullable<RenderManifest["lightingReference"]>;
type RenderMaterialPbr = RenderManifest["materials"][number]["pbr"];
type DigitalViewingMaterialCategory = RenderManifest["materials"][number]["category"];
type DigitalViewingMaterialAppearanceCalibration = NonNullable<RenderManifest["materials"][number]["appearanceCalibration"]>;
type DigitalViewingMaterialSurfaceMapping = NonNullable<RenderManifest["materials"][number]["surfaceMapping"]>;
type BlenderMaterialExecution = {
  materialId: string;
  object: string;
  sourcePhotoIdentities?: Array<BlenderPhotoIdentityExecution & { usage?: string }>;
  surfaceMapping?: Partial<DigitalViewingMaterialSurfaceMapping>;
  pbr?: Partial<RenderMaterialPbr>;
  pbrReadback?: {
    sourceOfTruth?: string;
    fields?: string[];
    values?: Partial<RenderMaterialPbr>;
  };
};
type BlenderLightingExecution = {
  environment?: string;
  referencePhoto?: string;
  referencePhotoIdentity?: BlenderPhotoIdentityExecution;
  lightingReference?: LightingReferenceMetadata["lightingReference"];
  colorReference?: LightingReferenceMetadata["colorReference"];
  whiteBalanceKelvin?: number;
  exposureEv?: number;
};
type BlenderPhotoIdentityExecution = {
  path?: string;
  sizeBytes?: number;
  sha256?: string;
};
type BlenderCameraExecution = {
  sector?: string;
  mode?: string;
  referencePhoto?: string;
  referencePhotoIdentity?: BlenderPhotoIdentityExecution;
  executedYawDeg?: number;
  executedPitchDeg?: number;
};
type BlenderReferenceComparisonExecution = {
  referencePhoto?: string;
  renderPath?: string;
  method?: "reference-metadata-alignment" | "average-color-rmse" | "luma-grid-rmse" | "ssim" | "pixel-diff" | "feature-alignment";
  score?: number;
  threshold?: number;
};
type BlenderMeasurementExecution = {
  measurementId: string;
  hostElementId?: string;
  referenceFrame?: string;
  value?: number;
  unit?: string;
  tolerance?: number;
  sourceOfTruth?: string;
};
type ConditionOverlayVisibilityProof = {
  sourceOfTruth?: string;
  objectName?: string;
  materialName?: string;
  visibleInRender?: boolean;
  dimensionsMm?: {
    widthMm?: number;
    heightMm?: number;
  };
  materialReadback?: {
    sourceOfTruth?: string;
    baseColor?: string;
    alpha?: number;
    roughness?: number;
    metallic?: number;
    conditionType?: string;
    severity?: string;
  };
};
type BlenderConditionExecution = {
  conditionId: string;
  object?: string;
  hostElementId?: string;
  face?: string;
  sourcePhotoIdentities?: Array<{ path: string; usage?: string; sizeBytes?: number; sha256?: string }>;
  surfacePlacement?: {
    hostElementId?: string;
    face?: string;
    u?: number;
    v?: number;
    widthMm?: number;
    heightMm?: number;
    rotationDeg?: number;
  };
  visibilityProof?: ConditionOverlayVisibilityProof;
};
const DeliveryProfileSourceOfTruth = {
  measurements: "geometry-scale-placement",
  photos: "material-condition-context-evidence",
  blender: "locked-renderable-scene",
  profile: "customer-surface-target-contract-no-geometry-reconstruction"
} as const;
export const MinimumStructuralReferenceComparisonThreshold = 0.35;
const RequiredPhotorealReferenceComparisonMethodTier = "structural" as const;
const AssetBundleOptionsSchema = z.object({
  existingFiles: z.array(z.string().min(1)).default([]),
  assetFiles: z.array(z.object({
    path: z.string().min(1),
    sizeBytes: z.number().int().nonnegative(),
    sha256: z.string().length(64),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional()
  }).strict()).default([])
}).strict();

const DigitalViewingDeliveryProfiles = [
  {
    profileId: "digital-viewing-internal-review",
    customerSurface: "internal-review",
    positioning: "Internal review package for geometry, material, and condition QA.",
    requiredTargets: ["photoreal-render", "material-condition-report"],
    optionalTargets: ["glb", "technical-views"],
    notGeometryAuthority: true,
    sourceOfTruth: DeliveryProfileSourceOfTruth
  },
  {
    profileId: "digital-viewing-sales-listing",
    customerSurface: "sales-listing",
    positioning: "Sales listing package for buyer-facing digital viewing.",
    requiredTargets: ["photoreal-render", "material-condition-report", "glb"],
    optionalTargets: ["web-viewer", "technical-views"],
    notGeometryAuthority: true,
    sourceOfTruth: DeliveryProfileSourceOfTruth
  },
  {
    profileId: "digital-viewing-showroom",
    customerSurface: "showroom",
    positioning: "Showroom package for guided interactive presentation.",
    requiredTargets: ["photoreal-render", "material-condition-report", "glb", "web-viewer"],
    optionalTargets: ["usdz", "technical-views"],
    notGeometryAuthority: true,
    sourceOfTruth: DeliveryProfileSourceOfTruth
  },
  {
    profileId: "digital-viewing-broker-preview",
    customerSurface: "broker-preview",
    positioning: "Broker preview package for listing review and measured technical context.",
    requiredTargets: ["photoreal-render", "material-condition-report", "technical-views"],
    optionalTargets: ["glb", "web-viewer"],
    notGeometryAuthority: true,
    sourceOfTruth: DeliveryProfileSourceOfTruth
  },
  {
    profileId: "digital-viewing-permit-support",
    customerSurface: "permit-support",
    positioning: "Permit-support package for measured visualization and technical review.",
    requiredTargets: ["technical-views", "material-condition-report"],
    optionalTargets: ["photoreal-render", "glb"],
    notGeometryAuthority: true,
    sourceOfTruth: DeliveryProfileSourceOfTruth
  }
];

export function listDigitalViewingDeliveryProfiles(): DigitalViewingDeliveryProfile[] {
  return DigitalViewingDeliveryProfiles.map((profile) => DigitalViewingDeliveryProfileSchema.parse(profile));
}

export function getDigitalViewingDeliveryProfile(customerSurface: DigitalViewingCustomerSurface): DigitalViewingDeliveryProfile {
  const parsedSurface = DigitalViewingCustomerSurfaceSchema.parse(customerSurface);
  const profile = DigitalViewingDeliveryProfiles.find((item) => item.customerSurface === parsedSurface);
  if (!profile) {
    throw new Error(`No digital viewing delivery profile found for customer surface '${parsedSurface}'.`);
  }
  return DigitalViewingDeliveryProfileSchema.parse(profile);
}

export function evaluateDigitalViewingDeliveryProfileReadiness(input: unknown, customerSurfaceInput: unknown): DigitalViewingDeliveryProfileReadinessResult {
  const capture = DigitalViewingCaptureSchema.parse(input);
  const profile = getDigitalViewingDeliveryProfile(DigitalViewingCustomerSurfaceSchema.parse(customerSurfaceInput));
  const declaredTargets = new Set(capture.outputTargets);
  const requiredTargets = profile.requiredTargets.map((target) => ({
    target,
    declaredInCapture: declaredTargets.has(target)
  }));
  const optionalTargets = profile.optionalTargets.map((target) => ({
    target,
    declaredInCapture: declaredTargets.has(target)
  }));
  const blocking = requiredTargets
    .filter((target) => !target.declaredInCapture)
    .map((target) => ({
      id: `delivery-profile:${target.target}`,
      code: "profile_target_not_declared" as const,
      message: `Capture outputTargets must declare required customer-surface target '${target.target}'.`
    }));
  const warnings = optionalTargets
    .filter((target) => !target.declaredInCapture)
    .map((target) => ({
      id: `delivery-profile:${target.target}`,
      code: "optional_profile_target_not_declared" as const,
      message: `Capture outputTargets does not declare optional customer-surface target '${target.target}'.`
    }));

  return DigitalViewingDeliveryProfileReadinessResultSchema.parse({
    ok: blocking.length === 0,
    customerSurface: profile.customerSurface,
    profileId: profile.profileId,
    requiredTargets,
    optionalTargets,
    blocking,
    warnings
  });
}

export function buildDigitalViewingAssetBundleManifest(
  input: unknown,
  renderManifestInput: unknown,
  optionsInput?: unknown
): DigitalViewingAssetBundleManifest {
  const capture = DigitalViewingCaptureSchema.parse(input);
  const renderManifest = DigitalViewingRenderManifestSchema.parse(renderManifestInput);
  const options = AssetBundleOptionsSchema.parse(optionsInput ?? {});
  const existingFiles = new Set(options.existingFiles ?? []);
  const assetFileMetadata = new Map(options.assetFiles.map((file) => [file.path, file]));
  const assetUses = collectAssetUses(renderManifest);

  const assets = Array.from(assetUses.entries())
    .map(([assetPath, asset]) => {
      const metadata = assetFileMetadata.get(assetPath);
      return {
        path: assetPath,
        assetType: asset.assetType,
        required: true,
        status: asset.assetType === "render-output" ? "expected" as const : existingFiles.has(assetPath) ? "present" as const : "missing" as const,
        sizeBytes: metadata?.sizeBytes,
        sha256: metadata?.sha256,
        width: metadata?.width,
        height: metadata?.height,
        usedBy: Array.from(asset.usedBy).sort((left, right) => left.localeCompare(right))
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
  const blocking = assets
    .filter((asset) => asset.required && asset.status === "missing")
    .map((asset) => ({
      id: asset.path,
      code: "asset_file_missing" as const,
      message: "Required digital viewing asset is missing from the asset bundle."
    }));

  const manifestWithoutHash = DigitalViewingAssetBundleManifestObjectSchema.omit({ hashes: true }).parse({
    schemaVersion: 1,
    manifestType: "digital-viewing-asset-bundle",
    captureId: capture.captureId,
    projectId: capture.projectId,
    assetType: capture.assetType,
    deliveryTier: renderManifest.renderPreset.deliveryTier,
    notGeometryAuthority: true,
    sourceOfTruth: {
      measurements: "geometry-scale-placement",
      photos: "material-condition-context-evidence-files",
      textures: "material-finish-evidence-files",
      bundle: "pre-render-file-readiness-no-geometry-reconstruction"
    },
    assets,
    summary: {
      ready: blocking.length === 0,
      requiredCount: assets.filter((asset) => asset.required).length,
      missingCount: blocking.length,
      warningCount: 0
    },
    qualityGates: {
      ready: blocking.length === 0,
      blocking,
      warnings: []
    }
  });
  const hashes = {
    captureHash: sha256(capture),
    renderManifestHash: renderManifest.hashes.manifestHash
  };

  return DigitalViewingAssetBundleManifestSchema.parse({
    ...manifestWithoutHash,
    hashes: {
      ...hashes,
      assetBundleHash: sha256({ ...manifestWithoutHash, hashes })
    }
  });
}

export function buildDigitalViewingDeliveryPackageManifest(
  input: unknown,
  renderManifestInput: unknown,
  deliveryTargetsInput?: unknown,
  customerSurfaceInput?: unknown,
  assetBundleManifestInput?: unknown,
  assetBundleManifestPath?: string,
  deliveryArtifactsInput?: unknown
): DigitalViewingDeliveryPackageManifest {
  const capture = DigitalViewingCaptureSchema.parse(input);
  const renderManifest = DigitalViewingRenderManifestSchema.parse(renderManifestInput);
  const assetBundleManifest = assetBundleManifestInput ? DigitalViewingAssetBundleManifestSchema.parse(assetBundleManifestInput) : undefined;
  const materialAuthoringPlan = buildDigitalViewingMaterialAuthoringPlan(capture, renderManifest.renderPreset.deliveryTier);
  const materialConditionReport = buildDigitalViewingMaterialConditionReport(capture, renderManifest.renderPreset.deliveryTier, renderManifest);
  const customerSurface = parseCustomerSurface(customerSurfaceInput);
  const requestedDeliveryTargets = parseRequestedDeliveryTargets(deliveryTargetsInput, customerSurface);
  const deliveryArtifacts = parseDeliveryArtifacts(deliveryArtifactsInput, requestedDeliveryTargets);
  const captureHash = sha256(capture);
  const blocking: DigitalViewingDeliveryPackageManifest["qualityGates"]["blocking"] = [];
  const warnings: DigitalViewingDeliveryPackageManifest["qualityGates"]["warnings"] = [];

  if (!renderManifest.notGeometryAuthority) {
    blocking.push({
      id: "render-manifest",
      code: "render_manifest_not_geometry_authority",
      message: "Delivery packages require render manifests that are explicitly not geometry authority."
    });
  }
  if (renderManifest.hashes.captureHash !== captureHash) {
    blocking.push({
      id: "capture",
      code: "capture_hash_mismatch",
      message: "Render manifest capture hash does not match the provided capture."
    });
  }
  const expectedCapturePreset = getDigitalViewingCapturePreset(capture.assetType, renderManifest.renderPreset.deliveryTier);
  if (stableJson(renderManifest.capturePreset) !== stableJson(expectedCapturePreset)) {
    blocking.push({
      id: "render-manifest:capture-preset",
      code: "capture_preset_mismatch",
      message: "Render manifest capture preset does not match the provided capture asset type and delivery tier."
    });
  }
  if (renderManifest.hashes.materialAuthoringPlanHash !== materialAuthoringPlan.hashes.planHash) {
    blocking.push({
      id: "material-authoring-plan",
      code: "material_authoring_hash_mismatch",
      message: "Render manifest material authoring plan hash does not match the current capture."
    });
  }
  if (!materialAuthoringPlan.summary.ready) {
    blocking.push({
      id: "material-authoring-plan",
      code: "material_authoring_not_ready",
      message: "Material authoring plan is not ready for the requested delivery tier."
    });
  }
  if (!materialConditionReport.readiness.ok) {
    blocking.push({
      id: "material-condition-report",
      code: "material_report_not_ready",
      message: "Material and condition report readiness is not passing."
    });
  }
  if (assetBundleManifest && !assetBundleManifest.qualityGates.ready) {
    blocking.push({
      id: "asset-bundle-manifest",
      code: "asset_bundle_not_ready",
      message: "Asset bundle manifest is not ready for delivery packaging."
    });
  }
  if (assetBundleManifest && assetBundleManifest.hashes.captureHash !== captureHash) {
    blocking.push({
      id: "asset-bundle-manifest",
      code: "asset_bundle_capture_hash_mismatch",
      message: "Asset bundle manifest capture hash does not match the provided capture."
    });
  }
  if (assetBundleManifest && assetBundleManifest.hashes.renderManifestHash !== renderManifest.hashes.manifestHash) {
    blocking.push({
      id: "asset-bundle-manifest",
      code: "asset_bundle_render_manifest_hash_mismatch",
      message: "Asset bundle manifest render hash does not match the provided render manifest."
    });
  }
  const photoEvidenceCoverage = buildPhotoEvidenceCoverage(capture, renderManifest);
  if (photoEvidenceCoverage.missingEvidenceCount > 0) {
    blocking.push({
      id: "render-manifest:photo-evidence",
      code: "photo_evidence_not_ready",
      message: "Delivery packages require every referenced photo evidence item to resolve to a verified capture photo."
    });
  }
  const dimensionOverlayCoverage = buildDimensionOverlayCoverage(capture, renderManifest);
  if (dimensionOverlayCoverage.overlayBlockedCount > 0) {
    blocking.push({
      id: "render-manifest:dimension-overlays",
      code: "dimension_overlays_not_ready",
      message: "Delivery packages require every verified geometry measurement to have placement and Blender anchor evidence before customer dimension overlays."
    });
  }
  const captureAngleCoverage = buildCaptureAngleCoverage(capture, renderManifest);
  if (captureAngleCoverage.missingShotCount > 0 || captureAngleCoverage.mismatchedShotCount > 0) {
    blocking.push({
      id: "render-manifest:capture-angles",
      code: "capture_angles_not_ready",
      message: "Delivery packages require every domain-required capture angle to be matched before customer visual reference use."
    });
  }
  const cameraReferenceCoverage = buildCameraReferenceCoverage(capture, renderManifest);
  for (const warning of renderManifest.warnings) {
    warnings.push({
      id: warning,
      code: "render_warning",
      message: warning
    });
  }
  for (const warning of materialConditionReport.readiness.warnings) {
    warnings.push({
      id: warning.id,
      code: "report_warning",
      message: `${warning.code}: ${warning.message}`
    });
  }
  const conditionInspectionCoverage = buildConditionInspectionCoverage(renderManifest, materialConditionReport);
  if (conditionInspectionCoverage.missingZoneCount > 0) {
    blocking.push({
      id: "material-condition-report:inspection-zones",
      code: "condition_inspection_zones_not_ready",
      message: "Delivery packages require every domain-required inspection zone to be verified before customer condition disclosure."
    });
  }
  const deliveryTargets = buildDeliveryTargets(requestedDeliveryTargets, renderManifest, materialConditionReport.hashes.reportHash, deliveryArtifacts);
  for (const target of missingHashDeliveryArtifacts(deliveryTargets, deliveryArtifacts)) {
    blocking.push({
      id: `delivery-target:${target}:hash`,
      code: "delivery_artifact_hash_missing",
      message: `Customer delivery artifact '${target}' must include a content hash before it can be trusted in a package manifest.`
    });
  }
  const hasModelDeliveryArtifact = hasReadyModelDeliveryArtifact(deliveryTargets);
  if (deliveryTargets.some((target) => target.target === "web-viewer" && target.required && target.status === "ready") && !hasModelDeliveryArtifact) {
    blocking.push({
      id: "delivery-target:web-viewer:model-artifact",
      code: "web_viewer_model_artifact_missing",
      message: "Web viewer delivery requires a ready GLB, USDZ, or Blend model artifact in the same package manifest."
    });
  }
  const conditionRenderCoverage = buildConditionRenderCoverage(renderManifest, materialConditionReport);
  const conditionOverlayCoverage = buildConditionOverlayCoverage(conditionRenderCoverage);
  if (deliveryTargets.some((target) => target.target === "material-condition-report" && target.required) && conditionOverlayCoverage.overlayBlockedCount > 0) {
    blocking.push({
      id: "material-condition-report:condition-overlays",
      code: "condition_overlays_not_ready",
      message: "Delivery packages require every buyer-visible condition item to be ready as a rendered overlay before condition disclosure."
    });
  }
  const renderQualityCoverage = buildRenderQualityCoverage(renderManifest);
  const renderExecutionCoverage = buildRenderExecutionCoverage(renderManifest, assetBundleManifest, assetBundleManifestPath);
  const photorealRenderRequired = deliveryTargets.some((target) => target.target === "photoreal-render" && target.required);
  const renderReferenceComparisonCoverage = buildRenderReferenceComparisonCoverage(
    renderManifest,
    photorealRenderRequired,
    renderQualityCoverage,
    renderExecutionCoverage
  );
  if (photorealRenderRequired && renderQualityCoverage.status !== "ready") {
    blocking.push({
      id: "render-manifest:render-quality",
      code: "render_quality_not_ready",
      message: "Photoreal customer delivery packages require Blender render quality execution to satisfy the declared render profile."
    });
  }
  if (photorealRenderRequired && renderExecutionCoverage.renderArtifact.status !== "matched") {
    blocking.push({
      id: "render-manifest:render-artifact",
      code: "render_artifact_identity_missing",
      message: "Photoreal customer delivery packages require Blender to report the exact rendered artifact path, byte size, and SHA-256."
    });
  }
  if (photorealRenderRequired
    && renderExecutionCoverage.renderArtifact.status === "mismatched"
    && renderExecutionCoverage.renderArtifact.executedPath === renderManifest.artifacts.render
    && renderExecutionCoverage.renderArtifact.sizeBytes !== undefined
    && renderExecutionCoverage.renderArtifact.sha256 !== undefined
    && (renderExecutionCoverage.renderArtifact.executedWidth !== renderManifest.renderPreset.resolution.width
      || renderExecutionCoverage.renderArtifact.executedHeight !== renderManifest.renderPreset.resolution.height)) {
    blocking.push({
      id: "render-manifest:render-artifact-resolution",
      code: "render_artifact_resolution_mismatch",
      message: "Photoreal customer delivery packages require the rendered image dimensions to match the declared render preset resolution."
    });
  }
  if (renderReferenceComparisonCoverage.required && renderReferenceComparisonCoverage.status !== "matched") {
    blocking.push({
      id: "render-manifest:reference-comparison",
      code: renderReferenceComparisonCoverage.status === "mismatched"
        ? "render_reference_comparison_mismatch"
        : "render_reference_comparison_missing",
      message: renderReferenceComparisonCoverage.status === "mismatched"
        ? "Photoreal customer delivery packages require Blender comparison metadata to match the declared render path and reference photo."
        : "Photoreal customer delivery packages require Blender comparison metadata tying the rendered output back to the reference photo."
    });
  }
  const photorealDeliveryArtifact = deliveryArtifacts.get("photoreal-render");
  if (photorealRenderRequired
    && photorealDeliveryArtifact?.hash
    && !photorealDeliveryArtifactMatchesRenderArtifact(photorealDeliveryArtifact, renderExecutionCoverage.renderArtifact)) {
    blocking.push({
      id: "delivery-target:photoreal-render:hash",
      code: "render_artifact_hash_mismatch",
      message: "Photoreal delivery artifact hash must match the exact rendered artifact reported by Blender."
    });
  }
  const materialCategoryCoverage = buildMaterialCategoryCoverage(renderManifest);
  if (materialCategoryCoverage.missingCategoryCount > 0) {
    blocking.push({
      id: "render-manifest:material-categories",
      code: "material_categories_not_ready",
      message: "Delivery packages require every domain-required material category to be present in the render manifest."
    });
  }
  const materialCalibrationCoverage = buildMaterialCalibrationCoverage(capture, renderManifest);
  if (deliveryTargets.some((target) => (target.target === "photoreal-render" || target.target === "material-condition-report") && target.required)
    && materialCalibrationCoverage.calibrationBlockedCount > 0) {
    blocking.push({
      id: "render-manifest:material-calibration",
      code: "material_calibration_not_ready",
      message: "Delivery packages require every photo-observed material to have verified appearance calibration before customer material-fidelity delivery."
    });
  }
  const pbrMaterialCompletenessCoverage = buildPbrMaterialCompletenessCoverage(renderManifest);
  if (pbrMaterialCompletenessCoverage.incompleteMaterialCount > 0) {
    blocking.push({
      id: "render-manifest:pbr-materials",
      code: "pbr_materials_not_ready",
      message: "Delivery packages require every material to have complete PBR fields and premium texture evidence before photoreal customer rendering."
    });
  }
  if (requiresAssetBundleForDelivery(renderManifest, deliveryTargets) && !assetBundleManifest) {
    blocking.push({
      id: "asset-bundle-manifest",
      code: "asset_bundle_required",
      message: "Premium photoreal delivery packages require an asset-bundle manifest."
    });
  }
  if (requiresAssetBundleForDelivery(renderManifest, deliveryTargets) && assetBundleManifest) {
    const renderAssetBundle = renderManifest.blenderExecution?.assetBundle;
    if (!renderManifest.renderPreset.camera.referencePhoto) {
      blocking.push({
        id: "render-manifest:camera-reference",
        code: "render_camera_reference_missing",
        message: "Premium photoreal delivery packages require the render camera to cite a verified reference photo for the viewing angle."
      });
    }
    if (cameraReferenceCoverage.status === "blocked") {
      blocking.push({
        id: "render-manifest:camera-reference-calibration",
        code: "render_camera_reference_calibration_missing",
        message: "Premium photoreal renders require camera reference photos to declare focal length and camera distance metadata."
      });
    }
    if (hasMismatchedCameraExecution(capture, renderManifest)) {
      blocking.push({
        id: "render-manifest:camera-execution",
        code: "render_camera_execution_mismatch",
        message: "Premium photoreal delivery packages require Blender execution metadata proving the render camera matches the declared sector, mode, and reference photo."
      });
    }
    if (hasMissingCameraAngleReadback(capture, renderManifest)) {
      blocking.push({
        id: "render-manifest:camera-execution",
        code: "render_camera_angle_readback_missing",
        message: "Premium photoreal delivery packages require Blender camera execution metadata for every declared reference photo yaw and pitch value."
      });
    }
    if (hasMissingCameraReferencePhotoIdentity(renderManifest, assetBundleManifest)) {
      blocking.push({
        id: "render-manifest:camera-reference-photo",
        code: "render_camera_reference_photo_identity_missing",
        message: "Premium photoreal delivery packages require Blender camera execution metadata proving the exact reference photo file used for camera alignment."
      });
    }
    if (hasIncompleteLightingReference(renderManifest)) {
      blocking.push({
        id: "render-manifest:lighting-reference",
        code: "render_lighting_reference_missing",
        message: "Premium photoreal delivery packages require Blender execution metadata proving site-reference lighting used the declared reference photo."
      });
    }
    if (hasMissingLightingReferencePhotoIdentity(renderManifest, assetBundleManifest)) {
      blocking.push({
        id: "render-manifest:lighting-reference-photo",
        code: "render_lighting_reference_photo_identity_missing",
        message: "Premium photoreal delivery packages require Blender lighting execution metadata proving the exact site-reference photo file used for lighting."
      });
    }
    if (hasMismatchedLightingReferenceMetadata(renderManifest)) {
      blocking.push({
        id: "render-manifest:lighting-reference",
        code: "render_lighting_reference_mismatch",
        message: "Premium photoreal delivery packages require Blender lighting execution metadata to match the declared lighting reference metadata."
      });
    }
    const measurementApplication = renderManifest.blenderExecution?.measurementApplication;
    if (!measurementApplication) {
      blocking.push({
        id: "render-manifest:measurements",
        code: "render_measurement_application_missing",
        message: "Premium photoreal delivery packages require Blender execution metadata for measurement anchors."
      });
    } else if (hasIncompleteMeasurementApplication(capture, measurementApplication.applied)) {
      blocking.push({
        id: "render-manifest:measurements",
        code: "render_measurement_application_incomplete",
        message: "Premium photoreal delivery packages require every verified geometry measurement to be preserved as a Blender measurement anchor."
      });
    } else if (hasMissingMeasurementValueReadback(capture, measurementApplication.applied)) {
      blocking.push({
        id: "render-manifest:measurements",
        code: "render_measurement_value_readback_missing",
        message: "Premium photoreal delivery packages require Blender execution metadata proving every verified measurement used its declared value."
      });
    }
    if (!renderAssetBundle) {
      blocking.push({
        id: "render-manifest:asset-bundle",
        code: "render_asset_bundle_missing",
        message: "Premium photoreal delivery packages require Blender execution metadata for the asset bundle used by the render."
      });
    } else if (renderAssetBundle.assetBundleHash !== assetBundleManifest.hashes.assetBundleHash) {
      blocking.push({
        id: "render-manifest:asset-bundle",
        code: "render_asset_bundle_hash_mismatch",
        message: "Render manifest asset-bundle hash does not match the provided asset-bundle manifest."
      });
    }
    if (hasIncompleteMaterialApplication(renderManifest)) {
      blocking.push({
        id: "render-manifest:materials",
        code: "render_material_application_incomplete",
        message: "Premium photoreal delivery packages require Blender execution metadata showing every host-targeted material was applied."
      });
    }
    if (hasMismatchedMaterialPbrApplication(renderManifest)) {
      blocking.push({
        id: "render-manifest:material-pbr",
        code: "render_material_pbr_mismatch",
        message: "Premium photoreal delivery packages require Blender execution metadata proving applied PBR values match the render manifest."
      });
    }
    if (hasMissingMaterialPbrReadbackProof(renderManifest)) {
      blocking.push({
        id: "render-manifest:material-pbr-readback",
        code: "render_material_pbr_readback_missing",
        message: "Premium photoreal delivery packages require Blender material-node readback proof for every applied PBR material."
      });
    }
    if (hasMissingMaterialSourcePhotoIdentity(renderManifest, assetBundleManifest)) {
      blocking.push({
        id: "render-manifest:material-source-photos",
        code: "render_material_source_photo_identity_missing",
        message: "Premium photoreal delivery packages require Blender material execution metadata proving every material source, surface-mapping, and appearance-calibration photo file."
      });
    }
    if (hasIncompleteMaterialCalibration(renderManifest)) {
      blocking.push({
        id: "render-manifest:appearance-calibration",
        code: "render_material_calibration_incomplete",
        message: "Premium photoreal delivery packages require Blender execution metadata showing appearance calibration for every calibrated material."
      });
    }
    if (hasIncompleteMaterialSurfaceMapping(renderManifest)) {
      blocking.push({
        id: "render-manifest:surface-mapping",
        code: "render_material_surface_mapping_incomplete",
        message: "Premium photoreal delivery packages require Blender execution metadata showing surface mapping for every mapped material."
      });
    }
    if (hasIncompleteTextureApplication(materialConditionReport)) {
      blocking.push({
        id: "render-manifest:textures",
        code: "render_texture_application_incomplete",
        message: "Premium photoreal delivery packages require Blender execution metadata showing every declared texture map was applied."
      });
    }
    if (hasIncompleteTextureScaleApplication(renderManifest)) {
      blocking.push({
        id: "render-manifest:texture-scale",
        code: "render_texture_scale_incomplete",
        message: "Premium photoreal delivery packages require Blender execution metadata proving every scaled texture map used its declared physical scale."
      });
    }
    if (hasIncompleteTextureColorSpaceApplication(renderManifest)) {
      blocking.push({
        id: "render-manifest:texture-color-space",
        code: "render_texture_color_space_incomplete",
        message: "Premium photoreal delivery packages require Blender execution metadata proving every texture map used its declared color space."
      });
    }
    if (hasIncompleteTextureFileIdentityApplication(renderManifest, assetBundleManifest)) {
      blocking.push({
        id: "render-manifest:texture-file-identity",
        code: "render_texture_file_identity_missing",
        message: "Premium photoreal delivery packages require Blender execution metadata proving every applied texture file matches the asset bundle identity."
      });
    }
    if (hasIncompleteConditionApplication(materialConditionReport)) {
      blocking.push({
        id: "render-manifest:conditions",
        code: "render_condition_application_incomplete",
        message: "Premium photoreal delivery packages require Blender execution metadata showing every verified condition evidence item was rendered."
      });
    }
    if (hasIncompleteConditionVisibility(materialConditionReport)) {
      blocking.push({
        id: "material-condition-report:visibility",
        code: "render_condition_visibility_incomplete",
        message: "Premium photoreal delivery packages require every buyer-visible condition checklist item to be rendered as visible evidence."
      });
    }
    if (hasMismatchedConditionPlacement(renderManifest)) {
      blocking.push({
        id: "render-manifest:condition-placement",
        code: "render_condition_placement_mismatch",
        message: "Premium photoreal delivery packages require Blender execution metadata proving every verified condition overlay used its declared host, face, and surface placement."
      });
    }
    if (hasMissingConditionOverlayVisibilityProof(renderManifest, materialConditionReport)) {
      blocking.push({
        id: "render-manifest:condition-overlay-visibility",
        code: "render_condition_overlay_visibility_missing",
        message: "Premium photoreal delivery packages require Blender visibility proof for every buyer-visible condition overlay."
      });
    }
    if (hasMissingConditionOverlayMaterialReadback(renderManifest, materialConditionReport)) {
      blocking.push({
        id: "render-manifest:condition-overlay-material",
        code: "render_condition_overlay_material_readback_missing",
        message: "Premium photoreal delivery packages require Blender material readback proof for every buyer-visible condition overlay."
      });
    }
    if (hasMissingConditionSourcePhotoIdentity(renderManifest, assetBundleManifest)) {
      blocking.push({
        id: "render-manifest:condition-source-photos",
        code: "render_condition_source_photo_identity_missing",
        message: "Premium photoreal delivery packages require Blender execution metadata proving every verified condition overlay used its exact source photo files."
      });
    }
  }
  for (const target of deliveryTargets) {
    if (target.required && target.status === "missing") {
      blocking.push({
        id: `delivery-target:${target.target}`,
        code: "delivery_target_missing",
        message: target.message
      });
    }
  }
  const photorealQualityChecklist = buildPhotorealQualityChecklist(capture, renderManifest, materialConditionReport, assetBundleManifest, assetBundleManifestPath);
  const qualityGates = {
    ready: blocking.length === 0,
    blocking,
    warnings
  };
  const materialRenderCoverage = buildMaterialRenderCoverage(capture, renderManifest);
  const viewerLayerCoverage = buildViewerLayerCoverage(
    deliveryTargets,
    photorealQualityChecklist,
    renderQualityCoverage,
    materialRenderCoverage,
    materialCalibrationCoverage,
    materialCategoryCoverage,
    pbrMaterialCompletenessCoverage,
    conditionInspectionCoverage,
    conditionRenderCoverage,
    conditionOverlayCoverage,
    dimensionOverlayCoverage,
    hasModelDeliveryArtifact
  );
  const customerViewingChecklist = buildCustomerViewingChecklist(
    deliveryTargets,
    captureAngleCoverage,
    dimensionOverlayCoverage,
    materialRenderCoverage,
    materialCalibrationCoverage,
    pbrMaterialCompletenessCoverage,
    conditionInspectionCoverage,
    conditionOverlayCoverage,
    renderQualityCoverage
  );
  const sourceTraceIndex = buildSourceTraceIndex(
    deliveryTargets,
    captureAngleCoverage,
    dimensionOverlayCoverage,
    materialRenderCoverage,
    pbrMaterialCompletenessCoverage,
    conditionOverlayCoverage
  );
  const customerReadinessSummary = buildCustomerReadinessSummary(
    customerSurface,
    deliveryTargets,
    photorealQualityChecklist,
    qualityGates,
    assetBundleManifest,
    photoEvidenceCoverage,
    captureAngleCoverage,
    materialCategoryCoverage,
    materialCalibrationCoverage,
    materialRenderCoverage,
    pbrMaterialCompletenessCoverage,
    conditionInspectionCoverage,
    conditionRenderCoverage,
    conditionOverlayCoverage,
    dimensionOverlayCoverage,
    renderExecutionCoverage,
    renderQualityCoverage,
    renderReferenceComparisonCoverage
  );
  const evidenceHealthSummary = buildEvidenceHealthSummary(
    sourceTraceIndex,
    qualityGates,
    customerReadinessSummary
  );

  const packageWithoutHash = DigitalViewingDeliveryPackageManifestObjectSchema.omit({ hashes: true }).parse({
    schemaVersion: 1,
    packageType: "digital-viewing-delivery-package",
    captureId: capture.captureId,
    projectId: capture.projectId,
    assetType: capture.assetType,
    deliveryTier: renderManifest.renderPreset.deliveryTier,
    customerSurface,
    notGeometryAuthority: true,
    sourceOfTruth: {
      measurements: "geometry-scale-placement",
      photos: "material-condition-context-evidence",
      blender: "locked-renderable-scene",
      package: "delivery-index-no-geometry-reconstruction"
    },
    includedArtifacts: [
      {
        artifactType: "render",
        path: renderManifest.artifacts.render,
        required: true
      },
      {
        artifactType: "render-manifest",
        path: renderManifest.artifacts.manifest,
        hash: renderManifest.hashes.manifestHash,
        required: true
      },
      ...(assetBundleManifest ? [{
        artifactType: "asset-bundle-manifest" as const,
        path: assetBundleManifestPath,
        hash: assetBundleManifest.hashes.assetBundleHash,
        required: true
      }] : []),
      {
        artifactType: "material-authoring-plan",
        hash: materialAuthoringPlan.hashes.planHash,
        required: true
      },
      {
        artifactType: "material-condition-report",
        hash: materialConditionReport.hashes.reportHash,
        required: true
      }
    ],
    deliveryTargets,
    sourceTraceIndex,
    customerReadinessSummary,
    evidenceHealthSummary,
    renderQualityCoverage,
    renderReferenceComparisonCoverage,
    viewerLayerCoverage,
    customerViewingChecklist,
    photoEvidenceCoverage,
    captureAngleCoverage,
    cameraReferenceCoverage,
    measurementEvidenceCoverage: buildMeasurementEvidenceCoverage(capture, renderManifest),
    dimensionOverlayCoverage,
    materialRenderCoverage,
    materialCalibrationCoverage,
    materialCategoryCoverage,
    pbrMaterialCompletenessCoverage,
    renderExecutionCoverage,
    conditionInspectionCoverage,
    conditionRenderCoverage,
    conditionOverlayCoverage,
    photorealQualityChecklist,
    qualityGates
  });

  const hashes = {
    captureHash,
    renderManifestHash: renderManifest.hashes.manifestHash,
    materialAuthoringPlanHash: materialAuthoringPlan.hashes.planHash,
    materialConditionReportHash: materialConditionReport.hashes.reportHash
  };

  return DigitalViewingDeliveryPackageManifestSchema.parse({
    ...packageWithoutHash,
    hashes: {
      ...hashes,
      packageHash: sha256({ ...packageWithoutHash, hashes })
    }
  });
}

function buildMeasurementEvidenceCoverage(
  capture: ReturnType<typeof DigitalViewingCaptureSchema.parse>,
  renderManifest: ReturnType<typeof DigitalViewingRenderManifestSchema.parse>
): DigitalViewingDeliveryPackageManifest["measurementEvidenceCoverage"] {
  const appliedAnchors = renderManifest.blenderExecution?.measurementApplication?.applied ?? [];
  const appliedById = new Map(appliedAnchors.map((anchor) => [anchor.measurementId, anchor]));
  const entries = capture.measurements
    .filter((measurement) => measurement.verified && measurement.affectsGeometry)
    .slice()
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((measurement) => {
      const applied = appliedById.get(measurement.id);
      return {
        measurementId: measurement.id,
        label: measurement.label,
        value: measurement.value,
        tolerance: measurement.tolerance,
        unit: measurement.unit,
        confidence: measurement.confidence,
        source: measurement.source,
        hostElementId: applied?.hostElementId ?? measurement.placement?.hostElementId,
        axis: measurement.placement?.axis,
        referenceFrame: applied?.referenceFrame ?? measurement.placement?.referenceFrame,
        blenderAnchorStatus: applied ? "applied" as const : "missing" as const
      };
    });

  return {
    sourceOfTruth: "derived-from-verified-measurements-and-blender-anchor-application",
    geometryMeasurementCount: entries.length,
    appliedAnchorCount: entries.filter((entry) => entry.blenderAnchorStatus === "applied").length,
    missingAnchorCount: entries.filter((entry) => entry.blenderAnchorStatus === "missing").length,
    entries
  };
}

function buildDimensionOverlayCoverage(
  capture: ReturnType<typeof DigitalViewingCaptureSchema.parse>,
  renderManifest: ReturnType<typeof DigitalViewingRenderManifestSchema.parse>
): DigitalViewingDeliveryPackageManifest["dimensionOverlayCoverage"] {
  const appliedAnchors = renderManifest.blenderExecution?.measurementApplication?.applied ?? [];
  const appliedById = new Map(appliedAnchors.map((anchor) => [anchor.measurementId, anchor]));
  const entries = capture.measurements
    .filter((measurement) => measurement.verified && measurement.affectsGeometry)
    .slice()
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((measurement) => {
      const placement = measurement.placement;
      const applied = appliedById.get(measurement.id);
      const hasPlacement = Boolean(placement?.hostElementId && placement.axis && placement.referenceFrame);
      const overlayStatus = hasPlacement
        ? applied ? "ready" as const : "missing-anchor" as const
        : "missing-placement" as const;
      const hostElementId = applied?.hostElementId ?? placement?.hostElementId;
      const referenceFrame = applied?.referenceFrame ?? placement?.referenceFrame;
      const displayLabel = `${measurement.label}: ${measurement.value} ${measurement.unit}`;
      const annotation = overlayStatus === "ready"
        && hostElementId
        && placement?.axis
        && referenceFrame
        && placement.from
        && placement.to
        ? {
            text: displayLabel,
            value: measurement.value,
            tolerance: measurement.tolerance,
            unit: measurement.unit,
            axis: placement.axis,
            hostElementId,
            referenceFrame,
            from: placement.from,
            to: placement.to,
            source: measurement.source,
            confidence: measurement.confidence
          }
        : undefined;

      return {
        measurementId: measurement.id,
        label: measurement.label,
        value: measurement.value,
        tolerance: measurement.tolerance,
        unit: measurement.unit,
        hostElementId,
        axis: placement?.axis,
        referenceFrame,
        from: placement?.from,
        to: placement?.to,
        overlayStatus,
        displayLabel,
        annotation
      };
    });

  return {
    sourceOfTruth: "derived-from-verified-measurement-placement-and-blender-anchor-application",
    overlayCandidateCount: entries.length,
    overlayReadyCount: entries.filter((entry) => entry.overlayStatus === "ready").length,
    overlayBlockedCount: entries.filter((entry) => entry.overlayStatus !== "ready").length,
    entries
  };
}

function buildCaptureAngleCoverage(
  capture: ReturnType<typeof DigitalViewingCaptureSchema.parse>,
  renderManifest: ReturnType<typeof DigitalViewingRenderManifestSchema.parse>
): DigitalViewingDeliveryPackageManifest["captureAngleCoverage"] {
  const guide = buildDigitalViewingCaptureGuide(renderManifest.capturePreset.assetType, renderManifest.capturePreset.deliveryTier);
  const entries = guide.shotList.map((shot) => {
    const photo = capture.photos.find((candidate) =>
      candidate.sector === shot.sector && candidate.verified && shot.requiredRoles.includes(candidate.role)
    );
    const status = photo
      ? photoMatchesShot(photo, shot.captureRequirements) ? "matched" as const : "mismatched" as const
      : "missing" as const;
    return {
      shotId: shot.shotId,
      sector: shot.sector,
      requiredRoles: shot.requiredRoles,
      selectedPhotoPath: photo?.path,
      selectedPhotoRole: photo?.role,
      status,
      expected: {
        angleType: shot.captureRequirements.angleType,
        cameraMode: shot.captureRequirements.cameraMode,
        targetYawDeg: shot.captureRequirements.targetYawDeg,
        yawToleranceDeg: shot.captureRequirements.yawToleranceDeg,
        pitchGuidance: shot.captureRequirements.pitchGuidance,
        lensGuidance: shot.captureRequirements.lensGuidance,
        coverage: shot.captureRequirements.coverage,
        occlusionPolicy: shot.captureRequirements.occlusionPolicy,
        measuredEndpointsVisible: shot.captureRequirements.measuredEndpointsVisible
      },
      actual: {
        angleType: photo?.captureMetadata?.angleType,
        cameraMode: photo?.captureMetadata?.cameraMode,
        yawDeg: photo?.captureMetadata?.yawDeg,
        pitchDeg: photo?.captureMetadata?.pitchDeg,
        pitchGuidance: photo?.captureMetadata?.pitchGuidance,
        lensGuidance: photo?.captureMetadata?.lensGuidance,
        coverage: photo?.captureMetadata?.coverage,
        occluded: photo?.captureMetadata?.occluded,
        anchorsVisible: photo?.anchorsVisible,
        verified: photo?.verified
      }
    };
  });

  return {
    sourceOfTruth: "derived-from-domain-capture-preset-and-verified-photo-metadata",
    presetId: renderManifest.capturePreset.presetId,
    requiredShotCount: entries.length,
    matchedShotCount: entries.filter((entry) => entry.status === "matched").length,
    missingShotCount: entries.filter((entry) => entry.status === "missing").length,
    mismatchedShotCount: entries.filter((entry) => entry.status === "mismatched").length,
    entries
  };
}

function buildCameraReferenceCoverage(
  capture: ReturnType<typeof DigitalViewingCaptureSchema.parse>,
  renderManifest: ReturnType<typeof DigitalViewingRenderManifestSchema.parse>
): DigitalViewingDeliveryPackageManifest["cameraReferenceCoverage"] {
  const declaredCamera = renderManifest.renderPreset.camera;
  const required = renderManifest.renderPreset.deliveryTier === "premium-sales" && declaredCamera.mode === "perspective";
  const calibrationProfile = required
    ? { requiredFields: ["cameraDistanceMm", "focalLength35mmEquivalent"] as Array<"cameraDistanceMm" | "focalLength35mmEquivalent"> }
    : undefined;

  if (!required) {
    return {
      sourceOfTruth: "derived-from-render-camera-reference-photo-and-capture-metadata",
      required,
      status: "not-required",
      sector: declaredCamera.sector,
      cameraMode: declaredCamera.mode,
      referencePhoto: declaredCamera.referencePhoto,
      metadataStatus: "not-required",
      missingCalibrationFields: []
    };
  }

  if (!declaredCamera.referencePhoto) {
    return {
      sourceOfTruth: "derived-from-render-camera-reference-photo-and-capture-metadata",
      required,
      status: "missing-reference",
      sector: declaredCamera.sector,
      cameraMode: declaredCamera.mode,
      metadataStatus: "missing-photo",
      calibrationProfile,
      missingCalibrationFields: ["cameraDistanceMm", "focalLength35mmEquivalent"]
    };
  }

  const referencePhoto = capture.photos.find((photo) => photo.path === declaredCamera.referencePhoto && photo.verified);
  if (!referencePhoto) {
    return {
      sourceOfTruth: "derived-from-render-camera-reference-photo-and-capture-metadata",
      required,
      status: "blocked",
      sector: declaredCamera.sector,
      cameraMode: declaredCamera.mode,
      referencePhoto: declaredCamera.referencePhoto,
      metadataStatus: "missing-photo",
      calibrationProfile,
      missingCalibrationFields: ["cameraDistanceMm", "focalLength35mmEquivalent"]
    };
  }

  if (!referencePhoto.captureMetadata) {
    return {
      sourceOfTruth: "derived-from-render-camera-reference-photo-and-capture-metadata",
      required,
      status: "blocked",
      sector: declaredCamera.sector,
      cameraMode: declaredCamera.mode,
      referencePhoto: declaredCamera.referencePhoto,
      metadataStatus: "missing-metadata",
      calibrationProfile,
      missingCalibrationFields: ["cameraDistanceMm", "focalLength35mmEquivalent"]
    };
  }

  const missingCalibrationFields = [
    typeof referencePhoto.captureMetadata.cameraDistanceMm === "number" ? undefined : "cameraDistanceMm",
    typeof referencePhoto.captureMetadata.focalLength35mmEquivalent === "number" ? undefined : "focalLength35mmEquivalent"
  ].filter((field): field is "cameraDistanceMm" | "focalLength35mmEquivalent" => field !== undefined);

  return {
    sourceOfTruth: "derived-from-render-camera-reference-photo-and-capture-metadata",
    required,
    status: missingCalibrationFields.length === 0 ? "ready" : "blocked",
    sector: declaredCamera.sector,
    cameraMode: declaredCamera.mode,
    referencePhoto: declaredCamera.referencePhoto,
    metadataStatus: missingCalibrationFields.length === 0 ? "ready" : "missing-calibration",
    calibrationProfile,
    missingCalibrationFields,
    focalLength35mmEquivalent: referencePhoto.captureMetadata.focalLength35mmEquivalent,
    cameraDistanceMm: referencePhoto.captureMetadata.cameraDistanceMm
  };
}

function photoMatchesShot(
  photo: ReturnType<typeof DigitalViewingCaptureSchema.parse>["photos"][number],
  requirements: ReturnType<typeof buildDigitalViewingCaptureGuide>["shotList"][number]["captureRequirements"]
): boolean {
  const metadata = photo.captureMetadata;
  if (!metadata) {
    return false;
  }
  const yawMatches = typeof requirements.targetYawDeg !== "number" || typeof requirements.yawToleranceDeg !== "number"
    || (typeof metadata.yawDeg === "number" && angularDifference(metadata.yawDeg, requirements.targetYawDeg) <= requirements.yawToleranceDeg);
  return metadata.angleType === requirements.angleType
    && metadata.cameraMode === requirements.cameraMode
    && yawMatches
    && metadata.coverage === requirements.coverage
    && (requirements.occlusionPolicy !== "avoid" || !metadata.occluded)
    && (!requirements.measuredEndpointsVisible || photo.anchorsVisible);
}

function angularDifference(left: number, right: number): number {
  const difference = Math.abs(left - right) % 360;
  return difference > 180 ? 360 - difference : difference;
}

export function serializeDigitalViewingDeliveryPackageManifest(input: unknown): string {
  const manifest = DigitalViewingDeliveryPackageManifestSchema.parse(input);
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function serializeDigitalViewingAssetBundleManifest(input: unknown): string {
  const manifest = DigitalViewingAssetBundleManifestSchema.parse(input);
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function parseCustomerSurface(input: unknown): DigitalViewingCustomerSurface {
  return input === undefined ? "internal-review" : DigitalViewingCustomerSurfaceSchema.parse(input);
}

function buildCustomerReadinessSummary(
  customerSurface: DigitalViewingCustomerSurface,
  deliveryTargets: DigitalViewingDeliveryPackageTarget[],
  photorealQualityChecklist: DigitalViewingDeliveryPackageManifest["photorealQualityChecklist"],
  qualityGates: DigitalViewingDeliveryPackageManifest["qualityGates"],
  assetBundleManifest: DigitalViewingAssetBundleManifest | undefined,
  photoEvidenceCoverage: DigitalViewingDeliveryPackageManifest["photoEvidenceCoverage"],
  captureAngleCoverage: DigitalViewingDeliveryPackageManifest["captureAngleCoverage"],
  materialCategoryCoverage: DigitalViewingDeliveryPackageManifest["materialCategoryCoverage"],
  materialCalibrationCoverage: DigitalViewingDeliveryPackageManifest["materialCalibrationCoverage"],
  materialRenderCoverage: DigitalViewingDeliveryPackageManifest["materialRenderCoverage"],
  pbrMaterialCompletenessCoverage: DigitalViewingDeliveryPackageManifest["pbrMaterialCompletenessCoverage"],
  conditionInspectionCoverage: DigitalViewingDeliveryPackageManifest["conditionInspectionCoverage"],
  conditionRenderCoverage: DigitalViewingDeliveryPackageManifest["conditionRenderCoverage"],
  conditionOverlayCoverage: DigitalViewingDeliveryPackageManifest["conditionOverlayCoverage"],
  dimensionOverlayCoverage: DigitalViewingDeliveryPackageManifest["dimensionOverlayCoverage"],
  renderExecutionCoverage: DigitalViewingDeliveryPackageManifest["renderExecutionCoverage"],
  renderQualityCoverage: DigitalViewingDeliveryPackageManifest["renderQualityCoverage"],
  renderReferenceComparisonCoverage: DigitalViewingDeliveryPackageManifest["renderReferenceComparisonCoverage"]
): DigitalViewingDeliveryPackageManifest["customerReadinessSummary"] {
  const requiredTargets = deliveryTargets.filter((target) => target.required);
  const readyRequiredTargetCount = requiredTargets.filter((target) => target.status === "ready").length;
  const failedChecks = photorealQualityChecklist.filter((item) => item.status === "failed");
  const assetBundleAction = assetBundleManifest && !assetBundleManifest.summary.ready
    ? [`Resolve asset-bundle-files: ${assetBundleManifest.summary.missingCount}/${assetBundleManifest.summary.requiredCount} required photo, texture, or render assets missing from the prepared bundle.`]
    : [];
  const renderAssetBundleAction = renderExecutionCoverage.assetBundle.status === "missing-execution" || renderExecutionCoverage.assetBundle.status === "mismatched"
    ? ["Resolve render-asset-bundle: Blender execution must prove the prepared asset bundle hash was used for the photoreal render."]
    : [];
  const overlayAction = dimensionOverlayCoverage.overlayBlockedCount > 0
    ? [`Resolve dimension-overlays: ${dimensionOverlayCoverage.overlayBlockedCount} verified measurements need placement or Blender anchors before customer dimension overlays.`]
    : [];
  const renderQualityAction = renderQualityCoverage.status === "ready"
    ? []
    : ["Resolve render-quality: Blender render settings must be customer-ready before photoreal viewing."];
  const renderReferenceComparisonAction = renderReferenceComparisonCoverage.required && renderReferenceComparisonCoverage.status !== "matched"
    ? [`Resolve render-reference-comparison: ${renderReferenceComparisonCoverage.evidence}`]
    : [];
  const materialAction = buildCustomerMaterialNextAction(materialRenderCoverage);
  const materialCharacterAction = materialRenderCoverage.appearanceCalibrationMismatchCount > 0
    ? [`Resolve material-character: ${materialRenderCoverage.appearanceCalibrationMatchedCount}/${materialRenderCoverage.appearanceCalibrationMatchedCount + materialRenderCoverage.appearanceCalibrationMismatchCount} photo-calibrated material appearances matched Blender execution for customer material feel.`]
    : [];
  const conditionAction = conditionOverlayCoverage.overlayBlockedCount > 0
    ? [`Resolve condition-disclosure: ${conditionOverlayCoverage.overlayReadyCount}/${conditionOverlayCoverage.overlayCandidateCount} visible condition overlays ready for customer disclosure.`]
    : [];
  const conditionRenderAction = conditionRenderCoverage.missingConditionCount > 0
    ? [`Resolve condition-render: ${conditionRenderCoverage.appliedConditionCount}/${conditionRenderCoverage.visibleConditionCount} buyer-visible condition items rendered by Blender for customer condition disclosure.`]
    : [];
  const captureAngleAction = captureAngleCoverage.missingShotCount > 0 || captureAngleCoverage.mismatchedShotCount > 0
    ? [`Resolve reference-photos: ${captureAngleCoverage.matchedShotCount}/${captureAngleCoverage.requiredShotCount} required capture angles matched for customer visual reference.`]
    : [];
  const photoEvidenceAction = photoEvidenceCoverage.missingEvidenceCount > 0
    ? [`Resolve photo-evidence: ${photoEvidenceCoverage.evidenceCount - photoEvidenceCoverage.missingEvidenceCount}/${photoEvidenceCoverage.evidenceCount} referenced photo evidence items verified for customer trust.`]
    : [];
  const materialCategoryAction = materialCategoryCoverage.missingCategoryCount > 0
    ? [`Resolve material-categories: ${materialCategoryCoverage.coveredCategoryCount}/${materialCategoryCoverage.requiredCategoryCount} domain-required material categories present in the render manifest.`]
    : [];
  const materialCalibrationAction = materialCalibrationCoverage.calibrationBlockedCount > 0
    ? [`Resolve material-calibration: ${materialCalibrationCoverage.calibrationReadyCount}/${materialCalibrationCoverage.calibrationCandidateCount} photo-observed material calibrations verified for customer material fidelity.`]
    : [];
  const pbrMaterialAction = pbrMaterialCompletenessCoverage.incompleteMaterialCount > 0
    ? [`Resolve pbr-materials: ${pbrMaterialCompletenessCoverage.completeMaterialCount}/${pbrMaterialCompletenessCoverage.materialCount} renderable PBR material definitions complete for photoreal customer delivery.`]
    : [];
  const inspectionZoneAction = conditionInspectionCoverage.missingZoneCount > 0
    ? [`Resolve inspection-zones: ${conditionInspectionCoverage.verifiedZoneCount}/${conditionInspectionCoverage.requiredZoneCount} domain-required inspection zones verified before customer condition disclosure.`]
    : [];
  const nextActions = Array.from(new Set([
    ...qualityGates.blocking.map((reason) => reason.message),
    ...failedChecks.map((item) => `Resolve ${item.check}: ${item.evidence}`),
    ...assetBundleAction,
    ...renderAssetBundleAction,
    ...photoEvidenceAction,
    ...captureAngleAction,
    ...materialCategoryAction,
    ...materialCalibrationAction,
    ...pbrMaterialAction,
    ...materialAction,
    ...materialCharacterAction,
    ...inspectionZoneAction,
    ...conditionRenderAction,
    ...conditionAction,
    ...overlayAction,
    ...renderQualityAction,
    ...renderReferenceComparisonAction
  ]));

  return {
    customerSurface,
    status: qualityGates.ready && failedChecks.length === 0 && dimensionOverlayCoverage.overlayBlockedCount === 0 && renderQualityCoverage.status === "ready" ? "ready" : "blocked",
    requiredTargetCount: requiredTargets.length,
    readyRequiredTargetCount,
    missingRequiredTargetCount: requiredTargets.length - readyRequiredTargetCount,
    qualityCheckCount: photorealQualityChecklist.length,
    passedQualityCheckCount: photorealQualityChecklist.length - failedChecks.length,
    failedQualityCheckCount: failedChecks.length,
    blockingCount: qualityGates.blocking.length,
    warningCount: qualityGates.warnings.length,
    nextActions,
    sourceOfTruth: "derived-from-delivery-targets-quality-checks-gates-asset-bundle-render-execution-photo-evidence-capture-angles-material-categories-material-calibration-pbr-materials-material-render-material-character-inspection-zones-condition-render-condition-overlays-render-quality-and-reference-comparison"
  };
}

function buildCustomerMaterialNextAction(
  materialRenderCoverage: DigitalViewingDeliveryPackageManifest["materialRenderCoverage"]
): string[] {
  if (materialRenderCoverage.missingMaterialCount > 0) {
    return [`Resolve material-fidelity: ${materialRenderCoverage.appliedMaterialCount}/${materialRenderCoverage.hostTargetedMaterialCount} host-targeted materials applied by Blender.`];
  }
  if (materialRenderCoverage.missingTextureMapCount > 0) {
    return [`Resolve material-fidelity: ${materialRenderCoverage.appliedTextureMapCount}/${materialRenderCoverage.textureMapCount} texture maps applied by Blender.`];
  }
  if (materialRenderCoverage.appearanceCalibrationMismatchCount > 0) {
    return [`Resolve material-fidelity: ${materialRenderCoverage.appearanceCalibrationMatchedCount}/${materialRenderCoverage.appearanceCalibrationMatchedCount + materialRenderCoverage.appearanceCalibrationMismatchCount} material appearance calibrations matched Blender execution.`];
  }
  if (materialRenderCoverage.surfaceMappingMismatchCount > 0) {
    return [`Resolve material-fidelity: ${materialRenderCoverage.surfaceMappingMatchedCount}/${materialRenderCoverage.surfaceMappingMatchedCount + materialRenderCoverage.surfaceMappingMismatchCount} material surface mappings matched Blender execution.`];
  }
  if (materialRenderCoverage.textureColorSpaceMismatchCount > 0) {
    return [`Resolve material-fidelity: ${materialRenderCoverage.textureColorSpaceMatchedCount}/${materialRenderCoverage.textureColorSpaceMismatchCount + materialRenderCoverage.textureColorSpaceMatchedCount} texture color spaces matched Blender execution.`];
  }
  return [];
}

function buildViewerLayerCoverage(
  deliveryTargets: DigitalViewingDeliveryPackageTarget[],
  photorealQualityChecklist: DigitalViewingDeliveryPackageManifest["photorealQualityChecklist"],
  renderQualityCoverage: DigitalViewingDeliveryPackageManifest["renderQualityCoverage"],
  materialRenderCoverage: DigitalViewingDeliveryPackageManifest["materialRenderCoverage"],
  materialCalibrationCoverage: DigitalViewingDeliveryPackageManifest["materialCalibrationCoverage"],
  materialCategoryCoverage: DigitalViewingDeliveryPackageManifest["materialCategoryCoverage"],
  pbrMaterialCompletenessCoverage: DigitalViewingDeliveryPackageManifest["pbrMaterialCompletenessCoverage"],
  conditionInspectionCoverage: DigitalViewingDeliveryPackageManifest["conditionInspectionCoverage"],
  conditionRenderCoverage: DigitalViewingDeliveryPackageManifest["conditionRenderCoverage"],
  conditionOverlayCoverage: DigitalViewingDeliveryPackageManifest["conditionOverlayCoverage"],
  dimensionOverlayCoverage: DigitalViewingDeliveryPackageManifest["dimensionOverlayCoverage"],
  hasModelDeliveryArtifact: boolean
): DigitalViewingDeliveryPackageManifest["viewerLayerCoverage"] {
  const targetById = new Map(deliveryTargets.map((target) => [target.target, target]));
  const photorealTarget = targetById.get("photoreal-render");
  const materialReportTarget = targetById.get("material-condition-report");
  const webViewerTarget = targetById.get("web-viewer");
  const passedChecks = photorealQualityChecklist.filter((item) => item.status === "passed").length;
  const materialReady = materialRenderCoverage.missingMaterialCount === 0
    && materialRenderCoverage.missingTextureMapCount === 0
    && materialRenderCoverage.textureColorSpaceMismatchCount === 0
    && materialRenderCoverage.surfaceMappingMismatchCount === 0
    && materialRenderCoverage.appearanceCalibrationMismatchCount === 0
    && materialCalibrationCoverage.calibrationBlockedCount === 0
    && materialCategoryCoverage.missingCategoryCount === 0
    && pbrMaterialCompletenessCoverage.incompleteMaterialCount === 0;
  const conditionReady = conditionRenderCoverage.missingConditionCount === 0
    && conditionInspectionCoverage.missingZoneCount === 0
    && conditionOverlayCoverage.overlayBlockedCount === 0;
  const overlayReady = dimensionOverlayCoverage.overlayBlockedCount === 0;
  const photorealReady = photorealTarget?.status === "ready"
    && passedChecks === photorealQualityChecklist.length
    && renderQualityCoverage.status === "ready";
  const photorealEvidence = renderQualityCoverage.status === "ready"
    ? `${passedChecks}/${photorealQualityChecklist.length} photoreal quality checks passed; render quality ready`
    : `render quality ${renderQualityCoverage.status}`;
  const materialSourceIds = sortedUnique([
    ...materialRenderCoverage.entries.map((entry) => entry.materialId),
    ...materialCalibrationCoverage.entries.map((entry) => entry.materialId),
    ...pbrMaterialCompletenessCoverage.entries.map((entry) => entry.materialId)
  ]);
  const conditionSourceIds = sortedUnique([
    ...conditionRenderCoverage.entries.map((entry) => entry.conditionId),
    ...conditionInspectionCoverage.entries.flatMap((entry) => entry.conditionIds),
    ...conditionOverlayCoverage.entries.map((entry) => entry.conditionId)
  ]);
  const dimensionSourceIds = sortedUnique(dimensionOverlayCoverage.entries.map((entry) => entry.measurementId));
  const modelArtifactSourceIds = sortedUnique(deliveryTargets
    .filter((target) => target.target === "blend" || target.target === "glb" || target.target === "usdz")
    .map((target) => target.target));
  const webDeliverySourceIds = sortedUnique([
    ...(webViewerTarget ? [webViewerTarget.target] : []),
    ...modelArtifactSourceIds
  ]);

  const entries: DigitalViewingDeliveryPackageManifest["viewerLayerCoverage"]["entries"] = [
    {
      layer: "photoreal-scene",
      required: Boolean(photorealTarget?.required),
      status: photorealReady ? "ready" : "blocked",
      sourceIds: photorealTarget ? [photorealTarget.target] : [],
      evidence: photorealEvidence
    },
    {
      layer: "material-fidelity",
      required: Boolean(photorealTarget?.required || materialReportTarget?.required),
      status: materialReady ? "ready" : "blocked",
      sourceIds: materialSourceIds,
      evidence: materialCalibrationCoverage.calibrationBlockedCount > 0
        ? `${materialCalibrationCoverage.calibrationReadyCount}/${materialCalibrationCoverage.calibrationCandidateCount} photo-observed materials calibrated`
        : materialCategoryCoverage.missingCategoryCount > 0
        ? `${materialCategoryCoverage.coveredCategoryCount}/${materialCategoryCoverage.requiredCategoryCount} required material categories covered`
        : materialRenderCoverage.appearanceCalibrationMismatchCount > 0
        ? `${materialRenderCoverage.appearanceCalibrationMatchedCount}/${materialRenderCoverage.appearanceCalibrationMatchedCount + materialRenderCoverage.appearanceCalibrationMismatchCount} material appearance calibrations matched Blender execution`
        : materialRenderCoverage.surfaceMappingMismatchCount > 0
        ? `${materialRenderCoverage.surfaceMappingMatchedCount}/${materialRenderCoverage.surfaceMappingMatchedCount + materialRenderCoverage.surfaceMappingMismatchCount} material surface mappings matched Blender execution`
        : materialRenderCoverage.textureColorSpaceMismatchCount > 0
        ? `${materialRenderCoverage.textureColorSpaceMatchedCount}/${materialRenderCoverage.textureColorSpaceMatchedCount + materialRenderCoverage.textureColorSpaceMismatchCount} texture color spaces matched Blender execution`
        : `${materialRenderCoverage.appliedMaterialCount} materials applied, ${materialRenderCoverage.appliedTextureMapCount} texture maps applied, ${pbrMaterialCompletenessCoverage.completeMaterialCount} PBR materials complete`
    },
    {
      layer: "condition-disclosure",
      required: Boolean(materialReportTarget?.required),
      status: conditionReady ? "ready" : "blocked",
      sourceIds: conditionSourceIds,
      evidence: conditionInspectionCoverage.missingZoneCount > 0
        ? `${conditionInspectionCoverage.verifiedZoneCount}/${conditionInspectionCoverage.requiredZoneCount} required inspection zones verified`
        : `${conditionRenderCoverage.visibleConditionCount} visible condition items rendered across ${conditionRenderCoverage.inspectionZoneCount} inspection zones`
    },
    {
      layer: "dimension-overlays",
      required: true,
      status: overlayReady ? "ready" : "blocked",
      sourceIds: dimensionSourceIds,
      evidence: `${dimensionOverlayCoverage.overlayReadyCount}/${dimensionOverlayCoverage.overlayCandidateCount} verified measurements ready for overlays`
    },
    {
      layer: "web-delivery",
      required: Boolean(webViewerTarget?.required),
      status: webViewerTarget ? webViewerTarget.status === "ready" && hasModelDeliveryArtifact ? "ready" : "blocked" : "not-requested",
      sourceIds: webViewerTarget ? webDeliverySourceIds : [],
      evidence: webViewerTarget
        ? webViewerTarget.status === "ready" && !hasModelDeliveryArtifact
          ? "web-viewer target ready but model artifact missing"
          : `web-viewer target ${webViewerTarget.status}`
        : "web-viewer target not requested"
    }
  ];

  return {
    sourceOfTruth: "derived-from-delivery-targets-render-evidence-overlays-and-condition-report",
    layerCount: entries.length,
    readyLayerCount: entries.filter((entry) => entry.status === "ready").length,
    blockedLayerCount: entries.filter((entry) => entry.status === "blocked").length,
    notRequestedLayerCount: entries.filter((entry) => entry.status === "not-requested").length,
    entries
  };
}

function buildCustomerViewingChecklist(
  deliveryTargets: DigitalViewingDeliveryPackageTarget[],
  captureAngleCoverage: DigitalViewingDeliveryPackageManifest["captureAngleCoverage"],
  dimensionOverlayCoverage: DigitalViewingDeliveryPackageManifest["dimensionOverlayCoverage"],
  materialRenderCoverage: DigitalViewingDeliveryPackageManifest["materialRenderCoverage"],
  materialCalibrationCoverage: DigitalViewingDeliveryPackageManifest["materialCalibrationCoverage"],
  pbrMaterialCompletenessCoverage: DigitalViewingDeliveryPackageManifest["pbrMaterialCompletenessCoverage"],
  conditionInspectionCoverage: DigitalViewingDeliveryPackageManifest["conditionInspectionCoverage"],
  conditionOverlayCoverage: DigitalViewingDeliveryPackageManifest["conditionOverlayCoverage"],
  renderQualityCoverage: DigitalViewingDeliveryPackageManifest["renderQualityCoverage"]
): DigitalViewingDeliveryPackageManifest["customerViewingChecklist"] {
  const targetById = new Map(deliveryTargets.map((target) => [target.target, target]));
  const photorealTarget = targetById.get("photoreal-render");
  const webViewerTarget = targetById.get("web-viewer");
  const modelArtifactTargets = deliveryTargets.filter((target) => target.target === "blend" || target.target === "glb" || target.target === "usdz");
  const requiredModelArtifactTargets = modelArtifactTargets.filter((target) => target.required);
  const readyRequiredModelArtifactTargets = requiredModelArtifactTargets.filter((target) => target.status === "ready");
  const readyModelArtifactTargets = modelArtifactTargets.filter((target) => target.status === "ready");
  const webViewerNeedsModelArtifact = Boolean(webViewerTarget?.required);
  const modelArtifactRequired = requiredModelArtifactTargets.length > 0 || webViewerNeedsModelArtifact;
  const requiredModelArtifactCount = requiredModelArtifactTargets.length > 0 ? requiredModelArtifactTargets.length : webViewerNeedsModelArtifact ? 1 : 0;
  const readyModelArtifactCount = requiredModelArtifactTargets.length > 0 ? readyRequiredModelArtifactTargets.length : webViewerNeedsModelArtifact && readyModelArtifactTargets.length > 0 ? 1 : 0;
  const modelArtifactStatus = modelArtifactTargets.length === 0
    ? webViewerNeedsModelArtifact ? "blocked" as const : "not-requested" as const
    : readyModelArtifactCount === requiredModelArtifactCount
      ? "ready" as const
      : "blocked" as const;
  const modelArtifactEvidence = modelArtifactTargets.length === 0
    ? webViewerNeedsModelArtifact ? "0/1 required model artifacts ready" : "model artifact target not requested"
    : `${readyModelArtifactCount}/${requiredModelArtifactCount} required model artifacts ready`;
  const webModelReady = Boolean(webViewerTarget && webViewerTarget.status === "ready" && readyModelArtifactTargets.length > 0);
  const captureSourceIds = sortedUnique(captureAngleCoverage.entries.map((entry) => entry.shotId));
  const dimensionSourceIds = sortedUnique(dimensionOverlayCoverage.entries.map((entry) => entry.measurementId));
  const materialSourceIds = sortedUnique([
    ...materialRenderCoverage.entries.map((entry) => entry.materialId),
    ...materialCalibrationCoverage.entries.map((entry) => entry.materialId),
    ...pbrMaterialCompletenessCoverage.entries.map((entry) => entry.materialId)
  ]);
  const materialExecutionBlockedCount = materialRenderCoverage.missingMaterialCount
    + materialRenderCoverage.missingTextureMapCount
    + materialRenderCoverage.textureColorSpaceMismatchCount
    + materialRenderCoverage.surfaceMappingMismatchCount
    + materialRenderCoverage.appearanceCalibrationMismatchCount;
  const materialSurfaceMappingCount = materialRenderCoverage.surfaceMappingMatchedCount + materialRenderCoverage.surfaceMappingMismatchCount;
  const conditionSourceIds = sortedUnique([
    ...conditionInspectionCoverage.entries.flatMap((entry) => entry.conditionIds),
    ...conditionOverlayCoverage.entries.map((entry) => entry.conditionId)
  ]);
  const modelArtifactSourceIds = sortedUnique(modelArtifactTargets.map((target) => target.target));
  const items: DigitalViewingDeliveryPackageManifest["customerViewingChecklist"]["items"] = [
    {
      item: "reference-photos",
      category: "capture",
      sourceCoverage: "captureAngleCoverage",
      sourceIds: captureSourceIds,
      required: true,
      status: captureAngleCoverage.missingShotCount === 0 && captureAngleCoverage.mismatchedShotCount === 0 ? "ready" : "blocked",
      evidence: `${captureAngleCoverage.matchedShotCount}/${captureAngleCoverage.requiredShotCount} required capture shots matched`
    },
    {
      item: "dimension-overlays",
      category: "measurements",
      sourceCoverage: "dimensionOverlayCoverage",
      sourceIds: dimensionSourceIds,
      required: true,
      status: dimensionOverlayCoverage.overlayBlockedCount === 0 ? "ready" : "blocked",
      evidence: `${dimensionOverlayCoverage.overlayReadyCount}/${dimensionOverlayCoverage.overlayCandidateCount} verified measurement annotations ready`
    },
    {
      item: "material-fidelity",
      category: "materials",
      sourceCoverage: "materialRenderCoverage+materialCalibrationCoverage+pbrMaterialCompletenessCoverage",
      sourceIds: materialSourceIds,
      required: true,
      status: materialExecutionBlockedCount === 0 && materialCalibrationCoverage.calibrationBlockedCount === 0 && pbrMaterialCompletenessCoverage.incompleteMaterialCount === 0 ? "ready" : "blocked",
      evidence: `${pbrMaterialCompletenessCoverage.completeMaterialCount}/${pbrMaterialCompletenessCoverage.materialCount} PBR materials complete; ${materialCalibrationCoverage.calibrationReadyCount}/${materialCalibrationCoverage.calibrationCandidateCount} calibration candidates ready; ${materialRenderCoverage.surfaceMappingMatchedCount}/${materialSurfaceMappingCount} Blender material surface mappings matched`
    },
    {
      item: "condition-disclosure",
      category: "conditions",
      sourceCoverage: "conditionInspectionCoverage+conditionOverlayCoverage",
      sourceIds: conditionSourceIds,
      required: true,
      status: conditionOverlayCoverage.overlayBlockedCount === 0 && conditionInspectionCoverage.missingZoneCount === 0 ? "ready" : "blocked",
      evidence: `${conditionOverlayCoverage.overlayReadyCount}/${conditionOverlayCoverage.overlayCandidateCount} visible condition disclosures ready; ${conditionInspectionCoverage.verifiedZoneCount}/${conditionInspectionCoverage.requiredZoneCount} inspection zones verified`
    },
    {
      item: "photoreal-render",
      category: "render",
      sourceCoverage: "renderQualityCoverage",
      sourceIds: photorealTarget ? [photorealTarget.target] : [],
      required: Boolean(photorealTarget?.required),
      status: photorealTarget && renderQualityCoverage.status === "ready" ? "ready" : photorealTarget ? "blocked" : "not-requested",
      evidence: photorealTarget ? `${renderQualityCoverage.declared.renderer} render quality ${renderQualityCoverage.status}` : "photoreal-render target not requested"
    },
    {
      item: "model-artifact",
      category: "delivery",
      sourceCoverage: "deliveryTargets",
      sourceIds: modelArtifactSourceIds,
      required: modelArtifactRequired,
      status: modelArtifactStatus,
      evidence: modelArtifactEvidence
    },
    {
      item: "web-model",
      category: "delivery",
      sourceCoverage: "deliveryTargets",
      sourceIds: webViewerTarget ? [webViewerTarget.target] : [],
      required: Boolean(webViewerTarget?.required),
      status: webViewerTarget ? webModelReady ? "ready" : "blocked" : "not-requested",
      evidence: webViewerTarget
        ? webViewerTarget.status === "ready" && readyModelArtifactTargets.length === 0
          ? "web-viewer target ready but model artifact missing"
          : `web-viewer target ${webViewerTarget.status}`
        : "web-viewer target not requested"
    }
  ];

  const readyItemCount = items.filter((item) => item.status === "ready").length;
  const blockedItemCount = items.filter((item) => item.status === "blocked").length;
  const notRequestedItemCount = items.filter((item) => item.status === "not-requested").length;

  return {
    sourceOfTruth: "derived-from-capture-angles-materials-dimensions-conditions-render-quality-and-delivery-targets",
    ready: blockedItemCount === 0,
    itemCount: items.length,
    readyItemCount,
    blockedItemCount,
    notRequestedItemCount,
    items
  };
}

function buildSourceTraceIndex(
  deliveryTargets: DigitalViewingDeliveryPackageTarget[],
  captureAngleCoverage: DigitalViewingDeliveryPackageManifest["captureAngleCoverage"],
  dimensionOverlayCoverage: DigitalViewingDeliveryPackageManifest["dimensionOverlayCoverage"],
  materialRenderCoverage: DigitalViewingDeliveryPackageManifest["materialRenderCoverage"],
  pbrMaterialCompletenessCoverage: DigitalViewingDeliveryPackageManifest["pbrMaterialCompletenessCoverage"],
  conditionOverlayCoverage: DigitalViewingDeliveryPackageManifest["conditionOverlayCoverage"]
): DigitalViewingDeliveryPackageManifest["sourceTraceIndex"] {
  const materialRenderById = new Map(materialRenderCoverage.entries.map((entry) => [entry.materialId, entry]));
  const entries: DigitalViewingDeliveryPackageManifest["sourceTraceIndex"]["entries"] = [
    ...captureAngleCoverage.entries.map((entry) => ({
      sourceId: entry.shotId,
      sourceType: "capture-shot" as const,
      sourceCoverage: "captureAngleCoverage" as const,
      label: `${entry.sector} capture reference`,
      status: entry.status,
      path: entry.selectedPhotoPath
    })),
    ...dimensionOverlayCoverage.entries.map((entry) => ({
      sourceId: entry.measurementId,
      sourceType: "measurement" as const,
      sourceCoverage: "dimensionOverlayCoverage" as const,
      label: entry.displayLabel,
      status: entry.overlayStatus === "ready" ? "ready" as const : "blocked" as const
    })),
    ...pbrMaterialCompletenessCoverage.entries.map((entry) => ({
      sourceId: entry.materialId,
      sourceType: "material" as const,
      sourceCoverage: "materialRenderCoverage+pbrMaterialCompletenessCoverage" as const,
      label: `${entry.category} material`,
      status: getMaterialTraceStatus(entry, materialRenderById.get(entry.materialId)),
      path: materialRenderById.get(entry.materialId)?.sourcePhotos[0],
      evidencePaths: materialRenderById.get(entry.materialId)?.sourcePhotos
    })),
    ...conditionOverlayCoverage.entries.map((entry) => ({
      sourceId: entry.conditionId,
      sourceType: "condition" as const,
      sourceCoverage: "conditionOverlayCoverage" as const,
      label: `${entry.type}: ${entry.severity}`,
      status: entry.overlayStatus === "ready" ? "ready" as const : "blocked" as const,
      path: entry.sourcePhotos[0],
      evidencePaths: entry.sourcePhotos
    })),
    ...deliveryTargets.map((target) => ({
      sourceId: target.target,
      sourceType: "delivery-target" as const,
      sourceCoverage: "deliveryTargets" as const,
      label: `${target.target} delivery target`,
      status: target.status === "missing" ? "missing" as const : target.status,
      path: target.path,
      hash: target.hash
    }))
  ]
    .map((entry) => Object.fromEntries(Object.entries(entry).filter(([, value]) => value !== undefined)) as typeof entries[number])
    .sort((left, right) => `${left.sourceType}:${left.sourceId}`.localeCompare(`${right.sourceType}:${right.sourceId}`));

  return {
    sourceOfTruth: "derived-from-existing-package-coverage-without-geometry-reconstruction",
    entryCount: entries.length,
    entries
  };
}

function buildEvidenceHealthSummary(
  sourceTraceIndex: DigitalViewingDeliveryPackageManifest["sourceTraceIndex"],
  qualityGates: DigitalViewingDeliveryPackageManifest["qualityGates"],
  customerReadinessSummary: DigitalViewingDeliveryPackageManifest["customerReadinessSummary"]
): DigitalViewingDeliveryPackageManifest["evidenceHealthSummary"] {
  const sections = [
    buildEvidenceHealthSection("capture-shots", "capture-shot", sourceTraceIndex),
    buildEvidenceHealthSection("measurements", "measurement", sourceTraceIndex),
    buildEvidenceHealthSection("materials", "material", sourceTraceIndex),
    buildEvidenceHealthSection("conditions", "condition", sourceTraceIndex),
    buildEvidenceHealthSection("delivery-targets", "delivery-target", sourceTraceIndex)
  ];
  const readyEvidenceCount = sections.reduce((sum, section) => sum + section.readyEvidenceCount, 0);
  const blockedEvidenceCount = sections.reduce((sum, section) => sum + section.blockedEvidenceCount, 0);
  const missingEvidenceCount = sections.reduce((sum, section) => sum + section.missingEvidenceCount, 0);
  const evidencePathCount = sections.reduce((sum, section) => sum + section.evidencePathCount, 0);

  return {
    sourceOfTruth: "derived-from-source-trace-index-quality-gates-and-customer-readiness",
    status: qualityGates.ready && customerReadinessSummary.status === "ready" && blockedEvidenceCount === 0 && missingEvidenceCount === 0 ? "ready" : "blocked",
    indexedSourceCount: sourceTraceIndex.entryCount,
    readyEvidenceCount,
    blockedEvidenceCount,
    missingEvidenceCount,
    evidencePathCount,
    warningCount: qualityGates.warnings.length,
    sections
  };
}

function buildEvidenceHealthSection(
  section: DigitalViewingDeliveryPackageManifest["evidenceHealthSummary"]["sections"][number]["section"],
  sourceType: DigitalViewingDeliveryPackageManifest["sourceTraceIndex"]["entries"][number]["sourceType"],
  sourceTraceIndex: DigitalViewingDeliveryPackageManifest["sourceTraceIndex"]
): DigitalViewingDeliveryPackageManifest["evidenceHealthSummary"]["sections"][number] {
  const entries = sourceTraceIndex.entries.filter((entry) => entry.sourceType === sourceType);
  const readyEvidenceCount = entries.filter((entry) => isReadyEvidenceStatus(entry.status)).length;
  const blockedEvidenceCount = entries.filter((entry) => isBlockedEvidenceStatus(entry.status)).length;
  const missingEvidenceCount = entries.filter((entry) => isMissingEvidenceStatus(entry.status)).length;
  const evidencePathCount = entries.reduce((sum, entry) => sum + sourceTraceEvidencePathCount(entry), 0);

  return {
    section,
    status: blockedEvidenceCount === 0 && missingEvidenceCount === 0 ? "ready" : "blocked",
    indexedSourceCount: entries.length,
    readyEvidenceCount,
    blockedEvidenceCount,
    missingEvidenceCount,
    evidencePathCount
  };
}

function sourceTraceEvidencePathCount(
  entry: DigitalViewingDeliveryPackageManifest["sourceTraceIndex"]["entries"][number]
): number {
  return entry.evidencePaths?.length ?? (entry.path ? 1 : 0);
}

function getMaterialTraceStatus(
  pbrEntry: DigitalViewingDeliveryPackageManifest["pbrMaterialCompletenessCoverage"]["entries"][number],
  renderEntry: DigitalViewingDeliveryPackageManifest["materialRenderCoverage"]["entries"][number] | undefined
): DigitalViewingDeliveryPackageManifest["sourceTraceIndex"]["entries"][number]["status"] {
  if (pbrEntry.completenessStatus !== "complete") {
    return "incomplete";
  }
  if (!renderEntry
    || renderEntry.materialRenderStatus !== "applied"
    || renderEntry.missingTextureMapCount > 0
    || renderEntry.textureColorSpaceStatus === "mismatched"
    || renderEntry.textureColorSpaceStatus === "missing-execution"
    || renderEntry.surfaceMappingExecutionStatus === "mismatched"
    || renderEntry.surfaceMappingExecutionStatus === "missing-execution"
    || renderEntry.appearanceCalibrationExecutionStatus === "mismatched"
    || renderEntry.appearanceCalibrationExecutionStatus === "missing-execution") {
    return "blocked";
  }
  return "ready";
}

function isReadyEvidenceStatus(status: DigitalViewingDeliveryPackageManifest["sourceTraceIndex"]["entries"][number]["status"]): boolean {
  return status === "matched" || status === "ready" || status === "complete";
}

function isBlockedEvidenceStatus(status: DigitalViewingDeliveryPackageManifest["sourceTraceIndex"]["entries"][number]["status"]): boolean {
  return status === "mismatched" || status === "blocked" || status === "incomplete";
}

function isMissingEvidenceStatus(status: DigitalViewingDeliveryPackageManifest["sourceTraceIndex"]["entries"][number]["status"]): boolean {
  return status === "missing" || status === "not-requested";
}

function sortedUnique(values: string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function sortedUniqueMaterialCategories(values: DigitalViewingMaterialCategory[]): DigitalViewingMaterialCategory[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function normalizePbrReadback(
  pbrReadback: BlenderMaterialExecution["pbrReadback"] | undefined
): DigitalViewingDeliveryPackageManifest["materialRenderCoverage"]["entries"][number]["pbrReadback"] | undefined {
  if (pbrReadback?.sourceOfTruth !== "read-from-blender-material-node-values-after-application" || !pbrReadback.values) {
    return undefined;
  }
  return {
    sourceOfTruth: pbrReadback.sourceOfTruth,
    fields: sortedUnique(pbrReadback.fields ?? Object.keys(pbrReadback.values)) as NonNullable<DigitalViewingDeliveryPackageManifest["materialRenderCoverage"]["entries"][number]["pbrReadback"]>["fields"],
    values: Object.fromEntries(Object.entries(pbrReadback.values).filter(([, value]) => value !== undefined))
  };
}

function normalizeAppearanceCalibrationReadback(
  appearanceCalibration: Partial<DigitalViewingMaterialAppearanceCalibration> | undefined
): DigitalViewingDeliveryPackageManifest["materialRenderCoverage"]["entries"][number]["appearanceCalibrationReadback"] | undefined {
  if (!appearanceCalibration?.method || !appearanceCalibration.confidence) {
    return undefined;
  }
  return {
    method: appearanceCalibration.method,
    ...(appearanceCalibration.sourcePhoto ? { sourcePhoto: appearanceCalibration.sourcePhoto } : {}),
    ...(appearanceCalibration.illuminant ? { illuminant: appearanceCalibration.illuminant } : {}),
    confidence: appearanceCalibration.confidence
  };
}

function normalizeSurfaceMappingReadback(
  surfaceMapping: Partial<DigitalViewingMaterialSurfaceMapping> | undefined
): DigitalViewingDeliveryPackageManifest["materialRenderCoverage"]["entries"][number]["surfaceMappingReadback"] | undefined {
  if (!surfaceMapping?.projection || !surfaceMapping.scaleMm || !surfaceMapping.faces?.length) {
    return undefined;
  }
  return {
    projection: surfaceMapping.projection,
    faces: surfaceMapping.faces.slice().sort((left, right) => left.localeCompare(right)),
    scaleMm: surfaceMapping.scaleMm,
    rotationDeg: surfaceMapping.rotationDeg ?? 0,
    ...(surfaceMapping.sourcePhoto ? { sourcePhoto: surfaceMapping.sourcePhoto } : {})
  };
}

function surfaceMappingsMatch(
  actual: Partial<DigitalViewingMaterialSurfaceMapping> | undefined,
  expected: DigitalViewingMaterialSurfaceMapping
): boolean {
  if (!actual?.projection || !actual.scaleMm || !actual.faces?.length) {
    return false;
  }
  const actualFaces = actual.faces.slice().sort((left, right) => left.localeCompare(right));
  const expectedFaces = expected.faces.slice().sort((left, right) => left.localeCompare(right));
  return actual.projection === expected.projection
    && actual.scaleMm === expected.scaleMm
    && (actual.rotationDeg ?? 0) === expected.rotationDeg
    && actual.sourcePhoto === expected.sourcePhoto
    && actualFaces.length === expectedFaces.length
    && actualFaces.every((face, index) => face === expectedFaces[index]);
}

function hasReadyModelDeliveryArtifact(deliveryTargets: DigitalViewingDeliveryPackageTarget[]): boolean {
  return deliveryTargets.some((target) =>
    target.status === "ready" && (target.target === "blend" || target.target === "glb" || target.target === "usdz")
  );
}

function missingHashDeliveryArtifacts(
  deliveryTargets: DigitalViewingDeliveryPackageTarget[],
  deliveryArtifacts: Map<DigitalViewingOutputTarget, DigitalViewingDeliveryArtifact>
): DigitalViewingOutputTarget[] {
  return deliveryTargets
    .filter((target) => target.required && target.status === "ready" && deliveryArtifacts.has(target.target) && !target.hash)
    .map((target) => target.target)
    .sort((left, right) => TargetSortOrder.indexOf(left) - TargetSortOrder.indexOf(right));
}

function buildMaterialCategoryCoverage(
  renderManifest: ReturnType<typeof DigitalViewingRenderManifestSchema.parse>
): DigitalViewingDeliveryPackageManifest["materialCategoryCoverage"] {
  const entries = renderManifest.capturePreset.requiredMaterialCategories
    .slice()
    .sort((left, right) => left.localeCompare(right))
    .map((category) => {
      const materialIds = renderManifest.materials
        .filter((material) => material.category === category)
        .map((material) => material.materialId)
        .sort((left, right) => left.localeCompare(right));
      return {
        category,
        required: true,
        status: materialIds.length > 0 ? "ready" as const : "missing" as const,
        materialIds
      };
    });

  return {
    sourceOfTruth: "derived-from-domain-capture-preset-and-render-manifest-material-categories",
    requiredCategoryCount: entries.length,
    coveredCategoryCount: entries.filter((entry) => entry.status === "ready").length,
    missingCategoryCount: entries.filter((entry) => entry.status === "missing").length,
    entries
  };
}

function buildConditionInspectionCoverage(
  renderManifest: ReturnType<typeof DigitalViewingRenderManifestSchema.parse>,
  report: ReturnType<typeof buildDigitalViewingMaterialConditionReport>
): DigitalViewingDeliveryPackageManifest["conditionInspectionCoverage"] {
  const inspectionsByZone = new Map(report.conditionInspections.map((inspection) => [inspection.zone, inspection]));
  const entries = renderManifest.capturePreset.requiredInspectionZones
    .slice()
    .sort((left, right) => left.localeCompare(right))
    .map((zone) => {
      const inspection = inspectionsByZone.get(zone);
      return {
        zone,
        required: true,
        status: inspection
          ? inspection.verified ? "verified" as const : "unverified" as const
          : "missing" as const,
        inspectionStatus: inspection?.status ?? "missing" as const,
        conditionIds: inspection?.conditionIds.slice().sort((left, right) => left.localeCompare(right)) ?? [],
        sourcePhotos: inspection?.sourcePhotos.slice().sort((left, right) => left.localeCompare(right)) ?? [],
        sourcePhotoEvidence: inspection?.sourcePhotoEvidence
          .slice()
          .sort((left, right) => left.path.localeCompare(right.path)) ?? []
      };
    });

  return {
    sourceOfTruth: "derived-from-domain-capture-preset-and-condition-inspection-evidence",
    requiredZoneCount: entries.length,
    verifiedZoneCount: entries.filter((entry) => entry.status === "verified").length,
    missingZoneCount: entries.filter((entry) => entry.status !== "verified").length,
    defectFoundZoneCount: entries.filter((entry) => entry.inspectionStatus === "defect-found").length,
    entries
  };
}

function buildConditionRenderCoverage(
  renderManifest: ReturnType<typeof DigitalViewingRenderManifestSchema.parse>,
  report: ReturnType<typeof buildDigitalViewingMaterialConditionReport>
): DigitalViewingDeliveryPackageManifest["conditionRenderCoverage"] {
  const blenderExecution = renderManifest.blenderExecution as {
    conditionApplication?: {
      applied?: BlenderConditionExecution[];
    };
  } | undefined;
  const appliedConditions = blenderExecution?.conditionApplication?.applied;
  const entries = report.conditionVisibilityChecklist
    .slice()
    .sort((left, right) => left.conditionId.localeCompare(right.conditionId))
    .map((condition) => {
      const applied = appliedConditions?.find((entry) => entry.conditionId === condition.conditionId);
      return {
        conditionId: condition.conditionId,
        hostElementId: condition.hostElementId,
        type: condition.type,
        severity: condition.severity,
        verification: condition.verification,
        mustBeVisible: condition.mustBeVisible,
        sourcePhotos: condition.sourcePhotos.slice().sort((left, right) => left.localeCompare(right)),
        sourcePhotoEvidence: condition.sourcePhotoEvidence
          .slice()
          .sort((left, right) => left.path.localeCompare(right.path)),
        inspectionZones: condition.inspectionZones.slice().sort((left, right) => left.localeCompare(right)),
        materialSurface: condition.materialSurface,
        conditionRenderStatus: applied
          ? "applied" as const
          : appliedConditions
            ? "missing-host" as const
            : "missing-execution" as const,
        placementStatus: compareConditionPlacement(condition.surfacePlacement, applied),
        visibilityProofStatus: compareConditionVisibilityProof(condition, applied?.visibilityProof),
        surfacePlacement: condition.surfacePlacement,
        visibilityProof: normalizeConditionVisibilityProof(applied?.visibilityProof)
      };
    });
  const inspectionZones = report.conditionInspections
    .slice()
    .sort((left, right) => left.zone.localeCompare(right.zone))
    .map((inspection) => ({
      zone: inspection.zone,
      status: inspection.status,
      verified: inspection.verified,
      conditionIds: inspection.conditionIds.slice().sort((left, right) => left.localeCompare(right)),
      sourcePhotos: inspection.sourcePhotos.slice().sort((left, right) => left.localeCompare(right)),
      sourcePhotoEvidence: inspection.sourcePhotoEvidence
        .slice()
        .sort((left, right) => left.path.localeCompare(right.path))
    }));
  const appliedConditionCount = entries.filter((entry) => entry.conditionRenderStatus === "applied").length;
  return {
    sourceOfTruth: "derived-from-condition-evidence-inspection-zones-and-blender-condition-application",
    verifiedConditionCount: report.conditions.filter((condition) => condition.verification === "verified").length,
    visibleConditionCount: entries.filter((entry) => entry.mustBeVisible).length,
    appliedConditionCount,
    missingConditionCount: entries.length - appliedConditionCount,
    inspectionZoneCount: inspectionZones.length,
    verifiedInspectionZoneCount: inspectionZones.filter((inspection) => inspection.verified).length,
    defectFoundZoneCount: inspectionZones.filter((inspection) => inspection.status === "defect-found").length,
    entries,
    inspectionZones
  };
}

function buildConditionOverlayCoverage(
  conditionRenderCoverage: DigitalViewingDeliveryPackageManifest["conditionRenderCoverage"]
): DigitalViewingDeliveryPackageManifest["conditionOverlayCoverage"] {
  const entries = conditionRenderCoverage.entries
    .filter((condition) => condition.mustBeVisible)
    .map((condition) => {
      const disclosureProfile = conditionDisclosureProfile(condition.severity);
      const disclosureProfileIssues = condition.surfacePlacement
        ? conditionDisclosureProfileIssues(condition.surfacePlacement, disclosureProfile)
        : [];
      const overlayStatus = !condition.surfacePlacement
        ? "missing-placement" as const
        : condition.conditionRenderStatus === "applied" && condition.placementStatus === "matched" && condition.visibilityProofStatus === "matched"
          ? disclosureProfileIssues.length === 0 ? "ready" as const : "insufficient-visibility" as const
          : "missing-render" as const;
      const displayLabel = `${condition.type}: ${condition.severity} severity`;
      const disclosure = overlayStatus === "ready" && condition.hostElementId && condition.surfacePlacement
        ? {
            title: displayLabel,
            conditionId: condition.conditionId,
            type: condition.type,
            severity: condition.severity,
            verification: condition.verification,
            hostElementId: condition.hostElementId,
            inspectionZones: condition.inspectionZones,
            sourcePhotos: condition.sourcePhotos,
            sourcePhotoEvidence: condition.sourcePhotoEvidence,
            materialSurface: condition.materialSurface,
            surfacePlacement: condition.surfacePlacement
          }
        : undefined;
      return {
        conditionId: condition.conditionId,
        hostElementId: condition.hostElementId,
        type: condition.type,
        severity: condition.severity,
        verification: condition.verification,
        sourcePhotos: condition.sourcePhotos,
        sourcePhotoEvidence: condition.sourcePhotoEvidence,
        inspectionZones: condition.inspectionZones,
        materialSurface: condition.materialSurface,
        surfacePlacement: condition.surfacePlacement,
        overlayStatus,
        displayLabel,
        disclosureProfile,
        disclosureProfileIssues,
        disclosure
      };
    });

  return {
    sourceOfTruth: "derived-from-visible-condition-placement-photos-and-blender-condition-application",
    overlayCandidateCount: entries.length,
    overlayReadyCount: entries.filter((entry) => entry.overlayStatus === "ready").length,
    overlayBlockedCount: entries.filter((entry) => entry.overlayStatus !== "ready").length,
    entries
  };
}

function conditionDisclosureProfile(
  severity: DigitalViewingDeliveryPackageManifest["conditionOverlayCoverage"]["entries"][number]["severity"]
): { profileId: string; minAreaMm2: number; minLongestDimensionMm: number } {
  switch (severity) {
    case "high":
      return { profileId: "high-condition-disclosure", minAreaMm2: 25000, minLongestDimensionMm: 500 };
    case "medium":
      return { profileId: "medium-condition-disclosure", minAreaMm2: 10000, minLongestDimensionMm: 250 };
    case "low":
      return { profileId: "low-condition-disclosure", minAreaMm2: 2500, minLongestDimensionMm: 80 };
    case "unknown":
      return { profileId: "unknown-condition-disclosure", minAreaMm2: 10000, minLongestDimensionMm: 250 };
  }
}

function conditionDisclosureProfileIssues(
  surfacePlacement: NonNullable<DigitalViewingDeliveryPackageManifest["conditionOverlayCoverage"]["entries"][number]["surfacePlacement"]>,
  profile: { profileId: string; minAreaMm2: number; minLongestDimensionMm: number }
): string[] {
  const area = surfacePlacement.widthMm * surfacePlacement.heightMm;
  const longestDimension = Math.max(surfacePlacement.widthMm, surfacePlacement.heightMm);
  const issues: string[] = [];
  if (area < profile.minAreaMm2) {
    issues.push(`overlay area ${area}mm2 below ${profile.profileId} minimum ${profile.minAreaMm2}mm2`);
  }
  if (longestDimension < profile.minLongestDimensionMm) {
    issues.push(`overlay longest dimension ${longestDimension}mm below ${profile.profileId} minimum ${profile.minLongestDimensionMm}mm`);
  }
  return issues;
}

function compareConditionPlacement(
  expected: DigitalViewingDeliveryPackageManifest["conditionRenderCoverage"]["entries"][number]["surfacePlacement"],
  applied: {
    hostElementId?: string;
    face?: string;
    surfacePlacement?: {
      hostElementId?: string;
      face?: string;
      u?: number;
      v?: number;
      widthMm?: number;
      heightMm?: number;
      rotationDeg?: number;
    };
  } | undefined
): DigitalViewingDeliveryPackageManifest["conditionRenderCoverage"]["entries"][number]["placementStatus"] {
  if (!expected) {
    return "not-declared";
  }
  if (!applied?.surfacePlacement) {
    return "missing-placement";
  }
  const appliedPlacement = applied.surfacePlacement;
  return applied.hostElementId === expected.hostElementId
    && applied.face === expected.face
    && appliedPlacement.hostElementId === expected.hostElementId
    && appliedPlacement.face === expected.face
    && appliedPlacement.u === expected.u
    && appliedPlacement.v === expected.v
    && appliedPlacement.widthMm === expected.widthMm
    && appliedPlacement.heightMm === expected.heightMm
    && appliedPlacement.rotationDeg === expected.rotationDeg
    ? "matched"
    : "mismatched";
}

function compareConditionVisibilityProof(
  condition: ReturnType<typeof buildDigitalViewingMaterialConditionReport>["conditionVisibilityChecklist"][number],
  proof: ConditionOverlayVisibilityProof | undefined
): DigitalViewingDeliveryPackageManifest["conditionRenderCoverage"]["entries"][number]["visibilityProofStatus"] {
  if (!condition.mustBeVisible) {
    return "not-required";
  }
  if (!proof) {
    return "missing";
  }
  if (!condition.surfacePlacement) {
    return "mismatched";
  }
  return proof.sourceOfTruth === "created-visible-blender-overlay-object"
    && typeof proof.objectName === "string"
    && proof.objectName.length > 0
    && proof.visibleInRender === true
    && proof.dimensionsMm?.widthMm === condition.surfacePlacement.widthMm
    && proof.dimensionsMm?.heightMm === condition.surfacePlacement.heightMm
    ? "matched"
    : "mismatched";
}

function isMatchedConditionOverlayMaterialReadback(
  condition: ReturnType<typeof buildDigitalViewingMaterialConditionReport>["conditionVisibilityChecklist"][number],
  proof: ConditionOverlayVisibilityProof
): boolean {
  return proof.materialReadback?.sourceOfTruth === "read-from-blender-condition-material-after-application"
    && typeof proof.materialReadback.baseColor === "string"
    && /^#[0-9a-fA-F]{6}$/.test(proof.materialReadback.baseColor)
    && typeof proof.materialReadback.alpha === "number"
    && proof.materialReadback.alpha > 0
    && proof.materialReadback.alpha <= 1
    && typeof proof.materialReadback.roughness === "number"
    && proof.materialReadback.roughness >= 0
    && proof.materialReadback.roughness <= 1
    && typeof proof.materialReadback.metallic === "number"
    && proof.materialReadback.metallic >= 0
    && proof.materialReadback.metallic <= 1
    && proof.materialReadback.conditionType === condition.type
    && proof.materialReadback.severity === condition.severity;
}

function normalizeConditionVisibilityProof(
  proof: ConditionOverlayVisibilityProof | undefined
): DigitalViewingDeliveryPackageManifest["conditionRenderCoverage"]["entries"][number]["visibilityProof"] | undefined {
  if (
    proof?.sourceOfTruth !== "created-visible-blender-overlay-object"
    || !proof.objectName
    || proof.visibleInRender === undefined
    || proof.dimensionsMm?.widthMm === undefined
    || proof.dimensionsMm.heightMm === undefined
    || proof.materialReadback?.sourceOfTruth !== "read-from-blender-condition-material-after-application"
    || !proof.materialReadback.baseColor
    || proof.materialReadback.alpha === undefined
    || proof.materialReadback.roughness === undefined
    || proof.materialReadback.metallic === undefined
    || !proof.materialReadback.conditionType
    || !proof.materialReadback.severity
  ) {
    return undefined;
  }
  const conditionType = proof.materialReadback.conditionType;
  const severity = proof.materialReadback.severity;
  if (!isConditionOverlayType(conditionType) || !isConditionOverlaySeverity(severity)) {
    return undefined;
  }
  return {
    sourceOfTruth: "created-visible-blender-overlay-object",
    objectName: proof.objectName,
    ...(proof.materialName ? { materialName: proof.materialName } : {}),
    visibleInRender: proof.visibleInRender,
    dimensionsMm: {
      widthMm: proof.dimensionsMm.widthMm,
      heightMm: proof.dimensionsMm.heightMm
    },
    materialReadback: {
      sourceOfTruth: "read-from-blender-condition-material-after-application",
      baseColor: proof.materialReadback.baseColor,
      alpha: proof.materialReadback.alpha,
      roughness: proof.materialReadback.roughness,
      metallic: proof.materialReadback.metallic,
      conditionType,
      severity
    }
  };
}

function isConditionOverlayType(
  value: string
): value is DigitalViewingDeliveryPackageManifest["conditionRenderCoverage"]["entries"][number]["type"] {
  return ["scratch", "dent", "stain", "crack", "fading", "oxidation", "patina", "seam", "repair", "wear", "unknown"].includes(value);
}

function isConditionOverlaySeverity(
  value: string
): value is DigitalViewingDeliveryPackageManifest["conditionRenderCoverage"]["entries"][number]["severity"] {
  return ["low", "medium", "high", "unknown"].includes(value);
}

function buildRenderExecutionCoverage(
  renderManifest: ReturnType<typeof DigitalViewingRenderManifestSchema.parse>,
  assetBundleManifest: DigitalViewingAssetBundleManifest | undefined,
  assetBundleManifestPath: string | undefined
): DigitalViewingDeliveryPackageManifest["renderExecutionCoverage"] {
  const blenderExecution = renderManifest.blenderExecution as {
    camera?: {
      sector?: string;
      mode?: string;
      referencePhoto?: string;
    };
    lighting?: BlenderLightingExecution;
    assetBundle?: {
      assetBundleHash?: string;
    };
    renderArtifact?: {
      path?: string;
      sizeBytes?: number;
      sha256?: string;
      width?: number;
      height?: number;
    };
  } | undefined;
  const declaredCamera = renderManifest.renderPreset.camera;
  const executedCamera = blenderExecution?.camera;
  const declaredLighting = renderManifest.renderPreset.lighting;
  const executedLighting = blenderExecution?.lighting;
  const declaredAssetBundleHash = assetBundleManifest?.hashes.assetBundleHash;
  const executedAssetBundleHash = blenderExecution?.assetBundle?.assetBundleHash;
  const executedRenderArtifact = blenderExecution?.renderArtifact;
  const declaredResolution = renderManifest.renderPreset.resolution;
  const renderArtifactMatched = executedRenderArtifact !== undefined
    && executedRenderArtifact.path === renderManifest.artifacts.render
    && executedRenderArtifact.sizeBytes !== undefined
    && executedRenderArtifact.sha256 !== undefined
    && executedRenderArtifact.width === declaredResolution.width
    && executedRenderArtifact.height === declaredResolution.height;
  return {
    sourceOfTruth: "derived-from-render-manifest-and-blender-execution-metadata",
    renderer: renderManifest.renderPreset.renderer,
    renderPath: renderManifest.artifacts.render,
    manifestPath: renderManifest.artifacts.manifest,
    camera: {
      declaredSector: declaredCamera.sector,
      declaredMode: declaredCamera.mode,
      declaredReferencePhoto: declaredCamera.referencePhoto,
      executedSector: executedCamera?.sector,
      executedMode: executedCamera?.mode,
      executedReferencePhoto: executedCamera?.referencePhoto,
      status: executedCamera
        ? executedCamera.sector === declaredCamera.sector
          && executedCamera.mode === declaredCamera.mode
          && executedCamera.referencePhoto === declaredCamera.referencePhoto
          ? "matched" as const
          : "mismatched" as const
        : "missing-execution" as const
    },
    lighting: {
      declaredEnvironment: declaredLighting.environment,
      declaredReferencePhoto: declaredLighting.referencePhoto,
      declaredLightingReference: renderManifest.lightingReference?.lightingReference,
      declaredColorReference: renderManifest.lightingReference?.colorReference,
      declaredWhiteBalanceKelvin: renderManifest.lightingReference?.whiteBalanceKelvin,
      declaredExposureEv: renderManifest.lightingReference?.exposureEv,
      executedEnvironment: executedLighting?.environment,
      executedReferencePhoto: executedLighting?.referencePhoto,
      executedLightingReference: executedLighting?.lightingReference,
      executedColorReference: executedLighting?.colorReference,
      executedWhiteBalanceKelvin: executedLighting?.whiteBalanceKelvin,
      executedExposureEv: executedLighting?.exposureEv,
      status: executedLighting
        ? executedLighting.environment === declaredLighting.environment
          && executedLighting.referencePhoto === declaredLighting.referencePhoto
          && lightingReferenceMetadataMatches(renderManifest.lightingReference, executedLighting)
          ? "matched" as const
          : "mismatched" as const
        : "missing-execution" as const
    },
    assetBundle: {
      status: declaredAssetBundleHash
        ? executedAssetBundleHash
          ? executedAssetBundleHash === declaredAssetBundleHash
            ? "matched" as const
            : "mismatched" as const
          : "missing-execution" as const
        : "not-declared" as const,
      declaredHash: declaredAssetBundleHash,
      executedHash: executedAssetBundleHash,
      manifestPath: assetBundleManifestPath
    },
    renderArtifact: {
      declaredPath: renderManifest.artifacts.render,
      declaredWidth: declaredResolution.width,
      declaredHeight: declaredResolution.height,
      executedPath: executedRenderArtifact?.path,
      sizeBytes: executedRenderArtifact?.sizeBytes,
      sha256: executedRenderArtifact?.sha256,
      executedWidth: executedRenderArtifact?.width,
      executedHeight: executedRenderArtifact?.height,
      status: executedRenderArtifact
        ? renderArtifactMatched
          ? "matched" as const
          : "mismatched" as const
        : "missing-execution" as const
    }
  };
}

function buildRenderQualityCoverage(
  renderManifest: ReturnType<typeof DigitalViewingRenderManifestSchema.parse>
): DigitalViewingDeliveryPackageManifest["renderQualityCoverage"] {
  const blenderExecution = renderManifest.blenderExecution as {
    renderQuality?: {
      renderer?: string;
      samples?: number;
      denoise?: boolean;
      resolution?: { width: number; height: number };
      filmTransparent?: boolean;
      viewTransform?: string;
      look?: string;
      exposure?: number;
      gamma?: number;
      worldColor?: string;
    };
  } | undefined;
  const executedRaw = blenderExecution?.renderQuality ?? {};
  const executed: DigitalViewingDeliveryPackageManifest["renderQualityCoverage"]["executed"] = {
    renderer: executedRaw.renderer === "cycles" || executedRaw.renderer === "eevee" ? executedRaw.renderer : undefined,
    samples: executedRaw.samples,
    denoise: executedRaw.denoise,
    resolution: executedRaw.resolution,
    filmTransparent: executedRaw.filmTransparent,
    viewTransform: executedRaw.viewTransform,
    look: executedRaw.look,
    exposure: executedRaw.exposure,
    gamma: executedRaw.gamma,
    worldColor: executedRaw.worldColor
  };
  const qualityProfile = renderQualityResolutionRequirement(renderManifest.assetType, renderManifest.renderPreset.deliveryTier);
  const declared = {
    assetType: renderManifest.assetType,
    renderer: renderManifest.renderPreset.renderer,
    resolution: renderManifest.renderPreset.resolution,
    deliveryTier: renderManifest.renderPreset.deliveryTier,
    qualityProfile
  };
  const samplingRequirement = renderQualitySamplingRequirement(
    renderManifest.assetType,
    declared.deliveryTier,
    declared.renderer
  );
  const samplingPassed = executed.samples !== undefined
    && executed.samples >= samplingRequirement.minSamples
    && (!samplingRequirement.requiresDenoise || executed.denoise === true);
  const samplingEvidence = samplingPassed
    ? declared.renderer === "cycles"
      ? `${executed.samples ?? 0} samples with denoise ${executed.denoise === true ? "enabled" : "missing"}`
      : `${executed.samples ?? 0} samples`
    : `${declared.assetType} ${declared.deliveryTier} requires ${samplingRequirement.minSamples} ${declared.renderer} samples${samplingRequirement.requiresDenoise ? " with denoise enabled" : ""}; got ${executed.samples ?? 0}`;
  const colorManagementPassed = executed.viewTransform === "Filmic"
    && executed.look === "Medium High Contrast"
    && executed.exposure === 0
    && executed.gamma === 1;
  const colorManagementEvidence = [
    executed.viewTransform ?? "missing",
    executed.look ?? "missing",
    `exposure ${executed.exposure ?? "missing"}`,
    `gamma ${executed.gamma ?? "missing"}`
  ].join(" / ");
  const resolutionMatchesPreset = executed.resolution?.width === declared.resolution.width
    && executed.resolution.height === declared.resolution.height;
  const resolutionMeetsProfile = executed.resolution !== undefined
    && executed.resolution.width >= qualityProfile.minWidth
    && executed.resolution.height >= qualityProfile.minHeight;
  const resolutionPassed = resolutionMatchesPreset && resolutionMeetsProfile;
  const resolutionEvidence = !executed.resolution
    ? "resolution execution missing"
    : !resolutionMeetsProfile
      ? `${declared.assetType} ${declared.deliveryTier} requires at least ${qualityProfile.minWidth}x${qualityProfile.minHeight} render resolution; got ${executed.resolution.width}x${executed.resolution.height}`
      : `${executed.resolution.width}x${executed.resolution.height} output resolution`;
  const checks = [
    {
      check: "renderer" as const,
      status: executed.renderer === declared.renderer ? "passed" as const : "failed" as const,
      evidence: executed.renderer ? `${executed.renderer} renderer executed` : "renderer execution missing"
    },
    {
      check: "sampling" as const,
      status: samplingPassed ? "passed" as const : "failed" as const,
      evidence: samplingEvidence
    },
    {
      check: "resolution" as const,
      status: resolutionPassed ? "passed" as const : "failed" as const,
      evidence: resolutionEvidence
    },
    {
      check: "color-management" as const,
      status: colorManagementPassed ? "passed" as const : "failed" as const,
      evidence: colorManagementEvidence
    },
    {
      check: "background" as const,
      status: executed.filmTransparent === false && Boolean(executed.worldColor) ? "passed" as const : "failed" as const,
      evidence: executed.worldColor ? `opaque render with world color ${executed.worldColor}` : "opaque world color missing"
    }
  ];
  const status = blenderExecution?.renderQuality
    ? checks.every((check) => check.status === "passed") ? "ready" as const : "blocked" as const
    : "missing-execution" as const;

  return {
    sourceOfTruth: "derived-from-render-preset-and-blender-render-settings",
    status,
    declared,
    executed,
    checks
  };
}

function buildRenderReferenceComparisonCoverage(
  renderManifest: RenderManifest,
  photorealRenderRequired: boolean,
  renderQualityCoverage: DigitalViewingDeliveryPackageManifest["renderQualityCoverage"],
  renderExecutionCoverage: DigitalViewingDeliveryPackageManifest["renderExecutionCoverage"]
): DigitalViewingDeliveryPackageManifest["renderReferenceComparisonCoverage"] {
  const referencePhoto = renderManifest.renderPreset.camera.referencePhoto;
  const renderPath = renderManifest.artifacts.render;
  const required = photorealRenderRequired
    && renderQualityCoverage.status === "ready"
    && renderExecutionCoverage.renderArtifact.status === "matched"
    && referencePhoto !== undefined;
  const blenderExecution = renderManifest.blenderExecution as {
    referenceComparison?: BlenderReferenceComparisonExecution;
  } | undefined;
  const comparison = blenderExecution?.referenceComparison;
  if (!required) {
    const comparisonMethodTier = comparisonMethodTierFor(comparison?.method);
    return {
      sourceOfTruth: "derived-from-render-artifact-reference-photo-and-blender-comparison-metadata",
      required,
      referencePhoto,
      renderPath,
      method: comparison?.method,
      comparisonMethodTier,
      requiredComparisonMethodTier: RequiredPhotorealReferenceComparisonMethodTier,
      comparisonMethodTierStatus: "not-required",
      score: comparison?.score,
      threshold: comparison?.threshold,
      minimumRequiredThreshold: MinimumStructuralReferenceComparisonThreshold,
      status: "not-required",
      evidence: "reference comparison waits for matched render output and ready render quality"
    };
  }
  if (comparison === undefined
    || comparison.method === undefined
    || comparison.method === "reference-metadata-alignment"
    || comparison.method === "average-color-rmse"
    || comparison.renderPath !== renderPath
    || comparison.referencePhoto !== referencePhoto
    || comparison.score === undefined
    || comparison.threshold === undefined) {
    const comparisonMethodTier = comparisonMethodTierFor(comparison?.method);
    return {
      sourceOfTruth: "derived-from-render-artifact-reference-photo-and-blender-comparison-metadata",
      required,
      referencePhoto,
      renderPath,
      method: comparison?.method,
      comparisonMethodTier,
      requiredComparisonMethodTier: RequiredPhotorealReferenceComparisonMethodTier,
      comparisonMethodTierStatus: comparisonMethodTierStatusFor(comparisonMethodTier, RequiredPhotorealReferenceComparisonMethodTier),
      score: comparison?.score,
      threshold: comparison?.threshold,
      minimumRequiredThreshold: MinimumStructuralReferenceComparisonThreshold,
      status: "missing-execution",
      evidence: comparison?.method === "reference-metadata-alignment"
        ? `perceptual comparison missing for ${renderPath} against ${referencePhoto ?? "missing reference photo"}`
        : comparison?.method === "average-color-rmse"
          ? `structural comparison missing for ${renderPath} against ${referencePhoto ?? "missing reference photo"}`
        : `reference comparison missing for ${renderPath} against ${referencePhoto ?? "missing reference photo"}`
    };
  }
  const method = comparison.method;
  const score = comparison.score;
  const threshold = comparison.threshold;
  const comparisonMethodTier = comparisonMethodTierFor(method);
  const comparisonMethodTierStatus = comparisonMethodTierStatusFor(comparisonMethodTier, RequiredPhotorealReferenceComparisonMethodTier);
  if (method === "luma-grid-rmse" && threshold < MinimumStructuralReferenceComparisonThreshold) {
    return {
      sourceOfTruth: "derived-from-render-artifact-reference-photo-and-blender-comparison-metadata",
      required,
      referencePhoto,
      renderPath,
      method,
      comparisonMethodTier,
      requiredComparisonMethodTier: RequiredPhotorealReferenceComparisonMethodTier,
      comparisonMethodTierStatus,
      score,
      threshold,
      minimumRequiredThreshold: MinimumStructuralReferenceComparisonThreshold,
      status: "mismatched",
      evidence: `${method} threshold ${threshold} < minimum ${MinimumStructuralReferenceComparisonThreshold} for ${renderPath} against ${referencePhoto ?? "missing reference photo"}`
    };
  }
  const matched = score >= threshold;
  return {
    sourceOfTruth: "derived-from-render-artifact-reference-photo-and-blender-comparison-metadata",
    required,
    referencePhoto,
    renderPath,
    method,
    comparisonMethodTier,
    requiredComparisonMethodTier: RequiredPhotorealReferenceComparisonMethodTier,
    comparisonMethodTierStatus,
    score,
    threshold,
    minimumRequiredThreshold: MinimumStructuralReferenceComparisonThreshold,
    status: matched ? "matched" : "mismatched",
    evidence: `${method} score ${score} ${matched ? ">=" : "<"} ${threshold} against ${referencePhoto ?? "missing reference photo"}`
  };
}

function comparisonMethodTierFor(
  method: BlenderReferenceComparisonExecution["method"] | undefined
): DigitalViewingDeliveryPackageManifest["renderReferenceComparisonCoverage"]["comparisonMethodTier"] {
  switch (method) {
    case undefined:
      return "none";
    case "reference-metadata-alignment":
      return "metadata-only";
    case "average-color-rmse":
      return "color-only";
    case "luma-grid-rmse":
      return "structural";
    case "ssim":
    case "pixel-diff":
    case "feature-alignment":
      return "perceptual";
  }
}

function comparisonMethodTierStatusFor(
  comparisonMethodTier: DigitalViewingDeliveryPackageManifest["renderReferenceComparisonCoverage"]["comparisonMethodTier"],
  requiredComparisonMethodTier: DigitalViewingDeliveryPackageManifest["renderReferenceComparisonCoverage"]["requiredComparisonMethodTier"]
): DigitalViewingDeliveryPackageManifest["renderReferenceComparisonCoverage"]["comparisonMethodTierStatus"] {
  return comparisonMethodTierRank(comparisonMethodTier) >= comparisonMethodTierRank(requiredComparisonMethodTier)
    ? "satisfies-required"
    : "below-required";
}

function comparisonMethodTierRank(
  comparisonMethodTier: DigitalViewingDeliveryPackageManifest["renderReferenceComparisonCoverage"]["comparisonMethodTier"]
): number {
  switch (comparisonMethodTier) {
    case "none":
      return 0;
    case "metadata-only":
      return 1;
    case "color-only":
      return 2;
    case "structural":
      return 3;
    case "perceptual":
      return 4;
  }
}

function renderQualityResolutionRequirement(
  assetType: ReturnType<typeof DigitalViewingRenderManifestSchema.parse>["assetType"],
  deliveryTier: ReturnType<typeof DigitalViewingRenderManifestSchema.parse>["renderPreset"]["deliveryTier"]
): { minWidth: number; minHeight: number } {
  if (deliveryTier !== "premium-sales") {
    return { minWidth: 1280, minHeight: 720 };
  }
  switch (assetType) {
    case "vehicle":
    case "boat":
      return { minWidth: 2560, minHeight: 1440 };
    case "property":
      return { minWidth: 1920, minHeight: 1080 };
    case "exterior-structure":
      return { minWidth: 1600, minHeight: 1000 };
    case "product":
    case "custom":
      return { minWidth: 1280, minHeight: 720 };
  }
}

function renderQualitySamplingRequirement(
  assetType: ReturnType<typeof DigitalViewingRenderManifestSchema.parse>["assetType"],
  deliveryTier: ReturnType<typeof DigitalViewingRenderManifestSchema.parse>["renderPreset"]["deliveryTier"],
  renderer: ReturnType<typeof DigitalViewingRenderManifestSchema.parse>["renderPreset"]["renderer"]
): { minSamples: number; requiresDenoise: boolean } {
  if (deliveryTier !== "premium-sales") {
    return renderer === "cycles"
      ? { minSamples: 64, requiresDenoise: true }
      : { minSamples: 32, requiresDenoise: false };
  }

  if (assetType === "vehicle" || assetType === "boat") {
    return renderer === "cycles"
      ? { minSamples: 128, requiresDenoise: true }
      : { minSamples: 64, requiresDenoise: false };
  }

  if (assetType === "property") {
    return renderer === "cycles"
      ? { minSamples: 96, requiresDenoise: true }
      : { minSamples: 48, requiresDenoise: false };
  }

  return renderer === "cycles"
    ? { minSamples: 64, requiresDenoise: true }
    : { minSamples: 32, requiresDenoise: false };
}

function buildMaterialRenderCoverage(
  capture: ReturnType<typeof DigitalViewingCaptureSchema.parse>,
  renderManifest: ReturnType<typeof DigitalViewingRenderManifestSchema.parse>
): DigitalViewingDeliveryPackageManifest["materialRenderCoverage"] {
	      const blenderExecution = renderManifest.blenderExecution as {
	    materialApplication?: {
	      applied?: Array<{
	        materialId: string;
	        object: string;
	        surfaceMapping?: Partial<DigitalViewingMaterialSurfaceMapping>;
	        appearanceCalibration?: Partial<DigitalViewingMaterialAppearanceCalibration>;
	        pbrReadback?: BlenderMaterialExecution["pbrReadback"];
	      }>;
      textures?: {
        applied?: Array<{ path: string; type: string; colorSpace?: string; scaleMm?: number }>;
      };
    };
  } | undefined;
  const appliedMaterials = blenderExecution?.materialApplication?.applied;
  const appliedTextures = blenderExecution?.materialApplication?.textures?.applied ?? [];
  const entries = renderManifest.materials
    .slice()
    .sort((left, right) => left.materialId.localeCompare(right.materialId))
    .map((material) => {
      const appliedMaterial = material.hostElementId && appliedMaterials
        ? appliedMaterials.some((entry) => entry.materialId === material.materialId && entry.object === material.hostElementId)
        : false;
      const appliedMaterialEntry = material.hostElementId
        ? appliedMaterials?.find((entry) => entry.materialId === material.materialId && entry.object === material.hostElementId)
        : undefined;
      const appliedTextureCount = material.textureMaps.filter((textureMap) =>
        appliedTextures.some((entry) => entry.path === textureMap.path && entry.type === textureMap.type)
      ).length;
      const matchedTextureColorSpaceCount = material.textureMaps.filter((textureMap) =>
        appliedTextures.some((entry) =>
          entry.path === textureMap.path
          && entry.type === textureMap.type
          && entry.colorSpace === textureMap.colorSpace
        )
      ).length;
      const appliedSurfaceMapping = appliedMaterialEntry?.surfaceMapping;
      const sourcePhotos = material.photoSources.slice().sort((left, right) => left.localeCompare(right));
      const sourcePhotoEvidence = sourcePhotos
        .map((sourcePhoto) => capture.photos.find((photo) => photo.path === sourcePhoto))
        .filter((photo): photo is ReturnType<typeof DigitalViewingCaptureSchema.parse>["photos"][number] => photo !== undefined)
        .map((photo) => ({
          path: photo.path,
          sector: photo.sector,
          role: photo.role,
          verified: photo.verified,
          materialCategories: sortedUniqueMaterialCategories(photo.captureMetadata?.materialCategories.length
            ? photo.captureMetadata.materialCategories
            : [material.category])
        }))
        .sort((left, right) => left.path.localeCompare(right.path));
      const materialRenderStatus = appliedMaterial
        ? "applied" as const
        : appliedMaterials
          ? "missing-host" as const
          : "missing-execution" as const;
      const textureColorSpaceStatus = material.textureMaps.length === 0
        ? "not-required" as const
        : appliedTextures.length === 0
          ? "missing-execution" as const
          : matchedTextureColorSpaceCount === material.textureMaps.length
            ? "matched" as const
            : "mismatched" as const;
	      const surfaceMappingExecutionStatus = !material.surfaceMapping
	        ? "not-required" as const
	        : !appliedMaterials
	          ? "missing-execution" as const
	          : surfaceMappingsMatch(appliedSurfaceMapping, material.surfaceMapping)
	            ? "matched" as const
	            : "mismatched" as const;
      const appearanceCalibrationExecutionStatus = !material.appearanceCalibration
        ? "not-required" as const
        : !appliedMaterials
          ? "missing-execution" as const
          : appliedMaterialEntry?.appearanceCalibration?.sourcePhoto === material.appearanceCalibration.sourcePhoto
            ? "matched" as const
            : "mismatched" as const;
      const sourcePhotoEvidenceStatus = sourcePhotos.length > 0 ? "ready" as const : "missing" as const;
      const materialFidelityIssues = buildMaterialFidelityIssues({
        materialRenderStatus,
        missingTextureMapCount: material.textureMaps.length - appliedTextureCount,
        textureColorSpaceStatus,
        surfaceMappingExecutionStatus,
        appearanceCalibrationExecutionStatus,
        sourcePhotoEvidenceStatus
	      });
	      const pbrReadback = normalizePbrReadback(appliedMaterialEntry?.pbrReadback);
	      const surfaceMappingReadback = normalizeSurfaceMappingReadback(appliedMaterialEntry?.surfaceMapping);
	      const appearanceCalibrationReadback = normalizeAppearanceCalibrationReadback(appliedMaterialEntry?.appearanceCalibration);
	      return {
        materialId: material.materialId,
        hostElementId: material.hostElementId,
        presetId: material.presetId,
        category: material.category,
        provenance: material.provenance,
        confidence: material.confidence,
        materialRenderStatus,
        textureMapCount: material.textureMaps.length,
        appliedTextureMapCount: appliedTextureCount,
        missingTextureMapCount: material.textureMaps.length - appliedTextureCount,
        textureColorSpaceStatus,
        surfaceMappingExecutionStatus,
	        appearanceCalibrationExecutionStatus,
	        surfaceMappingStatus: material.surfaceMapping ? "declared" as const : "missing" as const,
	        appearanceCalibrationStatus: material.appearanceCalibration ? "declared" as const : "missing" as const,
	        ...(surfaceMappingReadback ? { surfaceMappingReadback } : {}),
	        ...(appearanceCalibrationReadback ? { appearanceCalibrationReadback } : {}),
        sourcePhotoEvidenceCount: sourcePhotos.length,
        sourcePhotoEvidenceStatus,
        ...(pbrReadback ? { pbrReadback } : {}),
        materialFidelityStatus: materialFidelityIssues.length === 0 ? "ready" as const : "blocked" as const,
        materialFidelityIssues,
        sourcePhotos,
        sourcePhotoEvidence
      };
    });
  const textureMapCount = entries.reduce((sum, entry) => sum + entry.textureMapCount, 0);
  const appliedTextureMapCount = entries.reduce((sum, entry) => sum + entry.appliedTextureMapCount, 0);
  const textureColorSpaceMatchedCount = renderManifest.materials
    .flatMap((material) => material.textureMaps)
    .filter((textureMap) =>
      appliedTextures.some((entry) =>
        entry.path === textureMap.path
        && entry.type === textureMap.type
        && entry.colorSpace === textureMap.colorSpace
      )
    ).length;
  const appliedMaterialCount = entries.filter((entry) => entry.materialRenderStatus === "applied").length;
  const surfaceMappingCandidateCount = renderManifest.materials.filter((material) => material.surfaceMapping).length;
  const surfaceMappingMatchedCount = entries.filter((entry) => entry.surfaceMappingExecutionStatus === "matched").length;
  const appearanceCalibrationCandidateCount = renderManifest.materials.filter((material) => material.appearanceCalibration).length;
  const appearanceCalibrationMatchedCount = entries.filter((entry) => entry.appearanceCalibrationExecutionStatus === "matched").length;
  const materialFidelityReadyCount = entries.filter((entry) => entry.materialFidelityStatus === "ready").length;
  return {
    sourceOfTruth: "derived-from-material-authoring-report-and-blender-material-application",
    materialCount: entries.length,
    hostTargetedMaterialCount: renderManifest.materials.filter((material) => material.hostElementId).length,
    appliedMaterialCount,
    missingMaterialCount: entries.length - appliedMaterialCount,
    textureMapCount,
    appliedTextureMapCount,
    missingTextureMapCount: textureMapCount - appliedTextureMapCount,
    textureColorSpaceMatchedCount,
    textureColorSpaceMismatchCount: textureMapCount - textureColorSpaceMatchedCount,
    surfaceMappingMatchedCount,
    surfaceMappingMismatchCount: surfaceMappingCandidateCount - surfaceMappingMatchedCount,
    appearanceCalibrationMatchedCount,
    appearanceCalibrationMismatchCount: appearanceCalibrationCandidateCount - appearanceCalibrationMatchedCount,
    materialFidelityReadyCount,
    materialFidelityBlockedCount: entries.length - materialFidelityReadyCount,
    entries
  };
}

function buildMaterialFidelityIssues(status: {
  materialRenderStatus: DigitalViewingDeliveryPackageManifest["materialRenderCoverage"]["entries"][number]["materialRenderStatus"];
  missingTextureMapCount: number;
  textureColorSpaceStatus: DigitalViewingDeliveryPackageManifest["materialRenderCoverage"]["entries"][number]["textureColorSpaceStatus"];
  surfaceMappingExecutionStatus: DigitalViewingDeliveryPackageManifest["materialRenderCoverage"]["entries"][number]["surfaceMappingExecutionStatus"];
  appearanceCalibrationExecutionStatus: DigitalViewingDeliveryPackageManifest["materialRenderCoverage"]["entries"][number]["appearanceCalibrationExecutionStatus"];
  sourcePhotoEvidenceStatus: DigitalViewingDeliveryPackageManifest["materialRenderCoverage"]["entries"][number]["sourcePhotoEvidenceStatus"];
}): DigitalViewingDeliveryPackageManifest["materialRenderCoverage"]["entries"][number]["materialFidelityIssues"] {
  const issues: DigitalViewingDeliveryPackageManifest["materialRenderCoverage"]["entries"][number]["materialFidelityIssues"] = [];

  if (status.materialRenderStatus === "missing-host") {
    issues.push("material-missing-host");
  } else if (status.materialRenderStatus === "missing-execution") {
    issues.push("material-missing-execution");
  }
  if (status.missingTextureMapCount > 0) {
    issues.push("texture-maps-missing");
  }
  if (status.textureColorSpaceStatus === "mismatched") {
    issues.push("texture-color-space-mismatched");
  } else if (status.textureColorSpaceStatus === "missing-execution") {
    issues.push("texture-color-space-missing-execution");
  }
  if (status.surfaceMappingExecutionStatus === "mismatched") {
    issues.push("surface-mapping-mismatched");
  } else if (status.surfaceMappingExecutionStatus === "missing-execution") {
    issues.push("surface-mapping-missing-execution");
  }
  if (status.appearanceCalibrationExecutionStatus === "mismatched") {
    issues.push("appearance-calibration-mismatched");
  } else if (status.appearanceCalibrationExecutionStatus === "missing-execution") {
    issues.push("appearance-calibration-missing-execution");
  }
  if (status.sourcePhotoEvidenceStatus === "missing") {
    issues.push("source-photo-evidence-missing");
  }

  return issues;
}

function buildPbrMaterialCompletenessCoverage(
  renderManifest: ReturnType<typeof DigitalViewingRenderManifestSchema.parse>
): DigitalViewingDeliveryPackageManifest["pbrMaterialCompletenessCoverage"] {
  const entries = renderManifest.materials
    .slice()
    .sort((left, right) => left.materialId.localeCompare(right.materialId))
    .map((material) => {
      const requiredTextureTypes = requiredTextureTypesForMaterial(material.category, renderManifest.renderPreset.deliveryTier);
      const presentTextureTypes = uniqueSortedTextureTypes(material.textureMaps.map((textureMap) => textureMap.type));
      const missingTextureTypes = requiredTextureTypes.filter((type) => !presentTextureTypes.includes(type));
      const finishProfile = materialFinishProfileForMaterial(material, renderManifest.renderPreset.deliveryTier);
      const finishProfileIssues = finishProfile ? materialFinishProfileIssues(material, finishProfile) : [];
      const finishProfileStatus = !finishProfile
        ? "not-profiled" as const
        : finishProfileIssues.length === 0 ? "in-range" as const : "out-of-range" as const;
      const pbrFields = {
        baseColor: material.pbr.baseColor ? "declared" as const : "missing" as const,
        roughness: material.pbr.roughness === undefined ? "missing" as const : "declared" as const,
        metallic: material.pbr.metallic === undefined ? "missing" as const : "declared" as const,
        specular: material.pbr.specular === undefined ? "missing" as const : "declared" as const,
        transmission: material.pbr.transmission === undefined ? "missing" as const : "declared" as const,
        normalSource: material.pbr.normalSource === "unknown" ? "missing" as const : "declared" as const,
        textureScaleMm: material.pbr.textureScaleMm === undefined ? "missing" as const : "declared" as const
      };
      const pbrComplete = Object.values(pbrFields).every((status) => status === "declared");
      return {
        materialId: material.materialId,
        presetId: material.presetId,
        category: material.category,
        completenessStatus: pbrComplete && missingTextureTypes.length === 0 && finishProfileStatus !== "out-of-range" ? "complete" as const : "incomplete" as const,
        requiredTextureTypes,
        presentTextureTypes,
        missingTextureTypes,
        pbrFields,
        normalSource: material.pbr.normalSource,
        textureScaleMm: material.pbr.textureScaleMm,
        finishProfile,
        finishProfileStatus,
        finishProfileIssues,
        textureEvidence: material.textureMaps
          .slice()
          .sort((left, right) => `${left.type}:${left.path}`.localeCompare(`${right.type}:${right.path}`))
          .map((textureMap) => ({
            type: textureMap.type,
            path: textureMap.path,
            provenance: textureMap.provenance,
            confidence: textureMap.confidence,
            colorSpace: textureMap.colorSpace,
            scaleMm: textureMap.scaleMm,
            pixelWidth: textureMap.pixelWidth,
            pixelHeight: textureMap.pixelHeight,
            sourcePhoto: textureMap.sourcePhoto
          }))
      };
    });
  return {
    sourceOfTruth: "derived-from-render-manifest-pbr-fields-and-premium-texture-requirements",
    materialCount: entries.length,
    completeMaterialCount: entries.filter((entry) => entry.completenessStatus === "complete").length,
    incompleteMaterialCount: entries.filter((entry) => entry.completenessStatus === "incomplete").length,
    photoNormalSourceCount: entries.filter((entry) => entry.normalSource === "photo").length,
    textureScaleDeclaredCount: entries.filter((entry) => entry.textureScaleMm !== undefined).length,
    entries
  };
}

type MaterialFinishProfile = {
  profileId: string;
  roughness: { min: number; max: number };
  metallic: { min: number; max: number };
};

function materialFinishProfileForMaterial(
  material: ReturnType<typeof DigitalViewingRenderManifestSchema.parse>["materials"][number],
  deliveryTier: ReturnType<typeof DigitalViewingRenderManifestSchema.parse>["renderPreset"]["deliveryTier"]
): MaterialFinishProfile | undefined {
  if (deliveryTier !== "premium-sales") {
    return undefined;
  }
  if (material.presetId === "automotive-white-paint" || material.presetId === "automotive-metallic-paint") {
    return {
      profileId: "automotive-paint-finish",
      roughness: { min: 0.18, max: 0.65 },
      metallic: { min: 0, max: 0.2 }
    };
  }
  if (material.presetId === "marine-gelcoat") {
    return {
      profileId: "marine-gelcoat-finish",
      roughness: { min: 0.12, max: 0.55 },
      metallic: { min: 0, max: 0.05 }
    };
  }
  switch (material.category) {
    case "glass":
      return { profileId: "clear-glass-finish", roughness: { min: 0, max: 0.18 }, metallic: { min: 0, max: 0.05 } };
    case "metal":
      return { profileId: "metal-finish", roughness: { min: 0.05, max: 0.65 }, metallic: { min: 0.8, max: 1 } };
    case "rubber":
      return { profileId: "rubber-finish", roughness: { min: 0.55, max: 0.95 }, metallic: { min: 0, max: 0.05 } };
    case "leather":
      return { profileId: "leather-finish", roughness: { min: 0.35, max: 0.85 }, metallic: { min: 0, max: 0.05 } };
    case "stone":
      return { profileId: "stone-finish", roughness: { min: 0.45, max: 1 }, metallic: { min: 0, max: 0.05 } };
    case "wood":
      return { profileId: "wood-finish", roughness: { min: 0.25, max: 0.9 }, metallic: { min: 0, max: 0.05 } };
    case "plastic":
      return { profileId: "plastic-finish", roughness: { min: 0.25, max: 0.85 }, metallic: { min: 0, max: 0.05 } };
    default:
      return undefined;
  }
}

function materialFinishProfileIssues(
  material: ReturnType<typeof DigitalViewingRenderManifestSchema.parse>["materials"][number],
  profile: MaterialFinishProfile
): string[] {
  const issues: string[] = [];
  if (material.pbr.roughness === undefined) {
    issues.push(`roughness missing for ${profile.profileId}`);
  } else if (material.pbr.roughness < profile.roughness.min || material.pbr.roughness > profile.roughness.max) {
    issues.push(`roughness ${material.pbr.roughness} outside ${profile.profileId} range ${profile.roughness.min}-${profile.roughness.max}`);
  }
  if (material.pbr.metallic === undefined) {
    issues.push(`metallic missing for ${profile.profileId}`);
  } else if (material.pbr.metallic < profile.metallic.min || material.pbr.metallic > profile.metallic.max) {
    issues.push(`metallic ${material.pbr.metallic} outside ${profile.profileId} range ${profile.metallic.min}-${profile.metallic.max}`);
  }
  return issues;
}

function buildMaterialCalibrationCoverage(
  capture: ReturnType<typeof DigitalViewingCaptureSchema.parse>,
  renderManifest: ReturnType<typeof DigitalViewingRenderManifestSchema.parse>
): DigitalViewingDeliveryPackageManifest["materialCalibrationCoverage"] {
  const photosByPath = new Map(capture.photos.map((photo) => [photo.path, photo]));
  const entries = renderManifest.materials
    .filter((material) => material.provenance === "photo_observed")
    .slice()
    .sort((left, right) => left.materialId.localeCompare(right.materialId))
    .map((material) => {
      const sourcePhoto = material.appearanceCalibration?.sourcePhoto;
      const photo = sourcePhoto ? photosByPath.get(sourcePhoto) : undefined;
      const hasCalibrationPhotoMetadata = Boolean(
        photo?.captureMetadata?.lightingReference && photo.captureMetadata.colorReference
      );
      const calibrationStatus = !material.appearanceCalibration
        ? "missing" as const
        : sourcePhoto && (!photo?.verified || photo.captureMetadata?.occluded || !hasCalibrationPhotoMetadata)
          ? "invalid-source" as const
          : "ready" as const;
      return {
        materialId: material.materialId,
        presetId: material.presetId,
        category: material.category,
        provenance: material.provenance,
        calibrationStatus,
        method: material.appearanceCalibration?.method,
        sourcePhoto,
        photoRole: photo?.role,
        lightingReference: photo?.captureMetadata?.lightingReference,
        colorReference: photo?.captureMetadata?.colorReference,
        whiteBalanceKelvin: photo?.captureMetadata?.whiteBalanceKelvin,
        exposureEv: photo?.captureMetadata?.exposureEv,
        verified: photo?.verified ?? false
      };
    });

  return {
    sourceOfTruth: "derived-from-photo-observed-materials-and-verified-appearance-calibration",
    materialCount: renderManifest.materials.length,
    calibrationCandidateCount: entries.length,
    calibrationReadyCount: entries.filter((entry) => entry.calibrationStatus === "ready").length,
    calibrationBlockedCount: entries.filter((entry) => entry.calibrationStatus !== "ready").length,
    entries
  };
}

function requiredTextureTypesForMaterial(
  category: ReturnType<typeof DigitalViewingRenderManifestSchema.parse>["materials"][number]["category"],
  deliveryTier: ReturnType<typeof DigitalViewingRenderManifestSchema.parse>["renderPreset"]["deliveryTier"]
): DigitalViewingDeliveryPackageManifest["pbrMaterialCompletenessCoverage"]["entries"][number]["requiredTextureTypes"] {
  if (deliveryTier !== "premium-sales") {
    return [];
  }
  switch (category) {
    case "glass":
      return ["alpha", "roughness"];
    case "metal":
      return ["metallic", "normal", "roughness"];
    case "paint":
    case "gelcoat":
      return ["baseColor", "normal", "roughness"];
    case "wood":
    case "fabric":
    case "leather":
    case "stone":
    case "plastic":
    case "rubber":
    case "composite":
      return ["normal", "roughness"];
    case "unknown":
      return ["baseColor"];
  }
}

function uniqueSortedTextureTypes(
  values: DigitalViewingDeliveryPackageManifest["pbrMaterialCompletenessCoverage"]["entries"][number]["presentTextureTypes"]
): DigitalViewingDeliveryPackageManifest["pbrMaterialCompletenessCoverage"]["entries"][number]["presentTextureTypes"] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function buildPhotoEvidenceCoverage(
  capture: ReturnType<typeof DigitalViewingCaptureSchema.parse>,
  renderManifest: ReturnType<typeof DigitalViewingRenderManifestSchema.parse>
): DigitalViewingDeliveryPackageManifest["photoEvidenceCoverage"] {
  const photosByPath = new Map(capture.photos.map((photo) => [photo.path, photo]));
  const entries: DigitalViewingDeliveryPackageManifest["photoEvidenceCoverage"]["entries"] = [];

  const addEntry = (
    usage: DigitalViewingDeliveryPackageManifest["photoEvidenceCoverage"]["entries"][number]["usage"],
    targetId: string,
    path: string | undefined
  ) => {
    if (!path) {
      return;
    }
    const photo = photosByPath.get(path);
    entries.push({
      usage,
      targetId,
      path,
      sector: photo?.sector,
      role: photo?.role,
      verified: photo?.verified ?? false
    });
  };

  addEntry("camera-reference", renderManifest.renderPreset.camera.sector, renderManifest.renderPreset.camera.referencePhoto);
  addEntry("lighting-reference", renderManifest.renderPreset.lighting.environment, renderManifest.renderPreset.lighting.referencePhoto);

  for (const material of renderManifest.materials) {
    for (const photoSource of material.photoSources) {
      addEntry("material-source", material.materialId, photoSource);
    }
    addEntry("surface-mapping", material.materialId, material.surfaceMapping?.sourcePhoto);
    addEntry("appearance-calibration", material.materialId, material.appearanceCalibration?.sourcePhoto);
    for (const textureMap of material.textureMaps) {
      addEntry("texture-source", `${material.materialId}:${textureMap.type}`, textureMap.sourcePhoto);
    }
  }
  for (const condition of renderManifest.conditions) {
    for (const photoSource of condition.photoSources) {
      addEntry("condition-evidence", condition.id, photoSource);
    }
  }
  for (const inspection of renderManifest.conditionInspections) {
    for (const sourcePhoto of inspection.sourcePhotos) {
      addEntry("inspection-source", inspection.zone, sourcePhoto);
    }
  }

  const sortedEntries = entries.sort((left, right) =>
    `${left.usage}:${left.targetId}:${left.path}`.localeCompare(`${right.usage}:${right.targetId}:${right.path}`)
  );

  return {
    sourceOfTruth: "derived-from-capture-photos-render-preset-materials-textures-and-conditions",
    verifiedPhotoCount: capture.photos.filter((photo) => photo.verified).length,
    evidenceCount: sortedEntries.length,
    missingEvidenceCount: sortedEntries.filter((entry) => !entry.verified).length,
    entries: sortedEntries
  };
}

function parseRequestedDeliveryTargets(input: unknown, customerSurface: DigitalViewingCustomerSurface): DigitalViewingOutputTarget[] {
  const parsed = input === undefined
    ? getDigitalViewingDeliveryProfile(customerSurface).requiredTargets ?? DefaultPackageTargets
    : DigitalViewingOutputTargetSchema.array().min(1).parse(input);
  return [...new Set(parsed)].sort((left, right) => TargetSortOrder.indexOf(left) - TargetSortOrder.indexOf(right));
}

function parseDeliveryArtifacts(input: unknown, requestedTargets: DigitalViewingOutputTarget[]): Map<DigitalViewingOutputTarget, DigitalViewingDeliveryArtifact> {
  const artifacts = input === undefined ? [] : DigitalViewingDeliveryArtifactSchema.array().parse(input);
  const duplicateArtifactTargets = artifacts
    .map((artifact) => artifact.target)
    .filter((target, index, targets) => targets.indexOf(target) !== index);
  if (duplicateArtifactTargets.length > 0) {
    throw new Error(`deliveryArtifacts target ids must be unique: ${Array.from(new Set(duplicateArtifactTargets)).sort((left, right) => left.localeCompare(right)).join(", ")}`);
  }
  const requestedTargetIds = new Set(requestedTargets);
  const unrequestedArtifactTargets = artifacts
    .map((artifact) => artifact.target)
    .filter((target) => !requestedTargetIds.has(target));
  if (unrequestedArtifactTargets.length > 0) {
    throw new Error(`deliveryArtifacts target ids must be requested deliveryTargets: ${sortTargets(Array.from(new Set(unrequestedArtifactTargets))).join(", ")}`);
  }
  const sortedArtifacts = artifacts.slice().sort((left, right) => {
    const targetDelta = TargetSortOrder.indexOf(left.target) - TargetSortOrder.indexOf(right.target);
    return targetDelta === 0 ? left.path.localeCompare(right.path) : targetDelta;
  });
  return new Map(sortedArtifacts.map((artifact) => [artifact.target, artifact]));
}

function sortTargets(targets: DigitalViewingOutputTarget[]): DigitalViewingOutputTarget[] {
  return targets.slice().sort((left, right) => TargetSortOrder.indexOf(left) - TargetSortOrder.indexOf(right));
}

function buildDeliveryTargets(
  requestedTargets: DigitalViewingOutputTarget[],
  renderManifest: ReturnType<typeof DigitalViewingRenderManifestSchema.parse>,
  materialConditionReportHash: string | undefined,
  deliveryArtifacts: Map<DigitalViewingOutputTarget, DigitalViewingDeliveryArtifact>
): DigitalViewingDeliveryPackageTarget[] {
  return requestedTargets.map((target) => {
    if (target === "photoreal-render") {
      const deliveryArtifact = deliveryArtifacts.get(target);
      return {
        target,
        required: true,
        status: "ready",
        artifactType: "render",
        path: deliveryArtifact?.path ?? renderManifest.artifacts.render,
        hash: deliveryArtifact?.hash,
        message: deliveryArtifact
          ? "Photoreal render is indexed from caller-provided artifact metadata and checked against Blender execution."
          : "Photoreal render is indexed from the locked Blender render manifest."
      };
    }
    if (target === "material-condition-report") {
      const deliveryArtifact = deliveryArtifacts.get(target);
      return {
        target,
        required: true,
        status: "ready",
        artifactType: "material-condition-report",
        path: deliveryArtifact?.path,
        hash: deliveryArtifact ? deliveryArtifact.hash : materialConditionReportHash,
        message: deliveryArtifact
          ? "Material and condition report is indexed from caller-provided artifact metadata."
          : "Material and condition report is indexed from verified capture evidence."
      };
    }
    const deliveryArtifact = deliveryArtifacts.get(target);
    if (deliveryArtifact) {
      return {
        target,
        required: true,
        status: "ready",
        artifactType: target,
        path: deliveryArtifact.path,
        hash: deliveryArtifact.hash,
        message: `Requested delivery target '${target}' is indexed from caller-provided artifact metadata.`
      };
    }
    return {
      target,
      required: true,
      status: "missing",
      artifactType: target,
      message: `Requested delivery target '${target}' is not present in this package manifest.`
    };
  });
}

function photorealDeliveryArtifactMatchesRenderArtifact(
  deliveryArtifact: DigitalViewingDeliveryArtifact,
  renderArtifact: DigitalViewingDeliveryPackageManifest["renderExecutionCoverage"]["renderArtifact"]
): boolean {
  return renderArtifact.status === "matched"
    && renderArtifact.executedPath === deliveryArtifact.path
    && renderArtifact.sha256 === deliveryArtifact.hash;
}

function buildPhotorealQualityChecklist(
  capture: ReturnType<typeof DigitalViewingCaptureSchema.parse>,
  renderManifest: ReturnType<typeof DigitalViewingRenderManifestSchema.parse>,
  report: ReturnType<typeof buildDigitalViewingMaterialConditionReport>,
  assetBundleManifest: DigitalViewingAssetBundleManifest | undefined,
  assetBundleManifestPath: string | undefined
): DigitalViewingDeliveryPackageManifest["photorealQualityChecklist"] {
  const materialCount = renderManifest.materials.filter((material) => material.hostElementId).length;
  const textureCount = renderManifest.materials.flatMap((material) => material.textureMaps).length;
  const conditionCount = report.conditionVisibilityChecklist.filter((condition) => condition.mustBeVisible).length;
  const renderManifestHash = renderManifest.hashes.manifestHash;
  const materialConditionReportHash = report.hashes.reportHash;
  if (!renderManifestHash) {
    throw new Error("Photoreal quality checklist requires a hashed render manifest.");
  }
  if (!materialConditionReportHash) {
    throw new Error("Photoreal quality checklist requires a hashed material-condition report.");
  }
  const baseTrace = {
    captureHash: renderManifest.hashes.captureHash,
    renderManifestHash
  };
  const assetBundleTrace = assetBundleManifest?.hashes.assetBundleHash ? { assetBundleHash: assetBundleManifest.hashes.assetBundleHash } : {};
  const materialConditionTrace = { materialConditionReportHash };
  return [
    {
      check: "asset-bundle",
      status: assetBundleManifest?.qualityGates.ready ? "passed" as const : "failed" as const,
      evidence: assetBundleManifestPath ?? assetBundleManifest?.hashes.assetBundleHash ?? "asset bundle missing",
      trace: { ...baseTrace, ...assetBundleTrace, ...materialConditionTrace }
    },
    {
      check: "render-output",
      status: hasMismatchedRenderArtifact(renderManifest) ? "failed" as const : "passed" as const,
      evidence: `${renderManifest.artifacts.render} render artifact identity matched Blender output`,
      trace: { ...baseTrace }
    },
    {
      check: "measurements",
      status: renderManifest.blenderExecution?.measurementApplication
        && !hasIncompleteMeasurementApplication(capture, renderManifest.blenderExecution.measurementApplication.applied)
        && !hasMissingMeasurementValueReadback(capture, renderManifest.blenderExecution.measurementApplication.applied)
        ? "passed" as const
        : "failed" as const,
      evidence: `${capture.measurements.filter((measurement) => measurement.verified && measurement.affectsGeometry).length} geometry measurements preserved as Blender anchors with declared values`,
      trace: { ...baseTrace, ...materialConditionTrace }
    },
    {
      check: "materials",
      status: hasIncompleteMaterialApplication(renderManifest) || hasMismatchedMaterialPbrApplication(renderManifest) || hasMissingMaterialPbrReadbackProof(renderManifest) || hasMissingMaterialSourcePhotoIdentity(renderManifest, assetBundleManifest) || hasIncompleteMaterialCalibration(renderManifest) || hasIncompleteMaterialSurfaceMapping(renderManifest) ? "failed" as const : "passed" as const,
      evidence: `${materialCount} host-targeted materials applied with calibrated appearance, surface mapping, and source photo file identity`,
      trace: { ...baseTrace, ...materialConditionTrace }
    },
    {
      check: "textures",
      status: hasIncompleteTextureApplication(report) || hasIncompleteTextureScaleApplication(renderManifest) || hasIncompleteTextureColorSpaceApplication(renderManifest) || hasIncompleteTextureFileIdentityApplication(renderManifest, assetBundleManifest) ? "failed" as const : "passed" as const,
      evidence: `${textureCount} declared texture maps applied with physical scale, matched color space, and file identity`,
      trace: { ...baseTrace, ...assetBundleTrace, ...materialConditionTrace }
    },
    {
      check: "conditions",
      status: hasIncompleteConditionApplication(report)
        || hasIncompleteConditionVisibility(report)
        || hasMismatchedConditionPlacement(renderManifest)
        || hasMissingConditionOverlayVisibilityProof(renderManifest, report)
        || hasMissingConditionOverlayMaterialReadback(renderManifest, report)
        || hasMissingConditionSourcePhotoIdentity(renderManifest, assetBundleManifest)
        ? "failed" as const
        : "passed" as const,
      evidence: `${conditionCount} buyer-visible condition items rendered`,
      trace: { ...baseTrace, ...assetBundleTrace, ...materialConditionTrace }
    },
    {
      check: "camera",
      status: hasMismatchedCameraExecution(capture, renderManifest) || hasMissingCameraReferencePhotoIdentity(renderManifest, assetBundleManifest) || !renderManifest.renderPreset.camera.referencePhoto ? "failed" as const : "passed" as const,
      evidence: `${renderManifest.renderPreset.camera.sector} ${renderManifest.renderPreset.camera.mode} camera matched ${renderManifest.renderPreset.camera.referencePhoto ?? "missing reference photo"} with file identity`,
      trace: { ...baseTrace, ...assetBundleTrace }
    },
    {
      check: "lighting",
      status: hasIncompleteLightingReference(renderManifest) || hasMissingLightingReferencePhotoIdentity(renderManifest, assetBundleManifest) || hasMismatchedLightingReferenceMetadata(renderManifest) ? "failed" as const : "passed" as const,
      evidence: `${renderManifest.renderPreset.lighting.environment} lighting matched ${renderManifest.renderPreset.lighting.referencePhoto ?? "declared lighting preset"} with file identity`,
      trace: { ...baseTrace, ...assetBundleTrace }
    }
  ];
}

function hasIncompleteTextureApplication(report: ReturnType<typeof buildDigitalViewingMaterialConditionReport>): boolean {
  return report.materials.some((material) => material.textureMaps.some((textureMap) => textureMap.renderStatus !== "applied"));
}

function hasMismatchedRenderArtifact(renderManifest: ReturnType<typeof DigitalViewingRenderManifestSchema.parse>): boolean {
  const blenderExecution = renderManifest.blenderExecution as {
    renderArtifact?: {
      path?: string;
      sizeBytes?: number;
      sha256?: string;
      width?: number;
      height?: number;
    };
  } | undefined;
  const renderArtifact = blenderExecution?.renderArtifact;
  return renderArtifact?.path !== renderManifest.artifacts.render
    || renderArtifact.sizeBytes === undefined
    || renderArtifact.sha256 === undefined
    || renderArtifact.width !== renderManifest.renderPreset.resolution.width
    || renderArtifact.height !== renderManifest.renderPreset.resolution.height;
}

function hasIncompleteConditionApplication(report: ReturnType<typeof buildDigitalViewingMaterialConditionReport>): boolean {
  return report.conditions.some((condition) => condition.verification === "verified" && condition.renderStatus !== "overlay-applied");
}

function hasIncompleteConditionVisibility(report: ReturnType<typeof buildDigitalViewingMaterialConditionReport>): boolean {
  return report.conditionVisibilityChecklist.some((condition) => condition.mustBeVisible && condition.renderStatus !== "overlay-applied");
}

function hasMismatchedConditionPlacement(renderManifest: ReturnType<typeof DigitalViewingRenderManifestSchema.parse>): boolean {
  const blenderExecution = renderManifest.blenderExecution as {
    conditionApplication?: {
      applied?: BlenderConditionExecution[];
    };
  } | undefined;
  const applied = blenderExecution?.conditionApplication?.applied ?? [];
  return renderManifest.conditions
    .filter((condition) => condition.verification === "verified" && condition.surfacePlacement)
    .some((condition) => {
      const appliedCondition = applied.find((entry) => entry.conditionId === condition.id);
      const expectedPlacement = condition.surfacePlacement;
      const appliedPlacement = appliedCondition?.surfacePlacement;
      return appliedCondition?.hostElementId !== expectedPlacement?.hostElementId
        || appliedCondition?.face !== expectedPlacement?.face
        || appliedPlacement?.hostElementId !== expectedPlacement?.hostElementId
        || appliedPlacement?.face !== expectedPlacement?.face
        || appliedPlacement?.u !== expectedPlacement?.u
        || appliedPlacement?.v !== expectedPlacement?.v
        || appliedPlacement?.widthMm !== expectedPlacement?.widthMm
        || appliedPlacement?.heightMm !== expectedPlacement?.heightMm
        || appliedPlacement?.rotationDeg !== expectedPlacement?.rotationDeg;
    });
}

function hasMissingConditionOverlayVisibilityProof(
  renderManifest: ReturnType<typeof DigitalViewingRenderManifestSchema.parse>,
  report: ReturnType<typeof buildDigitalViewingMaterialConditionReport>
): boolean {
  const blenderExecution = renderManifest.blenderExecution as {
    conditionApplication?: {
      applied?: BlenderConditionExecution[];
    };
  } | undefined;
  const applied = blenderExecution?.conditionApplication?.applied ?? [];
  return report.conditionVisibilityChecklist
    .filter((condition) => condition.mustBeVisible)
    .some((condition) => {
      const appliedCondition = applied.find((entry) => entry.conditionId === condition.conditionId);
      if (!appliedCondition) {
        return false;
      }
      return compareConditionVisibilityProof(condition, appliedCondition.visibilityProof) !== "matched";
    });
}

function hasMissingConditionOverlayMaterialReadback(
  renderManifest: ReturnType<typeof DigitalViewingRenderManifestSchema.parse>,
  report: ReturnType<typeof buildDigitalViewingMaterialConditionReport>
): boolean {
  const blenderExecution = renderManifest.blenderExecution as {
    conditionApplication?: {
      applied?: BlenderConditionExecution[];
    };
  } | undefined;
  const applied = blenderExecution?.conditionApplication?.applied ?? [];
  return report.conditionVisibilityChecklist
    .filter((condition) => condition.mustBeVisible)
    .some((condition) => {
      const appliedCondition = applied.find((entry) => entry.conditionId === condition.conditionId);
      if (!appliedCondition?.visibilityProof) {
        return false;
      }
      return !isMatchedConditionOverlayMaterialReadback(condition, appliedCondition.visibilityProof);
    });
}

function hasMissingConditionSourcePhotoIdentity(
  renderManifest: ReturnType<typeof DigitalViewingRenderManifestSchema.parse>,
  assetBundleManifest: DigitalViewingAssetBundleManifest | undefined
): boolean {
  if (!assetBundleManifest) {
    return false;
  }
  const blenderExecution = renderManifest.blenderExecution as {
    conditionApplication?: {
      applied?: BlenderConditionExecution[];
    };
  } | undefined;
  const applied = blenderExecution?.conditionApplication?.applied ?? [];
  const photoAssetByPath = new Map(
    assetBundleManifest.assets
      .filter((asset) => asset.assetType === "photo" && asset.required && asset.status === "present")
      .map((asset) => [asset.path, asset])
  );
  return renderManifest.conditions
    .filter((condition) => condition.verification === "verified" && condition.photoSources.length > 0)
    .some((condition) => {
      const appliedCondition = applied.find((entry) => entry.conditionId === condition.id);
      return condition.photoSources.some((photoPath) => {
        const expectedAsset = photoAssetByPath.get(photoPath);
        if (!expectedAsset) {
          return false;
        }
        const appliedPhoto = appliedCondition?.sourcePhotoIdentities?.find((entry) =>
          entry.path === photoPath && entry.usage === "condition-source"
        );
        return expectedAsset.sizeBytes === undefined
          || expectedAsset.sha256 === undefined
          || appliedPhoto?.sizeBytes !== expectedAsset.sizeBytes
          || appliedPhoto?.sha256 !== expectedAsset.sha256;
      });
    });
}

function hasIncompleteTextureScaleApplication(renderManifest: ReturnType<typeof DigitalViewingRenderManifestSchema.parse>): boolean {
  const blenderExecution = renderManifest.blenderExecution as {
    materialApplication?: {
      textures?: {
        applied?: Array<{ path: string; type: string; scaleMm?: number }>;
      };
    };
  } | undefined;
  const applied = blenderExecution?.materialApplication?.textures?.applied ?? [];
  return renderManifest.materials
    .flatMap((material) => material.textureMaps)
    .filter((textureMap) => textureMap.scaleMm !== undefined)
    .some((textureMap) => {
      const appliedTexture = applied.find((entry) => entry.path === textureMap.path && entry.type === textureMap.type);
      return appliedTexture?.scaleMm !== textureMap.scaleMm;
    });
}

function hasIncompleteTextureColorSpaceApplication(renderManifest: ReturnType<typeof DigitalViewingRenderManifestSchema.parse>): boolean {
  const blenderExecution = renderManifest.blenderExecution as {
    materialApplication?: {
      textures?: {
        applied?: Array<{ path: string; type: string; colorSpace?: string }>;
      };
    };
  } | undefined;
  const applied = blenderExecution?.materialApplication?.textures?.applied ?? [];
  return renderManifest.materials
    .flatMap((material) => material.textureMaps)
    .some((textureMap) => {
      const appliedTexture = applied.find((entry) => entry.path === textureMap.path && entry.type === textureMap.type);
      return appliedTexture?.colorSpace !== textureMap.colorSpace;
    });
}

function hasIncompleteTextureFileIdentityApplication(
  renderManifest: ReturnType<typeof DigitalViewingRenderManifestSchema.parse>,
  assetBundleManifest: DigitalViewingAssetBundleManifest | undefined
): boolean {
  if (!assetBundleManifest) {
    return false;
  }
  const blenderExecution = renderManifest.blenderExecution as {
    materialApplication?: {
      textures?: {
        applied?: Array<{ path: string; type: string; sizeBytes?: number; sha256?: string }>;
      };
    };
  } | undefined;
  const applied = blenderExecution?.materialApplication?.textures?.applied ?? [];
  const textureAssetByPath = new Map(
    assetBundleManifest.assets
      .filter((asset) => asset.assetType === "texture" && asset.required && asset.status === "present")
      .map((asset) => [asset.path, asset])
  );
  return renderManifest.materials
    .flatMap((material) => material.textureMaps)
    .some((textureMap) => {
      const expectedAsset = textureAssetByPath.get(textureMap.path);
      if (!expectedAsset) {
        return false;
      }
      const appliedTexture = applied.find((entry) => entry.path === textureMap.path && entry.type === textureMap.type);
      return expectedAsset.sizeBytes === undefined
        || expectedAsset.sha256 === undefined
        || appliedTexture?.sizeBytes !== expectedAsset.sizeBytes
        || appliedTexture?.sha256 !== expectedAsset.sha256;
    });
}

function hasIncompleteMeasurementApplication(
  capture: ReturnType<typeof DigitalViewingCaptureSchema.parse>,
  applied: Array<{ measurementId: string }>
): boolean {
  const appliedIds = new Set(applied.map((measurement) => measurement.measurementId));
  return capture.measurements
    .filter((measurement) => measurement.verified && measurement.affectsGeometry)
    .some((measurement) => !appliedIds.has(measurement.id));
}

function hasMissingMeasurementValueReadback(
  capture: ReturnType<typeof DigitalViewingCaptureSchema.parse>,
  applied: BlenderMeasurementExecution[]
): boolean {
  const appliedById = new Map(applied.map((measurement) => [measurement.measurementId, measurement]));
  return capture.measurements
    .filter((measurement) => measurement.verified && measurement.affectsGeometry)
    .some((measurement) => {
      const appliedMeasurement = appliedById.get(measurement.id);
      if (!appliedMeasurement) {
        return true;
      }
      return appliedMeasurement.sourceOfTruth !== "declared-measurement-value-used-by-blender"
        || appliedMeasurement.value !== measurement.value
        || appliedMeasurement.unit !== measurement.unit
        || appliedMeasurement.tolerance !== measurement.tolerance;
    });
}

function hasIncompleteLightingReference(renderManifest: ReturnType<typeof DigitalViewingRenderManifestSchema.parse>): boolean {
  if (renderManifest.renderPreset.lighting.environment !== "site-reference") {
    return false;
  }
  const expectedReferencePhoto = renderManifest.renderPreset.lighting.referencePhoto;
  const blenderExecution = renderManifest.blenderExecution as {
    lighting?: {
      environment?: string;
      referencePhoto?: string;
    };
  } | undefined;
  return blenderExecution?.lighting?.environment !== "site-reference"
    || blenderExecution.lighting.referencePhoto !== expectedReferencePhoto;
}

function hasMismatchedLightingReferenceMetadata(renderManifest: ReturnType<typeof DigitalViewingRenderManifestSchema.parse>): boolean {
  if (renderManifest.renderPreset.lighting.environment !== "site-reference") {
    return false;
  }
  const expected = renderManifest.lightingReference;
  if (!expected) {
    return false;
  }
  const blenderExecution = renderManifest.blenderExecution as {
    lighting?: BlenderLightingExecution;
  } | undefined;
  return !lightingReferenceMetadataMatches(expected, blenderExecution?.lighting);
}

function hasMissingLightingReferencePhotoIdentity(
  renderManifest: ReturnType<typeof DigitalViewingRenderManifestSchema.parse>,
  assetBundleManifest: DigitalViewingAssetBundleManifest | undefined
): boolean {
  if (!assetBundleManifest || renderManifest.renderPreset.lighting.environment !== "site-reference") {
    return false;
  }
  const referencePhoto = renderManifest.renderPreset.lighting.referencePhoto;
  if (!referencePhoto) {
    return false;
  }
  const expectedAsset = assetBundleManifest.assets.find((asset) =>
    asset.assetType === "photo"
      && asset.required
      && asset.status === "present"
      && asset.path === referencePhoto
  );
  if (!expectedAsset) {
    return false;
  }
  const blenderExecution = renderManifest.blenderExecution as {
    lighting?: BlenderLightingExecution;
  } | undefined;
  const actual = blenderExecution?.lighting?.referencePhotoIdentity;
  return expectedAsset.sizeBytes === undefined
    || expectedAsset.sha256 === undefined
    || actual?.path !== referencePhoto
    || actual?.sizeBytes !== expectedAsset.sizeBytes
    || actual?.sha256 !== expectedAsset.sha256;
}

function lightingReferenceMetadataMatches(
  expected: ReturnType<typeof DigitalViewingRenderManifestSchema.parse>["lightingReference"],
  actual: BlenderLightingExecution | undefined
): boolean {
  if (!expected) {
    return true;
  }
  return actual?.lightingReference === expected.lightingReference
    && actual.colorReference === expected.colorReference
    && actual.whiteBalanceKelvin === expected.whiteBalanceKelvin
    && actual.exposureEv === expected.exposureEv;
}

function hasMismatchedCameraExecution(
  capture: ReturnType<typeof DigitalViewingCaptureSchema.parse>,
  renderManifest: ReturnType<typeof DigitalViewingRenderManifestSchema.parse>
): boolean {
  const expectedCamera = renderManifest.renderPreset.camera;
  const blenderExecution = renderManifest.blenderExecution as {
    camera?: BlenderCameraExecution;
  } | undefined;
  const executedCamera = blenderExecution?.camera;
  if (executedCamera?.sector !== expectedCamera.sector
    || executedCamera.mode !== expectedCamera.mode
    || executedCamera.referencePhoto !== expectedCamera.referencePhoto) {
    return true;
  }
  const referencePhoto = capture.photos.find((photo) => photo.path === expectedCamera.referencePhoto && photo.verified);
  const expectedYaw = referencePhoto?.captureMetadata?.yawDeg;
  if (typeof executedCamera.executedYawDeg === "number" && typeof expectedYaw === "number") {
    if (angularDifference(executedCamera.executedYawDeg, expectedYaw) > 0.5) {
      return true;
    }
  }
  const expectedPitch = referencePhoto?.captureMetadata?.pitchDeg;
  if (typeof executedCamera.executedPitchDeg === "number" && typeof expectedPitch === "number") {
    return Math.abs(executedCamera.executedPitchDeg - expectedPitch) > 0.5;
  }
  return false;
}

function hasMissingCameraAngleReadback(
  capture: ReturnType<typeof DigitalViewingCaptureSchema.parse>,
  renderManifest: ReturnType<typeof DigitalViewingRenderManifestSchema.parse>
): boolean {
  const expectedCamera = renderManifest.renderPreset.camera;
  const referencePhoto = capture.photos.find((photo) => photo.path === expectedCamera.referencePhoto && photo.verified);
  const blenderExecution = renderManifest.blenderExecution as {
    camera?: {
      executedYawDeg?: number;
      executedPitchDeg?: number;
    };
  } | undefined;
  const executedCamera = blenderExecution?.camera;
  const expectedYaw = referencePhoto?.captureMetadata?.yawDeg;
  const expectedPitch = referencePhoto?.captureMetadata?.pitchDeg;
  return (typeof expectedYaw === "number" && typeof executedCamera?.executedYawDeg !== "number")
    || (typeof expectedPitch === "number" && typeof executedCamera?.executedPitchDeg !== "number");
}

function hasMissingCameraReferencePhotoIdentity(
  renderManifest: ReturnType<typeof DigitalViewingRenderManifestSchema.parse>,
  assetBundleManifest: DigitalViewingAssetBundleManifest | undefined
): boolean {
  if (!assetBundleManifest) {
    return false;
  }
  const referencePhoto = renderManifest.renderPreset.camera.referencePhoto;
  if (!referencePhoto) {
    return false;
  }
  const expectedAsset = assetBundleManifest.assets.find((asset) =>
    asset.assetType === "photo"
      && asset.required
      && asset.status === "present"
      && asset.path === referencePhoto
  );
  if (!expectedAsset) {
    return false;
  }
  const blenderExecution = renderManifest.blenderExecution as {
    camera?: BlenderCameraExecution;
  } | undefined;
  const actual = blenderExecution?.camera?.referencePhotoIdentity;
  return expectedAsset.sizeBytes === undefined
    || expectedAsset.sha256 === undefined
    || actual?.path !== referencePhoto
    || actual?.sizeBytes !== expectedAsset.sizeBytes
    || actual?.sha256 !== expectedAsset.sha256;
}

function hasIncompleteMaterialApplication(renderManifest: ReturnType<typeof DigitalViewingRenderManifestSchema.parse>): boolean {
  const blenderExecution = renderManifest.blenderExecution as {
    materialApplication?: {
      applied?: Array<{ materialId: string; object: string; appearanceCalibration?: { sourcePhoto?: string } }>;
    };
  } | undefined;
  const appliedPairs = new Set(
    blenderExecution?.materialApplication?.applied?.map((material) => `${material.materialId}:${material.object}`) ?? []
  );
  return renderManifest.materials
    .filter((material) => material.hostElementId)
    .some((material) => !appliedPairs.has(`${material.materialId}:${material.hostElementId}`));
}

function hasMismatchedMaterialPbrApplication(renderManifest: ReturnType<typeof DigitalViewingRenderManifestSchema.parse>): boolean {
  const blenderExecution = renderManifest.blenderExecution as {
    materialApplication?: {
      applied?: BlenderMaterialExecution[];
    };
  } | undefined;
  const applied = blenderExecution?.materialApplication?.applied ?? [];
  return renderManifest.materials
    .filter((material) => material.hostElementId)
    .some((material) => {
      const appliedMaterial = applied.find((entry) => entry.materialId === material.materialId && entry.object === material.hostElementId);
      if (!appliedMaterial) {
        return false;
      }
      return !materialPbrMatches(material.pbr, appliedMaterial.pbrReadback?.values);
    });
}

function hasMissingMaterialPbrReadbackProof(renderManifest: ReturnType<typeof DigitalViewingRenderManifestSchema.parse>): boolean {
  const blenderExecution = renderManifest.blenderExecution as {
    materialApplication?: {
      applied?: BlenderMaterialExecution[];
    };
  } | undefined;
  const applied = blenderExecution?.materialApplication?.applied ?? [];
  return renderManifest.materials
    .filter((material) => material.hostElementId)
    .some((material) => {
      const appliedMaterial = applied.find((entry) => entry.materialId === material.materialId && entry.object === material.hostElementId);
      if (!appliedMaterial) {
        return false;
      }
      return appliedMaterial.pbrReadback?.sourceOfTruth !== "read-from-blender-material-node-values-after-application"
        || !appliedMaterial.pbrReadback.values;
    });
}

function hasMissingMaterialSourcePhotoIdentity(
  renderManifest: ReturnType<typeof DigitalViewingRenderManifestSchema.parse>,
  assetBundleManifest: DigitalViewingAssetBundleManifest | undefined
): boolean {
  if (!assetBundleManifest) {
    return false;
  }
  const blenderExecution = renderManifest.blenderExecution as {
    materialApplication?: {
      applied?: BlenderMaterialExecution[];
    };
  } | undefined;
  const applied = blenderExecution?.materialApplication?.applied ?? [];
  const photoAssetByPath = new Map(
    assetBundleManifest.assets
      .filter((asset) => asset.assetType === "photo" && asset.required && asset.status === "present")
      .map((asset) => [asset.path, asset])
  );
  return renderManifest.materials
    .filter((material) => material.hostElementId)
    .some((material) => {
      const appliedMaterial = applied.find((entry) => entry.materialId === material.materialId && entry.object === material.hostElementId);
      return expectedMaterialSourcePhotoIdentities(material).some((expected) => {
        const expectedAsset = photoAssetByPath.get(expected.path);
        if (!expectedAsset) {
          return false;
        }
        const actual = appliedMaterial?.sourcePhotoIdentities?.find((identity) =>
          identity.path === expected.path && identity.usage === expected.usage
        );
        return expectedAsset.sizeBytes === undefined
          || expectedAsset.sha256 === undefined
          || actual?.sizeBytes !== expectedAsset.sizeBytes
          || actual?.sha256 !== expectedAsset.sha256;
      });
    });
}

function expectedMaterialSourcePhotoIdentities(
  material: ReturnType<typeof DigitalViewingRenderManifestSchema.parse>["materials"][number]
): Array<{ usage: "material-source" | "surface-mapping" | "appearance-calibration"; path: string }> {
  return [
    ...material.photoSources.map((path) => ({ usage: "material-source" as const, path })),
    ...(material.surfaceMapping?.sourcePhoto ? [{ usage: "surface-mapping" as const, path: material.surfaceMapping.sourcePhoto }] : []),
    ...(material.appearanceCalibration?.sourcePhoto ? [{ usage: "appearance-calibration" as const, path: material.appearanceCalibration.sourcePhoto }] : [])
  ];
}

function materialPbrMatches(expected: RenderMaterialPbr, actual: Partial<RenderMaterialPbr> | undefined): boolean {
  if (!actual) {
    return false;
  }
  return actual.baseColor === expected.baseColor
    && numberFieldMatches(actual.roughness, expected.roughness)
    && numberFieldMatches(actual.metallic, expected.metallic)
    && numberFieldMatches(actual.specular, expected.specular)
    && numberFieldMatches(actual.transmission, expected.transmission)
    && actual.normalSource === expected.normalSource
    && numberFieldMatches(actual.textureScaleMm, expected.textureScaleMm);
}

function numberFieldMatches(actual: number | undefined, expected: number | undefined): boolean {
  if (actual === undefined || expected === undefined) {
    return actual === expected;
  }
  return Math.abs(actual - expected) <= 0.000001;
}

function hasIncompleteMaterialCalibration(renderManifest: ReturnType<typeof DigitalViewingRenderManifestSchema.parse>): boolean {
  const blenderExecution = renderManifest.blenderExecution as {
    materialApplication?: {
      applied?: Array<{ materialId: string; object: string; appearanceCalibration?: { sourcePhoto?: string } }>;
    };
  } | undefined;
  const applied = blenderExecution?.materialApplication?.applied ?? [];
  return renderManifest.materials
    .filter((material) => material.hostElementId && material.appearanceCalibration)
    .some((material) => {
      const appliedMaterial = applied.find((entry) => entry.materialId === material.materialId && entry.object === material.hostElementId);
      return appliedMaterial?.appearanceCalibration?.sourcePhoto !== material.appearanceCalibration?.sourcePhoto;
    });
}

function hasIncompleteMaterialSurfaceMapping(renderManifest: ReturnType<typeof DigitalViewingRenderManifestSchema.parse>): boolean {
  const blenderExecution = renderManifest.blenderExecution as {
	    materialApplication?: {
	      applied?: Array<{
	        materialId: string;
	        object: string;
	        surfaceMapping?: Partial<DigitalViewingMaterialSurfaceMapping>;
	      }>;
	    };
	  } | undefined;
  const applied = blenderExecution?.materialApplication?.applied ?? [];
  return renderManifest.materials
    .filter((material) => material.hostElementId && material.surfaceMapping)
    .some((material) => {
	      const appliedMaterial = applied.find((entry) => entry.materialId === material.materialId && entry.object === material.hostElementId);
	      const expectedMapping = material.surfaceMapping;
	      const appliedMapping = appliedMaterial?.surfaceMapping;
	      return expectedMapping === undefined || !surfaceMappingsMatch(appliedMapping, expectedMapping);
	    });
}

function requiresAssetBundleForDelivery(
  renderManifest: ReturnType<typeof DigitalViewingRenderManifestSchema.parse>,
  deliveryTargets: DigitalViewingDeliveryPackageTarget[]
): boolean {
  return renderManifest.renderPreset.deliveryTier === "premium-sales"
    && deliveryTargets.some((target) => target.required && target.target === "photoreal-render");
}

type AssetUse = {
  assetType: "photo" | "texture" | "render-output";
  usedBy: Set<string>;
};

function collectAssetUses(renderManifest: ReturnType<typeof DigitalViewingRenderManifestSchema.parse>): Map<string, AssetUse> {
  const uses = new Map<string, AssetUse>();
  addAssetUse(uses, renderManifest.artifacts.render, "render-output", "render-output");

  if (renderManifest.renderPreset.camera.referencePhoto) {
    addAssetUse(uses, renderManifest.renderPreset.camera.referencePhoto, "photo", `camera:${renderManifest.renderPreset.camera.sector}`);
  }
  if (renderManifest.renderPreset.lighting.referencePhoto) {
    addAssetUse(uses, renderManifest.renderPreset.lighting.referencePhoto, "photo", `lighting:${renderManifest.renderPreset.lighting.environment}`);
  }

  for (const material of renderManifest.materials) {
    for (const photoSource of material.photoSources) {
      addAssetUse(uses, photoSource, "photo", `material:${material.materialId}`);
    }
    if (material.surfaceMapping?.sourcePhoto) {
      addAssetUse(uses, material.surfaceMapping.sourcePhoto, "photo", `surface-mapping:${material.materialId}`);
    }
    if (material.appearanceCalibration?.sourcePhoto) {
      addAssetUse(uses, material.appearanceCalibration.sourcePhoto, "photo", `appearance-calibration:${material.materialId}`);
    }
    for (const textureMap of material.textureMaps) {
      addAssetUse(uses, textureMap.path, "texture", `texture:${material.materialId}:${textureMap.type}`);
      if (textureMap.sourcePhoto) {
        addAssetUse(uses, textureMap.sourcePhoto, "photo", `texture:${material.materialId}:${textureMap.type}`);
      }
    }
  }

  for (const condition of renderManifest.conditions) {
    for (const photoSource of condition.photoSources) {
      addAssetUse(uses, photoSource, "photo", `condition:${condition.id}`);
    }
  }

  return uses;
}

function addAssetUse(
  uses: Map<string, AssetUse>,
  assetPath: string,
  assetType: AssetUse["assetType"],
  usedBy: string
): void {
  const existing = uses.get(assetPath);
  if (existing) {
    existing.usedBy.add(usedBy);
    return;
  }
  uses.set(assetPath, { assetType, usedBy: new Set([usedBy]) });
}

function sha256(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
