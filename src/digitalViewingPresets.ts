import type { DigitalAssetType, DigitalViewingCaptureGuide, DigitalViewingCapturePreset, DigitalViewingPhoto } from "./digitalViewingContracts.js";
import {
  DigitalViewingCaptureGuideSchema,
  DigitalViewingCapturePresetReadinessResultSchema,
  DigitalViewingCapturePresetSchema,
  DigitalViewingCaptureSchema
} from "./digitalViewingContracts.js";

export const DigitalViewingCapturePresets = {
  "vehicle:draft-preview": {
    presetId: "vehicle-draft-preview",
    assetType: "vehicle",
    deliveryTier: "draft-preview",
    requiredSectors: ["front", "rear", "left", "right"],
    requiredMeasurements: ["overall-length", "overall-width", "overall-height"],
    requiredPhotoRoles: ["geometry_alignment", "material"],
    requiredMaterialCategories: ["paint"],
    requiredInspectionZones: [],
    conditionEvidenceRequired: false,
    textureEvidenceRequired: false
  },
  "vehicle:standard-viewing": {
    presetId: "vehicle-standard-viewing",
    assetType: "vehicle",
    deliveryTier: "standard-viewing",
    requiredSectors: ["front", "rear", "left", "right", "interior", "detail"],
    requiredMeasurements: ["overall-length", "overall-width", "overall-height", "wheelbase"],
    requiredPhotoRoles: ["geometry_alignment", "material", "condition"],
    requiredMaterialCategories: ["paint", "glass", "rubber", "metal", "leather"],
    requiredInspectionZones: [],
    conditionEvidenceRequired: false,
    textureEvidenceRequired: false
  },
  "vehicle:premium-sales": {
    presetId: "vehicle-premium-sales",
    assetType: "vehicle",
    deliveryTier: "premium-sales",
    requiredSectors: ["front", "rear", "left", "right", "interior", "detail"],
    requiredMeasurements: ["overall-length", "overall-width", "overall-height", "wheelbase"],
    requiredPhotoRoles: ["geometry_alignment", "material", "condition"],
    requiredMaterialCategories: ["paint", "glass", "rubber", "metal", "leather"],
    requiredInspectionZones: ["body", "glass", "wheels-tires", "interior"],
    conditionEvidenceRequired: true,
    textureEvidenceRequired: true
  },
  "boat:draft-preview": {
    presetId: "boat-draft-preview",
    assetType: "boat",
    deliveryTier: "draft-preview",
    requiredSectors: ["bow", "stern", "port", "starboard"],
    requiredMeasurements: ["loa", "beam", "draft"],
    requiredPhotoRoles: ["geometry_alignment", "material"],
    requiredMaterialCategories: ["gelcoat"],
    requiredInspectionZones: [],
    conditionEvidenceRequired: false,
    textureEvidenceRequired: false
  },
  "boat:standard-viewing": {
    presetId: "boat-standard-viewing",
    assetType: "boat",
    deliveryTier: "standard-viewing",
    requiredSectors: ["bow", "stern", "port", "starboard", "deck", "cabin", "detail"],
    requiredMeasurements: ["loa", "beam", "draft"],
    requiredPhotoRoles: ["geometry_alignment", "material", "condition"],
    requiredMaterialCategories: ["gelcoat", "glass", "metal", "fabric", "wood"],
    requiredInspectionZones: [],
    conditionEvidenceRequired: false,
    textureEvidenceRequired: false
  },
  "boat:premium-sales": {
    presetId: "boat-premium-sales",
    assetType: "boat",
    deliveryTier: "premium-sales",
    requiredSectors: ["bow", "stern", "port", "starboard", "deck", "cabin", "detail"],
    requiredMeasurements: ["loa", "beam", "draft"],
    requiredPhotoRoles: ["geometry_alignment", "material", "condition"],
    requiredMaterialCategories: ["gelcoat", "glass", "metal", "fabric", "wood"],
    requiredInspectionZones: ["hull", "deck", "fittings", "upholstery-canvas", "cabin"],
    conditionEvidenceRequired: true,
    textureEvidenceRequired: true
  },
  "property:draft-preview": {
    presetId: "property-draft-preview",
    assetType: "property",
    deliveryTier: "draft-preview",
    requiredSectors: ["north", "south", "east", "west"],
    requiredMeasurements: ["overall-width", "overall-depth", "overall-height"],
    requiredPhotoRoles: ["geometry_alignment", "material"],
    requiredMaterialCategories: ["wood"],
    requiredInspectionZones: [],
    conditionEvidenceRequired: false,
    textureEvidenceRequired: false
  },
  "property:standard-viewing": {
    presetId: "property-standard-viewing",
    assetType: "property",
    deliveryTier: "standard-viewing",
    requiredSectors: ["north", "south", "east", "west", "interior", "detail"],
    requiredMeasurements: ["overall-width", "overall-depth", "overall-height"],
    requiredPhotoRoles: ["geometry_alignment", "material", "condition"],
    requiredMaterialCategories: ["wood", "glass", "stone", "metal"],
    requiredInspectionZones: [],
    conditionEvidenceRequired: false,
    textureEvidenceRequired: false
  },
  "property:premium-sales": {
    presetId: "property-premium-sales",
    assetType: "property",
    deliveryTier: "premium-sales",
    requiredSectors: ["north", "south", "east", "west", "interior", "detail"],
    requiredMeasurements: ["overall-width", "overall-depth", "overall-height"],
    requiredPhotoRoles: ["geometry_alignment", "material", "condition"],
    requiredMaterialCategories: ["wood", "glass", "stone", "metal"],
    requiredInspectionZones: ["facade", "windows-doors", "masonry-foundation", "roof-fittings", "interior-finishes"],
    conditionEvidenceRequired: true,
    textureEvidenceRequired: true
  },
  "exterior-structure:draft-preview": {
    presetId: "exterior-structure-draft-preview",
    assetType: "exterior-structure",
    deliveryTier: "draft-preview",
    requiredSectors: ["north", "south", "east", "west"],
    requiredMeasurements: ["overall-width", "overall-depth", "overall-height"],
    requiredPhotoRoles: ["geometry_alignment", "material"],
    requiredMaterialCategories: ["wood"],
    requiredInspectionZones: [],
    conditionEvidenceRequired: false,
    textureEvidenceRequired: false
  },
  "exterior-structure:standard-viewing": {
    presetId: "exterior-structure-standard-viewing",
    assetType: "exterior-structure",
    deliveryTier: "standard-viewing",
    requiredSectors: ["north", "south", "east", "west", "detail"],
    requiredMeasurements: ["overall-width", "overall-depth", "overall-height", "roof-slope-percent"],
    requiredPhotoRoles: ["geometry_alignment", "material", "condition"],
    requiredMaterialCategories: ["wood", "stone"],
    requiredInspectionZones: [],
    conditionEvidenceRequired: false,
    textureEvidenceRequired: false
  },
  "exterior-structure:premium-sales": {
    presetId: "exterior-structure-premium-sales",
    assetType: "exterior-structure",
    deliveryTier: "premium-sales",
    requiredSectors: ["north", "south", "east", "west", "detail"],
    requiredMeasurements: ["overall-width", "overall-depth", "overall-height", "roof-slope-percent"],
    requiredPhotoRoles: ["geometry_alignment", "material", "condition"],
    requiredMaterialCategories: ["wood", "stone"],
    requiredInspectionZones: ["cladding", "openings", "foundation", "roof", "stairs"],
    conditionEvidenceRequired: true,
    textureEvidenceRequired: true
  },
  "product:draft-preview": {
    presetId: "product-draft-preview",
    assetType: "product",
    deliveryTier: "draft-preview",
    requiredSectors: ["front", "back", "left", "right", "top"],
    requiredMeasurements: ["overall-length", "overall-width", "overall-height"],
    requiredPhotoRoles: ["geometry_alignment", "material"],
    requiredMaterialCategories: [],
    requiredInspectionZones: [],
    conditionEvidenceRequired: false,
    textureEvidenceRequired: false
  },
  "product:standard-viewing": {
    presetId: "product-standard-viewing",
    assetType: "product",
    deliveryTier: "standard-viewing",
    requiredSectors: ["front", "back", "left", "right", "top", "detail"],
    requiredMeasurements: ["overall-length", "overall-width", "overall-height"],
    requiredPhotoRoles: ["geometry_alignment", "material", "condition"],
    requiredMaterialCategories: [],
    requiredInspectionZones: [],
    conditionEvidenceRequired: false,
    textureEvidenceRequired: false
  },
  "product:premium-sales": {
    presetId: "product-premium-sales",
    assetType: "product",
    deliveryTier: "premium-sales",
    requiredSectors: ["front", "back", "left", "right", "top", "detail"],
    requiredMeasurements: ["overall-length", "overall-width", "overall-height"],
    requiredPhotoRoles: ["geometry_alignment", "material", "condition"],
    requiredMaterialCategories: [],
    requiredInspectionZones: ["exterior-surfaces", "functional-elements"],
    conditionEvidenceRequired: false,
    textureEvidenceRequired: true
  }
} satisfies Record<string, DigitalViewingCapturePreset>;

