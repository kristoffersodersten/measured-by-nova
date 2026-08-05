import { createHash } from "node:crypto";
import {
  DigitalViewingCaptureSchema,
  DigitalViewingMaterialAuthoringPlanSchema,
  type DigitalViewingMaterialAuthoringPlan,
  type DigitalViewingPhoto,
  type PbrMaterial,
  type TextureMap
} from "./digitalViewingContracts.js";

type TextureMapType = TextureMap["type"];
type DeliveryTier = DigitalViewingMaterialAuthoringPlan["deliveryTier"];

export function buildDigitalViewingMaterialAuthoringPlan(input: unknown, deliveryTierInput: unknown): DigitalViewingMaterialAuthoringPlan {
  const capture = DigitalViewingCaptureSchema.parse(input);
  const deliveryTier = DigitalViewingMaterialAuthoringPlanSchema.shape.deliveryTier.parse(deliveryTierInput);
  const photosByPath = new Map(capture.photos.map((photo) => [photo.path, photo]));

  const materials = capture.materials
    .slice()
    .sort((left, right) => left.materialId.localeCompare(right.materialId))
    .map((material) => buildMaterialPlan(material, deliveryTier, photosByPath));

  const planWithoutHash = DigitalViewingMaterialAuthoringPlanSchema.omit({ hashes: true }).parse({
    schemaVersion: 1,
    planType: "material-authoring-plan",
    captureId: capture.captureId,
    projectId: capture.projectId,
    assetType: capture.assetType,
    deliveryTier,
    notGeometryAuthority: true,
    sourceOfTruth: {
      measurements: "geometry-and-scale-only",
      photos: "material-texture-condition-evidence",
      plan: "pre-render-authoring-requirements-no-geometry-reconstruction"
    },
    materials,
    summary: {
      ready: materials.every((material) => material.blocking.length === 0),
      blockingCount: materials.reduce((sum, material) => sum + material.blocking.length, 0),
      warningCount: materials.reduce((sum, material) => sum + material.warnings.length, 0)
    }
  });

  const hashes = {
    captureHash: sha256(capture)
  };

  return DigitalViewingMaterialAuthoringPlanSchema.parse({
    ...planWithoutHash,
    hashes: {
      ...hashes,
      planHash: sha256({ ...planWithoutHash, hashes })
    }
  });
}

export function serializeDigitalViewingMaterialAuthoringPlan(input: unknown): string {
  const plan = DigitalViewingMaterialAuthoringPlanSchema.parse(input);
  return `${JSON.stringify(plan, null, 2)}\n`;
}

