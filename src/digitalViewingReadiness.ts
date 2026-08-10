import {
  DigitalViewingCaptureSchema,
  DigitalViewingDeliveryReadinessResultSchema,
  DigitalViewingValidationResultSchema,
  type DigitalViewingPhoto,
  type DigitalViewingDeliveryReadinessResult,
  type DigitalViewingValidationResult,
  type PbrMaterial
} from "./digitalViewingContracts.js";
import {
  evaluateDigitalViewingCapturePreset,
  getDigitalViewingCapturePreset
} from "./digitalViewingPresets.js";

type DigitalViewingDeliveryBlockingReason = DigitalViewingDeliveryReadinessResult["blocking"][number];

const PremiumDeliveryCaptureAngleCodes: ReadonlySet<DigitalViewingDeliveryBlockingReason["code"]> = new Set([
  "photo_capture_metadata_missing",
  "photo_angle_mismatch",
  "photo_camera_mode_mismatch",
  "photo_yaw_out_of_tolerance",
  "photo_pitch_missing",
  "photo_pitch_out_of_tolerance",
  "photo_camera_calibration_missing",
  "photo_coverage_mismatch",
  "photo_occluded",
  "photo_measured_endpoints_missing"
]);

function isPremiumDeliveryCaptureAngleReason(
  reason: { id: string; code: string; message: string }
): reason is DigitalViewingDeliveryBlockingReason {
  return PremiumDeliveryCaptureAngleCodes.has(reason.code as DigitalViewingDeliveryBlockingReason["code"]);
}

function isVerifiedConditionDetailPhoto(photo: DigitalViewingPhoto | undefined): boolean {
  return Boolean(
    photo?.verified
    && photo.role === "condition"
    && photo.captureMetadata?.angleType === "detail"
    && photo.captureMetadata.cameraMode === "macro-detail"
    && photo.captureMetadata.coverage === "condition-detail"
    && photo.captureMetadata.occluded === false
  );
}

function isHighResolutionConditionDetailPhoto(photo: DigitalViewingPhoto | undefined): boolean {
  return Boolean(
    isVerifiedConditionDetailPhoto(photo)
    && photo?.pixelWidth !== undefined
    && photo.pixelHeight !== undefined
    && Math.min(photo.pixelWidth, photo.pixelHeight) >= 1024
  );
}

function hasPremiumConditionDetailQualityMetadata(photo: DigitalViewingPhoto | undefined): boolean {
  return Boolean(
    isHighResolutionConditionDetailPhoto(photo)
    && photo?.captureMetadata
    && typeof photo.captureMetadata.cameraDistanceMm === "number"
    && photo.captureMetadata.lightingReference
    && photo.captureMetadata.colorReference
    && typeof photo.captureMetadata.whiteBalanceKelvin === "number"
    && typeof photo.captureMetadata.exposureEv === "number"
  );
}

function conditionSeverityRequiresDetailQuality(severity: string): boolean {
  return severity === "medium" || severity === "high";
}