export function getDigitalViewingCapturePreset(assetTypeInput: unknown, deliveryTierInput: unknown): DigitalViewingCapturePreset {
  const assetType = DigitalViewingCaptureSchema.shape.assetType.parse(assetTypeInput);
  const deliveryTier = DigitalViewingCapturePresetSchema.shape.deliveryTier.parse(deliveryTierInput);
  const key = `${assetType}:${deliveryTier}` as keyof typeof DigitalViewingCapturePresets;
  const preset = DigitalViewingCapturePresets[key];
  if (!preset) {
    throw new Error(`No digital viewing capture preset exists for ${assetType}:${deliveryTier}.`);
  }
  return DigitalViewingCapturePresetSchema.parse(preset);
}

export function listDigitalViewingCapturePresets(): DigitalViewingCapturePreset[] {
  return Object.values(DigitalViewingCapturePresets)
    .map((preset) => DigitalViewingCapturePresetSchema.parse(preset))
    .sort((left, right) => left.presetId.localeCompare(right.presetId));
}

export function buildDigitalViewingCaptureGuide(assetTypeInput: unknown, deliveryTierInput: unknown): DigitalViewingCaptureGuide {
  const preset = getDigitalViewingCapturePreset(assetTypeInput, deliveryTierInput);
  return DigitalViewingCaptureGuideSchema.parse({
    schemaVersion: 1,
    guideType: "digital-viewing-capture-guide",
    presetId: preset.presetId,
    assetType: preset.assetType,
    deliveryTier: preset.deliveryTier,
    sourceOfTruth: {
      measurements: "primary-geometry-truth",
      photos: "material-condition-context-reference",
      guide: "capture-instructions-no-geometry-inference"
    },
    requiredMeasurements: preset.requiredMeasurements,
    requiredMaterialCategories: preset.requiredMaterialCategories,
    requiredInspectionZones: preset.requiredInspectionZones,
    conditionEvidenceRequired: preset.conditionEvidenceRequired,
    textureEvidenceRequired: preset.textureEvidenceRequired,
    measurementChecklist: preset.requiredMeasurements.map((measurementId) => buildMeasurementChecklistItem(preset, measurementId)),
    materialChecklist: preset.requiredMaterialCategories.map((category) => buildMaterialChecklistItem(preset, category)),
    inspectionChecklist: preset.requiredInspectionZones.map((zone) => buildInspectionChecklistItem(preset, zone)),
    shotList: preset.requiredSectors.map((sector) => buildShotInstruction(preset, sector)),
    invariants: [
      "Measurements define geometry, scale, and placement.",
      "Photos provide material, condition, context, and validation evidence only.",
      "Missing geometry measurements must block model lock or delivery instead of being inferred from photos.",
      "Texture and condition evidence must keep provenance to source photos."
    ]
  });
}