function buildMaterialPlan(
  material: PbrMaterial,
  deliveryTier: DeliveryTier,
  photosByPath: Map<string, DigitalViewingPhoto>
): DigitalViewingMaterialAuthoringPlan["materials"][number] {
  const requiredMaps = requiredMapsFor(material, deliveryTier);
  const presentMaps = uniqueSorted(material.textureMaps.map((textureMap) => textureMap.type));
  const presentRequiredMaps = new Set(presentMaps);
  const missingMaps = requiredMaps.filter((type) => !presentRequiredMaps.has(type));
  const blocking = [];
  const warnings = [];

  if (deliveryTier === "premium-sales" && !material.hostElementId) {
    blocking.push({
      id: material.materialId,
      code: "material_host_missing" as const,
      message: "Premium material authoring requires a Blender host object so texture evidence can be applied deterministically."
    });
  }
  if (deliveryTier === "premium-sales" && !material.presetId) {
    blocking.push({
      id: material.materialId,
      code: "material_preset_missing" as const,
      message: "Premium material authoring requires a domain material preset so PBR defaults are explicit."
    });
  }
  if (deliveryTier === "premium-sales" && material.provenance === "photo_observed" && !material.appearanceCalibration) {
    blocking.push({
      id: material.materialId,
      code: "material_appearance_calibration_missing" as const,
      message: "Premium material authoring requires appearance calibration for photo-observed color and finish."
    });
  } else if (deliveryTier === "premium-sales" && material.provenance === "photo_observed" && !material.appearanceCalibration?.illuminant) {
    blocking.push({
      id: `${material.materialId}:appearance-calibration`,
      code: "material_appearance_calibration_illuminant_missing" as const,
      message: "Premium appearance calibration must declare illuminant so Blender material color and finish are reproducible."
    });
  } else if (deliveryTier === "premium-sales" && material.appearanceCalibration?.sourcePhoto) {
    const calibrationPhoto = photosByPath.get(material.appearanceCalibration.sourcePhoto);
    if (!isVerifiedAppearanceCalibrationPhoto(calibrationPhoto)) {
      blocking.push({
        id: `${material.materialId}:appearance-calibration`,
        code: "material_appearance_calibration_source_photo_invalid" as const,
        message: "Premium appearance calibration must reference a verified, unoccluded photo suitable for color and finish calibration."
      });
    } else if (!hasAppearanceCalibrationMetadata(calibrationPhoto)) {
      blocking.push({
        id: `${material.materialId}:appearance-calibration`,
        code: "material_appearance_calibration_photo_metadata_missing" as const,
        message: "Premium appearance calibration photos must include lighting and color reference metadata for reproducible material rendering."
      });
    } else if (!hasAppearanceCalibrationNormalizationMetadata(calibrationPhoto)) {
      blocking.push({
        id: `${material.materialId}:appearance-calibration`,
        code: "material_appearance_calibration_photo_normalization_missing" as const,
        message: "Premium appearance calibration photos must include white balance and exposure metadata so material color can be reproduced in Blender."
      });
    } else if (!isAppearanceCalibrationMaterialCategoryCompatible(material, calibrationPhoto)) {
      blocking.push({
        id: `${material.materialId}:appearance-calibration`,
        code: "material_appearance_calibration_material_category_mismatch" as const,
        message: "Premium appearance calibration photos must explicitly match the material category they calibrate."
      });
    } else if (!isAppearanceCalibrationReferenceCompatible(material, calibrationPhoto)) {
      blocking.push({
        id: `${material.materialId}:appearance-calibration`,
        code: "material_appearance_calibration_reference_incompatible" as const,
        message: "Premium appearance calibration method must match the color reference captured in the source photo."
      });
    } else if (
      calibrationPhoto
      && material.surfaceMapping
      && isMappedExteriorFaceSector(calibrationPhoto.sector)
      && !material.surfaceMapping.faces.includes(calibrationPhoto.sector)
    ) {
      blocking.push({
        id: `${material.materialId}:appearance-calibration:${calibrationPhoto.sector}`,
        code: "material_appearance_calibration_source_photo_face_mismatch" as const,
        message: "Premium exterior appearance calibration source photo sector must be one of the mapped material faces."
      });
    }
  }
  if (deliveryTier === "premium-sales" && !material.surfaceMapping) {
    blocking.push({
      id: material.materialId,
      code: "material_surface_mapping_missing" as const,
      message: "Premium material authoring requires explicit surface mapping so texture placement is reproducible in Blender."
    });
  } else if (
    deliveryTier === "premium-sales"
    && material.surfaceMapping?.sourcePhoto
    && !isVerifiedTextureSourcePhotoForMaterial(material, photosByPath.get(material.surfaceMapping.sourcePhoto))
  ) {
    blocking.push({
      id: `${material.materialId}:surface-mapping`,
      code: "material_surface_mapping_source_photo_invalid" as const,
      message: "Premium material surface mapping must reference a verified, unoccluded photo suitable for material placement."
    });
  } else if (deliveryTier === "premium-sales" && material.surfaceMapping?.sourcePhoto) {
    const mappingPhoto = photosByPath.get(material.surfaceMapping.sourcePhoto);
    if (
      mappingPhoto
      && isMappedExteriorFaceSector(mappingPhoto.sector)
      && !material.surfaceMapping.faces.includes(mappingPhoto.sector)
    ) {
      blocking.push({
        id: `${material.materialId}:surface-mapping:${mappingPhoto.sector}`,
        code: "material_surface_mapping_source_photo_face_mismatch" as const,
        message: "Premium exterior material surface mapping source photo sector must be one of the mapped faces."
      });
    }
  }
  if (
    deliveryTier === "premium-sales"
    && material.photoSources.some((sourcePhoto) =>
      !isPhotoMaterialCategoryCompatible(material, photosByPath.get(sourcePhoto))
    )
  ) {
    blocking.push({
      id: `${material.materialId}:photo-sources`,
      code: "material_source_photo_material_category_mismatch" as const,
      message: "Premium material source photos must match the material category before authoring Blender material evidence."
    });
  }
  if (deliveryTier === "premium-sales" && material.surfaceMapping) {
    for (const sourcePhoto of material.photoSources) {
      const photo = photosByPath.get(sourcePhoto);
      if (photo && isMappedExteriorFaceSector(photo.sector) && !material.surfaceMapping.faces.includes(photo.sector)) {
        blocking.push({
          id: `${material.materialId}:photo-sources:${photo.sector}`,
          code: "material_source_photo_face_mismatch" as const,
          message: "Premium exterior material source photo sector must be one of the mapped material faces."
        });
      }
    }
  }
  for (const type of missingMaps) {
    blocking.push({
      id: `${material.materialId}:${type}`,
      code: "required_texture_map_missing" as const,
      message: `Premium material authoring requires a ${type} texture map for ${material.category}.`
    });
  }
  for (const textureMap of material.textureMaps) {
    if (deliveryTier !== "premium-sales" || !requiredMaps.includes(textureMap.type)) {
      continue;
    }
    if (!textureMap.sourcePhoto) {
      blocking.push({
        id: `${material.materialId}:${textureMap.type}:source-photo`,
        code: "texture_source_missing" as const,
        message: "Premium texture maps must reference the source photo used to author the map."
      });
    } else if (!isVerifiedTextureSourcePhotoForMaterial(material, photosByPath.get(textureMap.sourcePhoto))) {
      blocking.push({
        id: `${material.materialId}:${textureMap.type}:source-photo`,
        code: "texture_source_photo_invalid" as const,
        message: "Premium texture maps must reference a verified, unoccluded material/detail photo suitable for texture evidence."
      });
    } else if (material.surfaceMapping) {
      const textureSourcePhoto = photosByPath.get(textureMap.sourcePhoto);
      if (
        textureSourcePhoto
        && isMappedExteriorFaceSector(textureSourcePhoto.sector)
        && !material.surfaceMapping.faces.includes(textureSourcePhoto.sector)
      ) {
        blocking.push({
          id: `${material.materialId}:${textureMap.type}:source-photo:${textureSourcePhoto.sector}`,
          code: "texture_source_photo_face_mismatch" as const,
          message: "Premium exterior texture source photo sector must be one of the mapped material faces."
        });
      }
    }
    if (!textureMap.scaleMm) {
      blocking.push({
        id: `${material.materialId}:${textureMap.type}:scale`,
        code: "texture_scale_missing" as const,
        message: "Premium texture maps must declare physical scale in millimeters so Blender mapping is reproducible."
      });
    }
    if (!textureMap.pixelWidth || !textureMap.pixelHeight) {
      blocking.push({
        id: `${material.materialId}:${textureMap.type}:resolution`,
        code: "texture_resolution_missing" as const,
        message: "Premium texture maps must declare pixel width and height so render quality is explicit."
      });
    }
    const expectedColorSpace = textureMap.type === "baseColor" ? "sRGB" : "Non-Color";
    if (textureMap.colorSpace !== expectedColorSpace) {
      blocking.push({
        id: `${material.materialId}:${textureMap.type}:color-space`,
        code: "texture_color_space_invalid" as const,
        message: "Premium texture maps must use sRGB for baseColor and Non-Color for data maps so Blender interprets material evidence correctly."
      });
    }
  }
  if (material.confidence === "low") {
    warnings.push({
      id: material.materialId,
      code: "material_low_confidence" as const,
      message: "Low-confidence material evidence may be useful for review, but must not be sold as verified photorealistic material truth."
    });
  }
  if (material.provenance === "photo_observed" && material.photoSources.length === 0) {
    warnings.push({
      id: material.materialId,
      code: "photo_evidence_missing" as const,
      message: "Photo-observed material should reference source photos."
    });
  }
  if (deliveryTier === "premium-sales" && (material.normalSource === "procedural" || material.normalSource === "unknown")) {
    warnings.push({
      id: material.materialId,
      code: "procedural_or_unknown_normal" as const,
      message: "Premium photorealism should use photo-backed normal evidence where surface relief is visible."
    });
  }
  if (requiredMaps.length === 0 && material.textureMaps.length === 0) {
    warnings.push({
      id: material.materialId,
      code: "texture_maps_not_required_for_tier" as const,
      message: "This delivery tier can proceed without texture-map authoring, but output must remain visibly lower confidence."
    });
  }

  return {
    materialId: material.materialId,
    hostElementId: material.hostElementId,
    category: material.category,
    presetId: material.presetId,
    provenance: material.provenance,
    confidence: material.confidence,
    materialSurfaces: material.materialSurfaces.slice().sort(),
    surfaceMapping: material.surfaceMapping,
    appearanceCalibration: material.appearanceCalibration,
    requiredMaps,
    presentMaps,
    missingMaps,
    pbrFields: {
      baseColor: pbrFieldStatus(material.baseColor, material.presetId),
      roughness: pbrFieldStatus(material.roughness, material.presetId),
      metallic: pbrFieldStatus(material.metallic, material.presetId),
      specular: pbrFieldStatus(material.specular, material.presetId),
      transmission: pbrFieldStatus(material.transmission, material.presetId),
      normalSource: material.normalSource !== "unknown" || material.presetId ? "declared" : "missing",
      textureScaleMm: pbrFieldStatus(material.textureScaleMm, material.presetId)
    },
    sourcePhotos: material.photoSources.slice().sort(),
    textureSources: material.textureMaps.slice().sort(compareTextureMaps).map((textureMap) => ({
      type: textureMap.type,
      path: textureMap.path,
      confidence: textureMap.confidence,
      scaleMm: textureMap.scaleMm,
      pixelWidth: textureMap.pixelWidth,
      pixelHeight: textureMap.pixelHeight,
      sourcePhoto: textureMap.sourcePhoto
    })),
    authoringStatus: blocking.length === 0 ? "ready" : "incomplete",
    blocking,
    warnings
  };
}

