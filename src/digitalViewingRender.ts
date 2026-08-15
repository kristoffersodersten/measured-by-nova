import { createHash } from "node:crypto";
import {
  DefaultCapabilityManifest,
  evaluateCapabilityExecution,
  type CapabilityManifest
} from "./capabilityManifest.js";
import type {
  DigitalViewingCapture,
  DigitalViewingAssetBundleManifest,
  DigitalViewingBlenderRenderJob,
  DigitalViewingPhoto,
  DigitalViewingRenderManifest,
  DigitalViewingRenderPreset,
  MaterialPreset,
  PbrMaterial
} from "./digitalViewingContracts.js";
import {
  DigitalViewingAssetBundleManifestSchema,
  DigitalViewingBlenderRenderJobSchema,
  DigitalViewingConditionInspectionSchema,
  DigitalViewingCaptureSchema,
  DigitalViewingRenderManifestSchema,
  DigitalViewingRenderPresetSchema
} from "./digitalViewingContracts.js";
import { buildDigitalViewingMaterialAuthoringPlan } from "./digitalViewingMaterialPlan.js";
import {
  evaluateDigitalViewingCapturePreset,
  getDigitalViewingCapturePreset
} from "./digitalViewingPresets.js";
import { evaluateDigitalViewingDeliveryReadiness } from "./digitalViewingReadiness.js";

export const MaterialPresets = {
  "automotive-white-paint": {
    presetId: "automotive-white-paint",
    category: "paint",
    pbr: { baseColor: "#f7f7f2", roughness: 0.34, metallic: 0, specular: 0.62, transmission: 0, normalSource: "photo", textureScaleMm: 1200 }
  },
  "automotive-metallic-paint": {
    presetId: "automotive-metallic-paint",
    category: "paint",
    pbr: { baseColor: "#c8c9c7", roughness: 0.28, metallic: 0.18, specular: 0.7, transmission: 0, normalSource: "photo", textureScaleMm: 1200 }
  },
  "marine-gelcoat": {
    presetId: "marine-gelcoat",
    category: "gelcoat",
    pbr: { baseColor: "#f8f8f0", roughness: 0.31, metallic: 0, specular: 0.68, transmission: 0, normalSource: "photo", textureScaleMm: 1600 }
  },
  "clear-glass": {
    presetId: "clear-glass",
    category: "glass",
    pbr: { baseColor: "#dfefff", roughness: 0.04, metallic: 0, specular: 0.9, transmission: 0.72, normalSource: "none", textureScaleMm: 1000 }
  },
  "dark-rubber": {
    presetId: "dark-rubber",
    category: "rubber",
    pbr: { baseColor: "#151515", roughness: 0.78, metallic: 0, specular: 0.22, transmission: 0, normalSource: "photo", textureScaleMm: 280 }
  },
  "brushed-metal": {
    presetId: "brushed-metal",
    category: "metal",
    pbr: { baseColor: "#b8b8b3", roughness: 0.42, metallic: 1, specular: 0.55, transmission: 0, normalSource: "photo", textureScaleMm: 300 }
  },
  "black-leather": {
    presetId: "black-leather",
    category: "leather",
    pbr: { baseColor: "#1c1c1c", roughness: 0.64, metallic: 0, specular: 0.35, transmission: 0, normalSource: "photo", textureScaleMm: 450 }
  },
  "natural-wood": {
    presetId: "natural-wood",
    category: "wood",
    pbr: { baseColor: "#a2764a", roughness: 0.56, metallic: 0, specular: 0.3, transmission: 0, normalSource: "photo", textureScaleMm: 600 }
  },
  "painted-wood": {
    presetId: "painted-wood",
    category: "wood",
    pbr: { baseColor: "#f2f2ee", roughness: 0.48, metallic: 0, specular: 0.32, transmission: 0, normalSource: "photo", textureScaleMm: 900 }
  },
  "stone-masonry": {
    presetId: "stone-masonry",
    category: "stone",
    pbr: { baseColor: "#33383a", roughness: 0.86, metallic: 0, specular: 0.18, transmission: 0, normalSource: "photo", textureScaleMm: 500 }
  },
  "matte-plastic": {
    presetId: "matte-plastic",
    category: "plastic",
    pbr: { baseColor: "#2d2d2d", roughness: 0.62, metallic: 0, specular: 0.3, transmission: 0, normalSource: "photo", textureScaleMm: 350 }
  }
} satisfies Record<string, MaterialPreset>;