function buildMeasurementChecklistItem(
  preset: DigitalViewingCapturePreset,
  measurementId: string
): DigitalViewingCaptureGuide["measurementChecklist"][number] {
  const placementRequired = preset.deliveryTier === "premium-sales";
  return {
    measurementId,
    required: true,
    geometryAuthority: true,
    verificationRequired: true,
    placementRequired,
    unit: measurementUnitForId(measurementId),
    instructions: [
      `Measure ${measurementId} from the physical asset or verified drawing before geometry lock.`,
      placementRequired
        ? "Attach the measurement to a renderable host, axis, endpoints, and reference frame."
        : "Keep the measurement verified; placement is recommended when the output becomes premium."
    ]
  };
}

function measurementUnitForId(measurementId: string): "mm" | "deg" | "percent" {
  if (measurementId.includes("slope") || measurementId.includes("percent")) {
    return "percent";
  }
  return "mm";
}

function buildMaterialChecklistItem(
  preset: DigitalViewingCapturePreset,
  category: DigitalViewingCaptureGuide["materialChecklist"][number]["category"]
): DigitalViewingCaptureGuide["materialChecklist"][number] {
  const premium = preset.deliveryTier === "premium-sales";
  const requiredMaps = premium ? requiredTextureMapsForCategory(category) : [];
  const captureQualityProfile = materialCaptureQualityProfileFor(preset.assetType, category);
  return {
    category,
    required: true,
    textureEvidenceRequired: preset.textureEvidenceRequired,
    surfaceMappingRequired: premium,
    appearanceCalibrationRequired: premium,
    requiredMaps,
    materialSurfaces: materialSurfacesForCategory(preset.assetType, category),
    captureQualityProfile,
    instructions: [
      `Capture and declare ${category} material evidence before rendering.`,
      `Capture these domain-critical ${category} surfaces: ${materialSurfacesForCategory(preset.assetType, category).join(", ")}.`,
      premium
        ? `Premium output requires ${requiredMaps.join(", ") || "no"} texture-map evidence plus surface mapping and appearance calibration.`
        : "Texture-map evidence is recommended for better visual fidelity, but this tier may proceed with warnings.",
      premium
        ? `Premium material photos must satisfy this capture quality profile: ${captureQualityProfile.join(", ")}.`
        : "Capture quality profile is advisory until this capture is upgraded to premium.",
      premium
        ? "Appearance calibration source photos must include lightingReference and colorReference metadata for reproducible Blender material rendering."
        : "Lighting and color references improve material matching when this capture is upgraded later."
    ]
  };
}

function requiredTextureMapsForCategory(
  category: DigitalViewingCaptureGuide["materialChecklist"][number]["category"]
): DigitalViewingCaptureGuide["materialChecklist"][number]["requiredMaps"] {
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
      return [];
  }
}

