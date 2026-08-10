import { createHash } from "node:crypto";
import {
  DigitalViewingConditionInspectionSchema,
  DigitalViewingCaptureSchema,
  DigitalViewingMaterialConditionReportSchema,
  DigitalViewingRenderManifestSchema,
  type DigitalViewingMaterialConditionReport,
  type DigitalViewingRenderManifest,
  type TextureMap
} from "./digitalViewingContracts.js";
import { evaluateDigitalViewingDeliveryReadiness } from "./digitalViewingReadiness.js";

type RenderTextureReport = {
  applied?: Array<{ path: string; type: string }>;
  missing?: Array<{ path: string; type: string }>;
  skipped?: Array<{ path: string; type: string }>;
};

type RenderConditionReport = {
  applied?: Array<{ conditionId: string; hostElementId: string }>;
  missingHosts?: string[];
  skipped?: Array<{ id: string }>;
};

export function buildDigitalViewingMaterialConditionReport(
  input: unknown,
  deliveryTierInput: unknown,
  renderManifestInput?: unknown
): DigitalViewingMaterialConditionReport {
  const capture = DigitalViewingCaptureSchema.parse(input);
  const deliveryTier = DigitalViewingMaterialConditionReportSchema.shape.deliveryTier.parse(deliveryTierInput);
  const renderManifest = renderManifestInput ? DigitalViewingRenderManifestSchema.passthrough().parse(renderManifestInput) : undefined;
  const readiness = evaluateDigitalViewingDeliveryReadiness(capture, deliveryTier);
  const textureReport = getRenderTextureReport(renderManifest);
  const conditionReport = getRenderConditionReport(renderManifest);

  const reportWithoutHash = DigitalViewingMaterialConditionReportSchema.omit({ hashes: true }).parse({
    schemaVersion: 1,
    reportType: "material-condition-report",
    captureId: capture.captureId,
    projectId: capture.projectId,
    assetType: capture.assetType,
    deliveryTier,
    notGeometryAuthority: true,
    sourceOfTruth: {
      measurements: "geometry-and-scale",
      photos: "material-condition-context-evidence",
      blender: "renderable-truth-when-locked",
      report: "evidence-summary-no-geometry-reconstruction"
    },
    readiness,
    measurements: capture.measurements
      .slice()
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((measurement) => ({
        id: measurement.id,
        label: measurement.label,
        value: measurement.value,
        tolerance: measurement.tolerance,
        unit: measurement.unit,
        confidence: measurement.confidence,
        source: measurement.source,
        placement: measurement.placement
      })),
    photoEvidence: capture.photos
      .slice()
      .sort((left, right) => `${left.sector}:${left.role}:${left.path}`.localeCompare(`${right.sector}:${right.role}:${right.path}`))
      .map((photo) => ({
        path: photo.path,
        sector: photo.sector,
        role: photo.role,
        verified: photo.verified,
        materialCategories: photo.captureMetadata?.materialCategories ?? []
      })),
    materials: capture.materials
      .slice()
      .sort((left, right) => left.materialId.localeCompare(right.materialId))
      .map((material) => ({
        materialId: material.materialId,
        hostElementId: material.hostElementId,
        category: material.category,
        presetId: material.presetId,
        provenance: material.provenance,
        confidence: material.confidence,
        materialSurfaces: material.materialSurfaces.slice().sort(),
        photoSources: material.photoSources.slice().sort(),
        pbr: {
          baseColor: material.baseColor,
          roughness: material.roughness,
          metallic: material.metallic,
          specular: material.specular,
          transmission: material.transmission,
          normalSource: material.normalSource,
          textureScaleMm: material.textureScaleMm
        },
        surfaceMapping: material.surfaceMapping,
        appearanceCalibration: material.appearanceCalibration,
        textureMaps: material.textureMaps
          .slice()
          .sort(compareTextureMaps)
          .map((textureMap) => ({
            type: textureMap.type,
            path: textureMap.path,
            provenance: textureMap.provenance,
            confidence: textureMap.confidence,
            sourcePhoto: textureMap.sourcePhoto,
            renderStatus: textureStatus(textureMap, textureReport)
          }))
      })),
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
        sourcePhotoEvidence: conditionPhotoEvidence(condition.photoSources, capture.photos),
        materialSurface: condition.materialSurface,
        surfacePlacement: condition.surfacePlacement,
        renderStatus: conditionStatus(condition.id, condition.surfacePlacement?.hostElementId, conditionReport)
      })),
    conditionVisibilityChecklist: capture.conditions
      .slice()
      .filter((condition) => condition.verification === "verified")
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((condition) => ({
        conditionId: condition.id,
        hostElementId: condition.hostElementId,
        type: condition.type,
        severity: condition.severity,
        verification: condition.verification,
        mustBeVisible: true,
        sourceOfTruth: "verified-condition-evidence" as const,
        sourcePhotos: condition.photoSources.slice().sort(),
        sourcePhotoEvidence: conditionPhotoEvidence(condition.photoSources, capture.photos),
        inspectionZones: capture.conditionInspections
          .filter((inspection) => inspection.conditionIds.includes(condition.id))
          .map((inspection) => inspection.zone)
          .sort((left, right) => left.localeCompare(right)),
        materialSurface: condition.materialSurface,
        surfacePlacement: condition.surfacePlacement,
        renderStatus: conditionStatus(condition.id, condition.surfacePlacement?.hostElementId, conditionReport)
      })),
    conditionInspections: capture.conditionInspections
      .slice()
      .sort(compareConditionInspections)
      .map((inspection) => normalizeConditionInspectionForEvidence(inspection, capture.photos))
  });

  const hashes = {
    captureHash: sha256(capture)
  };

  return DigitalViewingMaterialConditionReportSchema.parse({
    ...reportWithoutHash,
    hashes: {
      ...hashes,
      reportHash: sha256({ ...reportWithoutHash, hashes })
    }
  });
}