export const DigitalViewingRenderStrategies = [
  "locked-blender-source",
  "pbr-materials",
  "texture-map-application",
  "condition-overlays",
  "blender-camera",
  "blender-lighting",
  "render-manifest"
] as const;

export function buildDigitalViewingRenderManifest(
  input: unknown,
  presetInput: unknown,
  capabilityManifest: CapabilityManifest = DefaultCapabilityManifest
): DigitalViewingRenderManifest {
  const capture = DigitalViewingCaptureSchema.parse(input);
  const preset = DigitalViewingRenderPresetSchema.parse(presetInput);
  const capabilityDecision = evaluateCapabilityExecution(capabilityManifest, {
    template: "measured-digital-viewing",
    strategies: DigitalViewingRenderStrategies.slice()
  });
  if (!capabilityDecision.ok) {
    throw new Error(`Cannot build render manifest for unsupported digital viewing capability: ${capabilityDecision.blocking.map((item) => item.code).join(", ")}`);
  }
  const validation = evaluateDigitalViewingDeliveryReadiness(capture, preset.deliveryTier);
  if (!validation.ok) {
    throw new Error(`Cannot build render manifest for invalid capture: ${validation.blocking.map((item) => item.code).join(", ")}`);
  }
  const capturePreset = getDigitalViewingCapturePreset(capture.assetType, preset.deliveryTier);
  const capturePresetReadiness = evaluateDigitalViewingCapturePreset(
    capture,
    capturePreset
  );
  if (!capturePresetReadiness.ok) {
    throw new Error(`Cannot build render manifest for invalid capture preset: ${capturePresetReadiness.blocking.map((item) => item.code).join(", ")}`);
  }
  const materialAuthoring = buildDigitalViewingMaterialAuthoringPlan(capture, preset.deliveryTier);
  if (!materialAuthoring.summary.ready) {
    const blockingCodes = materialAuthoring.materials.flatMap((material) => material.blocking.map((item) => item.code));
    throw new Error(`Cannot build render manifest for incomplete material authoring: ${blockingCodes.join(", ")}`);
  }
  const lightingReferenceError = validateSiteReferenceLighting(capture.photos, preset.lighting);
  if (lightingReferenceError) {
    throw new Error(`Cannot build render manifest for invalid lighting reference: ${lightingReferenceError}`);
  }
  const cameraReferenceError = validateSiteReferencePerspectiveCamera(capture.photos, preset.camera, preset.lighting.environment);
  if (cameraReferenceError) {
    throw new Error(`Cannot build render manifest for invalid camera reference: ${cameraReferenceError}`);
  }
  if (!capture.photos.some((photo) => photo.sector === preset.camera.sector && photo.verified)) {
    throw new Error("Cannot build render manifest for invalid render reference: render_camera_sector_unverified");
  }

  const manifestWithoutHash = DigitalViewingRenderManifestSchema.omit({ hashes: true }).parse({
    schemaVersion: 1,
    captureId: capture.captureId,
    projectId: capture.projectId,
    assetType: capture.assetType,
    outputClassification: {
      purpose: "photorealistic-preview",
      authority: "preview-only",
      previewOnly: true,
      permitSourceOfTruth: false,
      geometryAuthority: false,
      validationStatus: "not-separately-validated"
    },
    notGeometryAuthority: true,
    sourceOfTruth: {
      geometry: "verified-measurements",
      visualEvidence: "structured-photos-material-condition-context",
      renderableTruth: "locked-blender-geometry-required",
      exportStage: "formatting-only-no-geometry-reconstruction"
    },
    capabilityManifest,
    capturePreset,
    renderPreset: preset,
    cameraReference: buildCameraReferenceForRenderManifest(capture, preset),
    lightingReference: buildLightingReferenceForRenderManifest(capture, preset),
    modelElements: capture.modelElements
      .slice()
      .sort((left, right) => left.id.localeCompare(right.id)),
    measurementAnchors: capture.measurements
      .filter((measurement) => measurement.verified && measurement.affectsGeometry && measurement.placement)
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((measurement) => ({
        measurementId: measurement.id,
        hostElementId: measurement.placement?.hostElementId,
        axis: measurement.placement?.axis,
        referenceFrame: measurement.placement?.referenceFrame ?? "asset-local",
        value: measurement.value,
        unit: measurement.unit,
        tolerance: measurement.tolerance,
        geometryValidation: measurement.placement?.geometryValidation,
        sourceOfTruth: "declared-measurement-value-used-by-blender"
      })),
    materials: capture.materials
      .slice()
      .sort((left, right) => left.materialId.localeCompare(right.materialId))
      .map(normalizeMaterialForRenderManifest),
    conditions: capture.conditions
      .slice()
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((condition) => ({
        id: condition.id,
        hostElementId: condition.hostElementId,
        type: condition.type,
        severity: condition.severity,
        confidence: condition.confidence,
        verification: condition.verification,
        source: condition.source,
        photoSources: condition.photoSources.slice().sort(),
        materialSurface: condition.materialSurface,
        surfacePlacement: condition.surfacePlacement
      })),
    conditionVisibilityChecklist: capture.conditions
      .slice()
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((condition) => ({
        conditionId: condition.id,
        hostElementId: condition.hostElementId,
        type: condition.type,
        severity: condition.severity,
        verification: condition.verification,
        mustBeVisible: condition.verification === "verified",
        sourceOfTruth: "verified-condition-evidence",
        sourcePhotos: condition.photoSources.slice().sort(),
        inspectionZones: capture.conditionInspections
          .filter((inspection) => inspection.conditionIds.includes(condition.id))
          .map((inspection) => inspection.zone)
          .sort(),
        materialSurface: condition.materialSurface,
        surfacePlacement: condition.surfacePlacement
      })),
    conditionInspections: capture.conditionInspections
      .slice()
      .sort(compareConditionInspections)
      .map(normalizeConditionInspectionForEvidence),
    warnings: validation.warnings.map((warning) => `${warning.code}:${warning.id}`).sort(),
    artifacts: {
      render: preset.outputPath,
      manifest: preset.outputPath.replace(/\.[^.]+$/, ".manifest.json")
    }
  });

  const hashes = {
    captureHash: sha256(capture),
    geometryHash: sha256(capture.measurements.slice().sort((left, right) => left.id.localeCompare(right.id))),
    materialConditionHash: sha256({
      modelElements: manifestWithoutHash.modelElements,
      materials: manifestWithoutHash.materials,
      conditions: manifestWithoutHash.conditions,
      conditionVisibilityChecklist: manifestWithoutHash.conditionVisibilityChecklist,
      conditionInspections: manifestWithoutHash.conditionInspections
    }),
    materialAuthoringPlanHash: materialAuthoring.hashes.planHash,
    presetHash: sha256(preset)
  };

  return DigitalViewingRenderManifestSchema.parse({
    ...manifestWithoutHash,
    hashes: {
      ...hashes,
      manifestHash: sha256({ ...manifestWithoutHash, hashes })
    }
  });
}