function materialSurfacesForCategory(
  assetType: DigitalAssetType,
  category: DigitalViewingCaptureGuide["materialChecklist"][number]["category"]
): string[] {
  const surfacesByAssetType: Partial<Record<DigitalAssetType, Partial<Record<typeof category, string[]>>>> = {
    vehicle: {
      paint: ["body-panels", "bumpers"],
      glass: ["windshield", "side-windows", "rear-window"],
      rubber: ["tires", "window-seals"],
      metal: ["wheels", "trim", "badges"],
      leather: ["seats", "steering-wheel"]
    },
    boat: {
      gelcoat: ["hull", "deck"],
      glass: ["windscreen", "portlights"],
      metal: ["rails", "cleats", "fittings"],
      fabric: ["upholstery", "canvas"],
      wood: ["deck-trim", "interior-joinery"]
    },
    property: {
      wood: ["cladding", "trim", "doors"],
      glass: ["windows", "glazed-doors"],
      stone: ["foundation", "masonry", "paving"],
      metal: ["gutters", "railings", "fittings"]
    },
    "exterior-structure": {
      wood: ["cladding", "posts", "fascia", "stairs"],
      stone: ["foundation-wall", "retaining-wall", "steps"]
    },
    product: {},
    custom: {}
  };
  return surfacesByAssetType[assetType]?.[category] ?? [category];
}

function materialCaptureQualityProfileFor(
  assetType: DigitalAssetType,
  category: DigitalViewingCaptureGuide["materialChecklist"][number]["category"]
): DigitalViewingCaptureGuide["materialChecklist"][number]["captureQualityProfile"] {
  const defaultProfile: DigitalViewingCaptureGuide["materialChecklist"][number]["captureQualityProfile"] = [
    "full-sector-or-surface",
    "white-balance-required",
    "exposure-required"
  ];
  const reflectiveProfile: DigitalViewingCaptureGuide["materialChecklist"][number]["captureQualityProfile"] = [
    "full-sector-or-surface",
    "reflection-angle-required",
    "white-balance-required",
    "exposure-required"
  ];
  const texturedProfile: DigitalViewingCaptureGuide["materialChecklist"][number]["captureQualityProfile"] = [
    "full-sector-or-surface",
    "raking-light-recommended",
    "white-balance-required",
    "exposure-required"
  ];
  if (assetType === "vehicle" && category === "paint") {
    return [
      "full-sector-or-surface",
      "cross-polarization-recommended",
      "white-balance-required",
      "exposure-required",
      "glare-control-required"
    ];
  }
  if (assetType === "boat" && category === "gelcoat") {
    return [
      "full-sector-or-surface",
      "cross-polarization-recommended",
      "white-balance-required",
      "exposure-required",
      "glare-control-required"
    ];
  }
  if (category === "glass" || category === "metal") {
    return reflectiveProfile;
  }
  if (category === "wood" || category === "fabric" || category === "leather" || category === "stone") {
    return texturedProfile;
  }
  return defaultProfile;
}

function buildInspectionChecklistItem(
  preset: DigitalViewingCapturePreset,
  zone: string
): DigitalViewingCaptureGuide["inspectionChecklist"][number] {
  const conditionCaptureQualityProfile = conditionCaptureQualityProfileFor(preset.deliveryTier);
  return {
    zone,
    required: true,
    allowedStatuses: ["clear", "defect-found"],
    sourcePhotosRequired: preset.deliveryTier === "premium-sales",
    conditionEvidenceRequiredWhenDefectFound: preset.conditionEvidenceRequired,
    conditionCaptureQualityProfile,
    instructions: [
      `Inspect ${zone} and mark it clear or defect-found from verified source photos.`,
      "If a defect is found, link it to verified condition evidence before premium output.",
      preset.deliveryTier === "premium-sales"
        ? `Premium defect evidence must satisfy this condition capture quality profile: ${conditionCaptureQualityProfile.join(", ")}.`
        : "Condition capture quality profile is advisory until this capture is upgraded to premium."
    ]
  };
}

function conditionCaptureQualityProfileFor(
  deliveryTier: DigitalViewingCapturePreset["deliveryTier"]
): DigitalViewingCaptureGuide["inspectionChecklist"][number]["conditionCaptureQualityProfile"] {
  const baseProfile: DigitalViewingCaptureGuide["inspectionChecklist"][number]["conditionCaptureQualityProfile"] = [
    "macro-detail-required",
    "condition-detail-coverage-required",
    "min-short-side-1024px",
    "surface-placement-required",
    "material-surface-binding-required"
  ];
  if (deliveryTier !== "premium-sales") {
    return baseProfile;
  }
  return [
    ...baseProfile,
    "medium-high-scale-required",
    "medium-high-lighting-required",
    "medium-high-white-balance-required",
    "medium-high-exposure-required"
  ];
}