function isVerifiedMaterialPlacementPhoto(photo: DigitalViewingPhoto | undefined): boolean {
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

function isVerifiedMaterialPlacementPhotoForMaterial(material: PbrMaterial, photo: DigitalViewingPhoto | undefined): boolean {
  return isVerifiedMaterialPlacementPhoto(photo)
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

function isPhotoMaterialCategoryCompatibleWithSurface(
  materialSurface: string | undefined,
  surfaceCategoryById: Map<string, PbrMaterial["category"]>,
  photo: DigitalViewingPhoto | undefined
): boolean {
  const categories = photo?.captureMetadata?.materialCategories;
  if (!categories || categories.length === 0 || !materialSurface) {
    return true;
  }
  const surfaceCategory = surfaceCategoryById.get(materialSurface);
  return !surfaceCategory || categories.includes(surfaceCategory);
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

function hasAppearanceCalibrationIlluminant(material: { appearanceCalibration?: { illuminant?: string } }): boolean {
  return Boolean(material.appearanceCalibration?.illuminant);
}

function isMappedExteriorFaceSector(sector: string): sector is NonNullable<PbrMaterial["surfaceMapping"]>["faces"][number] {
  return sector === "front"
    || sector === "rear"
    || sector === "left"
    || sector === "right"
    || sector === "top"
    || sector === "bottom";
}

export function validateDigitalViewingCapture(input: unknown): DigitalViewingValidationResult {
  const capture = DigitalViewingCaptureSchema.parse(input);
  const blocking: DigitalViewingValidationResult["blocking"] = [];
  const warnings: DigitalViewingValidationResult["warnings"] = [{
    id: "photos-source-of-truth",
    code: "photo_not_authoritative",
    message: "Photos are material, condition, context, and validation evidence; they must not override verified measurements."
  }];

  for (const measurement of capture.measurements) {
    if (measurement.affectsGeometry && !measurement.verified) {
      blocking.push({
        id: measurement.id,
        code: "geometry_not_verified",
        message: "Geometry-impacting measurements must be verified before model lock or export."
      });
    }
  }

  for (const sector of capture.requiredSectors) {
    const sectorPhotos = capture.photos.filter((photo) => photo.sector === sector);
    if (sectorPhotos.length === 0) {
      blocking.push({
        id: `sector-${sector}`,
        code: "required_sector_missing",
        message: "Required capture sector is missing."
      });
      continue;
    }
    if (!sectorPhotos.some((photo) => photo.verified)) {
      blocking.push({
        id: `sector-${sector}`,
        code: "required_sector_unverified",
        message: "Required capture sector must contain at least one verified photo."
      });
    }
  }

  for (const material of capture.materials) {
    if (material.provenance === "photo_observed" && material.photoSources.length === 0) {
      blocking.push({
        id: material.materialId,
        code: "material_source_missing",
        message: "Photo-observed materials must reference at least one source photo."
      });
    }
    if (material.confidence === "low") {
      warnings.push({
        id: material.materialId,
        code: "material_low_confidence",
        message: "Low-confidence material must remain visibly marked in manifests and review surfaces."
      });
    }
    if (material.provenance === "inferred" || material.provenance === "unknown") {
      warnings.push({
        id: material.materialId,
        code: "material_inferred_or_unknown",
        message: "Inferred or unknown material may be used for preview only and must not be presented as verified."
      });
    }
    for (const textureMap of material.textureMaps) {
      if (textureMap.provenance === "photo_observed" && !textureMap.sourcePhoto) {
        warnings.push({
          id: `${material.materialId}:${textureMap.type}`,
          code: "material_low_confidence",
          message: "Photo-observed texture maps should reference the source photo used for the texture crop."
        });
      }
    }
  }

  for (const condition of capture.conditions) {
    if ((condition.source === "photo" || condition.verification === "verified") && condition.photoSources.length === 0) {
      blocking.push({
        id: condition.id,
        code: "condition_source_missing",
        message: "Condition evidence must reference at least one source photo when it is photo-based or verified."
      });
    }
    if (condition.verification !== "verified") {
      warnings.push({
        id: condition.id,
        code: "condition_not_verified",
        message: "Unverified condition evidence must remain visible as an assumption or low-confidence observation."
      });
    }
  }

  for (const assumption of capture.assumptions) {
    if (assumption.affectsGeometry && assumption.confidence !== "high") {
      blocking.push({
        id: assumption.id,
        code: "geometry_assumption_unverified",
        message: "Geometry-affecting assumptions must be resolved into verified measurements before model lock or export."
      });
    }
  }

  return DigitalViewingValidationResultSchema.parse({
    ok: blocking.length === 0,
    blocking,
    warnings
  });
}

export function evaluateDigitalViewingDeliveryReadiness(input: unknown, deliveryTierInput: unknown): DigitalViewingDeliveryReadinessResult {
  const capture = DigitalViewingCaptureSchema.parse(input);
  const deliveryTier = DigitalViewingDeliveryReadinessResultSchema.shape.deliveryTier.parse(deliveryTierInput);
  const base = validateDigitalViewingCapture(capture);
  const blocking: DigitalViewingDeliveryReadinessResult["blocking"] = [...base.blocking];
  const warnings: DigitalViewingDeliveryReadinessResult["warnings"] = [...base.warnings];
  const photosByPath = new Map(capture.photos.map((photo) => [photo.path, photo]));

  if (deliveryTier === "draft-preview") {
    for (const material of capture.materials) {
      if (material.textureMaps.length === 0) {
        warnings.push({
          id: material.materialId,
          code: "texture_evidence_missing",
          message: "Draft preview can render without texture maps, but missing texture evidence must remain visible in review."
        });
      }
    }
    return DigitalViewingDeliveryReadinessResultSchema.parse({ ok: blocking.length === 0, deliveryTier, blocking, warnings });
  }

  if (capture.materials.length === 0) {
    blocking.push({
      id: "materials",
      code: "material_missing",
      message: "Digital viewing exports require at least one material record."
    });
  }

  const renderableHostIds = new Set(capture.modelElements.filter((element) => element.renderable).map((element) => element.id));

  if (deliveryTier === "premium-sales") {
    try {
      const presetReadiness = evaluateDigitalViewingCapturePreset(
        capture,
        getDigitalViewingCapturePreset(capture.assetType, deliveryTier)
      );
      for (const reason of presetReadiness.blocking) {
        if (isPremiumDeliveryCaptureAngleReason(reason)) {
          blocking.push({ id: reason.id, code: reason.code, message: reason.message });
        }
      }
    } catch (error) {
      blocking.push({
        id: `${capture.assetType}:${deliveryTier}`,
        code: "capture_preset_missing" as const,
        message: error instanceof Error ? error.message : "Premium delivery requires a defined domain capture preset."
      });
    }
    if (renderableHostIds.size === 0) {
      blocking.push({
        id: "model-elements",
        code: "model_element_registry_missing" as const,
        message: "Premium digital viewing requires declared renderable model elements for measurement, material, and condition host validation."
      });
    }
    for (const photo of capture.photos) {
      if (photo.verified && (photo.pixelWidth === undefined || photo.pixelHeight === undefined)) {
        blocking.push({
          id: photo.path,
          code: "photo_resolution_missing" as const,
          message: "Premium verified reference photos must declare pixelWidth and pixelHeight so bundled image evidence can be validated."
        });
      }
    }
    for (const measurement of capture.measurements) {
      if (measurement.tolerance === undefined) {
        blocking.push({
          id: measurement.id,
          code: "measurement_tolerance_missing" as const,
          message: "Premium geometry measurements must declare tolerance in the measurement unit so customer-facing dimensions do not imply false precision."
        });
      }
      if (!measurement.placement) {
        blocking.push({
          id: measurement.id,
          code: "measurement_placement_missing" as const,
          message: "Premium geometry measurements must include model placement so dimensions remain traceable to the renderable asset."
        });
      } else if (!renderableHostIds.has(measurement.placement.hostElementId)) {
        blocking.push({
          id: measurement.id,
          code: "measurement_host_unknown" as const,
          message: "Premium measurement placement must reference a declared renderable model element."
        });
      }
    }
  }

  for (const material of capture.materials) {
    if (!material.hostElementId) {
      blocking.push({
        id: material.materialId,
        code: "material_host_missing",
        message: "Material records must target a host element for standard and premium digital viewing exports."
      });
    } else if (deliveryTier === "premium-sales" && !renderableHostIds.has(material.hostElementId)) {
      blocking.push({
        id: material.materialId,
        code: "material_host_unknown" as const,
        message: "Premium material host must reference a declared renderable model element."
      });
    }
    if (!material.presetId && deliveryTier === "premium-sales") {
      blocking.push({
        id: material.materialId,
        code: "material_preset_missing",
        message: "Premium sales delivery requires a domain material preset so PBR defaults are explicit and reproducible."
      });
    }
    if (deliveryTier === "premium-sales" && material.provenance === "photo_observed" && !material.appearanceCalibration) {
      blocking.push({
        id: material.materialId,
        code: "material_appearance_calibration_missing" as const,
        message: "Premium photo-observed materials must declare appearance calibration so color and finish are reproducible."
      });
    } else if (deliveryTier === "premium-sales" && material.provenance === "photo_observed" && !hasAppearanceCalibrationIlluminant(material)) {
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
        message: "Premium materials must declare surface mapping so texture placement is reproducible in Blender."
      });
    } else if (
      deliveryTier === "premium-sales"
      && material.surfaceMapping?.sourcePhoto
      && !isVerifiedMaterialPlacementPhotoForMaterial(material, photosByPath.get(material.surfaceMapping.sourcePhoto))
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
        message: "Premium material source photos must match the material category when photo categories are declared."
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
    if (material.textureMaps.length === 0) {
      const reason = {
        id: material.materialId,
        code: "texture_evidence_missing" as const,
        message: "Material has no texture-map evidence."
      };
      if (deliveryTier === "premium-sales") {
        blocking.push(reason);
      } else {
        warnings.push(reason);
      }
    }
    for (const textureMap of material.textureMaps) {
      if (textureMap.provenance === "photo_observed" && !textureMap.sourcePhoto) {
        const reason = {
          id: `${material.materialId}:${textureMap.type}`,
          code: "texture_source_missing" as const,
          message: "Photo-observed texture maps require a source photo for premium sales delivery."
        };
        if (deliveryTier === "premium-sales") {
          blocking.push(reason);
        }
      }
    }
  }

  const declaredMaterialSurfaces = new Set(
    capture.materials
      .filter((material) => material.provenance !== "unknown" && material.photoSources.length > 0)
      .flatMap((material) => material.materialSurfaces)
  );
  const materialCategoryBySurface = new Map(
    capture.materials
      .filter((material) => material.provenance !== "unknown" && material.photoSources.length > 0)
      .flatMap((material) =>
        material.materialSurfaces.map((surface) => [surface, material.category] as const)
      )
  );
  const materialMappingFacesBySurface = new Map(
    capture.materials
      .filter((material) => material.provenance !== "unknown" && material.photoSources.length > 0 && material.surfaceMapping)
      .flatMap((material) =>
        material.materialSurfaces.map((surface) => [surface, material.surfaceMapping?.faces ?? []] as const)
      )
  );

  for (const condition of capture.conditions) {
    if (condition.verification === "verified" && !condition.surfacePlacement) {
      const reason = {
        id: condition.id,
        code: "condition_placement_missing" as const,
        message: "Verified condition evidence should include surface placement so visible defects can be rendered and reviewed."
      };
      if (deliveryTier === "premium-sales") {
        blocking.push(reason);
      } else {
        warnings.push(reason);
      }
    }
    if (deliveryTier === "premium-sales" && condition.surfacePlacement && !renderableHostIds.has(condition.surfacePlacement.hostElementId)) {
      blocking.push({
        id: condition.id,
        code: "condition_host_unknown" as const,
        message: "Premium condition placement must reference a declared renderable model element."
      });
    }
    if (deliveryTier === "premium-sales" && condition.verification === "verified") {
      if (!condition.materialSurface) {
        blocking.push({
          id: condition.id,
          code: "condition_material_surface_missing" as const,
          message: "Premium verified condition evidence must bind to a declared material surface so defects render on the correct finish."
        });
      } else if (!declaredMaterialSurfaces.has(condition.materialSurface)) {
        blocking.push({
          id: `${condition.id}:${condition.materialSurface}`,
          code: "condition_material_surface_unknown" as const,
          message: "Premium verified condition evidence must reference a material surface declared by a source-backed material record."
        });
      }
      const mappedFaces = condition.materialSurface
        ? materialMappingFacesBySurface.get(condition.materialSurface)
        : undefined;
      if (condition.surfacePlacement && mappedFaces && !mappedFaces.includes(condition.surfacePlacement.face)) {
        blocking.push({
          id: `${condition.id}:${condition.surfacePlacement.face}`,
          code: "condition_surface_face_unmapped" as const,
          message: "Premium condition placement face must be covered by the bound material surface mapping so defects render on the correct visible side."
        });
      }
      if (condition.surfacePlacement) {
        for (const photoSource of condition.photoSources) {
          const photo = photosByPath.get(photoSource);
          if (
            photo
            && isMappedExteriorFaceSector(photo.sector)
            && photo.sector !== condition.surfacePlacement.face
          ) {
            blocking.push({
              id: `${condition.id}:${photo.sector}`,
              code: "condition_source_photo_face_mismatch" as const,
              message: "Premium exterior condition source photo sector must match the condition placement face."
            });
          }
        }
      }
      if (
        condition.materialSurface
        && declaredMaterialSurfaces.has(condition.materialSurface)
        && condition.photoSources.some((photoSource) => {
          const photo = photosByPath.get(photoSource);
          return !isVerifiedConditionDetailPhoto(photo)
            && !isPhotoMaterialCategoryCompatibleWithSurface(condition.materialSurface, materialCategoryBySurface, photo);
        })
      ) {
        blocking.push({
          id: `${condition.id}:${condition.materialSurface}`,
          code: "condition_source_photo_material_category_mismatch" as const,
          message: "Premium condition source photos must match the material category of the defect surface when photo categories are declared."
        });
      }
      const hasVerifiedDetailPhoto = condition.photoSources.some((photoSource) =>
        isVerifiedConditionDetailPhoto(photosByPath.get(photoSource))
      );
      if (!hasVerifiedDetailPhoto) {
        blocking.push({
          id: condition.id,
          code: "condition_detail_photo_invalid" as const,
          message: "Premium verified condition evidence must reference a verified, unoccluded macro/detail condition photo."
        });
      } else {
        const hasMaterialCompatibleDetailPhoto = condition.photoSources.some((photoSource) => {
          const detailPhoto = photosByPath.get(photoSource);
          return isVerifiedConditionDetailPhoto(detailPhoto)
            && isPhotoMaterialCategoryCompatibleWithSurface(condition.materialSurface, materialCategoryBySurface, detailPhoto);
        });
        if (!hasMaterialCompatibleDetailPhoto) {
          blocking.push({
            id: `${condition.id}:${condition.materialSurface ?? "material-surface"}`,
            code: "condition_detail_photo_material_category_mismatch" as const,
            message: "Premium condition detail photos must explicitly match the material category of the defect surface."
          });
        }
        const hasHighResolutionDetailPhoto = condition.photoSources.some((photoSource) =>
          isHighResolutionConditionDetailPhoto(photosByPath.get(photoSource))
        );
        if (!hasHighResolutionDetailPhoto) {
          blocking.push({
            id: condition.id,
            code: "condition_detail_photo_resolution_too_low" as const,
            message: "Premium verified condition detail photos must be at least 1024 px on the shortest side so visible defects remain reviewable in customer output."
          });
        } else if (
          conditionSeverityRequiresDetailQuality(condition.severity)
          && !condition.photoSources.some((photoSource) =>
            hasPremiumConditionDetailQualityMetadata(photosByPath.get(photoSource))
          )
        ) {
          blocking.push({
            id: condition.id,
            code: "condition_detail_photo_quality_missing" as const,
            message: "Medium and high severity condition evidence must reference detail photos with scale, lighting, white balance, and exposure metadata."
          });
        }
      }
    }
  }

  return DigitalViewingDeliveryReadinessResultSchema.parse({ ok: blocking.length === 0, deliveryTier, blocking, warnings });
}