function buildCameraReferenceForRenderManifest(
  capture: DigitalViewingCapture,
  preset: DigitalViewingRenderPreset
): DigitalViewingRenderManifest["cameraReference"] {
  const referencePhoto = preset.camera.referencePhoto;
  if (!referencePhoto) {
    return undefined;
  }
  const photo = capture.photos.find((candidate) => candidate.path === referencePhoto && candidate.verified);
  if (!photo?.captureMetadata) {
    return undefined;
  }
  if (
    typeof photo.captureMetadata.focalLength35mmEquivalent !== "number"
    || typeof photo.captureMetadata.cameraDistanceMm !== "number"
  ) {
    return undefined;
  }
  return {
    sourceOfTruth: "derived-from-verified-capture-photo-camera-metadata",
    referencePhoto,
    sector: preset.camera.sector,
    cameraMode: preset.camera.mode,
    focalLength35mmEquivalent: photo.captureMetadata.focalLength35mmEquivalent,
    cameraDistanceMm: photo.captureMetadata.cameraDistanceMm
  };
}

function buildLightingReferenceForRenderManifest(
  capture: DigitalViewingCapture,
  preset: DigitalViewingRenderPreset
): DigitalViewingRenderManifest["lightingReference"] {
  const referencePhoto = preset.lighting.referencePhoto;
  if (preset.lighting.environment !== "site-reference" || !referencePhoto) {
    return undefined;
  }
  const photo = capture.photos.find((candidate) => candidate.path === referencePhoto && candidate.verified);
  if (
    !photo?.captureMetadata?.lightingReference
    || !photo.captureMetadata.colorReference
    || typeof photo.captureMetadata.whiteBalanceKelvin !== "number"
    || typeof photo.captureMetadata.exposureEv !== "number"
  ) {
    return undefined;
  }
  return {
    sourceOfTruth: "derived-from-verified-capture-photo-lighting-metadata",
    referencePhoto,
    sector: photo.sector,
    lightingReference: photo.captureMetadata.lightingReference,
    colorReference: photo.captureMetadata.colorReference,
    whiteBalanceKelvin: photo.captureMetadata.whiteBalanceKelvin,
    exposureEv: photo.captureMetadata.exposureEv
  };
}