export function evaluateDigitalViewingCapturePreset(input: unknown, presetInput: unknown) {
  const capture = DigitalViewingCaptureSchema.parse(input);
  const preset = DigitalViewingCapturePresetSchema.parse(presetInput);
  const blocking = [];
  const warnings = [];

  if (capture.assetType !== preset.assetType) {
    blocking.push({
      id: capture.assetType,
      code: "asset_type_mismatch",
      message: "Capture asset type does not match the requested domain capture preset."
    });
  }

  for (const sector of preset.requiredSectors) {
    if (!capture.photos.some((photo) => photo.sector === sector && photo.verified)) {
      blocking.push({
        id: `sector-${sector}`,
        code: "required_sector_missing",
        message: "Required preset photo sector is missing or unverified."
      });
    }
  }

  for (const role of preset.requiredPhotoRoles) {
    if (!capture.photos.some((photo) => photo.role === role && photo.verified)) {
      blocking.push({
        id: `photo-role-${role}`,
        code: "required_photo_role_missing",
        message: "Required preset photo role is missing or unverified."
      });
    }
  }

  for (const measurementId of preset.requiredMeasurements) {
    const measurement = capture.measurements.find((item) => item.id === measurementId);
    if (!measurement) {
      blocking.push({
        id: measurementId,
        code: "required_measurement_missing",
        message: "Required preset measurement is missing."
      });
    } else if (!measurement.verified) {
      blocking.push({
        id: measurementId,
        code: "required_measurement_unverified",
        message: "Required preset measurement must be verified."
      });
    }
  }

  for (const category of preset.requiredMaterialCategories) {
    if (!capture.materials.some((material) => material.category === category && material.provenance !== "unknown")) {
      blocking.push({
        id: `material-${category}`,
        code: "required_material_category_missing",
        message: "Required preset material category is missing."
      });
    }
  }

  if (preset.deliveryTier === "premium-sales") {
    const verifiedPhotosByPath = new Map(capture.photos.filter((photo) => photo.verified).map((photo) => [photo.path, photo]));
    for (const checklistItem of buildDigitalViewingCaptureGuide(preset.assetType, preset.deliveryTier).materialChecklist) {
      for (const surface of checklistItem.materialSurfaces) {
        const matchingMaterials = capture.materials.filter((material) =>
          material.category === checklistItem.category &&
          material.provenance !== "unknown" &&
          material.materialSurfaces.includes(surface) &&
          material.photoSources.length > 0
        );
        const hasVerifiedSurfaceEvidence = matchingMaterials.some((material) =>
          material.photoSources.every((sourcePhoto) => verifiedPhotosByPath.has(sourcePhoto))
        );
        if (!hasVerifiedSurfaceEvidence) {
          blocking.push({
            id: `material-surface-${checklistItem.category}-${surface}`,
            code: "required_material_surface_missing",
            message: "Required domain material surface is missing verified material evidence."
          });
          continue;
        }
        const hasMaterialCategoryEvidence = matchingMaterials.some((material) =>
          material.photoSources.every((sourcePhoto) => {
            const categories = verifiedPhotosByPath.get(sourcePhoto)?.captureMetadata?.materialCategories;
            return !categories || categories.length === 0 || categories.includes(checklistItem.category);
          })
        );
        if (!hasMaterialCategoryEvidence) {
          blocking.push({
            id: `material-source-${checklistItem.category}-${surface}`,
            code: "material_source_photo_material_category_mismatch",
            message: "Premium material source photos must match the material category when photo categories are declared."
          });
          continue;
        }
        const hasCaptureQualityEvidence = matchingMaterials.some((material) =>
          material.photoSources.every((sourcePhoto) => {
            const photo = verifiedPhotosByPath.get(sourcePhoto);
            return photo ? photoSatisfiesMaterialCaptureQualityProfile(photo, checklistItem.captureQualityProfile) : false;
          })
        );
        if (!hasCaptureQualityEvidence) {
          blocking.push({
            id: `material-quality-${checklistItem.category}-${surface}`,
            code: "material_capture_quality_missing",
            message: "Premium material evidence must satisfy the domain capture quality profile for reproducible Blender material rendering."
          });
        }
      }
    }
  }

  const hasTextureEvidence = capture.materials.some((material) => material.textureMaps.length > 0);
  if (preset.textureEvidenceRequired && !hasTextureEvidence) {
    blocking.push({
      id: "texture-evidence",
      code: "texture_evidence_missing",
      message: "This preset requires at least one source-backed texture map."
    });
  } else if (!hasTextureEvidence) {
    warnings.push({
      id: "texture-evidence",
      code: "texture_evidence_missing",
      message: "No texture-map evidence is present; visual material realism will be limited."
    });
  }

  const hasConditionEvidence = capture.conditions.some((condition) => condition.verification === "verified");
  if (preset.conditionEvidenceRequired && !hasConditionEvidence) {
    blocking.push({
      id: "condition-evidence",
      code: "condition_evidence_missing",
      message: "This preset requires verified condition evidence so defects and wear can be represented."
    });
  } else if (!hasConditionEvidence) {
    warnings.push({
      id: "condition-evidence",
      code: "condition_evidence_missing",
      message: "No verified condition evidence is present; defects and wear may be underrepresented."
    });
  }

  if (preset.deliveryTier === "premium-sales") {
    const verifiedPhotosByPath = new Map(capture.photos.filter((photo) => photo.verified).map((photo) => [photo.path, photo]));
    const verifiedPhotoPaths = new Set(verifiedPhotosByPath.keys());
    const verifiedConditionIds = new Set(capture.conditions.filter((condition) => condition.verification === "verified").map((condition) => condition.id));
    const verifiedConditionPlacementFacesById = new Map(
      capture.conditions
        .filter((condition) => condition.verification === "verified" && condition.surfacePlacement)
        .map((condition) => [condition.id, condition.surfacePlacement?.face])
    );
    for (const zone of preset.requiredInspectionZones) {
      const inspection = capture.conditionInspections.find((item) => item.zone === zone);
      if (!inspection) {
        blocking.push({
          id: `inspection-zone-${zone}`,
          code: "required_inspection_zone_missing",
          message: "Required inspection zone must be verified with source photos before premium output."
        });
        continue;
      }
      if (!inspection.verified || inspection.status === "not-inspected") {
        blocking.push({
          id: `inspection-zone-${zone}`,
          code: "inspection_zone_unverified",
          message: "Required inspection zone must be marked verified and cannot remain not-inspected."
        });
      }
      if (inspection.sourcePhotos.length === 0) {
        blocking.push({
          id: `inspection-zone-${zone}`,
          code: "inspection_source_missing",
          message: "Required inspection zone must reference at least one source photo."
        });
      }
      if (inspection.sourcePhotos.some((sourcePhoto) => !verifiedPhotoPaths.has(sourcePhoto))) {
        blocking.push({
          id: `inspection-zone-${zone}`,
          code: "inspection_source_photo_invalid",
          message: "Inspection zone source photos must reference verified capture photos."
        });
      }
      const materialCategory = inspection.materialCategory;
      if (
        materialCategory
        && inspection.sourcePhotos.some((sourcePhoto) => {
          const categories = verifiedPhotosByPath.get(sourcePhoto)?.captureMetadata?.materialCategories;
          return categories && categories.length > 0 && !categories.includes(materialCategory);
        })
      ) {
        blocking.push({
          id: `inspection-zone-${zone}`,
          code: "inspection_source_photo_material_category_mismatch",
          message: "Inspection zone source photos must match the inspection material category when categories are declared."
        });
      }
      const linkedConditionFaces = new Set(
        inspection.conditionIds
          .map((conditionId) => verifiedConditionPlacementFacesById.get(conditionId))
          .filter((face): face is NonNullable<typeof face> => Boolean(face))
      );
      if (linkedConditionFaces.size > 0) {
        for (const sourcePhoto of inspection.sourcePhotos) {
          const photo = verifiedPhotosByPath.get(sourcePhoto);
          if (photo && isMappedExteriorFaceSector(photo.sector) && !linkedConditionFaces.has(photo.sector)) {
            blocking.push({
              id: `inspection-zone-${zone}:${photo.sector}`,
              code: "inspection_source_photo_face_mismatch",
              message: "Inspection source photos for linked conditions must match the verified condition placement face."
            });
          }
        }
      }
      if (
        inspection.status === "defect-found" &&
        (inspection.conditionIds.length === 0 || inspection.conditionIds.some((conditionId) => !verifiedConditionIds.has(conditionId)))
      ) {
        blocking.push({
          id: `inspection-zone-${zone}`,
          code: "inspection_condition_evidence_missing",
          message: "Defect-found inspection zones must link to verified condition evidence."
        });
      }
    }

    for (const shot of buildDigitalViewingCaptureGuide(preset.assetType, preset.deliveryTier).shotList) {
      const photo = capture.photos.find((item) => item.sector === shot.sector && item.verified && shot.requiredRoles.includes(item.role));
      if (!photo) {
        continue;
      }
      if (!photo.captureMetadata) {
        blocking.push({
          id: photo.path,
          code: "photo_capture_metadata_missing",
          message: "Premium capture photos must record angle, camera, coverage, and occlusion metadata from the capture guide."
        });
        continue;
      }
      if (photo.captureMetadata.angleType !== shot.captureRequirements.angleType) {
        blocking.push({
          id: photo.path,
          code: "photo_angle_mismatch",
          message: `Photo angle type must be ${shot.captureRequirements.angleType} for this capture sector.`
        });
      }
      if (photo.captureMetadata.cameraMode !== shot.captureRequirements.cameraMode) {
        blocking.push({
          id: photo.path,
          code: "photo_camera_mode_mismatch",
          message: `Photo camera mode must be ${shot.captureRequirements.cameraMode} for this capture sector.`
        });
      }
      if (
        typeof shot.captureRequirements.targetYawDeg === "number" &&
        typeof shot.captureRequirements.yawToleranceDeg === "number" &&
        (typeof photo.captureMetadata.yawDeg !== "number" || angularDifference(photo.captureMetadata.yawDeg, shot.captureRequirements.targetYawDeg) > shot.captureRequirements.yawToleranceDeg)
      ) {
        blocking.push({
          id: photo.path,
          code: "photo_yaw_out_of_tolerance",
          message: `Photo yaw must be within ${shot.captureRequirements.yawToleranceDeg} degrees of ${shot.captureRequirements.targetYawDeg}.`
        });
      }
      if (shot.captureRequirements.angleType === "orthogonal") {
        if (typeof photo.captureMetadata.pitchDeg !== "number") {
          blocking.push({
            id: photo.path,
            code: "photo_pitch_missing",
            message: "Premium orthogonal reference photos must declare numeric pitchDeg for Blender camera execution validation."
          });
        } else if (
          typeof shot.captureRequirements.targetPitchDeg === "number"
          && typeof shot.captureRequirements.pitchToleranceDeg === "number"
          && Math.abs(photo.captureMetadata.pitchDeg - shot.captureRequirements.targetPitchDeg) > shot.captureRequirements.pitchToleranceDeg
        ) {
          blocking.push({
            id: photo.path,
            code: "photo_pitch_out_of_tolerance",
            message: `Photo pitch must be within ${shot.captureRequirements.pitchToleranceDeg} degrees of ${shot.captureRequirements.targetPitchDeg}.`
          });
        }
        if (
          typeof photo.captureMetadata.focalLength35mmEquivalent !== "number" ||
          typeof photo.captureMetadata.cameraDistanceMm !== "number"
        ) {
          blocking.push({
            id: photo.path,
            code: "photo_camera_calibration_missing",
            message: "Premium orthogonal reference photos must declare focalLength35mmEquivalent and cameraDistanceMm for Blender camera calibration."
          });
        }
      }
      if (photo.captureMetadata.coverage !== shot.captureRequirements.coverage) {
        blocking.push({
          id: photo.path,
          code: "photo_coverage_mismatch",
          message: `Photo coverage must be ${shot.captureRequirements.coverage} for this capture sector.`
        });
      }
      if (shot.captureRequirements.occlusionPolicy === "avoid" && photo.captureMetadata.occluded) {
        blocking.push({
          id: photo.path,
          code: "photo_occluded",
          message: "This capture shot must avoid occlusion; retake or record a different source photo."
        });
      }
      if (shot.captureRequirements.measuredEndpointsVisible && !photo.anchorsVisible) {
        blocking.push({
          id: photo.path,
          code: "photo_measured_endpoints_missing",
          message: "Measured endpoints, corners, openings, or scale references must be visible for this capture sector."
        });
      }
    }
  }

  return DigitalViewingCapturePresetReadinessResultSchema.parse({
    ok: blocking.length === 0,
    presetId: preset.presetId,
    blocking,
    warnings
  });
}

