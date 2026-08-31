import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import {
  buildDigitalViewingAssetBundleManifest,
  buildDigitalViewingRenderManifest,
  DigitalViewingCaptureRepairSummarySchema,
  DigitalViewingCaptureSchema,
  DigitalViewingDeliveryPackageManifestSchema
} from "../src/digitalViewingContracts.js";
import { registerMeasurementTools } from "../src/measurementTools.js";
import type { ExecutionIntent, ExecutionOperation } from "../src/executionGate.js";
import { MeasurementProjectSchema } from "../src/measurementContracts.js";
import { buildModelLock } from "../src/modelLock.js";
import { materializeProfiles } from "../src/profileGenerator.js";
import { buildOrthographicViewRegistry } from "../src/viewRegistry.js";
import { readUiCustomerEvidencePackage } from "../src/uiProjectState.js";

function executionIntent(operation: ExecutionOperation, writeScope: ExecutionIntent["writeScope"]): ExecutionIntent {
  return {
    intentId: `intent-${operation}`,
    operation,
    objective: `Execute ${operation} from reviewed local project state`,
    writeScope,
    forbiddenScope: ["source-measurements", "locked-geometry"],
    selectedToolPath: "mcp:nova-measured",
    acceptanceChecks: ["schema", "quality-gate", "manifest"],
    executionPolicy: { locality: "local-only", telemetry: false, fallback: "none", geometryMutation: false }
  };
}

type RegisteredTool = {
  description: string;
  handler: (input: unknown) => Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }>;
};

function loadCarportCapture(): unknown {
  return JSON.parse(readFileSync("fixtures/digital-viewing-carport-capture.json", "utf8")) as unknown;
}