function pbrFieldStatus(value: unknown, presetId: PbrMaterial["presetId"]): "declared" | "missing" {
  return value !== undefined || presetId ? "declared" : "missing";
}

function isVerifiedTextureSourcePhoto(photo: DigitalViewingPhoto | undefined): boolean {
  if (!photo?.verified || !photo.captureMetadata || photo.captureMetadata.occluded) {
    return false;
  }
  if (photo.role !== "geometry_alignment" && photo.role !== "material" && photo.role !== "condition") {
    return false;
  }
  return photo.captureMetadata.coverage === "material-surface"
    || photo.captureMetadata.coverage === "full-sector"
    || photo.captureMetadata.coverage === "full-object";
}

function isVerifiedTextureSourcePhotoForMaterial(material: PbrMaterial, photo: DigitalViewingPhoto | undefined): boolean {
  return isVerifiedTextureSourcePhoto(photo)
    && isPhotoMaterialCategoryCompatible(material, photo);
}

function isVerifiedAppearanceCalibrationPhoto(photo: DigitalViewingPhoto | undefined): boolean {
  if (!photo?.verified || !photo.captureMetadata || photo.captureMetadata.occluded) {
    return false;
  }
  if (photo.role !== "geometry_alignment" && photo.role !== "material") {
    return false;
  }
  return photo.captureMetadata.coverage === "material-surface"
    || photo.captureMetadata.coverage === "full-sector"
    || photo.captureMetadata.coverage === "full-object";
}