function photoSatisfiesMaterialCaptureQualityProfile(
  photo: DigitalViewingPhoto,
  profile: DigitalViewingCaptureGuide["materialChecklist"][number]["captureQualityProfile"]
): boolean {
  if (!photo.verified || photo.captureMetadata?.occluded) {
    return false;
  }
  if (profile.includes("full-sector-or-surface")) {
    const coverage = photo.captureMetadata?.coverage;
    if (coverage !== "full-sector" && coverage !== "material-surface" && coverage !== "full-object") {
      return false;
    }
  }
  if (profile.includes("white-balance-required") && typeof photo.captureMetadata?.whiteBalanceKelvin !== "number") {
    return false;
  }
  if (profile.includes("exposure-required") && typeof photo.captureMetadata?.exposureEv !== "number") {
    return false;
  }
  return true;
}

function buildShotInstruction(preset: DigitalViewingCapturePreset, sector: string): DigitalViewingCaptureGuide["shotList"][number] {
  const requiredRoles = rolesForSector(preset, sector);
  const purpose = purposeForRoles(requiredRoles);
  return {
    shotId: `${preset.assetType}-${preset.deliveryTier}-${sector}`,
    sector,
    requiredRoles,
    required: true,
    anchorsRecommended: requiredRoles.includes("geometry_alignment"),
    purpose,
    captureRequirements: captureRequirementsForShot(preset, sector, requiredRoles),
    instructions: instructionsForShot(preset, sector, requiredRoles)
  };
}