function loadVehicleCapture(): unknown {
  return JSON.parse(readFileSync("fixtures/digital-viewing-vehicle-capture.json", "utf8")) as unknown;
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

function assetFilesFor(paths: string[]): Array<{ path: string; sizeBytes: number; sha256: string; width: number; height: number }> {
  return paths.map((assetPath, index) => ({
    path: assetPath,
    sizeBytes: 1024 + index,
    sha256: (index + 1).toString(16).padStart(64, "0"),
    width: assetPath.includes("detail") ? 2048 : 4096,
    height: assetPath.startsWith("textures/") ? 4096 : assetPath.includes("detail") ? 2048 : 3072
  }));
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

function blenderTextureApplicationsFor(
  renderManifest: ReturnType<typeof buildDigitalViewingRenderManifest>,
  assetBundle: ReturnType<typeof buildDigitalViewingAssetBundleManifest>
) {
  const assetsByPath = new Map(assetBundle.assets.map((asset) => [asset.path, asset]));
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

function materialSourcePhotoIdentitiesFor(
  renderManifest: ReturnType<typeof buildDigitalViewingRenderManifest>,
  assetBundle: ReturnType<typeof buildDigitalViewingAssetBundleManifest>,
  materialId: string
) {
  const material = renderManifest.materials.find((item) => item.materialId === materialId);
  const assetsByPath = new Map(assetBundle.assets.map((asset) => [asset.path, asset]));
  const entries = [
    ...(material?.photoSources ?? []).map((photoPath) => ({ usage: "material-source" as const, path: photoPath })),
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

function makeToolHarness(outputDir: string): Map<string, RegisteredTool> {
  const tools = new Map<string, RegisteredTool>();
  const server = {
    tool(name: string, description: string, _shape: unknown, handler: RegisteredTool["handler"]) {
      tools.set(name, { description, handler });
    }
  } as unknown as McpServer;

  registerMeasurementTools(server, { outputDir, timeoutMs: 120_000 });
  return tools;
}

describe("measurement MCP digital viewing tools", () => {
  it("exposes the production signer and fails closed without an explicit native adapter", async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "nova-measured-tools-"));
    const artifact = Buffer.from("native signer boundary");
    const tools = makeToolHarness(outputDir);
    const result = await tools.get("sign_publication_capture_package")!.handler({
      binding: {
        schemaVersion: 1,
        packageId: "native-package-1",
        projectId: "project-1",
        objectId: "object-1",
        captureProtocolId: "protocol-1",
        kitId: "kit-1",
        commissioningPartyId: "party-1",
        capturedAt: "2026-08-31T20:00:00.000Z",
        evidenceScopes: [{ id: "dimensions", kind: "measurement", required: true, verified: true }],
        manifest: [{ path: "evidence.json", sha256: createHash("sha256").update(artifact).digest("hex"), sizeBytes: artifact.byteLength }]
      },
      keyId: "native-key-1",
      outputPackagePath: "captures/native-package-1/capture-package.json",
      executionIntent: executionIntent("sign-publication-capture", ["manifest"])
    });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      error: { code: "publication_native_signer_not_configured" }
    });
  });

  it("keeps a real capture fixture export-blocked until human model review lock", async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "nova-measured-tools-"));
    const tools = makeToolHarness(outputDir);
    const capture = JSON.parse(readFileSync("fixtures/real-capture-carport-minimal.json", "utf8")) as unknown;
    const created = await tools.get("create_project_from_capture")!.handler(capture);
    expect(created.isError).toBe(false);

    const exported = await tools.get("export_facade_completion_pack")!.handler({
      projectId: "real-carport-minimal",
      executionIntent: executionIntent("export-facade-pack", ["project-state", "blender-output", "manifest"])
    });
    const body = JSON.parse(exported.content[0].text) as { error?: { code: string; details?: { blocking?: Array<{ code: string }> } } };
    expect(exported.isError).toBe(true);
    expect(body.error?.code).toBe("model_not_locked");
    expect(body.error?.details?.blocking).toContainEqual({
      code: "model_not_locked",
      message: "Human-reviewed model lock is required before permit-support export."
    });
  });

  it("blocks facade export before Blender when a required registry view is missing", async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "nova-measured-tools-"));
    const projectDir = path.join(outputDir, "measurement-projects", "view-fixture");
    const modelArtifact = "measurement-projects/view-fixture/artifacts/view-fixture.blend";
    await mkdir(path.join(projectDir, "artifacts"), { recursive: true });
    await writeFile(path.join(outputDir, modelArtifact), "reviewed blender bytes");
    const materialized = materializeProfiles(MeasurementProjectSchema.parse({
      schemaVersion: 1,
      projectId: "view-fixture",
      unit: "mm",
      photos: ["north", "south", "east", "west"].map((view) => ({ path: `photos/${view}.jpg`, view, role: "reference", confidence: "high" })),
      profiles: [{
        id: "profile-carport",
        profile: "carport",
        confidence: "high",
        parameters: { widthMm: 7676, depthMm: 6240, roofSlopePercent: 3.7, westHighSideHeightMm: 3455, eastLowSideHeightMm: 3174, steps: [], claddingDirection: "horizontal" }
      }],
      artifacts: { blend: modelArtifact }
    }));
    const projectWithViews = { ...materialized, viewRegistry: buildOrthographicViewRegistry(materialized.elements, ["north", "south", "east"]) };
    const modelLock = await buildModelLock({ outputDir, timeoutMs: 120_000 }, projectWithViews, {
      lockedAt: "2026-08-11T07:00:00.000Z",
      lockedBy: "reviewer",
      reason: "Reviewed"
    });
    await writeFile(path.join(projectDir, "project.json"), JSON.stringify({ ...projectWithViews, modelLock }), "utf8");

    const result = await makeToolHarness(outputDir).get("export_facade_completion_pack")!.handler({
      projectId: "view-fixture",
      executionIntent: executionIntent("export-facade-pack", ["project-state", "blender-output", "manifest"])
    });
    const body = JSON.parse(result.content[0].text) as { error?: { code: string; details?: { blocking?: Array<{ code: string }> } } };
    expect(result.isError).toBe(true);
    expect(body.error?.code).toBe("view_registry_invalid");
    expect(body.error?.details?.blocking?.map((reason) => reason.code)).toEqual(["required_view_missing"]);
  });

  it("rejects export execution before reading project state when intent lacks required scope", async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "nova-measured-tools-"));
    const tool = makeToolHarness(outputDir).get("export_model");

    const result = await tool!.handler({
      projectId: "missing-project",
      executionIntent: executionIntent("export-model", ["manifest"]),
      formats: ["glb"]
    });
    const body = JSON.parse(result.content[0].text) as {
      error?: { code: string; details?: { blocking?: Array<{ code: string }> } };
    };

    expect(result.isError).toBe(true);
    expect(body.error?.code).toBe("execution_intent_rejected");
    expect(body.error?.details?.blocking?.map((reason) => reason.code)).toEqual(["intent_write_scope_missing"]);
  });

  it("rejects model-lock execution before reading project state when intent violates locality", async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "nova-measured-tools-"));
    const tool = makeToolHarness(outputDir).get("lock_model_for_export");
    const invalidIntent = executionIntent("lock-model", ["project-state", "manifest"]);
    invalidIntent.executionPolicy.locality = "remote";

    const result = await tool!.handler({
      projectId: "missing-project",
      executionIntent: invalidIntent,
      lockedBy: "reviewer",
      reason: "Reviewed measured geometry"
    });
    const body = JSON.parse(result.content[0].text) as {
      error?: { code: string; details?: { blocking?: Array<{ code: string }> } };
    };

    expect(result.isError).toBe(true);
    expect(body.error?.code).toBe("execution_intent_rejected");
    expect(body.error?.details?.blocking?.map((reason) => reason.code)).toEqual(["intent_locality_violation"]);
  });

  it("emits deterministic intent/action evidence after a successful model lock", async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "nova-measured-tools-"));
    const projectDir = path.join(outputDir, "measurement-projects", "lock-fixture");
    await mkdir(projectDir, { recursive: true });
    await mkdir(path.join(projectDir, "artifacts"), { recursive: true });
    await writeFile(path.join(projectDir, "artifacts", "lock-fixture.blend"), "reviewed blender bytes");
    await writeFile(path.join(projectDir, "project.json"), JSON.stringify({
      schemaVersion: 1,
      projectId: "lock-fixture",
      unit: "mm",
      photos: ["north", "south", "east", "west"].map((view) => ({ path: `photos/${view}.jpg`, view, role: "reference", confidence: "high" })),
      profiles: [{
        id: "profile-carport",
        profile: "carport",
        confidence: "high",
        parameters: {
          widthMm: 7676,
          depthMm: 6240,
          roofSlopePercent: 3.7,
          westHighSideHeightMm: 3455,
          eastLowSideHeightMm: 3174,
          steps: [],
          claddingDirection: "horizontal"
        }
      }],
      artifacts: { blend: "measurement-projects/lock-fixture/artifacts/lock-fixture.blend" }
    }), "utf8");
    const tool = makeToolHarness(outputDir).get("lock_model_for_export");

    const result = await tool!.handler({
      projectId: "lock-fixture",
      executionIntent: executionIntent("lock-model", ["project-state", "manifest"]),
      lockedBy: "reviewer",
      reason: "Reviewed measured geometry"
    });
    const body = JSON.parse(result.content[0].text) as {
      data?: { modelLock?: { modelHash: string; sourceProjectHash: string; modelArtifact: string }; execution?: { intent: { intentId: string }; action: { intentHash: string; manifestHash: string; changedArtifacts: string[]; executionPolicy: unknown } } };
    };

    expect(result.isError).toBe(false);
    expect(body.data?.modelLock?.modelHash).toHaveLength(64);
    expect(body.data?.modelLock?.sourceProjectHash).toHaveLength(64);
    expect(body.data?.modelLock?.modelArtifact).toBe("measurement-projects/lock-fixture/artifacts/lock-fixture.blend");
    expect(body.data?.execution?.intent.intentId).toBe("intent-lock-model");
    expect(body.data?.execution?.action.intentHash).toHaveLength(64);
    expect(body.data?.execution?.action.manifestHash).toHaveLength(64);
    expect(body.data?.execution?.action.changedArtifacts).toEqual(["measurement-projects/lock-fixture/project.json"]);
    expect(body.data?.execution?.action.executionPolicy).toEqual({ locality: "local-only", telemetry: false, fallback: "none", geometryMutation: false });
  });

  it("returns machine-readable capture guide checklists for UI capture flows", async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "nova-measured-tools-"));
    const tools = makeToolHarness(outputDir);
    const tool = tools.get("get_digital_viewing_capture_guide");

    expect(tool).toBeDefined();
    expect(tool!.description).toContain("checklists");

    const result = await tool!.handler({
      assetType: "vehicle",
      deliveryTier: "premium-sales"
    });
    const body = JSON.parse(result.content[0].text) as {
      ok: boolean;
      data?: {
        guide: {
          measurementChecklist: Array<{ measurementId: string; placementRequired: boolean }>;
          materialChecklist: Array<{ category: string; requiredMaps: string[] }>;
          inspectionChecklist: Array<{ zone: string; sourcePhotosRequired: boolean }>;
        };
      };
    };

    expect(result.isError).toBe(false);
    expect(body.ok).toBe(true);
    expect(body.data?.guide.measurementChecklist.map((item) => [item.measurementId, item.placementRequired])).toEqual([
      ["overall-length", true],
      ["overall-width", true],
      ["overall-height", true],
      ["wheelbase", true]
    ]);
    expect(body.data?.guide.materialChecklist.map((item) => [item.category, item.requiredMaps])).toEqual([
      ["paint", ["baseColor", "normal", "roughness"]],
      ["glass", ["alpha", "roughness"]],
      ["rubber", ["normal", "roughness"]],
      ["metal", ["metallic", "normal", "roughness"]],
      ["leather", ["normal", "roughness"]]
    ]);
    expect(body.data?.guide.inspectionChecklist.map((item) => [item.zone, item.sourcePhotosRequired])).toEqual([
      ["body", true],
      ["glass", true],
      ["wheels-tires", true],
      ["interior", true]
    ]);
  });

  it("returns capture guide checklists with failed preset validation details", async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "nova-measured-tools-"));
    const tools = makeToolHarness(outputDir);
    const tool = tools.get("validate_digital_viewing_capture_preset");
    const capture = DigitalViewingCaptureSchema.parse(loadVehicleCapture());

    expect(tool).toBeDefined();

    const result = await tool!.handler({
      capture: {
        ...capture,
        photos: capture.photos.filter((photo) => photo.sector !== "interior")
      },
      deliveryTier: "premium-sales"
    });
    const body = JSON.parse(result.content[0].text) as {
      ok: boolean;
      error?: {
        code: string;
        details?: {
          guide?: {
            measurementChecklist: Array<{ measurementId: string }>;
            materialChecklist: Array<{ category: string }>;
            inspectionChecklist: Array<{ zone: string }>;
          };
          repairSummary?: {
            ready: boolean;
            sections: Array<{ section: string; blockingCount: number; blockingIds: string[] }>;
          };
          blocking?: Array<{ code: string; id: string }>;
        };
      };
    };

    expect(result.isError).toBe(true);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe("digital_viewing_capture_not_ready");
    expect(body.error?.details?.blocking).toContainEqual({
      id: "sector-interior",
      code: "required_sector_missing",
      message: "Required capture sector is missing."
    });
    expect(body.error?.details?.guide?.measurementChecklist.map((item) => item.measurementId)).toEqual([
      "overall-length",
      "overall-width",
      "overall-height",
      "wheelbase"
    ]);
    expect(body.error?.details?.guide?.materialChecklist.map((item) => item.category)).toEqual([
      "paint",
      "glass",
      "rubber",
      "metal",
      "leather"
    ]);
    expect(body.error?.details?.guide?.inspectionChecklist.map((item) => item.zone)).toEqual([
      "body",
      "glass",
      "wheels-tires",
      "interior"
    ]);
    const repairSummary = DigitalViewingCaptureRepairSummarySchema.parse(body.error?.details?.repairSummary);
    expect(repairSummary).toEqual({
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

  it("generates a pre-render asset-bundle readiness manifest without Blender execution", async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "nova-measured-tools-"));
    const tools = makeToolHarness(outputDir);
    const tool = tools.get("generate_digital_viewing_asset_bundle_manifest");
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

    expect(tool).toBeDefined();
    expect(tool!.description).toContain("pre-render");

    const result = await tool!.handler({
      capture,
      renderManifest,
      existingFiles: [
        "photos/carport-south.jpg",
        "photos/carport-west.jpg",
        "textures/carport-white-panel-normal.png",
        "textures/carport-white-panel-roughness.png"
      ],
      outputPath: "asset-bundles/carport-southwest.asset-bundle.json"
    });
    const body = JSON.parse(result.content[0].text) as {
      ok: boolean;
      data?: {
        assetBundlePath: string;
        assetBundle: {
          notGeometryAuthority: boolean;
          summary: { ready: boolean; missingCount: number };
          qualityGates: { blocking: Array<{ code: string; id: string }> };
        };
      };
      error?: { code: string; details?: { blocking?: Array<{ code: string; id: string }> } };
    };

    expect(result.isError).toBe(true);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe("digital_viewing_asset_bundle_not_ready");
    expect(body.error?.details?.blocking?.map((reason) => [reason.code, reason.id])).toEqual([
      ["asset_file_missing", "photos/carport-detail-panel.jpg"],
      ["asset_file_missing", "photos/carport-east.jpg"],
      ["asset_file_missing", "textures/carport-stone-foundation-normal.png"],
      ["asset_file_missing", "textures/carport-stone-foundation-roughness.png"]
    ]);

    const written = JSON.parse(await readFile(path.join(outputDir, "asset-bundles/carport-southwest.asset-bundle.json"), "utf8")) as {
      notGeometryAuthority: boolean;
      summary: { ready: boolean; missingCount: number };
    };
    expect(written.notGeometryAuthority).toBe(true);
    expect(written.summary).toEqual({ ready: false, requiredCount: 9, missingCount: 4, warningCount: 0 });
  });

  it("can scan the configured output directory for prepared bundle files", async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "nova-measured-tools-"));
    const files = [
      "photos/carport-detail-panel.jpg",
      "photos/carport-east.jpg",
      "photos/carport-south.jpg",
      "photos/carport-west.jpg",
      "textures/carport-stone-foundation-normal.png",
      "textures/carport-stone-foundation-roughness.png",
      "textures/carport-white-panel-normal.png",
      "textures/carport-white-panel-roughness.png"
    ];
    for (const file of files) {
      const absolute = path.join(outputDir, file);
      await mkdir(path.dirname(absolute), { recursive: true });
      await writeFile(absolute, "fixture", "utf8");
    }
    const tools = makeToolHarness(outputDir);
    const tool = tools.get("generate_digital_viewing_asset_bundle_manifest");
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

    const result = await tool!.handler({
      capture,
      renderManifest,
      scanOutputDir: true,
      outputPath: "asset-bundles/carport-southwest.asset-bundle.json"
    });
    const body = JSON.parse(result.content[0].text) as {
      ok: boolean;
      data?: {
        assetBundle: {
          summary: { ready: boolean; missingCount: number };
          assets: Array<{ path: string; status: string; sizeBytes?: number; sha256?: string }>;
        };
      };
    };

    expect(result.isError).toBe(false);
    expect(body.ok).toBe(true);
    expect(body.data?.assetBundle.summary).toEqual({ ready: true, requiredCount: 9, missingCount: 0, warningCount: 0 });
    expect(body.data?.assetBundle.assets.map((asset) => [asset.path, asset.status])).toContainEqual([
      "photos/carport-east.jpg",
      "present"
    ]);
    expect(body.data?.assetBundle.assets.find((asset) => asset.path === "photos/carport-east.jpg")).toMatchObject({
      sizeBytes: 7,
      sha256: createHash("sha256").update("fixture").digest("hex")
    });
  });

  it("returns photoreal quality checklist from delivery package generation", async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "nova-measured-tools-"));
    const tools = makeToolHarness(outputDir);
    const tool = tools.get("generate_digital_viewing_delivery_package");
    const capture = DigitalViewingCaptureSchema.parse(loadCarportCapture());
    const projectDir = path.join(outputDir, "measurement-projects", capture.projectId);
    await mkdir(projectDir, { recursive: true });
    await writeFile(path.join(projectDir, "project.json"), JSON.stringify(MeasurementProjectSchema.parse({ schemaVersion: 1, projectId: capture.projectId, unit: "mm", artifacts: { digitalViewingRenderManifest: "renders/carport-southwest.manifest.json" } })));
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
              surfaceMapping: { projection: "box", faces: ["front", "left", "right"], scaleMm: 500, rotationDeg: 0, sourcePhoto: "photos/carport-south.jpg" },
              appearanceCalibration: { method: "white-balance-reference", sourcePhoto: "photos/carport-south.jpg", illuminant: "daylight", confidence: "medium" }
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
              surfaceMapping: { projection: "planar", faces: ["front"], scaleMm: 900, rotationDeg: 0, sourcePhoto: "photos/carport-west.jpg" },
              appearanceCalibration: { method: "white-balance-reference", sourcePhoto: "photos/carport-west.jpg", illuminant: "daylight", confidence: "medium" }
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

    expect(tool).toBeDefined();
    expect(tool!.description).toContain("quality checklist");

    const result = await tool!.handler({
      capture,
      renderManifest: executedRenderManifest,
      assetBundleManifest: assetBundle,
      assetBundleManifestPath: "asset-bundles/carport-southwest.asset-bundle.json",
      deliveryTargets: ["photoreal-render", "material-condition-report"],
      outputPath: "deliveries/carport-customer-evidence.json"
    });
    const body = JSON.parse(result.content[0].text) as {
      ok: boolean;
      data?: { deliveryPackage?: unknown };
    };
    const deliveryPackage = DigitalViewingDeliveryPackageManifestSchema.parse(body.data?.deliveryPackage);

    expect(result.isError).toBe(false);
    expect(body.ok).toBe(true);
    expect(deliveryPackage.qualityGates.ready).toBe(true);
    const linkedProject = MeasurementProjectSchema.parse(JSON.parse(await readFile(path.join(projectDir, "project.json"), "utf8")) as unknown);
    expect(linkedProject.artifacts).toMatchObject({ digitalViewingDeliveryPackage: "deliveries/carport-customer-evidence.json", digitalViewingDeliveryPackageHash: deliveryPackage.hashes.packageHash });
    await mkdir(path.join(outputDir, "renders"), { recursive: true });
    await writeFile(path.join(outputDir, "renders/carport-southwest.manifest.json"), JSON.stringify(executedRenderManifest));
    const customerEvidence = await readUiCustomerEvidencePackage({ host: "127.0.0.1", port: 0, outputDir, environmentTruth: { provider: "Hetzner", engine: "Blender 5.2.0", endpoint: "test", executionGeography: "remote", owner: "project-ci", costClass: "included-remote", latencyClass: "long-running", fallbackUsed: false, dataScope: ["customer-evidence"], privacyBoundary: "loopback-only; no telemetry", operatorApprovalRequired: true, auditNotes: [] } }, capture.projectId);
    expect(customerEvidence?.measurements.find((entry) => entry.id === "overall-width")).toMatchObject({ tolerance: 1, source: "drawing", claimStatus: "reference" });
    expect(customerEvidence?.materials.find((entry) => entry.id === "painted-white-wood-panel")).toMatchObject({ category: "wood", provenance: "photo_observed", sourcePhotos: ["photos/carport-east.jpg", "photos/carport-west.jpg"] });
    expect(customerEvidence?.conditions.find((entry) => entry.id === "white-panel-weathering")).toMatchObject({ type: "wear", severity: "low", verification: "verified", sourcePhotos: ["photos/carport-detail-panel.jpg"] });
    const packagePath = path.join(outputDir, "deliveries/carport-customer-evidence.json");
    const packageBytes = await readFile(packagePath);
    const tamperedPackage = JSON.parse(packageBytes.toString("utf8")) as { measurementEvidenceCoverage: { entries: Array<{ value: number }> } };
    tamperedPackage.measurementEvidenceCoverage.entries[0].value += 1;
    await writeFile(packagePath, JSON.stringify(tamperedPackage));
    expect(await readUiCustomerEvidencePackage({ host: "127.0.0.1", port: 0, outputDir, environmentTruth: { provider: "Hetzner", engine: "Blender 5.2.0", endpoint: "test", executionGeography: "remote", owner: "project-ci", costClass: "included-remote", latencyClass: "long-running", fallbackUsed: false, dataScope: ["customer-evidence"], privacyBoundary: "loopback-only; no telemetry", operatorApprovalRequired: true, auditNotes: [] } }, capture.projectId)).toBeNull();
    await writeFile(packagePath, packageBytes);
    expect(await readUiCustomerEvidencePackage({ host: "127.0.0.1", port: 0, outputDir, environmentTruth: { provider: "Hetzner", engine: "Blender 5.2.0", endpoint: "test", executionGeography: "remote", owner: "project-ci", costClass: "included-remote", latencyClass: "long-running", fallbackUsed: false, dataScope: ["customer-evidence"], privacyBoundary: "loopback-only; no telemetry", operatorApprovalRequired: true, auditNotes: [] } }, capture.projectId)).not.toBeNull();
    expect(deliveryPackage.customerReadinessSummary).toMatchObject({
      customerSurface: "internal-review",
      status: "ready",
      requiredTargetCount: 2,
      readyRequiredTargetCount: 2,
      missingRequiredTargetCount: 0,
      failedQualityCheckCount: 0
    });
    const assertedViewer = await tool!.handler({
      capture,
      renderManifest: executedRenderManifest,
      assetBundleManifest: assetBundle,
      assetBundleManifestPath: "asset-bundles/carport-southwest.asset-bundle.json",
      customerSurface: "showroom",
      deliveryTargets: ["photoreal-render", "material-condition-report", "glb", "web-viewer"],
      deliveryArtifacts: [
        { target: "glb", path: "exports/asserted.glb", hash: "a".repeat(64) },
        { target: "web-viewer", path: "web/asserted/viewer-manifest.json", hash: "b".repeat(64) }
      ]
    });
    expect(assertedViewer.isError).toBe(true);
    expect((JSON.parse(assertedViewer.content[0].text) as { error: { code: string } }).error.code).toBe("web_viewer_evidence_invalid");
    expect(deliveryPackage.renderQualityCoverage).toMatchObject({
      status: "ready",
      declared: {
        renderer: "cycles",
        deliveryTier: "premium-sales"
      },
      executed: {
        renderer: "cycles",
        samples: 64,
        denoise: true,
        viewTransform: "Filmic",
        exposure: 0,
        gamma: 1
      }
    });
    expect(deliveryPackage.renderQualityCoverage.checks.map((entry) => [entry.check, entry.status])).toEqual([
      ["renderer", "passed"],
      ["sampling", "passed"],
      ["resolution", "passed"],
      ["color-management", "passed"],
      ["background", "passed"]
    ]);
    expect(deliveryPackage.photoEvidenceCoverage).toMatchObject({
      verifiedPhotoCount: 5,
      evidenceCount: 22,
      missingEvidenceCount: 0
    });
    expect(deliveryPackage.photoEvidenceCoverage.entries.map((entry) => [entry.usage, entry.targetId, entry.path])).toContainEqual([
      "camera-reference",
      "south",
      "photos/carport-south.jpg"
    ]);
    expect(deliveryPackage.photoEvidenceCoverage.entries.map((entry) => [entry.usage, entry.targetId, entry.path])).toContainEqual([
      "condition-evidence",
      "white-panel-weathering",
      "photos/carport-detail-panel.jpg"
    ]);
    expect(deliveryPackage.photoEvidenceCoverage.entries.map((entry) => [entry.usage, entry.targetId, entry.path])).toContainEqual([
      "inspection-source",
      "foundation",
      "photos/carport-west.jpg"
    ]);
    expect(deliveryPackage.captureAngleCoverage).toMatchObject({
      presetId: "exterior-structure-premium-sales",
      requiredShotCount: 5,
      matchedShotCount: 5,
      missingShotCount: 0,
      mismatchedShotCount: 0
    });
    expect(deliveryPackage.captureAngleCoverage.entries.map((entry) => [entry.sector, entry.selectedPhotoPath, entry.status])).toEqual([
      ["north", "photos/carport-north.jpg", "matched"],
      ["south", "photos/carport-south.jpg", "matched"],
      ["east", "photos/carport-east.jpg", "matched"],
      ["west", "photos/carport-west.jpg", "matched"],
      ["detail", "photos/carport-detail-panel.jpg", "matched"]
    ]);
    expect(deliveryPackage.measurementEvidenceCoverage).toMatchObject({
      geometryMeasurementCount: 8,
      appliedAnchorCount: 8,
      missingAnchorCount: 0
    });
    expect(deliveryPackage.measurementEvidenceCoverage.entries.map((entry) => [entry.measurementId, entry.value, entry.unit, entry.blenderAnchorStatus])).toContainEqual([
      "overall-width",
      7676,
      "mm",
      "applied"
    ]);
    expect(deliveryPackage.measurementEvidenceCoverage.entries.map((entry) => [entry.measurementId, entry.hostElementId, entry.referenceFrame])).toContainEqual([
      "neighbor-boundary-distance",
      "outermost-southwest-post",
      "site-local"
    ]);
    expect(deliveryPackage.dimensionOverlayCoverage).toMatchObject({
      overlayCandidateCount: 8,
      overlayReadyCount: 8,
      overlayBlockedCount: 0
    });
    expect(deliveryPackage.dimensionOverlayCoverage.entries.map((entry) => [
      entry.measurementId,
      entry.overlayStatus,
      entry.displayLabel
    ])).toContainEqual([
      "overall-width",
      "ready",
      "Carport width: 7676 mm"
    ]);
    expect(deliveryPackage.viewerLayerCoverage).toMatchObject({
      layerCount: 5,
      readyLayerCount: 4,
      blockedLayerCount: 0,
      notRequestedLayerCount: 1
    });
    expect(deliveryPackage.viewerLayerCoverage.entries.map((entry) => [entry.layer, entry.status])).toEqual([
      ["photoreal-scene", "ready"],
      ["material-fidelity", "ready"],
      ["condition-disclosure", "ready"],
      ["dimension-overlays", "ready"],
      ["web-delivery", "not-requested"]
    ]);
    expect(deliveryPackage.materialRenderCoverage).toMatchObject({
      materialCount: 2,
      hostTargetedMaterialCount: 2,
      appliedMaterialCount: 2,
      missingMaterialCount: 0,
      textureMapCount: 4,
      appliedTextureMapCount: 4,
      missingTextureMapCount: 0
    });
    expect(deliveryPackage.materialRenderCoverage.entries.map((entry) => [entry.materialId, entry.materialRenderStatus])).toEqual([
      ["dark-stone-foundation", "applied"],
      ["painted-white-wood-panel", "applied"]
    ]);
    expect(deliveryPackage.pbrMaterialCompletenessCoverage).toMatchObject({
      materialCount: 2,
      completeMaterialCount: 2,
      incompleteMaterialCount: 0,
      photoNormalSourceCount: 2,
      textureScaleDeclaredCount: 2
    });
    expect(deliveryPackage.pbrMaterialCompletenessCoverage.entries.map((entry) => [entry.materialId, entry.completenessStatus, entry.missingTextureTypes])).toEqual([
      ["dark-stone-foundation", "complete", []],
      ["painted-white-wood-panel", "complete", []]
    ]);
    expect(deliveryPackage.renderExecutionCoverage).toMatchObject({
      renderer: "cycles",
      renderPath: "renders/carport-southwest.png",
      manifestPath: "renders/carport-southwest.manifest.json",
      camera: {
        declaredSector: "south",
        executedSector: "south",
        status: "matched"
      },
      lighting: {
        declaredEnvironment: "site-reference",
        executedEnvironment: "site-reference",
        status: "matched"
      },
      assetBundle: {
        status: "matched",
        declaredHash: assetBundle.hashes.assetBundleHash,
        executedHash: assetBundle.hashes.assetBundleHash
      }
    });
    expect(deliveryPackage.renderReferenceComparisonCoverage).toMatchObject({
      required: true,
      referencePhoto: "photos/carport-south.jpg",
      renderPath: "renders/carport-southwest.png",
      method: "luma-grid-rmse",
      score: 0.86,
      threshold: 0.75,
      status: "matched"
    });
    expect(deliveryPackage.conditionRenderCoverage).toMatchObject({
      verifiedConditionCount: 1,
      visibleConditionCount: 1,
      appliedConditionCount: 1,
      missingConditionCount: 0,
      inspectionZoneCount: 5,
      verifiedInspectionZoneCount: 5,
      defectFoundZoneCount: 1
    });
    expect(deliveryPackage.conditionRenderCoverage.entries.map((entry) => [entry.conditionId, entry.conditionRenderStatus, entry.placementStatus])).toEqual([
      ["white-panel-weathering", "applied", "matched"]
    ]);
    expect(deliveryPackage.conditionOverlayCoverage).toMatchObject({
      overlayCandidateCount: 1,
      overlayReadyCount: 1,
      overlayBlockedCount: 0
    });
    expect(deliveryPackage.conditionOverlayCoverage.entries.map((entry) => [
      entry.conditionId,
      entry.overlayStatus,
      entry.displayLabel
    ])).toEqual([
      ["white-panel-weathering", "ready", "wear: low severity"]
    ]);
    expect(deliveryPackage.photorealQualityChecklist.map((item) => [item.check, item.status])).toEqual([
      ["asset-bundle", "passed"],
      ["render-output", "passed"],
      ["measurements", "passed"],
      ["materials", "passed"],
      ["textures", "passed"],
      ["conditions", "passed"],
      ["camera", "passed"],
      ["lighting", "passed"]
    ]);
    expect(deliveryPackage.photorealQualityChecklist.every((item) => item.trace.captureHash === deliveryPackage.hashes.captureHash)).toBe(true);
    expect(deliveryPackage.photorealQualityChecklist.every((item) => item.trace.renderManifestHash === deliveryPackage.hashes.renderManifestHash)).toBe(true);
    expect(deliveryPackage.photorealQualityChecklist.some((item) => item.trace.materialConditionReportHash === deliveryPackage.hashes.materialConditionReportHash)).toBe(true);
  });

  it("reports a causal source-projection preflight failure before Blender execution", async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "nova-source-projection-tool-"));
    const tool = makeToolHarness(outputDir).get("align_and_project_source_photo");
    expect(tool).toBeDefined();
    const result = await tool!.handler({
      schemaVersion: 1,
      projectId: "projection-proof",
      sourceBlendPath: "sources/projection-proof.locked.blend",
      outputBlendPath: "projections/projection-proof.projected.blend",
      outputReportPath: "projections/projection-proof.report.json",
      sourcePhoto: { path: "photos/missing.png", sizeBytes: 100, sha256: "a".repeat(64), pixelWidth: 100, pixelHeight: 100 },
      target: { hostElementId: "Facade", face: "front", widthMm: 1000, heightMm: 500, dimensionToleranceMm: 2 },
      anchors: [
        { id: "a", sourcePx: { x: 0, y: 100 }, targetMm: { x: 0, y: 0 }, uncertaintyPx: 0 },
        { id: "b", sourcePx: { x: 100, y: 100 }, targetMm: { x: 1000, y: 0 }, uncertaintyPx: 0 },
        { id: "c", sourcePx: { x: 100, y: 0 }, targetMm: { x: 1000, y: 500 }, uncertaintyPx: 0 },
        { id: "d", sourcePx: { x: 0, y: 0 }, targetMm: { x: 0, y: 500 }, uncertaintyPx: 0 }
      ],
      thresholds: { inlierErrorPx: 0.5, maxRmsePx: 0.5, minInlierRatio: 1 }
    });
    const body = JSON.parse(result.content[0].text) as { error: { code: string } };
    expect(result.isError).toBe(true);
    expect(body.error.code).toBe("source_projection_photo_missing");
  });

  it("fails every drawing and template delivery path closed when no reviewed model lock exists", async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "nova-unlocked-delivery-"));
    const projectDir = path.join(outputDir, "measurement-projects", "unlocked-delivery");
    await mkdir(projectDir, { recursive: true });
    await writeFile(path.join(projectDir, "project.json"), JSON.stringify(MeasurementProjectSchema.parse({
      schemaVersion: 1,
      projectId: "unlocked-delivery",
      unit: "mm"
    })), "utf8");
    const tools = makeToolHarness(outputDir);
    const drawings = await tools.get("export_dimensioned_drawings")!.handler({
      projectId: "unlocked-delivery",
      executionIntent: executionIntent("export-drawings", ["blender-output", "manifest"]),
      outputPath: "deliveries/drawings.pdf",
      scale: "1:100",
      includeConfidenceLegend: true
    });
    const template = await tools.get("export_project_template")!.handler({
      projectId: "unlocked-delivery",
      executionIntent: executionIntent("export-template", ["project-state", "blender-output", "manifest"]),
      template: "client-preview",
      options: {}
    });
    expect(drawings.isError).toBe(true);
    expect(template.isError).toBe(true);
    const drawingsBody = JSON.parse(drawings.content[0].text) as { error: { code: string } };
    const templateBody = JSON.parse(template.content[0].text) as { error: { code: string } };
    expect(drawingsBody.error.code).toBe("model_lock_invalid");
    expect(templateBody.error.code).toBe("model_lock_invalid");
  });

  it("rejects source-projection inputs that escape through symlinks", async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "nova-source-projection-root-"));
    const outsideDir = await mkdtemp(path.join(tmpdir(), "nova-source-projection-outside-"));
    await mkdir(path.join(outputDir, "photos"), { recursive: true });
    await mkdir(path.join(outputDir, "sources"), { recursive: true });
    await writeFile(path.join(outsideDir, "photo.png"), "private-photo");
    await writeFile(path.join(outsideDir, "locked.blend"), "private-blend");
    await symlink(path.join(outsideDir, "photo.png"), path.join(outputDir, "photos", "source.png"));
    await symlink(path.join(outsideDir, "locked.blend"), path.join(outputDir, "sources", "locked.blend"));

    const tool = makeToolHarness(outputDir).get("align_and_project_source_photo")!;
    const result = await tool.handler(sourceProjectionInput());
    const body = JSON.parse(result.content[0].text) as { error: { code: string } };

    expect(result.isError).toBe(true);
    expect(body.error.code).toBe("source_projection_path_escape");
    expect(await readFile(path.join(outsideDir, "photo.png"), "utf8")).toBe("private-photo");
    expect(await readFile(path.join(outsideDir, "locked.blend"), "utf8")).toBe("private-blend");
  });

  it("rejects source-projection output parents that escape through symlinks", async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "nova-source-projection-root-"));
    const outsideDir = await mkdtemp(path.join(tmpdir(), "nova-source-projection-outside-"));
    await mkdir(path.join(outputDir, "photos"), { recursive: true });
    await mkdir(path.join(outputDir, "sources"), { recursive: true });
    await writeFile(path.join(outputDir, "photos", "source.png"), "photo");
    await writeFile(path.join(outputDir, "sources", "locked.blend"), "blend");
    await symlink(outsideDir, path.join(outputDir, "projections"));

    const tool = makeToolHarness(outputDir).get("align_and_project_source_photo")!;
    const result = await tool.handler(sourceProjectionInput());
    const body = JSON.parse(result.content[0].text) as { error: { code: string } };

    expect(result.isError).toBe(true);
    expect(body.error.code).toBe("source_projection_path_escape");
    expect(await readFile(path.join(outputDir, "photos", "source.png"), "utf8")).toBe("photo");
  });
});

function sourceProjectionInput(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    projectId: "projection-proof",
    sourceBlendPath: "sources/locked.blend",
    outputBlendPath: "projections/projected.blend",
    outputReportPath: "projections/report.json",
    sourcePhoto: { path: "photos/source.png", sizeBytes: 5, sha256: "a".repeat(64), pixelWidth: 100, pixelHeight: 100 },
    target: { hostElementId: "Facade", face: "front", widthMm: 1000, heightMm: 500, dimensionToleranceMm: 2 },
    anchors: [
      { id: "a", sourcePx: { x: 0, y: 100 }, targetMm: { x: 0, y: 0 }, uncertaintyPx: 0 },
      { id: "b", sourcePx: { x: 100, y: 100 }, targetMm: { x: 1000, y: 0 }, uncertaintyPx: 0 },
      { id: "c", sourcePx: { x: 100, y: 0 }, targetMm: { x: 1000, y: 500 }, uncertaintyPx: 0 },
      { id: "d", sourcePx: { x: 0, y: 0 }, targetMm: { x: 0, y: 500 }, uncertaintyPx: 0 }
    ],
    thresholds: { inlierErrorPx: 0.5, maxRmsePx: 0.5, minInlierRatio: 1 }
  };
}