function normalizeConditionInspectionForEvidence(input: unknown) {
  const inspection = DigitalViewingConditionInspectionSchema.parse(input);
  return {
    id: inspection.id,
    zone: inspection.zone,
    hostElementId: inspection.hostElementId,
    materialCategory: inspection.materialCategory,
    status: inspection.status,
    verified: inspection.verified,
    sourcePhotos: inspection.sourcePhotos.slice().sort(),
    conditionIds: inspection.conditionIds.slice().sort(),
    confidence: inspection.confidence
  };
}

function compareConditionInspections(left: { zone: string; id: string }, right: { zone: string; id: string }): number {
  return `${left.zone}:${left.id}`.localeCompare(`${right.zone}:${right.id}`);
}

function validateSiteReferenceLighting(
  photos: DigitalViewingPhoto[],
  lighting: { environment: string; referencePhoto?: string }
): "site_reference_lighting_photo_missing" | "site_reference_lighting_photo_invalid" | "site_reference_lighting_photo_quality_missing" | undefined {
  if (lighting.environment !== "site-reference") {
    return undefined;
  }
  if (!lighting.referencePhoto) {
    return "site_reference_lighting_photo_missing";
  }
  const photo = photos.find((candidate) => candidate.path === lighting.referencePhoto);
  if (!isVerifiedSiteLightingReferencePhoto(photo)) {
    return "site_reference_lighting_photo_invalid";
  }
  if (!hasSiteLightingQualityMetadata(photo)) {
    return "site_reference_lighting_photo_quality_missing";
  }
  return undefined;
}

function isVerifiedSiteLightingReferencePhoto(photo: DigitalViewingPhoto | undefined): boolean {
  if (!photo?.verified || !photo.captureMetadata || photo.captureMetadata.occluded) {
    return false;
  }
  if (!["geometry_alignment", "material", "context"].includes(photo.role)) {
    return false;
  }
  return ["full-object", "full-sector"].includes(photo.captureMetadata.coverage);
}

function hasSiteLightingQualityMetadata(photo: DigitalViewingPhoto | undefined): boolean {
  return Boolean(
    photo?.captureMetadata?.lightingReference
    && photo.captureMetadata.colorReference
    && typeof photo.captureMetadata.whiteBalanceKelvin === "number"
    && typeof photo.captureMetadata.exposureEv === "number"
  );
}

function validateSiteReferencePerspectiveCamera(
  photos: DigitalViewingPhoto[],
  camera: { mode: string; sector: string; referencePhoto?: string },
  lightingEnvironment: string
): "render_camera_reference_photo_missing" | "render_camera_reference_photo_invalid" | undefined {
  if (camera.mode !== "perspective" || lightingEnvironment !== "site-reference") {
    return undefined;
  }
  if (!camera.referencePhoto) {
    return "render_camera_reference_photo_missing";
  }
  const photo = photos.find((candidate) => candidate.path === camera.referencePhoto);
  if (!isVerifiedCameraReferencePhoto(photo, camera.sector)) {
    return "render_camera_reference_photo_invalid";
  }
  return undefined;
}

function isVerifiedCameraReferencePhoto(photo: DigitalViewingPhoto | undefined, sector: string): boolean {
  if (!isVerifiedSiteLightingReferencePhoto(photo)) {
    return false;
  }
  return photo?.sector === sector;
}