function rolesForSector(preset: DigitalViewingCapturePreset, sector: string): DigitalViewingCaptureGuide["shotList"][number]["requiredRoles"] {
  const roles: DigitalViewingCaptureGuide["shotList"][number]["requiredRoles"] = [];
  const hasRole = (role: DigitalViewingCaptureGuide["shotList"][number]["requiredRoles"][number]) => preset.requiredPhotoRoles.includes(role);
  const materialSectors = new Set(["interior", "deck", "cabin", "detail"]);
  if (sector === "detail") {
    if (hasRole("material")) {
      roles.push("material");
    }
    if (hasRole("condition")) {
      roles.push("condition");
    }
  } else if (materialSectors.has(sector)) {
    if (hasRole("material")) {
      roles.push("material");
    }
    if (hasRole("condition")) {
      roles.push("condition");
    }
  } else {
    if (hasRole("geometry_alignment")) {
      roles.push("geometry_alignment");
    }
    if (hasRole("material")) {
      roles.push("material");
    }
  }
  return roles.length > 0 ? roles : [preset.requiredPhotoRoles[0] ?? "context"];
}

function purposeForRoles(roles: DigitalViewingCaptureGuide["shotList"][number]["requiredRoles"]): DigitalViewingCaptureGuide["shotList"][number]["purpose"] {
  if (roles.includes("condition")) {
    return "condition-evidence";
  }
  if (roles.includes("geometry_alignment")) {
    return "geometry-alignment";
  }
  if (roles.includes("material")) {
    return "material-evidence";
  }
  return "context-review";
}