function normalizeConditionInspectionForEvidence(
  input: unknown,
  photos: ReturnType<typeof DigitalViewingCaptureSchema.parse>["photos"]
) {
  const inspection = DigitalViewingConditionInspectionSchema.parse(input);
  return {
    id: inspection.id,
    zone: inspection.zone,
    hostElementId: inspection.hostElementId,
    materialCategory: inspection.materialCategory,
    status: inspection.status,
    verified: inspection.verified,
    sourcePhotos: inspection.sourcePhotos.slice().sort(),
    sourcePhotoEvidence: inspectionPhotoEvidence(inspection.sourcePhotos, photos),
    conditionIds: inspection.conditionIds.slice().sort(),
    confidence: inspection.confidence
  };
}

function inspectionPhotoEvidence(
  sourcePhotos: string[],
  photos: ReturnType<typeof DigitalViewingCaptureSchema.parse>["photos"]
) {
  const photosByPath = new Map(photos.map((photo) => [photo.path, photo]));
  return sourcePhotos
    .slice()
    .sort((left, right) => left.localeCompare(right))
    .map((path) => {
      const photo = photosByPath.get(path);
      return {
        path,
        sector: photo?.sector ?? "unknown",
        role: photo?.role ?? "validation",
        verified: photo?.verified ?? false,
        materialCategories: photo?.captureMetadata?.materialCategories ?? []
      };
    });
}

function conditionPhotoEvidence(
  sourcePhotos: string[],
  photos: ReturnType<typeof DigitalViewingCaptureSchema.parse>["photos"]
) {
  const photosByPath = new Map(photos.map((photo) => [photo.path, photo]));
  return sourcePhotos
    .slice()
    .sort((left, right) => left.localeCompare(right))
    .map((path) => {
      const photo = photosByPath.get(path);
      return {
        path,
        verified: photo?.verified ?? false,
        materialCategories: photo?.captureMetadata?.materialCategories ?? []
      };
    });
}

function compareConditionInspections(left: { zone: string; id: string }, right: { zone: string; id: string }): number {
  return `${left.zone}:${left.id}`.localeCompare(`${right.zone}:${right.id}`);
}

export function serializeDigitalViewingMaterialConditionReport(input: unknown): string {
  const report = DigitalViewingMaterialConditionReportSchema.parse(input);
  return `${JSON.stringify(report, null, 2)}\n`;
}

function getRenderTextureReport(renderManifest?: DigitalViewingRenderManifest): RenderTextureReport {
  return (renderManifest as unknown as { blenderExecution?: { materialApplication?: { textures?: RenderTextureReport } } } | undefined)
    ?.blenderExecution
    ?.materialApplication
    ?.textures ?? {};
}

function getRenderConditionReport(renderManifest?: DigitalViewingRenderManifest): RenderConditionReport {
  return (renderManifest as unknown as { blenderExecution?: { conditionApplication?: RenderConditionReport } } | undefined)
    ?.blenderExecution
    ?.conditionApplication ?? {};
}

function textureStatus(textureMap: TextureMap, report: RenderTextureReport): "declared" | "applied" | "missing" | "skipped" {
  const matches = (item: { path: string; type: string }) => item.path === textureMap.path && item.type === textureMap.type;
  if (report.applied?.some(matches)) {
    return "applied";
  }
  if (report.missing?.some(matches)) {
    return "missing";
  }
  if (report.skipped?.some(matches)) {
    return "skipped";
  }
  return "declared";
}

function conditionStatus(conditionId: string, hostElementId: string | undefined, report: RenderConditionReport): "declared" | "overlay-applied" | "missing-host" | "skipped" {
  if (report.applied?.some((item) => item.conditionId === conditionId)) {
    return "overlay-applied";
  }
  if (hostElementId && report.missingHosts?.includes(hostElementId)) {
    return "missing-host";
  }
  if (report.skipped?.some((item) => item.id === conditionId)) {
    return "skipped";
  }
  return "declared";
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