export function buildDigitalViewingBlenderRenderJob(
  input: unknown,
  presetInput: unknown,
  sourceBlendPath: string,
  capabilityManifest: CapabilityManifest = DefaultCapabilityManifest,
  assetBundleManifestInput?: unknown
): DigitalViewingBlenderRenderJob {
  const capture = DigitalViewingCaptureSchema.parse(input);
  const renderManifest = buildDigitalViewingRenderManifest(input, presetInput, capabilityManifest);
  const materialAuthoringPlan = buildDigitalViewingMaterialAuthoringPlan(capture, renderManifest.renderPreset.deliveryTier);
  DigitalViewingBlenderRenderJobSchema.shape.sourceBlendPath.parse(sourceBlendPath);
  if (!assetBundleManifestInput) {
    throw new Error("Cannot build render job without verified asset bundle: asset_bundle_manifest_required");
  }
  const assetBundleManifest = validateAssetBundleForRenderJob(assetBundleManifestInput, renderManifest, capture);
  return DigitalViewingBlenderRenderJobSchema.parse({
    mode: "measurement_project",
    operation: "digital_viewing_render",
    sourceBlendPath,
    executionPlacement: {
      sourceOfTruth: "computed-from-digital-viewing-render-contract",
      frontendRole: "control-plane-only",
      termuxRole: "ssh-control-plane-only",
      heavyComputeRole: "blender-render-worker",
      preferredExecutionGeography: "hetzner-ubuntu",
      fallbackExecutionGeography: "local-workstation",
      remoteExecutionRequiresExplicitSelection: true,
      geometryMutationAllowed: false,
      exportGeometryReconstructionAllowed: false
    },
    renderManifest,
    materialAuthoring: {
      sourceOfTruth: "derived-from-material-authoring-plan",
      planHash: materialAuthoringPlan.hashes.planHash,
      ready: materialAuthoringPlan.summary.ready,
      blockingCount: materialAuthoringPlan.summary.blockingCount,
      warningCount: materialAuthoringPlan.summary.warningCount
    },
    assetBundleManifest
  });
}

function validateAssetBundleForRenderJob(
  input: unknown,
  renderManifest: DigitalViewingRenderManifest,
  capture: DigitalViewingCapture
): DigitalViewingAssetBundleManifest {
  const parsedAssetBundleManifest = DigitalViewingAssetBundleManifestSchema.safeParse(input);
  if (!parsedAssetBundleManifest.success) {
    throw new Error("Cannot build render job with invalid asset bundle: asset_bundle_integrity_failed");
  }
  const assetBundleManifest = parsedAssetBundleManifest.data;
  if (!assetBundleIntegrityIsValid(assetBundleManifest)) {
    throw new Error("Cannot build render job with invalid asset bundle: asset_bundle_integrity_failed");
  }
  if (!assetBundleManifest.qualityGates.ready) {
    throw new Error("Cannot build render job with invalid asset bundle: asset_bundle_not_ready");
  }
  if (renderManifest.renderPreset.deliveryTier === "premium-sales" && !assetBundleContentMetadataIsValid(assetBundleManifest)) {
    throw new Error("Cannot build render job with invalid asset bundle: asset_bundle_content_hash_missing");
  }
  if (renderManifest.renderPreset.deliveryTier === "premium-sales" && !assetBundleImageDimensionsMetadataIsValid(assetBundleManifest)) {
    throw new Error("Cannot build render job with invalid asset bundle: asset_bundle_image_dimensions_missing");
  }
  if (renderManifest.renderPreset.deliveryTier === "premium-sales" && !assetBundleTextureDimensionsMatchDeclaredEvidence(assetBundleManifest, renderManifest)) {
    throw new Error("Cannot build render job with invalid asset bundle: asset_bundle_texture_dimensions_mismatch");
  }
  if (renderManifest.renderPreset.deliveryTier === "premium-sales" && !assetBundlePhotoDimensionsMatchDeclaredCapture(assetBundleManifest, capture)) {
    throw new Error("Cannot build render job with invalid asset bundle: asset_bundle_photo_dimensions_mismatch");
  }
  if (assetBundleManifest.hashes.captureHash !== renderManifest.hashes.captureHash) {
    throw new Error("Cannot build render job with invalid asset bundle: asset_bundle_capture_hash_mismatch");
  }
  if (assetBundleManifest.hashes.renderManifestHash !== renderManifest.hashes.manifestHash) {
    throw new Error("Cannot build render job with invalid asset bundle: asset_bundle_render_manifest_hash_mismatch");
  }
  return assetBundleManifest;
}