function instructionsForShot(
  preset: DigitalViewingCapturePreset,
  sector: string,
  roles: DigitalViewingCaptureGuide["shotList"][number]["requiredRoles"]
): string[] {
  const instructions = [`Capture the ${sector} sector without cropping the measured object.`];
  if (roles.includes("geometry_alignment")) {
    instructions.push("Keep measured endpoints, corners, openings, or scale references visible when possible.");
  }
  if (roles.includes("material")) {
    instructions.push(`Capture visible material categories for this preset: ${preset.requiredMaterialCategories.join(", ") || "none"}.`);
  }
  if (roles.includes("condition")) {
    instructions.push("Capture scratches, wear, dents, stains, repairs, seams, weathering, or other visible condition evidence close enough for review.");
  }
  if (preset.textureEvidenceRequired) {
    instructions.push("Capture surface detail suitable for texture/roughness/normal-map evidence without treating texture as geometry.");
  }
  return instructions;
}

function captureRequirementsForShot(
  preset: DigitalViewingCapturePreset,
  sector: string,
  roles: DigitalViewingCaptureGuide["shotList"][number]["requiredRoles"]
): DigitalViewingCaptureGuide["shotList"][number]["captureRequirements"] {
  if (sector === "detail") {
    return {
      angleType: "detail",
      cameraMode: "macro-detail",
      pitchGuidance: "surface-normal",
      lensGuidance: "macro-detail",
      coverage: roles.includes("condition") ? "condition-detail" : "material-surface",
      occlusionPolicy: "avoid",
      measuredEndpointsVisible: false,
      textureEvidenceRequired: preset.textureEvidenceRequired,
      notes: [
        "Capture close enough to author normal and roughness evidence.",
        "Do not use detail images to infer missing object dimensions."
      ]
    };
  }
  if (new Set(["interior", "deck", "cabin"]).has(sector)) {
    return {
      angleType: "interior",
      cameraMode: "perspective-reference",
      pitchGuidance: "level",
      lensGuidance: "normal-35-70mm-equivalent",
      coverage: "full-sector",
      occlusionPolicy: "document-if-unavoidable",
      measuredEndpointsVisible: roles.includes("geometry_alignment"),
      textureEvidenceRequired: preset.textureEvidenceRequired,
      notes: [
        "Use additional detail shots for texture and condition evidence.",
        "Keep visual scale references visible when they are part of the verified measurement contract."
      ]
    };
  }
  if (sector === "top") {
    return {
      angleType: "orthogonal",
      cameraMode: "orthographic-reference",
      targetPitchDeg: -90,
      pitchToleranceDeg: 8,
      pitchGuidance: "surface-normal",
      lensGuidance: "normal-35-70mm-equivalent",
      coverage: "full-object",
      occlusionPolicy: "avoid",
      measuredEndpointsVisible: roles.includes("geometry_alignment"),
      textureEvidenceRequired: preset.textureEvidenceRequired,
      notes: ["Capture directly overhead; do not label a level facade photo as the top sector."]
    };
  }
  return {
    angleType: "orthogonal",
    cameraMode: "orthographic-reference",
    targetYawDeg: yawForSector(sector),
    yawToleranceDeg: 12,
    targetPitchDeg: 0,
    pitchToleranceDeg: 0.5,
    pitchGuidance: "level",
    lensGuidance: "normal-35-70mm-equivalent",
    coverage: "full-object",
    occlusionPolicy: "avoid",
    measuredEndpointsVisible: roles.includes("geometry_alignment"),
    textureEvidenceRequired: preset.textureEvidenceRequired,
    notes: [
      "Stand as square to the measured face as the site allows.",
      "Avoid wide-angle distortion for geometry-alignment photos."
    ]
  };
}

function yawForSector(sector: string): number | undefined {
  switch (sector) {
    case "front":
    case "south":
    case "bow":
      return 0;
    case "right":
    case "east":
    case "starboard":
      return 90;
    case "rear":
    case "north":
    case "stern":
    case "back":
      return 180;
    case "left":
    case "west":
    case "port":
      return -90;
    default:
      return undefined;
  }
}

function angularDifference(left: number, right: number): number {
  return Math.abs((((left - right) % 360) + 540) % 360 - 180);
}

type ExteriorFaceSector = "front" | "rear" | "left" | "right" | "top" | "bottom";

function isMappedExteriorFaceSector(sector: string): sector is ExteriorFaceSector {
  return sector === "front"
    || sector === "rear"
    || sector === "left"
    || sector === "right"
    || sector === "top"
    || sector === "bottom";
}

export function requiredSectorsForAssetType(assetType: DigitalAssetType): string[] {
  switch (assetType) {
    case "vehicle":
      return ["front", "rear", "left", "right", "interior", "detail"];
    case "boat":
      return ["bow", "stern", "port", "starboard", "deck", "cabin", "detail"];
    case "property":
      return ["north", "south", "east", "west", "interior", "detail"];
    case "exterior-structure":
      return ["north", "south", "east", "west", "detail"];
    case "product":
      return ["front", "back", "left", "right", "top", "detail"];
    case "custom":
      return ["front", "back", "left", "right", "detail"];
  }
}
