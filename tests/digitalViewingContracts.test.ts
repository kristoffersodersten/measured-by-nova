import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as DigitalViewingExports from "../src/digitalViewingContracts.js";
import {
  buildDigitalViewingBlenderRenderJob,
  buildDigitalViewingCaptureGuide,
  buildDigitalViewingCaptureRepairSummary,
  buildDigitalViewingDeliveryPackageManifest,
  getDigitalViewingDeliveryProfile,
  listDigitalViewingDeliveryProfiles,
  buildDigitalViewingMaterialAuthoringPlan,
  buildDigitalViewingAssetBundleManifest,
  buildDigitalViewingMaterialConditionReport,
  buildDigitalViewingRenderManifest,
  DigitalViewingCaptureSchema,
  DigitalViewingAssetBundleManifestSchema,
  DigitalViewingBlenderRenderJobSchema,
  DigitalViewingDeliveryPackageManifestSchema,
  evaluateDigitalViewingDeliveryProfileReadiness,
  GenerateDigitalViewingDeliveryPackageInputSchema,
  GenerateDigitalViewingMaterialAuthoringPlanInputSchema,
  GenerateDigitalViewingMaterialReportInputSchema,
  RenderDigitalViewingPreviewInputSchema,
  DigitalViewingRenderManifestSchema,
  evaluateDigitalViewingDeliveryReadiness,
  evaluateDigitalViewingCapturePreset,
  getDigitalViewingCapturePreset,
  listDigitalViewingCapturePresets,
  requiredSectorsForAssetType,
  serializeDigitalViewingDeliveryPackageManifest,
  serializeDigitalViewingAssetBundleManifest,
  serializeDigitalViewingMaterialConditionReport,
  serializeDigitalViewingMaterialAuthoringPlan,
  validateDigitalViewingCapture
} from "../src/digitalViewingContracts.js";
import { DefaultCapabilityManifest } from "../src/capabilityManifest.js";

function loadVehicleCapture(): unknown {
  return JSON.parse(readFileSync("fixtures/digital-viewing-vehicle-capture.json", "utf8")) as unknown;
}

function loadCarportCapture(): unknown {
  return JSON.parse(readFileSync("fixtures/digital-viewing-carport-capture.json", "utf8")) as unknown;
}

function loadBoatCapture(): unknown {
  return JSON.parse(readFileSync("fixtures/digital-viewing-boat-capture.json", "utf8")) as unknown;
}

function loadPropertyCapture(): unknown {
  return JSON.parse(readFileSync("fixtures/digital-viewing-property-capture.json", "utf8")) as unknown;
}

const FullCarportAssetPaths = [
  "photos/carport-detail-panel.jpg",
  "photos/carport-east.jpg",
  "photos/carport-south.jpg",
  "photos/carport-west.jpg",
  "textures/carport-stone-foundation-normal.png",
  "textures/carport-stone-foundation-roughness.png",
  "textures/carport-white-panel-normal.png",
  "textures/carport-white-panel-roughness.png"
];

function assetFilesWithoutImageDimensionsFor(paths: string[]): Array<{ path: string; sizeBytes: number; sha256: string }> {
  return paths.map((assetPath, index) => ({
    path: assetPath,
    sizeBytes: 1024 + index,
    sha256: (index + 1).toString(16).padStart(64, "0")
  }));
}

function assetFilesFor(paths: string[]): Array<{ path: string; sizeBytes: number; sha256: string; width: number; height: number }> {
  return assetFilesWithoutImageDimensionsFor(paths).map((asset) => ({
    ...asset,
    width: asset.path.includes("detail") ? 2048 : 4096,
    height: asset.path.startsWith("textures/") ? 4096 : asset.path.includes("detail") ? 2048 : 3072
  }));
}

function assetFilesWithTextureDimensionMismatchFor(paths: string[]): Array<{ path: string; sizeBytes: number; sha256: string; width: number; height: number }> {
  return assetFilesFor(paths).map((asset) =>
    asset.path === "textures/carport-white-panel-normal.png"
      ? { ...asset, width: 2048, height: 2048 }
      : asset
  );
}

function assetFilesWithPhotoDimensionMismatchFor(paths: string[]): Array<{ path: string; sizeBytes: number; sha256: string; width: number; height: number }> {
  return assetFilesFor(paths).map((asset) =>
    asset.path === "photos/carport-south.jpg"
      ? { ...asset, width: 2048, height: 1536 }
      : asset
  );
}

function blenderMeasurementApplicationsFor(capture: ReturnType<typeof DigitalViewingCaptureSchema.parse>) {
  return capture.measurements.map((measurement) => ({
    measurementId: measurement.id,
    hostElementId: measurement.placement?.hostElementId ?? "carport",
    referenceFrame: measurement.placement?.referenceFrame ?? "asset-local",
    value: measurement.value,
    unit: measurement.unit,
    tolerance: measurement.tolerance,
    sourceOfTruth: "declared-measurement-value-used-by-blender" as const
  }));
}

function blenderMeasurementApplicationsWithoutValueProofFor(capture: ReturnType<typeof DigitalViewingCaptureSchema.parse>) {
  return capture.measurements.map((measurement) => ({
    measurementId: measurement.id,
    hostElementId: measurement.placement?.hostElementId ?? "carport",
    referenceFrame: measurement.placement?.referenceFrame ?? "asset-local"
  }));
}

function blenderTextureApplicationsFor(
  renderManifest: ReturnType<typeof DigitalViewingRenderManifestSchema.parse>,
  assetBundle?: ReturnType<typeof buildDigitalViewingAssetBundleManifest>
) {
  const assetsByPath = new Map(assetBundle?.assets.map((asset) => [asset.path, asset]) ?? []);
  return renderManifest.materials.flatMap((material) =>
    material.textureMaps.map((textureMap) => {
      const asset = assetsByPath.get(textureMap.path);
      return {
        path: textureMap.path,
        type: textureMap.type,
        colorSpace: textureMap.colorSpace,
        scaleMm: textureMap.scaleMm,
        pixelWidth: textureMap.pixelWidth,
        pixelHeight: textureMap.pixelHeight,
        ...(asset?.sizeBytes !== undefined ? { sizeBytes: asset.sizeBytes } : {}),
        ...(asset?.sha256 !== undefined ? { sha256: asset.sha256 } : {})
      };
    })
  );
}

function conditionSourcePhotoIdentitiesFor(
  capture: ReturnType<typeof DigitalViewingCaptureSchema.parse>,
  assetBundle: ReturnType<typeof buildDigitalViewingAssetBundleManifest>,
  conditionId: string
) {
  const condition = capture.conditions.find((item) => item.id === conditionId);
  const assetsByPath = new Map(assetBundle.assets.map((asset) => [asset.path, asset]));
  return (condition?.photoSources ?? []).map((photoPath) => {
    const asset = assetsByPath.get(photoPath);
    return {
      usage: "condition-source" as const,
      path: photoPath,
      ...(asset?.sizeBytes !== undefined ? { sizeBytes: asset.sizeBytes } : {}),
      ...(asset?.sha256 !== undefined ? { sha256: asset.sha256 } : {})
    };
  });
}

function withoutConditionSourceUsage(
  identities: ReturnType<typeof conditionSourcePhotoIdentitiesFor>
) {
  return identities.map((identity) => {
    const copy: Omit<typeof identity, "usage"> & { usage?: typeof identity.usage } = { ...identity };
    delete copy.usage;
    return copy;
  });
}

function materialSourcePhotoIdentitiesFor(
  renderManifest: ReturnType<typeof DigitalViewingRenderManifestSchema.parse>,
  assetBundle: ReturnType<typeof buildDigitalViewingAssetBundleManifest>,
  materialId: string
) {
  const material = renderManifest.materials.find((item) => item.materialId === materialId);
  const assetsByPath = new Map(assetBundle.assets.map((asset) => [asset.path, asset]));
  const entries = [
    ...(material?.photoSources ?? []).map((path) => ({ usage: "material-source" as const, path })),
    ...(material?.surfaceMapping?.sourcePhoto ? [{ usage: "surface-mapping" as const, path: material.surfaceMapping.sourcePhoto }] : []),
    ...(material?.appearanceCalibration?.sourcePhoto ? [{ usage: "appearance-calibration" as const, path: material.appearanceCalibration.sourcePhoto }] : [])
  ];
  return entries.map((entry) => {
    const asset = assetsByPath.get(entry.path);
    return {
      ...entry,
      ...(asset?.sizeBytes !== undefined ? { sizeBytes: asset.sizeBytes } : {}),
      ...(asset?.sha256 !== undefined ? { sha256: asset.sha256 } : {})
    };
  });
}

function photoIdentityFor(
  assetBundle: ReturnType<typeof buildDigitalViewingAssetBundleManifest>,
  photoPath: string
) {
  const asset = assetBundle.assets.find((item) => item.path === photoPath);
  return {
    path: photoPath,
    ...(asset?.sizeBytes !== undefined ? { sizeBytes: asset.sizeBytes } : {}),
    ...(asset?.sha256 !== undefined ? { sha256: asset.sha256 } : {})
  };
}

function carportCaptureWithDeclaredPhotoDimensions(width: number, height: number): unknown {
  const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
  return {
    ...capture,
    photos: capture.photos.map((photo) => ({
      ...photo,
      pixelWidth: width,
      pixelHeight: height
    }))
  };
}

describe("digital viewing capture contract", () => {
  it("exports the structural render-reference comparison threshold as a public product contract", () => {
    const exportedPolicy = DigitalViewingExports as typeof DigitalViewingExports & {
      MinimumStructuralReferenceComparisonThreshold?: number;
    };

    expect(exportedPolicy.MinimumStructuralReferenceComparisonThreshold).toBe(0.35);
  });

  it("accepts verified vehicle capture with source-backed materials and condition evidence", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const result = validateDigitalViewingCapture(capture);

    expect(capture.assetType).toBe("vehicle");
    expect(capture.modelElements.map((element) => element.id)).toEqual(["body", "wheel-axles", "front-seat", "front-left-door", "glazing", "tire-set"]);
    expect(result.ok).toBe(true);
    expect(result.blocking).toEqual([]);
    expect(result.warnings).toContainEqual({
      id: "photos-source-of-truth",
      code: "photo_not_authoritative",
      message: "Photos are material, condition, context, and validation evidence; they must not override verified measurements."
    });
  });

  it("blocks unverified geometry-impacting measurements", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const result = validateDigitalViewingCapture({
      ...capture,
      measurements: capture.measurements.map((measurement) =>
        measurement.id === "overall-width" ? { ...measurement, verified: false } : measurement
      )
    });

    expect(result.ok).toBe(false);
    expect(result.blocking).toContainEqual({
      id: "overall-width",
      code: "geometry_not_verified",
      message: "Geometry-impacting measurements must be verified before model lock or export."
    });
  });

  it("blocks premium sales delivery when geometry measurements lack model placement", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const result = evaluateDigitalViewingDeliveryReadiness({
      ...capture,
      measurements: capture.measurements.map((measurement) =>
        measurement.id === "overall-length" ? { ...measurement, placement: undefined } : measurement
      )
    }, "premium-sales");

    expect(result.ok).toBe(false);
    expect(result.blocking).toContainEqual({
      id: "overall-length",
      code: "measurement_placement_missing",
      message: "Premium geometry measurements must include model placement so dimensions remain traceable to the renderable asset."
    });
  });

  it("blocks premium sales delivery when geometry measurements lack tolerance", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const result = evaluateDigitalViewingDeliveryReadiness({
      ...capture,
      measurements: capture.measurements.map((measurement) => {
        if (measurement.id !== "overall-length") {
          return measurement;
        }
        const measurementWithoutTolerance = { ...measurement };
        delete measurementWithoutTolerance.tolerance;
        return measurementWithoutTolerance;
      })
    }, "premium-sales");

    expect(result.ok).toBe(false);
    expect(result.blocking).toContainEqual({
      id: "overall-length",
      code: "measurement_tolerance_missing",
      message: "Premium geometry measurements must declare tolerance in the measurement unit so customer-facing dimensions do not imply false precision."
    });
  });

  it("blocks premium sales delivery when a material host is not declared as a renderable model element", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const result = evaluateDigitalViewingDeliveryReadiness({
      ...capture,
      modelElements: capture.modelElements.filter((element) => element.id !== "front-seat")
    }, "premium-sales");

    expect(result.ok).toBe(false);
    expect(result.blocking).toContainEqual({
      id: "interior-leather",
      code: "material_host_unknown",
      message: "Premium material host must reference a declared renderable model element."
    });
  });

  it("blocks premium sales delivery when measurement placement references an unknown model element", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const result = evaluateDigitalViewingDeliveryReadiness({
      ...capture,
      modelElements: capture.modelElements.filter((element) => element.id !== "wheel-axles")
    }, "premium-sales");

    expect(result.ok).toBe(false);
    expect(result.blocking).toContainEqual({
      id: "wheelbase",
      code: "measurement_host_unknown",
      message: "Premium measurement placement must reference a declared renderable model element."
    });
  });

  it("blocks missing required sectors", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const result = validateDigitalViewingCapture({
      ...capture,
      photos: capture.photos.filter((photo) => photo.sector !== "interior")
    });

    expect(result.ok).toBe(false);
    expect(result.blocking).toContainEqual({
      id: "sector-interior",
      code: "required_sector_missing",
      message: "Required capture sector is missing."
    });
  });

  it("builds a deterministic repair summary from capture, delivery, and preset blocking reasons", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const incompleteCapture = {
      ...capture,
      photos: capture.photos.filter((photo) => photo.sector !== "interior")
    };
    const preset = getDigitalViewingCapturePreset(incompleteCapture.assetType, "premium-sales");
    const captureValidation = validateDigitalViewingCapture(incompleteCapture);
    const deliveryReadiness = evaluateDigitalViewingDeliveryReadiness(incompleteCapture, "premium-sales");
    const presetReadiness = evaluateDigitalViewingCapturePreset(incompleteCapture, preset);

    const summary = buildDigitalViewingCaptureRepairSummary([
      ...captureValidation.blocking,
      ...deliveryReadiness.blocking,
      ...presetReadiness.blocking
    ]);

    expect(summary).toEqual({
      ready: false,
      sections: [
        {
          section: "photos",
          blockingCount: 3,
          blockingIds: ["sector-interior", "sector-interior", "sector-interior"]
        },
        {
          section: "materials",
          blockingCount: 4,
          blockingIds: [
            "interior-leather:appearance-calibration",
            "interior-leather:surface-mapping",
            "material-surface-leather-seats",
            "material-surface-leather-steering-wheel"
          ]
        },
        {
          section: "inspections",
          blockingCount: 1,
          blockingIds: ["inspection-zone-interior"]
        }
      ]
    });
  });

  it("blocks photo-observed material without source photos", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const result = validateDigitalViewingCapture({
      ...capture,
      materials: capture.materials.map((material) =>
        material.materialId === "body-paint" ? { ...material, photoSources: [] } : material
      )
    });

    expect(result.ok).toBe(false);
    expect(result.blocking).toContainEqual({
      id: "body-paint",
      code: "material_source_missing",
      message: "Photo-observed materials must reference at least one source photo."
    });
  });

  it("blocks verified condition evidence without source photos", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const result = validateDigitalViewingCapture({
      ...capture,
      conditions: capture.conditions.map((condition) => ({ ...condition, photoSources: [] }))
    });

    expect(result.ok).toBe(false);
    expect(result.blocking).toContainEqual({
      id: "front-left-scratch",
      code: "condition_source_missing",
      message: "Condition evidence must reference at least one source photo when it is photo-based or verified."
    });
  });

  it("provides domain-specific default sector requirements", () => {
    expect(requiredSectorsForAssetType("vehicle")).toEqual(["front", "rear", "left", "right", "interior", "detail"]);
    expect(requiredSectorsForAssetType("boat")).toEqual(["bow", "stern", "port", "starboard", "deck", "cabin", "detail"]);
    expect(requiredSectorsForAssetType("property")).toEqual(["north", "south", "east", "west", "interior", "detail"]);
  });

  it("provides machine-readable capture presets for vehicle, boat, and property domains", () => {
    expect(getDigitalViewingCapturePreset("vehicle", "premium-sales")).toMatchObject({
      presetId: "vehicle-premium-sales",
      requiredSectors: ["front", "rear", "left", "right", "interior", "detail"],
      requiredMeasurements: ["overall-length", "overall-width", "overall-height", "wheelbase"],
      requiredMaterialCategories: ["paint", "glass", "rubber", "metal", "leather"],
      requiredInspectionZones: ["body", "glass", "wheels-tires", "interior"],
      conditionEvidenceRequired: true,
      textureEvidenceRequired: true
    });
    expect(getDigitalViewingCapturePreset("boat", "standard-viewing")).toMatchObject({
      presetId: "boat-standard-viewing",
      requiredSectors: ["bow", "stern", "port", "starboard", "deck", "cabin", "detail"],
      requiredMeasurements: ["loa", "beam", "draft"],
      requiredMaterialCategories: ["gelcoat", "glass", "metal", "fabric", "wood"]
    });
    expect(getDigitalViewingCapturePreset("boat", "premium-sales")).toMatchObject({
      presetId: "boat-premium-sales",
      requiredInspectionZones: ["hull", "deck", "fittings", "upholstery-canvas", "cabin"]
    });
    expect(getDigitalViewingCapturePreset("property", "draft-preview")).toMatchObject({
      presetId: "property-draft-preview",
      requiredSectors: ["north", "south", "east", "west"],
      requiredMeasurements: ["overall-width", "overall-depth", "overall-height"]
    });
    expect(getDigitalViewingCapturePreset("property", "premium-sales")).toMatchObject({
      presetId: "property-premium-sales",
      requiredSectors: ["north", "south", "east", "west", "interior", "detail"],
      requiredMeasurements: ["overall-width", "overall-depth", "overall-height"],
      requiredMaterialCategories: ["wood", "glass", "stone", "metal"],
      requiredInspectionZones: ["facade", "windows-doors", "masonry-foundation", "roof-fittings", "interior-finishes"]
    });
    expect(getDigitalViewingCapturePreset("exterior-structure", "premium-sales")).toMatchObject({
      presetId: "exterior-structure-premium-sales",
      requiredSectors: ["north", "south", "east", "west", "detail"],
      requiredMeasurements: ["overall-width", "overall-depth", "overall-height", "roof-slope-percent"],
      requiredMaterialCategories: ["wood", "stone"],
      requiredInspectionZones: ["cladding", "openings", "foundation", "roof", "stairs"],
      conditionEvidenceRequired: true,
      textureEvidenceRequired: true
    });
  });

  it("lists capture presets deterministically for MCP and UI surfaces", () => {
    const presets = listDigitalViewingCapturePresets();

    expect(presets.map((preset) => preset.presetId)).toEqual([
      "boat-draft-preview",
      "boat-premium-sales",
      "boat-standard-viewing",
      "exterior-structure-draft-preview",
      "exterior-structure-premium-sales",
      "exterior-structure-standard-viewing",
      "property-draft-preview",
      "property-premium-sales",
      "property-standard-viewing",
      "vehicle-draft-preview",
      "vehicle-premium-sales",
      "vehicle-standard-viewing"
    ]);
  });

  it("builds a deterministic vehicle premium capture guide", () => {
    const guide = buildDigitalViewingCaptureGuide("vehicle", "premium-sales");

    expect(guide).toMatchObject({
      schemaVersion: 1,
      guideType: "digital-viewing-capture-guide",
      presetId: "vehicle-premium-sales",
      assetType: "vehicle",
      deliveryTier: "premium-sales",
      sourceOfTruth: {
        measurements: "primary-geometry-truth",
        photos: "material-condition-context-reference",
      guide: "capture-instructions-no-geometry-inference"
      },
      requiredMeasurements: ["overall-length", "overall-width", "overall-height", "wheelbase"],
      requiredMaterialCategories: ["paint", "glass", "rubber", "metal", "leather"],
      requiredInspectionZones: ["body", "glass", "wheels-tires", "interior"],
      conditionEvidenceRequired: true,
      textureEvidenceRequired: true
    });
    expect(guide.shotList.map((shot) => [shot.sector, shot.requiredRoles, shot.anchorsRecommended])).toEqual([
      ["front", ["geometry_alignment", "material"], true],
      ["rear", ["geometry_alignment", "material"], true],
      ["left", ["geometry_alignment", "material"], true],
      ["right", ["geometry_alignment", "material"], true],
      ["interior", ["material", "condition"], false],
      ["detail", ["material", "condition"], false]
    ]);
    expect(guide.shotList.find((shot) => shot.sector === "front")?.captureRequirements).toMatchObject({
      angleType: "orthogonal",
      cameraMode: "orthographic-reference",
      targetYawDeg: 0,
      yawToleranceDeg: 12,
      pitchGuidance: "level",
      lensGuidance: "normal-35-70mm-equivalent",
      coverage: "full-object",
      occlusionPolicy: "avoid",
      measuredEndpointsVisible: true,
      textureEvidenceRequired: true
    });
    expect(guide.shotList.find((shot) => shot.sector === "detail")?.captureRequirements).toMatchObject({
      angleType: "detail",
      cameraMode: "macro-detail",
      pitchGuidance: "surface-normal",
      lensGuidance: "macro-detail",
      coverage: "condition-detail",
      measuredEndpointsVisible: false,
      textureEvidenceRequired: true
    });
    expect(guide.measurementChecklist.map((item) => [
      item.measurementId,
      item.required,
      item.geometryAuthority,
      item.verificationRequired,
      item.placementRequired,
      item.unit
    ])).toEqual([
      ["overall-length", true, true, true, true, "mm"],
      ["overall-width", true, true, true, true, "mm"],
      ["overall-height", true, true, true, true, "mm"],
      ["wheelbase", true, true, true, true, "mm"]
    ]);
    expect(guide.materialChecklist.map((item) => [
      item.category,
      item.required,
      item.textureEvidenceRequired,
      item.surfaceMappingRequired,
      item.appearanceCalibrationRequired,
      item.requiredMaps,
      item.materialSurfaces,
      item.captureQualityProfile
    ])).toEqual([
      ["paint", true, true, true, true, ["baseColor", "normal", "roughness"], ["body-panels", "bumpers"], ["full-sector-or-surface", "cross-polarization-recommended", "white-balance-required", "exposure-required", "glare-control-required"]],
      ["glass", true, true, true, true, ["alpha", "roughness"], ["windshield", "side-windows", "rear-window"], ["full-sector-or-surface", "reflection-angle-required", "white-balance-required", "exposure-required"]],
      ["rubber", true, true, true, true, ["normal", "roughness"], ["tires", "window-seals"], ["full-sector-or-surface", "white-balance-required", "exposure-required"]],
      ["metal", true, true, true, true, ["metallic", "normal", "roughness"], ["wheels", "trim", "badges"], ["full-sector-or-surface", "reflection-angle-required", "white-balance-required", "exposure-required"]],
      ["leather", true, true, true, true, ["normal", "roughness"], ["seats", "steering-wheel"], ["full-sector-or-surface", "raking-light-recommended", "white-balance-required", "exposure-required"]]
    ]);
    expect(guide.inspectionChecklist.map((item) => [
      item.zone,
      item.required,
      item.allowedStatuses,
      item.sourcePhotosRequired,
      item.conditionEvidenceRequiredWhenDefectFound,
      item.conditionCaptureQualityProfile
    ])).toEqual([
      ["body", true, ["clear", "defect-found"], true, true, ["macro-detail-required", "condition-detail-coverage-required", "min-short-side-1024px", "surface-placement-required", "material-surface-binding-required", "medium-high-scale-required", "medium-high-lighting-required", "medium-high-white-balance-required", "medium-high-exposure-required"]],
      ["glass", true, ["clear", "defect-found"], true, true, ["macro-detail-required", "condition-detail-coverage-required", "min-short-side-1024px", "surface-placement-required", "material-surface-binding-required", "medium-high-scale-required", "medium-high-lighting-required", "medium-high-white-balance-required", "medium-high-exposure-required"]],
      ["wheels-tires", true, ["clear", "defect-found"], true, true, ["macro-detail-required", "condition-detail-coverage-required", "min-short-side-1024px", "surface-placement-required", "material-surface-binding-required", "medium-high-scale-required", "medium-high-lighting-required", "medium-high-white-balance-required", "medium-high-exposure-required"]],
      ["interior", true, ["clear", "defect-found"], true, true, ["macro-detail-required", "condition-detail-coverage-required", "min-short-side-1024px", "surface-placement-required", "material-surface-binding-required", "medium-high-scale-required", "medium-high-lighting-required", "medium-high-white-balance-required", "medium-high-exposure-required"]]
    ]);
    expect(guide.invariants).toContain("Measurements define geometry, scale, and placement.");
  });

  it("builds a deterministic exterior-structure capture guide for carport-style capture", () => {
    const guide = buildDigitalViewingCaptureGuide("exterior-structure", "premium-sales");

    expect(guide.presetId).toBe("exterior-structure-premium-sales");
    expect(guide.requiredMeasurements).toEqual(["overall-width", "overall-depth", "overall-height", "roof-slope-percent"]);
    expect(guide.requiredMaterialCategories).toEqual(["wood", "stone"]);
    expect(guide.shotList.map((shot) => [shot.sector, shot.requiredRoles, shot.purpose])).toEqual([
      ["north", ["geometry_alignment", "material"], "geometry-alignment"],
      ["south", ["geometry_alignment", "material"], "geometry-alignment"],
      ["east", ["geometry_alignment", "material"], "geometry-alignment"],
      ["west", ["geometry_alignment", "material"], "geometry-alignment"],
      ["detail", ["material", "condition"], "condition-evidence"]
    ]);
    expect(guide.shotList.map((shot) => [shot.sector, shot.captureRequirements.targetYawDeg])).toEqual([
      ["north", 180],
      ["south", 0],
      ["east", 90],
      ["west", -90],
      ["detail", undefined]
    ]);
    expect(guide.shotList.find((shot) => shot.sector === "detail")?.instructions).toContain(
      "Capture surface detail suitable for texture/roughness/normal-map evidence without treating texture as geometry."
    );
    expect(guide.materialChecklist.map((item) => [item.category, item.materialSurfaces])).toEqual([
      ["wood", ["cladding", "posts", "fascia", "stairs"]],
      ["stone", ["foundation-wall", "retaining-wall", "steps"]]
    ]);
  });

  it("fails closed when a domain capture preset is not defined", () => {
    expect(() => getDigitalViewingCapturePreset("custom", "premium-sales")).toThrow(
      "No digital viewing capture preset exists for custom:premium-sales."
    );
  });

  it("accepts the vehicle fixture against the premium vehicle capture preset", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const preset = getDigitalViewingCapturePreset("vehicle", "premium-sales");
    const result = evaluateDigitalViewingCapturePreset(capture, preset);

    expect(result.ok).toBe(true);
    expect(result.blocking).toEqual([]);
  });

  it("blocks vehicle premium capture when required inspection zones are not verified", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const preset = getDigitalViewingCapturePreset("vehicle", "premium-sales");
    const result = evaluateDigitalViewingCapturePreset({
      ...capture,
      conditionInspections: []
    }, preset);

    expect(result.ok).toBe(false);
    expect(result.blocking).toContainEqual({
      id: "inspection-zone-body",
      code: "required_inspection_zone_missing",
      message: "Required inspection zone must be verified with source photos before premium output."
    });
  });

  it("blocks premium capture when a domain-critical material surface lacks verified material evidence", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const preset = getDigitalViewingCapturePreset("vehicle", "premium-sales");
    const missingBodyPanelSurface = evaluateDigitalViewingCapturePreset({
      ...capture,
      materials: capture.materials.map((material) =>
        material.materialId === "body-paint"
          ? {
            ...material,
            materialSurfaces: ["bumpers"]
          }
          : material
      )
    }, preset);

    expect(missingBodyPanelSurface.ok).toBe(false);
    expect(missingBodyPanelSurface.blocking).toContainEqual({
      id: "material-surface-paint-body-panels",
      code: "required_material_surface_missing",
      message: "Required domain material surface is missing verified material evidence."
    });
  });

  it("blocks premium capture when material evidence lacks the domain capture quality profile", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const preset = getDigitalViewingCapturePreset("vehicle", "premium-sales");
    const missingMaterialQualityMetadata = {
      ...capture,
      photos: capture.photos.map((photo) => {
        if (photo.path !== "photos/left.jpg" || !photo.captureMetadata) {
          return photo;
        }
        const captureMetadata = { ...photo.captureMetadata };
        delete captureMetadata.whiteBalanceKelvin;
        delete captureMetadata.exposureEv;
        return { ...photo, captureMetadata };
      })
    };

    const result = evaluateDigitalViewingCapturePreset(missingMaterialQualityMetadata, preset);

    expect(result.ok).toBe(false);
    expect(result.blocking).toContainEqual({
      id: "material-quality-paint-body-panels",
      code: "material_capture_quality_missing",
      message: "Premium material evidence must satisfy the domain capture quality profile for reproducible Blender material rendering."
    });
  });

  it("blocks premium capture when material source photos declare the wrong material category", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const preset = getDigitalViewingCapturePreset("vehicle", "premium-sales");
    const wrongMaterialSourceCategory = {
      ...capture,
      photos: capture.photos.map((photo) =>
        photo.path === "photos/front.jpg" && photo.captureMetadata
          ? {
              ...photo,
              captureMetadata: {
                ...photo.captureMetadata,
                materialCategories: ["glass" as const]
              }
          }
          : photo
      ),
      materials: capture.materials.map((material) =>
        material.materialId === "body-paint"
          ? { ...material, photoSources: ["photos/front.jpg"] }
          : material
      )
    };

    const result = evaluateDigitalViewingCapturePreset(wrongMaterialSourceCategory, preset);

    expect(result.ok).toBe(false);
    expect(result.blocking).toContainEqual({
      id: "material-source-paint-body-panels",
      code: "material_source_photo_material_category_mismatch",
      message: "Premium material source photos must match the material category when photo categories are declared."
    });
  });

  it("blocks premium inspection zones when source photos are not verified capture evidence", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const preset = getDigitalViewingCapturePreset("vehicle", "premium-sales");
    const result = evaluateDigitalViewingCapturePreset({
      ...capture,
      conditionInspections: capture.conditionInspections.map((inspection) =>
        inspection.zone === "glass" ? { ...inspection, sourcePhotos: ["photos/missing-glass.jpg"] } : inspection
      )
    }, preset);

    expect(result.ok).toBe(false);
    expect(result.blocking).toContainEqual({
      id: "inspection-zone-glass",
      code: "inspection_source_photo_invalid",
      message: "Inspection zone source photos must reference verified capture photos."
    });
  });

  it("blocks premium inspection zones when source photos declare the wrong material category", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const preset = getDigitalViewingCapturePreset("vehicle", "premium-sales");
    const result = evaluateDigitalViewingCapturePreset({
      ...capture,
      photos: capture.photos.map((photo) =>
        photo.path === "photos/front.jpg" && photo.captureMetadata
          ? {
              ...photo,
              captureMetadata: {
                ...photo.captureMetadata,
                materialCategories: ["paint" as const]
              }
            }
          : photo
      )
    }, preset);

    expect(result.ok).toBe(false);
    expect(result.blocking).toContainEqual({
      id: "inspection-zone-glass",
      code: "inspection_source_photo_material_category_mismatch",
      message: "Inspection zone source photos must match the inspection material category when categories are declared."
    });
  });

  it("blocks defect-found inspection zones without linked verified condition evidence", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const preset = getDigitalViewingCapturePreset("vehicle", "premium-sales");
    const result = evaluateDigitalViewingCapturePreset({
      ...capture,
      conditionInspections: capture.conditionInspections.map((inspection) =>
        inspection.zone === "body" ? { ...inspection, conditionIds: [] } : inspection
      )
    }, preset);

    expect(result.ok).toBe(false);
    expect(result.blocking).toContainEqual({
      id: "inspection-zone-body",
      code: "inspection_condition_evidence_missing",
      message: "Defect-found inspection zones must link to verified condition evidence."
    });
  });

  it("blocks premium inspection zones when linked condition source photos are from the wrong exterior face", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const preset = getDigitalViewingCapturePreset("vehicle", "premium-sales");
    const wrongInspectionFaceEvidence = {
      ...capture,
      conditionInspections: capture.conditionInspections.map((inspection) =>
        inspection.zone === "body"
          ? { ...inspection, sourcePhotos: ["photos/detail-scratch.jpg", "photos/right.jpg"] }
          : inspection
      )
    };

    const result = evaluateDigitalViewingCapturePreset(wrongInspectionFaceEvidence, preset);

    expect(result.ok).toBe(false);
    expect(result.blocking).toContainEqual({
      id: "inspection-zone-body:right",
      code: "inspection_source_photo_face_mismatch",
      message: "Inspection source photos for linked conditions must match the verified condition placement face."
    });
    expect(() => buildDigitalViewingRenderManifest(wrongInspectionFaceEvidence, {
      presetId: "studio-front-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1920, height: 1080 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 1 },
      outputPath: "renders/vehicle-front.png"
    })).toThrow("Cannot build render manifest for invalid capture preset: inspection_source_photo_face_mismatch");
  });

  it("accepts the carport fixture as an exterior-structure premium capture", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const validation = validateDigitalViewingCapture(capture);
    const preset = getDigitalViewingCapturePreset("exterior-structure", "premium-sales");
    const presetReadiness = evaluateDigitalViewingCapturePreset(capture, preset);
    const deliveryReadiness = evaluateDigitalViewingDeliveryReadiness(capture, "premium-sales");

    expect(validation.ok).toBe(true);
    expect(presetReadiness.ok).toBe(true);
    expect(deliveryReadiness.ok).toBe(true);
    expect(capture.conditionInspections.map((inspection) => [
      inspection.zone,
      inspection.status,
      inspection.verified,
      inspection.sourcePhotos
    ])).toEqual([
      ["cladding", "defect-found", true, ["photos/carport-detail-panel.jpg"]],
      ["foundation", "clear", true, ["photos/carport-south.jpg", "photos/carport-west.jpg"]],
      ["openings", "clear", true, ["photos/carport-north.jpg", "photos/carport-south.jpg"]],
      ["roof", "clear", true, ["photos/carport-south.jpg"]],
      ["stairs", "clear", true, ["photos/carport-south.jpg"]]
    ]);
    expect(capture.measurements.map((measurement) => measurement.id)).toEqual([
      "overall-width",
      "overall-depth",
      "overall-height",
      "low-side-height",
      "roof-slope-percent",
      "step-depth",
      "step-height",
      "neighbor-boundary-distance"
    ]);
    expect(capture.materials.map((material) => material.category)).toEqual(["wood", "stone"]);
    expect(capture.conditions.map((condition) => condition.type)).toEqual(["wear"]);
  });

  it("accepts numeric pitch metadata on verified reference photos", () => {
    const baseCapture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const capture = DigitalViewingCaptureSchema.parse({
      ...baseCapture,
      photos: baseCapture.photos.map((photo) =>
        photo.path === "photos/carport-south.jpg" && photo.captureMetadata
          ? { ...photo, captureMetadata: { ...photo.captureMetadata, pitchDeg: 0 } }
          : photo
      )
    });
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const packageManifest = buildDigitalViewingDeliveryPackageManifest(capture, renderManifest);

    expect(capture.photos.find((photo) => photo.path === "photos/carport-south.jpg")?.captureMetadata?.pitchDeg).toBe(0);
    expect(packageManifest.captureAngleCoverage.entries.find((entry) => entry.sector === "south")?.actual.pitchDeg).toBe(0);
  });

  it("blocks premium preset readiness when photo capture metadata does not satisfy the guide", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const preset = getDigitalViewingCapturePreset("exterior-structure", "premium-sales");
    const missingMetadata = evaluateDigitalViewingCapturePreset({
      ...capture,
      photos: capture.photos.map((photo) => photo.sector === "north" ? { ...photo, captureMetadata: undefined } : photo)
    }, preset);
    const wrongYaw = evaluateDigitalViewingCapturePreset({
      ...capture,
      photos: capture.photos.map((photo) =>
        photo.sector === "east" && photo.captureMetadata
          ? { ...photo, captureMetadata: { ...photo.captureMetadata, yawDeg: 30 } }
          : photo
      )
    }, preset);
    const missingPitch = evaluateDigitalViewingCapturePreset({
      ...capture,
      photos: capture.photos.map((photo) =>
        photo.sector === "south" && photo.captureMetadata
          ? { ...photo, captureMetadata: { ...photo.captureMetadata, pitchDeg: undefined } }
          : photo
      )
    }, preset);
    const wrongPitch = evaluateDigitalViewingCapturePreset({
      ...capture,
      photos: capture.photos.map((photo) =>
        photo.sector === "south" && photo.captureMetadata
          ? { ...photo, captureMetadata: { ...photo.captureMetadata, pitchDeg: 3 } }
          : photo
      )
    }, preset);
    const missingCameraCalibration = evaluateDigitalViewingCapturePreset({
      ...capture,
      photos: capture.photos.map((photo) => {
        if (photo.sector !== "south" || !photo.captureMetadata) {
          return photo;
        }
        const captureMetadata = { ...photo.captureMetadata };
        delete captureMetadata.cameraDistanceMm;
        delete captureMetadata.focalLength35mmEquivalent;
        return { ...photo, captureMetadata };
      })
    }, preset);

    expect(missingMetadata.ok).toBe(false);
    expect(missingMetadata.blocking).toContainEqual({
      id: "photos/carport-north.jpg",
      code: "photo_capture_metadata_missing",
      message: "Premium capture photos must record angle, camera, coverage, and occlusion metadata from the capture guide."
    });
    expect(wrongYaw.ok).toBe(false);
    expect(wrongYaw.blocking).toContainEqual({
      id: "photos/carport-east.jpg",
      code: "photo_yaw_out_of_tolerance",
      message: "Photo yaw must be within 12 degrees of 90."
    });
    expect(missingPitch.ok).toBe(false);
    expect(missingPitch.blocking).toContainEqual({
      id: "photos/carport-south.jpg",
      code: "photo_pitch_missing",
      message: "Premium orthogonal reference photos must declare numeric pitchDeg for Blender camera execution validation."
    });
    expect(wrongPitch.ok).toBe(false);
    expect(wrongPitch.blocking).toContainEqual({
      id: "photos/carport-south.jpg",
      code: "photo_pitch_out_of_tolerance",
      message: "Photo pitch must be within 0.5 degrees of 0."
    });
    expect(missingCameraCalibration.ok).toBe(false);
    expect(missingCameraCalibration.blocking).toContainEqual({
      id: "photos/carport-south.jpg",
      code: "photo_camera_calibration_missing",
      message: "Premium orthogonal reference photos must declare focalLength35mmEquivalent and cameraDistanceMm for Blender camera calibration."
    });
  });

  it("blocks premium delivery when verified reference photos do not declare pixel dimensions", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const result = evaluateDigitalViewingDeliveryReadiness({
      ...capture,
      photos: capture.photos.map((photo) =>
        photo.path === "photos/carport-south.jpg"
          ? { ...photo, pixelWidth: undefined, pixelHeight: undefined }
          : photo
      )
    }, "premium-sales");

    expect(result.ok).toBe(false);
    expect(result.blocking).toContainEqual({
      id: "photos/carport-south.jpg",
      code: "photo_resolution_missing",
      message: "Premium verified reference photos must declare pixelWidth and pixelHeight so bundled image evidence can be validated."
    });
  });

  it("blocks premium delivery when verified reference photos do not satisfy the capture angle contract", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const result = evaluateDigitalViewingDeliveryReadiness({
      ...capture,
      photos: capture.photos.map((photo) =>
        photo.sector === "east" && photo.captureMetadata
          ? { ...photo, captureMetadata: { ...photo.captureMetadata, yawDeg: 30 } }
          : photo
      )
    }, "premium-sales");

    expect(result.ok).toBe(false);
    expect(result.blocking).toContainEqual({
      id: "photos/carport-east.jpg",
      code: "photo_yaw_out_of_tolerance",
      message: "Photo yaw must be within 12 degrees of 90."
    });
  });

  it("explains missing capture requirements before render execution", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const preset = getDigitalViewingCapturePreset("vehicle", "premium-sales");
    const incomplete = {
      ...capture,
      photos: capture.photos.filter((photo) => photo.sector !== "detail"),
      measurements: capture.measurements.filter((measurement) => measurement.id !== "wheelbase"),
      materials: capture.materials.filter((material) => material.category !== "leather"),
      conditions: []
    };
    const result = evaluateDigitalViewingCapturePreset(incomplete, preset);

    expect(result.ok).toBe(false);
    expect(result.blocking).toEqual(expect.arrayContaining([
      {
        id: "sector-detail",
        code: "required_sector_missing",
        message: "Required preset photo sector is missing or unverified."
      },
      {
        id: "wheelbase",
        code: "required_measurement_missing",
        message: "Required preset measurement is missing."
      },
      {
        id: "material-leather",
        code: "required_material_category_missing",
        message: "Required preset material category is missing."
      },
      {
        id: "condition-evidence",
        code: "condition_evidence_missing",
        message: "This preset requires verified condition evidence so defects and wear can be represented."
      }
    ]));
  });

  it("builds a deterministic render manifest from valid capture and render preset", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const preset = {
      presetId: "studio-front-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1920, height: 1080 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 1 },
      outputPath: "renders/vehicle-front.png"
    };

    const first = buildDigitalViewingRenderManifest(capture, preset);
    const second = buildDigitalViewingRenderManifest(capture, preset);

    expect(DigitalViewingRenderManifestSchema.parse(first)).toEqual(first);
    expect(second).toEqual(first);
    expect(first.notGeometryAuthority).toBe(true);
    expect(first.sourceOfTruth).toEqual({
      geometry: "verified-measurements",
      visualEvidence: "structured-photos-material-condition-context",
      renderableTruth: "locked-blender-geometry-required",
      exportStage: "formatting-only-no-geometry-reconstruction"
    });
    expect(first.capabilityManifest.supportedTemplates).toContain("measured-digital-viewing");
    expect(first.capabilityManifest.allowedStrategies.digitalViewingRender).toEqual([
      "locked-blender-source",
      "pbr-materials",
      "texture-map-application",
      "condition-overlays",
      "blender-camera",
      "blender-lighting",
      "render-manifest"
    ]);
    expect(first.capturePreset).toEqual({
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
    });
    expect(first.modelElements.map((element) => element.id)).toEqual(["body", "front-left-door", "front-seat", "glazing", "tire-set", "wheel-axles"]);
    expect(first.modelElements.every((element) => element.renderable)).toBe(true);
    expect(first.materials.map((material) => material.materialId)).toEqual(["body-paint", "interior-leather", "tire-rubber", "wheel-metal", "window-glass"]);
    expect(first.materials[0]?.hostElementId).toBe("body");
    expect(first.materials[0]?.presetId).toBe("automotive-white-paint");
    expect(first.materials[0]?.surfaceMapping).toEqual({
      projection: "box",
      faces: ["front", "rear", "left", "right", "top"],
      scaleMm: 1200,
      rotationDeg: 0,
      sourcePhoto: "photos/left.jpg"
    });
    expect(first.materials[0]?.appearanceCalibration).toEqual({
      method: "white-balance-reference",
      sourcePhoto: "photos/left.jpg",
      illuminant: "daylight",
      confidence: "medium"
    });
    expect(first.materials[0]?.textureMaps.map((map) => map.type)).toEqual(["baseColor", "normal", "roughness"]);
    expect(first.materials[0]?.textureMaps.map((map) => map.colorSpace)).toEqual(["sRGB", "Non-Color", "Non-Color"]);
    expect(first.conditions).toHaveLength(1);
    expect(first.conditions[0]?.surfacePlacement).toEqual({
      hostElementId: "body",
      face: "front",
      u: 0.32,
      v: 0.42,
      widthMm: 420,
      heightMm: 24,
      rotationDeg: -8
    });
    expect(first.conditionInspections.map((inspection) => [
      inspection.zone,
      inspection.status,
      inspection.verified,
      inspection.sourcePhotos
    ])).toEqual([
      ["body", "defect-found", true, ["photos/detail-scratch.jpg"]],
      ["glass", "clear", true, ["photos/front.jpg", "photos/right.jpg"]],
      ["interior", "clear", true, ["photos/interior.jpg"]],
      ["wheels-tires", "clear", true, ["photos/left.jpg", "photos/right.jpg"]]
    ]);
    expect(first.artifacts).toEqual({
      render: "renders/vehicle-front.png",
      manifest: "renders/vehicle-front.manifest.json"
    });
    expect(first.hashes.captureHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.hashes.geometryHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.hashes.materialConditionHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.hashes.materialAuthoringPlanHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.hashes.presetHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.hashes.manifestHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("builds a render manifest for the carport exterior-structure capture", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const manifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });

    expect(DigitalViewingRenderManifestSchema.parse(manifest)).toEqual(manifest);
    expect(manifest.assetType).toBe("exterior-structure");
    expect(manifest.capabilityManifest.supportedTemplates).toContain("measured-digital-viewing");
    expect(manifest.materials.map((material) => [material.materialId, material.category, material.presetId])).toEqual([
      ["dark-stone-foundation", "stone", "stone-masonry"],
      ["painted-white-wood-panel", "wood", "painted-wood"]
    ]);
    expect(manifest.conditions).toContainEqual(expect.objectContaining({
      id: "white-panel-weathering",
      type: "wear",
      verification: "verified",
      surfacePlacement: {
        hostElementId: "cladding-southwest",
        face: "front",
        u: 0.5,
        v: 0.52,
        widthMm: 1800,
        heightMm: 40,
        rotationDeg: 0
      }
    }));
    expect(manifest.hashes.geometryHash).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.artifacts).toEqual({
      render: "renders/carport-southwest.png",
      manifest: "renders/carport-southwest.manifest.json"
    });
    expect(manifest.renderPreset.lighting.referencePhoto).toBe("photos/carport-south.jpg");
    expect(manifest).toMatchObject({
      lightingReference: {
        sourceOfTruth: "derived-from-verified-capture-photo-lighting-metadata",
        referencePhoto: "photos/carport-south.jpg",
        sector: "south",
        lightingReference: "daylight",
        colorReference: "known-white-reference",
        whiteBalanceKelvin: 5600,
        exposureEv: 0
      }
    });
  });

  it("refuses to build render manifest when the domain capture preset is incomplete", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const incompleteDomainCapture = {
      ...capture,
      requiredSectors: capture.requiredSectors.filter((sector) => sector !== "rear"),
      photos: capture.photos.filter((photo) => photo.sector !== "rear")
    };

    expect(() => buildDigitalViewingRenderManifest(incompleteDomainCapture, {
      presetId: "studio-front-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1920, height: 1080 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 1 },
      outputPath: "renders/vehicle-front.png"
    })).toThrow("Cannot build render manifest for invalid capture preset: required_sector_missing");
  });

  it("blocks site-reference lighting without a verified reference photo", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());

    expect(() => buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45 },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75 },
      outputPath: "renders/carport-southwest.png"
    })).toThrow("Cannot build render manifest for invalid lighting reference: site_reference_lighting_photo_missing");
  });

  it("blocks site-reference lighting from detail-only photos", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());

    expect(() => buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: {
        environment: "site-reference",
        colorTemperatureK: 5600,
        intensity: 0.75,
        referencePhoto: "photos/carport-detail-panel.jpg"
      },
      outputPath: "renders/carport-southwest.png"
    })).toThrow("Cannot build render manifest for invalid lighting reference: site_reference_lighting_photo_invalid");
  });

  it("blocks site-reference lighting when the reference photo lacks normalization metadata", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const incompleteLightingReference = {
      ...capture,
      photos: capture.photos.map((photo) => {
        if (photo.path !== "photos/carport-north.jpg" || !photo.captureMetadata) {
          return photo;
        }
        const captureMetadata = { ...photo.captureMetadata };
        delete captureMetadata.lightingReference;
        delete captureMetadata.colorReference;
        delete captureMetadata.whiteBalanceKelvin;
        delete captureMetadata.exposureEv;
        return {
          ...photo,
          captureMetadata
        };
      })
    };

    expect(() => buildDigitalViewingRenderManifest(incompleteLightingReference, {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-north.jpg" },
      outputPath: "renders/carport-southwest.png"
    })).toThrow("Cannot build render manifest for invalid lighting reference: site_reference_lighting_photo_quality_missing");
  });

  it("blocks site-reference perspective cameras without a verified reference photo", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());

    expect(() => buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45 },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    })).toThrow("Cannot build render manifest for invalid camera reference: render_camera_reference_photo_missing");
  });

  it("blocks site-reference perspective cameras from detail-only photos", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());

    expect(() => buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: {
        mode: "perspective",
        sector: "south",
        focalLengthMm: 45,
        referencePhoto: "photos/carport-detail-panel.jpg"
      },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    })).toThrow("Cannot build render manifest for invalid camera reference: render_camera_reference_photo_invalid");
  });

  it("builds a material and condition report for carport sales/review delivery", () => {
    const baseCapture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const capture = DigitalViewingCaptureSchema.parse({
      ...baseCapture,
      photos: baseCapture.photos.map((photo) => {
        if (photo.path === "photos/carport-south.jpg" && photo.captureMetadata) {
          return {
            ...photo,
            captureMetadata: {
              ...photo.captureMetadata,
              materialCategories: ["stone" as const, "wood" as const]
            }
          };
        }
        if (photo.path === "photos/carport-detail-panel.jpg" && photo.captureMetadata) {
          return {
            ...photo,
            captureMetadata: {
              ...photo.captureMetadata,
              materialCategories: ["wood" as const]
            }
          };
        }
        return photo;
      })
    });
    const manifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });

    const report = buildDigitalViewingMaterialConditionReport(capture, "premium-sales", {
      ...manifest,
      blenderExecution: {
        materialApplication: {
          textures: {
            missing: [
              { path: "textures/carport-stone-foundation-normal.png", type: "normal" },
              { path: "textures/carport-white-panel-normal.png", type: "normal" },
              { path: "textures/carport-white-panel-roughness.png", type: "roughness" }
            ]
          }
        },
        conditionApplication: {
          applied: [
            { conditionId: "white-panel-weathering", hostElementId: "cladding-southwest" }
          ]
        }
      }
    });

    expect(report.reportType).toBe("material-condition-report");
    expect(report.notGeometryAuthority).toBe(true);
    expect(report.readiness.ok).toBe(true);
    expect(report.measurements.map((measurement) => measurement.id)).toEqual([
      "low-side-height",
      "neighbor-boundary-distance",
      "overall-depth",
      "overall-height",
      "overall-width",
      "roof-slope-percent",
      "step-depth",
      "step-height"
    ]);
    expect(report.measurements.find((measurement) => measurement.id === "overall-width")).toMatchObject({
      value: 7676,
      tolerance: 1,
      unit: "mm",
      source: "drawing"
    });
    expect(report.materials.map((material) => [material.materialId, material.category, material.presetId])).toEqual([
      ["dark-stone-foundation", "stone", "stone-masonry"],
      ["painted-white-wood-panel", "wood", "painted-wood"]
    ]);
    expect(report.photoEvidence).toContainEqual({
      path: "photos/carport-south.jpg",
      sector: "south",
      role: "geometry_alignment",
      verified: true,
      materialCategories: ["stone", "wood"]
    });
    expect(report.photoEvidence).toContainEqual({
      path: "photos/carport-detail-panel.jpg",
      sector: "detail",
      role: "condition",
      verified: true,
      materialCategories: ["wood"]
    });
    expect(report.materials.flatMap((material) => material.textureMaps.map((texture) => [material.materialId, texture.type, texture.renderStatus]))).toEqual([
      ["dark-stone-foundation", "normal", "missing"],
      ["dark-stone-foundation", "roughness", "declared"],
      ["painted-white-wood-panel", "normal", "missing"],
      ["painted-white-wood-panel", "roughness", "missing"]
    ]);
    expect(report.conditions).toContainEqual(expect.objectContaining({
      id: "white-panel-weathering",
      type: "wear",
      sourcePhotoEvidence: [
        {
          path: "photos/carport-detail-panel.jpg",
          verified: true,
          materialCategories: ["wood"]
        }
      ],
      renderStatus: "overlay-applied"
    }));
    expect(report.conditionVisibilityChecklist).toEqual([
      {
        conditionId: "white-panel-weathering",
        hostElementId: "cladding-southwest",
        type: "wear",
        severity: "low",
        verification: "verified",
        mustBeVisible: true,
        sourceOfTruth: "verified-condition-evidence",
        sourcePhotos: ["photos/carport-detail-panel.jpg"],
        sourcePhotoEvidence: [
          {
            path: "photos/carport-detail-panel.jpg",
            verified: true,
            materialCategories: ["wood"]
          }
        ],
        inspectionZones: ["cladding"],
        materialSurface: "cladding",
        surfacePlacement: {
          hostElementId: "cladding-southwest",
          face: "front",
          u: 0.5,
          v: 0.52,
          widthMm: 1800,
          heightMm: 40,
          rotationDeg: 0
        },
        renderStatus: "overlay-applied"
      }
    ]);
    expect(report.conditionInspections.map((inspection) => [inspection.zone, inspection.status, inspection.verified])).toEqual([
      ["cladding", "defect-found", true],
      ["foundation", "clear", true],
      ["openings", "clear", true],
      ["roof", "clear", true],
      ["stairs", "clear", true]
    ]);
    expect(report.hashes.captureHash).toMatch(/^[a-f0-9]{64}$/);
    expect(report.hashes.reportHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("builds material and condition report with verified vehicle inspection zones", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const report = buildDigitalViewingMaterialConditionReport(capture, "premium-sales");

    expect(report.conditionInspections.find((inspection) => inspection.zone === "body")).toMatchObject({
      zone: "body",
      sourcePhotos: ["photos/detail-scratch.jpg"],
      sourcePhotoEvidence: [
        {
          path: "photos/detail-scratch.jpg",
          sector: "detail",
          role: "condition",
          verified: true,
          materialCategories: []
        }
      ]
    });
    expect(report.conditionInspections.map((inspection) => [
      inspection.zone,
      inspection.hostElementId,
      inspection.materialCategory,
      inspection.status,
      inspection.verified,
      inspection.sourcePhotos,
      inspection.conditionIds
    ])).toEqual([
      ["body", "body", "paint", "defect-found", true, ["photos/detail-scratch.jpg"], ["front-left-scratch"]],
      ["glass", "glazing", "glass", "clear", true, ["photos/front.jpg", "photos/right.jpg"], []],
      ["interior", "front-seat", "leather", "clear", true, ["photos/interior.jpg"], []],
      ["wheels-tires", "tire-set", "rubber", "clear", true, ["photos/left.jpg", "photos/right.jpg"], []]
    ]);
  });

  it("requires base color texture evidence for premium paint material authoring", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const plan = buildDigitalViewingMaterialAuthoringPlan(capture, "premium-sales");
    const bodyPaint = plan.materials.find((material) => material.materialId === "body-paint");

    expect(bodyPaint?.requiredMaps).toEqual(["baseColor", "normal", "roughness"]);
    expect(bodyPaint?.presentMaps).toEqual(["baseColor", "normal", "roughness"]);
    expect(bodyPaint?.authoringStatus).toBe("ready");
  });

  it("requires base color texture evidence for premium marine gelcoat authoring", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadBoatCapture());
    const plan = buildDigitalViewingMaterialAuthoringPlan(capture, "premium-sales");
    const hullGelcoat = plan.materials.find((material) => material.materialId === "hull-gelcoat");
    const report = buildDigitalViewingMaterialConditionReport(capture, "premium-sales");

    expect(capture.assetType).toBe("boat");
    expect(buildDigitalViewingCaptureGuide("boat", "premium-sales").materialChecklist.map((item) => [
      item.category,
      item.materialSurfaces
    ])).toEqual([
      ["gelcoat", ["hull", "deck"]],
      ["glass", ["windscreen", "portlights"]],
      ["metal", ["rails", "cleats", "fittings"]],
      ["fabric", ["upholstery", "canvas"]],
      ["wood", ["deck-trim", "interior-joinery"]]
    ]);
    expect(hullGelcoat?.requiredMaps).toEqual(["baseColor", "normal", "roughness"]);
    expect(hullGelcoat?.presentMaps).toEqual(["baseColor", "normal", "roughness"]);
    expect(hullGelcoat?.authoringStatus).toBe("ready");
    expect(plan.summary.ready).toBe(true);
    expect(report.conditionInspections.map((inspection) => [
      inspection.zone,
      inspection.hostElementId,
      inspection.materialCategory,
      inspection.status,
      inspection.verified
    ])).toEqual([
      ["cabin", "cabin-interior", "wood", "clear", true],
      ["deck", "deck-surface", "fabric", "clear", true],
      ["fittings", "stainless-fittings", "metal", "clear", true],
      ["hull", "hull", "gelcoat", "clear", true],
      ["upholstery-canvas", "canvas-upholstery", "fabric", "clear", true]
    ]);
  });

  it("builds a premium property fixture for broker-facing material and inspection truth", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadPropertyCapture());
    const presetReadiness = evaluateDigitalViewingCapturePreset(capture, getDigitalViewingCapturePreset("property", "premium-sales"));
    const plan = buildDigitalViewingMaterialAuthoringPlan(capture, "premium-sales");
    const report = buildDigitalViewingMaterialConditionReport(capture, "premium-sales");

    expect(capture.assetType).toBe("property");
    expect(buildDigitalViewingCaptureGuide("property", "premium-sales").materialChecklist.map((item) => [
      item.category,
      item.materialSurfaces
    ])).toEqual([
      ["wood", ["cladding", "trim", "doors"]],
      ["glass", ["windows", "glazed-doors"]],
      ["stone", ["foundation", "masonry", "paving"]],
      ["metal", ["gutters", "railings", "fittings"]]
    ]);
    expect(presetReadiness.ok).toBe(true);
    expect(plan.summary).toEqual({
      ready: true,
      blockingCount: 0,
      warningCount: 0
    });
    expect(plan.materials.map((material) => [
      material.materialId,
      material.category,
      material.requiredMaps,
      material.presentMaps,
      material.authoringStatus
    ])).toEqual([
      ["facade-painted-wood", "wood", ["normal", "roughness"], ["normal", "roughness"], "ready"],
      ["foundation-stone", "stone", ["normal", "roughness"], ["normal", "roughness"], "ready"],
      ["roof-fittings-metal", "metal", ["metallic", "normal", "roughness"], ["metallic", "normal", "roughness"], "ready"],
      ["window-glass", "glass", ["alpha", "roughness"], ["alpha", "roughness"], "ready"]
    ]);
    expect(report.conditionInspections.map((inspection) => [
      inspection.zone,
      inspection.hostElementId,
      inspection.materialCategory,
      inspection.status,
      inspection.verified
    ])).toEqual([
      ["facade", "facade-cladding", "wood", "clear", true],
      ["interior-finishes", "interior-finish", "wood", "clear", true],
      ["masonry-foundation", "stone-foundation", "stone", "clear", true],
      ["roof-fittings", "roof-fittings", "metal", "clear", true],
      ["windows-doors", "window-set", "glass", "clear", true]
    ]);
  });

  it("serializes the material and condition report as a deterministic JSON artifact", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const report = buildDigitalViewingMaterialConditionReport(capture, "premium-sales");
    const serialized = serializeDigitalViewingMaterialConditionReport(report);
    const renderPreset = {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales" as const,
      renderer: "cycles" as const,
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective" as const, sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference" as const, colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    };
    const renderManifest = buildDigitalViewingRenderManifest(capture, renderPreset);
    const assetBundle = buildDigitalViewingAssetBundleManifest(capture, renderManifest, {
      existingFiles: FullCarportAssetPaths,
      assetFiles: assetFilesFor(FullCarportAssetPaths)
    });

    expect(GenerateDigitalViewingMaterialReportInputSchema.parse({
      capture,
      deliveryTier: "premium-sales",
      renderManifest,
      assetBundleManifest: assetBundle,
      assetBundleManifestPath: "asset-bundles/carport-southwest.asset-bundle.json",
      outputPath: "reports/carport-material-condition-report.json"
    }).outputPath).toBe("reports/carport-material-condition-report.json");
    expect(() => GenerateDigitalViewingMaterialReportInputSchema.parse({
      capture,
      deliveryTier: "premium-sales",
      renderManifest,
      outputPath: "reports/carport-material-condition-report.json"
    })).toThrow();
    expect(() => GenerateDigitalViewingMaterialReportInputSchema.parse({
      capture,
      deliveryTier: "premium-sales",
      renderManifest,
      assetBundleManifest: assetBundle,
      outputPath: "reports/carport-material-condition-report.json"
    })).toThrow();
    expect(serialized.endsWith("\n")).toBe(true);
    expect(JSON.parse(serialized)).toEqual(report);
    expect(serializeDigitalViewingMaterialConditionReport(report)).toBe(serialized);
  });

  it("builds a material authoring plan for premium carport photorealism", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const plan = buildDigitalViewingMaterialAuthoringPlan(capture, "premium-sales");

    expect(GenerateDigitalViewingMaterialAuthoringPlanInputSchema.parse({
      capture,
      deliveryTier: "premium-sales",
      outputPath: "reports/carport-material-authoring-plan.json"
    }).outputPath).toBe("reports/carport-material-authoring-plan.json");
    expect(plan.planType).toBe("material-authoring-plan");
    expect(plan.notGeometryAuthority).toBe(true);
    expect(plan.summary).toEqual({
      ready: true,
      blockingCount: 0,
      warningCount: 0
    });
    expect(plan.materials.find((material) => material.materialId === "painted-white-wood-panel")?.pbrFields).toEqual({
      baseColor: "declared",
      roughness: "declared",
      metallic: "declared",
      specular: "declared",
      transmission: "declared",
      normalSource: "declared",
      textureScaleMm: "declared"
    });
    expect(plan.materials.map((material) => [
      material.materialId,
      material.surfaceMapping,
      material.requiredMaps,
      material.presentMaps,
      material.missingMaps,
      material.authoringStatus
    ])).toEqual([
      [
        "dark-stone-foundation",
        {
          projection: "box",
          faces: ["front", "left", "right"],
          scaleMm: 500,
          rotationDeg: 0,
          sourcePhoto: "photos/carport-south.jpg"
        },
        ["normal", "roughness"],
        ["normal", "roughness"],
        [],
        "ready"
      ],
      [
        "painted-white-wood-panel",
        {
          projection: "planar",
          faces: ["front"],
          scaleMm: 900,
          rotationDeg: 0,
          sourcePhoto: "photos/carport-west.jpg"
        },
        ["normal", "roughness"],
        ["normal", "roughness"],
        [],
        "ready"
      ]
    ]);
    expect(plan.hashes.captureHash).toMatch(/^[a-f0-9]{64}$/);
    expect(plan.hashes.planHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("blocks premium material authoring when required texture evidence is missing", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const incomplete = {
      ...capture,
      materials: capture.materials.map((material) =>
        material.materialId === "dark-stone-foundation"
          ? { ...material, textureMaps: material.textureMaps.filter((textureMap) => textureMap.type !== "roughness") }
          : material
      )
    };
    const plan = buildDigitalViewingMaterialAuthoringPlan(incomplete, "premium-sales");

    expect(plan.summary.ready).toBe(false);
    expect(plan.materials[0]?.missingMaps).toEqual(["roughness"]);
    expect(plan.materials[0]?.blocking).toContainEqual({
      id: "dark-stone-foundation:roughness",
      code: "required_texture_map_missing",
      message: "Premium material authoring requires a roughness texture map for stone."
    });
    expect(() => buildDigitalViewingRenderManifest(incomplete, {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    })).toThrow("Cannot build render manifest for incomplete material authoring: required_texture_map_missing");
  });

  it("blocks premium material authoring when texture quality metadata is missing", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const incomplete = {
      ...capture,
      materials: capture.materials.map((material) =>
        material.materialId === "painted-white-wood-panel"
          ? {
              ...material,
              textureMaps: material.textureMaps.map((textureMap) =>
                textureMap.type === "normal"
                  ? { ...textureMap, scaleMm: undefined, pixelWidth: undefined, pixelHeight: undefined }
                  : textureMap
              )
            }
          : material
      )
    };
    const plan = buildDigitalViewingMaterialAuthoringPlan(incomplete, "premium-sales");

    expect(plan.summary.ready).toBe(false);
    expect(plan.materials.find((material) => material.materialId === "painted-white-wood-panel")?.blocking).toEqual(
      expect.arrayContaining([
        {
          id: "painted-white-wood-panel:normal:scale",
          code: "texture_scale_missing",
          message: "Premium texture maps must declare physical scale in millimeters so Blender mapping is reproducible."
        },
        {
          id: "painted-white-wood-panel:normal:resolution",
          code: "texture_resolution_missing",
          message: "Premium texture maps must declare pixel width and height so render quality is explicit."
        }
      ])
    );
  });

  it("blocks premium material authoring when texture color space is incompatible with the map type", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const invalidColorSpace = {
      ...capture,
      materials: capture.materials.map((material) =>
        material.materialId === "painted-white-wood-panel"
          ? {
              ...material,
              textureMaps: material.textureMaps.map((textureMap) =>
                textureMap.type === "normal"
                  ? { ...textureMap, colorSpace: "sRGB" as const }
                  : textureMap
              )
            }
          : material
      )
    };
    const plan = buildDigitalViewingMaterialAuthoringPlan(invalidColorSpace, "premium-sales");

    expect(plan.summary.ready).toBe(false);
    expect(plan.materials.find((material) => material.materialId === "painted-white-wood-panel")?.blocking).toContainEqual({
      id: "painted-white-wood-panel:normal:color-space",
      code: "texture_color_space_invalid",
      message: "Premium texture maps must use sRGB for baseColor and Non-Color for data maps so Blender interprets material evidence correctly."
    });
    expect(() => buildDigitalViewingRenderManifest(invalidColorSpace, {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    })).toThrow("Cannot build render manifest for incomplete material authoring: texture_color_space_invalid");
  });

  it("blocks premium material authoring when texture source photo is not verified material evidence", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const invalidTextureEvidence = {
      ...capture,
      photos: capture.photos.map((photo) =>
        photo.path === "photos/left.jpg" && photo.captureMetadata
          ? { ...photo, role: "context" as const, captureMetadata: { ...photo.captureMetadata, coverage: "full-sector" as const } }
          : photo
      )
    };
    const plan = buildDigitalViewingMaterialAuthoringPlan(invalidTextureEvidence, "premium-sales");

    expect(plan.summary.ready).toBe(false);
    expect(plan.materials.find((material) => material.materialId === "body-paint")?.blocking).toContainEqual({
      id: "body-paint:normal:source-photo",
      code: "texture_source_photo_invalid",
      message: "Premium texture maps must reference a verified, unoccluded material/detail photo suitable for texture evidence."
    });
  });

  it("blocks premium material authoring when texture map source photo declares the wrong material category", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const wrongTextureCategory = {
      ...capture,
      photos: capture.photos.map((photo) =>
        photo.path === "photos/front.jpg" && photo.captureMetadata
          ? {
              ...photo,
              captureMetadata: {
                ...photo.captureMetadata,
                materialCategories: ["glass" as const]
              }
            }
          : photo
      ),
      materials: capture.materials.map((material) =>
        material.materialId === "body-paint"
          ? {
              ...material,
              textureMaps: material.textureMaps.map((textureMap) =>
                textureMap.type === "baseColor"
                  ? { ...textureMap, sourcePhoto: "photos/front.jpg" }
                  : textureMap
              )
            }
          : material
      )
    };
    const plan = buildDigitalViewingMaterialAuthoringPlan(wrongTextureCategory, "premium-sales");

    expect(plan.summary.ready).toBe(false);
    expect(plan.materials.find((material) => material.materialId === "body-paint")?.blocking).toContainEqual({
      id: "body-paint:baseColor:source-photo",
      code: "texture_source_photo_invalid",
      message: "Premium texture maps must reference a verified, unoccluded material/detail photo suitable for texture evidence."
    });
    expect(() => buildDigitalViewingRenderManifest(wrongTextureCategory, {
      presetId: "studio-front-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1920, height: 1080 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 1 },
      outputPath: "renders/vehicle-front.png"
    })).toThrow("Cannot build render manifest for incomplete material authoring: texture_source_photo_invalid");
  });

  it("blocks premium material authoring when texture map source photo is from an unmapped exterior sector", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const wrongTextureSector = {
      ...capture,
      materials: capture.materials.map((material) =>
        material.materialId === "body-paint" && material.surfaceMapping
          ? {
              ...material,
              surfaceMapping: {
                ...material.surfaceMapping,
                faces: ["left", "right"] as const
              },
              textureMaps: material.textureMaps.map((textureMap) =>
                textureMap.type === "normal"
                  ? { ...textureMap, sourcePhoto: "photos/rear.jpg" }
                  : textureMap
              )
            }
          : material
      ),
      conditions: capture.conditions.map((condition) =>
        condition.id === "front-left-scratch" && condition.surfacePlacement
          ? {
              ...condition,
              surfacePlacement: {
                ...condition.surfacePlacement,
                face: "left" as const
              }
            }
          : condition
      )
    };
    const plan = buildDigitalViewingMaterialAuthoringPlan(wrongTextureSector, "premium-sales");

    expect(plan.summary.ready).toBe(false);
    expect(plan.materials.find((material) => material.materialId === "body-paint")?.blocking).toContainEqual({
      id: "body-paint:normal:source-photo:rear",
      code: "texture_source_photo_face_mismatch",
      message: "Premium exterior texture source photo sector must be one of the mapped material faces."
    });
    expect(() => buildDigitalViewingRenderManifest(wrongTextureSector, {
      presetId: "studio-front-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1920, height: 1080 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 1 },
      outputPath: "renders/vehicle-front.png"
    })).toThrow("Cannot build render manifest for incomplete material authoring: texture_source_photo_face_mismatch");
  });

  it("blocks premium material authoring when material source photos declare the wrong material category", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const wrongMaterialSourceCategory = {
      ...capture,
      photos: capture.photos.map((photo) =>
        photo.path === "photos/front.jpg" && photo.captureMetadata
          ? {
              ...photo,
              captureMetadata: {
                ...photo.captureMetadata,
                materialCategories: ["glass" as const]
              }
            }
          : photo
      ),
      materials: capture.materials.map((material) =>
        material.materialId === "body-paint"
          ? { ...material, photoSources: ["photos/front.jpg"] }
          : material
      )
    };

    const plan = buildDigitalViewingMaterialAuthoringPlan(wrongMaterialSourceCategory, "premium-sales");

    expect(plan.summary.ready).toBe(false);
    expect(plan.materials.find((material) => material.materialId === "body-paint")?.blocking).toContainEqual({
      id: "body-paint:photo-sources",
      code: "material_source_photo_material_category_mismatch",
      message: "Premium material source photos must match the material category before authoring Blender material evidence."
    });
  });

  it("blocks premium material authoring when material source photo is from an unmapped exterior sector", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const wrongMaterialSourceSector = {
      ...capture,
      materials: capture.materials.map((material) =>
        material.materialId === "body-paint" && material.surfaceMapping
          ? {
              ...material,
              photoSources: ["photos/rear.jpg"],
              surfaceMapping: {
                ...material.surfaceMapping,
                faces: ["left", "right"] as const
              }
            }
          : material
      ),
      conditions: capture.conditions.map((condition) =>
        condition.id === "front-left-scratch" && condition.surfacePlacement
          ? {
              ...condition,
              surfacePlacement: {
                ...condition.surfacePlacement,
                face: "left" as const
              }
            }
          : condition
      )
    };

    const readiness = evaluateDigitalViewingDeliveryReadiness(wrongMaterialSourceSector, "premium-sales");
    const plan = buildDigitalViewingMaterialAuthoringPlan(wrongMaterialSourceSector, "premium-sales");

    expect(readiness.ok).toBe(false);
    expect(readiness.blocking).toContainEqual({
      id: "body-paint:photo-sources:rear",
      code: "material_source_photo_face_mismatch",
      message: "Premium exterior material source photo sector must be one of the mapped material faces."
    });
    expect(plan.summary.ready).toBe(false);
    expect(plan.materials.find((material) => material.materialId === "body-paint")?.blocking).toContainEqual({
      id: "body-paint:photo-sources:rear",
      code: "material_source_photo_face_mismatch",
      message: "Premium exterior material source photo sector must be one of the mapped material faces."
    });
    expect(() => buildDigitalViewingRenderManifest(wrongMaterialSourceSector, {
      presetId: "studio-front-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1920, height: 1080 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 1 },
      outputPath: "renders/vehicle-front.png"
    })).toThrow("Cannot build render manifest for invalid capture: material_source_photo_face_mismatch");
  });

  it("serializes the material authoring plan deterministically", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const plan = buildDigitalViewingMaterialAuthoringPlan(capture, "premium-sales");
    const serialized = serializeDigitalViewingMaterialAuthoringPlan(plan);

    expect(serialized.endsWith("\n")).toBe(true);
    expect(JSON.parse(serialized)).toEqual(plan);
    expect(serializeDigitalViewingMaterialAuthoringPlan(plan)).toBe(serialized);
  });

  it("builds a deterministic delivery package manifest for sales-grade viewing", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const assetBundle = buildDigitalViewingAssetBundleManifest(capture, renderManifest, {
      existingFiles: FullCarportAssetPaths,
      assetFiles: assetFilesFor(FullCarportAssetPaths)
    });
    const assetBundlePath = "asset-bundles/carport-southwest.asset-bundle.json";
    const stone = renderManifest.materials.find((material) => material.materialId === "dark-stone-foundation");
    const wood = renderManifest.materials.find((material) => material.materialId === "painted-white-wood-panel");
    expect(stone).toBeDefined();
    expect(wood).toBeDefined();
    const executedRenderManifest = {
      ...renderManifest,
      blenderExecution: {
        measurementApplication: {
          applied: blenderMeasurementApplicationsFor(capture)
        },
        materialApplication: {
          applied: [
            {
              object: "foundation-wall",
              materialId: "dark-stone-foundation",
              sourcePhotoIdentities: materialSourcePhotoIdentitiesFor(renderManifest, assetBundle, "dark-stone-foundation"),
              pbr: stone!.pbr,
              pbrReadback: {
                sourceOfTruth: "read-from-blender-material-node-values-after-application",
                fields: ["baseColor", "metallic", "normalSource", "roughness", "specular", "textureScaleMm", "transmission"],
                values: stone!.pbr
              },
              surfaceMapping: {
                projection: "box",
                faces: ["front", "left", "right"],
                scaleMm: 500,
                rotationDeg: 0,
                sourcePhoto: "photos/carport-south.jpg"
              },
              appearanceCalibration: {
                method: "white-balance-reference",
                sourcePhoto: "photos/carport-south.jpg",
                illuminant: "daylight",
                confidence: "medium"
              }
            },
            {
              object: "cladding-southwest",
              materialId: "painted-white-wood-panel",
              sourcePhotoIdentities: materialSourcePhotoIdentitiesFor(renderManifest, assetBundle, "painted-white-wood-panel"),
              pbr: wood!.pbr,
              pbrReadback: {
                sourceOfTruth: "read-from-blender-material-node-values-after-application",
                fields: ["baseColor", "metallic", "normalSource", "roughness", "specular", "textureScaleMm", "transmission"],
                values: wood!.pbr
              },
              surfaceMapping: {
                projection: "planar",
                faces: ["front"],
                scaleMm: 900,
                rotationDeg: 0,
                sourcePhoto: "photos/carport-west.jpg"
              },
              appearanceCalibration: {
                method: "white-balance-reference",
                sourcePhoto: "photos/carport-west.jpg",
                illuminant: "daylight",
                confidence: "medium"
              }
            }
          ],
          textures: {
            applied: blenderTextureApplicationsFor(renderManifest, assetBundle)
          }
        },
        conditionApplication: {
          applied: [
            {
              conditionId: "white-panel-weathering",
              hostElementId: "cladding-southwest",
              face: "front",
              sourcePhotoIdentities: conditionSourcePhotoIdentitiesFor(capture, assetBundle, "white-panel-weathering"),
              surfacePlacement: {
                hostElementId: "cladding-southwest",
                face: "front",
                u: 0.5,
                v: 0.52,
                widthMm: 1800,
                heightMm: 40,
                rotationDeg: 0
              },
              visibilityProof: {
                sourceOfTruth: "created-visible-blender-overlay-object",
                objectName: "condition-white-panel-weathering",
                materialName: "condition-weathering",
                visibleInRender: true,
                dimensionsMm: {
                  widthMm: 1800,
                  heightMm: 40
                },
                materialReadback: {
                  sourceOfTruth: "read-from-blender-condition-material-after-application",
                  baseColor: "#b0b0a8",
                  alpha: 1,
                  roughness: 0.82,
                  metallic: 0,
                  conditionType: "wear",
                  severity: "low"
                }
              }
            }
          ]
        },
        camera: {
          cameraName: "Measured_Render_south",
          sector: "south",
          mode: "perspective",
          referencePhoto: "photos/carport-south.jpg",
          referencePhotoIdentity: photoIdentityFor(assetBundle, "photos/carport-south.jpg"),
          executedYawDeg: 0,
          executedPitchDeg: 0
        },
        lighting: {
          lights: ["Measured_Render_Key_Area", "Measured_Render_Fill_Area"],
          environment: "site-reference",
          referencePhoto: "photos/carport-south.jpg",
          referencePhotoIdentity: photoIdentityFor(assetBundle, "photos/carport-south.jpg"),
          lightingReference: "daylight",
          colorReference: "known-white-reference",
          whiteBalanceKelvin: 5600,
          exposureEv: 0
        },
        renderQuality: {
          renderer: "cycles",
          samples: 64,
          denoise: true,
          resolution: { width: 1600, height: 1000 },
          filmTransparent: false,
          viewTransform: "Filmic",
          look: "Medium High Contrast",
          exposure: 0,
          gamma: 1,
          worldColor: "#c7d1db"
        },
        renderArtifact: {
          path: "renders/carport-southwest.png",
          sizeBytes: 9283,
          sha256: "a".repeat(64),
          width: 1600,
          height: 1000
        },
        referenceComparison: {
          referencePhoto: "photos/carport-south.jpg",
          renderPath: "renders/carport-southwest.png",
          method: "luma-grid-rmse" as const,
          score: 0.86,
          threshold: 0.75
        },
        assetBundle: {
          manifestType: "digital-viewing-asset-bundle" as const,
          ready: true,
          assetBundleHash: assetBundle.hashes.assetBundleHash,
          requiredCount: assetBundle.summary.requiredCount,
          missingCount: assetBundle.summary.missingCount
        }
      }
    };
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, executedRenderManifest, undefined, undefined, assetBundle, assetBundlePath);
    const serialized = serializeDigitalViewingDeliveryPackageManifest(deliveryPackage);

    expect(GenerateDigitalViewingDeliveryPackageInputSchema.parse({
      capture,
      renderManifest: executedRenderManifest,
      assetBundleManifest: assetBundle,
      assetBundleManifestPath: assetBundlePath,
      customerSurface: "internal-review",
      deliveryTargets: ["photoreal-render", "material-condition-report"],
      outputPath: "packages/carport-premium-package.json"
    }).outputPath).toBe("packages/carport-premium-package.json");
    expect(() => GenerateDigitalViewingDeliveryPackageInputSchema.parse({
      capture,
      renderManifest: executedRenderManifest,
      customerSurface: "internal-review",
      deliveryTargets: ["photoreal-render", "material-condition-report"],
      outputPath: "packages/carport-premium-package.json"
    })).toThrow();
    expect(() => GenerateDigitalViewingDeliveryPackageInputSchema.parse({
      capture,
      renderManifest: executedRenderManifest,
      assetBundleManifest: assetBundle,
      customerSurface: "internal-review",
      deliveryTargets: ["photoreal-render", "material-condition-report"],
      outputPath: "packages/carport-premium-package.json"
    })).toThrow();
    expect(deliveryPackage.packageType).toBe("digital-viewing-delivery-package");
    expect(deliveryPackage.notGeometryAuthority).toBe(true);
    expect(deliveryPackage.customerSurface).toBe("internal-review");
    expect(deliveryPackage.qualityGates.ready).toBe(true);
    expect(deliveryPackage.qualityGates.blocking).toEqual([]);
    expect(deliveryPackage.includedArtifacts.map((artifact) => [artifact.artifactType, artifact.required])).toEqual([
      ["render", true],
      ["render-manifest", true],
      ["asset-bundle-manifest", true],
      ["material-authoring-plan", true],
      ["material-condition-report", true]
    ]);
    expect(deliveryPackage.includedArtifacts).toContainEqual({
      artifactType: "asset-bundle-manifest",
      path: assetBundlePath,
      hash: assetBundle.hashes.assetBundleHash,
      required: true
    });
    expect(deliveryPackage.deliveryTargets.map((target) => [target.target, target.status, target.required])).toEqual([
      ["photoreal-render", "ready", true],
      ["material-condition-report", "ready", true]
    ]);
    expect(deliveryPackage.sourceTraceIndex).toMatchObject({
      sourceOfTruth: "derived-from-existing-package-coverage-without-geometry-reconstruction",
      entryCount: 18
    });
    expect(deliveryPackage.sourceTraceIndex.entries).toEqual(expect.arrayContaining([
      {
        sourceId: "exterior-structure-premium-sales-south",
        sourceType: "capture-shot",
        sourceCoverage: "captureAngleCoverage",
        label: "south capture reference",
        status: "matched",
        path: "photos/carport-south.jpg"
      },
      {
        sourceId: "overall-width",
        sourceType: "measurement",
        sourceCoverage: "dimensionOverlayCoverage",
        label: "Carport width: 7676 mm",
        status: "ready"
      },
      {
        sourceId: "painted-white-wood-panel",
        sourceType: "material",
        sourceCoverage: "materialRenderCoverage+pbrMaterialCompletenessCoverage",
        label: "wood material",
        status: "ready",
        path: "photos/carport-east.jpg",
        evidencePaths: ["photos/carport-east.jpg", "photos/carport-west.jpg"]
      },
      {
        sourceId: "white-panel-weathering",
        sourceType: "condition",
        sourceCoverage: "conditionOverlayCoverage",
        label: "wear: low",
        status: "ready",
        path: "photos/carport-detail-panel.jpg",
        evidencePaths: ["photos/carport-detail-panel.jpg"]
      },
      {
        sourceId: "photoreal-render",
        sourceType: "delivery-target",
        sourceCoverage: "deliveryTargets",
        label: "photoreal-render delivery target",
        status: "ready",
        path: "renders/carport-southwest.png"
      }
    ]));
    expect(deliveryPackage.customerReadinessSummary).toEqual({
      customerSurface: "internal-review",
      status: "ready",
      requiredTargetCount: 2,
      readyRequiredTargetCount: 2,
      missingRequiredTargetCount: 0,
      qualityCheckCount: 8,
      passedQualityCheckCount: 8,
      failedQualityCheckCount: 0,
      blockingCount: 0,
      warningCount: 2,
      nextActions: [],
      sourceOfTruth: "derived-from-delivery-targets-quality-checks-gates-asset-bundle-render-execution-photo-evidence-capture-angles-material-categories-material-calibration-pbr-materials-material-render-material-character-inspection-zones-condition-render-condition-overlays-render-quality-and-reference-comparison"
    });
    expect((deliveryPackage as unknown as { evidenceHealthSummary?: unknown }).evidenceHealthSummary).toEqual({
      sourceOfTruth: "derived-from-source-trace-index-quality-gates-and-customer-readiness",
      status: "ready",
      indexedSourceCount: deliveryPackage.sourceTraceIndex.entryCount,
      readyEvidenceCount: deliveryPackage.sourceTraceIndex.entryCount,
      blockedEvidenceCount: 0,
      missingEvidenceCount: 0,
      evidencePathCount: 11,
      warningCount: deliveryPackage.qualityGates.warnings.length,
      sections: [
        { section: "capture-shots", status: "ready", indexedSourceCount: 5, readyEvidenceCount: 5, blockedEvidenceCount: 0, missingEvidenceCount: 0, evidencePathCount: 5 },
        { section: "measurements", status: "ready", indexedSourceCount: 8, readyEvidenceCount: 8, blockedEvidenceCount: 0, missingEvidenceCount: 0, evidencePathCount: 0 },
        { section: "materials", status: "ready", indexedSourceCount: 2, readyEvidenceCount: 2, blockedEvidenceCount: 0, missingEvidenceCount: 0, evidencePathCount: 4 },
        { section: "conditions", status: "ready", indexedSourceCount: 1, readyEvidenceCount: 1, blockedEvidenceCount: 0, missingEvidenceCount: 0, evidencePathCount: 1 },
        { section: "delivery-targets", status: "ready", indexedSourceCount: 2, readyEvidenceCount: 2, blockedEvidenceCount: 0, missingEvidenceCount: 0, evidencePathCount: 1 }
      ]
    });
    expect(deliveryPackage.renderQualityCoverage).toEqual({
      sourceOfTruth: "derived-from-render-preset-and-blender-render-settings",
      status: "ready",
      declared: {
        assetType: "exterior-structure",
        renderer: "cycles",
        resolution: { width: 1600, height: 1000 },
        deliveryTier: "premium-sales",
        qualityProfile: { minWidth: 1600, minHeight: 1000 }
      },
      executed: {
        renderer: "cycles",
        samples: 64,
        denoise: true,
        resolution: { width: 1600, height: 1000 },
        filmTransparent: false,
        viewTransform: "Filmic",
        look: "Medium High Contrast",
        exposure: 0,
        gamma: 1,
        worldColor: "#c7d1db"
      },
      checks: [
        { check: "renderer", status: "passed", evidence: "cycles renderer executed" },
        { check: "sampling", status: "passed", evidence: "64 samples with denoise enabled" },
        { check: "resolution", status: "passed", evidence: "1600x1000 output resolution" },
        { check: "color-management", status: "passed", evidence: "Filmic / Medium High Contrast / exposure 0 / gamma 1" },
        { check: "background", status: "passed", evidence: "opaque render with world color #c7d1db" }
      ]
    });
    expect(deliveryPackage.renderReferenceComparisonCoverage).toEqual({
      sourceOfTruth: "derived-from-render-artifact-reference-photo-and-blender-comparison-metadata",
      required: true,
      referencePhoto: "photos/carport-south.jpg",
      renderPath: "renders/carport-southwest.png",
      method: "luma-grid-rmse",
      comparisonMethodTier: "structural",
      requiredComparisonMethodTier: "structural",
      comparisonMethodTierStatus: "satisfies-required",
      score: 0.86,
      threshold: 0.75,
      minimumRequiredThreshold: DigitalViewingExports.MinimumStructuralReferenceComparisonThreshold,
      status: "matched",
      evidence: "luma-grid-rmse score 0.86 >= 0.75 against photos/carport-south.jpg"
    });
    expect(deliveryPackage.viewerLayerCoverage).toEqual({
      sourceOfTruth: "derived-from-delivery-targets-render-evidence-overlays-and-condition-report",
      layerCount: 5,
      readyLayerCount: 4,
      blockedLayerCount: 0,
      notRequestedLayerCount: 1,
      entries: [
        {
          layer: "photoreal-scene",
          required: true,
          status: "ready",
          sourceIds: ["photoreal-render"],
          evidence: "8/8 photoreal quality checks passed; render quality ready"
        },
        {
          layer: "material-fidelity",
          required: true,
          status: "ready",
          sourceIds: ["dark-stone-foundation", "painted-white-wood-panel"],
          evidence: "2 materials applied, 4 texture maps applied, 2 PBR materials complete"
        },
        {
          layer: "condition-disclosure",
          required: true,
          status: "ready",
          sourceIds: ["white-panel-weathering"],
          evidence: "1 visible condition items rendered across 5 inspection zones"
        },
        {
          layer: "dimension-overlays",
          required: true,
          status: "ready",
          sourceIds: [
            "low-side-height",
            "neighbor-boundary-distance",
            "overall-depth",
            "overall-height",
            "overall-width",
            "roof-slope-percent",
            "step-depth",
            "step-height"
          ],
          evidence: "8/8 verified measurements ready for overlays"
        },
        {
          layer: "web-delivery",
          required: false,
          status: "not-requested",
          sourceIds: [],
          evidence: "web-viewer target not requested"
        }
      ]
    });
    expect(deliveryPackage.customerViewingChecklist).toEqual({
      sourceOfTruth: "derived-from-capture-angles-materials-dimensions-conditions-render-quality-and-delivery-targets",
      ready: true,
      itemCount: 7,
      readyItemCount: 5,
      blockedItemCount: 0,
      notRequestedItemCount: 2,
      items: [
        {
          item: "reference-photos",
          category: "capture",
          sourceCoverage: "captureAngleCoverage",
          sourceIds: [
            "exterior-structure-premium-sales-detail",
            "exterior-structure-premium-sales-east",
            "exterior-structure-premium-sales-north",
            "exterior-structure-premium-sales-south",
            "exterior-structure-premium-sales-west"
          ],
          required: true,
          status: "ready",
          evidence: "5/5 required capture shots matched"
        },
        {
          item: "dimension-overlays",
          category: "measurements",
          sourceCoverage: "dimensionOverlayCoverage",
          sourceIds: [
            "low-side-height",
            "neighbor-boundary-distance",
            "overall-depth",
            "overall-height",
            "overall-width",
            "roof-slope-percent",
            "step-depth",
            "step-height"
          ],
          required: true,
          status: "ready",
          evidence: "8/8 verified measurement annotations ready"
        },
        {
          item: "material-fidelity",
          category: "materials",
          sourceCoverage: "materialRenderCoverage+materialCalibrationCoverage+pbrMaterialCompletenessCoverage",
          sourceIds: ["dark-stone-foundation", "painted-white-wood-panel"],
          required: true,
          status: "ready",
          evidence: "2/2 PBR materials complete; 2/2 calibration candidates ready; 2/2 Blender material surface mappings matched"
        },
        {
          item: "condition-disclosure",
          category: "conditions",
          sourceCoverage: "conditionInspectionCoverage+conditionOverlayCoverage",
          sourceIds: ["white-panel-weathering"],
          required: true,
          status: "ready",
          evidence: "1/1 visible condition disclosures ready; 5/5 inspection zones verified"
        },
        {
          item: "photoreal-render",
          category: "render",
          sourceCoverage: "renderQualityCoverage",
          sourceIds: ["photoreal-render"],
          required: true,
          status: "ready",
          evidence: "cycles render quality ready"
        },
        {
          item: "model-artifact",
          category: "delivery",
          sourceCoverage: "deliveryTargets",
          sourceIds: [],
          required: false,
          status: "not-requested",
          evidence: "model artifact target not requested"
        },
        {
          item: "web-model",
          category: "delivery",
          sourceCoverage: "deliveryTargets",
          sourceIds: [],
          required: false,
          status: "not-requested",
          evidence: "web-viewer target not requested"
        }
      ]
    });
    expect(deliveryPackage.photoEvidenceCoverage).toEqual({
      sourceOfTruth: "derived-from-capture-photos-render-preset-materials-textures-and-conditions",
      verifiedPhotoCount: 5,
      evidenceCount: 22,
      missingEvidenceCount: 0,
      entries: [
        { usage: "appearance-calibration", targetId: "dark-stone-foundation", path: "photos/carport-south.jpg", sector: "south", role: "geometry_alignment", verified: true },
        { usage: "appearance-calibration", targetId: "painted-white-wood-panel", path: "photos/carport-west.jpg", sector: "west", role: "material", verified: true },
        { usage: "camera-reference", targetId: "south", path: "photos/carport-south.jpg", sector: "south", role: "geometry_alignment", verified: true },
        { usage: "condition-evidence", targetId: "white-panel-weathering", path: "photos/carport-detail-panel.jpg", sector: "detail", role: "condition", verified: true },
        { usage: "inspection-source", targetId: "cladding", path: "photos/carport-detail-panel.jpg", sector: "detail", role: "condition", verified: true },
        { usage: "inspection-source", targetId: "foundation", path: "photos/carport-south.jpg", sector: "south", role: "geometry_alignment", verified: true },
        { usage: "inspection-source", targetId: "foundation", path: "photos/carport-west.jpg", sector: "west", role: "material", verified: true },
        { usage: "inspection-source", targetId: "openings", path: "photos/carport-north.jpg", sector: "north", role: "geometry_alignment", verified: true },
        { usage: "inspection-source", targetId: "openings", path: "photos/carport-south.jpg", sector: "south", role: "geometry_alignment", verified: true },
        { usage: "inspection-source", targetId: "roof", path: "photos/carport-south.jpg", sector: "south", role: "geometry_alignment", verified: true },
        { usage: "inspection-source", targetId: "stairs", path: "photos/carport-south.jpg", sector: "south", role: "geometry_alignment", verified: true },
        { usage: "lighting-reference", targetId: "site-reference", path: "photos/carport-south.jpg", sector: "south", role: "geometry_alignment", verified: true },
        { usage: "material-source", targetId: "dark-stone-foundation", path: "photos/carport-south.jpg", sector: "south", role: "geometry_alignment", verified: true },
        { usage: "material-source", targetId: "dark-stone-foundation", path: "photos/carport-west.jpg", sector: "west", role: "material", verified: true },
        { usage: "material-source", targetId: "painted-white-wood-panel", path: "photos/carport-east.jpg", sector: "east", role: "material", verified: true },
        { usage: "material-source", targetId: "painted-white-wood-panel", path: "photos/carport-west.jpg", sector: "west", role: "material", verified: true },
        { usage: "surface-mapping", targetId: "dark-stone-foundation", path: "photos/carport-south.jpg", sector: "south", role: "geometry_alignment", verified: true },
        { usage: "surface-mapping", targetId: "painted-white-wood-panel", path: "photos/carport-west.jpg", sector: "west", role: "material", verified: true },
        { usage: "texture-source", targetId: "dark-stone-foundation:normal", path: "photos/carport-south.jpg", sector: "south", role: "geometry_alignment", verified: true },
        { usage: "texture-source", targetId: "dark-stone-foundation:roughness", path: "photos/carport-west.jpg", sector: "west", role: "material", verified: true },
        { usage: "texture-source", targetId: "painted-white-wood-panel:normal", path: "photos/carport-west.jpg", sector: "west", role: "material", verified: true },
        { usage: "texture-source", targetId: "painted-white-wood-panel:roughness", path: "photos/carport-east.jpg", sector: "east", role: "material", verified: true }
      ]
    });
    expect(deliveryPackage.captureAngleCoverage).toMatchObject({
      sourceOfTruth: "derived-from-domain-capture-preset-and-verified-photo-metadata",
      presetId: "exterior-structure-premium-sales",
      requiredShotCount: 5,
      matchedShotCount: 5,
      missingShotCount: 0,
      mismatchedShotCount: 0
    });
    expect(deliveryPackage.captureAngleCoverage.entries.map((entry) => [
      entry.sector,
      entry.selectedPhotoPath,
      entry.status,
      entry.actual.angleType,
      entry.actual.cameraMode,
      entry.actual.coverage,
      entry.actual.occluded,
      entry.actual.anchorsVisible
    ])).toEqual([
      ["north", "photos/carport-north.jpg", "matched", "orthogonal", "orthographic-reference", "full-object", false, true],
      ["south", "photos/carport-south.jpg", "matched", "orthogonal", "orthographic-reference", "full-object", false, true],
      ["east", "photos/carport-east.jpg", "matched", "orthogonal", "orthographic-reference", "full-object", false, true],
      ["west", "photos/carport-west.jpg", "matched", "orthogonal", "orthographic-reference", "full-object", false, true],
      ["detail", "photos/carport-detail-panel.jpg", "matched", "detail", "macro-detail", "condition-detail", false, false]
    ]);
    expect(deliveryPackage.captureAngleCoverage.entries.map((entry) => [
      entry.sector,
      entry.expected.angleType,
      entry.expected.cameraMode,
      entry.expected.coverage,
      entry.expected.occlusionPolicy,
      entry.expected.measuredEndpointsVisible
    ])).toEqual([
      ["north", "orthogonal", "orthographic-reference", "full-object", "avoid", true],
      ["south", "orthogonal", "orthographic-reference", "full-object", "avoid", true],
      ["east", "orthogonal", "orthographic-reference", "full-object", "avoid", true],
      ["west", "orthogonal", "orthographic-reference", "full-object", "avoid", true],
      ["detail", "detail", "macro-detail", "condition-detail", "avoid", false]
    ]);
    expect(deliveryPackage.measurementEvidenceCoverage).toEqual({
      sourceOfTruth: "derived-from-verified-measurements-and-blender-anchor-application",
      geometryMeasurementCount: 8,
      appliedAnchorCount: 8,
      missingAnchorCount: 0,
      entries: [
        {
          measurementId: "low-side-height",
          label: "Low side roof height",
          value: 3174,
          tolerance: 1,
          unit: "mm",
          confidence: "high",
          source: "drawing",
          hostElementId: "roof",
          axis: "z",
          referenceFrame: "asset-local",
          blenderAnchorStatus: "applied"
        },
        {
          measurementId: "neighbor-boundary-distance",
          label: "Outermost southwest post to neighboring plot boundary",
          value: 7692,
          tolerance: 5,
          unit: "mm",
          confidence: "medium",
          source: "manual_measurement",
          hostElementId: "outermost-southwest-post",
          axis: "distance",
          referenceFrame: "site-local",
          blenderAnchorStatus: "applied"
        },
        {
          measurementId: "overall-depth",
          label: "Carport depth",
          value: 6240,
          tolerance: 1,
          unit: "mm",
          confidence: "high",
          source: "drawing",
          hostElementId: "carport-frame",
          axis: "y",
          referenceFrame: "asset-local",
          blenderAnchorStatus: "applied"
        },
        {
          measurementId: "overall-height",
          label: "High side roof height",
          value: 3455,
          tolerance: 1,
          unit: "mm",
          confidence: "high",
          source: "drawing",
          hostElementId: "roof",
          axis: "z",
          referenceFrame: "asset-local",
          blenderAnchorStatus: "applied"
        },
        {
          measurementId: "overall-width",
          label: "Carport width",
          value: 7676,
          tolerance: 1,
          unit: "mm",
          confidence: "high",
          source: "drawing",
          hostElementId: "carport-frame",
          axis: "x",
          referenceFrame: "asset-local",
          blenderAnchorStatus: "applied"
        },
        {
          measurementId: "roof-slope-percent",
          label: "Roof slope",
          value: 3.7,
          tolerance: 0.1,
          unit: "percent",
          confidence: "high",
          source: "drawing",
          hostElementId: "roof",
          axis: "slope",
          referenceFrame: "asset-local",
          blenderAnchorStatus: "applied"
        },
        {
          measurementId: "step-depth",
          label: "Step depth",
          value: 295,
          tolerance: 5,
          unit: "mm",
          confidence: "medium",
          source: "manual_measurement",
          hostElementId: "street-stair-run",
          axis: "y",
          referenceFrame: "site-local",
          blenderAnchorStatus: "applied"
        },
        {
          measurementId: "step-height",
          label: "Step height",
          value: 140,
          tolerance: 5,
          unit: "mm",
          confidence: "medium",
          source: "manual_measurement",
          hostElementId: "street-stair-run",
          axis: "z",
          referenceFrame: "site-local",
          blenderAnchorStatus: "applied"
        }
      ]
    });
    expect(deliveryPackage.dimensionOverlayCoverage).toEqual({
      sourceOfTruth: "derived-from-verified-measurement-placement-and-blender-anchor-application",
      overlayCandidateCount: 8,
      overlayReadyCount: 8,
      overlayBlockedCount: 0,
      entries: [
        {
          measurementId: "low-side-height",
          label: "Low side roof height",
          value: 3174,
          tolerance: 1,
          unit: "mm",
          hostElementId: "roof",
          axis: "z",
          referenceFrame: "asset-local",
          from: "finished ground datum",
          to: "east low-side roof top",
          overlayStatus: "ready",
          displayLabel: "Low side roof height: 3174 mm",
          annotation: {
            text: "Low side roof height: 3174 mm",
            value: 3174,
            tolerance: 1,
            unit: "mm",
            axis: "z",
            hostElementId: "roof",
            referenceFrame: "asset-local",
            from: "finished ground datum",
            to: "east low-side roof top",
            source: "drawing",
            confidence: "high"
          }
        },
        {
          measurementId: "neighbor-boundary-distance",
          label: "Outermost southwest post to neighboring plot boundary",
          value: 7692,
          tolerance: 5,
          unit: "mm",
          hostElementId: "outermost-southwest-post",
          axis: "distance",
          referenceFrame: "site-local",
          from: "outermost southwest post",
          to: "neighboring plot boundary",
          overlayStatus: "ready",
          displayLabel: "Outermost southwest post to neighboring plot boundary: 7692 mm",
          annotation: {
            text: "Outermost southwest post to neighboring plot boundary: 7692 mm",
            value: 7692,
            tolerance: 5,
            unit: "mm",
            axis: "distance",
            hostElementId: "outermost-southwest-post",
            referenceFrame: "site-local",
            from: "outermost southwest post",
            to: "neighboring plot boundary",
            source: "manual_measurement",
            confidence: "medium"
          }
        },
        {
          measurementId: "overall-depth",
          label: "Carport depth",
          value: 6240,
          tolerance: 1,
          unit: "mm",
          hostElementId: "carport-frame",
          axis: "y",
          referenceFrame: "asset-local",
          from: "south/front outer plane",
          to: "north/rear outer plane",
          overlayStatus: "ready",
          displayLabel: "Carport depth: 6240 mm",
          annotation: {
            text: "Carport depth: 6240 mm",
            value: 6240,
            tolerance: 1,
            unit: "mm",
            axis: "y",
            hostElementId: "carport-frame",
            referenceFrame: "asset-local",
            from: "south/front outer plane",
            to: "north/rear outer plane",
            source: "drawing",
            confidence: "high"
          }
        },
        {
          measurementId: "overall-height",
          label: "High side roof height",
          value: 3455,
          tolerance: 1,
          unit: "mm",
          hostElementId: "roof",
          axis: "z",
          referenceFrame: "asset-local",
          from: "finished ground datum",
          to: "west high-side roof top",
          overlayStatus: "ready",
          displayLabel: "High side roof height: 3455 mm",
          annotation: {
            text: "High side roof height: 3455 mm",
            value: 3455,
            tolerance: 1,
            unit: "mm",
            axis: "z",
            hostElementId: "roof",
            referenceFrame: "asset-local",
            from: "finished ground datum",
            to: "west high-side roof top",
            source: "drawing",
            confidence: "high"
          }
        },
        {
          measurementId: "overall-width",
          label: "Carport width",
          value: 7676,
          tolerance: 1,
          unit: "mm",
          hostElementId: "carport-frame",
          axis: "x",
          referenceFrame: "asset-local",
          from: "west outer post plane",
          to: "east outer post plane",
          overlayStatus: "ready",
          displayLabel: "Carport width: 7676 mm",
          annotation: {
            text: "Carport width: 7676 mm",
            value: 7676,
            tolerance: 1,
            unit: "mm",
            axis: "x",
            hostElementId: "carport-frame",
            referenceFrame: "asset-local",
            from: "west outer post plane",
            to: "east outer post plane",
            source: "drawing",
            confidence: "high"
          }
        },
        {
          measurementId: "roof-slope-percent",
          label: "Roof slope",
          value: 3.7,
          tolerance: 0.1,
          unit: "percent",
          hostElementId: "roof",
          axis: "slope",
          referenceFrame: "asset-local",
          from: "west high-side roof edge",
          to: "east low-side roof edge",
          overlayStatus: "ready",
          displayLabel: "Roof slope: 3.7 percent",
          annotation: {
            text: "Roof slope: 3.7 percent",
            value: 3.7,
            tolerance: 0.1,
            unit: "percent",
            axis: "slope",
            hostElementId: "roof",
            referenceFrame: "asset-local",
            from: "west high-side roof edge",
            to: "east low-side roof edge",
            source: "drawing",
            confidence: "high"
          }
        },
        {
          measurementId: "step-depth",
          label: "Step depth",
          value: 295,
          tolerance: 5,
          unit: "mm",
          hostElementId: "street-stair-run",
          axis: "y",
          referenceFrame: "site-local",
          from: "step nosing",
          to: "next riser face",
          overlayStatus: "ready",
          displayLabel: "Step depth: 295 mm",
          annotation: {
            text: "Step depth: 295 mm",
            value: 295,
            tolerance: 5,
            unit: "mm",
            axis: "y",
            hostElementId: "street-stair-run",
            referenceFrame: "site-local",
            from: "step nosing",
            to: "next riser face",
            source: "manual_measurement",
            confidence: "medium"
          }
        },
        {
          measurementId: "step-height",
          label: "Step height",
          value: 140,
          tolerance: 5,
          unit: "mm",
          hostElementId: "street-stair-run",
          axis: "z",
          referenceFrame: "site-local",
          from: "lower tread surface",
          to: "upper tread surface",
          overlayStatus: "ready",
          displayLabel: "Step height: 140 mm",
          annotation: {
            text: "Step height: 140 mm",
            value: 140,
            tolerance: 5,
            unit: "mm",
            axis: "z",
            hostElementId: "street-stair-run",
            referenceFrame: "site-local",
            from: "lower tread surface",
            to: "upper tread surface",
            source: "manual_measurement",
            confidence: "medium"
          }
        }
      ]
    });
    expect(deliveryPackage.materialRenderCoverage).toEqual({
      sourceOfTruth: "derived-from-material-authoring-report-and-blender-material-application",
      materialCount: 2,
      hostTargetedMaterialCount: 2,
      appliedMaterialCount: 2,
      missingMaterialCount: 0,
      textureMapCount: 4,
      appliedTextureMapCount: 4,
      missingTextureMapCount: 0,
      textureColorSpaceMatchedCount: 4,
      textureColorSpaceMismatchCount: 0,
      surfaceMappingMatchedCount: 2,
      surfaceMappingMismatchCount: 0,
      appearanceCalibrationMatchedCount: 2,
      appearanceCalibrationMismatchCount: 0,
      materialFidelityReadyCount: 2,
      materialFidelityBlockedCount: 0,
      entries: [
        {
          materialId: "dark-stone-foundation",
          hostElementId: "foundation-wall",
          presetId: "stone-masonry",
          category: "stone",
          provenance: "photo_observed",
          confidence: "medium",
          materialRenderStatus: "applied",
          textureMapCount: 2,
          appliedTextureMapCount: 2,
          missingTextureMapCount: 0,
          textureColorSpaceStatus: "matched",
	          surfaceMappingExecutionStatus: "matched",
	          appearanceCalibrationExecutionStatus: "matched",
	          surfaceMappingStatus: "declared",
	          appearanceCalibrationStatus: "declared",
	          surfaceMappingReadback: {
	            projection: "box",
	            faces: ["front", "left", "right"],
	            scaleMm: 500,
	            rotationDeg: 0,
	            sourcePhoto: "photos/carport-south.jpg"
	          },
	          appearanceCalibrationReadback: {
	            method: "white-balance-reference",
	            sourcePhoto: "photos/carport-south.jpg",
	            illuminant: "daylight",
	            confidence: "medium"
	          },
	          sourcePhotoEvidenceCount: 2,
	          sourcePhotoEvidenceStatus: "ready",
	          pbrReadback: {
	            sourceOfTruth: "read-from-blender-material-node-values-after-application",
	            fields: ["baseColor", "metallic", "normalSource", "roughness", "specular", "textureScaleMm", "transmission"],
	            values: {
	              baseColor: "#33383a",
	              roughness: 0.88,
	              metallic: 0,
	              specular: 0.16,
	              transmission: 0,
	              normalSource: "photo",
	              textureScaleMm: 500
	            }
	          },
	          materialFidelityStatus: "ready",
	          materialFidelityIssues: [],
	          sourcePhotos: ["photos/carport-south.jpg", "photos/carport-west.jpg"],
	          sourcePhotoEvidence: [
	            {
	              path: "photos/carport-south.jpg",
	              sector: "south",
	              role: "geometry_alignment",
	              verified: true,
	              materialCategories: ["stone"]
	            },
	            {
	              path: "photos/carport-west.jpg",
	              sector: "west",
	              role: "material",
	              verified: true,
	              materialCategories: ["stone"]
	            }
	          ]
	        },
	        {
	          materialId: "painted-white-wood-panel",
          hostElementId: "cladding-southwest",
          presetId: "painted-wood",
          category: "wood",
          provenance: "photo_observed",
          confidence: "medium",
          materialRenderStatus: "applied",
          textureMapCount: 2,
          appliedTextureMapCount: 2,
          missingTextureMapCount: 0,
          textureColorSpaceStatus: "matched",
	          surfaceMappingExecutionStatus: "matched",
	          appearanceCalibrationExecutionStatus: "matched",
	          surfaceMappingStatus: "declared",
		          appearanceCalibrationStatus: "declared",
		          surfaceMappingReadback: {
		            projection: "planar",
		            faces: ["front"],
		            scaleMm: 900,
		            rotationDeg: 0,
		            sourcePhoto: "photos/carport-west.jpg"
		          },
		          appearanceCalibrationReadback: {
		            method: "white-balance-reference",
		            sourcePhoto: "photos/carport-west.jpg",
		            illuminant: "daylight",
	            confidence: "medium"
	          },
	          sourcePhotoEvidenceCount: 2,
	          sourcePhotoEvidenceStatus: "ready",
	          pbrReadback: {
	            sourceOfTruth: "read-from-blender-material-node-values-after-application",
	            fields: ["baseColor", "metallic", "normalSource", "roughness", "specular", "textureScaleMm", "transmission"],
	            values: {
	              baseColor: "#f2f2ee",
	              roughness: 0.52,
	              metallic: 0,
	              specular: 0.28,
	              transmission: 0,
	              normalSource: "photo",
	              textureScaleMm: 900
	            }
	          },
	          materialFidelityStatus: "ready",
	          materialFidelityIssues: [],
	          sourcePhotos: ["photos/carport-east.jpg", "photos/carport-west.jpg"],
	          sourcePhotoEvidence: [
	            {
	              path: "photos/carport-east.jpg",
	              sector: "east",
	              role: "material",
	              verified: true,
	              materialCategories: ["wood"]
	            },
	            {
	              path: "photos/carport-west.jpg",
	              sector: "west",
	              role: "material",
	              verified: true,
	              materialCategories: ["wood"]
	            }
	          ]
	        }
	      ]
	    });
    expect(deliveryPackage.pbrMaterialCompletenessCoverage).toEqual({
      sourceOfTruth: "derived-from-render-manifest-pbr-fields-and-premium-texture-requirements",
      materialCount: 2,
      completeMaterialCount: 2,
      incompleteMaterialCount: 0,
      photoNormalSourceCount: 2,
      textureScaleDeclaredCount: 2,
      entries: [
        {
          materialId: "dark-stone-foundation",
          presetId: "stone-masonry",
          category: "stone",
          completenessStatus: "complete",
          finishProfile: {
            profileId: "stone-finish",
            roughness: { min: 0.45, max: 1 },
            metallic: { min: 0, max: 0.05 }
          },
          finishProfileStatus: "in-range",
          finishProfileIssues: [],
          requiredTextureTypes: ["normal", "roughness"],
          presentTextureTypes: ["normal", "roughness"],
          missingTextureTypes: [],
          pbrFields: {
            baseColor: "declared",
            roughness: "declared",
            metallic: "declared",
            specular: "declared",
            transmission: "declared",
            normalSource: "declared",
            textureScaleMm: "declared"
          },
          normalSource: "photo",
          textureScaleMm: 500,
          textureEvidence: [
            {
              type: "normal",
              path: "textures/carport-stone-foundation-normal.png",
              provenance: "photo_observed",
              confidence: "medium",
              colorSpace: "Non-Color",
              scaleMm: 500,
              pixelWidth: 4096,
              pixelHeight: 4096,
              sourcePhoto: "photos/carport-south.jpg"
            },
            {
              type: "roughness",
              path: "textures/carport-stone-foundation-roughness.png",
              provenance: "photo_observed",
              confidence: "medium",
              colorSpace: "Non-Color",
              scaleMm: 500,
              pixelWidth: 4096,
              pixelHeight: 4096,
              sourcePhoto: "photos/carport-west.jpg"
            }
          ]
        },
        {
          materialId: "painted-white-wood-panel",
          presetId: "painted-wood",
          category: "wood",
          completenessStatus: "complete",
          finishProfile: {
            profileId: "wood-finish",
            roughness: { min: 0.25, max: 0.9 },
            metallic: { min: 0, max: 0.05 }
          },
          finishProfileStatus: "in-range",
          finishProfileIssues: [],
          requiredTextureTypes: ["normal", "roughness"],
          presentTextureTypes: ["normal", "roughness"],
          missingTextureTypes: [],
          pbrFields: {
            baseColor: "declared",
            roughness: "declared",
            metallic: "declared",
            specular: "declared",
            transmission: "declared",
            normalSource: "declared",
            textureScaleMm: "declared"
          },
          normalSource: "photo",
          textureScaleMm: 900,
          textureEvidence: [
            {
              type: "normal",
              path: "textures/carport-white-panel-normal.png",
              provenance: "photo_observed",
              confidence: "medium",
              colorSpace: "Non-Color",
              scaleMm: 900,
              pixelWidth: 4096,
              pixelHeight: 4096,
              sourcePhoto: "photos/carport-west.jpg"
            },
            {
              type: "roughness",
              path: "textures/carport-white-panel-roughness.png",
              provenance: "photo_observed",
              confidence: "medium",
              colorSpace: "Non-Color",
              scaleMm: 900,
              pixelWidth: 4096,
              pixelHeight: 4096,
              sourcePhoto: "photos/carport-east.jpg"
            }
          ]
        }
      ]
    });
    expect(deliveryPackage.renderExecutionCoverage).toEqual({
      sourceOfTruth: "derived-from-render-manifest-and-blender-execution-metadata",
      renderer: "cycles",
      renderPath: "renders/carport-southwest.png",
      manifestPath: "renders/carport-southwest.manifest.json",
      camera: {
        declaredSector: "south",
        declaredMode: "perspective",
        declaredReferencePhoto: "photos/carport-south.jpg",
        executedSector: "south",
        executedMode: "perspective",
        executedReferencePhoto: "photos/carport-south.jpg",
        status: "matched"
      },
      lighting: {
        declaredEnvironment: "site-reference",
        declaredReferencePhoto: "photos/carport-south.jpg",
        declaredLightingReference: "daylight",
        declaredColorReference: "known-white-reference",
        declaredWhiteBalanceKelvin: 5600,
        declaredExposureEv: 0,
        executedEnvironment: "site-reference",
        executedReferencePhoto: "photos/carport-south.jpg",
        executedLightingReference: "daylight",
        executedColorReference: "known-white-reference",
        executedWhiteBalanceKelvin: 5600,
        executedExposureEv: 0,
        status: "matched"
      },
      assetBundle: {
        status: "matched",
        declaredHash: assetBundle.hashes.assetBundleHash,
        executedHash: assetBundle.hashes.assetBundleHash,
        manifestPath: assetBundlePath
      },
      renderArtifact: {
        declaredPath: "renders/carport-southwest.png",
        declaredWidth: 1600,
        declaredHeight: 1000,
        executedPath: "renders/carport-southwest.png",
        sizeBytes: 9283,
        sha256: "a".repeat(64),
        executedWidth: 1600,
        executedHeight: 1000,
        status: "matched"
      }
    });
    expect(deliveryPackage.conditionRenderCoverage).toEqual({
      sourceOfTruth: "derived-from-condition-evidence-inspection-zones-and-blender-condition-application",
      verifiedConditionCount: 1,
      visibleConditionCount: 1,
      appliedConditionCount: 1,
      missingConditionCount: 0,
      inspectionZoneCount: 5,
      verifiedInspectionZoneCount: 5,
      defectFoundZoneCount: 1,
      entries: [
        {
          conditionId: "white-panel-weathering",
          hostElementId: "cladding-southwest",
          type: "wear",
          severity: "low",
          verification: "verified",
          mustBeVisible: true,
          sourcePhotos: ["photos/carport-detail-panel.jpg"],
          sourcePhotoEvidence: [
            {
              path: "photos/carport-detail-panel.jpg",
              verified: true,
              materialCategories: []
            }
          ],
          inspectionZones: ["cladding"],
          materialSurface: "cladding",
          conditionRenderStatus: "applied",
          placementStatus: "matched",
          visibilityProofStatus: "matched",
          surfacePlacement: {
            hostElementId: "cladding-southwest",
            face: "front",
            u: 0.5,
            v: 0.52,
            widthMm: 1800,
            heightMm: 40,
            rotationDeg: 0
          },
          visibilityProof: {
            sourceOfTruth: "created-visible-blender-overlay-object",
            objectName: "condition-white-panel-weathering",
            materialName: "condition-weathering",
            visibleInRender: true,
            dimensionsMm: {
              widthMm: 1800,
              heightMm: 40
            },
            materialReadback: {
              sourceOfTruth: "read-from-blender-condition-material-after-application",
              baseColor: "#b0b0a8",
              alpha: 1,
              roughness: 0.82,
              metallic: 0,
              conditionType: "wear",
              severity: "low"
            }
          }
        }
      ],
      inspectionZones: [
        {
          zone: "cladding",
          status: "defect-found",
          verified: true,
          conditionIds: ["white-panel-weathering"],
          sourcePhotos: ["photos/carport-detail-panel.jpg"],
          sourcePhotoEvidence: [
            {
              path: "photos/carport-detail-panel.jpg",
              sector: "detail",
              role: "condition",
              verified: true,
              materialCategories: []
            }
          ]
        },
        {
          zone: "foundation",
          status: "clear",
          verified: true,
          conditionIds: [],
          sourcePhotos: ["photos/carport-south.jpg", "photos/carport-west.jpg"],
          sourcePhotoEvidence: [
            {
              path: "photos/carport-south.jpg",
              sector: "south",
              role: "geometry_alignment",
              verified: true,
              materialCategories: []
            },
            {
              path: "photos/carport-west.jpg",
              sector: "west",
              role: "material",
              verified: true,
              materialCategories: []
            }
          ]
        },
        {
          zone: "openings",
          status: "clear",
          verified: true,
          conditionIds: [],
          sourcePhotos: ["photos/carport-north.jpg", "photos/carport-south.jpg"],
          sourcePhotoEvidence: [
            {
              path: "photos/carport-north.jpg",
              sector: "north",
              role: "geometry_alignment",
              verified: true,
              materialCategories: []
            },
            {
              path: "photos/carport-south.jpg",
              sector: "south",
              role: "geometry_alignment",
              verified: true,
              materialCategories: []
            }
          ]
        },
        {
          zone: "roof",
          status: "clear",
          verified: true,
          conditionIds: [],
          sourcePhotos: ["photos/carport-south.jpg"],
          sourcePhotoEvidence: [
            {
              path: "photos/carport-south.jpg",
              sector: "south",
              role: "geometry_alignment",
              verified: true,
              materialCategories: []
            }
          ]
        },
        {
          zone: "stairs",
          status: "clear",
          verified: true,
          conditionIds: [],
          sourcePhotos: ["photos/carport-south.jpg"],
          sourcePhotoEvidence: [
            {
              path: "photos/carport-south.jpg",
              sector: "south",
              role: "geometry_alignment",
              verified: true,
              materialCategories: []
            }
          ]
        }
      ]
    });
    expect(deliveryPackage.conditionOverlayCoverage).toEqual({
      sourceOfTruth: "derived-from-visible-condition-placement-photos-and-blender-condition-application",
      overlayCandidateCount: 1,
      overlayReadyCount: 1,
      overlayBlockedCount: 0,
      entries: [
        {
          conditionId: "white-panel-weathering",
          hostElementId: "cladding-southwest",
          type: "wear",
          severity: "low",
          verification: "verified",
          sourcePhotos: ["photos/carport-detail-panel.jpg"],
          sourcePhotoEvidence: [
            {
              path: "photos/carport-detail-panel.jpg",
              verified: true,
              materialCategories: []
            }
          ],
          inspectionZones: ["cladding"],
          materialSurface: "cladding",
          surfacePlacement: {
            hostElementId: "cladding-southwest",
            face: "front",
            u: 0.5,
            v: 0.52,
            widthMm: 1800,
            heightMm: 40,
            rotationDeg: 0
          },
          overlayStatus: "ready",
          displayLabel: "wear: low severity",
          disclosureProfile: {
            profileId: "low-condition-disclosure",
            minAreaMm2: 2500,
            minLongestDimensionMm: 80
          },
          disclosureProfileIssues: [],
          disclosure: {
            title: "wear: low severity",
            conditionId: "white-panel-weathering",
            type: "wear",
            severity: "low",
            verification: "verified",
            hostElementId: "cladding-southwest",
            inspectionZones: ["cladding"],
            sourcePhotos: ["photos/carport-detail-panel.jpg"],
            sourcePhotoEvidence: [
              {
                path: "photos/carport-detail-panel.jpg",
                verified: true,
                materialCategories: []
              }
            ],
            materialSurface: "cladding",
            surfacePlacement: {
              hostElementId: "cladding-southwest",
              face: "front",
              u: 0.5,
              v: 0.52,
              widthMm: 1800,
              heightMm: 40,
              rotationDeg: 0
            }
          }
        }
      ]
    });
    expect(deliveryPackage.photorealQualityChecklist).toEqual([
      {
        check: "asset-bundle",
        status: "passed",
        evidence: "asset-bundles/carport-southwest.asset-bundle.json",
        trace: {
          captureHash: renderManifest.hashes.captureHash,
          renderManifestHash: renderManifest.hashes.manifestHash,
          assetBundleHash: assetBundle.hashes.assetBundleHash,
          materialConditionReportHash: deliveryPackage.hashes.materialConditionReportHash
        }
      },
      {
        check: "render-output",
        status: "passed",
        evidence: "renders/carport-southwest.png render artifact identity matched Blender output",
        trace: {
          captureHash: renderManifest.hashes.captureHash,
          renderManifestHash: renderManifest.hashes.manifestHash
        }
      },
      {
        check: "measurements",
        status: "passed",
        evidence: "8 geometry measurements preserved as Blender anchors with declared values",
        trace: {
          captureHash: renderManifest.hashes.captureHash,
          renderManifestHash: renderManifest.hashes.manifestHash,
          materialConditionReportHash: deliveryPackage.hashes.materialConditionReportHash
        }
      },
        {
          check: "materials",
          status: "passed",
          evidence: "2 host-targeted materials applied with calibrated appearance, surface mapping, and source photo file identity",
          trace: {
            captureHash: renderManifest.hashes.captureHash,
          renderManifestHash: renderManifest.hashes.manifestHash,
          materialConditionReportHash: deliveryPackage.hashes.materialConditionReportHash
        }
      },
      {
        check: "textures",
        status: "passed",
        evidence: "4 declared texture maps applied with physical scale, matched color space, and file identity",
        trace: {
          captureHash: renderManifest.hashes.captureHash,
          renderManifestHash: renderManifest.hashes.manifestHash,
          assetBundleHash: assetBundle.hashes.assetBundleHash,
          materialConditionReportHash: deliveryPackage.hashes.materialConditionReportHash
        }
      },
      {
        check: "conditions",
        status: "passed",
        evidence: "1 buyer-visible condition items rendered",
        trace: {
          captureHash: renderManifest.hashes.captureHash,
          renderManifestHash: renderManifest.hashes.manifestHash,
          assetBundleHash: assetBundle.hashes.assetBundleHash,
          materialConditionReportHash: deliveryPackage.hashes.materialConditionReportHash
        }
      },
      {
        check: "camera",
        status: "passed",
        evidence: "south perspective camera matched photos/carport-south.jpg with file identity",
        trace: {
          captureHash: renderManifest.hashes.captureHash,
          renderManifestHash: renderManifest.hashes.manifestHash,
          assetBundleHash: assetBundle.hashes.assetBundleHash
        }
      },
      {
        check: "lighting",
        status: "passed",
        evidence: "site-reference lighting matched photos/carport-south.jpg with file identity",
        trace: {
          captureHash: renderManifest.hashes.captureHash,
          renderManifestHash: renderManifest.hashes.manifestHash,
          assetBundleHash: assetBundle.hashes.assetBundleHash
        }
      }
    ]);
    expect(deliveryPackage.hashes.captureHash).toBe(renderManifest.hashes.captureHash);
    expect(deliveryPackage.hashes.renderManifestHash).toBe(renderManifest.hashes.manifestHash);
    expect(deliveryPackage.hashes.materialAuthoringPlanHash).toBe(renderManifest.hashes.materialAuthoringPlanHash);
    expect(deliveryPackage.hashes.packageHash).toMatch(/^[a-f0-9]{64}$/);
    expect(serialized.endsWith("\n")).toBe(true);
    expect(JSON.parse(serialized)).toEqual(deliveryPackage);
  });

  it("indexes a separately supplied material-condition report artifact path", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-southwest-premium",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 60, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5200, intensity: 0.85, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const reportArtifactHash = "b".repeat(64);
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(
      capture,
      renderManifest,
      ["material-condition-report"],
      "internal-review",
      undefined,
      undefined,
      [{ target: "material-condition-report", path: "reports/carport-material-condition-report.json", hash: reportArtifactHash }]
    );

    expect(deliveryPackage.deliveryTargets).toContainEqual({
      target: "material-condition-report",
      required: true,
      status: "ready",
      artifactType: "material-condition-report",
      path: "reports/carport-material-condition-report.json",
      hash: reportArtifactHash,
      message: "Material and condition report is indexed from caller-provided artifact metadata."
    });
    expect(deliveryPackage.sourceTraceIndex.entries).toContainEqual({
      sourceId: "material-condition-report",
      sourceType: "delivery-target",
      sourceCoverage: "deliveryTargets",
      label: "material-condition-report delivery target",
      status: "ready",
      path: "reports/carport-material-condition-report.json",
      hash: reportArtifactHash
    });
  });

  it("blocks a separately supplied material-condition report artifact without its own hash", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-southwest-premium",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 60, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5200, intensity: 0.85, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(
      capture,
      renderManifest,
      ["material-condition-report"],
      "internal-review",
      undefined,
      undefined,
      [{ target: "material-condition-report", path: "reports/carport-material-condition-report.json" }]
    );

    expect(deliveryPackage.deliveryTargets).toContainEqual({
      target: "material-condition-report",
      required: true,
      status: "ready",
      artifactType: "material-condition-report",
      path: "reports/carport-material-condition-report.json",
      message: "Material and condition report is indexed from caller-provided artifact metadata."
    });
    expect(deliveryPackage.qualityGates.blocking).toContainEqual({
      id: "delivery-target:material-condition-report:hash",
      code: "delivery_artifact_hash_missing",
      message: "Customer delivery artifact 'material-condition-report' must include a content hash before it can be trusted in a package manifest."
    });
  });

  it("rejects delivery package source trace hashes that drift from delivery target hashes", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-southwest-premium",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 60, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5200, intensity: 0.85, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(
      capture,
      renderManifest,
      ["material-condition-report"],
      "internal-review",
      undefined,
      undefined,
      [{ target: "material-condition-report", path: "reports/carport-material-condition-report.json", hash: "b".repeat(64) }]
    );
    const brokenPackage = JSON.parse(JSON.stringify(deliveryPackage)) as typeof deliveryPackage;
    const reportTraceEntry = brokenPackage.sourceTraceIndex.entries.find((entry) => entry.sourceId === "material-condition-report");
    if (!reportTraceEntry?.hash) {
      throw new Error("Expected material-condition-report source trace hash in fixture package");
    }
    reportTraceEntry.hash = "c".repeat(64);

    expect(() => DigitalViewingDeliveryPackageManifestSchema.parse(brokenPackage)).toThrow(/sourceTraceIndex delivery target hashes must match deliveryTargets/);
  });

  it("rejects delivery package source trace paths that drift from delivery target paths", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-southwest-premium",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 60, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5200, intensity: 0.85, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(
      capture,
      renderManifest,
      ["material-condition-report"],
      "internal-review",
      undefined,
      undefined,
      [{ target: "material-condition-report", path: "reports/carport-material-condition-report.json", hash: "b".repeat(64) }]
    );
    const brokenPackage = JSON.parse(JSON.stringify(deliveryPackage)) as typeof deliveryPackage;
    const reportTraceEntry = brokenPackage.sourceTraceIndex.entries.find((entry) => entry.sourceId === "material-condition-report");
    if (!reportTraceEntry?.path) {
      throw new Error("Expected material-condition-report source trace path in fixture package");
    }
    reportTraceEntry.path = "reports/stale-material-condition-report.json";

    expect(() => DigitalViewingDeliveryPackageManifestSchema.parse(brokenPackage)).toThrow(/sourceTraceIndex delivery target paths must match deliveryTargets/);
  });

  it("rejects delivery package source trace statuses that drift from delivery target statuses", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-southwest-premium",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 60, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5200, intensity: 0.85, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(
      capture,
      renderManifest,
      ["material-condition-report"],
      "internal-review",
      undefined,
      undefined,
      [{ target: "material-condition-report", path: "reports/carport-material-condition-report.json", hash: "b".repeat(64) }]
    );
    const brokenPackage = JSON.parse(JSON.stringify(deliveryPackage)) as typeof deliveryPackage;
    const reportTraceEntry = brokenPackage.sourceTraceIndex.entries.find((entry) => entry.sourceId === "material-condition-report");
    if (!reportTraceEntry) {
      throw new Error("Expected material-condition-report source trace entry in fixture package");
    }
    reportTraceEntry.status = "not-requested";

    expect(() => DigitalViewingDeliveryPackageManifestSchema.parse(brokenPackage)).toThrow(/sourceTraceIndex delivery target statuses must match deliveryTargets/);
  });

  it("rejects delivery package delivery targets that are missing from source trace index", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-southwest-premium",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 60, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5200, intensity: 0.85, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(
      capture,
      renderManifest,
      ["material-condition-report"],
      "internal-review",
      undefined,
      undefined,
      [{ target: "material-condition-report", path: "reports/carport-material-condition-report.json", hash: "b".repeat(64) }]
    );
    const brokenPackage = JSON.parse(JSON.stringify(deliveryPackage)) as typeof deliveryPackage;
    brokenPackage.sourceTraceIndex.entries = brokenPackage.sourceTraceIndex.entries.filter((entry) => entry.sourceId !== "material-condition-report");
    brokenPackage.sourceTraceIndex.entryCount = brokenPackage.sourceTraceIndex.entries.length;

    expect(() => DigitalViewingDeliveryPackageManifestSchema.parse(brokenPackage)).toThrow(/sourceTraceIndex must include deliveryTargets/);
  });

  it("rejects delivery package source trace delivery targets that are not declared delivery targets", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-southwest-premium",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 60, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5200, intensity: 0.85, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(
      capture,
      renderManifest,
      ["material-condition-report"],
      "internal-review",
      undefined,
      undefined,
      [{ target: "material-condition-report", path: "reports/carport-material-condition-report.json", hash: "b".repeat(64) }]
    );
    const brokenPackage = JSON.parse(JSON.stringify(deliveryPackage)) as typeof deliveryPackage;
    const reportTraceEntry = brokenPackage.sourceTraceIndex.entries.find((entry) => entry.sourceId === "material-condition-report");
    if (!reportTraceEntry) {
      throw new Error("Expected material-condition-report source trace entry in fixture package");
    }
    brokenPackage.sourceTraceIndex.entries.push({
      ...reportTraceEntry,
      sourceId: "ghost-delivery-target",
      label: "ghost-delivery-target delivery target",
      path: "reports/ghost-delivery-target.json",
      hash: "c".repeat(64)
    });
    brokenPackage.sourceTraceIndex.entries.sort((left, right) => `${left.sourceType}:${left.sourceId}`.localeCompare(`${right.sourceType}:${right.sourceId}`));
    brokenPackage.sourceTraceIndex.entryCount = brokenPackage.sourceTraceIndex.entries.length;

    expect(() => DigitalViewingDeliveryPackageManifestSchema.parse(brokenPackage)).toThrow(/sourceTraceIndex delivery target entries must exist in deliveryTargets/);
  });

  it("rejects delivery package delivery targets with duplicate target ids", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-southwest-premium",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 60, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5200, intensity: 0.85, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(
      capture,
      renderManifest,
      ["material-condition-report"],
      "internal-review",
      undefined,
      undefined,
      [{ target: "material-condition-report", path: "reports/carport-material-condition-report.json", hash: "b".repeat(64) }]
    );
    const brokenPackage = JSON.parse(JSON.stringify(deliveryPackage)) as typeof deliveryPackage;
    const reportDeliveryTarget = brokenPackage.deliveryTargets.find((target) => target.target === "material-condition-report");
    if (!reportDeliveryTarget) {
      throw new Error("Expected material-condition-report delivery target in fixture package");
    }
    brokenPackage.deliveryTargets.push({
      ...reportDeliveryTarget,
      path: "reports/duplicate-material-condition-report.json",
      hash: "c".repeat(64)
    });

    expect(() => DigitalViewingDeliveryPackageManifestSchema.parse(brokenPackage)).toThrow(/deliveryTargets target ids must be unique/);
  });

  it("rejects delivery package delivery targets that are not in deterministic order", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-southwest-premium",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 60, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5200, intensity: 0.85, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(
      capture,
      renderManifest,
      ["material-condition-report", "photoreal-render"],
      "internal-review",
      undefined,
      undefined,
      [{ target: "material-condition-report", path: "reports/carport-material-condition-report.json", hash: "b".repeat(64) }]
    );
    const brokenPackage = JSON.parse(JSON.stringify(deliveryPackage)) as typeof deliveryPackage;
    brokenPackage.deliveryTargets.reverse();

    expect(() => DigitalViewingDeliveryPackageManifestSchema.parse(brokenPackage)).toThrow(/deliveryTargets must be sorted in deterministic target order/);
  });

  it("rejects duplicate caller-provided delivery artifact targets before packaging", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-southwest-premium",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 60, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5200, intensity: 0.85, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });

    expect(() => buildDigitalViewingDeliveryPackageManifest(
      capture,
      renderManifest,
      ["material-condition-report"],
      "internal-review",
      undefined,
      undefined,
      [
        { target: "material-condition-report", path: "reports/carport-material-condition-report.json", hash: "b".repeat(64) },
        { target: "material-condition-report", path: "reports/duplicate-material-condition-report.json", hash: "c".repeat(64) }
      ]
    )).toThrow(/deliveryArtifacts target ids must be unique/);
  });

  it("rejects caller-provided delivery artifacts outside requested delivery targets before packaging", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-southwest-premium",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 60, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5200, intensity: 0.85, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });

    expect(() => buildDigitalViewingDeliveryPackageManifest(
      capture,
      renderManifest,
      ["material-condition-report"],
      "internal-review",
      undefined,
      undefined,
      [
        { target: "material-condition-report", path: "reports/carport-material-condition-report.json", hash: "b".repeat(64) },
        { target: "glb", path: "models/carport.glb", hash: "c".repeat(64) }
      ]
    )).toThrow(/deliveryArtifacts target ids must be requested deliveryTargets/);
  });

  it("rejects delivery package sourceIds that do not resolve in the source trace index", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-southwest-premium",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 60, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5200, intensity: 0.85, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, renderManifest, ["photoreal-render"]);
    const brokenPackage = JSON.parse(JSON.stringify(deliveryPackage)) as typeof deliveryPackage;
    brokenPackage.viewerLayerCoverage.entries[0]?.sourceIds.push("missing-source-id");

    expect(() => DigitalViewingDeliveryPackageManifestSchema.parse(brokenPackage)).toThrow(/sourceIds must resolve in sourceTraceIndex/);
  });

  it("rejects delivery packages whose source trace entry count does not match entries", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-southwest-premium",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 60, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5200, intensity: 0.85, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, renderManifest, ["photoreal-render"]);
    const brokenPackage = JSON.parse(JSON.stringify(deliveryPackage)) as typeof deliveryPackage;
    brokenPackage.sourceTraceIndex.entryCount += 1;

    expect(() => DigitalViewingDeliveryPackageManifestSchema.parse(brokenPackage)).toThrow(/sourceTraceIndex entryCount must equal entries length/);
  });

  it("rejects delivery packages with duplicate source trace ids", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-southwest-premium",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 60, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5200, intensity: 0.85, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, renderManifest, ["photoreal-render"]);
    const brokenPackage = JSON.parse(JSON.stringify(deliveryPackage)) as typeof deliveryPackage;
    const duplicateSourceId = brokenPackage.sourceTraceIndex.entries[0]?.sourceId;
    if (!duplicateSourceId || !brokenPackage.sourceTraceIndex.entries[1]) {
      throw new Error("Expected at least two source trace entries in fixture package");
    }
    brokenPackage.sourceTraceIndex.entries[1].sourceId = duplicateSourceId;

    expect(() => DigitalViewingDeliveryPackageManifestSchema.parse(brokenPackage)).toThrow(/sourceTraceIndex sourceIds must be unique/);
  });

  it("rejects delivery packages with unsorted source trace entries", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-southwest-premium",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 60, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5200, intensity: 0.85, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, renderManifest, ["photoreal-render"]);
    const brokenPackage = JSON.parse(JSON.stringify(deliveryPackage)) as typeof deliveryPackage;
    if (!brokenPackage.sourceTraceIndex.entries[0] || !brokenPackage.sourceTraceIndex.entries[1]) {
      throw new Error("Expected at least two source trace entries in fixture package");
    }
    [
      brokenPackage.sourceTraceIndex.entries[0],
      brokenPackage.sourceTraceIndex.entries[1]
    ] = [
      brokenPackage.sourceTraceIndex.entries[1],
      brokenPackage.sourceTraceIndex.entries[0]
    ];

    expect(() => DigitalViewingDeliveryPackageManifestSchema.parse(brokenPackage)).toThrow(/sourceTraceIndex entries must be sorted/);
  });

  it("rejects delivery packages whose source trace coverage does not match source type", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-southwest-premium",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 60, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5200, intensity: 0.85, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, renderManifest, ["photoreal-render"]);
    const brokenPackage = JSON.parse(JSON.stringify(deliveryPackage)) as typeof deliveryPackage;
    const materialEntry = brokenPackage.sourceTraceIndex.entries.find((entry) => entry.sourceType === "material");
    if (!materialEntry) {
      throw new Error("Expected material source trace entry in fixture package");
    }
    materialEntry.sourceCoverage = "deliveryTargets";

    expect(() => DigitalViewingDeliveryPackageManifestSchema.parse(brokenPackage)).toThrow(/sourceTraceIndex sourceCoverage must match sourceType/);
  });

  it("rejects delivery packages whose source trace status does not match source type", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-southwest-premium",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 60, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5200, intensity: 0.85, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, renderManifest, ["photoreal-render"]);
    const brokenPackage = JSON.parse(JSON.stringify(deliveryPackage)) as typeof deliveryPackage;
    const captureEntry = brokenPackage.sourceTraceIndex.entries.find((entry) => entry.sourceType === "capture-shot");
    if (!captureEntry) {
      throw new Error("Expected capture-shot source trace entry in fixture package");
    }
    captureEntry.status = "ready";

    expect(() => DigitalViewingDeliveryPackageManifestSchema.parse(brokenPackage)).toThrow(/sourceTraceIndex status must match sourceType/);
  });

  it("rejects ready file delivery target source trace entries without an artifact path", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-southwest-premium",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 60, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5200, intensity: 0.85, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, renderManifest, ["photoreal-render"]);
    const brokenPackage = JSON.parse(JSON.stringify(deliveryPackage)) as typeof deliveryPackage;
    const deliveryTargetEntry = brokenPackage.sourceTraceIndex.entries.find((entry) => entry.sourceType === "delivery-target" && entry.sourceId === "photoreal-render");
    if (!deliveryTargetEntry?.path) {
      throw new Error("Expected ready photoreal-render source trace entry with path in fixture package");
    }
    delete deliveryTargetEntry.path;
    brokenPackage.evidenceHealthSummary.evidencePathCount -= 1;
    const deliveryTargetSection = brokenPackage.evidenceHealthSummary.sections.find((section) => section.section === "delivery-targets");
    if (!deliveryTargetSection) {
      throw new Error("Expected delivery-targets evidence health section");
    }
    deliveryTargetSection.evidencePathCount -= 1;

    expect(() => DigitalViewingDeliveryPackageManifestSchema.parse(brokenPackage)).toThrow(/sourceTraceIndex ready file delivery targets must include artifact paths/);
  });

  it("rejects delivery packages with duplicate source trace evidence paths", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-southwest-premium",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 60, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5200, intensity: 0.85, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, renderManifest, ["photoreal-render"]);
    const brokenPackage = JSON.parse(JSON.stringify(deliveryPackage)) as typeof deliveryPackage;
    const evidenceEntry = brokenPackage.sourceTraceIndex.entries.find((entry) => (entry.evidencePaths?.length ?? 0) > 0);
    if (!evidenceEntry?.evidencePaths?.[0]) {
      throw new Error("Expected source trace entry with evidence paths in fixture package");
    }
    evidenceEntry.evidencePaths.push(evidenceEntry.evidencePaths[0]);
    const sectionBySourceType = {
      "capture-shot": "capture-shots",
      measurement: "measurements",
      material: "materials",
      condition: "conditions",
      "delivery-target": "delivery-targets"
    } as const;
    const evidenceSection = brokenPackage.evidenceHealthSummary.sections.find((section) =>
      section.section === sectionBySourceType[evidenceEntry.sourceType]
    );
    if (!evidenceSection) {
      throw new Error("Expected matching evidence health section");
    }
    evidenceSection.evidencePathCount += 1;
    brokenPackage.evidenceHealthSummary.evidencePathCount += 1;

    expect(() => DigitalViewingDeliveryPackageManifestSchema.parse(brokenPackage)).toThrow(/sourceTraceIndex evidencePaths must be unique and sorted/);
  });

  it("rejects delivery packages whose source trace path does not match first evidence path", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-southwest-premium",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 60, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5200, intensity: 0.85, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, renderManifest, ["photoreal-render"]);
    const brokenPackage = JSON.parse(JSON.stringify(deliveryPackage)) as typeof deliveryPackage;
    const evidenceEntry = brokenPackage.sourceTraceIndex.entries.find((entry) => (entry.evidencePaths?.length ?? 0) > 0 && entry.path);
    if (!evidenceEntry?.evidencePaths?.[0]) {
      throw new Error("Expected source trace entry with path and evidence paths in fixture package");
    }
    evidenceEntry.path = "photos/not-the-primary-source.jpg";

    expect(() => DigitalViewingDeliveryPackageManifestSchema.parse(brokenPackage)).toThrow(/sourceTraceIndex path must match first evidencePath/);
  });

  it("rejects delivery packages with source trace evidence paths outside material and condition entries", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-southwest-premium",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 60, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5200, intensity: 0.85, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, renderManifest, ["photoreal-render"]);
    const brokenPackage = JSON.parse(JSON.stringify(deliveryPackage)) as typeof deliveryPackage;
    const captureEntry = brokenPackage.sourceTraceIndex.entries.find((entry) => entry.sourceType === "capture-shot" && entry.path);
    if (!captureEntry?.path) {
      throw new Error("Expected capture-shot source trace entry with path in fixture package");
    }
    captureEntry.evidencePaths = [captureEntry.path];

    expect(() => DigitalViewingDeliveryPackageManifestSchema.parse(brokenPackage)).toThrow(/sourceTraceIndex evidencePaths are only allowed for material and condition entries/);
  });

  it("rejects delivery packages whose material fidelity counts do not match entries", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-southwest-premium",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 60, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5200, intensity: 0.85, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, renderManifest, ["photoreal-render"]);
    const brokenPackage = JSON.parse(JSON.stringify(deliveryPackage)) as typeof deliveryPackage;
    brokenPackage.materialRenderCoverage.materialFidelityReadyCount += 1;

    expect(() => DigitalViewingDeliveryPackageManifestSchema.parse(brokenPackage)).toThrow(/materialRenderCoverage materialFidelity counts must match entries/);
  });

  it("rejects delivery packages whose material render coverage counts do not match entries", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-southwest-premium",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 60, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5200, intensity: 0.85, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, renderManifest, ["photoreal-render"]);
    const brokenPackage = JSON.parse(JSON.stringify(deliveryPackage)) as typeof deliveryPackage;
    brokenPackage.materialRenderCoverage.appliedMaterialCount += 1;

    expect(() => DigitalViewingDeliveryPackageManifestSchema.parse(brokenPackage)).toThrow(/materialRenderCoverage counts must match entries/);
  });

  it("rejects delivery package material entries whose source photo evidence does not match source photos", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-southwest-premium",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 60, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5200, intensity: 0.85, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, renderManifest, ["photoreal-render"]);
    const brokenPackage = JSON.parse(JSON.stringify(deliveryPackage)) as typeof deliveryPackage;
    const materialEntry = brokenPackage.materialRenderCoverage.entries[0];
    if (!materialEntry) {
      throw new Error("Expected material entry in fixture package");
    }
    materialEntry.sourcePhotoEvidenceCount += 1;

    expect(() => DigitalViewingDeliveryPackageManifestSchema.parse(brokenPackage)).toThrow(/materialRenderCoverage source photo evidence must match sourcePhotos/);
  });

  it("rejects delivery package material entries with duplicate source photos", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-southwest-premium",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 60, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5200, intensity: 0.85, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, renderManifest, ["photoreal-render"]);
    const brokenPackage = JSON.parse(JSON.stringify(deliveryPackage)) as typeof deliveryPackage;
    const materialEntry = brokenPackage.materialRenderCoverage.entries.find((entry) => entry.sourcePhotos.length > 0);
    if (!materialEntry) {
      throw new Error("Expected material entry with source photos in fixture package");
    }
    materialEntry.sourcePhotos.push(materialEntry.sourcePhotos[0] ?? "photos/carport-south.jpg");
    materialEntry.sourcePhotoEvidenceCount = materialEntry.sourcePhotos.length;

    expect(() => DigitalViewingDeliveryPackageManifestSchema.parse(brokenPackage)).toThrow(/materialRenderCoverage sourcePhotos must be unique and sorted/);
  });

  it("rejects delivery package material entries marked ready while fidelity issues remain", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-southwest-premium",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 60, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5200, intensity: 0.85, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const assetBundle = buildDigitalViewingAssetBundleManifest(capture, renderManifest, {
      existingFiles: [
        "photos/carport-detail-panel.jpg",
        "photos/carport-east.jpg",
        "photos/carport-south.jpg",
        "photos/carport-west.jpg",
        "textures/carport-stone-foundation-normal.png",
        "textures/carport-stone-foundation-roughness.png",
        "textures/carport-white-panel-normal.png",
        "textures/carport-white-panel-roughness.png"
      ]
    });
    const executedWithoutSurfaceMappingProof = {
      ...renderManifest,
      blenderExecution: {
        measurementApplication: {
          applied: blenderMeasurementApplicationsFor(capture)
        },
        materialApplication: {
          applied: [
            {
              object: "foundation-wall",
              materialId: "dark-stone-foundation",
              appearanceCalibration: {
                method: "white-balance-reference",
                sourcePhoto: "photos/carport-south.jpg",
                illuminant: "daylight",
                confidence: "medium"
              }
            },
            {
              object: "cladding-southwest",
              materialId: "painted-white-wood-panel",
              appearanceCalibration: {
                method: "white-balance-reference",
                sourcePhoto: "photos/carport-west.jpg",
                illuminant: "daylight",
                confidence: "medium"
              }
            }
          ],
          textures: {
            applied: [
              { path: "textures/carport-stone-foundation-normal.png", type: "normal", colorSpace: "Non-Color", scaleMm: 500 },
              { path: "textures/carport-stone-foundation-roughness.png", type: "roughness", colorSpace: "Non-Color", scaleMm: 500 },
              { path: "textures/carport-white-panel-normal.png", type: "normal", colorSpace: "Non-Color", scaleMm: 900 },
              { path: "textures/carport-white-panel-roughness.png", type: "roughness", colorSpace: "Non-Color", scaleMm: 900 }
            ]
          }
        },
        conditionApplication: {
          applied: [
            { conditionId: "white-panel-weathering", hostElementId: "cladding-southwest" }
          ]
        },
        assetBundle: {
          manifestType: "digital-viewing-asset-bundle" as const,
          ready: true,
          assetBundleHash: assetBundle.hashes.assetBundleHash,
          requiredCount: assetBundle.summary.requiredCount,
          missingCount: assetBundle.summary.missingCount
        }
      }
    };
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, executedWithoutSurfaceMappingProof, undefined, undefined, assetBundle);
    const brokenPackage = JSON.parse(JSON.stringify(deliveryPackage)) as typeof deliveryPackage;
    const blockedEntry = brokenPackage.materialRenderCoverage.entries.find((entry) => entry.materialFidelityStatus === "blocked");
    if (!blockedEntry) {
      throw new Error("Expected blocked material entry in fixture package");
    }
    blockedEntry.materialFidelityStatus = "ready";
    brokenPackage.materialRenderCoverage.materialFidelityReadyCount += 1;
    brokenPackage.materialRenderCoverage.materialFidelityBlockedCount -= 1;

    expect(() => DigitalViewingDeliveryPackageManifestSchema.parse(brokenPackage)).toThrow(/materialRenderCoverage materialFidelityStatus must match issues/);
  });

  it("rejects delivery packages whose evidence health total does not match the source trace index", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-southwest-premium",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 60, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5200, intensity: 0.85, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, renderManifest, ["photoreal-render"]);
    const brokenPackage = JSON.parse(JSON.stringify(deliveryPackage)) as typeof deliveryPackage;
    brokenPackage.evidenceHealthSummary.indexedSourceCount += 1;

    expect(() => DigitalViewingDeliveryPackageManifestSchema.parse(brokenPackage)).toThrow(/evidenceHealthSummary indexedSourceCount must equal sourceTraceIndex entryCount/);
  });

  it("rejects delivery packages whose evidence health total counts do not match sections", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-southwest-premium",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 60, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5200, intensity: 0.85, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, renderManifest, ["photoreal-render"]);
    const brokenPackage = JSON.parse(JSON.stringify(deliveryPackage)) as typeof deliveryPackage;
    brokenPackage.evidenceHealthSummary.readyEvidenceCount += 1;

    expect(() => DigitalViewingDeliveryPackageManifestSchema.parse(brokenPackage)).toThrow(/evidenceHealthSummary total counts must equal section sums/);
  });

  it("rejects delivery packages whose evidence health path counts do not match the source trace index", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-southwest-premium",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 60, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5200, intensity: 0.85, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, renderManifest, ["photoreal-render"]);
    const brokenPackage = JSON.parse(JSON.stringify(deliveryPackage)) as typeof deliveryPackage;
    const materialSection = brokenPackage.evidenceHealthSummary.sections.find((section) => section.section === "materials");
    if (!materialSection) {
      throw new Error("Expected materials evidence health section");
    }
    materialSection.evidencePathCount += 1;

    expect(() => DigitalViewingDeliveryPackageManifestSchema.parse(brokenPackage)).toThrow(/evidenceHealthSummary section materials path count must match sourceTraceIndex/);
  });

  it("rejects delivery packages whose evidence health status does not match derived readiness", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-southwest-premium",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 60, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5200, intensity: 0.85, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, renderManifest, ["photoreal-render"]);
    const brokenPackage = JSON.parse(JSON.stringify(deliveryPackage)) as typeof deliveryPackage;
    brokenPackage.evidenceHealthSummary.status = "ready";

    expect(() => DigitalViewingDeliveryPackageManifestSchema.parse(brokenPackage)).toThrow(/evidenceHealthSummary status must match derived readiness/);
  });

  it("rejects delivery packages with duplicate evidence health sections", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-southwest-premium",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 60, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5200, intensity: 0.85, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, renderManifest, ["photoreal-render"]);
    const brokenPackage = JSON.parse(JSON.stringify(deliveryPackage)) as typeof deliveryPackage;
    brokenPackage.evidenceHealthSummary.sections.push({
      section: "measurements",
      status: "ready",
      indexedSourceCount: 0,
      readyEvidenceCount: 0,
      blockedEvidenceCount: 0,
      missingEvidenceCount: 0,
      evidencePathCount: 0
    });

    expect(() => DigitalViewingDeliveryPackageManifestSchema.parse(brokenPackage)).toThrow(/evidenceHealthSummary sections must be unique/);
  });

  it("rejects delivery packages whose evidence health warning count does not match quality gates", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-southwest-premium",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 60, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5200, intensity: 0.85, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, renderManifest, ["photoreal-render"]);
    const brokenPackage = JSON.parse(JSON.stringify(deliveryPackage)) as typeof deliveryPackage;
    brokenPackage.evidenceHealthSummary.warningCount += 1;

    expect(() => DigitalViewingDeliveryPackageManifestSchema.parse(brokenPackage)).toThrow(/evidenceHealthSummary warningCount must equal qualityGates warnings length/);
  });

  it("rejects delivery packages whose evidence health section status does not match counts", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-southwest-premium",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 60, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5200, intensity: 0.85, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, renderManifest, ["photoreal-render"]);
    const brokenPackage = JSON.parse(JSON.stringify(deliveryPackage)) as typeof deliveryPackage;
    const measurementSection = brokenPackage.evidenceHealthSummary.sections.find((section) => section.section === "measurements");
    if (!measurementSection) {
      throw new Error("Expected measurements evidence health section in fixture package");
    }
    measurementSection.status = measurementSection.status === "ready" ? "blocked" : "ready";

    expect(() => DigitalViewingDeliveryPackageManifestSchema.parse(brokenPackage)).toThrow(/evidenceHealthSummary section measurements status must match counts/);
  });

  it("rejects delivery packages whose evidence health sections do not match the source trace index", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-southwest-premium",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 60, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5200, intensity: 0.85, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, renderManifest, ["photoreal-render"]);
    const brokenPackage = JSON.parse(JSON.stringify(deliveryPackage)) as typeof deliveryPackage;
    const measurementSection = brokenPackage.evidenceHealthSummary.sections.find((section) => section.section === "measurements");
    if (!measurementSection) {
      throw new Error("Expected measurements evidence health section in fixture package");
    }
    measurementSection.readyEvidenceCount += 1;

    expect(() => DigitalViewingDeliveryPackageManifestSchema.parse(brokenPackage)).toThrow(/evidenceHealthSummary section measurements counts must match sourceTraceIndex/);
  });

  it("blocks photoreal customer readiness when Blender render quality is not proven", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const assetBundle = buildDigitalViewingAssetBundleManifest(capture, renderManifest, {
      existingFiles: [
        "photos/carport-detail-panel.jpg",
        "photos/carport-east.jpg",
        "photos/carport-south.jpg",
        "photos/carport-west.jpg",
        "textures/carport-stone-foundation-normal.png",
        "textures/carport-stone-foundation-roughness.png",
        "textures/carport-white-panel-normal.png",
        "textures/carport-white-panel-roughness.png"
      ],
      assetFiles: assetFilesFor(FullCarportAssetPaths)
    });
    const stone = renderManifest.materials.find((material) => material.materialId === "dark-stone-foundation");
    const wood = renderManifest.materials.find((material) => material.materialId === "painted-white-wood-panel");
    expect(stone).toBeDefined();
    expect(wood).toBeDefined();
    const executedWithoutRenderQuality = {
      ...renderManifest,
      blenderExecution: {
        measurementApplication: {
          applied: blenderMeasurementApplicationsFor(capture)
        },
        materialApplication: {
          applied: [
            {
              object: "foundation-wall",
              materialId: "dark-stone-foundation",
              sourcePhotoIdentities: materialSourcePhotoIdentitiesFor(renderManifest, assetBundle, "dark-stone-foundation"),
              pbr: stone!.pbr,
              pbrReadback: {
                sourceOfTruth: "read-from-blender-material-node-values-after-application",
                fields: ["baseColor", "metallic", "normalSource", "roughness", "specular", "textureScaleMm", "transmission"],
                values: stone!.pbr
              },
              surfaceMapping: {
                projection: "box",
                faces: ["front", "left", "right"],
                scaleMm: 500,
                rotationDeg: 0,
                sourcePhoto: "photos/carport-south.jpg"
              },
              appearanceCalibration: {
                method: "white-balance-reference",
                sourcePhoto: "photos/carport-south.jpg",
                illuminant: "daylight",
                confidence: "medium"
              }
            },
            {
              object: "cladding-southwest",
              materialId: "painted-white-wood-panel",
              sourcePhotoIdentities: materialSourcePhotoIdentitiesFor(renderManifest, assetBundle, "painted-white-wood-panel"),
              pbr: wood!.pbr,
              pbrReadback: {
                sourceOfTruth: "read-from-blender-material-node-values-after-application",
                fields: ["baseColor", "metallic", "normalSource", "roughness", "specular", "textureScaleMm", "transmission"],
                values: wood!.pbr
              },
              surfaceMapping: {
                projection: "planar",
                faces: ["front"],
                scaleMm: 900,
                rotationDeg: 0,
                sourcePhoto: "photos/carport-west.jpg"
              },
              appearanceCalibration: {
                method: "white-balance-reference",
                sourcePhoto: "photos/carport-west.jpg",
                illuminant: "daylight",
                confidence: "medium"
              }
            }
          ],
          textures: {
            applied: [
              { path: "textures/carport-stone-foundation-normal.png", type: "normal", scaleMm: 500 },
              { path: "textures/carport-stone-foundation-roughness.png", type: "roughness", scaleMm: 500 },
              { path: "textures/carport-white-panel-normal.png", type: "normal", scaleMm: 900 },
              { path: "textures/carport-white-panel-roughness.png", type: "roughness", scaleMm: 900 }
            ]
          }
        },
        conditionApplication: {
          applied: [
            {
              conditionId: "white-panel-weathering",
              hostElementId: "cladding-southwest",
              face: "front",
              sourcePhotoIdentities: conditionSourcePhotoIdentitiesFor(capture, assetBundle, "white-panel-weathering"),
              surfacePlacement: {
                hostElementId: "cladding-southwest",
                face: "front",
                u: 0.5,
                v: 0.52,
                widthMm: 1800,
                heightMm: 40,
                rotationDeg: 0
              },
              visibilityProof: {
                sourceOfTruth: "created-visible-blender-overlay-object",
                objectName: "condition-white-panel-weathering",
                materialName: "condition-white-panel-weathering",
                visibleInRender: true,
                dimensionsMm: {
                  widthMm: 1800,
                  heightMm: 40
                },
                materialReadback: {
                  sourceOfTruth: "read-from-blender-condition-material-after-application",
                  baseColor: "#b0b0a8",
                  alpha: 1,
                  roughness: 0.82,
                  metallic: 0,
                  conditionType: "wear",
                  severity: "low"
                }
              }
            }
          ]
        },
        camera: {
          cameraName: "Measured_Render_south",
          sector: "south",
          mode: "perspective",
          referencePhoto: "photos/carport-south.jpg",
          referencePhotoIdentity: photoIdentityFor(assetBundle, "photos/carport-south.jpg")
        },
        lighting: {
          lights: ["Measured_Render_Key_Area", "Measured_Render_Fill_Area"],
          environment: "site-reference",
          referencePhoto: "photos/carport-south.jpg",
          lightingReference: renderManifest.lightingReference?.lightingReference,
          colorReference: renderManifest.lightingReference?.colorReference,
          whiteBalanceKelvin: renderManifest.lightingReference?.whiteBalanceKelvin,
          exposureEv: renderManifest.lightingReference?.exposureEv,
          referencePhotoIdentity: photoIdentityFor(assetBundle, "photos/carport-south.jpg")
        },
        renderArtifact: {
          path: "renders/carport-southwest.png",
          sizeBytes: 9283,
          sha256: "a".repeat(64),
          width: 1600,
          height: 1000
        },
        assetBundle: {
          manifestType: "digital-viewing-asset-bundle" as const,
          ready: true,
          assetBundleHash: assetBundle.hashes.assetBundleHash,
          requiredCount: assetBundle.summary.requiredCount,
          missingCount: assetBundle.summary.missingCount
        }
      }
    };
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(
      capture,
      executedWithoutRenderQuality,
      undefined,
      undefined,
      assetBundle,
      "asset-bundles/carport-southwest.asset-bundle.json"
    );

    expect(deliveryPackage.qualityGates.ready).toBe(false);
    expect(deliveryPackage.qualityGates.blocking).toContainEqual({
      id: "render-manifest:render-quality",
      code: "render_quality_not_ready",
      message: "Photoreal customer delivery packages require Blender render quality execution to satisfy the declared render profile."
    });
    expect(deliveryPackage.photorealQualityChecklist).toContainEqual(
      expect.objectContaining({
        check: "textures",
        status: "failed",
        evidence: "4 declared texture maps applied with physical scale, matched color space, and file identity"
      })
    );
    expect(deliveryPackage.photorealQualityChecklist.filter((entry) => entry.check !== "textures").every((entry) => entry.status === "passed")).toBe(true);
    expect(deliveryPackage.renderQualityCoverage.status).toBe("missing-execution");
    expect(deliveryPackage.viewerLayerCoverage.entries).toContainEqual({
      layer: "photoreal-scene",
      required: true,
      status: "blocked",
      sourceIds: ["photoreal-render"],
      evidence: "render quality missing-execution"
    });
    expect(deliveryPackage.customerReadinessSummary.status).toBe("blocked");
    expect(deliveryPackage.customerReadinessSummary.nextActions).toContain(
      "Resolve render-quality: Blender render settings must be customer-ready before photoreal viewing."
    );
  });

  it("blocks premium photoreal delivery when Blender render output identity is missing", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const executedWithoutRenderArtifact = {
      ...renderManifest,
      blenderExecution: {
        renderQuality: {
          renderer: "cycles",
          samples: 64,
          denoise: true,
          resolution: { width: 1600, height: 1000 },
          filmTransparent: false,
          viewTransform: "Filmic",
          look: "Medium High Contrast",
          worldColor: "#c7d1db"
        }
      }
    };
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, executedWithoutRenderArtifact, ["photoreal-render"]);

    expect(deliveryPackage.qualityGates.ready).toBe(false);
    expect(deliveryPackage.qualityGates.blocking).toContainEqual({
      id: "render-manifest:render-artifact",
      code: "render_artifact_identity_missing",
      message: "Photoreal customer delivery packages require Blender to report the exact rendered artifact path, byte size, and SHA-256."
    });
    expect(deliveryPackage.renderExecutionCoverage.renderArtifact).toEqual({
      declaredPath: "renders/carport-southwest.png",
      declaredWidth: 1600,
      declaredHeight: 1000,
      executedPath: undefined,
      sizeBytes: undefined,
      sha256: undefined,
      executedWidth: undefined,
      executedHeight: undefined,
      status: "missing-execution"
    });
    expect(deliveryPackage.photorealQualityChecklist).toContainEqual(
      expect.objectContaining({
        check: "render-output",
        status: "failed",
        evidence: "renders/carport-southwest.png render artifact identity matched Blender output"
      })
    );
    expect(deliveryPackage.customerReadinessSummary.status).toBe("blocked");
  });

  it("blocks premium photoreal delivery when Blender reference comparison evidence is missing", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const executedWithoutReferenceComparison = {
      ...renderManifest,
      blenderExecution: {
        renderQuality: {
          renderer: "cycles",
          samples: 64,
          denoise: true,
          resolution: { width: 1600, height: 1000 },
          filmTransparent: false,
          viewTransform: "Filmic",
          look: "Medium High Contrast",
          exposure: 0,
          gamma: 1,
          worldColor: "#c7d1db"
        },
        renderArtifact: {
          path: "renders/carport-southwest.png",
          sizeBytes: 9283,
          sha256: "a".repeat(64),
          width: 1600,
          height: 1000
        }
      }
    };
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, executedWithoutReferenceComparison, ["photoreal-render"]);

    expect(deliveryPackage.renderReferenceComparisonCoverage).toEqual({
      sourceOfTruth: "derived-from-render-artifact-reference-photo-and-blender-comparison-metadata",
      required: true,
      referencePhoto: "photos/carport-south.jpg",
      renderPath: "renders/carport-southwest.png",
      method: undefined,
      comparisonMethodTier: "none",
      requiredComparisonMethodTier: "structural",
      comparisonMethodTierStatus: "below-required",
      score: undefined,
      threshold: undefined,
      minimumRequiredThreshold: DigitalViewingExports.MinimumStructuralReferenceComparisonThreshold,
      status: "missing-execution",
      evidence: "reference comparison missing for renders/carport-southwest.png against photos/carport-south.jpg"
    });
    expect(deliveryPackage.qualityGates.ready).toBe(false);
    expect(deliveryPackage.qualityGates.blocking).toContainEqual({
      id: "render-manifest:reference-comparison",
      code: "render_reference_comparison_missing",
      message: "Photoreal customer delivery packages require Blender comparison metadata tying the rendered output back to the reference photo."
    });
    expect(deliveryPackage.customerReadinessSummary.nextActions).toContain(
      "Resolve render-reference-comparison: reference comparison missing for renders/carport-southwest.png against photos/carport-south.jpg"
    );
  });

  it("blocks premium photoreal delivery when Blender only reports reference metadata alignment", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const executedWithMetadataOnlyComparison = {
      ...renderManifest,
      blenderExecution: {
        renderQuality: {
          renderer: "cycles",
          samples: 64,
          denoise: true,
          resolution: { width: 1600, height: 1000 },
          filmTransparent: false,
          viewTransform: "Filmic",
          look: "Medium High Contrast",
          exposure: 0,
          gamma: 1,
          worldColor: "#c7d1db"
        },
        renderArtifact: {
          path: "renders/carport-southwest.png",
          sizeBytes: 9283,
          sha256: "a".repeat(64),
          width: 1600,
          height: 1000
        },
        referenceComparison: {
          referencePhoto: "photos/carport-south.jpg",
          renderPath: "renders/carport-southwest.png",
          method: "reference-metadata-alignment" as const,
          score: 1,
          threshold: 1
        }
      }
    };
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, executedWithMetadataOnlyComparison, ["photoreal-render"]);

    expect(deliveryPackage.renderReferenceComparisonCoverage).toEqual({
      sourceOfTruth: "derived-from-render-artifact-reference-photo-and-blender-comparison-metadata",
      required: true,
      referencePhoto: "photos/carport-south.jpg",
      renderPath: "renders/carport-southwest.png",
      method: "reference-metadata-alignment",
      comparisonMethodTier: "metadata-only",
      requiredComparisonMethodTier: "structural",
      comparisonMethodTierStatus: "below-required",
      score: 1,
      threshold: 1,
      minimumRequiredThreshold: DigitalViewingExports.MinimumStructuralReferenceComparisonThreshold,
      status: "missing-execution",
      evidence: "perceptual comparison missing for renders/carport-southwest.png against photos/carport-south.jpg"
    });
    expect(deliveryPackage.qualityGates.ready).toBe(false);
    expect(deliveryPackage.qualityGates.blocking).toContainEqual({
      id: "render-manifest:reference-comparison",
      code: "render_reference_comparison_missing",
      message: "Photoreal customer delivery packages require Blender comparison metadata tying the rendered output back to the reference photo."
    });
  });

  it("blocks premium photoreal delivery when Blender only reports average color comparison", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const executedWithColorOnlyComparison = {
      ...renderManifest,
      blenderExecution: {
        renderQuality: {
          renderer: "cycles",
          samples: 64,
          denoise: true,
          resolution: { width: 1600, height: 1000 },
          filmTransparent: false,
          viewTransform: "Filmic",
          look: "Medium High Contrast",
          exposure: 0,
          gamma: 1,
          worldColor: "#c7d1db"
        },
        renderArtifact: {
          path: "renders/carport-southwest.png",
          sizeBytes: 9283,
          sha256: "a".repeat(64),
          width: 1600,
          height: 1000
        },
        referenceComparison: {
          referencePhoto: "photos/carport-south.jpg",
          renderPath: "renders/carport-southwest.png",
          method: "average-color-rmse" as const,
          score: 0.92,
          threshold: 0.75
        }
      }
    };
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, executedWithColorOnlyComparison, ["photoreal-render"]);

    expect(deliveryPackage.renderReferenceComparisonCoverage).toEqual({
      sourceOfTruth: "derived-from-render-artifact-reference-photo-and-blender-comparison-metadata",
      required: true,
      referencePhoto: "photos/carport-south.jpg",
      renderPath: "renders/carport-southwest.png",
      method: "average-color-rmse",
      comparisonMethodTier: "color-only",
      requiredComparisonMethodTier: "structural",
      comparisonMethodTierStatus: "below-required",
      score: 0.92,
      threshold: 0.75,
      minimumRequiredThreshold: DigitalViewingExports.MinimumStructuralReferenceComparisonThreshold,
      status: "missing-execution",
      evidence: "structural comparison missing for renders/carport-southwest.png against photos/carport-south.jpg"
    });
    expect(deliveryPackage.qualityGates.ready).toBe(false);
    expect(deliveryPackage.customerReadinessSummary.nextActions).toContain(
      "Resolve render-reference-comparison: structural comparison missing for renders/carport-southwest.png against photos/carport-south.jpg"
    );
  });

  it("blocks premium photoreal delivery when structural comparison threshold is non-enforcing", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const executedWithNonEnforcingStructuralComparison = {
      ...renderManifest,
      blenderExecution: {
        renderQuality: {
          renderer: "cycles",
          samples: 64,
          denoise: true,
          resolution: { width: 1600, height: 1000 },
          filmTransparent: false,
          viewTransform: "Filmic",
          look: "Medium High Contrast",
          exposure: 0,
          gamma: 1,
          worldColor: "#c7d1db"
        },
        renderArtifact: {
          path: "renders/carport-southwest.png",
          sizeBytes: 9283,
          sha256: "a".repeat(64),
          width: 1600,
          height: 1000
        },
        referenceComparison: {
          referencePhoto: "photos/carport-south.jpg",
          renderPath: "renders/carport-southwest.png",
          method: "luma-grid-rmse" as const,
          score: 1,
          threshold: 0
        }
      }
    };
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, executedWithNonEnforcingStructuralComparison, ["photoreal-render"]);

    expect(deliveryPackage.renderReferenceComparisonCoverage).toEqual({
      sourceOfTruth: "derived-from-render-artifact-reference-photo-and-blender-comparison-metadata",
      required: true,
      referencePhoto: "photos/carport-south.jpg",
      renderPath: "renders/carport-southwest.png",
      method: "luma-grid-rmse",
      comparisonMethodTier: "structural",
      requiredComparisonMethodTier: "structural",
      comparisonMethodTierStatus: "satisfies-required",
      score: 1,
      threshold: 0,
      minimumRequiredThreshold: DigitalViewingExports.MinimumStructuralReferenceComparisonThreshold,
      status: "mismatched",
      evidence: "luma-grid-rmse threshold 0 < minimum 0.35 for renders/carport-southwest.png against photos/carport-south.jpg"
    });
    expect(deliveryPackage.qualityGates.ready).toBe(false);
    expect(deliveryPackage.qualityGates.blocking).toContainEqual({
      id: "render-manifest:reference-comparison",
      code: "render_reference_comparison_mismatch",
      message: "Photoreal customer delivery packages require Blender comparison metadata to match the declared render path and reference photo."
    });
  });

  it("builds a deterministic asset bundle manifest for pre-render file readiness", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const bundle = buildDigitalViewingAssetBundleManifest(capture, renderManifest, {
      existingFiles: [
        "photos/carport-south.jpg",
        "photos/carport-west.jpg",
        "textures/carport-white-panel-normal.png",
        "textures/carport-white-panel-roughness.png"
      ]
    });
    const serialized = serializeDigitalViewingAssetBundleManifest(bundle);

    expect(bundle.notGeometryAuthority).toBe(true);
    expect(bundle.sourceOfTruth).toEqual({
      measurements: "geometry-scale-placement",
      photos: "material-condition-context-evidence-files",
      textures: "material-finish-evidence-files",
      bundle: "pre-render-file-readiness-no-geometry-reconstruction"
    });
    expect(bundle.summary).toEqual({
      ready: false,
      requiredCount: 9,
      missingCount: 4,
      warningCount: 0
    });
    expect(bundle.assets.map((asset) => [asset.path, asset.assetType, asset.required, asset.status, asset.usedBy])).toEqual([
      ["photos/carport-detail-panel.jpg", "photo", true, "missing", ["condition:white-panel-weathering"]],
      ["photos/carport-east.jpg", "photo", true, "missing", ["material:painted-white-wood-panel", "texture:painted-white-wood-panel:roughness"]],
      ["photos/carport-south.jpg", "photo", true, "present", ["appearance-calibration:dark-stone-foundation", "camera:south", "lighting:site-reference", "material:dark-stone-foundation", "surface-mapping:dark-stone-foundation", "texture:dark-stone-foundation:normal"]],
      ["photos/carport-west.jpg", "photo", true, "present", ["appearance-calibration:painted-white-wood-panel", "material:dark-stone-foundation", "material:painted-white-wood-panel", "surface-mapping:painted-white-wood-panel", "texture:dark-stone-foundation:roughness", "texture:painted-white-wood-panel:normal"]],
      ["renders/carport-southwest.png", "render-output", true, "expected", ["render-output"]],
      ["textures/carport-stone-foundation-normal.png", "texture", true, "missing", ["texture:dark-stone-foundation:normal"]],
      ["textures/carport-stone-foundation-roughness.png", "texture", true, "missing", ["texture:dark-stone-foundation:roughness"]],
      ["textures/carport-white-panel-normal.png", "texture", true, "present", ["texture:painted-white-wood-panel:normal"]],
      ["textures/carport-white-panel-roughness.png", "texture", true, "present", ["texture:painted-white-wood-panel:roughness"]]
    ]);
    expect(bundle.qualityGates.blocking).toEqual([
      {
        id: "photos/carport-detail-panel.jpg",
        code: "asset_file_missing",
        message: "Required digital viewing asset is missing from the asset bundle."
      },
      {
        id: "photos/carport-east.jpg",
        code: "asset_file_missing",
        message: "Required digital viewing asset is missing from the asset bundle."
      },
      {
        id: "textures/carport-stone-foundation-normal.png",
        code: "asset_file_missing",
        message: "Required digital viewing asset is missing from the asset bundle."
      },
      {
        id: "textures/carport-stone-foundation-roughness.png",
        code: "asset_file_missing",
        message: "Required digital viewing asset is missing from the asset bundle."
      }
    ]);
    expect(serialized.endsWith("\n")).toBe(true);
    expect(JSON.parse(serialized)).toEqual(bundle);
  });

  it("rejects asset bundle manifests whose summary does not match actual required assets", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const bundle = buildDigitalViewingAssetBundleManifest(capture, renderManifest, {
      existingFiles: ["photos/carport-south.jpg"]
    });
    const brokenBundle = {
      ...bundle,
      summary: {
        ...bundle.summary,
        missingCount: 0
      }
    };

    expect(() => DigitalViewingAssetBundleManifestSchema.parse(brokenBundle)).toThrow(/assetBundle summary missingCount must equal missing required assets/);
  });

  it("rejects asset bundle manifests whose ready flags do not match blocking assets", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const bundle = buildDigitalViewingAssetBundleManifest(capture, renderManifest, {
      existingFiles: ["photos/carport-south.jpg"]
    });
    const brokenBundle = {
      ...bundle,
      summary: {
        ...bundle.summary,
        ready: true
      },
      qualityGates: {
        ...bundle.qualityGates,
        ready: true
      }
    };

    expect(() => DigitalViewingAssetBundleManifestSchema.parse(brokenBundle)).toThrow(/assetBundle ready flags must match missing assets and blocking gates/);
  });

  it("rejects asset bundle manifests whose declared hash does not match bundle contents", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const bundle = buildDigitalViewingAssetBundleManifest(capture, renderManifest, {
      existingFiles: [
        "photos/carport-detail-panel.jpg",
        "photos/carport-east.jpg",
        "photos/carport-south.jpg",
        "photos/carport-west.jpg",
        "textures/carport-stone-foundation-normal.png",
        "textures/carport-stone-foundation-roughness.png",
        "textures/carport-white-panel-normal.png",
        "textures/carport-white-panel-roughness.png"
      ]
    });
    const brokenBundle = {
      ...bundle,
      assets: bundle.assets.map((asset) =>
        asset.path === "textures/carport-white-panel-normal.png"
          ? { ...asset, usedBy: [...asset.usedBy, "manual-tamper"] }
          : asset
      )
    };

    expect(() => DigitalViewingAssetBundleManifestSchema.parse(brokenBundle)).toThrow(/assetBundleHash must match manifest contents/);
  });

  it("requires an asset bundle manifest for premium photoreal delivery packages", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const executedRenderManifest = {
      ...renderManifest,
      blenderExecution: {
        measurementApplication: {
          applied: blenderMeasurementApplicationsFor(capture)
        }
      }
    };
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, executedRenderManifest);

    expect(deliveryPackage.qualityGates.ready).toBe(false);
    expect(deliveryPackage.qualityGates.blocking).toContainEqual({
      id: "asset-bundle-manifest",
      code: "asset_bundle_required",
      message: "Premium photoreal delivery packages require an asset-bundle manifest."
    });
  });

  it("reports incomplete asset bundle file readiness in delivery packages", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const assetBundle = buildDigitalViewingAssetBundleManifest(capture, renderManifest, {
      existingFiles: [
        "photos/carport-south.jpg",
        "photos/carport-west.jpg",
        "textures/carport-white-panel-normal.png",
        "textures/carport-white-panel-roughness.png"
      ]
    });
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(
      capture,
      renderManifest,
      ["photoreal-render"],
      undefined,
      assetBundle,
      "asset-bundles/carport-southwest.asset-bundle.json"
    );

    expect(assetBundle.summary).toEqual({
      ready: false,
      requiredCount: 9,
      missingCount: 4,
      warningCount: 0
    });
    expect(deliveryPackage.qualityGates.ready).toBe(false);
    expect(deliveryPackage.qualityGates.blocking).toContainEqual({
      id: "asset-bundle-manifest",
      code: "asset_bundle_not_ready",
      message: "Asset bundle manifest is not ready for delivery packaging."
    });
    expect(deliveryPackage.customerReadinessSummary.nextActions).toContain(
      "Resolve asset-bundle-files: 4/9 required photo, texture, or render assets missing from the prepared bundle."
    );
  });

  it("blocks delivery packages when required capture angles are missing", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const missingNorthCapture = DigitalViewingCaptureSchema.parse({
      ...capture,
      photos: capture.photos.filter((photo) => photo.sector !== "north")
    });
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(missingNorthCapture, renderManifest);

    expect(deliveryPackage.captureAngleCoverage).toMatchObject({
      requiredShotCount: 5,
      matchedShotCount: 4,
      missingShotCount: 1,
      mismatchedShotCount: 0
    });
    expect(deliveryPackage.captureAngleCoverage.entries).toContainEqual(expect.objectContaining({
      sector: "north",
      selectedPhotoPath: undefined,
      status: "missing"
    }));
    expect(deliveryPackage.qualityGates.ready).toBe(false);
    expect(deliveryPackage.qualityGates.blocking).toContainEqual({
      id: "render-manifest:capture-angles",
      code: "capture_angles_not_ready",
      message: "Delivery packages require every domain-required capture angle to be matched before customer visual reference use."
    });
    expect(deliveryPackage.customerReadinessSummary.nextActions).toContain(
      "Resolve reference-photos: 4/5 required capture angles matched for customer visual reference."
    );
  });

  it("requires premium photoreal package renders to prove the same asset bundle was used by Blender", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const assetBundle = buildDigitalViewingAssetBundleManifest(capture, renderManifest, {
      existingFiles: [
        "photos/carport-detail-panel.jpg",
        "photos/carport-east.jpg",
        "photos/carport-south.jpg",
        "photos/carport-west.jpg",
        "textures/carport-stone-foundation-normal.png",
        "textures/carport-stone-foundation-roughness.png",
        "textures/carport-white-panel-normal.png",
        "textures/carport-white-panel-roughness.png"
      ]
    });
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, renderManifest, undefined, undefined, assetBundle);

    expect(deliveryPackage.qualityGates.ready).toBe(false);
    expect(deliveryPackage.qualityGates.blocking).toContainEqual({
      id: "render-manifest:asset-bundle",
      code: "render_asset_bundle_missing",
      message: "Premium photoreal delivery packages require Blender execution metadata for the asset bundle used by the render."
    });
    expect(deliveryPackage.customerReadinessSummary.nextActions).toContain(
      "Resolve render-asset-bundle: Blender execution must prove the prepared asset bundle hash was used for the photoreal render."
    );
  });

  it("requires premium photoreal package renders to prove texture and condition evidence was applied by Blender", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const assetBundle = buildDigitalViewingAssetBundleManifest(capture, renderManifest, {
      existingFiles: [
        "photos/carport-detail-panel.jpg",
        "photos/carport-east.jpg",
        "photos/carport-south.jpg",
        "photos/carport-west.jpg",
        "textures/carport-stone-foundation-normal.png",
        "textures/carport-stone-foundation-roughness.png",
        "textures/carport-white-panel-normal.png",
        "textures/carport-white-panel-roughness.png"
      ]
    });
    const executedWithoutTextureProof = {
      ...renderManifest,
      blenderExecution: {
        assetBundle: {
          manifestType: "digital-viewing-asset-bundle" as const,
          ready: true,
          assetBundleHash: assetBundle.hashes.assetBundleHash,
          requiredCount: assetBundle.summary.requiredCount,
          missingCount: assetBundle.summary.missingCount
        }
      }
    };
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, executedWithoutTextureProof, undefined, undefined, assetBundle);

    expect(deliveryPackage.qualityGates.ready).toBe(false);
    expect(deliveryPackage.qualityGates.blocking).toContainEqual({
      id: "render-manifest:textures",
      code: "render_texture_application_incomplete",
      message: "Premium photoreal delivery packages require Blender execution metadata showing every declared texture map was applied."
    });
    expect(deliveryPackage.qualityGates.blocking).toContainEqual({
      id: "render-manifest:conditions",
      code: "render_condition_application_incomplete",
      message: "Premium photoreal delivery packages require Blender execution metadata showing every verified condition evidence item was rendered."
    });
    expect(deliveryPackage.qualityGates.blocking).toContainEqual({
      id: "material-condition-report:visibility",
      code: "render_condition_visibility_incomplete",
      message: "Premium photoreal delivery packages require every buyer-visible condition checklist item to be rendered as visible evidence."
    });
    expect(deliveryPackage.customerReadinessSummary.nextActions).toContain(
      "Resolve condition-render: 0/1 buyer-visible condition items rendered by Blender for customer condition disclosure."
    );
  });

  it("requires premium photoreal package renders to prove condition overlays used their declared surface placement", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const assetBundle = buildDigitalViewingAssetBundleManifest(capture, renderManifest, {
      existingFiles: [
        "photos/carport-detail-panel.jpg",
        "photos/carport-east.jpg",
        "photos/carport-south.jpg",
        "photos/carport-west.jpg",
        "textures/carport-stone-foundation-normal.png",
        "textures/carport-stone-foundation-roughness.png",
        "textures/carport-white-panel-normal.png",
        "textures/carport-white-panel-roughness.png"
      ]
    });
    const executedWithWrongConditionPlacement = {
      ...renderManifest,
      blenderExecution: {
        measurementApplication: {
          applied: blenderMeasurementApplicationsFor(capture)
        },
        materialApplication: {
          applied: [
            {
              object: "foundation-wall",
              materialId: "dark-stone-foundation",
              surfaceMapping: {
                projection: "box",
                faces: ["front", "left", "right"],
                scaleMm: 500,
                rotationDeg: 0,
                sourcePhoto: "photos/carport-south.jpg"
              },
              appearanceCalibration: {
                method: "white-balance-reference",
                sourcePhoto: "photos/carport-south.jpg",
                illuminant: "daylight",
                confidence: "medium"
              }
            },
            {
              object: "cladding-southwest",
              materialId: "painted-white-wood-panel",
              surfaceMapping: {
                projection: "planar",
                faces: ["front"],
                scaleMm: 900,
                rotationDeg: 0,
                sourcePhoto: "photos/carport-west.jpg"
              },
              appearanceCalibration: {
                method: "white-balance-reference",
                sourcePhoto: "photos/carport-west.jpg",
                illuminant: "daylight",
                confidence: "medium"
              }
            }
          ],
          textures: {
            applied: [
              { path: "textures/carport-stone-foundation-normal.png", type: "normal", scaleMm: 500 },
              { path: "textures/carport-stone-foundation-roughness.png", type: "roughness", scaleMm: 500 },
              { path: "textures/carport-white-panel-normal.png", type: "normal", scaleMm: 900 },
              { path: "textures/carport-white-panel-roughness.png", type: "roughness", scaleMm: 900 }
            ]
          }
        },
        conditionApplication: {
          applied: [
            {
              conditionId: "white-panel-weathering",
              hostElementId: "cladding-southwest",
              face: "front",
              surfacePlacement: {
                hostElementId: "cladding-southwest",
                face: "front",
                u: 0.1,
                v: 0.52,
                widthMm: 1800,
                heightMm: 40,
                rotationDeg: 0
              },
              visibilityProof: {
                sourceOfTruth: "created-visible-blender-overlay-object",
                objectName: "condition-white-panel-weathering",
                materialName: "condition-weathering",
                visibleInRender: true,
                dimensionsMm: {
                  widthMm: 1800,
                  heightMm: 40
                }
              }
            }
          ]
        },
        camera: {
          cameraName: "Measured_Render_south",
          sector: "south",
          mode: "perspective",
          referencePhoto: "photos/carport-south.jpg"
        },
        lighting: {
          lights: ["Measured_Render_Key_Area", "Measured_Render_Fill_Area"],
          environment: "site-reference",
          referencePhoto: "photos/carport-south.jpg"
        },
        assetBundle: {
          manifestType: "digital-viewing-asset-bundle" as const,
          ready: true,
          assetBundleHash: assetBundle.hashes.assetBundleHash,
          requiredCount: assetBundle.summary.requiredCount,
          missingCount: assetBundle.summary.missingCount
        }
      }
    };
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, executedWithWrongConditionPlacement, undefined, undefined, assetBundle);

    expect(deliveryPackage.qualityGates.ready).toBe(false);
    expect(deliveryPackage.qualityGates.blocking).toContainEqual({
      id: "render-manifest:condition-placement",
      code: "render_condition_placement_mismatch",
      message: "Premium photoreal delivery packages require Blender execution metadata proving every verified condition overlay used its declared host, face, and surface placement."
    });
    expect(deliveryPackage.customerReadinessSummary.nextActions).toContain(
      "Resolve condition-disclosure: 0/1 visible condition overlays ready for customer disclosure."
    );
  });

  it("blocks premium photoreal package renders when visible condition overlays lack Blender visibility proof", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const assetBundle = buildDigitalViewingAssetBundleManifest(capture, renderManifest, {
      existingFiles: FullCarportAssetPaths,
      assetFiles: assetFilesFor(FullCarportAssetPaths)
    });
    const executedWithoutOverlayVisibilityProof = {
      ...renderManifest,
      blenderExecution: {
        conditionApplication: {
          applied: [
            {
              conditionId: "white-panel-weathering",
              hostElementId: "cladding-southwest",
              face: "front",
              surfacePlacement: {
                hostElementId: "cladding-southwest",
                face: "front",
                u: 0.5,
                v: 0.52,
                widthMm: 1800,
                heightMm: 40,
                rotationDeg: 0
              }
            }
          ]
        },
        assetBundle: {
          manifestType: "digital-viewing-asset-bundle" as const,
          ready: true,
          assetBundleHash: assetBundle.hashes.assetBundleHash,
          requiredCount: assetBundle.summary.requiredCount,
          missingCount: assetBundle.summary.missingCount
        }
      }
    };
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, executedWithoutOverlayVisibilityProof, undefined, undefined, assetBundle);

    expect(deliveryPackage.qualityGates.ready).toBe(false);
    expect(deliveryPackage.qualityGates.blocking).toContainEqual({
      id: "render-manifest:condition-overlay-visibility",
      code: "render_condition_overlay_visibility_missing",
      message: "Premium photoreal delivery packages require Blender visibility proof for every buyer-visible condition overlay."
    });
  });

  it("blocks premium photoreal package renders when visible condition overlays lack Blender material readback proof", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const assetBundle = buildDigitalViewingAssetBundleManifest(capture, renderManifest, {
      existingFiles: FullCarportAssetPaths
    });
    const executedWithoutOverlayMaterialReadback = {
      ...renderManifest,
      blenderExecution: {
        conditionApplication: {
          applied: [
            {
              conditionId: "white-panel-weathering",
              hostElementId: "cladding-southwest",
              face: "front",
              surfacePlacement: {
                hostElementId: "cladding-southwest",
                face: "front",
                u: 0.5,
                v: 0.52,
                widthMm: 1800,
                heightMm: 40,
                rotationDeg: 0
              },
              visibilityProof: {
                sourceOfTruth: "created-visible-blender-overlay-object",
                objectName: "condition-white-panel-weathering",
                materialName: "condition-white-panel-weathering",
                visibleInRender: true,
                dimensionsMm: {
                  widthMm: 1800,
                  heightMm: 40
                }
              }
            }
          ]
        },
        assetBundle: {
          manifestType: "digital-viewing-asset-bundle" as const,
          ready: true,
          assetBundleHash: assetBundle.hashes.assetBundleHash,
          requiredCount: assetBundle.summary.requiredCount,
          missingCount: assetBundle.summary.missingCount
        }
      }
    };
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, executedWithoutOverlayMaterialReadback, undefined, undefined, assetBundle);

    expect(deliveryPackage.qualityGates.ready).toBe(false);
    expect(deliveryPackage.qualityGates.blocking).toContainEqual({
      id: "render-manifest:condition-overlay-material",
      code: "render_condition_overlay_material_readback_missing",
      message: "Premium photoreal delivery packages require Blender material readback proof for every buyer-visible condition overlay."
    });
  });

  it("blocks premium photoreal package renders when verified condition overlays lack source photo identity proof", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const assetBundle = buildDigitalViewingAssetBundleManifest(capture, renderManifest, {
      existingFiles: FullCarportAssetPaths,
      assetFiles: assetFilesFor(FullCarportAssetPaths)
    });
    const executedWithoutConditionSourcePhotoIdentity = {
      ...renderManifest,
      blenderExecution: {
        conditionApplication: {
          applied: [
            {
              conditionId: "white-panel-weathering",
              hostElementId: "cladding-southwest",
              face: "front",
              surfacePlacement: {
                hostElementId: "cladding-southwest",
                face: "front",
                u: 0.5,
                v: 0.52,
                widthMm: 1800,
                heightMm: 40,
                rotationDeg: 0
              },
              visibilityProof: {
                sourceOfTruth: "created-visible-blender-overlay-object",
                objectName: "condition-white-panel-weathering",
                materialName: "condition-white-panel-weathering",
                visibleInRender: true,
                dimensionsMm: {
                  widthMm: 1800,
                  heightMm: 40
                },
                materialReadback: {
                  sourceOfTruth: "read-from-blender-condition-material-after-application",
                  baseColor: "#b0b0a8",
                  alpha: 1,
                  roughness: 0.82,
                  metallic: 0,
                  conditionType: "wear",
                  severity: "low"
                }
              }
            }
          ]
        },
        assetBundle: {
          manifestType: "digital-viewing-asset-bundle" as const,
          ready: true,
          assetBundleHash: assetBundle.hashes.assetBundleHash,
          requiredCount: assetBundle.summary.requiredCount,
          missingCount: assetBundle.summary.missingCount
        }
      }
    };
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, executedWithoutConditionSourcePhotoIdentity, undefined, undefined, assetBundle);

    expect(deliveryPackage.qualityGates.ready).toBe(false);
    expect(deliveryPackage.qualityGates.blocking).toContainEqual({
      id: "render-manifest:condition-source-photos",
      code: "render_condition_source_photo_identity_missing",
      message: "Premium photoreal delivery packages require Blender execution metadata proving every verified condition overlay used its exact source photo files."
    });
    expect(deliveryPackage.photorealQualityChecklist).toContainEqual(
      expect.objectContaining({
        check: "conditions",
        status: "failed",
        evidence: "1 buyer-visible condition items rendered"
      })
    );
  });

  it("blocks premium photoreal package renders when condition source photo identity lacks usage proof", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const assetBundle = buildDigitalViewingAssetBundleManifest(capture, renderManifest, {
      existingFiles: FullCarportAssetPaths,
      assetFiles: assetFilesFor(FullCarportAssetPaths)
    });
    const executedWithoutConditionSourceUsage = {
      ...renderManifest,
      blenderExecution: {
        conditionApplication: {
          applied: [
            {
              conditionId: "white-panel-weathering",
              hostElementId: "cladding-southwest",
              face: "front",
              sourcePhotoIdentities: withoutConditionSourceUsage(
                conditionSourcePhotoIdentitiesFor(capture, assetBundle, "white-panel-weathering")
              ),
              surfacePlacement: {
                hostElementId: "cladding-southwest",
                face: "front",
                u: 0.5,
                v: 0.52,
                widthMm: 1800,
                heightMm: 40,
                rotationDeg: 0
              },
              visibilityProof: {
                sourceOfTruth: "created-visible-blender-overlay-object",
                objectName: "condition-white-panel-weathering",
                materialName: "condition-white-panel-weathering",
                visibleInRender: true,
                dimensionsMm: {
                  widthMm: 1800,
                  heightMm: 40
                },
                materialReadback: {
                  sourceOfTruth: "read-from-blender-condition-material-after-application",
                  baseColor: "#b0b0a8",
                  alpha: 1,
                  roughness: 0.82,
                  metallic: 0,
                  conditionType: "wear",
                  severity: "low"
                }
              }
            }
          ]
        },
        assetBundle: {
          manifestType: "digital-viewing-asset-bundle" as const,
          ready: true,
          assetBundleHash: assetBundle.hashes.assetBundleHash,
          requiredCount: assetBundle.summary.requiredCount,
          missingCount: assetBundle.summary.missingCount
        }
      }
    };
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, executedWithoutConditionSourceUsage, undefined, undefined, assetBundle);

    expect(deliveryPackage.qualityGates.ready).toBe(false);
    expect(deliveryPackage.qualityGates.blocking).toContainEqual({
      id: "render-manifest:condition-source-photos",
      code: "render_condition_source_photo_identity_missing",
      message: "Premium photoreal delivery packages require Blender execution metadata proving every verified condition overlay used its exact source photo files."
    });
  });

  it("requires premium photoreal package renders to prove texture maps used their declared physical scale", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const assetBundle = buildDigitalViewingAssetBundleManifest(capture, renderManifest, {
      existingFiles: [
        "photos/carport-detail-panel.jpg",
        "photos/carport-east.jpg",
        "photos/carport-south.jpg",
        "photos/carport-west.jpg",
        "textures/carport-stone-foundation-normal.png",
        "textures/carport-stone-foundation-roughness.png",
        "textures/carport-white-panel-normal.png",
        "textures/carport-white-panel-roughness.png"
      ]
    });
    const executedWithoutTextureScaleProof = {
      ...renderManifest,
      blenderExecution: {
        measurementApplication: {
          applied: blenderMeasurementApplicationsFor(capture)
        },
        materialApplication: {
          applied: [
            {
              object: "foundation-wall",
              materialId: "dark-stone-foundation",
              surfaceMapping: {
                projection: "box",
                faces: ["front", "left", "right"],
                scaleMm: 500,
                rotationDeg: 0,
                sourcePhoto: "photos/carport-south.jpg"
              },
              appearanceCalibration: {
                method: "white-balance-reference",
                sourcePhoto: "photos/carport-south.jpg",
                illuminant: "daylight",
                confidence: "medium"
              }
            },
            {
              object: "cladding-southwest",
              materialId: "painted-white-wood-panel",
              surfaceMapping: {
                projection: "planar",
                faces: ["front"],
                scaleMm: 900,
                rotationDeg: 0,
                sourcePhoto: "photos/carport-west.jpg"
              },
              appearanceCalibration: {
                method: "white-balance-reference",
                sourcePhoto: "photos/carport-west.jpg",
                illuminant: "daylight",
                confidence: "medium"
              }
            }
          ],
          textures: {
            applied: [
              { path: "textures/carport-stone-foundation-normal.png", type: "normal", colorSpace: "Non-Color" },
              { path: "textures/carport-stone-foundation-roughness.png", type: "roughness", colorSpace: "Non-Color" },
              { path: "textures/carport-white-panel-normal.png", type: "normal", colorSpace: "Non-Color" },
              { path: "textures/carport-white-panel-roughness.png", type: "roughness", colorSpace: "Non-Color" }
            ]
          }
        },
        conditionApplication: {
          applied: [
            { conditionId: "white-panel-weathering", hostElementId: "cladding-southwest" }
          ]
        },
        camera: {
          cameraName: "Measured_Render_south",
          sector: "south",
          mode: "perspective",
          referencePhoto: "photos/carport-south.jpg"
        },
        lighting: {
          lights: ["Measured_Render_Key_Area", "Measured_Render_Fill_Area"],
          environment: "site-reference",
          referencePhoto: "photos/carport-south.jpg"
        },
        assetBundle: {
          manifestType: "digital-viewing-asset-bundle" as const,
          ready: true,
          assetBundleHash: assetBundle.hashes.assetBundleHash,
          requiredCount: assetBundle.summary.requiredCount,
          missingCount: assetBundle.summary.missingCount
        }
      }
    };
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, executedWithoutTextureScaleProof, undefined, undefined, assetBundle);

    expect(deliveryPackage.qualityGates.ready).toBe(false);
    expect(deliveryPackage.qualityGates.blocking).toContainEqual({
      id: "render-manifest:texture-scale",
      code: "render_texture_scale_incomplete",
      message: "Premium photoreal delivery packages require Blender execution metadata proving every scaled texture map used its declared physical scale."
    });
  });

  it("requires premium photoreal package renders to prove texture maps used their declared Blender color spaces", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const assetBundle = buildDigitalViewingAssetBundleManifest(capture, renderManifest, {
      existingFiles: [
        "photos/carport-detail-panel.jpg",
        "photos/carport-east.jpg",
        "photos/carport-south.jpg",
        "photos/carport-west.jpg",
        "textures/carport-stone-foundation-normal.png",
        "textures/carport-stone-foundation-roughness.png",
        "textures/carport-white-panel-normal.png",
        "textures/carport-white-panel-roughness.png"
      ]
    });
    const executedWithWrongTextureColorSpace = {
      ...renderManifest,
      blenderExecution: {
        measurementApplication: {
          applied: blenderMeasurementApplicationsFor(capture)
        },
        materialApplication: {
          applied: [
            {
              object: "foundation-wall",
              materialId: "dark-stone-foundation",
              surfaceMapping: {
                projection: "box",
                faces: ["front", "left", "right"],
                scaleMm: 500,
                rotationDeg: 0,
                sourcePhoto: "photos/carport-south.jpg"
              },
              appearanceCalibration: {
                method: "white-balance-reference",
                sourcePhoto: "photos/carport-south.jpg",
                illuminant: "daylight",
                confidence: "medium"
              }
            },
            {
              object: "cladding-southwest",
              materialId: "painted-white-wood-panel",
              surfaceMapping: {
                projection: "planar",
                faces: ["front"],
                scaleMm: 900,
                rotationDeg: 0,
                sourcePhoto: "photos/carport-west.jpg"
              },
              appearanceCalibration: {
                method: "white-balance-reference",
                sourcePhoto: "photos/carport-west.jpg",
                illuminant: "daylight",
                confidence: "medium"
              }
            }
          ],
          textures: {
            applied: [
              { path: "textures/carport-stone-foundation-normal.png", type: "normal", colorSpace: "sRGB", scaleMm: 500 },
              { path: "textures/carport-stone-foundation-roughness.png", type: "roughness", colorSpace: "Non-Color", scaleMm: 500 },
              { path: "textures/carport-white-panel-normal.png", type: "normal", colorSpace: "Non-Color", scaleMm: 900 },
              { path: "textures/carport-white-panel-roughness.png", type: "roughness", colorSpace: "Non-Color", scaleMm: 900 }
            ]
          }
        },
        conditionApplication: {
          applied: [
            { conditionId: "white-panel-weathering", hostElementId: "cladding-southwest" }
          ]
        },
        camera: {
          cameraName: "Measured_Render_south",
          sector: "south",
          mode: "perspective",
          referencePhoto: "photos/carport-south.jpg"
        },
        lighting: {
          lights: ["Measured_Render_Key_Area", "Measured_Render_Fill_Area"],
          environment: "site-reference",
          referencePhoto: "photos/carport-south.jpg"
        },
        assetBundle: {
          manifestType: "digital-viewing-asset-bundle" as const,
          ready: true,
          assetBundleHash: assetBundle.hashes.assetBundleHash,
          requiredCount: assetBundle.summary.requiredCount,
          missingCount: assetBundle.summary.missingCount
        }
      }
    };
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, executedWithWrongTextureColorSpace, undefined, undefined, assetBundle);

    expect(deliveryPackage.qualityGates.ready).toBe(false);
    expect(deliveryPackage.qualityGates.blocking).toContainEqual({
      id: "render-manifest:texture-color-space",
      code: "render_texture_color_space_incomplete",
      message: "Premium photoreal delivery packages require Blender execution metadata proving every texture map used its declared color space."
    });
    expect(deliveryPackage.viewerLayerCoverage.entries).toContainEqual({
      layer: "material-fidelity",
      required: true,
      status: "blocked",
      sourceIds: ["dark-stone-foundation", "painted-white-wood-panel"],
      evidence: "3/4 texture color spaces matched Blender execution"
    });
  });

  it("blocks premium photoreal package renders when Blender texture execution lacks file identity proof", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const assetBundle = buildDigitalViewingAssetBundleManifest(capture, renderManifest, {
      existingFiles: FullCarportAssetPaths,
      assetFiles: assetFilesFor(FullCarportAssetPaths)
    });
    const executedWithoutTextureFileIdentity = {
      ...renderManifest,
      blenderExecution: {
        measurementApplication: {
          applied: blenderMeasurementApplicationsFor(capture)
        },
        materialApplication: {
          applied: renderManifest.materials.map((material) => ({
            object: material.hostElementId,
            materialId: material.materialId,
            pbr: material.pbr,
            pbrReadback: {
              sourceOfTruth: "read-from-blender-material-node-values-after-application",
              values: material.pbr
            },
            surfaceMapping: material.surfaceMapping,
            appearanceCalibration: material.appearanceCalibration
          })),
          textures: {
            applied: renderManifest.materials.flatMap((material) =>
              material.textureMaps.map((textureMap) => ({
                path: textureMap.path,
                type: textureMap.type,
                colorSpace: textureMap.colorSpace,
                scaleMm: textureMap.scaleMm,
                pixelWidth: textureMap.pixelWidth,
                pixelHeight: textureMap.pixelHeight
              }))
            )
          }
        },
        conditionApplication: {
          applied: [
            { conditionId: "white-panel-weathering", hostElementId: "cladding-southwest" }
          ]
        },
        camera: {
          cameraName: "Measured_Render_south",
          sector: "south",
          mode: "perspective",
          referencePhoto: "photos/carport-south.jpg",
          executedYawDeg: 0,
          executedPitchDeg: 0
        },
        lighting: {
          lights: ["Measured_Render_Key_Area", "Measured_Render_Fill_Area"],
          environment: "site-reference",
          referencePhoto: "photos/carport-south.jpg",
          lightingReference: "daylight",
          colorReference: "known-white-reference",
          whiteBalanceKelvin: 5600,
          exposureEv: 0
        },
        assetBundle: {
          manifestType: "digital-viewing-asset-bundle" as const,
          ready: true,
          assetBundleHash: assetBundle.hashes.assetBundleHash,
          requiredCount: assetBundle.summary.requiredCount,
          missingCount: assetBundle.summary.missingCount
        }
      }
    };
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, executedWithoutTextureFileIdentity, undefined, undefined, assetBundle);

    expect(deliveryPackage.qualityGates.ready).toBe(false);
    expect(deliveryPackage.qualityGates.blocking).toContainEqual({
      id: "render-manifest:texture-file-identity",
      code: "render_texture_file_identity_missing",
      message: "Premium photoreal delivery packages require Blender execution metadata proving every applied texture file matches the asset bundle identity."
    });
  });

  it("requires premium photoreal package renders to prove materials were applied to their Blender hosts", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const assetBundle = buildDigitalViewingAssetBundleManifest(capture, renderManifest, {
      existingFiles: [
        "photos/carport-detail-panel.jpg",
        "photos/carport-east.jpg",
        "photos/carport-south.jpg",
        "photos/carport-west.jpg",
        "textures/carport-stone-foundation-normal.png",
        "textures/carport-stone-foundation-roughness.png",
        "textures/carport-white-panel-normal.png",
        "textures/carport-white-panel-roughness.png"
      ]
    });
    const executedWithoutMaterialProof = {
      ...renderManifest,
      blenderExecution: {
        measurementApplication: {
          applied: blenderMeasurementApplicationsFor(capture)
        },
        materialApplication: {
          textures: {
            applied: [
              { path: "textures/carport-stone-foundation-normal.png", type: "normal", colorSpace: "Non-Color", scaleMm: 500 },
              { path: "textures/carport-stone-foundation-roughness.png", type: "roughness", colorSpace: "Non-Color", scaleMm: 500 },
              { path: "textures/carport-white-panel-normal.png", type: "normal", colorSpace: "Non-Color", scaleMm: 900 },
              { path: "textures/carport-white-panel-roughness.png", type: "roughness", colorSpace: "Non-Color", scaleMm: 900 }
            ]
          }
        },
        conditionApplication: {
          applied: [
            { conditionId: "white-panel-weathering", hostElementId: "cladding-southwest" }
          ]
        },
        assetBundle: {
          manifestType: "digital-viewing-asset-bundle" as const,
          ready: true,
          assetBundleHash: assetBundle.hashes.assetBundleHash,
          requiredCount: assetBundle.summary.requiredCount,
          missingCount: assetBundle.summary.missingCount
        }
      }
    };
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, executedWithoutMaterialProof, undefined, undefined, assetBundle);

    expect(deliveryPackage.qualityGates.ready).toBe(false);
    expect(deliveryPackage.qualityGates.blocking).toContainEqual({
      id: "render-manifest:materials",
      code: "render_material_application_incomplete",
      message: "Premium photoreal delivery packages require Blender execution metadata showing every host-targeted material was applied."
    });
  });

  it("blocks premium photoreal package renders when Blender applied PBR values differ from the render manifest", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const assetBundle = buildDigitalViewingAssetBundleManifest(capture, renderManifest, {
      existingFiles: FullCarportAssetPaths
    });
    const stone = renderManifest.materials.find((material) => material.materialId === "dark-stone-foundation");
    const wood = renderManifest.materials.find((material) => material.materialId === "painted-white-wood-panel");
    expect(stone).toBeDefined();
    expect(wood).toBeDefined();
    const executedWithWrongMaterialPbr = {
      ...renderManifest,
      blenderExecution: {
        measurementApplication: {
          applied: blenderMeasurementApplicationsFor(capture)
        },
        materialApplication: {
          applied: [
            {
              object: "foundation-wall",
              materialId: "dark-stone-foundation",
              pbr: { ...stone!.pbr, roughness: 0.12 },
              surfaceMapping: stone!.surfaceMapping,
              appearanceCalibration: stone!.appearanceCalibration
            },
            {
              object: "cladding-southwest",
              materialId: "painted-white-wood-panel",
              pbr: wood!.pbr,
              surfaceMapping: wood!.surfaceMapping,
              appearanceCalibration: wood!.appearanceCalibration
            }
          ],
          textures: { applied: [] }
        },
        conditionApplication: { applied: [] },
        camera: {
          cameraName: "Measured_Render_south",
          sector: "south",
          mode: "perspective",
          referencePhoto: "photos/carport-south.jpg"
        },
        lighting: {
          environment: "site-reference",
          referencePhoto: "photos/carport-south.jpg",
          lightingReference: "daylight",
          colorReference: "known-white-reference",
          whiteBalanceKelvin: 5600,
          exposureEv: 0
        },
        assetBundle: {
          manifestType: "digital-viewing-asset-bundle" as const,
          ready: true,
          assetBundleHash: assetBundle.hashes.assetBundleHash,
          requiredCount: assetBundle.summary.requiredCount,
          missingCount: assetBundle.summary.missingCount
        }
      }
    };

    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, executedWithWrongMaterialPbr, undefined, undefined, assetBundle);

    expect(deliveryPackage.qualityGates.ready).toBe(false);
    expect(deliveryPackage.qualityGates.blocking).toContainEqual({
      id: "render-manifest:material-pbr",
      code: "render_material_pbr_mismatch",
      message: "Premium photoreal delivery packages require Blender execution metadata proving applied PBR values match the render manifest."
    });
  });

  it("blocks premium photoreal package renders when Blender PBR values lack material-node readback proof", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const assetBundle = buildDigitalViewingAssetBundleManifest(capture, renderManifest, {
      existingFiles: FullCarportAssetPaths
    });
    const stone = renderManifest.materials.find((material) => material.materialId === "dark-stone-foundation");
    const wood = renderManifest.materials.find((material) => material.materialId === "painted-white-wood-panel");
    expect(stone).toBeDefined();
    expect(wood).toBeDefined();
    const executedWithoutPbrReadbackProof = {
      ...renderManifest,
      blenderExecution: {
        measurementApplication: {
          applied: blenderMeasurementApplicationsFor(capture)
        },
        materialApplication: {
          applied: [
            {
              object: "foundation-wall",
              materialId: "dark-stone-foundation",
              pbr: stone!.pbr,
              surfaceMapping: stone!.surfaceMapping,
              appearanceCalibration: stone!.appearanceCalibration
            },
            {
              object: "cladding-southwest",
              materialId: "painted-white-wood-panel",
              pbr: wood!.pbr,
              surfaceMapping: wood!.surfaceMapping,
              appearanceCalibration: wood!.appearanceCalibration
            }
          ],
          textures: { applied: [] }
        },
        conditionApplication: { applied: [] },
        camera: {
          cameraName: "Measured_Render_south",
          sector: "south",
          mode: "perspective",
          referencePhoto: "photos/carport-south.jpg"
        },
        lighting: {
          environment: "site-reference",
          referencePhoto: "photos/carport-south.jpg",
          lightingReference: "daylight",
          colorReference: "known-white-reference",
          whiteBalanceKelvin: 5600,
          exposureEv: 0
        },
        assetBundle: {
          manifestType: "digital-viewing-asset-bundle" as const,
          ready: true,
          assetBundleHash: assetBundle.hashes.assetBundleHash,
          requiredCount: assetBundle.summary.requiredCount,
          missingCount: assetBundle.summary.missingCount
        }
      }
    };

    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, executedWithoutPbrReadbackProof, undefined, undefined, assetBundle);

    expect(deliveryPackage.qualityGates.ready).toBe(false);
    expect(deliveryPackage.qualityGates.blocking).toContainEqual({
      id: "render-manifest:material-pbr-readback",
      code: "render_material_pbr_readback_missing",
      message: "Premium photoreal delivery packages require Blender material-node readback proof for every applied PBR material."
    });
  });

  it("blocks premium photoreal package renders when Blender material-node PBR readback values differ from the render manifest", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const assetBundle = buildDigitalViewingAssetBundleManifest(capture, renderManifest, {
      existingFiles: FullCarportAssetPaths
    });
    const stone = renderManifest.materials.find((material) => material.materialId === "dark-stone-foundation");
    const wood = renderManifest.materials.find((material) => material.materialId === "painted-white-wood-panel");
    expect(stone).toBeDefined();
    expect(wood).toBeDefined();
    const executedWithWrongPbrReadbackValues = {
      ...renderManifest,
      blenderExecution: {
        measurementApplication: {
          applied: blenderMeasurementApplicationsFor(capture)
        },
        materialApplication: {
          applied: [
            {
              object: "foundation-wall",
              materialId: "dark-stone-foundation",
              pbr: stone!.pbr,
              pbrReadback: {
                sourceOfTruth: "read-from-blender-material-node-values-after-application",
                fields: ["baseColor", "metallic", "normalSource", "roughness", "specular", "textureScaleMm", "transmission"],
                values: { ...stone!.pbr, roughness: 0.12 }
              },
              surfaceMapping: stone!.surfaceMapping,
              appearanceCalibration: stone!.appearanceCalibration
            },
            {
              object: "cladding-southwest",
              materialId: "painted-white-wood-panel",
              pbr: wood!.pbr,
              pbrReadback: {
                sourceOfTruth: "read-from-blender-material-node-values-after-application",
                fields: ["baseColor", "metallic", "normalSource", "roughness", "specular", "textureScaleMm", "transmission"],
                values: wood!.pbr
              },
              surfaceMapping: wood!.surfaceMapping,
              appearanceCalibration: wood!.appearanceCalibration
            }
          ],
          textures: { applied: [] }
        },
        conditionApplication: { applied: [] },
        camera: {
          cameraName: "Measured_Render_south",
          sector: "south",
          mode: "perspective",
          referencePhoto: "photos/carport-south.jpg"
        },
        lighting: {
          environment: "site-reference",
          referencePhoto: "photos/carport-south.jpg",
          lightingReference: "daylight",
          colorReference: "known-white-reference",
          whiteBalanceKelvin: 5600,
          exposureEv: 0
        },
        assetBundle: {
          manifestType: "digital-viewing-asset-bundle" as const,
          ready: true,
          assetBundleHash: assetBundle.hashes.assetBundleHash,
          requiredCount: assetBundle.summary.requiredCount,
          missingCount: assetBundle.summary.missingCount
        }
      }
    };

    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, executedWithWrongPbrReadbackValues, undefined, undefined, assetBundle);

    expect(deliveryPackage.qualityGates.ready).toBe(false);
    expect(deliveryPackage.qualityGates.blocking).toContainEqual({
      id: "render-manifest:material-pbr",
      code: "render_material_pbr_mismatch",
      message: "Premium photoreal delivery packages require Blender execution metadata proving applied PBR values match the render manifest."
    });
  });

  it("requires premium photoreal package renders to prove material appearance calibration was applied", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const assetBundle = buildDigitalViewingAssetBundleManifest(capture, renderManifest, {
      existingFiles: [
        "photos/carport-detail-panel.jpg",
        "photos/carport-east.jpg",
        "photos/carport-south.jpg",
        "photos/carport-west.jpg",
        "textures/carport-stone-foundation-normal.png",
        "textures/carport-stone-foundation-roughness.png",
        "textures/carport-white-panel-normal.png",
        "textures/carport-white-panel-roughness.png"
      ]
    });
    const executedWithoutCalibrationProof = {
      ...renderManifest,
      blenderExecution: {
        measurementApplication: {
          applied: blenderMeasurementApplicationsFor(capture)
        },
        materialApplication: {
          applied: [
            { object: "foundation-wall", materialId: "dark-stone-foundation" },
            { object: "cladding-southwest", materialId: "painted-white-wood-panel" }
          ],
          textures: {
            applied: [
              { path: "textures/carport-stone-foundation-normal.png", type: "normal", colorSpace: "Non-Color", scaleMm: 500 },
              { path: "textures/carport-stone-foundation-roughness.png", type: "roughness", colorSpace: "Non-Color", scaleMm: 500 },
              { path: "textures/carport-white-panel-normal.png", type: "normal", colorSpace: "Non-Color", scaleMm: 900 },
              { path: "textures/carport-white-panel-roughness.png", type: "roughness", colorSpace: "Non-Color", scaleMm: 900 }
            ]
          }
        },
        conditionApplication: {
          applied: [
            { conditionId: "white-panel-weathering", hostElementId: "cladding-southwest" }
          ]
        },
        assetBundle: {
          manifestType: "digital-viewing-asset-bundle" as const,
          ready: true,
          assetBundleHash: assetBundle.hashes.assetBundleHash,
          requiredCount: assetBundle.summary.requiredCount,
          missingCount: assetBundle.summary.missingCount
        }
      }
    };
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, executedWithoutCalibrationProof, undefined, undefined, assetBundle);

    expect(deliveryPackage.qualityGates.ready).toBe(false);
    expect(deliveryPackage.qualityGates.blocking).toContainEqual({
      id: "render-manifest:appearance-calibration",
      code: "render_material_calibration_incomplete",
      message: "Premium photoreal delivery packages require Blender execution metadata showing appearance calibration for every calibrated material."
    });
    expect(deliveryPackage.photorealQualityChecklist).toContainEqual(
      expect.objectContaining({
        check: "materials",
        status: "failed",
        evidence: "2 host-targeted materials applied with calibrated appearance, surface mapping, and source photo file identity"
      })
    );
    expect(deliveryPackage.materialRenderCoverage).toMatchObject({
      appearanceCalibrationMatchedCount: 0,
      appearanceCalibrationMismatchCount: 2
    });
    expect(deliveryPackage.materialRenderCoverage.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          materialId: "dark-stone-foundation",
          appearanceCalibrationExecutionStatus: "mismatched"
        }),
        expect.objectContaining({
          materialId: "painted-white-wood-panel",
          appearanceCalibrationExecutionStatus: "mismatched"
        })
      ])
    );
    expect(deliveryPackage.viewerLayerCoverage.entries).toContainEqual({
      layer: "material-fidelity",
      required: true,
      status: "blocked",
      sourceIds: ["dark-stone-foundation", "painted-white-wood-panel"],
      evidence: "0/2 material appearance calibrations matched Blender execution"
    });
    expect(deliveryPackage.customerReadinessSummary.nextActions).toContain(
      "Resolve material-character: 0/2 photo-calibrated material appearances matched Blender execution for customer material feel."
    );
  });

  it("requires premium photoreal package renders to prove material surface mapping was applied", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const assetBundle = buildDigitalViewingAssetBundleManifest(capture, renderManifest, {
      existingFiles: [
        "photos/carport-detail-panel.jpg",
        "photos/carport-east.jpg",
        "photos/carport-south.jpg",
        "photos/carport-west.jpg",
        "textures/carport-stone-foundation-normal.png",
        "textures/carport-stone-foundation-roughness.png",
        "textures/carport-white-panel-normal.png",
        "textures/carport-white-panel-roughness.png"
      ]
    });
    const executedWithoutSurfaceMappingProof = {
      ...renderManifest,
      blenderExecution: {
        measurementApplication: {
          applied: blenderMeasurementApplicationsFor(capture)
        },
        materialApplication: {
          applied: [
            {
              object: "foundation-wall",
              materialId: "dark-stone-foundation",
              appearanceCalibration: {
                method: "white-balance-reference",
                sourcePhoto: "photos/carport-south.jpg",
                illuminant: "daylight",
                confidence: "medium"
              }
            },
            {
              object: "cladding-southwest",
              materialId: "painted-white-wood-panel",
              appearanceCalibration: {
                method: "white-balance-reference",
                sourcePhoto: "photos/carport-west.jpg",
                illuminant: "daylight",
                confidence: "medium"
              }
            }
          ],
          textures: {
            applied: [
              { path: "textures/carport-stone-foundation-normal.png", type: "normal", colorSpace: "Non-Color", scaleMm: 500 },
              { path: "textures/carport-stone-foundation-roughness.png", type: "roughness", colorSpace: "Non-Color", scaleMm: 500 },
              { path: "textures/carport-white-panel-normal.png", type: "normal", colorSpace: "Non-Color", scaleMm: 900 },
              { path: "textures/carport-white-panel-roughness.png", type: "roughness", colorSpace: "Non-Color", scaleMm: 900 }
            ]
          }
        },
        conditionApplication: {
          applied: [
            { conditionId: "white-panel-weathering", hostElementId: "cladding-southwest" }
          ]
        },
        assetBundle: {
          manifestType: "digital-viewing-asset-bundle" as const,
          ready: true,
          assetBundleHash: assetBundle.hashes.assetBundleHash,
          requiredCount: assetBundle.summary.requiredCount,
          missingCount: assetBundle.summary.missingCount
        }
      }
    };
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, executedWithoutSurfaceMappingProof, undefined, undefined, assetBundle);

    expect(deliveryPackage.qualityGates.ready).toBe(false);
    expect(deliveryPackage.qualityGates.blocking).toContainEqual({
      id: "render-manifest:surface-mapping",
      code: "render_material_surface_mapping_incomplete",
      message: "Premium photoreal delivery packages require Blender execution metadata showing surface mapping for every mapped material."
    });
    expect(deliveryPackage.photorealQualityChecklist).toContainEqual(
      expect.objectContaining({
        check: "materials",
        status: "failed",
        evidence: "2 host-targeted materials applied with calibrated appearance, surface mapping, and source photo file identity"
      })
    );
    expect(deliveryPackage.materialRenderCoverage).toMatchObject({
      surfaceMappingMatchedCount: 0,
      surfaceMappingMismatchCount: 2,
      materialFidelityReadyCount: 0,
      materialFidelityBlockedCount: 2
    });
    expect(deliveryPackage.materialRenderCoverage.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          materialId: "dark-stone-foundation",
          surfaceMappingExecutionStatus: "mismatched",
          materialFidelityStatus: "blocked",
          materialFidelityIssues: ["surface-mapping-mismatched"]
        }),
        expect.objectContaining({
          materialId: "painted-white-wood-panel",
          surfaceMappingExecutionStatus: "mismatched",
          materialFidelityStatus: "blocked",
          materialFidelityIssues: ["surface-mapping-mismatched"]
        })
      ])
    );
    expect(deliveryPackage.viewerLayerCoverage.entries).toContainEqual({
      layer: "material-fidelity",
      required: true,
      status: "blocked",
      sourceIds: ["dark-stone-foundation", "painted-white-wood-panel"],
      evidence: "0/2 material surface mappings matched Blender execution"
    });
    expect(deliveryPackage.customerViewingChecklist.items).toContainEqual({
      item: "material-fidelity",
      category: "materials",
      sourceCoverage: "materialRenderCoverage+materialCalibrationCoverage+pbrMaterialCompletenessCoverage",
      sourceIds: ["dark-stone-foundation", "painted-white-wood-panel"],
      required: true,
      status: "blocked",
      evidence: "2/2 PBR materials complete; 2/2 calibration candidates ready; 0/2 Blender material surface mappings matched"
    });
    expect(deliveryPackage.sourceTraceIndex.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceId: "dark-stone-foundation",
          sourceType: "material",
          sourceCoverage: "materialRenderCoverage+pbrMaterialCompletenessCoverage",
          status: "blocked"
        }),
        expect.objectContaining({
          sourceId: "painted-white-wood-panel",
          sourceType: "material",
          sourceCoverage: "materialRenderCoverage+pbrMaterialCompletenessCoverage",
          status: "blocked"
        })
      ])
    );
    expect(deliveryPackage.evidenceHealthSummary.sections).toContainEqual({
      section: "materials",
      status: "blocked",
      indexedSourceCount: 2,
      readyEvidenceCount: 0,
      blockedEvidenceCount: 2,
      missingEvidenceCount: 0,
      evidencePathCount: 4
    });
    expect(deliveryPackage.customerReadinessSummary.nextActions).toContain(
      "Resolve material-fidelity: 0/2 material surface mappings matched Blender execution."
    );
	  });

	  it("blocks premium photoreal package renders when Blender surface mapping faces or rotation drift", () => {
	    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
	    const renderManifest = buildDigitalViewingRenderManifest(capture, {
	      presetId: "carport-site-southwest-preview",
	      deliveryTier: "premium-sales",
	      renderer: "cycles",
	      resolution: { width: 1600, height: 1000 },
	      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
	      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
	      outputPath: "renders/carport-southwest.png"
	    });
	    const assetBundle = buildDigitalViewingAssetBundleManifest(capture, renderManifest, {
	      existingFiles: [
	        "photos/carport-detail-panel.jpg",
	        "photos/carport-east.jpg",
	        "photos/carport-south.jpg",
	        "photos/carport-west.jpg",
	        "textures/carport-stone-foundation-normal.png",
	        "textures/carport-stone-foundation-roughness.png",
	        "textures/carport-white-panel-normal.png",
	        "textures/carport-white-panel-roughness.png"
	      ]
	    });
	    const stone = renderManifest.materials.find((material) => material.materialId === "dark-stone-foundation");
	    const wood = renderManifest.materials.find((material) => material.materialId === "painted-white-wood-panel");
	    expect(stone?.surfaceMapping).toBeDefined();
	    expect(wood?.surfaceMapping).toBeDefined();
	    const executedWithMisalignedSurfaceMapping = {
	      ...renderManifest,
	      blenderExecution: {
	        measurementApplication: {
	          applied: blenderMeasurementApplicationsFor(capture)
	        },
	        materialApplication: {
	          applied: [
	            {
	              object: "foundation-wall",
	              materialId: "dark-stone-foundation",
	              surfaceMapping: {
	                ...stone!.surfaceMapping!,
	                faces: ["front"]
	              },
	              appearanceCalibration: {
	                method: "white-balance-reference",
	                sourcePhoto: "photos/carport-south.jpg",
	                illuminant: "daylight",
	                confidence: "medium"
	              }
	            },
	            {
	              object: "cladding-southwest",
	              materialId: "painted-white-wood-panel",
	              surfaceMapping: {
	                ...wood!.surfaceMapping!,
	                rotationDeg: 90
	              },
	              appearanceCalibration: {
	                method: "white-balance-reference",
	                sourcePhoto: "photos/carport-west.jpg",
	                illuminant: "daylight",
	                confidence: "medium"
	              }
	            }
	          ],
	          textures: {
	            applied: [
	              { path: "textures/carport-stone-foundation-normal.png", type: "normal", colorSpace: "Non-Color", scaleMm: 500 },
	              { path: "textures/carport-stone-foundation-roughness.png", type: "roughness", colorSpace: "Non-Color", scaleMm: 500 },
	              { path: "textures/carport-white-panel-normal.png", type: "normal", colorSpace: "Non-Color", scaleMm: 900 },
	              { path: "textures/carport-white-panel-roughness.png", type: "roughness", colorSpace: "Non-Color", scaleMm: 900 }
	            ]
	          }
	        },
	        conditionApplication: {
	          applied: [
	            { conditionId: "white-panel-weathering", hostElementId: "cladding-southwest" }
	          ]
	        },
	        assetBundle: {
	          manifestType: "digital-viewing-asset-bundle" as const,
	          ready: true,
	          assetBundleHash: assetBundle.hashes.assetBundleHash,
	          requiredCount: assetBundle.summary.requiredCount,
	          missingCount: assetBundle.summary.missingCount
	        }
	      }
	    };

	    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, executedWithMisalignedSurfaceMapping, undefined, undefined, assetBundle);

	    expect(deliveryPackage.qualityGates.ready).toBe(false);
	    expect(deliveryPackage.qualityGates.blocking).toContainEqual({
	      id: "render-manifest:surface-mapping",
	      code: "render_material_surface_mapping_incomplete",
	      message: "Premium photoreal delivery packages require Blender execution metadata showing surface mapping for every mapped material."
	    });
	    expect(deliveryPackage.materialRenderCoverage).toMatchObject({
	      surfaceMappingMatchedCount: 0,
	      surfaceMappingMismatchCount: 2,
	      materialFidelityReadyCount: 0,
	      materialFidelityBlockedCount: 2
	    });
	    const stoneEntry = deliveryPackage.materialRenderCoverage.entries.find((entry) => entry.materialId === "dark-stone-foundation");
	    const woodEntry = deliveryPackage.materialRenderCoverage.entries.find((entry) => entry.materialId === "painted-white-wood-panel");
	    expect(stoneEntry).toMatchObject({
	      surfaceMappingExecutionStatus: "mismatched",
	      materialFidelityIssues: ["surface-mapping-mismatched"]
	    });
	    expect(stoneEntry?.surfaceMappingReadback).toMatchObject({
	      faces: ["front"],
	      rotationDeg: 0
	    });
	    expect(woodEntry).toMatchObject({
	      surfaceMappingExecutionStatus: "mismatched",
	      materialFidelityIssues: ["surface-mapping-mismatched"]
	    });
	    expect(woodEntry?.surfaceMappingReadback).toMatchObject({
	      faces: ["front"],
	      rotationDeg: 90
	    });
	    expect(deliveryPackage.customerReadinessSummary.nextActions).toContain(
	      "Resolve material-fidelity: 0/2 material surface mappings matched Blender execution."
	    );
	  });

	  it("requires premium photoreal package renders to prove measurement anchors were preserved by Blender", () => {
	    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const assetBundle = buildDigitalViewingAssetBundleManifest(capture, renderManifest, {
      existingFiles: [
        "photos/carport-detail-panel.jpg",
        "photos/carport-east.jpg",
        "photos/carport-south.jpg",
        "photos/carport-west.jpg",
        "textures/carport-stone-foundation-normal.png",
        "textures/carport-stone-foundation-roughness.png",
        "textures/carport-white-panel-normal.png",
        "textures/carport-white-panel-roughness.png"
      ]
    });
    const executedWithoutMeasurementProof = {
      ...renderManifest,
      blenderExecution: {
        materialApplication: {
          textures: {
            applied: [
              { path: "textures/carport-stone-foundation-normal.png", type: "normal" },
              { path: "textures/carport-stone-foundation-roughness.png", type: "roughness" },
              { path: "textures/carport-white-panel-normal.png", type: "normal" },
              { path: "textures/carport-white-panel-roughness.png", type: "roughness" }
            ]
          }
        },
        conditionApplication: {
          applied: [
            { conditionId: "white-panel-weathering", hostElementId: "cladding-southwest" }
          ]
        },
        assetBundle: {
          manifestType: "digital-viewing-asset-bundle" as const,
          ready: true,
          assetBundleHash: assetBundle.hashes.assetBundleHash,
          requiredCount: assetBundle.summary.requiredCount,
          missingCount: assetBundle.summary.missingCount
        }
      }
    };
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, executedWithoutMeasurementProof, undefined, undefined, assetBundle);

    expect(deliveryPackage.qualityGates.ready).toBe(false);
    expect(deliveryPackage.qualityGates.blocking).toContainEqual({
      id: "render-manifest:measurements",
      code: "render_measurement_application_missing",
      message: "Premium photoreal delivery packages require Blender execution metadata for measurement anchors."
    });
    expect(deliveryPackage.qualityGates.blocking).toContainEqual({
      id: "render-manifest:dimension-overlays",
      code: "dimension_overlays_not_ready",
      message: "Delivery packages require every verified geometry measurement to have placement and Blender anchor evidence before customer dimension overlays."
    });
    expect(deliveryPackage.dimensionOverlayCoverage).toMatchObject({
      overlayCandidateCount: 8,
      overlayReadyCount: 0,
      overlayBlockedCount: 8
    });
    expect(deliveryPackage.customerReadinessSummary.nextActions).toContain(
      "Resolve dimension-overlays: 8 verified measurements need placement or Blender anchors before customer dimension overlays."
    );
  });

  it("blocks premium photoreal package renders when Blender measurement anchors lack applied value proof", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const assetBundle = buildDigitalViewingAssetBundleManifest(capture, renderManifest, {
      existingFiles: FullCarportAssetPaths
    });
    const executedWithoutMeasurementValueProof = {
      ...renderManifest,
      blenderExecution: {
        measurementApplication: {
          applied: blenderMeasurementApplicationsWithoutValueProofFor(capture)
        },
        materialApplication: {
          textures: {
            applied: renderManifest.materials.flatMap((material) =>
              material.textureMaps.map((textureMap) => ({
                path: textureMap.path,
                type: textureMap.type,
                scaleMm: textureMap.scaleMm,
                colorSpace: textureMap.colorSpace
              }))
            )
          }
        },
        conditionApplication: {
          applied: [
            { conditionId: "white-panel-weathering", hostElementId: "cladding-southwest" }
          ]
        },
        camera: {
          cameraName: "Measured_Render_south",
          sector: "south",
          mode: "perspective",
          referencePhoto: "photos/carport-south.jpg"
        },
        lighting: {
          environment: "site-reference",
          referencePhoto: "photos/carport-south.jpg",
          lightingReference: renderManifest.lightingReference?.lightingReference,
          colorReference: renderManifest.lightingReference?.colorReference,
          whiteBalanceKelvin: renderManifest.lightingReference?.whiteBalanceKelvin,
          exposureEv: renderManifest.lightingReference?.exposureEv
        },
        assetBundle: {
          manifestType: "digital-viewing-asset-bundle" as const,
          ready: true,
          assetBundleHash: assetBundle.hashes.assetBundleHash,
          requiredCount: assetBundle.summary.requiredCount,
          missingCount: assetBundle.summary.missingCount
        }
      }
    };
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, executedWithoutMeasurementValueProof, undefined, undefined, assetBundle);

    expect(deliveryPackage.qualityGates.ready).toBe(false);
    expect(deliveryPackage.qualityGates.blocking).toContainEqual({
      id: "render-manifest:measurements",
      code: "render_measurement_value_readback_missing",
      message: "Premium photoreal delivery packages require Blender execution metadata proving every verified measurement used its declared value."
    });
  });

  it("requires premium photoreal package renders to cite the camera reference photo used for viewing angle", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-studio-south-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 0.75 },
      outputPath: "renders/carport-south-studio.png"
    });
    const assetBundle = buildDigitalViewingAssetBundleManifest(capture, renderManifest, {
      existingFiles: [
        "photos/carport-detail-panel.jpg",
        "photos/carport-east.jpg",
        "photos/carport-south.jpg",
        "photos/carport-west.jpg",
        "textures/carport-stone-foundation-normal.png",
        "textures/carport-stone-foundation-roughness.png",
        "textures/carport-white-panel-normal.png",
        "textures/carport-white-panel-roughness.png"
      ]
    });
    const executedRenderManifest = {
      ...renderManifest,
      blenderExecution: {
        measurementApplication: {
          applied: blenderMeasurementApplicationsFor(capture)
        },
        materialApplication: {
          textures: {
            applied: [
              { path: "textures/carport-stone-foundation-normal.png", type: "normal" },
              { path: "textures/carport-stone-foundation-roughness.png", type: "roughness" },
              { path: "textures/carport-white-panel-normal.png", type: "normal" },
              { path: "textures/carport-white-panel-roughness.png", type: "roughness" }
            ]
          }
        },
        conditionApplication: {
          applied: [
            { conditionId: "white-panel-weathering", hostElementId: "cladding-southwest" }
          ]
        },
        assetBundle: {
          manifestType: "digital-viewing-asset-bundle" as const,
          ready: true,
          assetBundleHash: assetBundle.hashes.assetBundleHash,
          requiredCount: assetBundle.summary.requiredCount,
          missingCount: assetBundle.summary.missingCount
        }
      }
    };
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, executedRenderManifest, undefined, undefined, assetBundle);

    expect(deliveryPackage.qualityGates.ready).toBe(false);
    expect(deliveryPackage.qualityGates.blocking).toContainEqual({
      id: "render-manifest:camera-reference",
      code: "render_camera_reference_missing",
      message: "Premium photoreal delivery packages require the render camera to cite a verified reference photo for the viewing angle."
    });
  });

  it("requires premium photoreal package camera reference photos to include calibration metadata", () => {
    const sourceCapture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const capture = DigitalViewingCaptureSchema.parse({
      ...sourceCapture,
      photos: sourceCapture.photos.map((photo) => {
        if (photo.path !== "photos/carport-south.jpg" || !photo.captureMetadata) {
          return photo;
        }
        const captureMetadata = { ...photo.captureMetadata };
        delete captureMetadata.cameraDistanceMm;
        delete captureMetadata.focalLength35mmEquivalent;
        return { ...photo, captureMetadata };
      })
    });
    const renderManifest = buildDigitalViewingRenderManifest(sourceCapture, {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const assetBundle = buildDigitalViewingAssetBundleManifest(sourceCapture, renderManifest, {
      existingFiles: FullCarportAssetPaths
    });
    const executedRenderManifest = {
      ...renderManifest,
      blenderExecution: {
        measurementApplication: {
          applied: blenderMeasurementApplicationsFor(capture)
        },
        materialApplication: {
          applied: renderManifest.materials.map((material) => ({
            materialId: material.materialId,
            hostElementId: material.hostElementId,
            mapping: material.surfaceMapping,
            appearanceCalibration: material.appearanceCalibration
          })),
          textures: {
            applied: renderManifest.materials.flatMap((material) =>
              material.textureMaps.map((textureMap) => ({
                path: textureMap.path,
                type: textureMap.type,
                scaleMm: textureMap.scaleMm,
                colorSpace: textureMap.colorSpace
              }))
            )
          }
        },
        conditionApplication: {
          applied: [
            { conditionId: "white-panel-weathering", hostElementId: "cladding-southwest" }
          ]
        },
        camera: {
          cameraName: "Measured_Render_south",
          sector: "south",
          mode: "perspective",
          referencePhoto: "photos/carport-south.jpg"
        },
        lighting: {
          lights: ["Measured_Render_Key_Area", "Measured_Render_Fill_Area"],
          environment: "site-reference",
          referencePhoto: "photos/carport-south.jpg"
        },
        assetBundle: {
          manifestType: "digital-viewing-asset-bundle" as const,
          ready: true,
          assetBundleHash: assetBundle.hashes.assetBundleHash,
          requiredCount: assetBundle.summary.requiredCount,
          missingCount: assetBundle.summary.missingCount
        }
      }
    };
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, executedRenderManifest, undefined, undefined, assetBundle);

    expect(deliveryPackage.cameraReferenceCoverage).toMatchObject({
      status: "blocked",
      referencePhoto: "photos/carport-south.jpg",
      metadataStatus: "missing-calibration",
      missingCalibrationFields: ["cameraDistanceMm", "focalLength35mmEquivalent"]
    });
    expect(deliveryPackage.qualityGates.blocking).toContainEqual({
      id: "render-manifest:camera-reference-calibration",
      code: "render_camera_reference_calibration_missing",
      message: "Premium photoreal renders require camera reference photos to declare focal length and camera distance metadata."
    });
  });

  it("requires premium photoreal package renders to prove Blender camera execution matches the render preset", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const assetBundle = buildDigitalViewingAssetBundleManifest(capture, renderManifest, {
      existingFiles: [
        "photos/carport-detail-panel.jpg",
        "photos/carport-east.jpg",
        "photos/carport-south.jpg",
        "photos/carport-west.jpg",
        "textures/carport-stone-foundation-normal.png",
        "textures/carport-stone-foundation-roughness.png",
        "textures/carport-white-panel-normal.png",
        "textures/carport-white-panel-roughness.png"
      ]
    });
    const executedWithWrongCamera = {
      ...renderManifest,
      blenderExecution: {
        measurementApplication: {
          applied: blenderMeasurementApplicationsFor(capture)
        },
        materialApplication: {
          applied: [
            {
              object: "foundation-wall",
              materialId: "dark-stone-foundation",
              surfaceMapping: {
                projection: "box",
                faces: ["front", "left", "right"],
                scaleMm: 500,
                rotationDeg: 0,
                sourcePhoto: "photos/carport-south.jpg"
              },
              appearanceCalibration: {
                method: "white-balance-reference",
                sourcePhoto: "photos/carport-south.jpg",
                illuminant: "daylight",
                confidence: "medium"
              }
            },
            {
              object: "cladding-southwest",
              materialId: "painted-white-wood-panel",
              surfaceMapping: {
                projection: "planar",
                faces: ["front"],
                scaleMm: 900,
                rotationDeg: 0,
                sourcePhoto: "photos/carport-west.jpg"
              },
              appearanceCalibration: {
                method: "white-balance-reference",
                sourcePhoto: "photos/carport-west.jpg",
                illuminant: "daylight",
                confidence: "medium"
              }
            }
          ],
          textures: {
            applied: [
              { path: "textures/carport-stone-foundation-normal.png", type: "normal" },
              { path: "textures/carport-stone-foundation-roughness.png", type: "roughness" },
              { path: "textures/carport-white-panel-normal.png", type: "normal" },
              { path: "textures/carport-white-panel-roughness.png", type: "roughness" }
            ]
          }
        },
        conditionApplication: {
          applied: [
            { conditionId: "white-panel-weathering", hostElementId: "cladding-southwest" }
          ]
        },
        camera: {
          cameraName: "Measured_Render_north",
          sector: "north",
          mode: "perspective",
          referencePhoto: "photos/carport-south.jpg"
        },
        lighting: {
          lights: ["Measured_Render_Key_Area", "Measured_Render_Fill_Area"],
          environment: "site-reference",
          referencePhoto: "photos/carport-south.jpg"
        },
        assetBundle: {
          manifestType: "digital-viewing-asset-bundle" as const,
          ready: true,
          assetBundleHash: assetBundle.hashes.assetBundleHash,
          requiredCount: assetBundle.summary.requiredCount,
          missingCount: assetBundle.summary.missingCount
        }
      }
    };
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, executedWithWrongCamera, undefined, undefined, assetBundle);

    expect(deliveryPackage.qualityGates.ready).toBe(false);
    expect(deliveryPackage.qualityGates.blocking).toContainEqual({
      id: "render-manifest:camera-execution",
      code: "render_camera_execution_mismatch",
      message: "Premium photoreal delivery packages require Blender execution metadata proving the render camera matches the declared sector, mode, and reference photo."
    });
  });

  it("requires premium photoreal package renders to prove Blender executed yaw matches the reference photo", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const assetBundle = buildDigitalViewingAssetBundleManifest(capture, renderManifest, {
      existingFiles: FullCarportAssetPaths
    });
    const executedWithWrongYaw = {
      ...renderManifest,
      blenderExecution: {
        measurementApplication: {
          applied: blenderMeasurementApplicationsFor(capture)
        },
        materialApplication: {
          applied: renderManifest.materials.map((material) => ({
            object: material.hostElementId,
            materialId: material.materialId,
            surfaceMapping: material.surfaceMapping,
            appearanceCalibration: material.appearanceCalibration
          })),
          textures: {
            applied: renderManifest.materials.flatMap((material) =>
              material.textureMaps.map((textureMap) => ({
                path: textureMap.path,
                type: textureMap.type,
                scaleMm: textureMap.scaleMm,
                colorSpace: textureMap.colorSpace
              }))
            )
          }
        },
        conditionApplication: {
          applied: [
            { conditionId: "white-panel-weathering", hostElementId: "cladding-southwest" }
          ]
        },
        camera: {
          cameraName: "Measured_Render_south",
          sector: "south",
          mode: "perspective",
          referencePhoto: "photos/carport-south.jpg",
          appliedDistanceMm: 9000,
          appliedDistanceSource: "camera-reference",
          appliedFocalLength35mmEquivalent: 45,
          appliedFocalLengthSource: "camera-reference",
          cameraLocationM: [0, -11.4, 3.73],
          cameraTargetM: [0, 0, 1.35],
          sensorWidthMm: 36,
          executedYawDeg: 45,
          executedPitchDeg: -11.792372
        },
        lighting: {
          lights: ["Measured_Render_Key_Area", "Measured_Render_Fill_Area"],
          environment: "site-reference",
          referencePhoto: "photos/carport-south.jpg"
        },
        assetBundle: {
          manifestType: "digital-viewing-asset-bundle" as const,
          ready: true,
          assetBundleHash: assetBundle.hashes.assetBundleHash,
          requiredCount: assetBundle.summary.requiredCount,
          missingCount: assetBundle.summary.missingCount
        }
      }
    };
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, executedWithWrongYaw, undefined, undefined, assetBundle);

    expect(deliveryPackage.qualityGates.ready).toBe(false);
    expect(deliveryPackage.qualityGates.blocking).toContainEqual({
      id: "render-manifest:camera-execution",
      code: "render_camera_execution_mismatch",
      message: "Premium photoreal delivery packages require Blender execution metadata proving the render camera matches the declared sector, mode, and reference photo."
    });
  });

  it("requires premium photoreal package renders to prove Blender executed pitch matches the reference photo", () => {
    const baseCapture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const capture = DigitalViewingCaptureSchema.parse({
      ...baseCapture,
      photos: baseCapture.photos.map((photo) =>
        photo.path === "photos/carport-south.jpg" && photo.captureMetadata
          ? { ...photo, captureMetadata: { ...photo.captureMetadata, pitchDeg: 0 } }
          : photo
      )
    });
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const assetBundle = buildDigitalViewingAssetBundleManifest(capture, renderManifest, {
      existingFiles: FullCarportAssetPaths
    });
    const executedWithWrongPitch = {
      ...renderManifest,
      blenderExecution: {
        measurementApplication: {
          applied: blenderMeasurementApplicationsFor(capture)
        },
        materialApplication: {
          applied: renderManifest.materials.map((material) => ({
            object: material.hostElementId,
            materialId: material.materialId,
            surfaceMapping: material.surfaceMapping,
            appearanceCalibration: material.appearanceCalibration
          })),
          textures: {
            applied: renderManifest.materials.flatMap((material) =>
              material.textureMaps.map((textureMap) => ({
                path: textureMap.path,
                type: textureMap.type,
                scaleMm: textureMap.scaleMm,
                colorSpace: textureMap.colorSpace
              }))
            )
          }
        },
        conditionApplication: {
          applied: [
            { conditionId: "white-panel-weathering", hostElementId: "cladding-southwest" }
          ]
        },
        camera: {
          cameraName: "Measured_Render_south",
          sector: "south",
          mode: "perspective",
          referencePhoto: "photos/carport-south.jpg",
          appliedDistanceMm: 9000,
          appliedDistanceSource: "camera-reference",
          appliedFocalLength35mmEquivalent: 45,
          appliedFocalLengthSource: "camera-reference",
          cameraLocationM: [0, -11.4, 3.73],
          cameraTargetM: [0, 0, 1.35],
          sensorWidthMm: 36,
          executedYawDeg: 0,
          executedPitchDeg: 3
        },
        lighting: {
          lights: ["Measured_Render_Key_Area", "Measured_Render_Fill_Area"],
          environment: "site-reference",
          referencePhoto: "photos/carport-south.jpg"
        },
        assetBundle: {
          manifestType: "digital-viewing-asset-bundle" as const,
          ready: true,
          assetBundleHash: assetBundle.hashes.assetBundleHash,
          requiredCount: assetBundle.summary.requiredCount,
          missingCount: assetBundle.summary.missingCount
        }
      }
    };
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, executedWithWrongPitch, undefined, undefined, assetBundle);

    expect(deliveryPackage.qualityGates.ready).toBe(false);
    expect(deliveryPackage.qualityGates.blocking).toContainEqual({
      id: "render-manifest:camera-execution",
      code: "render_camera_execution_mismatch",
      message: "Premium photoreal delivery packages require Blender execution metadata proving the render camera matches the declared sector, mode, and reference photo."
    });
  });

  it("blocks premium photoreal package renders when Blender omits camera angle readback for a reference photo with angle metadata", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const assetBundle = buildDigitalViewingAssetBundleManifest(capture, renderManifest, {
      existingFiles: FullCarportAssetPaths
    });
    const executedWithoutAngleReadback = {
      ...renderManifest,
      blenderExecution: {
        measurementApplication: {
          applied: blenderMeasurementApplicationsFor(capture)
        },
        materialApplication: {
          applied: renderManifest.materials.map((material) => ({
            object: material.hostElementId,
            materialId: material.materialId,
            surfaceMapping: material.surfaceMapping,
            appearanceCalibration: material.appearanceCalibration
          })),
          textures: {
            applied: renderManifest.materials.flatMap((material) =>
              material.textureMaps.map((textureMap) => ({
                path: textureMap.path,
                type: textureMap.type,
                scaleMm: textureMap.scaleMm,
                colorSpace: textureMap.colorSpace
              }))
            )
          }
        },
        conditionApplication: {
          applied: [
            { conditionId: "white-panel-weathering", hostElementId: "cladding-southwest" }
          ]
        },
        camera: {
          cameraName: "Measured_Render_south",
          sector: "south",
          mode: "perspective",
          referencePhoto: "photos/carport-south.jpg",
          appliedDistanceMm: 9000,
          appliedDistanceSource: "camera-reference",
          appliedFocalLength35mmEquivalent: 45,
          appliedFocalLengthSource: "camera-reference",
          cameraLocationM: [0, -11.4, 3.73],
          cameraTargetM: [0, 0, 1.35],
          sensorWidthMm: 36
        },
        lighting: {
          lights: ["Measured_Render_Key_Area", "Measured_Render_Fill_Area"],
          environment: "site-reference",
          referencePhoto: "photos/carport-south.jpg"
        },
        assetBundle: {
          manifestType: "digital-viewing-asset-bundle" as const,
          ready: true,
          assetBundleHash: assetBundle.hashes.assetBundleHash,
          requiredCount: assetBundle.summary.requiredCount,
          missingCount: assetBundle.summary.missingCount
        }
      }
    };
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, executedWithoutAngleReadback, undefined, undefined, assetBundle);

    expect(deliveryPackage.qualityGates.ready).toBe(false);
    expect(deliveryPackage.qualityGates.blocking).toContainEqual({
      id: "render-manifest:camera-execution",
      code: "render_camera_angle_readback_missing",
      message: "Premium photoreal delivery packages require Blender camera execution metadata for every declared reference photo yaw and pitch value."
    });
  });

  it("blocks premium photoreal package renders when Blender camera execution lacks reference photo identity proof", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const assetBundle = buildDigitalViewingAssetBundleManifest(capture, renderManifest, {
      existingFiles: FullCarportAssetPaths,
      assetFiles: assetFilesFor(FullCarportAssetPaths)
    });
    const executedWithoutReferencePhotoIdentity = {
      ...renderManifest,
      blenderExecution: {
        measurementApplication: {
          applied: blenderMeasurementApplicationsFor(capture)
        },
        materialApplication: {
          applied: renderManifest.materials.map((material) => ({
            object: material.hostElementId,
            materialId: material.materialId,
            pbr: material.pbr,
            pbrReadback: {
              sourceOfTruth: "read-from-blender-material-node-values-after-application",
              fields: Object.keys(material.pbr).sort(),
              values: material.pbr
            },
            surfaceMapping: material.surfaceMapping,
            appearanceCalibration: material.appearanceCalibration
          })),
          textures: {
            applied: blenderTextureApplicationsFor(renderManifest, assetBundle)
          }
        },
        conditionApplication: {
          applied: [
            {
              conditionId: "white-panel-weathering",
              hostElementId: "cladding-southwest",
              face: "front",
              sourcePhotoIdentities: conditionSourcePhotoIdentitiesFor(capture, assetBundle, "white-panel-weathering"),
              surfacePlacement: {
                hostElementId: "cladding-southwest",
                face: "front",
                u: 0.5,
                v: 0.52,
                widthMm: 1800,
                heightMm: 40,
                rotationDeg: 0
              },
              visibilityProof: {
                sourceOfTruth: "created-visible-blender-overlay-object",
                objectName: "condition-white-panel-weathering",
                materialName: "condition-white-panel-weathering",
                visibleInRender: true,
                dimensionsMm: {
                  widthMm: 1800,
                  heightMm: 40
                },
                materialReadback: {
                  sourceOfTruth: "read-from-blender-condition-material-after-application",
                  baseColor: "#b0b0a8",
                  alpha: 1,
                  roughness: 0.82,
                  metallic: 0,
                  conditionType: "wear",
                  severity: "low"
                }
              }
            }
          ]
        },
        camera: {
          cameraName: "Measured_Render_south",
          sector: "south",
          mode: "perspective",
          referencePhoto: "photos/carport-south.jpg",
          appliedDistanceMm: 9000,
          appliedDistanceSource: "camera-reference",
          appliedFocalLength35mmEquivalent: 45,
          appliedFocalLengthSource: "camera-reference",
          cameraLocationM: [0, -11.4, 3.73],
          cameraTargetM: [0, 0, 1.35],
          sensorWidthMm: 36,
          executedYawDeg: 0,
          executedPitchDeg: 0
        },
        lighting: {
          lights: ["Measured_Render_Key_Area", "Measured_Render_Fill_Area"],
          environment: "site-reference",
          referencePhoto: "photos/carport-south.jpg",
          lightingReference: "daylight",
          colorReference: "known-white-reference",
          whiteBalanceKelvin: 5600,
          exposureEv: 0
        },
        assetBundle: {
          manifestType: "digital-viewing-asset-bundle" as const,
          ready: true,
          assetBundleHash: assetBundle.hashes.assetBundleHash,
          requiredCount: assetBundle.summary.requiredCount,
          missingCount: assetBundle.summary.missingCount
        }
      }
    };
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, executedWithoutReferencePhotoIdentity, undefined, undefined, assetBundle);

    expect(deliveryPackage.qualityGates.ready).toBe(false);
    expect(deliveryPackage.qualityGates.blocking).toContainEqual({
      id: "render-manifest:camera-reference-photo",
      code: "render_camera_reference_photo_identity_missing",
      message: "Premium photoreal delivery packages require Blender camera execution metadata proving the exact reference photo file used for camera alignment."
    });
  });

  it("blocks premium photoreal package renders when Blender lighting execution lacks reference photo identity proof", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const assetBundle = buildDigitalViewingAssetBundleManifest(capture, renderManifest, {
      existingFiles: FullCarportAssetPaths,
      assetFiles: assetFilesFor(FullCarportAssetPaths)
    });
    const executedWithoutLightingReferencePhotoIdentity = {
      ...renderManifest,
      blenderExecution: {
        measurementApplication: {
          applied: blenderMeasurementApplicationsFor(capture)
        },
        materialApplication: {
          applied: renderManifest.materials.map((material) => ({
            object: material.hostElementId,
            materialId: material.materialId,
            pbr: material.pbr,
            pbrReadback: {
              sourceOfTruth: "read-from-blender-material-node-values-after-application",
              fields: Object.keys(material.pbr).sort(),
              values: material.pbr
            },
            surfaceMapping: material.surfaceMapping,
            appearanceCalibration: material.appearanceCalibration
          })),
          textures: {
            applied: blenderTextureApplicationsFor(renderManifest, assetBundle)
          }
        },
        conditionApplication: {
          applied: [
            {
              conditionId: "white-panel-weathering",
              hostElementId: "cladding-southwest",
              face: "front",
              sourcePhotoIdentities: conditionSourcePhotoIdentitiesFor(capture, assetBundle, "white-panel-weathering"),
              surfacePlacement: {
                hostElementId: "cladding-southwest",
                face: "front",
                u: 0.5,
                v: 0.52,
                widthMm: 1800,
                heightMm: 40,
                rotationDeg: 0
              },
              visibilityProof: {
                sourceOfTruth: "created-visible-blender-overlay-object",
                objectName: "condition-white-panel-weathering",
                materialName: "condition-white-panel-weathering",
                visibleInRender: true,
                dimensionsMm: {
                  widthMm: 1800,
                  heightMm: 40
                },
                materialReadback: {
                  sourceOfTruth: "read-from-blender-condition-material-after-application",
                  baseColor: "#b0b0a8",
                  alpha: 1,
                  roughness: 0.82,
                  metallic: 0,
                  conditionType: "wear",
                  severity: "low"
                }
              }
            }
          ]
        },
        camera: {
          cameraName: "Measured_Render_south",
          sector: "south",
          mode: "perspective",
          referencePhoto: "photos/carport-south.jpg",
          referencePhotoIdentity: photoIdentityFor(assetBundle, "photos/carport-south.jpg"),
          appliedDistanceMm: 9000,
          appliedDistanceSource: "camera-reference",
          appliedFocalLength35mmEquivalent: 45,
          appliedFocalLengthSource: "camera-reference",
          cameraLocationM: [0, -11.4, 3.73],
          cameraTargetM: [0, 0, 1.35],
          sensorWidthMm: 36,
          executedYawDeg: 0,
          executedPitchDeg: 0
        },
        lighting: {
          lights: ["Measured_Render_Key_Area", "Measured_Render_Fill_Area"],
          environment: "site-reference",
          referencePhoto: "photos/carport-south.jpg",
          lightingReference: "daylight",
          colorReference: "known-white-reference",
          whiteBalanceKelvin: 5600,
          exposureEv: 0
        },
        assetBundle: {
          manifestType: "digital-viewing-asset-bundle" as const,
          ready: true,
          assetBundleHash: assetBundle.hashes.assetBundleHash,
          requiredCount: assetBundle.summary.requiredCount,
          missingCount: assetBundle.summary.missingCount
        }
      }
    };
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, executedWithoutLightingReferencePhotoIdentity, undefined, undefined, assetBundle);

    expect(deliveryPackage.qualityGates.ready).toBe(false);
    expect(deliveryPackage.qualityGates.blocking).toContainEqual({
      id: "render-manifest:lighting-reference-photo",
      code: "render_lighting_reference_photo_identity_missing",
      message: "Premium photoreal delivery packages require Blender lighting execution metadata proving the exact site-reference photo file used for lighting."
    });
  });

  it("blocks premium photoreal package renders when Blender material execution lacks source photo identity proof", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const assetBundle = buildDigitalViewingAssetBundleManifest(capture, renderManifest, {
      existingFiles: FullCarportAssetPaths,
      assetFiles: assetFilesFor(FullCarportAssetPaths)
    });
    const executedWithoutMaterialSourcePhotoIdentities = {
      ...renderManifest,
      blenderExecution: {
        measurementApplication: {
          applied: blenderMeasurementApplicationsFor(capture)
        },
        materialApplication: {
          applied: renderManifest.materials.map((material) => ({
            object: material.hostElementId,
            materialId: material.materialId,
            pbr: material.pbr,
            pbrReadback: {
              sourceOfTruth: "read-from-blender-material-node-values-after-application",
              fields: Object.keys(material.pbr).sort(),
              values: material.pbr
            },
            surfaceMapping: material.surfaceMapping,
            appearanceCalibration: material.appearanceCalibration
          })),
          textures: {
            applied: blenderTextureApplicationsFor(renderManifest, assetBundle)
          }
        },
        conditionApplication: {
          applied: [
            {
              conditionId: "white-panel-weathering",
              hostElementId: "cladding-southwest",
              face: "front",
              sourcePhotoIdentities: conditionSourcePhotoIdentitiesFor(capture, assetBundle, "white-panel-weathering"),
              surfacePlacement: {
                hostElementId: "cladding-southwest",
                face: "front",
                u: 0.5,
                v: 0.52,
                widthMm: 1800,
                heightMm: 40,
                rotationDeg: 0
              },
              visibilityProof: {
                sourceOfTruth: "created-visible-blender-overlay-object",
                objectName: "condition-white-panel-weathering",
                materialName: "condition-white-panel-weathering",
                visibleInRender: true,
                dimensionsMm: {
                  widthMm: 1800,
                  heightMm: 40
                },
                materialReadback: {
                  sourceOfTruth: "read-from-blender-condition-material-after-application",
                  baseColor: "#b0b0a8",
                  alpha: 1,
                  roughness: 0.82,
                  metallic: 0,
                  conditionType: "wear",
                  severity: "low"
                }
              }
            }
          ]
        },
        camera: {
          cameraName: "Measured_Render_south",
          sector: "south",
          mode: "perspective",
          referencePhoto: "photos/carport-south.jpg",
          referencePhotoIdentity: photoIdentityFor(assetBundle, "photos/carport-south.jpg"),
          appliedDistanceMm: 9000,
          appliedDistanceSource: "camera-reference",
          appliedFocalLength35mmEquivalent: 45,
          appliedFocalLengthSource: "camera-reference",
          cameraLocationM: [0, -11.4, 3.73],
          cameraTargetM: [0, 0, 1.35],
          sensorWidthMm: 36,
          executedYawDeg: 0,
          executedPitchDeg: 0
        },
        lighting: {
          lights: ["Measured_Render_Key_Area", "Measured_Render_Fill_Area"],
          environment: "site-reference",
          referencePhoto: "photos/carport-south.jpg",
          referencePhotoIdentity: photoIdentityFor(assetBundle, "photos/carport-south.jpg"),
          lightingReference: "daylight",
          colorReference: "known-white-reference",
          whiteBalanceKelvin: 5600,
          exposureEv: 0
        },
        assetBundle: {
          manifestType: "digital-viewing-asset-bundle" as const,
          ready: true,
          assetBundleHash: assetBundle.hashes.assetBundleHash,
          requiredCount: assetBundle.summary.requiredCount,
          missingCount: assetBundle.summary.missingCount
        }
      }
    };
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, executedWithoutMaterialSourcePhotoIdentities, undefined, undefined, assetBundle);

    expect(deliveryPackage.qualityGates.ready).toBe(false);
    expect(deliveryPackage.qualityGates.blocking).toContainEqual({
      id: "render-manifest:material-source-photos",
      code: "render_material_source_photo_identity_missing",
      message: "Premium photoreal delivery packages require Blender material execution metadata proving every material source, surface-mapping, and appearance-calibration photo file."
    });
  });

  it("requires premium photoreal package renders to prove site-reference lighting was applied by Blender", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const assetBundle = buildDigitalViewingAssetBundleManifest(capture, renderManifest, {
      existingFiles: [
        "photos/carport-detail-panel.jpg",
        "photos/carport-east.jpg",
        "photos/carport-south.jpg",
        "photos/carport-west.jpg",
        "textures/carport-stone-foundation-normal.png",
        "textures/carport-stone-foundation-roughness.png",
        "textures/carport-white-panel-normal.png",
        "textures/carport-white-panel-roughness.png"
      ]
    });
    const executedWithoutLightingProof = {
      ...renderManifest,
      blenderExecution: {
        measurementApplication: {
          applied: blenderMeasurementApplicationsFor(capture)
        },
        materialApplication: {
          applied: [
            {
              object: "foundation-wall",
              materialId: "dark-stone-foundation",
              surfaceMapping: {
                projection: "box",
                faces: ["front", "left", "right"],
                scaleMm: 500,
                rotationDeg: 0,
                sourcePhoto: "photos/carport-south.jpg"
              },
              appearanceCalibration: {
                method: "white-balance-reference",
                sourcePhoto: "photos/carport-south.jpg",
                illuminant: "daylight",
                confidence: "medium"
              }
            },
            {
              object: "cladding-southwest",
              materialId: "painted-white-wood-panel",
              surfaceMapping: {
                projection: "planar",
                faces: ["front"],
                scaleMm: 900,
                rotationDeg: 0,
                sourcePhoto: "photos/carport-west.jpg"
              },
              appearanceCalibration: {
                method: "white-balance-reference",
                sourcePhoto: "photos/carport-west.jpg",
                illuminant: "daylight",
                confidence: "medium"
              }
            }
          ],
          textures: {
            applied: [
              { path: "textures/carport-stone-foundation-normal.png", type: "normal" },
              { path: "textures/carport-stone-foundation-roughness.png", type: "roughness" },
              { path: "textures/carport-white-panel-normal.png", type: "normal" },
              { path: "textures/carport-white-panel-roughness.png", type: "roughness" }
            ]
          }
        },
        conditionApplication: {
          applied: [
            { conditionId: "white-panel-weathering", hostElementId: "cladding-southwest" }
          ]
        },
        camera: {
          cameraName: "Measured_Render_south",
          sector: "south",
          mode: "perspective",
          referencePhoto: "photos/carport-south.jpg"
        },
        assetBundle: {
          manifestType: "digital-viewing-asset-bundle" as const,
          ready: true,
          assetBundleHash: assetBundle.hashes.assetBundleHash,
          requiredCount: assetBundle.summary.requiredCount,
          missingCount: assetBundle.summary.missingCount
        }
      }
    };
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, executedWithoutLightingProof, undefined, undefined, assetBundle);

    expect(deliveryPackage.qualityGates.ready).toBe(false);
    expect(deliveryPackage.qualityGates.blocking).toContainEqual({
      id: "render-manifest:lighting-reference",
      code: "render_lighting_reference_missing",
      message: "Premium photoreal delivery packages require Blender execution metadata proving site-reference lighting used the declared reference photo."
    });
  });

  it("blocks premium photoreal package renders when Blender lighting metadata does not match the declared site reference", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const assetBundle = buildDigitalViewingAssetBundleManifest(capture, renderManifest, {
      existingFiles: FullCarportAssetPaths,
      assetFiles: assetFilesFor(FullCarportAssetPaths)
    });
    const lightingReferencePhoto = assetBundle.assets.find((asset) => asset.path === "photos/carport-south.jpg");
    expect(lightingReferencePhoto).toBeDefined();
    const executedWithWrongLightingMetadata = {
      ...renderManifest,
      blenderExecution: {
        measurementApplication: {
          applied: blenderMeasurementApplicationsFor(capture)
        },
        materialApplication: {
          applied: [],
          textures: { applied: [] }
        },
        conditionApplication: { applied: [] },
        camera: {
          cameraName: "Measured_Render_south",
          sector: "south",
          mode: "perspective",
          referencePhoto: "photos/carport-south.jpg"
        },
        lighting: {
          environment: "site-reference",
          referencePhoto: "photos/carport-south.jpg",
          lightingReference: "daylight",
          colorReference: "known-white-reference",
          whiteBalanceKelvin: 6200,
          exposureEv: 0.7,
          referencePhotoIdentity: {
            path: "photos/carport-south.jpg",
            sizeBytes: lightingReferencePhoto?.sizeBytes,
            sha256: lightingReferencePhoto?.sha256
          }
        },
        assetBundle: {
          manifestType: "digital-viewing-asset-bundle" as const,
          ready: true,
          assetBundleHash: assetBundle.hashes.assetBundleHash,
          requiredCount: assetBundle.summary.requiredCount,
          missingCount: assetBundle.summary.missingCount
        }
      }
    };
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(
      capture,
      executedWithWrongLightingMetadata,
      undefined,
      undefined,
      assetBundle
    );

    expect(deliveryPackage.qualityGates.ready).toBe(false);
    expect(deliveryPackage.qualityGates.blocking).toContainEqual({
      id: "render-manifest:lighting-reference",
      code: "render_lighting_reference_mismatch",
      message: "Premium photoreal delivery packages require Blender lighting execution metadata to match the declared lighting reference metadata."
    });
    expect(deliveryPackage.renderExecutionCoverage.lighting).toMatchObject({
      declaredLightingReference: "daylight",
      declaredColorReference: "known-white-reference",
      declaredWhiteBalanceKelvin: 5600,
      declaredExposureEv: 0,
      executedLightingReference: "daylight",
      executedColorReference: "known-white-reference",
      executedWhiteBalanceKelvin: 6200,
      executedExposureEv: 0.7,
      status: "mismatched"
    });
    expect(deliveryPackage.photorealQualityChecklist).toContainEqual(
      expect.objectContaining({
        check: "lighting",
        status: "failed",
        evidence: "site-reference lighting matched photos/carport-south.jpg with file identity"
      })
    );
  });

  it("exposes sellable delivery profiles for customer-facing packages", () => {
    const profiles = listDigitalViewingDeliveryProfiles();
    const salesListing = getDigitalViewingDeliveryProfile("sales-listing");

    expect(profiles.map((profile) => profile.customerSurface)).toEqual([
      "internal-review",
      "sales-listing",
      "showroom",
      "broker-preview",
      "permit-support"
    ]);
    expect(salesListing.profileId).toBe("digital-viewing-sales-listing");
    expect(salesListing.positioning).toBe("Sales listing package for buyer-facing digital viewing.");
    expect(salesListing.requiredTargets).toEqual(["photoreal-render", "material-condition-report", "glb"]);
    expect(salesListing.optionalTargets).toEqual(["web-viewer", "technical-views"]);
    expect(salesListing.notGeometryAuthority).toBe(true);
    expect(salesListing.sourceOfTruth).toEqual({
      measurements: "geometry-scale-placement",
      photos: "material-condition-context-evidence",
      blender: "locked-renderable-scene",
      profile: "customer-surface-target-contract-no-geometry-reconstruction"
    });
  });

  it("evaluates delivery profile readiness against declared capture outputs", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const salesListing = evaluateDigitalViewingDeliveryProfileReadiness(capture, "sales-listing");
    const showroom = evaluateDigitalViewingDeliveryProfileReadiness(capture, "showroom");

    expect(salesListing.ok).toBe(true);
    expect(salesListing.blocking).toEqual([]);
    expect(salesListing.requiredTargets.map((target) => [target.target, target.declaredInCapture])).toEqual([
      ["photoreal-render", true],
      ["material-condition-report", true],
      ["glb", true]
    ]);
    expect(showroom.ok).toBe(false);
    expect(showroom.blocking).toContainEqual({
      id: "delivery-profile:web-viewer",
      code: "profile_target_not_declared",
      message: "Capture outputTargets must declare required customer-surface target 'web-viewer'."
    });
  });

  it("derives required delivery targets from the selected customer surface", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, renderManifest, undefined, "broker-preview");

    expect(deliveryPackage.customerSurface).toBe("broker-preview");
    expect(deliveryPackage.deliveryTargets.map((target) => [target.target, target.status])).toEqual([
      ["photoreal-render", "ready"],
      ["material-condition-report", "ready"],
      ["technical-views", "missing"]
    ]);
    expect(deliveryPackage.customerReadinessSummary).toEqual({
      customerSurface: "broker-preview",
      status: "blocked",
      requiredTargetCount: 3,
      readyRequiredTargetCount: 2,
      missingRequiredTargetCount: 1,
      qualityCheckCount: 8,
      passedQualityCheckCount: 0,
      failedQualityCheckCount: 8,
      blockingCount: 6,
      warningCount: 2,
      nextActions: [
        "Delivery packages require every verified geometry measurement to have placement and Blender anchor evidence before customer dimension overlays.",
        "Delivery packages require every buyer-visible condition item to be ready as a rendered overlay before condition disclosure.",
        "Photoreal customer delivery packages require Blender render quality execution to satisfy the declared render profile.",
        "Photoreal customer delivery packages require Blender to report the exact rendered artifact path, byte size, and SHA-256.",
        "Premium photoreal delivery packages require an asset-bundle manifest.",
        "Requested delivery target 'technical-views' is not present in this package manifest.",
        "Resolve asset-bundle: asset bundle missing",
        "Resolve render-output: renders/carport-southwest.png render artifact identity matched Blender output",
        "Resolve measurements: 8 geometry measurements preserved as Blender anchors with declared values",
        "Resolve materials: 2 host-targeted materials applied with calibrated appearance, surface mapping, and source photo file identity",
        "Resolve textures: 4 declared texture maps applied with physical scale, matched color space, and file identity",
        "Resolve conditions: 1 buyer-visible condition items rendered",
      "Resolve camera: south perspective camera matched photos/carport-south.jpg with file identity",
      "Resolve lighting: site-reference lighting matched photos/carport-south.jpg with file identity",
        "Resolve material-fidelity: 0/2 host-targeted materials applied by Blender.",
        "Resolve material-character: 0/2 photo-calibrated material appearances matched Blender execution for customer material feel.",
        "Resolve condition-render: 0/1 buyer-visible condition items rendered by Blender for customer condition disclosure.",
        "Resolve condition-disclosure: 0/1 visible condition overlays ready for customer disclosure.",
        "Resolve dimension-overlays: 8 verified measurements need placement or Blender anchors before customer dimension overlays.",
        "Resolve render-quality: Blender render settings must be customer-ready before photoreal viewing."
      ],
      sourceOfTruth: "derived-from-delivery-targets-quality-checks-gates-asset-bundle-render-execution-photo-evidence-capture-angles-material-categories-material-calibration-pbr-materials-material-render-material-character-inspection-zones-condition-render-condition-overlays-render-quality-and-reference-comparison"
    });
    expect(deliveryPackage.qualityGates.blocking).toContainEqual({
      id: "delivery-target:technical-views",
      code: "delivery_target_missing",
      message: "Requested delivery target 'technical-views' is not present in this package manifest."
    });
  });

  it("blocks delivery package manifests when requested customer targets are missing", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "studio-front-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1920, height: 1080 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 1 },
      outputPath: "renders/vehicle-front.png"
    });
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, renderManifest, ["photoreal-render", "glb"]);

    expect(deliveryPackage.qualityGates.ready).toBe(false);
    expect(deliveryPackage.deliveryTargets.map((target) => [target.target, target.status])).toEqual([
      ["photoreal-render", "ready"],
      ["glb", "missing"]
    ]);
    expect(deliveryPackage.qualityGates.blocking).toContainEqual({
      id: "delivery-target:glb",
      code: "delivery_target_missing",
      message: "Requested delivery target 'glb' is not present in this package manifest."
    });
  });

  it("indexes provided customer delivery artifacts without reconstructing geometry", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "studio-front-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1920, height: 1080 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 1 },
      outputPath: "renders/vehicle-front.png"
    });
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(
      capture,
      renderManifest,
      ["photoreal-render", "glb", "web-viewer"],
      "showroom",
      undefined,
      undefined,
      [
        { target: "glb", path: "exports/vehicle.glb", hash: "a".repeat(64) },
        { target: "web-viewer", path: "web/vehicle-viewer/index.html", hash: "b".repeat(64) }
      ]
    );

    expect(deliveryPackage.notGeometryAuthority).toBe(true);
    expect(deliveryPackage.sourceOfTruth.package).toBe("delivery-index-no-geometry-reconstruction");
    expect(deliveryPackage.deliveryTargets.map((target) => [target.target, target.status, target.path, target.hash])).toEqual([
      ["photoreal-render", "ready", "renders/vehicle-front.png", undefined],
      ["glb", "ready", "exports/vehicle.glb", "a".repeat(64)],
      ["web-viewer", "ready", "web/vehicle-viewer/index.html", "b".repeat(64)]
    ]);
    expect(deliveryPackage.customerViewingChecklist.items).toContainEqual({
      item: "model-artifact",
      category: "delivery",
      sourceCoverage: "deliveryTargets",
      sourceIds: ["glb"],
      required: true,
      status: "ready",
      evidence: "1/1 required model artifacts ready"
    });
    expect(deliveryPackage.qualityGates.blocking).not.toContainEqual(expect.objectContaining({
      id: "delivery-target:glb",
      code: "delivery_target_missing"
    }));
    expect(deliveryPackage.qualityGates.blocking).not.toContainEqual(expect.objectContaining({
      id: "delivery-target:web-viewer",
      code: "delivery_target_missing"
    }));
  });

  it("blocks web viewer delivery when no model export artifact is indexed", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "studio-front-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1920, height: 1080 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 1 },
      outputPath: "renders/vehicle-front.png"
    });
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(
      capture,
      renderManifest,
      ["photoreal-render", "web-viewer"],
      "showroom",
      undefined,
      undefined,
      [
        { target: "web-viewer", path: "web/vehicle-viewer/index.html", hash: "c".repeat(64) }
      ]
    );

    expect(deliveryPackage.deliveryTargets.map((target) => [target.target, target.status])).toEqual([
      ["photoreal-render", "ready"],
      ["web-viewer", "ready"]
    ]);
    expect(deliveryPackage.qualityGates.ready).toBe(false);
    expect(deliveryPackage.qualityGates.blocking).toContainEqual({
      id: "delivery-target:web-viewer:model-artifact",
      code: "web_viewer_model_artifact_missing",
      message: "Web viewer delivery requires a ready GLB, USDZ, or Blend model artifact in the same package manifest."
    });
    expect(deliveryPackage.viewerLayerCoverage.entries).toContainEqual({
      layer: "web-delivery",
      required: true,
      status: "blocked",
      sourceIds: ["web-viewer"],
      evidence: "web-viewer target ready but model artifact missing"
    });
    expect(deliveryPackage.customerViewingChecklist.items).toContainEqual({
      item: "model-artifact",
      category: "delivery",
      sourceCoverage: "deliveryTargets",
      sourceIds: [],
      required: true,
      status: "blocked",
      evidence: "0/1 required model artifacts ready"
    });
    expect(deliveryPackage.customerViewingChecklist.items).toContainEqual({
      item: "web-model",
      category: "delivery",
      sourceCoverage: "deliveryTargets",
      sourceIds: ["web-viewer"],
      required: true,
      status: "blocked",
      evidence: "web-viewer target ready but model artifact missing"
    });
  });

  it("blocks customer delivery artifacts that are indexed without hashes", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "studio-front-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1920, height: 1080 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 1 },
      outputPath: "renders/vehicle-front.png"
    });
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(
      capture,
      renderManifest,
      ["photoreal-render", "glb", "web-viewer"],
      "showroom",
      undefined,
      undefined,
      [
        { target: "glb", path: "exports/vehicle.glb" },
        { target: "web-viewer", path: "web/vehicle-viewer/index.html" }
      ]
    );

    expect(deliveryPackage.deliveryTargets.map((target) => [target.target, target.status, target.hash])).toEqual([
      ["photoreal-render", "ready", undefined],
      ["glb", "ready", undefined],
      ["web-viewer", "ready", undefined]
    ]);
    expect(deliveryPackage.qualityGates.ready).toBe(false);
    expect(deliveryPackage.qualityGates.blocking).toContainEqual({
      id: "delivery-target:glb:hash",
      code: "delivery_artifact_hash_missing",
      message: "Customer delivery artifact 'glb' must include a content hash before it can be trusted in a package manifest."
    });
    expect(deliveryPackage.qualityGates.blocking).toContainEqual({
      id: "delivery-target:web-viewer:hash",
      code: "delivery_artifact_hash_missing",
      message: "Customer delivery artifact 'web-viewer' must include a content hash before it can be trusted in a package manifest."
    });
  });

  it("blocks photoreal delivery artifacts whose hash does not match the Blender render output", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "studio-front-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1920, height: 1080 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 1 },
      outputPath: "renders/vehicle-front.png"
    });
    const executedRenderManifest = {
      ...renderManifest,
      blenderExecution: {
        renderQuality: {
          renderer: "cycles",
          samples: 128,
          denoise: true,
          resolution: { width: 1920, height: 1080 },
          filmTransparent: false,
          viewTransform: "Filmic",
          look: "Medium High Contrast",
          worldColor: "#c7d1db"
        },
        renderArtifact: {
          path: "renders/vehicle-front.png",
          sizeBytes: 12000,
          sha256: "a".repeat(64)
        }
      }
    };
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(
      capture,
      executedRenderManifest,
      ["photoreal-render"],
      "internal-review",
      undefined,
      undefined,
      [{ target: "photoreal-render", path: "renders/vehicle-front.png", hash: "b".repeat(64) }]
    );

    expect(deliveryPackage.deliveryTargets).toContainEqual(expect.objectContaining({
      target: "photoreal-render",
      path: "renders/vehicle-front.png",
      hash: "b".repeat(64)
    }));
    expect(deliveryPackage.qualityGates.ready).toBe(false);
    expect(deliveryPackage.qualityGates.blocking).toContainEqual({
      id: "delivery-target:photoreal-render:hash",
      code: "render_artifact_hash_mismatch",
      message: "Photoreal delivery artifact hash must match the exact rendered artifact reported by Blender."
    });
  });

  it("blocks photoreal delivery when the rendered image dimensions do not match the preset resolution", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "studio-front-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1920, height: 1080 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 1 },
      outputPath: "renders/vehicle-front.png"
    });
    const executedRenderManifest = {
      ...renderManifest,
      blenderExecution: {
        renderQuality: {
          renderer: "cycles",
          samples: 128,
          denoise: true,
          resolution: { width: 1920, height: 1080 },
          filmTransparent: false,
          viewTransform: "Filmic",
          look: "Medium High Contrast",
          worldColor: "#c7d1db"
        },
        renderArtifact: {
          path: "renders/vehicle-front.png",
          sizeBytes: 12000,
          sha256: "a".repeat(64),
          width: 1280,
          height: 720
        }
      }
    };
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, executedRenderManifest, ["photoreal-render"]);

    expect(deliveryPackage.renderExecutionCoverage.renderArtifact).toEqual(expect.objectContaining({
      declaredWidth: 1920,
      declaredHeight: 1080,
      executedWidth: 1280,
      executedHeight: 720,
      status: "mismatched"
    }));
    expect(deliveryPackage.qualityGates.ready).toBe(false);
    expect(deliveryPackage.qualityGates.blocking).toContainEqual({
      id: "render-manifest:render-artifact-resolution",
      code: "render_artifact_resolution_mismatch",
      message: "Photoreal customer delivery packages require the rendered image dimensions to match the declared render preset resolution."
    });
  });

  it("blocks vehicle photoreal readiness when render sampling is below the domain profile", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "studio-front-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1920, height: 1080 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 1 },
      outputPath: "renders/vehicle-front.png"
    });
    const executedRenderManifest = {
      ...renderManifest,
      blenderExecution: {
        renderQuality: {
          renderer: "cycles",
          samples: 64,
          denoise: true,
          resolution: { width: 1920, height: 1080 },
          filmTransparent: false,
          viewTransform: "Filmic",
          look: "Medium High Contrast",
          worldColor: "#c7d1db"
        }
      }
    };
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, executedRenderManifest, ["photoreal-render"]);

    expect(deliveryPackage.renderQualityCoverage.declared).toMatchObject({
      assetType: "vehicle",
      renderer: "cycles",
      deliveryTier: "premium-sales"
    });
    expect(deliveryPackage.renderQualityCoverage.status).toBe("blocked");
    expect(deliveryPackage.renderQualityCoverage.checks).toContainEqual({
      check: "sampling",
      status: "failed",
      evidence: "vehicle premium-sales requires 128 cycles samples with denoise enabled; got 64"
    });
    expect(deliveryPackage.viewerLayerCoverage.entries).toContainEqual({
      layer: "photoreal-scene",
      required: true,
      status: "blocked",
      sourceIds: ["photoreal-render"],
      evidence: "render quality blocked"
    });
  });

  it("blocks vehicle photoreal readiness when render resolution is below the domain profile", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "studio-front-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1920, height: 1080 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 1 },
      outputPath: "renders/vehicle-front.png"
    });
    const executedRenderManifest = {
      ...renderManifest,
      blenderExecution: {
        renderQuality: {
          renderer: "cycles",
          samples: 128,
          denoise: true,
          resolution: { width: 1920, height: 1080 },
          filmTransparent: false,
          viewTransform: "Filmic",
          look: "Medium High Contrast",
          exposure: 0,
          gamma: 1,
          worldColor: "#c7d1db"
        }
      }
    };
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, executedRenderManifest, ["photoreal-render"]);

    expect(deliveryPackage.renderQualityCoverage.declared).toMatchObject({
      qualityProfile: {
        minWidth: 2560,
        minHeight: 1440
      }
    });
    expect(deliveryPackage.renderQualityCoverage.status).toBe("blocked");
    expect(deliveryPackage.renderQualityCoverage.checks).toContainEqual({
      check: "resolution",
      status: "failed",
      evidence: "vehicle premium-sales requires at least 2560x1440 render resolution; got 1920x1080"
    });
  });

  it("blocks premium photoreal readiness when color management exposure and gamma are not proven neutral", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "studio-front-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1920, height: 1080 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 1 },
      outputPath: "renders/vehicle-front.png"
    });
    const executedRenderManifest = {
      ...renderManifest,
      blenderExecution: {
        renderQuality: {
          renderer: "cycles",
          samples: 128,
          denoise: true,
          resolution: { width: 1920, height: 1080 },
          filmTransparent: false,
          viewTransform: "Filmic",
          look: "Medium High Contrast",
          worldColor: "#c7d1db"
        }
      }
    };
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, executedRenderManifest, ["photoreal-render"]);

    expect(deliveryPackage.renderQualityCoverage.status).toBe("blocked");
    expect(deliveryPackage.renderQualityCoverage.checks).toContainEqual({
      check: "color-management",
      status: "failed",
      evidence: "Filmic / Medium High Contrast / exposure missing / gamma missing"
    });
    expect(deliveryPackage.viewerLayerCoverage.entries).toContainEqual({
      layer: "photoreal-scene",
      required: true,
      status: "blocked",
      sourceIds: ["photoreal-render"],
      evidence: "render quality blocked"
    });
  });

  it("reports missing domain-required material categories in delivery packages", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "studio-front-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1920, height: 1080 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 1 },
      outputPath: "renders/vehicle-front.png"
    });
    const manifestWithoutGlass = {
      ...renderManifest,
      materials: renderManifest.materials.filter((material) => material.category !== "glass")
    };
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, manifestWithoutGlass, ["photoreal-render"]);

    expect(deliveryPackage.materialCategoryCoverage).toEqual({
      sourceOfTruth: "derived-from-domain-capture-preset-and-render-manifest-material-categories",
      requiredCategoryCount: 5,
      coveredCategoryCount: 4,
      missingCategoryCount: 1,
      entries: [
        { category: "glass", required: true, status: "missing", materialIds: [] },
        { category: "leather", required: true, status: "ready", materialIds: ["interior-leather"] },
        { category: "metal", required: true, status: "ready", materialIds: ["wheel-metal"] },
        { category: "paint", required: true, status: "ready", materialIds: ["body-paint"] },
        { category: "rubber", required: true, status: "ready", materialIds: ["tire-rubber"] }
      ]
    });
    expect(deliveryPackage.viewerLayerCoverage.entries).toContainEqual({
      layer: "material-fidelity",
      required: true,
      status: "blocked",
      sourceIds: ["body-paint", "interior-leather", "tire-rubber", "wheel-metal"],
      evidence: "4/5 required material categories covered"
    });
    expect(deliveryPackage.qualityGates.ready).toBe(false);
    expect(deliveryPackage.qualityGates.blocking).toContainEqual({
      id: "render-manifest:material-categories",
      code: "material_categories_not_ready",
      message: "Delivery packages require every domain-required material category to be present in the render manifest."
    });
    expect(deliveryPackage.customerReadinessSummary.nextActions).toContain(
      "Resolve material-categories: 4/5 domain-required material categories present in the render manifest."
    );
  });

  it("reports incomplete PBR material definitions in delivery packages", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "studio-front-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1920, height: 1080 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 1 },
      outputPath: "renders/vehicle-front.png"
    });
    const incompletePbrManifest = DigitalViewingRenderManifestSchema.parse({
      ...renderManifest,
      materials: renderManifest.materials.map((material) =>
        material.materialId === "body-paint"
          ? {
              ...material,
              pbr: {
                ...material.pbr,
                normalSource: "unknown",
                textureScaleMm: undefined
              },
              textureMaps: material.textureMaps.filter((textureMap) => textureMap.type !== "normal")
            }
          : material
      )
    });
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, incompletePbrManifest);
    const bodyPaintCompleteness = deliveryPackage.pbrMaterialCompletenessCoverage.entries.find((entry) => entry.materialId === "body-paint");

    expect(deliveryPackage.pbrMaterialCompletenessCoverage.incompleteMaterialCount).toBe(1);
    expect(bodyPaintCompleteness).toBeDefined();
    expect(bodyPaintCompleteness?.completenessStatus).toBe("incomplete");
    expect(bodyPaintCompleteness?.missingTextureTypes).toEqual(["normal"]);
    expect(bodyPaintCompleteness?.pbrFields.normalSource).toBe("missing");
    expect(bodyPaintCompleteness?.pbrFields.textureScaleMm).toBe("missing");
    expect(deliveryPackage.qualityGates.ready).toBe(false);
    expect(deliveryPackage.qualityGates.blocking).toContainEqual({
      id: "render-manifest:pbr-materials",
      code: "pbr_materials_not_ready",
      message: "Delivery packages require every material to have complete PBR fields and premium texture evidence before photoreal customer rendering."
    });
    expect(deliveryPackage.customerReadinessSummary.nextActions).toContain(
      "Resolve pbr-materials: 4/5 renderable PBR material definitions complete for photoreal customer delivery."
    );
  });

  it("blocks premium vehicle material fidelity when finish values are outside the domain profile", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const captureWithOverlyMattePaint = DigitalViewingCaptureSchema.parse({
      ...capture,
      materials: capture.materials.map((material) =>
        material.materialId === "body-paint"
          ? { ...material, roughness: 0.92 }
          : material
      )
    });
    const renderManifest = buildDigitalViewingRenderManifest(captureWithOverlyMattePaint, {
      presetId: "studio-front-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 2560, height: 1440 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 1 },
      outputPath: "renders/vehicle-front.png"
    });
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(captureWithOverlyMattePaint, renderManifest);
    const bodyPaintCompleteness = deliveryPackage.pbrMaterialCompletenessCoverage.entries.find((entry) => entry.materialId === "body-paint");

    expect(bodyPaintCompleteness).toBeDefined();
    expect(bodyPaintCompleteness?.finishProfile).toEqual({
      profileId: "automotive-paint-finish",
      roughness: { min: 0.18, max: 0.65 },
      metallic: { min: 0, max: 0.2 }
    });
    expect(bodyPaintCompleteness?.finishProfileStatus).toBe("out-of-range");
    expect(bodyPaintCompleteness?.finishProfileIssues).toEqual([
      "roughness 0.92 outside automotive-paint-finish range 0.18-0.65"
    ]);
    expect(deliveryPackage.pbrMaterialCompletenessCoverage.incompleteMaterialCount).toBe(1);
    expect(deliveryPackage.qualityGates.blocking).toContainEqual({
      id: "render-manifest:pbr-materials",
      code: "pbr_materials_not_ready",
      message: "Delivery packages require every material to have complete PBR fields and premium texture evidence before photoreal customer rendering."
    });
  });

  it("reports renderable dimension annotations from verified measurement placement", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const executedRenderManifest = {
      ...renderManifest,
      blenderExecution: {
        measurementApplication: {
          applied: blenderMeasurementApplicationsFor(capture)
        }
      }
    };
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, executedRenderManifest);

    expect(deliveryPackage.dimensionOverlayCoverage.entries).toContainEqual(expect.objectContaining({
      measurementId: "overall-width",
      overlayStatus: "ready",
      annotation: {
        text: "Carport width: 7676 mm",
        value: 7676,
        tolerance: 1,
        unit: "mm",
        axis: "x",
        hostElementId: "carport-frame",
        referenceFrame: "asset-local",
        from: "west outer post plane",
        to: "east outer post plane",
        source: "drawing",
        confidence: "high"
      }
    }));
  });

  it("reports renderable condition disclosures from verified visible condition evidence", () => {
    const baseCapture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const detailPhoto = baseCapture.photos.find((photo) => photo.path === "photos/carport-detail-panel.jpg");
    if (!detailPhoto) {
      throw new Error("Expected carport detail photo fixture");
    }
    const capture = DigitalViewingCaptureSchema.parse({
      ...baseCapture,
      photos: [
        ...baseCapture.photos.map((photo) =>
          photo.path === "photos/carport-detail-panel.jpg" && photo.captureMetadata
            ? {
                ...photo,
                captureMetadata: {
                  ...photo.captureMetadata,
                  materialCategories: ["wood" as const]
                }
              }
            : photo
        ),
        {
          ...detailPhoto,
          path: "photos/carport-detail-panel-closeup.jpg",
          captureMetadata: detailPhoto.captureMetadata
            ? {
                ...detailPhoto.captureMetadata,
                materialCategories: ["wood" as const]
              }
            : detailPhoto.captureMetadata
        }
      ],
      conditions: baseCapture.conditions.map((condition) =>
        condition.id === "white-panel-weathering"
          ? {
              ...condition,
              photoSources: ["photos/carport-detail-panel.jpg", "photos/carport-detail-panel-closeup.jpg"]
            }
          : condition
      )
    });
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const executedRenderManifest = {
      ...renderManifest,
      blenderExecution: {
        conditionApplication: {
          applied: [
            {
              conditionId: "white-panel-weathering",
              hostElementId: "cladding-southwest",
              face: "front",
              surfacePlacement: {
                hostElementId: "cladding-southwest",
                face: "front",
                u: 0.5,
                v: 0.52,
                widthMm: 1800,
                heightMm: 40,
                rotationDeg: 0
              },
              visibilityProof: {
                sourceOfTruth: "created-visible-blender-overlay-object",
                objectName: "condition-white-panel-weathering",
                materialName: "condition-weathering",
                visibleInRender: true,
                dimensionsMm: {
                  widthMm: 1800,
                  heightMm: 40
                }
              }
            }
          ]
        }
      }
    };
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, executedRenderManifest);

    expect(deliveryPackage.conditionOverlayCoverage.entries).toContainEqual(expect.objectContaining({
      conditionId: "white-panel-weathering",
      overlayStatus: "ready",
      disclosure: {
        title: "wear: low severity",
        conditionId: "white-panel-weathering",
        type: "wear",
        severity: "low",
        verification: "verified",
        hostElementId: "cladding-southwest",
        inspectionZones: ["cladding"],
        sourcePhotos: ["photos/carport-detail-panel-closeup.jpg", "photos/carport-detail-panel.jpg"],
        sourcePhotoEvidence: [
          {
            path: "photos/carport-detail-panel-closeup.jpg",
            verified: true,
            materialCategories: ["wood"]
          },
          {
            path: "photos/carport-detail-panel.jpg",
            verified: true,
            materialCategories: ["wood"]
          }
        ],
        materialSurface: "cladding",
        surfacePlacement: {
          hostElementId: "cladding-southwest",
          face: "front",
          u: 0.5,
          v: 0.52,
          widthMm: 1800,
          heightMm: 40,
          rotationDeg: 0
        }
      }
    }));
    expect(deliveryPackage.sourceTraceIndex.entries).toContainEqual(expect.objectContaining({
      sourceId: "white-panel-weathering",
      sourceType: "condition",
      sourceCoverage: "conditionOverlayCoverage",
      evidencePaths: ["photos/carport-detail-panel-closeup.jpg", "photos/carport-detail-panel.jpg"]
    }));
  });

  it("blocks customer condition disclosure when a visible defect marker is too small for severity", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const captureWithTinyScratchMarker = DigitalViewingCaptureSchema.parse({
      ...capture,
      conditions: capture.conditions.map((condition) =>
        condition.id === "front-left-scratch"
          ? {
              ...condition,
              hostElementId: "body",
              surfacePlacement: {
                hostElementId: "body",
                face: "front",
                u: 0.32,
                v: 0.42,
                widthMm: 40,
                heightMm: 5,
                rotationDeg: -8
              }
            }
          : condition
      )
    });
    const renderManifest = buildDigitalViewingRenderManifest(captureWithTinyScratchMarker, {
      presetId: "studio-front-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 2560, height: 1440 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 1 },
      outputPath: "renders/vehicle-front.png"
    });
    const executedRenderManifest = {
      ...renderManifest,
      blenderExecution: {
        conditionApplication: {
          applied: [
            {
              conditionId: "front-left-scratch",
              hostElementId: "body",
              face: "front",
              surfacePlacement: {
                hostElementId: "body",
                face: "front",
                u: 0.32,
                v: 0.42,
                widthMm: 40,
                heightMm: 5,
                rotationDeg: -8
              },
              visibilityProof: {
                sourceOfTruth: "created-visible-blender-overlay-object",
                objectName: "condition-front-left-scratch",
                materialName: "condition-scratch",
                visibleInRender: true,
                dimensionsMm: {
                  widthMm: 40,
                  heightMm: 5
                }
              }
            }
          ]
        }
      }
    };
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(captureWithTinyScratchMarker, executedRenderManifest, ["material-condition-report"]);

    expect(deliveryPackage.conditionOverlayCoverage.entries).toContainEqual(expect.objectContaining({
      conditionId: "front-left-scratch",
      severity: "medium",
      overlayStatus: "insufficient-visibility",
      disclosureProfile: {
        profileId: "medium-condition-disclosure",
        minAreaMm2: 10000,
        minLongestDimensionMm: 250
      },
      disclosureProfileIssues: [
        "overlay area 200mm2 below medium-condition-disclosure minimum 10000mm2",
        "overlay longest dimension 40mm below medium-condition-disclosure minimum 250mm"
      ],
      disclosure: undefined
    }));
    expect(deliveryPackage.conditionOverlayCoverage.overlayBlockedCount).toBeGreaterThan(0);
    expect(deliveryPackage.qualityGates.blocking).toContainEqual({
      id: "material-condition-report:condition-overlays",
      code: "condition_overlays_not_ready",
      message: "Delivery packages require every buyer-visible condition item to be ready as a rendered overlay before condition disclosure."
    });
  });

  it("reports texture evidence details for complete PBR material definitions", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "studio-front-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1920, height: 1080 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 1 },
      outputPath: "renders/vehicle-front.png"
    });
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, renderManifest);

    expect(deliveryPackage.pbrMaterialCompletenessCoverage.entries).toContainEqual(expect.objectContaining({
      materialId: "body-paint",
      completenessStatus: "complete",
      textureEvidence: [
        {
          type: "baseColor",
          path: "textures/body-paint-basecolor.png",
          provenance: "photo_observed",
          confidence: "medium",
          colorSpace: "sRGB",
          scaleMm: 1200,
          pixelWidth: 4096,
          pixelHeight: 4096,
          sourcePhoto: "photos/left.jpg"
        },
        {
          type: "normal",
          path: "textures/body-paint-normal.png",
          provenance: "photo_observed",
          confidence: "medium",
          colorSpace: "Non-Color",
          scaleMm: 1200,
          pixelWidth: 4096,
          pixelHeight: 4096,
          sourcePhoto: "photos/left.jpg"
        },
        {
          type: "roughness",
          path: "textures/body-paint-roughness.png",
          provenance: "photo_observed",
          confidence: "medium",
          colorSpace: "Non-Color",
          scaleMm: 1200,
          pixelWidth: 4096,
          pixelHeight: 4096,
          sourcePhoto: "photos/right.jpg"
        }
      ]
    }));
  });

  it("reports material calibration that is not ready for customer material fidelity", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const uncalibratedManifest = DigitalViewingRenderManifestSchema.parse({
      ...renderManifest,
      materials: renderManifest.materials.map((material) =>
        material.materialId === "painted-white-wood-panel"
          ? { ...material, appearanceCalibration: undefined }
          : material
      )
    });
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, uncalibratedManifest, ["photoreal-render", "material-condition-report"]);

    expect(deliveryPackage.materialCalibrationCoverage).toMatchObject({
      calibrationCandidateCount: 2,
      calibrationReadyCount: 1,
      calibrationBlockedCount: 1
    });
    expect(deliveryPackage.materialCalibrationCoverage.entries).toContainEqual(expect.objectContaining({
      materialId: "painted-white-wood-panel",
      calibrationStatus: "missing"
    }));
    expect(deliveryPackage.qualityGates.ready).toBe(false);
    expect(deliveryPackage.qualityGates.blocking).toContainEqual({
      id: "render-manifest:material-calibration",
      code: "material_calibration_not_ready",
      message: "Delivery packages require every photo-observed material to have verified appearance calibration before customer material-fidelity delivery."
    });
    expect(deliveryPackage.customerReadinessSummary.nextActions).toContain(
      "Resolve material-calibration: 1/2 photo-observed material calibrations verified for customer material fidelity."
    );
  });

  it("reports lighting and color references for ready material calibration entries", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "studio-front-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1920, height: 1080 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 1 },
      outputPath: "renders/vehicle-front.png"
    });
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, renderManifest);

    expect(deliveryPackage.materialCalibrationCoverage.entries).toContainEqual(expect.objectContaining({
      materialId: "body-paint",
      calibrationStatus: "ready",
      sourcePhoto: "photos/left.jpg",
      lightingReference: "daylight",
      colorReference: "known-white-reference",
      whiteBalanceKelvin: 5600,
      exposureEv: 0
    }));
  });

  it("reports unverified photo evidence in delivery packages", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "studio-front-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1920, height: 1080 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 1 },
      outputPath: "renders/vehicle-front.png"
    });
    const captureWithUnverifiedPhoto = DigitalViewingCaptureSchema.parse({
      ...capture,
      photos: capture.photos.map((photo) =>
        photo.path === "photos/front.jpg" ? { ...photo, verified: false } : photo
      )
    });
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(captureWithUnverifiedPhoto, renderManifest);

    expect(deliveryPackage.photoEvidenceCoverage.missingEvidenceCount).toBeGreaterThan(0);
    expect(deliveryPackage.photoEvidenceCoverage.entries).toContainEqual(expect.objectContaining({
      usage: "material-source",
      targetId: "window-glass",
      path: "photos/front.jpg",
      verified: false
    }));
    expect(deliveryPackage.qualityGates.ready).toBe(false);
    expect(deliveryPackage.qualityGates.blocking).toContainEqual({
      id: "render-manifest:photo-evidence",
      code: "photo_evidence_not_ready",
      message: "Delivery packages require every referenced photo evidence item to resolve to a verified capture photo."
    });
    expect(deliveryPackage.customerReadinessSummary.nextActions).toContain(
      `Resolve photo-evidence: ${deliveryPackage.photoEvidenceCoverage.evidenceCount - deliveryPackage.photoEvidenceCoverage.missingEvidenceCount}/${deliveryPackage.photoEvidenceCoverage.evidenceCount} referenced photo evidence items verified for customer trust.`
    );
  });

  it("reports missing domain-required inspection zones in delivery packages", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "studio-front-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1920, height: 1080 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 1 },
      outputPath: "renders/vehicle-front.png"
    });
    const manifestWithMissingInspectionRequirement = {
      ...renderManifest,
      capturePreset: {
        ...renderManifest.capturePreset,
        requiredInspectionZones: [...renderManifest.capturePreset.requiredInspectionZones, "underbody"]
      }
    };
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, manifestWithMissingInspectionRequirement, ["photoreal-render", "material-condition-report"]);

    expect(deliveryPackage.conditionInspectionCoverage).toEqual({
      sourceOfTruth: "derived-from-domain-capture-preset-and-condition-inspection-evidence",
      requiredZoneCount: 5,
      verifiedZoneCount: 4,
      missingZoneCount: 1,
      defectFoundZoneCount: 1,
      entries: [
        {
          zone: "body",
          required: true,
          status: "verified",
          inspectionStatus: "defect-found",
          conditionIds: ["front-left-scratch"],
          sourcePhotos: ["photos/detail-scratch.jpg"],
          sourcePhotoEvidence: [
            {
              path: "photos/detail-scratch.jpg",
              sector: "detail",
              role: "condition",
              verified: true,
              materialCategories: []
            }
          ]
        },
        {
          zone: "glass",
          required: true,
          status: "verified",
          inspectionStatus: "clear",
          conditionIds: [],
          sourcePhotos: ["photos/front.jpg", "photos/right.jpg"],
          sourcePhotoEvidence: [
            {
              path: "photos/front.jpg",
              sector: "front",
              role: "geometry_alignment",
              verified: true,
              materialCategories: []
            },
            {
              path: "photos/right.jpg",
              sector: "right",
              role: "material",
              verified: true,
              materialCategories: []
            }
          ]
        },
        {
          zone: "interior",
          required: true,
          status: "verified",
          inspectionStatus: "clear",
          conditionIds: [],
          sourcePhotos: ["photos/interior.jpg"],
          sourcePhotoEvidence: [
            {
              path: "photos/interior.jpg",
              sector: "interior",
              role: "material",
              verified: true,
              materialCategories: []
            }
          ]
        },
        {
          zone: "underbody",
          required: true,
          status: "missing",
          inspectionStatus: "missing",
          conditionIds: [],
          sourcePhotos: [],
          sourcePhotoEvidence: []
        },
        {
          zone: "wheels-tires",
          required: true,
          status: "verified",
          inspectionStatus: "clear",
          conditionIds: [],
          sourcePhotos: ["photos/left.jpg", "photos/right.jpg"],
          sourcePhotoEvidence: [
            {
              path: "photos/left.jpg",
              sector: "left",
              role: "material",
              verified: true,
              materialCategories: []
            },
            {
              path: "photos/right.jpg",
              sector: "right",
              role: "material",
              verified: true,
              materialCategories: []
            }
          ]
        }
      ]
    });
    expect(deliveryPackage.viewerLayerCoverage.entries).toContainEqual({
      layer: "condition-disclosure",
      required: true,
      status: "blocked",
      sourceIds: ["front-left-scratch"],
      evidence: "4/5 required inspection zones verified"
    });
    expect(deliveryPackage.qualityGates.ready).toBe(false);
    expect(deliveryPackage.qualityGates.blocking).toContainEqual({
      id: "material-condition-report:inspection-zones",
      code: "condition_inspection_zones_not_ready",
      message: "Delivery packages require every domain-required inspection zone to be verified before customer condition disclosure."
    });
    expect(deliveryPackage.customerReadinessSummary.nextActions).toContain(
      "Resolve inspection-zones: 4/5 domain-required inspection zones verified before customer condition disclosure."
    );
  });

  it("reports condition overlays that are not ready for customer disclosure", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, renderManifest, ["material-condition-report"]);

    expect(deliveryPackage.conditionOverlayCoverage).toMatchObject({
      overlayCandidateCount: 1,
      overlayReadyCount: 0,
      overlayBlockedCount: 1
    });
    expect(deliveryPackage.conditionOverlayCoverage.entries).toContainEqual(expect.objectContaining({
      conditionId: "white-panel-weathering",
      overlayStatus: "missing-render"
    }));
    expect(deliveryPackage.qualityGates.ready).toBe(false);
    expect(deliveryPackage.qualityGates.blocking).toContainEqual({
      id: "material-condition-report:condition-overlays",
      code: "condition_overlays_not_ready",
      message: "Delivery packages require every buyer-visible condition item to be ready as a rendered overlay before condition disclosure."
    });
  });

  it("blocks delivery package manifests when render and capture hashes do not match", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const mismatched = {
      ...renderManifest,
      hashes: {
        ...renderManifest.hashes,
        captureHash: "0".repeat(64)
      }
    };
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, mismatched);

    expect(deliveryPackage.qualityGates.ready).toBe(false);
    expect(deliveryPackage.qualityGates.blocking).toContainEqual({
      id: "capture",
      code: "capture_hash_mismatch",
      message: "Render manifest capture hash does not match the provided capture."
    });
  });

  it("blocks delivery package manifests when the render capture preset does not match the capture domain", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderManifest = buildDigitalViewingRenderManifest(capture, {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    });
    const mismatched = {
      ...renderManifest,
      capturePreset: {
        ...renderManifest.capturePreset,
        presetId: "vehicle-premium-sales",
        assetType: "vehicle" as const,
        requiredMeasurements: ["overall-length", "overall-width", "overall-height", "wheelbase"],
        requiredMaterialCategories: ["paint", "leather"]
      }
    };
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(capture, mismatched);

    expect(deliveryPackage.qualityGates.ready).toBe(false);
    expect(deliveryPackage.qualityGates.blocking).toContainEqual({
      id: "render-manifest:capture-preset",
      code: "capture_preset_mismatch",
      message: "Render manifest capture preset does not match the provided capture asset type and delivery tier."
    });
  });

  it("keeps geometry hash stable when only material evidence changes", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const preset = {
      presetId: "studio-front-preview",
      renderer: "cycles",
      resolution: { width: 1920, height: 1080 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 1 },
      outputPath: "renders/vehicle-front.png"
    };
    const changedMaterialCapture = {
      ...capture,
      materials: capture.materials.map((material) =>
        material.materialId === "body-paint" ? { ...material, roughness: 0.44 } : material
      )
    };

    const original = buildDigitalViewingRenderManifest(capture, preset);
    const changed = buildDigitalViewingRenderManifest(changedMaterialCapture, preset);

    expect(changed.hashes.geometryHash).toBe(original.hashes.geometryHash);
    expect(changed.hashes.materialConditionHash).not.toBe(original.hashes.materialConditionHash);
    expect(changed.hashes.manifestHash).not.toBe(original.hashes.manifestHash);
  });

  it("keeps geometry hash stable when only the renderable host registry changes", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const preset = {
      presetId: "studio-front-preview",
      renderer: "cycles",
      resolution: { width: 1920, height: 1080 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 1 },
      outputPath: "renders/vehicle-front.png"
    };
    const changedRegistryCapture = {
      ...capture,
      modelElements: capture.modelElements.map((element) =>
        element.id === "front-seat" ? { ...element, confidence: "high" as const } : element
      )
    };

    const original = buildDigitalViewingRenderManifest(capture, preset);
    const changed = buildDigitalViewingRenderManifest(changedRegistryCapture, preset);

    expect(changed.hashes.geometryHash).toBe(original.hashes.geometryHash);
    expect(changed.hashes.materialConditionHash).not.toBe(original.hashes.materialConditionHash);
    expect(changed.hashes.manifestHash).not.toBe(original.hashes.manifestHash);
  });

  it("keeps geometry hash stable when only appearance calibration changes", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const preset = {
      presetId: "studio-front-preview",
      renderer: "cycles",
      resolution: { width: 1920, height: 1080 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 1 },
      outputPath: "renders/vehicle-front.png"
    };
    const changedAppearanceCapture = {
      ...capture,
      materials: capture.materials.map((material) =>
        material.materialId === "body-paint"
          ? { ...material, appearanceCalibration: { ...material.appearanceCalibration, confidence: "high" as const } }
          : material
      )
    };

    const original = buildDigitalViewingRenderManifest(capture, preset);
    const changed = buildDigitalViewingRenderManifest(changedAppearanceCapture, preset);

    expect(changed.hashes.geometryHash).toBe(original.hashes.geometryHash);
    expect(changed.hashes.materialConditionHash).not.toBe(original.hashes.materialConditionHash);
    expect(changed.hashes.manifestHash).not.toBe(original.hashes.manifestHash);
  });

  it("fills missing PBR fields from domain material presets without changing explicit values", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const presetOnlyCapture = {
      ...capture,
      materials: capture.materials.map((material) =>
        material.materialId === "body-paint"
          ? {
              ...material,
              baseColor: undefined,
              roughness: undefined,
              metallic: undefined,
              specular: undefined,
              transmission: undefined,
              normalSource: "unknown" as const,
              textureScaleMm: undefined
            }
          : material
      )
    };

    const manifest = buildDigitalViewingRenderManifest(presetOnlyCapture, {
      presetId: "studio-front-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1920, height: 1080 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 1 },
      outputPath: "renders/vehicle-front.png"
    });

    expect(manifest.materials[0]?.pbr).toEqual({
      baseColor: "#f7f7f2",
      roughness: 0.34,
      metallic: 0,
      specular: 0.62,
      transmission: 0,
      normalSource: "photo",
      textureScaleMm: 1200
    });
  });

  it("allows missing texture maps for draft previews but blocks them for premium sales", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const withoutTextureMaps = {
      ...capture,
      materials: capture.materials.map((material) => ({ ...material, textureMaps: [] }))
    };

    const draft = evaluateDigitalViewingDeliveryReadiness(withoutTextureMaps, "draft-preview");
    const premium = evaluateDigitalViewingDeliveryReadiness(withoutTextureMaps, "premium-sales");

    expect(draft.ok).toBe(true);
    expect(draft.warnings).toContainEqual({
      id: "body-paint",
      code: "texture_evidence_missing",
      message: "Draft preview can render without texture maps, but missing texture evidence must remain visible in review."
    });
    expect(premium.ok).toBe(false);
    expect(premium.blocking).toContainEqual({
      id: "body-paint",
      code: "texture_evidence_missing",
      message: "Material has no texture-map evidence."
    });
  });

  it("blocks premium sales delivery when material surface mapping is missing", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const missingMapping = {
      ...capture,
      materials: capture.materials.map((material) =>
        material.materialId === "body-paint" ? { ...material, surfaceMapping: undefined } : material
      )
    };

    const readiness = evaluateDigitalViewingDeliveryReadiness(missingMapping, "premium-sales");

    expect(readiness.ok).toBe(false);
    expect(readiness.blocking).toContainEqual({
      id: "body-paint",
      code: "material_surface_mapping_missing",
      message: "Premium materials must declare surface mapping so texture placement is reproducible in Blender."
    });
    expect(() => buildDigitalViewingRenderManifest(missingMapping, {
      presetId: "studio-front-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1920, height: 1080 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 1 },
      outputPath: "renders/vehicle-front.png"
    })).toThrow("Cannot build render manifest for invalid capture: material_surface_mapping_missing");
  });

  it("blocks premium sales delivery when material surface mapping uses invalid photo evidence", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const invalidMapping = {
      ...capture,
      materials: capture.materials.map((material) =>
        material.materialId === "body-paint"
          ? { ...material, surfaceMapping: { ...material.surfaceMapping, sourcePhoto: "photos/detail-scratch.jpg" } }
          : material
      )
    };

    const readiness = evaluateDigitalViewingDeliveryReadiness(invalidMapping, "premium-sales");
    const plan = buildDigitalViewingMaterialAuthoringPlan(invalidMapping, "premium-sales");

    expect(readiness.ok).toBe(false);
    expect(readiness.blocking).toContainEqual({
      id: "body-paint:surface-mapping",
      code: "material_surface_mapping_source_photo_invalid",
      message: "Premium material surface mapping must reference a verified, unoccluded photo suitable for material placement."
    });
    expect(plan.summary.ready).toBe(false);
    expect(plan.materials.find((material) => material.materialId === "body-paint")?.blocking).toContainEqual({
      id: "body-paint:surface-mapping",
      code: "material_surface_mapping_source_photo_invalid",
      message: "Premium material surface mapping must reference a verified, unoccluded photo suitable for material placement."
    });
    expect(() => buildDigitalViewingRenderManifest(invalidMapping, {
      presetId: "studio-front-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1920, height: 1080 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 1 },
      outputPath: "renders/vehicle-front.png"
    })).toThrow("Cannot build render manifest for invalid capture: material_surface_mapping_source_photo_invalid");
  });

  it("blocks premium sales delivery when material surface mapping source photo is from an unmapped exterior sector", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const wrongMappingSector = {
      ...capture,
      materials: capture.materials.map((material) =>
        material.materialId === "body-paint" && material.surfaceMapping
          ? {
              ...material,
              surfaceMapping: {
                ...material.surfaceMapping,
                faces: ["left", "right"] as const,
                sourcePhoto: "photos/rear.jpg"
              }
            }
          : material
      ),
      conditions: capture.conditions.map((condition) =>
        condition.id === "front-left-scratch" && condition.surfacePlacement
          ? {
              ...condition,
              surfacePlacement: {
                ...condition.surfacePlacement,
                face: "left" as const
              }
            }
          : condition
      )
    };

    const readiness = evaluateDigitalViewingDeliveryReadiness(wrongMappingSector, "premium-sales");
    const plan = buildDigitalViewingMaterialAuthoringPlan(wrongMappingSector, "premium-sales");

    expect(readiness.ok).toBe(false);
    expect(readiness.blocking).toContainEqual({
      id: "body-paint:surface-mapping:rear",
      code: "material_surface_mapping_source_photo_face_mismatch",
      message: "Premium exterior material surface mapping source photo sector must be one of the mapped faces."
    });
    expect(plan.summary.ready).toBe(false);
    expect(plan.materials.find((material) => material.materialId === "body-paint")?.blocking).toContainEqual({
      id: "body-paint:surface-mapping:rear",
      code: "material_surface_mapping_source_photo_face_mismatch",
      message: "Premium exterior material surface mapping source photo sector must be one of the mapped faces."
    });
    expect(() => buildDigitalViewingRenderManifest(wrongMappingSector, {
      presetId: "studio-front-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1920, height: 1080 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 1 },
      outputPath: "renders/vehicle-front.png"
    })).toThrow("Cannot build render manifest for invalid capture: material_surface_mapping_source_photo_face_mismatch");
  });

  it("blocks premium sales delivery when material surface mapping photo declares the wrong material category", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const wrongMappingCategory = {
      ...capture,
      photos: capture.photos.map((photo) =>
        photo.path === "photos/front.jpg" && photo.captureMetadata
          ? {
              ...photo,
              captureMetadata: {
                ...photo.captureMetadata,
                materialCategories: ["glass" as const]
              }
            }
          : photo
      ),
      materials: capture.materials.map((material) =>
        material.materialId === "body-paint" && material.surfaceMapping
          ? {
              ...material,
              surfaceMapping: {
                ...material.surfaceMapping,
                sourcePhoto: "photos/front.jpg"
              }
            }
          : material
      )
    };

    const readiness = evaluateDigitalViewingDeliveryReadiness(wrongMappingCategory, "premium-sales");
    const plan = buildDigitalViewingMaterialAuthoringPlan(wrongMappingCategory, "premium-sales");

    expect(readiness.ok).toBe(false);
    expect(readiness.blocking).toContainEqual({
      id: "body-paint:surface-mapping",
      code: "material_surface_mapping_source_photo_invalid",
      message: "Premium material surface mapping must reference a verified, unoccluded photo suitable for material placement."
    });
    expect(plan.summary.ready).toBe(false);
    expect(plan.materials.find((material) => material.materialId === "body-paint")?.blocking).toContainEqual({
      id: "body-paint:surface-mapping",
      code: "material_surface_mapping_source_photo_invalid",
      message: "Premium material surface mapping must reference a verified, unoccluded photo suitable for material placement."
    });
    expect(() => buildDigitalViewingRenderManifest(wrongMappingCategory, {
      presetId: "studio-front-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1920, height: 1080 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 1 },
      outputPath: "renders/vehicle-front.png"
    })).toThrow("Cannot build render manifest for invalid capture: material_surface_mapping_source_photo_invalid");
  });

  it("blocks premium sales delivery when photo-observed material appearance is not calibrated", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const uncalibrated = {
      ...capture,
      materials: capture.materials.map((material) =>
        material.materialId === "body-paint" ? { ...material, appearanceCalibration: undefined } : material
      )
    };

    const readiness = evaluateDigitalViewingDeliveryReadiness(uncalibrated, "premium-sales");
    const plan = buildDigitalViewingMaterialAuthoringPlan(uncalibrated, "premium-sales");

    expect(readiness.ok).toBe(false);
    expect(readiness.blocking).toContainEqual({
      id: "body-paint",
      code: "material_appearance_calibration_missing",
      message: "Premium photo-observed materials must declare appearance calibration so color and finish are reproducible."
    });
    expect(plan.summary.ready).toBe(false);
    expect(plan.materials.find((material) => material.materialId === "body-paint")?.blocking).toContainEqual({
      id: "body-paint",
      code: "material_appearance_calibration_missing",
      message: "Premium material authoring requires appearance calibration for photo-observed color and finish."
    });
    expect(() => buildDigitalViewingRenderManifest(uncalibrated, {
      presetId: "studio-front-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1920, height: 1080 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 1 },
      outputPath: "renders/vehicle-front.png"
    })).toThrow("Cannot build render manifest for invalid capture: material_appearance_calibration_missing");
  });

  it("blocks premium sales delivery when appearance calibration uses invalid photo evidence", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const invalidCalibration = {
      ...capture,
      materials: capture.materials.map((material) =>
        material.materialId === "body-paint"
          ? { ...material, appearanceCalibration: { ...material.appearanceCalibration, sourcePhoto: "photos/detail-scratch.jpg" } }
          : material
      )
    };

    const readiness = evaluateDigitalViewingDeliveryReadiness(invalidCalibration, "premium-sales");
    const plan = buildDigitalViewingMaterialAuthoringPlan(invalidCalibration, "premium-sales");

    expect(readiness.ok).toBe(false);
    expect(readiness.blocking).toContainEqual({
      id: "body-paint:appearance-calibration",
      code: "material_appearance_calibration_source_photo_invalid",
      message: "Premium appearance calibration must reference a verified, unoccluded photo suitable for color and finish calibration."
    });
    expect(plan.summary.ready).toBe(false);
    expect(plan.materials.find((material) => material.materialId === "body-paint")?.blocking).toContainEqual({
      id: "body-paint:appearance-calibration",
      code: "material_appearance_calibration_source_photo_invalid",
      message: "Premium appearance calibration must reference a verified, unoccluded photo suitable for color and finish calibration."
    });
    expect(() => buildDigitalViewingRenderManifest(invalidCalibration, {
      presetId: "studio-front-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1920, height: 1080 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 1 },
      outputPath: "renders/vehicle-front.png"
    })).toThrow("Cannot build render manifest for invalid capture: material_appearance_calibration_source_photo_invalid");
  });

  it("blocks premium sales delivery when appearance calibration source photo is from an unmapped exterior sector", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const wrongCalibrationSector = {
      ...capture,
      materials: capture.materials.map((material) =>
        material.materialId === "body-paint" && material.surfaceMapping
          ? {
              ...material,
              surfaceMapping: {
                ...material.surfaceMapping,
                faces: ["left", "right"] as const
              },
              appearanceCalibration: {
                ...material.appearanceCalibration,
                sourcePhoto: "photos/rear.jpg"
              }
            }
          : material
      ),
      conditions: capture.conditions.map((condition) =>
        condition.id === "front-left-scratch" && condition.surfacePlacement
          ? {
              ...condition,
              surfacePlacement: {
                ...condition.surfacePlacement,
                face: "left" as const
              }
            }
          : condition
      )
    };

    const readiness = evaluateDigitalViewingDeliveryReadiness(wrongCalibrationSector, "premium-sales");
    const plan = buildDigitalViewingMaterialAuthoringPlan(wrongCalibrationSector, "premium-sales");

    expect(readiness.ok).toBe(false);
    expect(readiness.blocking).toContainEqual({
      id: "body-paint:appearance-calibration:rear",
      code: "material_appearance_calibration_source_photo_face_mismatch",
      message: "Premium exterior appearance calibration source photo sector must be one of the mapped material faces."
    });
    expect(plan.summary.ready).toBe(false);
    expect(plan.materials.find((material) => material.materialId === "body-paint")?.blocking).toContainEqual({
      id: "body-paint:appearance-calibration:rear",
      code: "material_appearance_calibration_source_photo_face_mismatch",
      message: "Premium exterior appearance calibration source photo sector must be one of the mapped material faces."
    });
    expect(() => buildDigitalViewingRenderManifest(wrongCalibrationSector, {
      presetId: "studio-front-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1920, height: 1080 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 1 },
      outputPath: "renders/vehicle-front.png"
    })).toThrow("Cannot build render manifest for invalid capture: material_appearance_calibration_source_photo_face_mismatch");
  });

  it("blocks premium sales delivery when appearance calibration photo lacks lighting and color reference metadata", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const missingCalibrationMetadata = {
      ...capture,
      photos: capture.photos.map((photo) =>
        photo.path === "photos/left.jpg"
          ? {
              ...photo,
              captureMetadata: {
                ...photo.captureMetadata,
                lightingReference: undefined,
                colorReference: undefined
              }
            }
          : photo
      )
    };

    const readiness = evaluateDigitalViewingDeliveryReadiness(missingCalibrationMetadata, "premium-sales");
    const plan = buildDigitalViewingMaterialAuthoringPlan(missingCalibrationMetadata, "premium-sales");

    expect(readiness.ok).toBe(false);
    expect(readiness.blocking).toContainEqual({
      id: "body-paint:appearance-calibration",
      code: "material_appearance_calibration_photo_metadata_missing",
      message: "Premium appearance calibration photos must include lighting and color reference metadata for reproducible material rendering."
    });
    expect(plan.summary.ready).toBe(false);
    expect(plan.materials.find((material) => material.materialId === "body-paint")?.blocking).toContainEqual({
      id: "body-paint:appearance-calibration",
      code: "material_appearance_calibration_photo_metadata_missing",
      message: "Premium appearance calibration photos must include lighting and color reference metadata for reproducible material rendering."
    });
    expect(() => buildDigitalViewingRenderManifest(missingCalibrationMetadata, {
      presetId: "studio-front-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1920, height: 1080 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 1 },
      outputPath: "renders/vehicle-front.png"
    })).toThrow("Cannot build render manifest for invalid capture: material_appearance_calibration_photo_metadata_missing");
  });

  it("blocks premium sales delivery when appearance calibration photo lacks white balance and exposure metadata", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const missingNormalizationMetadata = {
      ...capture,
      photos: capture.photos.map((photo) => {
        if (photo.path !== "photos/left.jpg" || !photo.captureMetadata) {
          return photo;
        }
        const captureMetadata = { ...photo.captureMetadata };
        delete captureMetadata.whiteBalanceKelvin;
        delete captureMetadata.exposureEv;
        return { ...photo, captureMetadata };
      })
    };

    const readiness = evaluateDigitalViewingDeliveryReadiness(missingNormalizationMetadata, "premium-sales");
    const plan = buildDigitalViewingMaterialAuthoringPlan(missingNormalizationMetadata, "premium-sales");

    expect(readiness.ok).toBe(false);
    expect(readiness.blocking).toContainEqual({
      id: "body-paint:appearance-calibration",
      code: "material_appearance_calibration_photo_normalization_missing",
      message: "Premium appearance calibration photos must include white balance and exposure metadata so material color can be reproduced in Blender."
    });
    expect(plan.summary.ready).toBe(false);
    expect(plan.materials.find((material) => material.materialId === "body-paint")?.blocking).toContainEqual({
      id: "body-paint:appearance-calibration",
      code: "material_appearance_calibration_photo_normalization_missing",
      message: "Premium appearance calibration photos must include white balance and exposure metadata so material color can be reproduced in Blender."
    });
    expect(() => buildDigitalViewingRenderManifest(missingNormalizationMetadata, {
      presetId: "studio-front-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1920, height: 1080 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 1 },
      outputPath: "renders/vehicle-front.png"
    })).toThrow("Cannot build render manifest for invalid capture: material_appearance_calibration_photo_normalization_missing");
  });

  it("blocks premium sales delivery when appearance calibration method conflicts with the photo color reference", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const incompatibleCalibration = {
      ...capture,
      materials: capture.materials.map((material) =>
        material.materialId === "body-paint"
          ? {
              ...material,
              appearanceCalibration: {
                ...material.appearanceCalibration,
                method: "color-chart" as const
              }
            }
          : material
      )
    };

    const readiness = evaluateDigitalViewingDeliveryReadiness(incompatibleCalibration, "premium-sales");
    const plan = buildDigitalViewingMaterialAuthoringPlan(incompatibleCalibration, "premium-sales");

    expect(readiness.ok).toBe(false);
    expect(readiness.blocking).toContainEqual({
      id: "body-paint:appearance-calibration",
      code: "material_appearance_calibration_reference_incompatible",
      message: "Premium appearance calibration method must match the color reference captured in the source photo."
    });
    expect(plan.summary.ready).toBe(false);
    expect(plan.materials.find((material) => material.materialId === "body-paint")?.blocking).toContainEqual({
      id: "body-paint:appearance-calibration",
      code: "material_appearance_calibration_reference_incompatible",
      message: "Premium appearance calibration method must match the color reference captured in the source photo."
    });
    expect(() => buildDigitalViewingRenderManifest(incompatibleCalibration, {
      presetId: "studio-front-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1920, height: 1080 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 1 },
      outputPath: "renders/vehicle-front.png"
    })).toThrow("Cannot build render manifest for invalid capture: material_appearance_calibration_reference_incompatible");
  });

  it("blocks premium sales delivery when appearance calibration photo declares the wrong material category", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const wrongMaterialCategory = {
      ...capture,
      photos: capture.photos.map((photo) =>
        photo.path === "photos/left.jpg" && photo.captureMetadata
          ? {
              ...photo,
              captureMetadata: {
                ...photo.captureMetadata,
                materialCategories: ["glass" as const]
              }
            }
          : photo
      )
    };

    const readiness = evaluateDigitalViewingDeliveryReadiness(wrongMaterialCategory, "premium-sales");
    const plan = buildDigitalViewingMaterialAuthoringPlan(wrongMaterialCategory, "premium-sales");

    expect(readiness.ok).toBe(false);
    expect(readiness.blocking).toContainEqual({
      id: "body-paint:appearance-calibration",
      code: "material_appearance_calibration_material_category_mismatch",
      message: "Premium appearance calibration photos must explicitly match the material category they calibrate."
    });
    expect(plan.summary.ready).toBe(false);
    expect(plan.materials.find((material) => material.materialId === "body-paint")?.blocking).toContainEqual({
      id: "body-paint:appearance-calibration",
      code: "material_appearance_calibration_material_category_mismatch",
      message: "Premium appearance calibration photos must explicitly match the material category they calibrate."
    });
    expect(() => buildDigitalViewingRenderManifest(wrongMaterialCategory, {
      presetId: "studio-front-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1920, height: 1080 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 1 },
      outputPath: "renders/vehicle-front.png"
    })).toThrow("Cannot build render manifest for invalid capture: material_appearance_calibration_material_category_mismatch");
  });

  it("blocks premium sales delivery when material source photos declare the wrong material category", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const wrongMaterialSourceCategory = {
      ...capture,
      photos: capture.photos.map((photo) =>
        photo.path === "photos/front.jpg" && photo.captureMetadata
          ? {
              ...photo,
              captureMetadata: {
                ...photo.captureMetadata,
                materialCategories: ["glass" as const]
              }
            }
          : photo
      ),
      materials: capture.materials.map((material) =>
        material.materialId === "body-paint"
          ? { ...material, photoSources: ["photos/front.jpg"] }
          : material
      )
    };

    const readiness = evaluateDigitalViewingDeliveryReadiness(wrongMaterialSourceCategory, "premium-sales");

    expect(readiness.ok).toBe(false);
    expect(readiness.blocking).toContainEqual({
      id: "body-paint:photo-sources",
      code: "material_source_photo_material_category_mismatch",
      message: "Premium material source photos must match the material category when photo categories are declared."
    });
    expect(() => buildDigitalViewingRenderManifest(wrongMaterialSourceCategory, {
      presetId: "studio-front-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1920, height: 1080 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 1 },
      outputPath: "renders/vehicle-front.png"
    })).toThrow("Cannot build render manifest for invalid capture: material_source_photo_material_category_mismatch");
  });

  it("blocks premium sales delivery when appearance calibration does not declare illuminant", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const missingIlluminant = {
      ...capture,
      materials: capture.materials.map((material) =>
        material.materialId === "body-paint"
          ? {
              ...material,
              appearanceCalibration: {
                ...material.appearanceCalibration,
                illuminant: undefined
              }
            }
          : material
      )
    };

    const readiness = evaluateDigitalViewingDeliveryReadiness(missingIlluminant, "premium-sales");
    const plan = buildDigitalViewingMaterialAuthoringPlan(missingIlluminant, "premium-sales");

    expect(readiness.ok).toBe(false);
    expect(readiness.blocking).toContainEqual({
      id: "body-paint:appearance-calibration",
      code: "material_appearance_calibration_illuminant_missing",
      message: "Premium appearance calibration must declare illuminant so Blender material color and finish are reproducible."
    });
    expect(plan.summary.ready).toBe(false);
    expect(plan.materials.find((material) => material.materialId === "body-paint")?.blocking).toContainEqual({
      id: "body-paint:appearance-calibration",
      code: "material_appearance_calibration_illuminant_missing",
      message: "Premium appearance calibration must declare illuminant so Blender material color and finish are reproducible."
    });
    expect(() => buildDigitalViewingRenderManifest(missingIlluminant, {
      presetId: "studio-front-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1920, height: 1080 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 1 },
      outputPath: "renders/vehicle-front.png"
    })).toThrow("Cannot build render manifest for invalid capture: material_appearance_calibration_illuminant_missing");
  });

  it("blocks premium sales delivery when verified condition evidence lacks placement", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const result = evaluateDigitalViewingDeliveryReadiness({
      ...capture,
      conditions: capture.conditions.map((condition) => ({ ...condition, surfacePlacement: undefined }))
    }, "premium-sales");

    expect(result.ok).toBe(false);
    expect(result.blocking).toContainEqual({
      id: "front-left-scratch",
      code: "condition_placement_missing",
      message: "Verified condition evidence should include surface placement so visible defects can be rendered and reviewed."
    });
  });

  it("requires premium condition evidence to bind defects to declared material surfaces", () => {
    const source = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const capture = DigitalViewingCaptureSchema.parse({
      ...source,
      conditions: source.conditions.map((condition) => ({
        ...condition,
        materialSurface: "body-panels"
      }))
    });
    const missingSurfaceBinding = evaluateDigitalViewingDeliveryReadiness({
      ...capture,
      conditions: capture.conditions.map((condition) => ({ ...condition, materialSurface: undefined }))
    }, "premium-sales");
    const unknownSurfaceBinding = evaluateDigitalViewingDeliveryReadiness({
      ...capture,
      conditions: capture.conditions.map((condition) => ({ ...condition, materialSurface: "roof-panel" }))
    }, "premium-sales");

    expect(evaluateDigitalViewingDeliveryReadiness(capture, "premium-sales").ok).toBe(true);
    expect(missingSurfaceBinding.blocking).toContainEqual({
      id: "front-left-scratch",
      code: "condition_material_surface_missing",
      message: "Premium verified condition evidence must bind to a declared material surface so defects render on the correct finish."
    });
    expect(unknownSurfaceBinding.blocking).toContainEqual({
      id: "front-left-scratch:roof-panel",
      code: "condition_material_surface_unknown",
      message: "Premium verified condition evidence must reference a material surface declared by a source-backed material record."
    });
  });

  it("blocks premium condition evidence placed on a face outside the material surface mapping", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const unmappedConditionFace = {
      ...capture,
      materials: capture.materials.map((material) =>
        material.materialId === "body-paint" && material.surfaceMapping
          ? {
              ...material,
              surfaceMapping: {
                ...material.surfaceMapping,
                faces: material.surfaceMapping.faces.filter((face) => face !== "front")
              }
            }
          : material
      )
    };

    const result = evaluateDigitalViewingDeliveryReadiness(unmappedConditionFace, "premium-sales");

    expect(result.ok).toBe(false);
    expect(result.blocking).toContainEqual({
      id: "front-left-scratch:front",
      code: "condition_surface_face_unmapped",
      message: "Premium condition placement face must be covered by the bound material surface mapping so defects render on the correct visible side."
    });
    expect(() => buildDigitalViewingRenderManifest(unmappedConditionFace, {
      presetId: "studio-front-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1920, height: 1080 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 1 },
      outputPath: "renders/vehicle-front.png"
    })).toThrow("Cannot build render manifest for invalid capture: condition_surface_face_unmapped");
  });

  it("blocks premium condition evidence when exterior source photo sector differs from placement face", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const wrongConditionSourceSector = {
      ...capture,
      conditions: capture.conditions.map((condition) =>
        condition.id === "front-left-scratch" && condition.surfacePlacement
          ? {
              ...condition,
              photoSources: ["photos/detail-scratch.jpg", "photos/right.jpg"],
              surfacePlacement: {
                ...condition.surfacePlacement,
                face: "left" as const
              }
            }
          : condition
      )
    };

    const result = evaluateDigitalViewingDeliveryReadiness(wrongConditionSourceSector, "premium-sales");

    expect(result.ok).toBe(false);
    expect(result.blocking).toContainEqual({
      id: "front-left-scratch:right",
      code: "condition_source_photo_face_mismatch",
      message: "Premium exterior condition source photo sector must match the condition placement face."
    });
    expect(() => buildDigitalViewingRenderManifest(wrongConditionSourceSector, {
      presetId: "studio-front-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1920, height: 1080 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 1 },
      outputPath: "renders/vehicle-front.png"
    })).toThrow("Cannot build render manifest for invalid capture: condition_source_photo_face_mismatch");
  });

  it("blocks premium sales delivery when verified condition evidence lacks a verified detail photo", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const result = evaluateDigitalViewingDeliveryReadiness({
      ...capture,
      photos: capture.photos.map((photo) =>
        photo.path === "photos/detail-scratch.jpg" && photo.captureMetadata
          ? { ...photo, captureMetadata: { ...photo.captureMetadata, coverage: "material-surface" as const } }
          : photo
      )
    }, "premium-sales");

    expect(result.ok).toBe(false);
    expect(result.blocking).toContainEqual({
      id: "front-left-scratch",
      code: "condition_detail_photo_invalid",
      message: "Premium verified condition evidence must reference a verified, unoccluded macro/detail condition photo."
    });
  });

  it("blocks premium sales delivery when verified condition detail photo resolution is too low", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const result = evaluateDigitalViewingDeliveryReadiness({
      ...capture,
      photos: capture.photos.map((photo) =>
        photo.path === "photos/detail-scratch.jpg"
          ? { ...photo, pixelWidth: 640, pixelHeight: 480 }
          : photo
      )
    }, "premium-sales");

    expect(result.ok).toBe(false);
    expect(result.blocking).toContainEqual({
      id: "front-left-scratch",
      code: "condition_detail_photo_resolution_too_low",
      message: "Premium verified condition detail photos must be at least 1024 px on the shortest side so visible defects remain reviewable in customer output."
    });
  });

  it("blocks premium sales delivery when condition detail photo declares the wrong material category", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const wrongConditionDetailCategory = {
      ...capture,
      photos: capture.photos.map((photo) =>
        photo.path === "photos/detail-scratch.jpg" && photo.captureMetadata
          ? {
              ...photo,
              captureMetadata: {
                ...photo.captureMetadata,
                materialCategories: ["glass" as const]
              }
            }
          : photo
      )
    };
    const result = evaluateDigitalViewingDeliveryReadiness(wrongConditionDetailCategory, "premium-sales");

    expect(result.ok).toBe(false);
    expect(result.blocking).toContainEqual({
      id: "front-left-scratch:body-panels",
      code: "condition_detail_photo_material_category_mismatch",
      message: "Premium condition detail photos must explicitly match the material category of the defect surface."
    });
    expect(() => buildDigitalViewingRenderManifest(wrongConditionDetailCategory, {
      presetId: "studio-front-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1920, height: 1080 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 1 },
      outputPath: "renders/vehicle-front.png"
    })).toThrow("Cannot build render manifest for invalid capture: condition_detail_photo_material_category_mismatch");
  });

  it("blocks premium sales delivery when condition source photos declare the wrong material category", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const wrongConditionSourceCategory = {
      ...capture,
      photos: capture.photos.map((photo) =>
        photo.path === "photos/front.jpg" && photo.captureMetadata
          ? {
              ...photo,
              captureMetadata: {
                ...photo.captureMetadata,
                materialCategories: ["glass" as const]
              }
            }
          : photo
      ),
      conditions: capture.conditions.map((condition) =>
        condition.id === "front-left-scratch"
          ? { ...condition, photoSources: ["photos/detail-scratch.jpg", "photos/front.jpg"] }
          : condition
      )
    };

    const result = evaluateDigitalViewingDeliveryReadiness(wrongConditionSourceCategory, "premium-sales");

    expect(result.ok).toBe(false);
    expect(result.blocking).toContainEqual({
      id: "front-left-scratch:body-panels",
      code: "condition_source_photo_material_category_mismatch",
      message: "Premium condition source photos must match the material category of the defect surface when photo categories are declared."
    });
    expect(() => buildDigitalViewingRenderManifest(wrongConditionSourceCategory, {
      presetId: "studio-front-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1920, height: 1080 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 1 },
      outputPath: "renders/vehicle-front.png"
    })).toThrow("Cannot build render manifest for invalid capture: condition_source_photo_material_category_mismatch");
  });

  it("blocks premium sales delivery when medium or high severity condition detail evidence lacks capture quality metadata", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const result = evaluateDigitalViewingDeliveryReadiness({
      ...capture,
      photos: capture.photos.map((photo) => {
        if (photo.path !== "photos/detail-scratch.jpg" || !photo.captureMetadata) {
          return photo;
        }
        const captureMetadata = { ...photo.captureMetadata };
        delete captureMetadata.cameraDistanceMm;
        delete captureMetadata.lightingReference;
        delete captureMetadata.colorReference;
        delete captureMetadata.whiteBalanceKelvin;
        delete captureMetadata.exposureEv;
        return { ...photo, captureMetadata };
      }),
      conditions: capture.conditions.map((condition) =>
        condition.id === "front-left-scratch"
          ? { ...condition, severity: "high" as const }
          : condition
      )
    }, "premium-sales");

    expect(result.ok).toBe(false);
    expect(result.blocking).toContainEqual({
      id: "front-left-scratch",
      code: "condition_detail_photo_quality_missing",
      message: "Medium and high severity condition evidence must reference detail photos with scale, lighting, white balance, and exposure metadata."
    });
  });

  it("refuses to build render manifest when premium condition detail evidence is invalid", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const invalidConditionEvidence = {
      ...capture,
      photos: capture.photos.map((photo) =>
        photo.path === "photos/detail-scratch.jpg" && photo.captureMetadata
          ? { ...photo, verified: false }
          : photo
      )
    };

    expect(() => buildDigitalViewingRenderManifest(invalidConditionEvidence, {
      presetId: "studio-front-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1920, height: 1080 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 1 },
      outputPath: "renders/vehicle-front.png"
    })).toThrow("Cannot build render manifest for invalid capture: required_sector_unverified, condition_detail_photo_invalid");
  });

  it("refuses to build render manifest when premium texture source photo evidence is invalid", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const invalidTextureEvidence = {
      ...capture,
      materials: capture.materials.map((material) =>
        material.materialId === "body-paint"
          ? {
              ...material,
              textureMaps: material.textureMaps.map((textureMap) =>
                textureMap.type === "roughness"
                  ? { ...textureMap, sourcePhoto: "photos/detail-scratch.jpg" }
                  : textureMap
              )
            }
          : material
      )
    };

    expect(() => buildDigitalViewingRenderManifest(invalidTextureEvidence, {
      presetId: "studio-front-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1920, height: 1080 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 1 },
      outputPath: "renders/vehicle-front.png"
    })).toThrow("Cannot build render manifest for incomplete material authoring: texture_source_photo_invalid");
  });

  it("refuses to build render manifest when the camera sector has no verified photo reference", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());

    expect(() => buildDigitalViewingRenderManifest(capture, {
      presetId: "studio-roof-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1920, height: 1080 },
      camera: { mode: "perspective", sector: "roof", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 1 },
      outputPath: "renders/vehicle-roof.png"
    })).toThrow("Cannot build render manifest for invalid render reference: render_camera_sector_unverified");
  });

  it("refuses to build render manifest when render output is not an image file", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());

    expect(() => buildDigitalViewingRenderManifest(capture, {
      presetId: "studio-front-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1920, height: 1080 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 1 },
      outputPath: "renders/vehicle-front.blend"
    })).toThrow(/render outputPath must point to an image artifact/);
  });

  it("refuses to build render manifest when render output is outside the renders directory", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());

    expect(() => buildDigitalViewingRenderManifest(capture, {
      presetId: "studio-front-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1920, height: 1080 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 1 },
      outputPath: "models/vehicle-front.png"
    })).toThrow(/render outputPath must stay under renders/);
  });

  it("refuses to build render manifest when premium measurement placement is missing", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const missingPlacement = {
      ...capture,
      measurements: capture.measurements.map((measurement) =>
        measurement.id === "wheelbase" ? { ...measurement, placement: undefined } : measurement
      )
    };

    expect(() => buildDigitalViewingRenderManifest(missingPlacement, {
      presetId: "studio-front-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1920, height: 1080 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 1 },
      outputPath: "renders/vehicle-front.png"
    })).toThrow("Cannot build render manifest for invalid capture: measurement_placement_missing");
  });

  it("refuses to build render manifest when premium host registry is incomplete", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const missingHost = {
      ...capture,
      modelElements: capture.modelElements.filter((element) => element.id !== "body")
    };

    expect(() => buildDigitalViewingRenderManifest(missingHost, {
      presetId: "studio-front-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1920, height: 1080 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 1 },
      outputPath: "renders/vehicle-front.png"
    })).toThrow("Cannot build render manifest for invalid capture: measurement_host_unknown, measurement_host_unknown, measurement_host_unknown, material_host_unknown, condition_host_unknown");
  });

  it("refuses to build render manifest from invalid capture", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const invalidCapture = {
      ...capture,
      measurements: capture.measurements.map((measurement) =>
        measurement.id === "overall-length" ? { ...measurement, verified: false } : measurement
      )
    };

    expect(() => buildDigitalViewingRenderManifest(invalidCapture, {
      presetId: "studio-front-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1920, height: 1080 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 1 },
      outputPath: "renders/vehicle-front.png"
    })).toThrow("Cannot build render manifest for invalid capture: geometry_not_verified");
  });

  it("refuses to build render manifest when capability blocks the render strategy", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());
    const restrictedCapability = {
      ...DefaultCapabilityManifest,
      allowedStrategies: {
        ...DefaultCapabilityManifest.allowedStrategies,
        digitalViewingRender: DefaultCapabilityManifest.allowedStrategies.digitalViewingRender.filter((strategy) => strategy !== "condition-overlays")
      }
    };

    expect(() => buildDigitalViewingRenderManifest(capture, {
      presetId: "studio-front-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1920, height: 1080 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 1 },
      outputPath: "renders/vehicle-front.png"
    }, restrictedCapability)).toThrow("Cannot build render manifest for unsupported digital viewing capability: strategy_not_allowed");
  });

  it("builds a validated Blender render job from a locked source scene and manifest", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderPreset = {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    } as const;
    const renderManifest = buildDigitalViewingRenderManifest(capture, renderPreset);
    const assetBundle = buildDigitalViewingAssetBundleManifest(capture, renderManifest, {
      existingFiles: FullCarportAssetPaths,
      assetFiles: assetFilesFor(FullCarportAssetPaths)
    });

    const job = buildDigitalViewingBlenderRenderJob(
      capture,
      renderPreset,
      "measurement-projects/carport-demo/artifacts/locked.blend",
      DefaultCapabilityManifest,
      assetBundle
    );

    expect(DigitalViewingBlenderRenderJobSchema.parse(job)).toEqual(job);
    expect(job.operation).toBe("digital_viewing_render");
    expect(job.renderManifest.notGeometryAuthority).toBe(true);
    expect(job.renderManifest.artifacts).toEqual({
      render: "renders/carport-southwest.png",
      manifest: "renders/carport-southwest.manifest.json"
    });
    expect(job.assetBundleManifest.hashes.assetBundleHash).toBe(assetBundle.hashes.assetBundleHash);
    expect(job.materialAuthoring).toEqual({
      sourceOfTruth: "derived-from-material-authoring-plan",
      planHash: job.renderManifest.hashes.materialAuthoringPlanHash,
      ready: true,
      blockingCount: 0,
      warningCount: 0
    });
    expect(job.executionPlacement).toEqual({
      sourceOfTruth: "computed-from-digital-viewing-render-contract",
      frontendRole: "control-plane-only",
      termuxRole: "ssh-control-plane-only",
      heavyComputeRole: "blender-render-worker",
      preferredExecutionGeography: "hetzner-ubuntu",
      fallbackExecutionGeography: "local-workstation",
      remoteExecutionRequiresExplicitSelection: true,
      geometryMutationAllowed: false,
      exportGeometryReconstructionAllowed: false
    });
  });

  it("refuses Blender render jobs whose source scene is not a blend file", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());

    expect(() => buildDigitalViewingBlenderRenderJob(capture, {
      presetId: "studio-front-preview",
      deliveryTier: "premium-sales",
      renderer: "eevee",
      resolution: { width: 320, height: 180 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 1 },
      outputPath: "renders/vehicle-front.png"
    }, "measurement-projects/vehicle-demo/artifacts/locked.png")).toThrow(/sourceBlendPath must point to a locked .blend source scene/);
  });

  it("refuses Blender render jobs whose source scene is inside the render output namespace", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());

    expect(() => buildDigitalViewingBlenderRenderJob(capture, {
      presetId: "studio-front-preview",
      deliveryTier: "premium-sales",
      renderer: "eevee",
      resolution: { width: 320, height: 180 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 1 },
      outputPath: "renders/vehicle-front.png"
    }, "renders/vehicle-front.blend")).toThrow(/sourceBlendPath must reference a locked source scene under sources\/ or measurement-projects\//);
  });

  it("refuses to build Blender render jobs without a verified asset bundle manifest", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());

    expect(() => buildDigitalViewingBlenderRenderJob(capture, {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales",
      renderer: "cycles",
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    }, "measurement-projects/carport-demo/artifacts/locked.blend")).toThrow("Cannot build render job without verified asset bundle: asset_bundle_manifest_required");
  });

  it("requires asset bundle manifests in the Blender render job schema", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderPreset = {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales" as const,
      renderer: "cycles" as const,
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective" as const, sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference" as const, colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    };
    const renderManifest = buildDigitalViewingRenderManifest(capture, renderPreset);
    const assetBundle = buildDigitalViewingAssetBundleManifest(capture, renderManifest, {
      existingFiles: FullCarportAssetPaths,
      assetFiles: assetFilesFor(FullCarportAssetPaths)
    });
    const job = buildDigitalViewingBlenderRenderJob(
      capture,
      renderPreset,
      "measurement-projects/carport-demo/artifacts/locked.blend",
      DefaultCapabilityManifest,
      assetBundle
    );
    const jobWithoutAssetBundle = { ...job } as Record<string, unknown>;
    delete jobWithoutAssetBundle.assetBundleManifest;

    expect(() => DigitalViewingBlenderRenderJobSchema.parse(jobWithoutAssetBundle)).toThrow();
  });

  it("refuses digital viewing preview inputs whose output scene path is not a blend file", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());

    expect(() => RenderDigitalViewingPreviewInputSchema.parse({
      capture,
      renderPreset: {
        presetId: "studio-front-preview",
        deliveryTier: "premium-sales",
        renderer: "eevee",
        resolution: { width: 320, height: 180 },
        camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
        lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 1 },
        outputPath: "renders/vehicle-front.png"
      },
      sourceBlendPath: "measurement-projects/vehicle-demo/artifacts/locked.blend",
      outputBlendPath: "renders/vehicle-front.png"
    })).toThrow(/sourceBlendPath must point to a locked .blend source scene/);
  });

  it("requires asset bundle manifests in digital viewing preview inputs", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());

    expect(() => RenderDigitalViewingPreviewInputSchema.parse({
      capture,
      renderPreset: {
        presetId: "carport-site-southwest-preview",
        deliveryTier: "premium-sales",
        renderer: "cycles",
        resolution: { width: 1600, height: 1000 },
        camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
        lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
        outputPath: "renders/carport-southwest.png"
      },
      sourceBlendPath: "measurement-projects/carport-demo/artifacts/locked.blend"
    })).toThrow();
  });

  it("binds a ready asset bundle manifest to the Blender render job", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderPreset = {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales" as const,
      renderer: "cycles" as const,
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective" as const, sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference" as const, colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    };
    const renderManifest = buildDigitalViewingRenderManifest(capture, renderPreset);
    const assetBundle = buildDigitalViewingAssetBundleManifest(capture, renderManifest, {
      existingFiles: FullCarportAssetPaths,
      assetFiles: assetFilesFor(FullCarportAssetPaths)
    });

    const job = buildDigitalViewingBlenderRenderJob(
      capture,
      renderPreset,
      "measurement-projects/carport-demo/artifacts/locked.blend",
      DefaultCapabilityManifest,
      assetBundle
    );

    expect(DigitalViewingBlenderRenderJobSchema.parse(job)).toEqual(job);
    expect(job.assetBundleManifest?.qualityGates.ready).toBe(true);
    expect(job.assetBundleManifest?.hashes.assetBundleHash).toBe(assetBundle.hashes.assetBundleHash);
    expect(job.renderManifest.cameraReference).toEqual({
      sourceOfTruth: "derived-from-verified-capture-photo-camera-metadata",
      referencePhoto: "photos/carport-south.jpg",
      sector: "south",
      cameraMode: "perspective",
      focalLength35mmEquivalent: 45,
      cameraDistanceMm: 9000
    });
  });

  it("refuses premium Blender render jobs when present photo or texture assets lack content hashes", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderPreset = {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales" as const,
      renderer: "cycles" as const,
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective" as const, sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference" as const, colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    };
    const renderManifest = buildDigitalViewingRenderManifest(capture, renderPreset);
    const assetBundle = buildDigitalViewingAssetBundleManifest(capture, renderManifest, {
      existingFiles: FullCarportAssetPaths
    });

    expect(assetBundle.qualityGates.ready).toBe(true);
    expect(assetBundle.assets.some((asset) => asset.status === "present" && !asset.sha256)).toBe(true);
    expect(() => buildDigitalViewingBlenderRenderJob(
      capture,
      renderPreset,
      "measurement-projects/carport-demo/artifacts/locked.blend",
      DefaultCapabilityManifest,
      assetBundle
    )).toThrow("Cannot build render job with invalid asset bundle: asset_bundle_content_hash_missing");
  });

  it("refuses premium Blender render jobs when present photo or texture assets lack image dimensions", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderPreset = {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales" as const,
      renderer: "cycles" as const,
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective" as const, sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference" as const, colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    };
    const renderManifest = buildDigitalViewingRenderManifest(capture, renderPreset);
    const assetBundle = buildDigitalViewingAssetBundleManifest(capture, renderManifest, {
      existingFiles: FullCarportAssetPaths,
      assetFiles: assetFilesWithoutImageDimensionsFor(FullCarportAssetPaths)
    });

    expect(assetBundle.qualityGates.ready).toBe(true);
    expect(assetBundle.assets.some((asset) => asset.status === "present" && ["photo", "texture"].includes(asset.assetType) && asset.width === undefined)).toBe(true);
    expect(() => buildDigitalViewingBlenderRenderJob(
      capture,
      renderPreset,
      "measurement-projects/carport-demo/artifacts/locked.blend",
      DefaultCapabilityManifest,
      assetBundle
    )).toThrow("Cannot build render job with invalid asset bundle: asset_bundle_image_dimensions_missing");
  });

  it("refuses premium Blender render jobs when texture asset dimensions disagree with declared texture evidence", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderPreset = {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales" as const,
      renderer: "cycles" as const,
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective" as const, sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference" as const, colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    };
    const renderManifest = buildDigitalViewingRenderManifest(capture, renderPreset);
    const assetBundle = buildDigitalViewingAssetBundleManifest(capture, renderManifest, {
      existingFiles: FullCarportAssetPaths,
      assetFiles: assetFilesWithTextureDimensionMismatchFor(FullCarportAssetPaths)
    });

    expect(assetBundle.qualityGates.ready).toBe(true);
    expect(assetBundle.assets).toContainEqual(expect.objectContaining({
      assetType: "texture",
      path: "textures/carport-white-panel-normal.png",
      width: 2048,
      height: 2048
    }));
    expect(renderManifest.materials.flatMap((material) => material.textureMaps)).toContainEqual(expect.objectContaining({
      path: "textures/carport-white-panel-normal.png",
      pixelWidth: 4096,
      pixelHeight: 4096
    }));
    expect(() => buildDigitalViewingBlenderRenderJob(
      capture,
      renderPreset,
      "measurement-projects/carport-demo/artifacts/locked.blend",
      DefaultCapabilityManifest,
      assetBundle
    )).toThrow("Cannot build render job with invalid asset bundle: asset_bundle_texture_dimensions_mismatch");
  });

  it("refuses premium Blender render jobs when photo asset dimensions disagree with declared capture photo dimensions", () => {
    const capture = DigitalViewingCaptureSchema.parse(carportCaptureWithDeclaredPhotoDimensions(4096, 3072));
    const renderPreset = {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales" as const,
      renderer: "cycles" as const,
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective" as const, sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference" as const, colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    };
    const renderManifest = buildDigitalViewingRenderManifest(capture, renderPreset);
    const assetBundle = buildDigitalViewingAssetBundleManifest(capture, renderManifest, {
      existingFiles: FullCarportAssetPaths,
      assetFiles: assetFilesWithPhotoDimensionMismatchFor(FullCarportAssetPaths)
    });

    expect(assetBundle.qualityGates.ready).toBe(true);
    expect(assetBundle.assets).toContainEqual(expect.objectContaining({
      assetType: "photo",
      path: "photos/carport-south.jpg",
      width: 2048,
      height: 1536
    }));
    expect(() => buildDigitalViewingBlenderRenderJob(
      capture,
      renderPreset,
      "measurement-projects/carport-demo/artifacts/locked.blend",
      DefaultCapabilityManifest,
      assetBundle
    )).toThrow("Cannot build render job with invalid asset bundle: asset_bundle_photo_dimensions_mismatch");
  });

  it("refuses to bind an incomplete asset bundle manifest to the Blender render job", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderPreset = {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales" as const,
      renderer: "cycles" as const,
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective" as const, sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference" as const, colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    };
    const renderManifest = buildDigitalViewingRenderManifest(capture, renderPreset);
    const incompleteAssetBundle = buildDigitalViewingAssetBundleManifest(capture, renderManifest, {
      existingFiles: ["photos/carport-south.jpg"]
    });

    expect(() => buildDigitalViewingBlenderRenderJob(
      capture,
      renderPreset,
      "measurement-projects/carport-demo/artifacts/locked.blend",
      DefaultCapabilityManifest,
      incompleteAssetBundle
    )).toThrow("Cannot build render job with invalid asset bundle: asset_bundle_not_ready");
  });

  it("refuses forged ready asset bundles when required texture assets are still missing", () => {
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const renderPreset = {
      presetId: "carport-site-southwest-preview",
      deliveryTier: "premium-sales" as const,
      renderer: "cycles" as const,
      resolution: { width: 1600, height: 1000 },
      camera: { mode: "perspective" as const, sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference" as const, colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    };
    const renderManifest = buildDigitalViewingRenderManifest(capture, renderPreset);
    const incompleteAssetBundle = buildDigitalViewingAssetBundleManifest(capture, renderManifest, {
      existingFiles: ["photos/carport-south.jpg"]
    });
    const forgedReadyBundle = {
      ...incompleteAssetBundle,
      assets: incompleteAssetBundle.assets.map((asset) =>
        asset.assetType === "texture" && asset.path === "textures/carport-white-panel-normal.png"
          ? asset
          : { ...asset, status: asset.status === "missing" ? "present" as const : asset.status }
      ),
      summary: {
        ...incompleteAssetBundle.summary,
        ready: true,
        missingCount: 0
      },
      qualityGates: {
        ready: true,
        blocking: [],
        warnings: incompleteAssetBundle.qualityGates.warnings
      }
    };

    expect(() => buildDigitalViewingBlenderRenderJob(
      capture,
      renderPreset,
      "measurement-projects/carport-demo/artifacts/locked.blend",
      DefaultCapabilityManifest,
      forgedReadyBundle
    )).toThrow("Cannot build render job with invalid asset bundle: asset_bundle_integrity_failed");
  });
});