function assetBundleIntegrityIsValid(assetBundleManifest: DigitalViewingAssetBundleManifest): boolean {
  const missingRequiredAssets = assetBundleManifest.assets.filter((asset) => asset.required && asset.status === "missing");
  const expectedReady = missingRequiredAssets.length === 0 && assetBundleManifest.qualityGates.blocking.length === 0;
  return assetBundleManifest.summary.requiredCount === assetBundleManifest.assets.filter((asset) => asset.required).length
    && assetBundleManifest.summary.missingCount === missingRequiredAssets.length
    && assetBundleManifest.qualityGates.ready === expectedReady
    && assetBundleManifest.summary.ready === expectedReady;
}

function assetBundleContentMetadataIsValid(assetBundleManifest: DigitalViewingAssetBundleManifest): boolean {
  return assetBundleManifest.assets
    .filter((asset) => asset.required && asset.status === "present" && ["photo", "texture"].includes(asset.assetType))
    .every((asset) => asset.sizeBytes !== undefined && asset.sha256 !== undefined);
}

function assetBundleImageDimensionsMetadataIsValid(assetBundleManifest: DigitalViewingAssetBundleManifest): boolean {
  return assetBundleManifest.assets
    .filter((asset) => asset.required && asset.status === "present" && ["photo", "texture"].includes(asset.assetType))
    .every((asset) => asset.width !== undefined && asset.height !== undefined);
}

function assetBundleTextureDimensionsMatchDeclaredEvidence(
  assetBundleManifest: DigitalViewingAssetBundleManifest,
  renderManifest: DigitalViewingRenderManifest
): boolean {
  const presentTextureAssetsByPath = new Map(
    assetBundleManifest.assets
      .filter((asset) => asset.required && asset.status === "present" && asset.assetType === "texture")
      .map((asset) => [asset.path, asset])
  );

  return renderManifest.materials
    .flatMap((material) => material.textureMaps)
    .filter((textureMap) => textureMap.pixelWidth !== undefined && textureMap.pixelHeight !== undefined)
    .every((textureMap) => {
      const asset = presentTextureAssetsByPath.get(textureMap.path);
      if (!asset) {
        return false;
      }
      return asset.width === textureMap.pixelWidth && asset.height === textureMap.pixelHeight;
    });
}

function assetBundlePhotoDimensionsMatchDeclaredCapture(
  assetBundleManifest: DigitalViewingAssetBundleManifest,
  capture: DigitalViewingCapture
): boolean {
  const presentPhotoAssetsByPath = new Map(
    assetBundleManifest.assets
      .filter((asset) => asset.required && asset.status === "present" && asset.assetType === "photo")
      .map((asset) => [asset.path, asset])
  );

  return capture.photos
    .filter((photo) => photo.pixelWidth !== undefined && photo.pixelHeight !== undefined)
    .every((photo) => {
      const asset = presentPhotoAssetsByPath.get(photo.path);
      if (!asset) {
        return true;
      }
      return asset.width === photo.pixelWidth && asset.height === photo.pixelHeight;
    });
}

function normalizeMaterialForRenderManifest(material: PbrMaterial): DigitalViewingRenderManifest["materials"][number] {
  const preset = material.presetId ? MaterialPresets[material.presetId] : undefined;
  return {
    materialId: material.materialId,
    hostElementId: material.hostElementId,
    presetId: material.presetId,
    category: material.category,
    provenance: material.provenance,
    confidence: material.confidence,
    materialSurfaces: material.materialSurfaces.slice().sort(),
    photoSources: material.photoSources.slice().sort(),
    pbr: {
      baseColor: material.baseColor ?? preset?.pbr.baseColor,
      roughness: material.roughness ?? preset?.pbr.roughness,
      metallic: material.metallic ?? preset?.pbr.metallic,
      specular: material.specular ?? preset?.pbr.specular,
      transmission: material.transmission ?? preset?.pbr.transmission,
      normalSource: material.normalSource === "unknown" ? preset?.pbr.normalSource ?? "unknown" : material.normalSource,
      textureScaleMm: material.textureScaleMm ?? preset?.pbr.textureScaleMm
    },
    surfaceMapping: material.surfaceMapping,
    appearanceCalibration: material.appearanceCalibration,
    textureMaps: material.textureMaps.slice().sort((left, right) => `${left.type}:${left.path}`.localeCompare(`${right.type}:${right.path}`))
  };
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