function isMappedExteriorFaceSector(sector: string): sector is NonNullable<PbrMaterial["surfaceMapping"]>["faces"][number] {
  return sector === "front"
    || sector === "rear"
    || sector === "left"
    || sector === "right"
    || sector === "top"
    || sector === "bottom";
}

function hasAppearanceCalibrationMetadata(photo: DigitalViewingPhoto | undefined): boolean {
  return Boolean(photo?.captureMetadata?.lightingReference && photo.captureMetadata.colorReference);
}

function hasAppearanceCalibrationNormalizationMetadata(photo: DigitalViewingPhoto | undefined): boolean {
  return Boolean(
    photo?.captureMetadata
    && typeof photo.captureMetadata.whiteBalanceKelvin === "number"
    && typeof photo.captureMetadata.exposureEv === "number"
  );
}

function isAppearanceCalibrationMaterialCategoryCompatible(material: PbrMaterial, photo: DigitalViewingPhoto | undefined): boolean {
  return isPhotoMaterialCategoryCompatible(material, photo);
}

function isPhotoMaterialCategoryCompatible(material: PbrMaterial, photo: DigitalViewingPhoto | undefined): boolean {
  const categories = photo?.captureMetadata?.materialCategories;
  return !categories || categories.length === 0 || categories.includes(material.category);
}

function isAppearanceCalibrationReferenceCompatible(material: PbrMaterial, photo: DigitalViewingPhoto | undefined): boolean {
  const method = material.appearanceCalibration?.method;
  const colorReference = photo?.captureMetadata?.colorReference;
  if (!method || !colorReference) {
    return false;
  }
  switch (method) {
    case "color-chart":
      return colorReference === "color-checker";
    case "white-balance-reference":
      return colorReference === "gray-card"
        || colorReference === "known-white-reference"
        || colorReference === "manual-white-balance";
    case "manufacturer-spec":
      return colorReference === "manufacturer-spec";
    case "manual-specified":
      return colorReference === "manual-white-balance"
        || colorReference === "manufacturer-spec";
  }
}

function requiredMapsFor(material: PbrMaterial, deliveryTier: DeliveryTier): TextureMapType[] {
  if (deliveryTier !== "premium-sales") {
    return [];
  }
  switch (material.category) {
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

function uniqueSorted(values: TextureMapType[]): TextureMapType[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function compareTextureMaps(left: TextureMap, right: TextureMap): number {
  return `${left.type}:${left.path}`.localeCompare(`${right.type}:${right.path}`);
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
