import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { runBlenderJob } from "../src/blenderRunner.js";
import { DefaultCapabilityManifest } from "../src/capabilityManifest.js";
import { buildDigitalViewingAssetBundleManifest, buildDigitalViewingBlenderRenderJob, buildDigitalViewingRenderManifest, DigitalViewingCaptureSchema } from "../src/digitalViewingContracts.js";
import { MeasurementProjectSchema } from "../src/measurementContracts.js";
import { materializeProfiles } from "../src/profileGenerator.js";
import { buildOrthographicViewRegistry } from "../src/viewRegistry.js";
import { evaluateFacadeQaManifest } from "../src/facadeQa.js";
import { hashSourceProject } from "../src/modelLock.js";

const ManifestSchema = z.object({
  schemaVersion: z.literal(1),
  projectId: z.string(),
  template: z.string(),
  productCategory: z.literal("measured-3d-visualization"),
  outputClassification: z.object({
    purpose: z.literal("technical-permit-support"),
    authority: z.literal("locked-blender-orthographic-line-artifacts"),
    visualMode: z.literal("technical-line"),
    photorealismAuthoritative: z.literal(false),
    previewRenderAcceptedAsSourceOfTruth: z.literal(false)
  }).strict(),
  notCad: z.literal(true),
  geometryMutationAllowed: z.literal(false),
  sourceOfTruth: z.object({
    measurements: z.literal("primary"),
    photos: z.literal("non-authoritative-reference-only"),
    blenderGeometry: z.literal("only-renderable-truth"),
    exports: z.literal("formatting-only-no-geometry-reconstruction")
  }).strict(),
  materialEvidence: z.array(z.object({
    facade: z.string(),
    material: z.string(),
    colorNote: z.string(),
    confidence: z.enum(["high", "medium", "low"]),
    source: z.string(),
    verified: z.boolean()
  }).strict()),
  capabilityManifest: z.object({
    schemaVersion: z.literal(1),
    supportedTemplates: z.array(z.string())
  }).passthrough(),
  strategies: z.array(z.string()),
  artifacts: z.record(z.string()),
  modelLock: z.object({ modelHash: z.string() }).passthrough(),
  layout: z.object({
    paper: z.object({ format: z.literal("A3"), orientation: z.literal("landscape"), widthMm: z.number(), heightMm: z.number() }),
    scale: z.string(),
    geometryMutationAllowed: z.literal(false),
    consumes: z.string(),
    markLine: z.object({ role: z.string() }).passthrough(),
    sourceStatement: z.string(),
    includedViews: z.array(z.object({ name: z.string(), sha256: z.string() }).passthrough()),
    measurements: z.array(z.unknown()),
    assumptions: z.array(z.unknown()),
    materialColorNotes: z.array(z.string())
  }).passthrough()
}).passthrough();

const ExportStrategies = ["parametric-profile", "blender-orthographic-camera", "freestyle", "manifest", "pdf-layout", "svg-layout", "png-render"];
const OnePixelPng = pngWithDeclaredDimensions(1, 1);
const OnePixelPngIdentity = {
  sizeBytes: OnePixelPng.byteLength,
  sha256: createHash("sha256").update(OnePixelPng).digest("hex"),
  width: 1,
  height: 1
};
const ConditionDetailPng = pngWithDeclaredDimensions(1024, 1024);
const ConditionDetailPngIdentity = {
  sizeBytes: ConditionDetailPng.byteLength,
  sha256: createHash("sha256").update(ConditionDetailPng).digest("hex"),
  width: 1024,
  height: 1024
};

function withOnePixelTextureIdentity<T extends Record<string, unknown>>(entry: T): T & typeof OnePixelPngIdentity {
  return {
    ...entry,
    ...OnePixelPngIdentity
  };
}

function withDeclaredTextureFileIdentity<T extends { pixelWidth?: number; pixelHeight?: number }>(entry: T): T & { sizeBytes: number; sha256: string; width: number; height: number } {
  const width = entry.pixelWidth ?? 1;
  const height = entry.pixelHeight ?? 1;
  const contents = pngWithDeclaredDimensions(width, height);
  return {
    ...entry,
    sizeBytes: contents.byteLength,
    sha256: createHash("sha256").update(contents).digest("hex"),
    width,
    height
  };
}

function onePixelPhotoIdentity(usage: "material-source" | "surface-mapping" | "appearance-calibration", photoPath: string) {
  return {
    usage,
    path: photoPath,
    ...OnePixelPngIdentity
  };
}

function pngWithDeclaredDimensions(width: number, height: number): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const row = Buffer.alloc(1 + width * 4, 0xff);
  row[0] = 0;
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashGeometry(project: ReturnType<typeof MeasurementProjectSchema.parse>): string {
  const geometryPayload = {
    elements: project.elements.map((element) => ({
      id: element.id,
      kind: element.kind,
      boundsMm: element.boundsMm,
      confidence: element.confidence,
      source: element.source
    })),
    profiles: project.profiles
  };
  return createHash("sha256").update(stableJson(geometryPayload)).digest("hex");
}

async function writeTextureFiles(outputDir: string, texturePaths: string[]): Promise<void> {
  for (const texturePath of texturePaths) {
    const resolvedPath = path.join(outputDir, texturePath);
    await mkdir(path.dirname(resolvedPath), { recursive: true });
    await writeFile(resolvedPath, pngWithDeclaredDimensionsForTexturePath(texturePath));
  }
}

function pngWithDeclaredDimensionsForTexturePath(texturePath: string): Buffer {
  if (texturePath.includes("body-paint") || texturePath.includes("interior-leather")) {
    return pngWithDeclaredDimensions(4096, 4096);
  }
  if (texturePath.includes("tire-rubber") || texturePath.includes("wheel-metal") || texturePath.includes("window-glass")) {
    return pngWithDeclaredDimensions(2048, 2048);
  }
  return OnePixelPng;
}

async function writePhotoFiles(outputDir: string, photoPaths: string[]): Promise<void> {
  for (const photoPath of photoPaths) {
    const resolvedPath = path.join(outputDir, photoPath);
    await mkdir(path.dirname(resolvedPath), { recursive: true });
    await writeFile(
      resolvedPath,
      photoPath.includes("detail") ? pngWithDeclaredDimensions(1024, 1024) : OnePixelPng
    );
  }
}

async function assetFilesFor(outputDir: string, assetPaths: string[]): Promise<Array<{ path: string; sizeBytes: number; sha256: string; width?: number; height?: number }>> {
  return Promise.all(assetPaths.map(async (assetPath) => {
    const resolvedPath = path.join(outputDir, assetPath);
    const file = await readFile(resolvedPath);
    const fileStats = await stat(resolvedPath);
    return {
      path: assetPath,
      sizeBytes: fileStats.size,
      sha256: createHash("sha256").update(file).digest("hex"),
      ...imageDimensions(file)
    };
  }));
}

function imageDimensions(contents: Buffer): { width: number; height: number } | undefined {
  if (contents.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) && contents.length >= 24) {
    return {
      width: contents.readUInt32BE(16),
      height: contents.readUInt32BE(20)
    };
  }
  return undefined;
}

function withOnePixelPhotoAndTextureEvidence(capture: ReturnType<typeof DigitalViewingCaptureSchema.parse>): ReturnType<typeof DigitalViewingCaptureSchema.parse> {
  return DigitalViewingCaptureSchema.parse({
    ...capture,
    photos: capture.photos.map((photo) => ({
      ...photo,
      pixelWidth: photo.captureMetadata?.coverage === "condition-detail" ? 1024 : 1,
      pixelHeight: photo.captureMetadata?.coverage === "condition-detail" ? 1024 : 1
    })),
    materials: capture.materials.map((material) => ({
      ...material,
      textureMaps: material.textureMaps.map((textureMap) => ({
        ...textureMap,
        pixelWidth: 1,
        pixelHeight: 1
      }))
    }))
  });
}

describe("golden manifest integration", () => {
  it("exports a deterministic measured-visualization manifest without mutating project geometry", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "nova-measured-golden-"));
    const fixtureRaw: unknown = JSON.parse(await readFile("fixtures/synthetic-carport-project.json", "utf8"));
    const materializedProject = materializeProfiles(MeasurementProjectSchema.parse(fixtureRaw));
    const project = {
      ...materializedProject,
      modelLock: {
        ...materializedProject.modelLock,
        modelArtifact: "measurement-projects/synthetic-carport/artifacts/synthetic-carport.blend",
        modelHash: "a".repeat(64),
        sourceProjectHash: "b".repeat(64)
      },
      viewRegistry: buildOrthographicViewRegistry(materializedProject.elements, ["plan", "north", "south", "east", "west", "section_a_a"])
    };
    const geometryBefore = hashGeometry(project);
    const template = "gothenburg-permit";

    async function runExport(runId: string) {
      const templateOutputDir = path.join(outputDir, runId, "exports", template);
      const result = await runBlenderJob(
      { outputDir, timeoutMs: 120_000 },
      {
        mode: "measurement_project",
        operation: "export_template",
        project,
        template,
        templateOutputDir,
        options: {
          scale: "1:100",
          views: ["north", "south", "east", "west"],
          viewRegistry: project.viewRegistry,
          lockedModel: project.modelLock,
          capabilityManifest: DefaultCapabilityManifest,
          strategies: ExportStrategies
        }
      },
        path.join(runId, "exports", template, `${project.projectId}-${template}.blend`)
      );

      expect(result.ok, result.stderr).toBe(true);

      const manifestPath = path.join(templateOutputDir, "manifest.json");
      const manifest = ManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")) as unknown);
      expect(path.resolve(manifestPath).startsWith(`${path.resolve(outputDir)}${path.sep}`)).toBe(true);
      return manifest;
    }

    const manifest = await runExport("run-a");
    const repeatedManifest = await runExport("run-b");
    expect(hashGeometry(project)).toBe(geometryBefore);

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      projectId: "synthetic-carport",
      template,
      productCategory: "measured-3d-visualization",
      notCad: true,
      geometryMutationAllowed: false,
      outputClassification: {
        purpose: "technical-permit-support",
        authority: "locked-blender-orthographic-line-artifacts",
        visualMode: "technical-line",
        photorealismAuthoritative: false,
        previewRenderAcceptedAsSourceOfTruth: false
      },
      sourceOfTruth: {
        measurements: "primary",
        photos: "non-authoritative-reference-only",
        blenderGeometry: "only-renderable-truth",
        exports: "formatting-only-no-geometry-reconstruction"
      },
      capabilityManifest: {
        schemaVersion: 1
      },
      strategies: ExportStrategies
    });
    expect(manifest.viewRegistry).toEqual(project.viewRegistry);
    expect(manifest.lineExtraction).toEqual({
      engine: "blender-freestyle",
      cameraSource: "orthographic-view-registry",
      geometrySource: "blender-scene-mesh",
      svgRole: "layout-index-only",
      pdfRole: "layout-only",
      rendererTolerance: { metric: "pixel-difference-ratio", maximum: 0.005 }
    });
    expect(manifest.layout).toMatchObject({
      paper: { format: "A3", orientation: "landscape", widthMm: 420, heightMm: 297 },
      scale: "1:100",
      geometryMutationAllowed: false,
      consumes: "locked-blender-view-artifacts-and-project-metadata-only",
      markLine: { role: "layout-reference-only" },
      sourceStatement: "Measured Blender visualization - not CAD, BIM or survey output"
    });
    expect(manifest.layout.includedViews.map((view: { name: string }) => view.name)).toEqual(["north", "south", "east", "west"]);
    expect(manifest.layout.includedViews.every((view: { sha256: string }) => /^[a-f0-9]{64}$/.test(view.sha256))).toBe(true);
    expect(manifest.layout.measurements).toHaveLength(4);
    expect(manifest.layout.assumptions).toHaveLength(1);
    expect(manifest.layout.materialColorNotes).toContain("Observed/model metadata: white-painted-wood");
    expect(manifest.materialEvidence.map((item: { material: string }) => item.material).sort()).toEqual([
      "dark-roof",
      "dark-stone",
      "driveable-gravel-floor",
      "white-painted-wood"
    ]);
    expect(manifest.materialEvidence.every((item: { source: string; confidence: string; verified: boolean }) =>
      item.source === "photo_reference" && ["low", "medium"].includes(item.confidence) && item.verified
    )).toBe(true);
    const exportOutputDir = path.join(outputDir, "run-a", "exports", template);
    const facadeQa = await evaluateFacadeQaManifest({
      manifest,
      project,
      requiredViews: ["north", "south", "east", "west"],
      exportOutputDir,
      sourceProjectHashBefore: hashSourceProject(project)
    });
    expect(facadeQa).toEqual({ ok: true, blocking: [], visualDiff: { requiredForContract: false, evaluated: false } });
    expect((await evaluateFacadeQaManifest({
      manifest: { ...manifest, modelLock: { ...manifest.modelLock, modelHash: "c".repeat(64) } },
      project,
      requiredViews: ["north", "south", "east", "west"],
      exportOutputDir,
      sourceProjectHashBefore: hashSourceProject(project)
    })).blocking).toContainEqual({
      code: "manifest_model_hash_mismatch",
      message: "Export manifest model hash does not match the reviewed model lock."
    });
    const artifactIdentities = manifest.artifactIdentities as Record<string, unknown>;
    expect(Object.values(artifactIdentities).every((identity: unknown) => {
      const value = identity as { sizeBytes: number; sha256: string; hashScope: string };
      return value.sizeBytes > 0 && /^[a-f0-9]{64}$/.test(value.sha256) && ["complete-file", "png-critical-chunks"].includes(value.hashScope);
    })).toBe(true);
    const svg = await readFile(path.join(outputDir, "run-a", "exports", template, manifest.artifacts.svg), "utf8");
    expect(svg).toContain('"lineExtraction":"blender-freestyle"');
    expect(svg).toContain('"geometryReconstruction":false');
    expect(svg).toContain(`href="${manifest.artifacts.northPng}"`);
    expect(svg).not.toContain("<line");
    const pdf = await readFile(path.join(outputDir, "run-a", "exports", template, manifest.artifacts.pdf), "latin1");
    expect(pdf).toContain("/MediaBox [0 0 1190.55 841.89]");
    expect(pdf).toContain("FASAD NORR / NORTH");
    expect(pdf.match(/\/Subtype \/Image/g)).toHaveLength(4);
    expect(pdf).toContain("MARKLINJE / EXISTING GROUND REFERENCE");
    expect(pdf).toContain("Measured Blender visualization - not CAD, BIM or survey output");
    expect(manifest.capabilityManifest.supportedTemplates).toContain("gothenburg-permit");
    expect(Object.keys(manifest.artifacts)).toEqual([
      "eastPng",
      "facadePng",
      "northPng",
      "pdf",
      "planPng",
      "png",
      "sectionPng",
      "southPng",
      "svg",
      "validation",
      "westPng"
    ]);
    expect(manifest.artifacts).toEqual({
      pdf: "synthetic-carport-gothenburg-permit.pdf",
      svg: "synthetic-carport-gothenburg-permit.svg",
      png: "synthetic-carport-gothenburg-permit.png",
      facadePng: "synthetic-carport-facade.png",
      planPng: "synthetic-carport-plan.png",
      northPng: "synthetic-carport-north.png",
      southPng: "synthetic-carport-south.png",
      eastPng: "synthetic-carport-east.png",
      westPng: "synthetic-carport-west.png",
      sectionPng: "synthetic-carport-section.png",
      validation: "synthetic-carport-gothenburg-permit-validation.json"
    });
    expect(stableJson(repeatedManifest)).toBe(stableJson(manifest));
  }, 180_000);

  it("renders a digital viewing preview from a locked Blender source and render manifest", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "nova-measured-render-"));
    const captureRaw: unknown = JSON.parse(await readFile("fixtures/digital-viewing-vehicle-capture.json", "utf8"));
    const capture = DigitalViewingCaptureSchema.parse(captureRaw);
    const sourceBlendPath = "sources/vehicle-locked.blend";
    const sourceResult = await runBlenderJob(
      { outputDir, timeoutMs: 120_000 },
      {
        mode: "model",
        name: "vehicle-render-smoke",
        primitives: [
          {
            kind: "cube",
            name: "body",
            location: [0, 0, 0.8],
            scale: [2.4, 0.9, 0.45],
            rotation: [0, 0, 0],
            color: "#ffffff"
          },
          {
            kind: "cube",
            name: "front-left-door",
            location: [-0.55, -0.92, 0.8],
            scale: [0.7, 0.04, 0.38],
            rotation: [0, 0, 0],
            color: "#f7f7f2"
          },
          {
            kind: "cube",
            name: "front-seat",
            location: [0.35, -0.1, 1.0],
            scale: [0.32, 0.32, 0.36],
            rotation: [0, 0, 0],
            color: "#1c1c1c"
          },
          {
            kind: "cube",
            name: "wheel-axles",
            location: [0, 0, 0.32],
            scale: [1.65, 0.06, 0.06],
            rotation: [0, 0, 0],
            color: "#151515"
          },
          {
            kind: "cube",
            name: "glazing",
            location: [0.25, -0.02, 1.05],
            scale: [1.1, 0.05, 0.28],
            rotation: [0, 0, 0],
            color: "#dfefff"
          },
          {
            kind: "cube",
            name: "tire-set",
            location: [0, 0, 0.18],
            scale: [1.55, 0.2, 0.2],
            rotation: [0, 0, 0],
            color: "#151515"
          }
        ],
        camera: { location: [4, -5, 3], target: [0, 0, 0.5] }
      },
      sourceBlendPath
    );
    expect(sourceResult.ok, sourceResult.stderr).toBe(true);
    const texturePaths = [
      "textures/body-paint-basecolor.png",
      "textures/body-paint-normal.png",
      "textures/body-paint-roughness.png",
      "textures/interior-leather-normal.png",
      "textures/interior-leather-roughness.png",
      "textures/tire-rubber-normal.png",
      "textures/tire-rubber-roughness.png",
      "textures/wheel-metal-metallic.png",
      "textures/wheel-metal-normal.png",
      "textures/wheel-metal-roughness.png",
      "textures/window-glass-alpha.png",
      "textures/window-glass-roughness.png"
    ];
    const assetPaths = [
      ...capture.photos.map((photo) => photo.path),
      ...texturePaths
    ];
    await writeTextureFiles(outputDir, texturePaths);
    await writePhotoFiles(outputDir, capture.photos.map((photo) => photo.path));

    const renderPreset = {
      presetId: "vehicle-studio-front-smoke",
      renderer: "eevee",
      resolution: { width: 128, height: 96 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 0.5 },
      outputPath: "renders/vehicle-front.png"
    } as const;
    const renderManifest = buildDigitalViewingRenderManifest(capture, renderPreset);
    const assetBundleManifest = buildDigitalViewingAssetBundleManifest(capture, renderManifest, {
      existingFiles: assetPaths,
      assetFiles: await assetFilesFor(outputDir, assetPaths)
    });
    const job = buildDigitalViewingBlenderRenderJob(capture, renderPreset, sourceBlendPath, DefaultCapabilityManifest, assetBundleManifest);
    const renderResult = await runBlenderJob(
      { outputDir, timeoutMs: 120_000 },
      job,
      "renders/vehicle-front-render.blend"
    );
    expect(renderResult.ok, renderResult.stderr).toBe(true);

    const manifest = JSON.parse(await readFile(path.join(outputDir, "renders/vehicle-front.manifest.json"), "utf8")) as {
      notGeometryAuthority: boolean;
      artifacts: {
        render: string;
        manifest: string;
      };
      hashes: {
        captureHash: string;
        geometryHash: string;
        materialConditionHash: string;
        materialAuthoringPlanHash: string;
        presetHash: string;
        manifestHash: string;
      };
      blenderExecution: {
        sourceBlendPath: string;
        outputBlendPath: string;
        materialAuthoring: {
          sourceOfTruth: "derived-from-material-authoring-plan";
          planHash: string;
          ready: boolean;
          blockingCount: number;
          warningCount: number;
        };
        measurementAuthority: {
          sourceOfTruth: "render-manifest-verified-measurements";
          geometryHash: string;
          measurementCount: number;
          appliedMeasurementCount: number;
          geometryMutationAllowed: false;
        };
        hostValidation: { declaredRenderableHosts: string[] };
        measurementApplication: {
          applied: Array<{
            measurementId: string;
            hostElementId: string;
            referenceFrame: string;
            value: number;
            unit: string;
            tolerance?: number;
            sourceOfTruth: string;
          }>;
        };
        materialApplication: {
          applied: Array<{
            object: string;
            materialId: string;
            presetId?: string;
            surfaceMapping?: {
              projection: string;
              faces: string[];
              scaleMm: number;
              rotationDeg: number;
              sourcePhoto?: string;
            };
            appearanceCalibration?: {
              method: string;
              sourcePhoto?: string;
              illuminant?: string;
              confidence: string;
            };
          }>;
          missingHosts: string[];
          textures: {
            applied: Array<{ path: string; type: string; colorSpace: "sRGB" | "Non-Color"; scaleMm?: number; pixelWidth?: number; pixelHeight?: number }>;
            missing: Array<{ path: string; type: string; colorSpace: "sRGB" | "Non-Color"; scaleMm?: number; pixelWidth?: number; pixelHeight?: number }>;
            skipped: Array<{ path: string; type: string; reason: string }>;
          };
        };
        conditionApplication: {
          applied: Array<{
            conditionId: string;
            object: string;
            hostElementId: string;
            face: string;
            surfacePlacement: {
              hostElementId: string;
              face: string;
              u: number;
              v: number;
              widthMm: number;
              heightMm: number;
              rotationDeg: number;
            };
          }>;
        };
        camera: { cameraName: string; sector: string; mode: string };
        lighting: { lights: string[]; environment: string };
        renderArtifact: {
          path: string;
          sizeBytes: number;
          sha256: string;
        };
        renderQuality: {
          viewTransform: string;
          look: string;
          exposure: number;
          gamma: number;
        };
        assetBundle: {
          manifestType: string;
          ready: boolean;
          assetBundleHash: string;
          requiredCount: number;
          missingCount: number;
          verifiedContentCount: number;
        };
      };
    };
    expect(manifest.notGeometryAuthority).toBe(true);
    expect(manifest.artifacts).toEqual({
      render: "renders/vehicle-front.png",
      manifest: "renders/vehicle-front.manifest.json"
    });
    expect(Object.values(manifest.hashes)).toHaveLength(6);
    expect(Object.values(manifest.hashes).every((hash) => /^[a-f0-9]{64}$/.test(hash))).toBe(true);
    expect(manifest.blenderExecution.sourceBlendPath).toBe(sourceBlendPath);
    expect(path.resolve(manifest.blenderExecution.outputBlendPath).startsWith(`${path.resolve(outputDir)}${path.sep}`)).toBe(true);
    expect(manifest.blenderExecution.materialAuthoring).toEqual({
      sourceOfTruth: "derived-from-material-authoring-plan",
      planHash: manifest.hashes.materialAuthoringPlanHash,
      ready: true,
      blockingCount: 0,
      warningCount: 0
    });
    expect(manifest.blenderExecution.measurementAuthority).toEqual({
      sourceOfTruth: "render-manifest-verified-measurements",
      geometryHash: manifest.hashes.geometryHash,
      measurementCount: capture.measurements.length,
      appliedMeasurementCount: capture.measurements.length,
      geometryMutationAllowed: false
    });
    expect(manifest.blenderExecution.hostValidation.declaredRenderableHosts).toEqual(["body", "front-left-door", "front-seat", "glazing", "tire-set", "wheel-axles"]);
    expect(manifest.blenderExecution.measurementApplication.applied).toEqual(
      capture.measurements
        .slice()
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((measurement) => ({
          measurementId: measurement.id,
          hostElementId: measurement.placement?.hostElementId,
          referenceFrame: measurement.placement?.referenceFrame ?? "asset-local",
          value: measurement.value,
          unit: measurement.unit,
          tolerance: measurement.tolerance,
          sourceOfTruth: "declared-measurement-value-used-by-blender"
        }))
    );
    expect(manifest.blenderExecution.materialApplication.applied).toContainEqual({
      object: "body",
      materialId: "body-paint",
      presetId: "automotive-white-paint",
      pbr: {
        baseColor: "#f7f7f2",
        roughness: 0.38,
        metallic: 0,
        specular: 0.55,
        transmission: 0,
        normalSource: "photo",
        textureScaleMm: 1200
      },
      pbrReadback: {
        sourceOfTruth: "read-from-blender-material-node-values-after-application",
        fields: ["baseColor", "metallic", "normalSource", "roughness", "specular", "textureScaleMm", "transmission"],
        values: {
          baseColor: "#f7f7f2",
          roughness: 0.38,
          metallic: 0,
          specular: 0.55,
          transmission: 0,
          normalSource: "photo",
          textureScaleMm: 1200
        }
      },
      sourcePhotoIdentities: [
        onePixelPhotoIdentity("material-source", "photos/left.jpg"),
        onePixelPhotoIdentity("material-source", "photos/right.jpg"),
        onePixelPhotoIdentity("surface-mapping", "photos/left.jpg"),
        onePixelPhotoIdentity("appearance-calibration", "photos/left.jpg")
      ],
      surfaceMapping: {
        projection: "box",
        faces: ["front", "rear", "left", "right", "top"],
        scaleMm: 1200,
        rotationDeg: 0,
        sourcePhoto: "photos/left.jpg"
      },
      appearanceCalibration: {
        method: "white-balance-reference",
        sourcePhoto: "photos/left.jpg",
        illuminant: "daylight",
        confidence: "medium"
      }
    });
    expect(manifest.blenderExecution.materialApplication.applied).toContainEqual({
      object: "front-seat",
      materialId: "interior-leather",
      presetId: "black-leather",
      pbr: {
        baseColor: "#1c1c1c",
        roughness: 0.62,
        metallic: 0,
        specular: 0.35,
        transmission: 0,
        normalSource: "photo",
        textureScaleMm: 450
      },
      pbrReadback: {
        sourceOfTruth: "read-from-blender-material-node-values-after-application",
        fields: ["baseColor", "metallic", "normalSource", "roughness", "specular", "textureScaleMm", "transmission"],
        values: {
          baseColor: "#1c1c1c",
          roughness: 0.62,
          metallic: 0,
          specular: 0.35,
          transmission: 0,
          normalSource: "photo",
          textureScaleMm: 450
        }
      },
      sourcePhotoIdentities: [
        onePixelPhotoIdentity("material-source", "photos/interior.jpg"),
        onePixelPhotoIdentity("surface-mapping", "photos/interior.jpg"),
        onePixelPhotoIdentity("appearance-calibration", "photos/interior.jpg")
      ],
      surfaceMapping: {
        projection: "uv",
        faces: ["front", "top"],
        scaleMm: 450,
        rotationDeg: 0,
        sourcePhoto: "photos/interior.jpg"
      },
      appearanceCalibration: {
        method: "white-balance-reference",
        sourcePhoto: "photos/interior.jpg",
        illuminant: "studio",
        confidence: "medium"
      }
    });
    expect(manifest.blenderExecution.materialApplication.missingHosts).toEqual([]);
    expect(manifest.blenderExecution.materialApplication.textures.applied).toEqual([
      { path: "textures/body-paint-basecolor.png", type: "baseColor", colorSpace: "sRGB", scaleMm: 1200, pixelWidth: 4096, pixelHeight: 4096 },
      { path: "textures/body-paint-normal.png", type: "normal", colorSpace: "Non-Color", scaleMm: 1200, pixelWidth: 4096, pixelHeight: 4096 },
      { path: "textures/body-paint-roughness.png", type: "roughness", colorSpace: "Non-Color", scaleMm: 1200, pixelWidth: 4096, pixelHeight: 4096 },
      { path: "textures/interior-leather-normal.png", type: "normal", colorSpace: "Non-Color", scaleMm: 450, pixelWidth: 4096, pixelHeight: 4096 },
      { path: "textures/interior-leather-roughness.png", type: "roughness", colorSpace: "Non-Color", scaleMm: 450, pixelWidth: 4096, pixelHeight: 4096 },
      { path: "textures/tire-rubber-normal.png", type: "normal", colorSpace: "Non-Color", scaleMm: 280, pixelWidth: 2048, pixelHeight: 2048 },
      { path: "textures/tire-rubber-roughness.png", type: "roughness", colorSpace: "Non-Color", scaleMm: 280, pixelWidth: 2048, pixelHeight: 2048 },
      { path: "textures/wheel-metal-metallic.png", type: "metallic", colorSpace: "Non-Color", scaleMm: 300, pixelWidth: 2048, pixelHeight: 2048 },
      { path: "textures/wheel-metal-normal.png", type: "normal", colorSpace: "Non-Color", scaleMm: 300, pixelWidth: 2048, pixelHeight: 2048 },
      { path: "textures/wheel-metal-roughness.png", type: "roughness", colorSpace: "Non-Color", scaleMm: 300, pixelWidth: 2048, pixelHeight: 2048 },
      { path: "textures/window-glass-alpha.png", type: "alpha", colorSpace: "Non-Color", scaleMm: 1000, pixelWidth: 2048, pixelHeight: 2048 },
      { path: "textures/window-glass-roughness.png", type: "roughness", colorSpace: "Non-Color", scaleMm: 1000, pixelWidth: 2048, pixelHeight: 2048 }
    ].map(withDeclaredTextureFileIdentity));
    expect(manifest.blenderExecution.materialApplication.textures.missing).toEqual([]);
    expect(manifest.blenderExecution.materialApplication.textures.skipped).toEqual([]);
    expect(manifest.blenderExecution.conditionApplication.applied).toContainEqual({
      conditionId: "front-left-scratch",
      object: "condition-front-left-scratch",
      hostElementId: "body",
      face: "front",
      sourcePhotoIdentities: [
        { usage: "condition-source", path: "photos/detail-scratch.jpg", ...ConditionDetailPngIdentity }
      ],
      surfacePlacement: {
        hostElementId: "body",
        face: "front",
        u: 0.32,
        v: 0.42,
        widthMm: 420,
        heightMm: 24,
        rotationDeg: -8
      },
      visibilityProof: {
        sourceOfTruth: "created-visible-blender-overlay-object",
        objectName: "condition-front-left-scratch",
        materialName: "condition-front-left-scratch",
        visibleInRender: true,
        dimensionsMm: {
          widthMm: 420,
          heightMm: 24
        },
        materialReadback: {
          sourceOfTruth: "read-from-blender-condition-material-after-application",
          baseColor: "#2d2d2d",
          alpha: 1,
          roughness: 0.82,
          metallic: 0,
          conditionType: "scratch",
          severity: "medium"
        }
      }
    });
    expect(manifest.blenderExecution.camera).toEqual({
      cameraName: "Measured_Render_front",
      sector: "front",
      mode: "perspective"
    });
    expect(manifest.blenderExecution.lighting).toEqual({
      lights: ["Measured_Render_Key_Area", "Measured_Render_Fill_Area"],
      environment: "studio"
    });
    expect(manifest.blenderExecution.renderQuality).toMatchObject({
      viewTransform: "Filmic",
      look: "Medium High Contrast",
      exposure: 0,
      gamma: 1
    });
    const renderFile = await readFile(path.join(outputDir, "renders/vehicle-front.png"));
    const renderStats = await stat(path.join(outputDir, "renders/vehicle-front.png"));
    expect(manifest.blenderExecution.renderArtifact).toEqual({
      path: "renders/vehicle-front.png",
      sizeBytes: renderStats.size,
      sha256: createHash("sha256").update(renderFile).digest("hex"),
      width: 128,
      height: 96
    });
    expect((manifest.blenderExecution as typeof manifest.blenderExecution & { referenceComparison: unknown }).referenceComparison).toEqual({
      renderPath: "renders/vehicle-front.png",
      method: "reference-metadata-alignment",
      score: 1,
      threshold: 1
    });
    expect(manifest.blenderExecution.assetBundle).toEqual({
      manifestType: "digital-viewing-asset-bundle",
      ready: true,
      assetBundleHash: assetBundleManifest.hashes.assetBundleHash,
      requiredCount: assetBundleManifest.summary.requiredCount,
      missingCount: 0,
      verifiedContentCount: assetBundleManifest.assets.filter((asset) => asset.status === "present" && ["photo", "texture"].includes(asset.assetType)).length
    });
    expect((await stat(path.join(outputDir, "renders/vehicle-front.png"))).isFile()).toBe(true);
    expect((await stat(path.join(outputDir, "renders/vehicle-front.manifest.json"))).isFile()).toBe(true);
    expect((await stat(path.join(outputDir, "renders/vehicle-front-render.blend"))).isFile()).toBe(true);
  }, 180_000);

  it("refuses digital viewing render when the locked Blender source lacks declared renderable hosts", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "nova-measured-render-hosts-"));
    const captureRaw: unknown = JSON.parse(await readFile("fixtures/digital-viewing-vehicle-capture.json", "utf8"));
    const capture = DigitalViewingCaptureSchema.parse(captureRaw);
    const sourceBlendPath = "sources/vehicle-incomplete.blend";
    const sourceResult = await runBlenderJob(
      { outputDir, timeoutMs: 120_000 },
      {
        mode: "model",
        name: "vehicle-render-incomplete-hosts",
        primitives: [{
          kind: "cube",
          name: "body",
          location: [0, 0, 0.8],
          scale: [2.4, 0.9, 0.45],
          rotation: [0, 0, 0],
          color: "#ffffff"
        }],
        camera: { location: [4, -5, 3], target: [0, 0, 0.5] }
      },
      sourceBlendPath
    );
    expect(sourceResult.ok, sourceResult.stderr).toBe(true);
    const texturePaths = [
      "textures/body-paint-basecolor.png",
      "textures/body-paint-normal.png",
      "textures/body-paint-roughness.png",
      "textures/interior-leather-normal.png",
      "textures/interior-leather-roughness.png",
      "textures/tire-rubber-normal.png",
      "textures/tire-rubber-roughness.png",
      "textures/wheel-metal-metallic.png",
      "textures/wheel-metal-normal.png",
      "textures/wheel-metal-roughness.png",
      "textures/window-glass-alpha.png",
      "textures/window-glass-roughness.png"
    ];
    const assetPaths = [
      ...capture.photos.map((photo) => photo.path),
      ...texturePaths
    ];
    await writeTextureFiles(outputDir, texturePaths);
    await writePhotoFiles(outputDir, capture.photos.map((photo) => photo.path));

    const renderPreset = {
      presetId: "vehicle-studio-front-host-validation",
      renderer: "eevee",
      resolution: { width: 128, height: 96 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 0.5 },
      outputPath: "renders/vehicle-front.png"
    } as const;
    const renderManifest = buildDigitalViewingRenderManifest(capture, renderPreset);
    const assetBundleManifest = buildDigitalViewingAssetBundleManifest(capture, renderManifest, {
      existingFiles: assetPaths,
      assetFiles: await assetFilesFor(outputDir, assetPaths)
    });
    const job = buildDigitalViewingBlenderRenderJob(capture, renderPreset, sourceBlendPath, DefaultCapabilityManifest, assetBundleManifest);
    const renderResult = await runBlenderJob(
      { outputDir, timeoutMs: 120_000 },
      job,
      "renders/vehicle-front-render.blend"
    );

    expect(renderResult.ok).toBe(false);
    expect(renderResult.stderr).toContain("Locked Blender scene is missing declared renderable model elements: front-left-door, front-seat, glazing, tire-set, wheel-axles");
  }, 180_000);

  it("refuses digital viewing render jobs whose measurement anchors reference missing Blender hosts", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "nova-measured-render-measurement-hosts-"));
    const captureRaw: unknown = JSON.parse(await readFile("fixtures/digital-viewing-vehicle-capture.json", "utf8"));
    const capture = DigitalViewingCaptureSchema.parse(captureRaw);
    const sourceBlendPath = "sources/vehicle-measurement-hosts.blend";
    const sourceResult = await runBlenderJob(
      { outputDir, timeoutMs: 120_000 },
      {
        mode: "model",
        name: "vehicle-render-measurement-hosts",
        primitives: [
          { kind: "cube", name: "body", location: [0, 0, 0.8], scale: [2.4, 0.9, 0.45], rotation: [0, 0, 0], color: "#ffffff" },
          { kind: "cube", name: "front-left-door", location: [-0.55, -0.92, 0.8], scale: [0.7, 0.04, 0.38], rotation: [0, 0, 0], color: "#f7f7f2" },
          { kind: "cube", name: "front-seat", location: [0.35, -0.1, 1.0], scale: [0.32, 0.32, 0.36], rotation: [0, 0, 0], color: "#1c1c1c" },
          { kind: "cube", name: "wheel-axles", location: [0, 0, 0.32], scale: [1.65, 0.06, 0.06], rotation: [0, 0, 0], color: "#151515" },
          { kind: "cube", name: "glazing", location: [0.25, -0.02, 1.05], scale: [1.1, 0.05, 0.28], rotation: [0, 0, 0], color: "#dfefff" },
          { kind: "cube", name: "tire-set", location: [0, 0, 0.18], scale: [1.55, 0.2, 0.2], rotation: [0, 0, 0], color: "#151515" }
        ],
        camera: { location: [4, -5, 3], target: [0, 0, 0.5] }
      },
      sourceBlendPath
    );
    expect(sourceResult.ok, sourceResult.stderr).toBe(true);
    const texturePaths = [
      "textures/body-paint-basecolor.png",
      "textures/body-paint-normal.png",
      "textures/body-paint-roughness.png",
      "textures/interior-leather-normal.png",
      "textures/interior-leather-roughness.png",
      "textures/tire-rubber-normal.png",
      "textures/tire-rubber-roughness.png",
      "textures/wheel-metal-metallic.png",
      "textures/wheel-metal-normal.png",
      "textures/wheel-metal-roughness.png",
      "textures/window-glass-alpha.png",
      "textures/window-glass-roughness.png"
    ];
    const assetPaths = [
      ...capture.photos.map((photo) => photo.path),
      ...texturePaths
    ];
    await writeTextureFiles(outputDir, texturePaths);
    await writePhotoFiles(outputDir, capture.photos.map((photo) => photo.path));

    const renderPreset = {
      presetId: "vehicle-studio-front-missing-measurement-host",
      renderer: "eevee",
      resolution: { width: 128, height: 96 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 0.5 },
      outputPath: "renders/vehicle-front.png"
    } as const;
    const renderManifest = buildDigitalViewingRenderManifest(capture, renderPreset);
    const assetBundleManifest = buildDigitalViewingAssetBundleManifest(capture, renderManifest, {
      existingFiles: assetPaths,
      assetFiles: await assetFilesFor(outputDir, assetPaths)
    });
    const job = buildDigitalViewingBlenderRenderJob(capture, renderPreset, sourceBlendPath, DefaultCapabilityManifest, assetBundleManifest);
    const jobWithMissingMeasurementHost = {
      ...job,
      renderManifest: {
        ...job.renderManifest,
        measurementAnchors: [
          ...job.renderManifest.measurementAnchors,
          {
            measurementId: "forged-measurement-anchor",
            hostElementId: "missing-measurement-host",
            referenceFrame: "asset-local",
            axis: "x",
            value: 1,
            unit: "mm",
            tolerance: 1,
            sourceOfTruth: "declared-measurement-value-used-by-blender"
          }
        ]
      }
    };

    const renderResult = await runBlenderJob(
      { outputDir, timeoutMs: 120_000 },
      jobWithMissingMeasurementHost,
      "renders/vehicle-front-render.blend"
    );

    expect(renderResult.ok).toBe(false);
    expect(renderResult.stderr).toContain("Measurement anchors reference missing Blender host objects: missing-measurement-host");
  }, 180_000);

  it("refuses digital viewing render jobs whose materials reference missing Blender hosts", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "nova-measured-render-material-hosts-"));
    const captureRaw: unknown = JSON.parse(await readFile("fixtures/digital-viewing-vehicle-capture.json", "utf8"));
    const capture = DigitalViewingCaptureSchema.parse(captureRaw);
    const sourceBlendPath = "sources/vehicle-material-hosts.blend";
    const sourceResult = await runBlenderJob(
      { outputDir, timeoutMs: 120_000 },
      {
        mode: "model",
        name: "vehicle-render-material-hosts",
        primitives: [
          { kind: "cube", name: "body", location: [0, 0, 0.8], scale: [2.4, 0.9, 0.45], rotation: [0, 0, 0], color: "#ffffff" },
          { kind: "cube", name: "front-left-door", location: [-0.55, -0.92, 0.8], scale: [0.7, 0.04, 0.38], rotation: [0, 0, 0], color: "#f7f7f2" },
          { kind: "cube", name: "front-seat", location: [0.35, -0.1, 1.0], scale: [0.32, 0.32, 0.36], rotation: [0, 0, 0], color: "#1c1c1c" },
          { kind: "cube", name: "wheel-axles", location: [0, 0, 0.32], scale: [1.65, 0.06, 0.06], rotation: [0, 0, 0], color: "#151515" },
          { kind: "cube", name: "glazing", location: [0.25, -0.02, 1.05], scale: [1.1, 0.05, 0.28], rotation: [0, 0, 0], color: "#dfefff" },
          { kind: "cube", name: "tire-set", location: [0, 0, 0.18], scale: [1.55, 0.2, 0.2], rotation: [0, 0, 0], color: "#151515" }
        ],
        camera: { location: [4, -5, 3], target: [0, 0, 0.5] }
      },
      sourceBlendPath
    );
    expect(sourceResult.ok, sourceResult.stderr).toBe(true);
    const texturePaths = [
      "textures/body-paint-basecolor.png",
      "textures/body-paint-normal.png",
      "textures/body-paint-roughness.png",
      "textures/interior-leather-normal.png",
      "textures/interior-leather-roughness.png",
      "textures/tire-rubber-normal.png",
      "textures/tire-rubber-roughness.png",
      "textures/wheel-metal-metallic.png",
      "textures/wheel-metal-normal.png",
      "textures/wheel-metal-roughness.png",
      "textures/window-glass-alpha.png",
      "textures/window-glass-roughness.png"
    ];
    const assetPaths = [
      ...capture.photos.map((photo) => photo.path),
      ...texturePaths
    ];
    await writeTextureFiles(outputDir, texturePaths);
    await writePhotoFiles(outputDir, capture.photos.map((photo) => photo.path));

    const renderPreset = {
      presetId: "vehicle-studio-front-missing-material-host",
      renderer: "eevee",
      resolution: { width: 128, height: 96 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 0.5 },
      outputPath: "renders/vehicle-front.png"
    } as const;
    const renderManifest = buildDigitalViewingRenderManifest(capture, renderPreset);
    const assetBundleManifest = buildDigitalViewingAssetBundleManifest(capture, renderManifest, {
      existingFiles: assetPaths,
      assetFiles: await assetFilesFor(outputDir, assetPaths)
    });
    const job = buildDigitalViewingBlenderRenderJob(capture, renderPreset, sourceBlendPath, DefaultCapabilityManifest, assetBundleManifest);
    const jobWithMissingMaterialHost = {
      ...job,
      renderManifest: {
        ...job.renderManifest,
        materials: [
          ...job.renderManifest.materials,
          {
            materialId: "forged-missing-host-material",
            hostElementId: "missing-material-host",
            presetId: "painted-surface",
            confidence: "medium",
            provenance: "manual",
            pbr: {
              baseColor: "#ffffff",
              roughness: 0.5,
              metallic: 0,
              specular: 0.2,
              transmission: 0
            }
          }
        ]
      }
    };

    const renderResult = await runBlenderJob(
      { outputDir, timeoutMs: 120_000 },
      jobWithMissingMaterialHost,
      "renders/vehicle-front-render.blend"
    );

    expect(renderResult.ok).toBe(false);
    expect(renderResult.stderr).toContain("Materials reference missing Blender host objects: missing-material-host");
  }, 180_000);

  it("refuses digital viewing render jobs whose condition overlays reference missing Blender hosts", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "nova-measured-render-condition-hosts-"));
    const captureRaw: unknown = JSON.parse(await readFile("fixtures/digital-viewing-vehicle-capture.json", "utf8"));
    const capture = DigitalViewingCaptureSchema.parse(captureRaw);
    const sourceBlendPath = "sources/vehicle-condition-hosts.blend";
    const sourceResult = await runBlenderJob(
      { outputDir, timeoutMs: 120_000 },
      {
        mode: "model",
        name: "vehicle-render-condition-hosts",
        primitives: [
          { kind: "cube", name: "body", location: [0, 0, 0.8], scale: [2.4, 0.9, 0.45], rotation: [0, 0, 0], color: "#ffffff" },
          { kind: "cube", name: "front-left-door", location: [-0.55, -0.92, 0.8], scale: [0.7, 0.04, 0.38], rotation: [0, 0, 0], color: "#f7f7f2" },
          { kind: "cube", name: "front-seat", location: [0.35, -0.1, 1.0], scale: [0.32, 0.32, 0.36], rotation: [0, 0, 0], color: "#1c1c1c" },
          { kind: "cube", name: "wheel-axles", location: [0, 0, 0.32], scale: [1.65, 0.06, 0.06], rotation: [0, 0, 0], color: "#151515" },
          { kind: "cube", name: "glazing", location: [0.25, -0.02, 1.05], scale: [1.1, 0.05, 0.28], rotation: [0, 0, 0], color: "#dfefff" },
          { kind: "cube", name: "tire-set", location: [0, 0, 0.18], scale: [1.55, 0.2, 0.2], rotation: [0, 0, 0], color: "#151515" }
        ],
        camera: { location: [4, -5, 3], target: [0, 0, 0.5] }
      },
      sourceBlendPath
    );
    expect(sourceResult.ok, sourceResult.stderr).toBe(true);
    const texturePaths = [
      "textures/body-paint-basecolor.png",
      "textures/body-paint-normal.png",
      "textures/body-paint-roughness.png",
      "textures/interior-leather-normal.png",
      "textures/interior-leather-roughness.png",
      "textures/tire-rubber-normal.png",
      "textures/tire-rubber-roughness.png",
      "textures/wheel-metal-metallic.png",
      "textures/wheel-metal-normal.png",
      "textures/wheel-metal-roughness.png",
      "textures/window-glass-alpha.png",
      "textures/window-glass-roughness.png"
    ];
    const assetPaths = [
      ...capture.photos.map((photo) => photo.path),
      ...texturePaths
    ];
    await writeTextureFiles(outputDir, texturePaths);
    await writePhotoFiles(outputDir, capture.photos.map((photo) => photo.path));

    const renderPreset = {
      presetId: "vehicle-studio-front-missing-condition-host",
      renderer: "eevee",
      resolution: { width: 128, height: 96 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 0.5 },
      outputPath: "renders/vehicle-front.png"
    } as const;
    const renderManifest = buildDigitalViewingRenderManifest(capture, renderPreset);
    const assetBundleManifest = buildDigitalViewingAssetBundleManifest(capture, renderManifest, {
      existingFiles: assetPaths,
      assetFiles: await assetFilesFor(outputDir, assetPaths)
    });
    const job = buildDigitalViewingBlenderRenderJob(capture, renderPreset, sourceBlendPath, DefaultCapabilityManifest, assetBundleManifest);
    const jobWithMissingConditionHost = {
      ...job,
      renderManifest: {
        ...job.renderManifest,
        conditions: [
          ...job.renderManifest.conditions,
          {
            id: "forged-missing-host-condition",
            type: "scratch",
            severity: "low",
            confidence: "medium",
            source: "manual",
            color: "#b0b0a8",
            alpha: 1,
            roughness: 0.82,
            metallic: 0,
            surfacePlacement: {
              hostElementId: "missing-condition-host",
              face: "front",
              u: 0.5,
              v: 0.5,
              widthMm: 100,
              heightMm: 20,
              rotationDeg: 0
            }
          }
        ]
      }
    };

    const renderResult = await runBlenderJob(
      { outputDir, timeoutMs: 120_000 },
      jobWithMissingConditionHost,
      "renders/vehicle-front-render.blend"
    );

    expect(renderResult.ok).toBe(false);
    expect(renderResult.stderr).toContain("Condition overlays reference missing Blender host objects: missing-condition-host");
  }, 180_000);

  it("refuses digital viewing render jobs whose lighting reference photo is missing", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "nova-measured-render-lighting-reference-"));
    const captureRaw: unknown = JSON.parse(await readFile("fixtures/digital-viewing-vehicle-capture.json", "utf8"));
    const capture = DigitalViewingCaptureSchema.parse(captureRaw);
    const sourceBlendPath = "sources/vehicle-lighting-reference.blend";
    const sourceResult = await runBlenderJob(
      { outputDir, timeoutMs: 120_000 },
      {
        mode: "model",
        name: "vehicle-render-lighting-reference",
        primitives: [
          { kind: "cube", name: "body", location: [0, 0, 0.8], scale: [2.4, 0.9, 0.45], rotation: [0, 0, 0], color: "#ffffff" },
          { kind: "cube", name: "front-left-door", location: [-0.55, -0.92, 0.8], scale: [0.7, 0.04, 0.38], rotation: [0, 0, 0], color: "#f7f7f2" },
          { kind: "cube", name: "front-seat", location: [0.35, -0.1, 1.0], scale: [0.32, 0.32, 0.36], rotation: [0, 0, 0], color: "#1c1c1c" },
          { kind: "cube", name: "wheel-axles", location: [0, 0, 0.32], scale: [1.65, 0.06, 0.06], rotation: [0, 0, 0], color: "#151515" },
          { kind: "cube", name: "glazing", location: [0.25, -0.02, 1.05], scale: [1.1, 0.05, 0.28], rotation: [0, 0, 0], color: "#dfefff" },
          { kind: "cube", name: "tire-set", location: [0, 0, 0.18], scale: [1.55, 0.2, 0.2], rotation: [0, 0, 0], color: "#151515" }
        ],
        camera: { location: [4, -5, 3], target: [0, 0, 0.5] }
      },
      sourceBlendPath
    );
    expect(sourceResult.ok, sourceResult.stderr).toBe(true);
    const texturePaths = [
      "textures/body-paint-basecolor.png",
      "textures/body-paint-normal.png",
      "textures/body-paint-roughness.png",
      "textures/interior-leather-normal.png",
      "textures/interior-leather-roughness.png",
      "textures/tire-rubber-normal.png",
      "textures/tire-rubber-roughness.png",
      "textures/wheel-metal-metallic.png",
      "textures/wheel-metal-normal.png",
      "textures/wheel-metal-roughness.png",
      "textures/window-glass-alpha.png",
      "textures/window-glass-roughness.png"
    ];
    const assetPaths = [
      ...capture.photos.map((photo) => photo.path),
      ...texturePaths
    ];
    await writeTextureFiles(outputDir, texturePaths);
    await writePhotoFiles(outputDir, capture.photos.map((photo) => photo.path));

    const renderPreset = {
      presetId: "vehicle-studio-front-missing-lighting-reference",
      renderer: "eevee",
      resolution: { width: 128, height: 96 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 0.5 },
      outputPath: "renders/vehicle-front.png"
    } as const;
    const renderManifest = buildDigitalViewingRenderManifest(capture, renderPreset);
    const assetBundleManifest = buildDigitalViewingAssetBundleManifest(capture, renderManifest, {
      existingFiles: assetPaths,
      assetFiles: await assetFilesFor(outputDir, assetPaths)
    });
    const job = buildDigitalViewingBlenderRenderJob(capture, renderPreset, sourceBlendPath, DefaultCapabilityManifest, assetBundleManifest);
    const jobWithMissingLightingReference = {
      ...job,
      renderManifest: {
        ...job.renderManifest,
        renderPreset: {
          ...job.renderManifest.renderPreset,
          lighting: {
            ...job.renderManifest.renderPreset.lighting,
            referencePhoto: "photos/missing-lighting-reference.jpg"
          }
        }
      }
    };

    const renderResult = await runBlenderJob(
      { outputDir, timeoutMs: 120_000 },
      jobWithMissingLightingReference,
      "renders/vehicle-front-render.blend"
    );

    expect(renderResult.ok).toBe(false);
    expect(renderResult.stderr).toContain("Render reference photo missing: lighting referencePhoto photos/missing-lighting-reference.jpg");
  }, 180_000);

  it("refuses digital viewing render jobs whose reference photo is not declared in the asset bundle", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "nova-measured-render-undeclared-reference-"));
    const captureRaw: unknown = JSON.parse(await readFile("fixtures/digital-viewing-vehicle-capture.json", "utf8"));
    const capture = DigitalViewingCaptureSchema.parse(captureRaw);
    const sourceBlendPath = "sources/vehicle-undeclared-reference.blend";
    const sourceResult = await runBlenderJob(
      { outputDir, timeoutMs: 120_000 },
      {
        mode: "model",
        name: "vehicle-render-undeclared-reference",
        primitives: [
          { kind: "cube", name: "body", location: [0, 0, 0.8], scale: [2.4, 0.9, 0.45], rotation: [0, 0, 0], color: "#ffffff" },
          { kind: "cube", name: "front-left-door", location: [-0.55, -0.92, 0.8], scale: [0.7, 0.04, 0.38], rotation: [0, 0, 0], color: "#f7f7f2" },
          { kind: "cube", name: "front-seat", location: [0.35, -0.1, 1.0], scale: [0.32, 0.32, 0.36], rotation: [0, 0, 0], color: "#1c1c1c" },
          { kind: "cube", name: "wheel-axles", location: [0, 0, 0.32], scale: [1.65, 0.06, 0.06], rotation: [0, 0, 0], color: "#151515" },
          { kind: "cube", name: "glazing", location: [0.25, -0.02, 1.05], scale: [1.1, 0.05, 0.28], rotation: [0, 0, 0], color: "#dfefff" },
          { kind: "cube", name: "tire-set", location: [0, 0, 0.18], scale: [1.55, 0.2, 0.2], rotation: [0, 0, 0], color: "#151515" }
        ],
        camera: { location: [4, -5, 3], target: [0, 0, 0.5] }
      },
      sourceBlendPath
    );
    expect(sourceResult.ok, sourceResult.stderr).toBe(true);
    const texturePaths = [
      "textures/body-paint-basecolor.png",
      "textures/body-paint-normal.png",
      "textures/body-paint-roughness.png",
      "textures/interior-leather-normal.png",
      "textures/interior-leather-roughness.png",
      "textures/tire-rubber-normal.png",
      "textures/tire-rubber-roughness.png",
      "textures/wheel-metal-metallic.png",
      "textures/wheel-metal-normal.png",
      "textures/wheel-metal-roughness.png",
      "textures/window-glass-alpha.png",
      "textures/window-glass-roughness.png"
    ];
    const assetPaths = [
      ...capture.photos.map((photo) => photo.path),
      ...texturePaths
    ];
    await writeTextureFiles(outputDir, texturePaths);
    await writePhotoFiles(outputDir, [...capture.photos.map((photo) => photo.path), "photos/undeclared-lighting-reference.jpg"]);

    const renderPreset = {
      presetId: "vehicle-studio-front-undeclared-reference",
      renderer: "eevee",
      resolution: { width: 128, height: 96 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 0.5 },
      outputPath: "renders/vehicle-front.png"
    } as const;
    const renderManifest = buildDigitalViewingRenderManifest(capture, renderPreset);
    const assetBundleManifest = buildDigitalViewingAssetBundleManifest(capture, renderManifest, {
      existingFiles: assetPaths,
      assetFiles: await assetFilesFor(outputDir, assetPaths)
    });
    const job = buildDigitalViewingBlenderRenderJob(capture, renderPreset, sourceBlendPath, DefaultCapabilityManifest, assetBundleManifest);
    const jobWithUndeclaredReferencePhoto = {
      ...job,
      renderManifest: {
        ...job.renderManifest,
        renderPreset: {
          ...job.renderManifest.renderPreset,
          lighting: {
            ...job.renderManifest.renderPreset.lighting,
            referencePhoto: "photos/undeclared-lighting-reference.jpg"
          }
        }
      }
    };

    const renderResult = await runBlenderJob(
      { outputDir, timeoutMs: 120_000 },
      jobWithUndeclaredReferencePhoto,
      "renders/vehicle-front-render.blend"
    );

    expect(renderResult.ok).toBe(false);
    expect(renderResult.stderr).toContain("Render reference photo is not declared in asset bundle: lighting referencePhoto photos/undeclared-lighting-reference.jpg");
  }, 180_000);

  it("refuses digital viewing render jobs whose material source photos are not declared in the asset bundle", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "nova-measured-render-material-source-photo-"));
    const captureRaw: unknown = JSON.parse(await readFile("fixtures/digital-viewing-vehicle-capture.json", "utf8"));
    const capture = DigitalViewingCaptureSchema.parse(captureRaw);
    const sourceBlendPath = "sources/vehicle-material-source-photo.blend";
    const sourceResult = await runBlenderJob(
      { outputDir, timeoutMs: 120_000 },
      {
        mode: "model",
        name: "vehicle-render-material-source-photo",
        primitives: [
          { kind: "cube", name: "body", location: [0, 0, 0.8], scale: [2.4, 0.9, 0.45], rotation: [0, 0, 0], color: "#ffffff" },
          { kind: "cube", name: "front-left-door", location: [-0.55, -0.92, 0.8], scale: [0.7, 0.04, 0.38], rotation: [0, 0, 0], color: "#f7f7f2" },
          { kind: "cube", name: "front-seat", location: [0.35, -0.1, 1.0], scale: [0.32, 0.32, 0.36], rotation: [0, 0, 0], color: "#1c1c1c" },
          { kind: "cube", name: "wheel-axles", location: [0, 0, 0.32], scale: [1.65, 0.06, 0.06], rotation: [0, 0, 0], color: "#151515" },
          { kind: "cube", name: "glazing", location: [0.25, -0.02, 1.05], scale: [1.1, 0.05, 0.28], rotation: [0, 0, 0], color: "#dfefff" },
          { kind: "cube", name: "tire-set", location: [0, 0, 0.18], scale: [1.55, 0.2, 0.2], rotation: [0, 0, 0], color: "#151515" }
        ],
        camera: { location: [4, -5, 3], target: [0, 0, 0.5] }
      },
      sourceBlendPath
    );
    expect(sourceResult.ok, sourceResult.stderr).toBe(true);
    const texturePaths = [
      "textures/body-paint-basecolor.png",
      "textures/body-paint-normal.png",
      "textures/body-paint-roughness.png",
      "textures/interior-leather-normal.png",
      "textures/interior-leather-roughness.png",
      "textures/tire-rubber-normal.png",
      "textures/tire-rubber-roughness.png",
      "textures/wheel-metal-metallic.png",
      "textures/wheel-metal-normal.png",
      "textures/wheel-metal-roughness.png",
      "textures/window-glass-alpha.png",
      "textures/window-glass-roughness.png"
    ];
    const assetPaths = [
      ...capture.photos.map((photo) => photo.path),
      ...texturePaths
    ];
    await writeTextureFiles(outputDir, texturePaths);
    await writePhotoFiles(outputDir, [...capture.photos.map((photo) => photo.path), "photos/undeclared-material-source.jpg"]);

    const renderPreset = {
      presetId: "vehicle-studio-front-undeclared-material-source",
      renderer: "eevee",
      resolution: { width: 128, height: 96 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 0.5 },
      outputPath: "renders/vehicle-front.png"
    } as const;
    const renderManifest = buildDigitalViewingRenderManifest(capture, renderPreset);
    const assetBundleManifest = buildDigitalViewingAssetBundleManifest(capture, renderManifest, {
      existingFiles: assetPaths,
      assetFiles: await assetFilesFor(outputDir, assetPaths)
    });
    const job = buildDigitalViewingBlenderRenderJob(capture, renderPreset, sourceBlendPath, DefaultCapabilityManifest, assetBundleManifest);
    const jobWithUndeclaredMaterialSourcePhoto = {
      ...job,
      renderManifest: {
        ...job.renderManifest,
        materials: job.renderManifest.materials.map((material, index) => index === 0
          ? {
              ...material,
              photoSources: [...material.photoSources, "photos/undeclared-material-source.jpg"]
            }
          : material)
      }
    };

    const renderResult = await runBlenderJob(
      { outputDir, timeoutMs: 120_000 },
      jobWithUndeclaredMaterialSourcePhoto,
      "renders/vehicle-front-render.blend"
    );

    expect(renderResult.ok).toBe(false);
    expect(renderResult.stderr).toContain("Material source photo material-source is not declared in asset bundle: photos/undeclared-material-source.jpg");
  }, 180_000);

  it("refuses digital viewing render jobs whose material source photos are not material evidence in the asset bundle", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "nova-measured-render-material-evidence-photo-"));
    const captureRaw: unknown = JSON.parse(await readFile("fixtures/digital-viewing-vehicle-capture.json", "utf8"));
    const capture = DigitalViewingCaptureSchema.parse(captureRaw);
    const sourceBlendPath = "sources/vehicle-material-evidence-photo.blend";
    const sourceResult = await runBlenderJob(
      { outputDir, timeoutMs: 120_000 },
      {
        mode: "model",
        name: "vehicle-render-material-evidence-photo",
        primitives: [
          { kind: "cube", name: "body", location: [0, 0, 0.8], scale: [2.4, 0.9, 0.45], rotation: [0, 0, 0], color: "#ffffff" },
          { kind: "cube", name: "front-left-door", location: [-0.55, -0.92, 0.8], scale: [0.7, 0.04, 0.38], rotation: [0, 0, 0], color: "#f7f7f2" },
          { kind: "cube", name: "front-seat", location: [0.35, -0.1, 1.0], scale: [0.32, 0.32, 0.36], rotation: [0, 0, 0], color: "#1c1c1c" },
          { kind: "cube", name: "wheel-axles", location: [0, 0, 0.32], scale: [1.65, 0.06, 0.06], rotation: [0, 0, 0], color: "#151515" },
          { kind: "cube", name: "glazing", location: [0.25, -0.02, 1.05], scale: [1.1, 0.05, 0.28], rotation: [0, 0, 0], color: "#dfefff" },
          { kind: "cube", name: "tire-set", location: [0, 0, 0.18], scale: [1.55, 0.2, 0.2], rotation: [0, 0, 0], color: "#151515" }
        ],
        camera: { location: [4, -5, 3], target: [0, 0, 0.5] }
      },
      sourceBlendPath
    );
    expect(sourceResult.ok, sourceResult.stderr).toBe(true);
    const texturePaths = [
      "textures/body-paint-basecolor.png",
      "textures/body-paint-normal.png",
      "textures/body-paint-roughness.png",
      "textures/interior-leather-normal.png",
      "textures/interior-leather-roughness.png",
      "textures/tire-rubber-normal.png",
      "textures/tire-rubber-roughness.png",
      "textures/wheel-metal-metallic.png",
      "textures/wheel-metal-normal.png",
      "textures/wheel-metal-roughness.png",
      "textures/window-glass-alpha.png",
      "textures/window-glass-roughness.png"
    ];
    const assetPaths = [
      ...capture.photos.map((photo) => photo.path),
      ...texturePaths
    ];
    await writeTextureFiles(outputDir, texturePaths);
    await writePhotoFiles(outputDir, capture.photos.map((photo) => photo.path));

    const renderPreset = {
      presetId: "vehicle-studio-front-material-evidence",
      renderer: "eevee",
      resolution: { width: 128, height: 96 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 0.5 },
      outputPath: "renders/vehicle-front.png"
    } as const;
    const renderManifest = buildDigitalViewingRenderManifest(capture, renderPreset);
    const assetBundleManifest = buildDigitalViewingAssetBundleManifest(capture, renderManifest, {
      existingFiles: assetPaths,
      assetFiles: await assetFilesFor(outputDir, assetPaths)
    });
    const job = buildDigitalViewingBlenderRenderJob(capture, renderPreset, sourceBlendPath, DefaultCapabilityManifest, assetBundleManifest);
    const jobWithConditionPhotoAsMaterialEvidence = {
      ...job,
      renderManifest: {
        ...job.renderManifest,
        materials: job.renderManifest.materials.map((material) => material.materialId === "body-paint"
          ? {
              ...material,
              photoSources: ["photos/detail-scratch.jpg"],
              surfaceMapping: material.surfaceMapping
                ? { ...material.surfaceMapping, sourcePhoto: "photos/detail-scratch.jpg" }
                : material.surfaceMapping,
              appearanceCalibration: material.appearanceCalibration
                ? { ...material.appearanceCalibration, sourcePhoto: "photos/detail-scratch.jpg" }
                : material.appearanceCalibration
            }
          : material)
      }
    };

    const renderResult = await runBlenderJob(
      { outputDir, timeoutMs: 120_000 },
      jobWithConditionPhotoAsMaterialEvidence,
      "renders/vehicle-front-render.blend"
    );

    expect(renderResult.ok).toBe(false);
    expect(renderResult.stderr).toContain("Material source photo must be declared for that material in asset bundle: body-paint photos/detail-scratch.jpg");
  }, 180_000);

  it("refuses digital viewing render jobs whose condition source photos are not declared in the asset bundle", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "nova-measured-render-condition-source-photo-"));
    const captureRaw: unknown = JSON.parse(await readFile("fixtures/digital-viewing-vehicle-capture.json", "utf8"));
    const capture = DigitalViewingCaptureSchema.parse(captureRaw);
    const sourceBlendPath = "sources/vehicle-condition-source-photo.blend";
    const sourceResult = await runBlenderJob(
      { outputDir, timeoutMs: 120_000 },
      {
        mode: "model",
        name: "vehicle-render-condition-source-photo",
        primitives: [
          { kind: "cube", name: "body", location: [0, 0, 0.8], scale: [2.4, 0.9, 0.45], rotation: [0, 0, 0], color: "#ffffff" },
          { kind: "cube", name: "front-left-door", location: [-0.55, -0.92, 0.8], scale: [0.7, 0.04, 0.38], rotation: [0, 0, 0], color: "#f7f7f2" },
          { kind: "cube", name: "front-seat", location: [0.35, -0.1, 1.0], scale: [0.32, 0.32, 0.36], rotation: [0, 0, 0], color: "#1c1c1c" },
          { kind: "cube", name: "wheel-axles", location: [0, 0, 0.32], scale: [1.65, 0.06, 0.06], rotation: [0, 0, 0], color: "#151515" },
          { kind: "cube", name: "glazing", location: [0.25, -0.02, 1.05], scale: [1.1, 0.05, 0.28], rotation: [0, 0, 0], color: "#dfefff" },
          { kind: "cube", name: "tire-set", location: [0, 0, 0.18], scale: [1.55, 0.2, 0.2], rotation: [0, 0, 0], color: "#151515" }
        ],
        camera: { location: [4, -5, 3], target: [0, 0, 0.5] }
      },
      sourceBlendPath
    );
    expect(sourceResult.ok, sourceResult.stderr).toBe(true);
    const texturePaths = [
      "textures/body-paint-basecolor.png",
      "textures/body-paint-normal.png",
      "textures/body-paint-roughness.png",
      "textures/interior-leather-normal.png",
      "textures/interior-leather-roughness.png",
      "textures/tire-rubber-normal.png",
      "textures/tire-rubber-roughness.png",
      "textures/wheel-metal-metallic.png",
      "textures/wheel-metal-normal.png",
      "textures/wheel-metal-roughness.png",
      "textures/window-glass-alpha.png",
      "textures/window-glass-roughness.png"
    ];
    const assetPaths = [
      ...capture.photos.map((photo) => photo.path),
      ...texturePaths
    ];
    await writeTextureFiles(outputDir, texturePaths);
    await writePhotoFiles(outputDir, [...capture.photos.map((photo) => photo.path), "photos/undeclared-condition-source.jpg"]);

    const renderPreset = {
      presetId: "vehicle-studio-front-undeclared-condition-source",
      renderer: "eevee",
      resolution: { width: 128, height: 96 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 0.5 },
      outputPath: "renders/vehicle-front.png"
    } as const;
    const renderManifest = buildDigitalViewingRenderManifest(capture, renderPreset);
    const assetBundleManifest = buildDigitalViewingAssetBundleManifest(capture, renderManifest, {
      existingFiles: assetPaths,
      assetFiles: await assetFilesFor(outputDir, assetPaths)
    });
    const job = buildDigitalViewingBlenderRenderJob(capture, renderPreset, sourceBlendPath, DefaultCapabilityManifest, assetBundleManifest);
    const jobWithUndeclaredConditionSourcePhoto = {
      ...job,
      renderManifest: {
        ...job.renderManifest,
        conditions: job.renderManifest.conditions.map((condition, index) => index === 0
          ? {
              ...condition,
              photoSources: [...condition.photoSources, "photos/undeclared-condition-source.jpg"]
            }
          : condition)
      }
    };

    const renderResult = await runBlenderJob(
      { outputDir, timeoutMs: 120_000 },
      jobWithUndeclaredConditionSourcePhoto,
      "renders/vehicle-front-render.blend"
    );

    expect(renderResult.ok).toBe(false);
    expect(renderResult.stderr).toContain("Condition source photo condition-source is not declared in asset bundle: photos/undeclared-condition-source.jpg");
  }, 180_000);

  it("refuses digital viewing render jobs whose condition source photos are not condition detail evidence", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "nova-measured-render-condition-detail-photo-"));
    const captureRaw: unknown = JSON.parse(await readFile("fixtures/digital-viewing-vehicle-capture.json", "utf8"));
    const capture = DigitalViewingCaptureSchema.parse(captureRaw);
    const sourceBlendPath = "sources/vehicle-condition-detail-photo.blend";
    const sourceResult = await runBlenderJob(
      { outputDir, timeoutMs: 120_000 },
      {
        mode: "model",
        name: "vehicle-render-condition-detail-photo",
        primitives: [
          { kind: "cube", name: "body", location: [0, 0, 0.8], scale: [2.4, 0.9, 0.45], rotation: [0, 0, 0], color: "#ffffff" },
          { kind: "cube", name: "front-left-door", location: [-0.55, -0.92, 0.8], scale: [0.7, 0.04, 0.38], rotation: [0, 0, 0], color: "#f7f7f2" },
          { kind: "cube", name: "front-seat", location: [0.35, -0.1, 1.0], scale: [0.32, 0.32, 0.36], rotation: [0, 0, 0], color: "#1c1c1c" },
          { kind: "cube", name: "wheel-axles", location: [0, 0, 0.32], scale: [1.65, 0.06, 0.06], rotation: [0, 0, 0], color: "#151515" },
          { kind: "cube", name: "glazing", location: [0.25, -0.02, 1.05], scale: [1.1, 0.05, 0.28], rotation: [0, 0, 0], color: "#dfefff" },
          { kind: "cube", name: "tire-set", location: [0, 0, 0.18], scale: [1.55, 0.2, 0.2], rotation: [0, 0, 0], color: "#151515" }
        ],
        camera: { location: [4, -5, 3], target: [0, 0, 0.5] }
      },
      sourceBlendPath
    );
    expect(sourceResult.ok, sourceResult.stderr).toBe(true);
    const texturePaths = [
      "textures/body-paint-basecolor.png",
      "textures/body-paint-normal.png",
      "textures/body-paint-roughness.png",
      "textures/interior-leather-normal.png",
      "textures/interior-leather-roughness.png",
      "textures/tire-rubber-normal.png",
      "textures/tire-rubber-roughness.png",
      "textures/wheel-metal-metallic.png",
      "textures/wheel-metal-normal.png",
      "textures/wheel-metal-roughness.png",
      "textures/window-glass-alpha.png",
      "textures/window-glass-roughness.png"
    ];
    const assetPaths = [
      ...capture.photos.map((photo) => photo.path),
      ...texturePaths
    ];
    await writeTextureFiles(outputDir, texturePaths);
    await writePhotoFiles(outputDir, capture.photos.map((photo) => photo.path));

    const renderPreset = {
      presetId: "vehicle-studio-front-condition-source-not-detail",
      renderer: "eevee",
      resolution: { width: 128, height: 96 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 0.5 },
      outputPath: "renders/vehicle-front.png"
    } as const;
    const renderManifest = buildDigitalViewingRenderManifest(capture, renderPreset);
    const assetBundleManifest = buildDigitalViewingAssetBundleManifest(capture, renderManifest, {
      existingFiles: assetPaths,
      assetFiles: await assetFilesFor(outputDir, assetPaths)
    });
    const job = buildDigitalViewingBlenderRenderJob(capture, renderPreset, sourceBlendPath, DefaultCapabilityManifest, assetBundleManifest);
    const jobWithNonDetailConditionSourcePhoto = {
      ...job,
      renderManifest: {
        ...job.renderManifest,
        conditions: job.renderManifest.conditions.map((condition, index) => index === 0
          ? {
              ...condition,
              photoSources: ["photos/front.jpg"]
            }
          : condition)
      }
    };

    const renderResult = await runBlenderJob(
      { outputDir, timeoutMs: 120_000 },
      jobWithNonDetailConditionSourcePhoto,
      "renders/vehicle-front-render.blend"
    );

    expect(renderResult.ok).toBe(false);
    expect(renderResult.stderr).toContain("Condition source photo must be verified condition-detail evidence: front-left-scratch photos/front.jpg");
  }, 180_000);

  it("refuses digital viewing render jobs whose condition overlay dimensions are not visibly positive", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "nova-measured-render-condition-overlay-dimensions-"));
    const captureRaw: unknown = JSON.parse(await readFile("fixtures/digital-viewing-vehicle-capture.json", "utf8"));
    const capture = DigitalViewingCaptureSchema.parse(captureRaw);
    const sourceBlendPath = "sources/vehicle-condition-overlay-dimensions.blend";
    const sourceResult = await runBlenderJob(
      { outputDir, timeoutMs: 120_000 },
      {
        mode: "model",
        name: "vehicle-render-condition-overlay-dimensions",
        primitives: [
          { kind: "cube", name: "body", location: [0, 0, 0.8], scale: [2.4, 0.9, 0.45], rotation: [0, 0, 0], color: "#ffffff" },
          { kind: "cube", name: "front-left-door", location: [-0.55, -0.92, 0.8], scale: [0.7, 0.04, 0.38], rotation: [0, 0, 0], color: "#f7f7f2" },
          { kind: "cube", name: "front-seat", location: [0.35, -0.1, 1.0], scale: [0.32, 0.32, 0.36], rotation: [0, 0, 0], color: "#1c1c1c" },
          { kind: "cube", name: "wheel-axles", location: [0, 0, 0.32], scale: [1.65, 0.06, 0.06], rotation: [0, 0, 0], color: "#151515" },
          { kind: "cube", name: "glazing", location: [0.25, -0.02, 1.05], scale: [1.1, 0.05, 0.28], rotation: [0, 0, 0], color: "#dfefff" },
          { kind: "cube", name: "tire-set", location: [0, 0, 0.18], scale: [1.55, 0.2, 0.2], rotation: [0, 0, 0], color: "#151515" }
        ],
        camera: { location: [4, -5, 3], target: [0, 0, 0.5] }
      },
      sourceBlendPath
    );
    expect(sourceResult.ok, sourceResult.stderr).toBe(true);
    const texturePaths = [
      "textures/body-paint-basecolor.png",
      "textures/body-paint-normal.png",
      "textures/body-paint-roughness.png",
      "textures/interior-leather-normal.png",
      "textures/interior-leather-roughness.png",
      "textures/tire-rubber-normal.png",
      "textures/tire-rubber-roughness.png",
      "textures/wheel-metal-metallic.png",
      "textures/wheel-metal-normal.png",
      "textures/wheel-metal-roughness.png",
      "textures/window-glass-alpha.png",
      "textures/window-glass-roughness.png"
    ];
    const assetPaths = [
      ...capture.photos.map((photo) => photo.path),
      ...texturePaths
    ];
    await writeTextureFiles(outputDir, texturePaths);
    await writePhotoFiles(outputDir, capture.photos.map((photo) => photo.path));

    const renderPreset = {
      presetId: "vehicle-studio-front-condition-overlay-dimensions",
      renderer: "eevee",
      resolution: { width: 128, height: 96 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 0.5 },
      outputPath: "renders/vehicle-front.png"
    } as const;
    const renderManifest = buildDigitalViewingRenderManifest(capture, renderPreset);
    const assetBundleManifest = buildDigitalViewingAssetBundleManifest(capture, renderManifest, {
      existingFiles: assetPaths,
      assetFiles: await assetFilesFor(outputDir, assetPaths)
    });
    const job = buildDigitalViewingBlenderRenderJob(capture, renderPreset, sourceBlendPath, DefaultCapabilityManifest, assetBundleManifest);
    const jobWithInvisibleConditionOverlay = {
      ...job,
      renderManifest: {
        ...job.renderManifest,
        conditions: job.renderManifest.conditions.map((condition, index) => index === 0 && condition.surfacePlacement
          ? {
              ...condition,
              surfacePlacement: {
                ...condition.surfacePlacement,
                widthMm: 0
              }
            }
          : condition)
      }
    };

    const renderResult = await runBlenderJob(
      { outputDir, timeoutMs: 120_000 },
      jobWithInvisibleConditionOverlay,
      "renders/vehicle-front-render.blend"
    );

    expect(renderResult.ok).toBe(false);
    expect(renderResult.stderr).toContain("Condition surfacePlacement requires positive visible dimensions: front-left-scratch");
  }, 180_000);

  it("refuses digital viewing render jobs whose condition overlay face is not a physical host face", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "nova-measured-render-condition-overlay-face-"));
    const captureRaw: unknown = JSON.parse(await readFile("fixtures/digital-viewing-vehicle-capture.json", "utf8"));
    const capture = DigitalViewingCaptureSchema.parse(captureRaw);
    const sourceBlendPath = "sources/vehicle-condition-overlay-face.blend";
    const sourceResult = await runBlenderJob(
      { outputDir, timeoutMs: 120_000 },
      {
        mode: "model",
        name: "vehicle-render-condition-overlay-face",
        primitives: [
          { kind: "cube", name: "body", location: [0, 0, 0.8], scale: [2.4, 0.9, 0.45], rotation: [0, 0, 0], color: "#ffffff" },
          { kind: "cube", name: "front-left-door", location: [-0.55, -0.92, 0.8], scale: [0.7, 0.04, 0.38], rotation: [0, 0, 0], color: "#f7f7f2" },
          { kind: "cube", name: "front-seat", location: [0.35, -0.1, 1.0], scale: [0.32, 0.32, 0.36], rotation: [0, 0, 0], color: "#1c1c1c" },
          { kind: "cube", name: "wheel-axles", location: [0, 0, 0.32], scale: [1.65, 0.06, 0.06], rotation: [0, 0, 0], color: "#151515" },
          { kind: "cube", name: "glazing", location: [0.25, -0.02, 1.05], scale: [1.1, 0.05, 0.28], rotation: [0, 0, 0], color: "#dfefff" },
          { kind: "cube", name: "tire-set", location: [0, 0, 0.18], scale: [1.55, 0.2, 0.2], rotation: [0, 0, 0], color: "#151515" }
        ],
        camera: { location: [4, -5, 3], target: [0, 0, 0.5] }
      },
      sourceBlendPath
    );
    expect(sourceResult.ok, sourceResult.stderr).toBe(true);
    const texturePaths = [
      "textures/body-paint-basecolor.png",
      "textures/body-paint-normal.png",
      "textures/body-paint-roughness.png",
      "textures/interior-leather-normal.png",
      "textures/interior-leather-roughness.png",
      "textures/tire-rubber-normal.png",
      "textures/tire-rubber-roughness.png",
      "textures/wheel-metal-metallic.png",
      "textures/wheel-metal-normal.png",
      "textures/wheel-metal-roughness.png",
      "textures/window-glass-alpha.png",
      "textures/window-glass-roughness.png"
    ];
    const assetPaths = [
      ...capture.photos.map((photo) => photo.path),
      ...texturePaths
    ];
    await writeTextureFiles(outputDir, texturePaths);
    await writePhotoFiles(outputDir, capture.photos.map((photo) => photo.path));

    const renderPreset = {
      presetId: "vehicle-studio-front-condition-overlay-face",
      renderer: "eevee",
      resolution: { width: 128, height: 96 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 0.5 },
      outputPath: "renders/vehicle-front.png"
    } as const;
    const renderManifest = buildDigitalViewingRenderManifest(capture, renderPreset);
    const assetBundleManifest = buildDigitalViewingAssetBundleManifest(capture, renderManifest, {
      existingFiles: assetPaths,
      assetFiles: await assetFilesFor(outputDir, assetPaths)
    });
    const job = buildDigitalViewingBlenderRenderJob(capture, renderPreset, sourceBlendPath, DefaultCapabilityManifest, assetBundleManifest);
    const jobWithInvalidConditionFace = {
      ...job,
      renderManifest: {
        ...job.renderManifest,
        conditions: job.renderManifest.conditions.map((condition, index) => index === 0 && condition.surfacePlacement
          ? {
              ...condition,
              surfacePlacement: {
                ...condition.surfacePlacement,
                face: "diagonal"
              }
            }
          : condition)
      }
    };

    const renderResult = await runBlenderJob(
      { outputDir, timeoutMs: 120_000 },
      jobWithInvalidConditionFace,
      "renders/vehicle-front-render.blend"
    );

    expect(renderResult.ok).toBe(false);
    expect(renderResult.stderr).toContain("Condition surfacePlacement requires a supported physical face: front-left-scratch diagonal");
  }, 180_000);

  it("refuses digital viewing render jobs whose condition overlay placement leaves the host surface", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "nova-measured-render-condition-overlay-bounds-"));
    const captureRaw: unknown = JSON.parse(await readFile("fixtures/digital-viewing-vehicle-capture.json", "utf8"));
    const capture = DigitalViewingCaptureSchema.parse(captureRaw);
    const sourceBlendPath = "sources/vehicle-condition-overlay-bounds.blend";
    const sourceResult = await runBlenderJob(
      { outputDir, timeoutMs: 120_000 },
      {
        mode: "model",
        name: "vehicle-render-condition-overlay-bounds",
        primitives: [
          { kind: "cube", name: "body", location: [0, 0, 0.8], scale: [2.4, 0.9, 0.45], rotation: [0, 0, 0], color: "#ffffff" },
          { kind: "cube", name: "front-left-door", location: [-0.55, -0.92, 0.8], scale: [0.7, 0.04, 0.38], rotation: [0, 0, 0], color: "#f7f7f2" },
          { kind: "cube", name: "front-seat", location: [0.35, -0.1, 1.0], scale: [0.32, 0.32, 0.36], rotation: [0, 0, 0], color: "#1c1c1c" },
          { kind: "cube", name: "wheel-axles", location: [0, 0, 0.32], scale: [1.65, 0.06, 0.06], rotation: [0, 0, 0], color: "#151515" },
          { kind: "cube", name: "glazing", location: [0.25, -0.02, 1.05], scale: [1.1, 0.05, 0.28], rotation: [0, 0, 0], color: "#dfefff" },
          { kind: "cube", name: "tire-set", location: [0, 0, 0.18], scale: [1.55, 0.2, 0.2], rotation: [0, 0, 0], color: "#151515" }
        ],
        camera: { location: [4, -5, 3], target: [0, 0, 0.5] }
      },
      sourceBlendPath
    );
    expect(sourceResult.ok, sourceResult.stderr).toBe(true);
    const texturePaths = [
      "textures/body-paint-basecolor.png",
      "textures/body-paint-normal.png",
      "textures/body-paint-roughness.png",
      "textures/interior-leather-normal.png",
      "textures/interior-leather-roughness.png",
      "textures/tire-rubber-normal.png",
      "textures/tire-rubber-roughness.png",
      "textures/wheel-metal-metallic.png",
      "textures/wheel-metal-normal.png",
      "textures/wheel-metal-roughness.png",
      "textures/window-glass-alpha.png",
      "textures/window-glass-roughness.png"
    ];
    const assetPaths = [
      ...capture.photos.map((photo) => photo.path),
      ...texturePaths
    ];
    await writeTextureFiles(outputDir, texturePaths);
    await writePhotoFiles(outputDir, capture.photos.map((photo) => photo.path));

    const renderPreset = {
      presetId: "vehicle-studio-front-condition-overlay-bounds",
      renderer: "eevee",
      resolution: { width: 128, height: 96 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 0.5 },
      outputPath: "renders/vehicle-front.png"
    } as const;
    const renderManifest = buildDigitalViewingRenderManifest(capture, renderPreset);
    const assetBundleManifest = buildDigitalViewingAssetBundleManifest(capture, renderManifest, {
      existingFiles: assetPaths,
      assetFiles: await assetFilesFor(outputDir, assetPaths)
    });
    const job = buildDigitalViewingBlenderRenderJob(capture, renderPreset, sourceBlendPath, DefaultCapabilityManifest, assetBundleManifest);
    const jobWithOutOfBoundsConditionPlacement = {
      ...job,
      renderManifest: {
        ...job.renderManifest,
        conditions: job.renderManifest.conditions.map((condition, index) => index === 0 && condition.surfacePlacement
          ? {
              ...condition,
              surfacePlacement: {
                ...condition.surfacePlacement,
                u: -0.25
              }
            }
          : condition)
      }
    };

    const renderResult = await runBlenderJob(
      { outputDir, timeoutMs: 120_000 },
      jobWithOutOfBoundsConditionPlacement,
      "renders/vehicle-front-render.blend"
    );

    expect(renderResult.ok).toBe(false);
    expect(renderResult.stderr).toContain("Condition surfacePlacement requires normalized u/v coordinates on the host surface: front-left-scratch");
  }, 180_000);

  it("refuses digital viewing render jobs whose condition overlay placement diverges from the visibility checklist", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "nova-measured-render-condition-overlay-host-"));
    const captureRaw: unknown = JSON.parse(await readFile("fixtures/digital-viewing-vehicle-capture.json", "utf8"));
    const capture = DigitalViewingCaptureSchema.parse(captureRaw);
    const sourceBlendPath = "sources/vehicle-condition-overlay-host.blend";
    const sourceResult = await runBlenderJob(
      { outputDir, timeoutMs: 120_000 },
      {
        mode: "model",
        name: "vehicle-render-condition-overlay-host",
        primitives: [
          { kind: "cube", name: "body", location: [0, 0, 0.8], scale: [2.4, 0.9, 0.45], rotation: [0, 0, 0], color: "#ffffff" },
          { kind: "cube", name: "front-left-door", location: [-0.55, -0.92, 0.8], scale: [0.7, 0.04, 0.38], rotation: [0, 0, 0], color: "#f7f7f2" },
          { kind: "cube", name: "front-seat", location: [0.35, -0.1, 1.0], scale: [0.32, 0.32, 0.36], rotation: [0, 0, 0], color: "#1c1c1c" },
          { kind: "cube", name: "wheel-axles", location: [0, 0, 0.32], scale: [1.65, 0.06, 0.06], rotation: [0, 0, 0], color: "#151515" },
          { kind: "cube", name: "glazing", location: [0.25, -0.02, 1.05], scale: [1.1, 0.05, 0.28], rotation: [0, 0, 0], color: "#dfefff" },
          { kind: "cube", name: "tire-set", location: [0, 0, 0.18], scale: [1.55, 0.2, 0.2], rotation: [0, 0, 0], color: "#151515" }
        ],
        camera: { location: [4, -5, 3], target: [0, 0, 0.5] }
      },
      sourceBlendPath
    );
    expect(sourceResult.ok, sourceResult.stderr).toBe(true);
    const texturePaths = [
      "textures/body-paint-basecolor.png",
      "textures/body-paint-normal.png",
      "textures/body-paint-roughness.png",
      "textures/interior-leather-normal.png",
      "textures/interior-leather-roughness.png",
      "textures/tire-rubber-normal.png",
      "textures/tire-rubber-roughness.png",
      "textures/wheel-metal-metallic.png",
      "textures/wheel-metal-normal.png",
      "textures/wheel-metal-roughness.png",
      "textures/window-glass-alpha.png",
      "textures/window-glass-roughness.png"
    ];
    const assetPaths = [
      ...capture.photos.map((photo) => photo.path),
      ...texturePaths
    ];
    await writeTextureFiles(outputDir, texturePaths);
    await writePhotoFiles(outputDir, capture.photos.map((photo) => photo.path));

    const renderPreset = {
      presetId: "vehicle-studio-front-condition-overlay-host",
      renderer: "eevee",
      resolution: { width: 128, height: 96 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 0.5 },
      outputPath: "renders/vehicle-front.png"
    } as const;
    const renderManifest = buildDigitalViewingRenderManifest(capture, renderPreset);
    const assetBundleManifest = buildDigitalViewingAssetBundleManifest(capture, renderManifest, {
      existingFiles: assetPaths,
      assetFiles: await assetFilesFor(outputDir, assetPaths)
    });
    const job = buildDigitalViewingBlenderRenderJob(capture, renderPreset, sourceBlendPath, DefaultCapabilityManifest, assetBundleManifest);
    const jobWithMismatchedConditionPlacement = {
      ...job,
      renderManifest: {
        ...job.renderManifest,
        conditions: job.renderManifest.conditions.map((condition, index) => index === 0 && condition.surfacePlacement
          ? {
              ...condition,
              surfacePlacement: {
                ...condition.surfacePlacement,
                hostElementId: "tire-set"
              }
            }
          : condition)
      }
    };

    const renderResult = await runBlenderJob(
      { outputDir, timeoutMs: 120_000 },
      jobWithMismatchedConditionPlacement,
      "renders/vehicle-front-render.blend"
    );

    expect(renderResult.ok).toBe(false);
    expect(renderResult.stderr).toContain("Condition surfacePlacement must match visibility checklist: front-left-scratch");
  }, 180_000);

  it("refuses digital viewing render jobs whose material texture maps are not declared in the asset bundle", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "nova-measured-render-texture-map-"));
    const captureRaw: unknown = JSON.parse(await readFile("fixtures/digital-viewing-vehicle-capture.json", "utf8"));
    const capture = DigitalViewingCaptureSchema.parse(captureRaw);
    const sourceBlendPath = "sources/vehicle-texture-map.blend";
    const sourceResult = await runBlenderJob(
      { outputDir, timeoutMs: 120_000 },
      {
        mode: "model",
        name: "vehicle-render-texture-map",
        primitives: [
          { kind: "cube", name: "body", location: [0, 0, 0.8], scale: [2.4, 0.9, 0.45], rotation: [0, 0, 0], color: "#ffffff" },
          { kind: "cube", name: "front-left-door", location: [-0.55, -0.92, 0.8], scale: [0.7, 0.04, 0.38], rotation: [0, 0, 0], color: "#f7f7f2" },
          { kind: "cube", name: "front-seat", location: [0.35, -0.1, 1.0], scale: [0.32, 0.32, 0.36], rotation: [0, 0, 0], color: "#1c1c1c" },
          { kind: "cube", name: "wheel-axles", location: [0, 0, 0.32], scale: [1.65, 0.06, 0.06], rotation: [0, 0, 0], color: "#151515" },
          { kind: "cube", name: "glazing", location: [0.25, -0.02, 1.05], scale: [1.1, 0.05, 0.28], rotation: [0, 0, 0], color: "#dfefff" },
          { kind: "cube", name: "tire-set", location: [0, 0, 0.18], scale: [1.55, 0.2, 0.2], rotation: [0, 0, 0], color: "#151515" }
        ],
        camera: { location: [4, -5, 3], target: [0, 0, 0.5] }
      },
      sourceBlendPath
    );
    expect(sourceResult.ok, sourceResult.stderr).toBe(true);
    const texturePaths = [
      "textures/body-paint-basecolor.png",
      "textures/body-paint-normal.png",
      "textures/body-paint-roughness.png",
      "textures/interior-leather-normal.png",
      "textures/interior-leather-roughness.png",
      "textures/tire-rubber-normal.png",
      "textures/tire-rubber-roughness.png",
      "textures/wheel-metal-metallic.png",
      "textures/wheel-metal-normal.png",
      "textures/wheel-metal-roughness.png",
      "textures/window-glass-alpha.png",
      "textures/window-glass-roughness.png"
    ];
    const assetPaths = [
      ...capture.photos.map((photo) => photo.path),
      ...texturePaths
    ];
    await writeTextureFiles(outputDir, [...texturePaths, "textures/undeclared-material-normal.png"]);
    await writePhotoFiles(outputDir, capture.photos.map((photo) => photo.path));

    const renderPreset = {
      presetId: "vehicle-studio-front-undeclared-texture-map",
      renderer: "eevee",
      resolution: { width: 128, height: 96 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 0.5 },
      outputPath: "renders/vehicle-front.png"
    } as const;
    const renderManifest = buildDigitalViewingRenderManifest(capture, renderPreset);
    const assetBundleManifest = buildDigitalViewingAssetBundleManifest(capture, renderManifest, {
      existingFiles: assetPaths,
      assetFiles: await assetFilesFor(outputDir, assetPaths)
    });
    const job = buildDigitalViewingBlenderRenderJob(capture, renderPreset, sourceBlendPath, DefaultCapabilityManifest, assetBundleManifest);
    const jobWithUndeclaredTextureMap = {
      ...job,
      renderManifest: {
        ...job.renderManifest,
        materials: job.renderManifest.materials.map((material, index) => index === 0
          ? {
              ...material,
              textureMaps: [
                ...material.textureMaps,
                {
                  path: "textures/undeclared-material-normal.png",
                  type: "normal",
                  colorSpace: "Non-Color",
                  scaleMm: 400,
                  pixelWidth: 4096,
                  pixelHeight: 4096
                }
              ]
            }
          : material)
      }
    };

    const renderResult = await runBlenderJob(
      { outputDir, timeoutMs: 120_000 },
      jobWithUndeclaredTextureMap,
      "renders/vehicle-front-render.blend"
    );

    expect(renderResult.ok).toBe(false);
    expect(renderResult.stderr).toContain("Material texture map normal is not declared in asset bundle: textures/undeclared-material-normal.png");
  }, 180_000);

  it("refuses digital viewing render jobs without an asset bundle manifest", async () => {
    const captureRaw: unknown = JSON.parse(await readFile("fixtures/digital-viewing-vehicle-capture.json", "utf8"));
    const capture = DigitalViewingCaptureSchema.parse(captureRaw);
    expect(() => buildDigitalViewingBlenderRenderJob(capture, {
      presetId: "vehicle-studio-front-no-asset-bundle",
      renderer: "eevee",
      resolution: { width: 128, height: 96 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 0.5 },
      outputPath: "renders/vehicle-front.png"
    }, "sources/vehicle-no-asset-bundle.blend", DefaultCapabilityManifest)).toThrow("Cannot build render job without verified asset bundle: asset_bundle_manifest_required");
  }, 180_000);

  it("refuses digital viewing render jobs without material authoring evidence", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "nova-measured-render-material-authoring-"));
    const captureRaw: unknown = JSON.parse(await readFile("fixtures/digital-viewing-vehicle-capture.json", "utf8"));
    const capture = DigitalViewingCaptureSchema.parse(captureRaw);
    const renderPreset = {
      presetId: "vehicle-studio-front-material-authoring",
      renderer: "eevee",
      resolution: { width: 128, height: 96 },
      camera: { mode: "perspective", sector: "front", focalLengthMm: 55 },
      lighting: { environment: "studio", colorTemperatureK: 5600, intensity: 0.5 },
      outputPath: "renders/vehicle-front.png"
    } as const;
    const renderManifest = buildDigitalViewingRenderManifest(capture, renderPreset);
    const assetPaths = [
      ...capture.photos.map((photo) => photo.path),
      ...renderManifest.materials.flatMap((material) => material.textureMaps.map((textureMap) => textureMap.path))
    ];
    await writePhotoFiles(outputDir, capture.photos.map((photo) => photo.path));
    await writeTextureFiles(outputDir, renderManifest.materials.flatMap((material) => material.textureMaps.map((textureMap) => textureMap.path)));
    const assetBundleManifest = buildDigitalViewingAssetBundleManifest(capture, renderManifest, {
      existingFiles: assetPaths,
      assetFiles: await assetFilesFor(outputDir, assetPaths)
    });
    const job = buildDigitalViewingBlenderRenderJob(
      capture,
      renderPreset,
      "measurement-projects/vehicle-demo/artifacts/locked.blend",
      DefaultCapabilityManifest,
      assetBundleManifest
    );
    const jobWithoutMaterialAuthoring = { ...job } as Record<string, unknown>;
    delete jobWithoutMaterialAuthoring.materialAuthoring;

    const renderResult = await runBlenderJob(
      { outputDir, timeoutMs: 120_000 },
      jobWithoutMaterialAuthoring,
      "renders/vehicle-front-render.blend"
    );

    expect(renderResult.ok).toBe(false);
    expect(renderResult.stderr).toContain("Digital viewing render job must include materialAuthoring derived from the material authoring plan");
  }, 180_000);

  it("refuses digital viewing render when an asset file no longer matches its bundle hash", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "nova-measured-render-asset-integrity-"));
    const captureRaw: unknown = JSON.parse(await readFile("fixtures/digital-viewing-carport-capture.json", "utf8"));
    const capture = DigitalViewingCaptureSchema.parse(captureRaw);
    const sourceBlendPath = "sources/carport-locked.blend";
    const sourceResult = await runBlenderJob(
      { outputDir, timeoutMs: 120_000 },
      {
        mode: "model",
        name: "carport-render-asset-integrity",
        primitives: [
          { kind: "cube", name: "carport-frame", location: [0, -0.2, 1.7], scale: [3.1, 0.06, 0.08], rotation: [0, 0, 0], color: "#f2f2ee" },
          { kind: "cube", name: "roof", location: [0, 0, 2.6], scale: [3.4, 2.4, 0.08], rotation: [0, 0, 0], color: "#20282b" },
          { kind: "cube", name: "street-stair-run", location: [-0.95, -1.15, 0.18], scale: [0.45, 0.5, 0.18], rotation: [0, 0, 0], color: "#777777" },
          { kind: "cube", name: "outermost-southwest-post", location: [-1.48, -0.68, 1.45], scale: [0.06, 0.06, 1.25], rotation: [0, 0, 0], color: "#f2f2ee" },
          { kind: "cube", name: "cladding-southwest", location: [0, -0.62, 1.35], scale: [2.8, 0.08, 0.55], rotation: [0, 0, 0], color: "#f2f2ee" },
          { kind: "cube", name: "foundation-wall", location: [0, -0.68, 0.42], scale: [2.9, 0.09, 0.32], rotation: [0, 0, 0], color: "#33383a" }
        ],
        camera: { location: [3.5, -4.5, 2.8], target: [0, 0, 0.9] }
      },
      sourceBlendPath
    );
    expect(sourceResult.ok, sourceResult.stderr).toBe(true);
    const captureForOnePixelAssets = withOnePixelPhotoAndTextureEvidence(capture);
    const texturePaths = [
      "textures/carport-stone-foundation-normal.png",
      "textures/carport-stone-foundation-roughness.png",
      "textures/carport-white-panel-normal.png",
      "textures/carport-white-panel-roughness.png"
    ];
    const assetPaths = [
      ...capture.photos.map((photo) => photo.path),
      ...texturePaths
    ];
    await writeTextureFiles(outputDir, texturePaths);
    await writePhotoFiles(outputDir, capture.photos.map((photo) => photo.path));

    const renderPreset = {
      presetId: "carport-site-southwest-asset-integrity",
      deliveryTier: "premium-sales",
      renderer: "eevee",
      resolution: { width: 128, height: 96 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    } as const;
    const renderManifest = buildDigitalViewingRenderManifest(captureForOnePixelAssets, renderPreset);
    const assetBundleManifest = buildDigitalViewingAssetBundleManifest(captureForOnePixelAssets, renderManifest, {
      existingFiles: assetPaths,
      assetFiles: await assetFilesFor(outputDir, assetPaths)
    });
    const tamperedTexturePath = path.join(outputDir, "textures/carport-white-panel-normal.png");
    const originalSize = (await stat(tamperedTexturePath)).size;
    await writeFile(tamperedTexturePath, Buffer.alloc(originalSize, 0x41));

    const job = buildDigitalViewingBlenderRenderJob(captureForOnePixelAssets, renderPreset, sourceBlendPath, DefaultCapabilityManifest, assetBundleManifest);
    const renderResult = await runBlenderJob(
      { outputDir, timeoutMs: 120_000 },
      job,
      "renders/carport-southwest-render.blend"
    );

    expect(renderResult.ok).toBe(false);
    expect(renderResult.stderr).toContain("Asset bundle file hash mismatch: textures/carport-white-panel-normal.png");
  }, 180_000);

  it("refuses digital viewing render when declared photo asset dimensions disagree with the asset file", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "nova-measured-render-photo-resolution-mismatch-runtime-"));
    const captureRaw: unknown = JSON.parse(await readFile("fixtures/digital-viewing-carport-capture.json", "utf8"));
    const capture = DigitalViewingCaptureSchema.parse(captureRaw);
    const sourceBlendPath = "sources/carport-photo-resolution-mismatch-runtime.blend";
    const sourceResult = await runBlenderJob(
      { outputDir, timeoutMs: 120_000 },
      {
        mode: "model",
        name: "carport-render-photo-resolution-mismatch-runtime",
        primitives: [
          { kind: "cube", name: "carport-frame", location: [0, -0.2, 1.7], scale: [3.1, 0.06, 0.08], rotation: [0, 0, 0], color: "#f2f2ee" },
          { kind: "cube", name: "roof", location: [0, 0, 2.6], scale: [3.4, 2.4, 0.08], rotation: [0, 0, 0], color: "#20282b" },
          { kind: "cube", name: "street-stair-run", location: [-0.95, -1.15, 0.18], scale: [0.45, 0.5, 0.18], rotation: [0, 0, 0], color: "#777777" },
          { kind: "cube", name: "outermost-southwest-post", location: [-1.48, -0.68, 1.45], scale: [0.06, 0.06, 1.25], rotation: [0, 0, 0], color: "#f2f2ee" },
          { kind: "cube", name: "cladding-southwest", location: [0, -0.62, 1.35], scale: [2.8, 0.08, 0.55], rotation: [0, 0, 0], color: "#f2f2ee" },
          { kind: "cube", name: "foundation-wall", location: [0, -0.68, 0.42], scale: [2.9, 0.09, 0.32], rotation: [0, 0, 0], color: "#33383a" }
        ],
        camera: { location: [3.5, -4.5, 2.8], target: [0, 0, 0.9] }
      },
      sourceBlendPath
    );
    expect(sourceResult.ok, sourceResult.stderr).toBe(true);
    const captureForOnePixelAssets = withOnePixelPhotoAndTextureEvidence(capture);
    const texturePaths = [
      "textures/carport-stone-foundation-normal.png",
      "textures/carport-stone-foundation-roughness.png",
      "textures/carport-white-panel-normal.png",
      "textures/carport-white-panel-roughness.png"
    ];
    const assetPaths = [
      ...capture.photos.map((photo) => photo.path),
      ...texturePaths
    ];
    await writeTextureFiles(outputDir, texturePaths);
    await writePhotoFiles(outputDir, capture.photos.map((photo) => photo.path));

    const renderPreset = {
      presetId: "carport-site-southwest-photo-resolution-mismatch-runtime",
      deliveryTier: "premium-sales",
      renderer: "eevee",
      resolution: { width: 128, height: 96 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    } as const;
    const renderManifest = buildDigitalViewingRenderManifest(captureForOnePixelAssets, renderPreset);
    const assetBundleManifest = buildDigitalViewingAssetBundleManifest(captureForOnePixelAssets, renderManifest, {
      existingFiles: assetPaths,
      assetFiles: await assetFilesFor(outputDir, assetPaths)
    });
    const job = buildDigitalViewingBlenderRenderJob(captureForOnePixelAssets, renderPreset, sourceBlendPath, DefaultCapabilityManifest, assetBundleManifest);
    const jobWithPhotoResolutionMismatch = {
      ...job,
      assetBundleManifest: {
        ...job.assetBundleManifest,
        assets: job.assetBundleManifest.assets.map((asset) =>
          asset.path === "photos/carport-south.jpg"
            ? { ...asset, width: 4096, height: 4096 }
            : asset
        )
      }
    };

    const renderResult = await runBlenderJob(
      { outputDir, timeoutMs: 120_000 },
      jobWithPhotoResolutionMismatch,
      "renders/carport-southwest-render.blend"
    );

    expect(renderResult.ok).toBe(false);
    expect(renderResult.stderr).toContain("Asset bundle declared image dimensions do not match asset file: photos/carport-south.jpg declared 4096x4096, actual 1x1");
  }, 180_000);

  it("refuses digital viewing render when a perspective reference camera lacks cameraReference metadata", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "nova-measured-render-camera-reference-runtime-"));
    const captureRaw: unknown = JSON.parse(await readFile("fixtures/digital-viewing-carport-capture.json", "utf8"));
    const capture = DigitalViewingCaptureSchema.parse(captureRaw);
    const sourceBlendPath = "sources/carport-camera-reference-runtime.blend";
    const sourceResult = await runBlenderJob(
      { outputDir, timeoutMs: 120_000 },
      {
        mode: "model",
        name: "carport-render-camera-reference-runtime",
        primitives: [
          { kind: "cube", name: "carport-frame", location: [0, -0.2, 1.7], scale: [3.1, 0.06, 0.08], rotation: [0, 0, 0], color: "#f2f2ee" },
          { kind: "cube", name: "roof", location: [0, 0, 2.6], scale: [3.4, 2.4, 0.08], rotation: [0, 0, 0], color: "#20282b" },
          { kind: "cube", name: "street-stair-run", location: [-0.95, -1.15, 0.18], scale: [0.45, 0.5, 0.18], rotation: [0, 0, 0], color: "#777777" },
          { kind: "cube", name: "outermost-southwest-post", location: [-1.48, -0.68, 1.45], scale: [0.06, 0.06, 1.25], rotation: [0, 0, 0], color: "#f2f2ee" },
          { kind: "cube", name: "cladding-southwest", location: [0, -0.62, 1.35], scale: [2.8, 0.08, 0.55], rotation: [0, 0, 0], color: "#f2f2ee" },
          { kind: "cube", name: "foundation-wall", location: [0, -0.68, 0.42], scale: [2.9, 0.09, 0.32], rotation: [0, 0, 0], color: "#33383a" }
        ],
        camera: { location: [3.5, -4.5, 2.8], target: [0, 0, 0.9] }
      },
      sourceBlendPath
    );
    expect(sourceResult.ok, sourceResult.stderr).toBe(true);
    const captureForOnePixelAssets = withOnePixelPhotoAndTextureEvidence(capture);
    const texturePaths = [
      "textures/carport-stone-foundation-normal.png",
      "textures/carport-stone-foundation-roughness.png",
      "textures/carport-white-panel-normal.png",
      "textures/carport-white-panel-roughness.png"
    ];
    const assetPaths = [
      ...capture.photos.map((photo) => photo.path),
      ...texturePaths
    ];
    await writeTextureFiles(outputDir, texturePaths);
    await writePhotoFiles(outputDir, capture.photos.map((photo) => photo.path));

    const renderPreset = {
      presetId: "carport-site-southwest-camera-reference-runtime",
      deliveryTier: "premium-sales",
      renderer: "eevee",
      resolution: { width: 128, height: 96 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    } as const;
    const renderManifest = buildDigitalViewingRenderManifest(captureForOnePixelAssets, renderPreset);
    const assetBundleManifest = buildDigitalViewingAssetBundleManifest(captureForOnePixelAssets, renderManifest, {
      existingFiles: assetPaths,
      assetFiles: await assetFilesFor(outputDir, assetPaths)
    });
    const job = buildDigitalViewingBlenderRenderJob(captureForOnePixelAssets, renderPreset, sourceBlendPath, DefaultCapabilityManifest, assetBundleManifest);
    const jobWithoutCameraReference = {
      ...job,
      renderManifest: { ...job.renderManifest }
    };
    delete (jobWithoutCameraReference.renderManifest as Record<string, unknown>).cameraReference;

    const renderResult = await runBlenderJob(
      { outputDir, timeoutMs: 120_000 },
      jobWithoutCameraReference,
      "renders/carport-southwest-render.blend"
    );

    expect(renderResult.ok).toBe(false);
    expect(renderResult.stderr).toContain("Digital viewing perspective camera referencePhoto requires renderManifest.cameraReference calibration metadata");
  }, 180_000);

  it("refuses digital viewing render when a material texture map lacks physical scale metadata", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "nova-measured-render-texture-scale-runtime-"));
    const captureRaw: unknown = JSON.parse(await readFile("fixtures/digital-viewing-carport-capture.json", "utf8"));
    const capture = DigitalViewingCaptureSchema.parse(captureRaw);
    const sourceBlendPath = "sources/carport-texture-scale-runtime.blend";
    const sourceResult = await runBlenderJob(
      { outputDir, timeoutMs: 120_000 },
      {
        mode: "model",
        name: "carport-render-texture-scale-runtime",
        primitives: [
          { kind: "cube", name: "carport-frame", location: [0, -0.2, 1.7], scale: [3.1, 0.06, 0.08], rotation: [0, 0, 0], color: "#f2f2ee" },
          { kind: "cube", name: "roof", location: [0, 0, 2.6], scale: [3.4, 2.4, 0.08], rotation: [0, 0, 0], color: "#20282b" },
          { kind: "cube", name: "street-stair-run", location: [-0.95, -1.15, 0.18], scale: [0.45, 0.5, 0.18], rotation: [0, 0, 0], color: "#777777" },
          { kind: "cube", name: "outermost-southwest-post", location: [-1.48, -0.68, 1.45], scale: [0.06, 0.06, 1.25], rotation: [0, 0, 0], color: "#f2f2ee" },
          { kind: "cube", name: "cladding-southwest", location: [0, -0.62, 1.35], scale: [2.8, 0.08, 0.55], rotation: [0, 0, 0], color: "#f2f2ee" },
          { kind: "cube", name: "foundation-wall", location: [0, -0.68, 0.42], scale: [2.9, 0.09, 0.32], rotation: [0, 0, 0], color: "#33383a" }
        ],
        camera: { location: [3.5, -4.5, 2.8], target: [0, 0, 0.9] }
      },
      sourceBlendPath
    );
    expect(sourceResult.ok, sourceResult.stderr).toBe(true);
    const captureForOnePixelAssets = withOnePixelPhotoAndTextureEvidence(capture);
    const texturePaths = [
      "textures/carport-stone-foundation-normal.png",
      "textures/carport-stone-foundation-roughness.png",
      "textures/carport-white-panel-normal.png",
      "textures/carport-white-panel-roughness.png"
    ];
    const assetPaths = [
      ...capture.photos.map((photo) => photo.path),
      ...texturePaths
    ];
    await writeTextureFiles(outputDir, texturePaths);
    await writePhotoFiles(outputDir, capture.photos.map((photo) => photo.path));

    const renderPreset = {
      presetId: "carport-site-southwest-texture-scale-runtime",
      deliveryTier: "premium-sales",
      renderer: "eevee",
      resolution: { width: 128, height: 96 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    } as const;
    const renderManifest = buildDigitalViewingRenderManifest(captureForOnePixelAssets, renderPreset);
    const renderManifestWithoutTextureScale = {
      ...renderManifest,
      materials: renderManifest.materials.map((material) => ({
        ...material,
        textureMaps: material.textureMaps.map((textureMap) => {
          const withoutScale = { ...textureMap } as Record<string, unknown>;
          delete withoutScale.scaleMm;
          return withoutScale;
        })
      }))
    };
    const assetBundleManifest = buildDigitalViewingAssetBundleManifest(captureForOnePixelAssets, renderManifest, {
      existingFiles: assetPaths,
      assetFiles: await assetFilesFor(outputDir, assetPaths)
    });
    const job = buildDigitalViewingBlenderRenderJob(captureForOnePixelAssets, renderPreset, sourceBlendPath, DefaultCapabilityManifest, assetBundleManifest);
    const jobWithoutTextureScale = {
      ...job,
      renderManifest: renderManifestWithoutTextureScale
    };

    const renderResult = await runBlenderJob(
      { outputDir, timeoutMs: 120_000 },
      jobWithoutTextureScale,
      "renders/carport-southwest-render.blend"
    );

    expect(renderResult.ok).toBe(false);
    expect(renderResult.stderr).toContain("Digital viewing texture map requires scaleMm for reproducible physical material rendering: textures/carport-stone-foundation-normal.png");
  }, 180_000);

  it("refuses digital viewing render when a material texture map lacks color-space metadata", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "nova-measured-render-texture-colorspace-runtime-"));
    const captureRaw: unknown = JSON.parse(await readFile("fixtures/digital-viewing-carport-capture.json", "utf8"));
    const capture = DigitalViewingCaptureSchema.parse(captureRaw);
    const sourceBlendPath = "sources/carport-texture-colorspace-runtime.blend";
    const sourceResult = await runBlenderJob(
      { outputDir, timeoutMs: 120_000 },
      {
        mode: "model",
        name: "carport-render-texture-colorspace-runtime",
        primitives: [
          { kind: "cube", name: "carport-frame", location: [0, -0.2, 1.7], scale: [3.1, 0.06, 0.08], rotation: [0, 0, 0], color: "#f2f2ee" },
          { kind: "cube", name: "roof", location: [0, 0, 2.6], scale: [3.4, 2.4, 0.08], rotation: [0, 0, 0], color: "#20282b" },
          { kind: "cube", name: "street-stair-run", location: [-0.95, -1.15, 0.18], scale: [0.45, 0.5, 0.18], rotation: [0, 0, 0], color: "#777777" },
          { kind: "cube", name: "outermost-southwest-post", location: [-1.48, -0.68, 1.45], scale: [0.06, 0.06, 1.25], rotation: [0, 0, 0], color: "#f2f2ee" },
          { kind: "cube", name: "cladding-southwest", location: [0, -0.62, 1.35], scale: [2.8, 0.08, 0.55], rotation: [0, 0, 0], color: "#f2f2ee" },
          { kind: "cube", name: "foundation-wall", location: [0, -0.68, 0.42], scale: [2.9, 0.09, 0.32], rotation: [0, 0, 0], color: "#33383a" }
        ],
        camera: { location: [3.5, -4.5, 2.8], target: [0, 0, 0.9] }
      },
      sourceBlendPath
    );
    expect(sourceResult.ok, sourceResult.stderr).toBe(true);
    const captureForOnePixelAssets = withOnePixelPhotoAndTextureEvidence(capture);
    const texturePaths = [
      "textures/carport-stone-foundation-normal.png",
      "textures/carport-stone-foundation-roughness.png",
      "textures/carport-white-panel-normal.png",
      "textures/carport-white-panel-roughness.png"
    ];
    const assetPaths = [
      ...capture.photos.map((photo) => photo.path),
      ...texturePaths
    ];
    await writeTextureFiles(outputDir, texturePaths);
    await writePhotoFiles(outputDir, capture.photos.map((photo) => photo.path));

    const renderPreset = {
      presetId: "carport-site-southwest-texture-colorspace-runtime",
      deliveryTier: "premium-sales",
      renderer: "eevee",
      resolution: { width: 128, height: 96 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    } as const;
    const renderManifest = buildDigitalViewingRenderManifest(captureForOnePixelAssets, renderPreset);
    const renderManifestWithoutTextureColorSpace = {
      ...renderManifest,
      materials: renderManifest.materials.map((material) => ({
        ...material,
        textureMaps: material.textureMaps.map((textureMap) => {
          const withoutColorSpace = { ...textureMap } as Record<string, unknown>;
          delete withoutColorSpace.colorSpace;
          return withoutColorSpace;
        })
      }))
    };
    const assetBundleManifest = buildDigitalViewingAssetBundleManifest(captureForOnePixelAssets, renderManifest, {
      existingFiles: assetPaths,
      assetFiles: await assetFilesFor(outputDir, assetPaths)
    });
    const job = buildDigitalViewingBlenderRenderJob(captureForOnePixelAssets, renderPreset, sourceBlendPath, DefaultCapabilityManifest, assetBundleManifest);
    const jobWithoutTextureColorSpace = {
      ...job,
      renderManifest: renderManifestWithoutTextureColorSpace
    };

    const renderResult = await runBlenderJob(
      { outputDir, timeoutMs: 120_000 },
      jobWithoutTextureColorSpace,
      "renders/carport-southwest-render.blend"
    );

    expect(renderResult.ok).toBe(false);
    expect(renderResult.stderr).toContain("Digital viewing texture map requires explicit colorSpace for reproducible physical material rendering: textures/carport-stone-foundation-normal.png");
  }, 180_000);

  it("refuses digital viewing render when a material texture map declares the wrong color space for its type", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "nova-measured-render-texture-type-colorspace-runtime-"));
    const captureRaw: unknown = JSON.parse(await readFile("fixtures/digital-viewing-carport-capture.json", "utf8"));
    const capture = DigitalViewingCaptureSchema.parse(captureRaw);
    const sourceBlendPath = "sources/carport-texture-type-colorspace-runtime.blend";
    const sourceResult = await runBlenderJob(
      { outputDir, timeoutMs: 120_000 },
      {
        mode: "model",
        name: "carport-render-texture-type-colorspace-runtime",
        primitives: [
          { kind: "cube", name: "carport-frame", location: [0, -0.2, 1.7], scale: [3.1, 0.06, 0.08], rotation: [0, 0, 0], color: "#f2f2ee" },
          { kind: "cube", name: "roof", location: [0, 0, 2.6], scale: [3.4, 2.4, 0.08], rotation: [0, 0, 0], color: "#20282b" },
          { kind: "cube", name: "street-stair-run", location: [-0.95, -1.15, 0.18], scale: [0.45, 0.5, 0.18], rotation: [0, 0, 0], color: "#777777" },
          { kind: "cube", name: "outermost-southwest-post", location: [-1.48, -0.68, 1.45], scale: [0.06, 0.06, 1.25], rotation: [0, 0, 0], color: "#f2f2ee" },
          { kind: "cube", name: "cladding-southwest", location: [0, -0.62, 1.35], scale: [2.8, 0.08, 0.55], rotation: [0, 0, 0], color: "#f2f2ee" },
          { kind: "cube", name: "foundation-wall", location: [0, -0.68, 0.42], scale: [2.9, 0.09, 0.32], rotation: [0, 0, 0], color: "#33383a" }
        ],
        camera: { location: [3.5, -4.5, 2.8], target: [0, 0, 0.9] }
      },
      sourceBlendPath
    );
    expect(sourceResult.ok, sourceResult.stderr).toBe(true);
    const captureForOnePixelAssets = withOnePixelPhotoAndTextureEvidence(capture);
    const texturePaths = [
      "textures/carport-stone-foundation-normal.png",
      "textures/carport-stone-foundation-roughness.png",
      "textures/carport-white-panel-normal.png",
      "textures/carport-white-panel-roughness.png"
    ];
    const assetPaths = [
      ...capture.photos.map((photo) => photo.path),
      ...texturePaths
    ];
    await writeTextureFiles(outputDir, texturePaths);
    await writePhotoFiles(outputDir, capture.photos.map((photo) => photo.path));

    const renderPreset = {
      presetId: "carport-site-southwest-texture-type-colorspace-runtime",
      deliveryTier: "premium-sales",
      renderer: "eevee",
      resolution: { width: 128, height: 96 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    } as const;
    const renderManifest = buildDigitalViewingRenderManifest(captureForOnePixelAssets, renderPreset);
    const renderManifestWithWrongTextureColorSpace = {
      ...renderManifest,
      materials: renderManifest.materials.map((material) => ({
        ...material,
        textureMaps: material.textureMaps.map((textureMap) =>
          textureMap.path === "textures/carport-stone-foundation-normal.png"
            ? { ...textureMap, colorSpace: "sRGB" as const }
            : textureMap
        )
      }))
    };
    const assetBundleManifest = buildDigitalViewingAssetBundleManifest(captureForOnePixelAssets, renderManifest, {
      existingFiles: assetPaths,
      assetFiles: await assetFilesFor(outputDir, assetPaths)
    });
    const job = buildDigitalViewingBlenderRenderJob(captureForOnePixelAssets, renderPreset, sourceBlendPath, DefaultCapabilityManifest, assetBundleManifest);
    const jobWithWrongTextureColorSpace = {
      ...job,
      renderManifest: renderManifestWithWrongTextureColorSpace
    };

    const renderResult = await runBlenderJob(
      { outputDir, timeoutMs: 120_000 },
      jobWithWrongTextureColorSpace,
      "renders/carport-southwest-render.blend"
    );

    expect(renderResult.ok).toBe(false);
    expect(renderResult.stderr).toContain("Digital viewing texture map colorSpace does not match texture type: textures/carport-stone-foundation-normal.png expected Non-Color for normal, got sRGB");
  }, 180_000);

  it("refuses digital viewing render when a material texture map lacks declared pixel resolution metadata", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "nova-measured-render-texture-resolution-runtime-"));
    const captureRaw: unknown = JSON.parse(await readFile("fixtures/digital-viewing-carport-capture.json", "utf8"));
    const capture = DigitalViewingCaptureSchema.parse(captureRaw);
    const sourceBlendPath = "sources/carport-texture-resolution-runtime.blend";
    const sourceResult = await runBlenderJob(
      { outputDir, timeoutMs: 120_000 },
      {
        mode: "model",
        name: "carport-render-texture-resolution-runtime",
        primitives: [
          { kind: "cube", name: "carport-frame", location: [0, -0.2, 1.7], scale: [3.1, 0.06, 0.08], rotation: [0, 0, 0], color: "#f2f2ee" },
          { kind: "cube", name: "roof", location: [0, 0, 2.6], scale: [3.4, 2.4, 0.08], rotation: [0, 0, 0], color: "#20282b" },
          { kind: "cube", name: "street-stair-run", location: [-0.95, -1.15, 0.18], scale: [0.45, 0.5, 0.18], rotation: [0, 0, 0], color: "#777777" },
          { kind: "cube", name: "outermost-southwest-post", location: [-1.48, -0.68, 1.45], scale: [0.06, 0.06, 1.25], rotation: [0, 0, 0], color: "#f2f2ee" },
          { kind: "cube", name: "cladding-southwest", location: [0, -0.62, 1.35], scale: [2.8, 0.08, 0.55], rotation: [0, 0, 0], color: "#f2f2ee" },
          { kind: "cube", name: "foundation-wall", location: [0, -0.68, 0.42], scale: [2.9, 0.09, 0.32], rotation: [0, 0, 0], color: "#33383a" }
        ],
        camera: { location: [3.5, -4.5, 2.8], target: [0, 0, 0.9] }
      },
      sourceBlendPath
    );
    expect(sourceResult.ok, sourceResult.stderr).toBe(true);
    const captureForOnePixelAssets = withOnePixelPhotoAndTextureEvidence(capture);
    const texturePaths = [
      "textures/carport-stone-foundation-normal.png",
      "textures/carport-stone-foundation-roughness.png",
      "textures/carport-white-panel-normal.png",
      "textures/carport-white-panel-roughness.png"
    ];
    const assetPaths = [
      ...capture.photos.map((photo) => photo.path),
      ...texturePaths
    ];
    await writeTextureFiles(outputDir, texturePaths);
    await writePhotoFiles(outputDir, capture.photos.map((photo) => photo.path));

    const renderPreset = {
      presetId: "carport-site-southwest-texture-resolution-runtime",
      deliveryTier: "premium-sales",
      renderer: "eevee",
      resolution: { width: 128, height: 96 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    } as const;
    const renderManifest = buildDigitalViewingRenderManifest(captureForOnePixelAssets, renderPreset);
    const renderManifestWithoutTextureResolution = {
      ...renderManifest,
      materials: renderManifest.materials.map((material) => ({
        ...material,
        textureMaps: material.textureMaps.map((textureMap) => {
          const withoutResolution = { ...textureMap } as Record<string, unknown>;
          delete withoutResolution.pixelWidth;
          delete withoutResolution.pixelHeight;
          return withoutResolution;
        })
      }))
    };
    const assetBundleManifest = buildDigitalViewingAssetBundleManifest(captureForOnePixelAssets, renderManifest, {
      existingFiles: assetPaths,
      assetFiles: await assetFilesFor(outputDir, assetPaths)
    });
    const job = buildDigitalViewingBlenderRenderJob(captureForOnePixelAssets, renderPreset, sourceBlendPath, DefaultCapabilityManifest, assetBundleManifest);
    const jobWithoutTextureResolution = {
      ...job,
      renderManifest: renderManifestWithoutTextureResolution
    };

    const renderResult = await runBlenderJob(
      { outputDir, timeoutMs: 120_000 },
      jobWithoutTextureResolution,
      "renders/carport-southwest-render.blend"
    );

    expect(renderResult.ok).toBe(false);
    expect(renderResult.stderr).toContain("Digital viewing texture map requires declared pixelWidth and pixelHeight for reproducible material quality: textures/carport-stone-foundation-normal.png");
  }, 180_000);

  it("refuses digital viewing render when declared texture resolution disagrees with the asset file", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "nova-measured-render-texture-resolution-mismatch-runtime-"));
    const captureRaw: unknown = JSON.parse(await readFile("fixtures/digital-viewing-carport-capture.json", "utf8"));
    const capture = DigitalViewingCaptureSchema.parse(captureRaw);
    const sourceBlendPath = "sources/carport-texture-resolution-mismatch-runtime.blend";
    const sourceResult = await runBlenderJob(
      { outputDir, timeoutMs: 120_000 },
      {
        mode: "model",
        name: "carport-render-texture-resolution-mismatch-runtime",
        primitives: [
          { kind: "cube", name: "carport-frame", location: [0, -0.2, 1.7], scale: [3.1, 0.06, 0.08], rotation: [0, 0, 0], color: "#f2f2ee" },
          { kind: "cube", name: "roof", location: [0, 0, 2.6], scale: [3.4, 2.4, 0.08], rotation: [0, 0, 0], color: "#20282b" },
          { kind: "cube", name: "street-stair-run", location: [-0.95, -1.15, 0.18], scale: [0.45, 0.5, 0.18], rotation: [0, 0, 0], color: "#777777" },
          { kind: "cube", name: "outermost-southwest-post", location: [-1.48, -0.68, 1.45], scale: [0.06, 0.06, 1.25], rotation: [0, 0, 0], color: "#f2f2ee" },
          { kind: "cube", name: "cladding-southwest", location: [0, -0.62, 1.35], scale: [2.8, 0.08, 0.55], rotation: [0, 0, 0], color: "#f2f2ee" },
          { kind: "cube", name: "foundation-wall", location: [0, -0.68, 0.42], scale: [2.9, 0.09, 0.32], rotation: [0, 0, 0], color: "#33383a" }
        ],
        camera: { location: [3.5, -4.5, 2.8], target: [0, 0, 0.9] }
      },
      sourceBlendPath
    );
    expect(sourceResult.ok, sourceResult.stderr).toBe(true);
    const captureForOnePixelAssets = withOnePixelPhotoAndTextureEvidence(capture);
    const texturePaths = [
      "textures/carport-stone-foundation-normal.png",
      "textures/carport-stone-foundation-roughness.png",
      "textures/carport-white-panel-normal.png",
      "textures/carport-white-panel-roughness.png"
    ];
    const assetPaths = [
      ...capture.photos.map((photo) => photo.path),
      ...texturePaths
    ];
    await writeTextureFiles(outputDir, texturePaths);
    await writePhotoFiles(outputDir, capture.photos.map((photo) => photo.path));

    const renderPreset = {
      presetId: "carport-site-southwest-texture-resolution-mismatch-runtime",
      deliveryTier: "premium-sales",
      renderer: "eevee",
      resolution: { width: 128, height: 96 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    } as const;
    const renderManifest = buildDigitalViewingRenderManifest(captureForOnePixelAssets, renderPreset);
    const renderManifestWithTextureResolutionMismatch = {
      ...renderManifest,
      materials: renderManifest.materials.map((material) => ({
        ...material,
        textureMaps: material.textureMaps.map((textureMap) =>
          textureMap.path === "textures/carport-stone-foundation-normal.png"
            ? { ...textureMap, pixelWidth: 4096, pixelHeight: 4096 }
            : textureMap
        )
      }))
    };
    const assetBundleManifest = buildDigitalViewingAssetBundleManifest(captureForOnePixelAssets, renderManifest, {
      existingFiles: assetPaths,
      assetFiles: await assetFilesFor(outputDir, assetPaths)
    });
    const job = buildDigitalViewingBlenderRenderJob(captureForOnePixelAssets, renderPreset, sourceBlendPath, DefaultCapabilityManifest, assetBundleManifest);
    const jobWithTextureResolutionMismatch = {
      ...job,
      renderManifest: renderManifestWithTextureResolutionMismatch
    };

    const renderResult = await runBlenderJob(
      { outputDir, timeoutMs: 120_000 },
      jobWithTextureResolutionMismatch,
      "renders/carport-southwest-render.blend"
    );

    expect(renderResult.ok).toBe(false);
    expect(renderResult.stderr).toContain("Digital viewing texture map declared resolution does not match asset file: textures/carport-stone-foundation-normal.png declared 4096x4096, actual 1x1");
  }, 180_000);

  it("refuses digital viewing render when material surface mapping lacks a positive physical scale", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "nova-measured-render-surface-mapping-scale-runtime-"));
    const captureRaw: unknown = JSON.parse(await readFile("fixtures/digital-viewing-carport-capture.json", "utf8"));
    const capture = DigitalViewingCaptureSchema.parse(captureRaw);
    const sourceBlendPath = "sources/carport-surface-mapping-scale-runtime.blend";
    const sourceResult = await runBlenderJob(
      { outputDir, timeoutMs: 120_000 },
      {
        mode: "model",
        name: "carport-render-surface-mapping-scale-runtime",
        primitives: [
          { kind: "cube", name: "carport-frame", location: [0, -0.2, 1.7], scale: [3.1, 0.06, 0.08], rotation: [0, 0, 0], color: "#f2f2ee" },
          { kind: "cube", name: "roof", location: [0, 0, 2.6], scale: [3.4, 2.4, 0.08], rotation: [0, 0, 0], color: "#20282b" },
          { kind: "cube", name: "street-stair-run", location: [-0.95, -1.15, 0.18], scale: [0.45, 0.5, 0.18], rotation: [0, 0, 0], color: "#777777" },
          { kind: "cube", name: "outermost-southwest-post", location: [-1.48, -0.68, 1.45], scale: [0.06, 0.06, 1.25], rotation: [0, 0, 0], color: "#f2f2ee" },
          { kind: "cube", name: "cladding-southwest", location: [0, -0.62, 1.35], scale: [2.8, 0.08, 0.55], rotation: [0, 0, 0], color: "#f2f2ee" },
          { kind: "cube", name: "foundation-wall", location: [0, -0.68, 0.42], scale: [2.9, 0.09, 0.32], rotation: [0, 0, 0], color: "#33383a" }
        ],
        camera: { location: [3.5, -4.5, 2.8], target: [0, 0, 0.9] }
      },
      sourceBlendPath
    );
    expect(sourceResult.ok, sourceResult.stderr).toBe(true);
    const captureForOnePixelAssets = withOnePixelPhotoAndTextureEvidence(capture);
    const texturePaths = [
      "textures/carport-stone-foundation-normal.png",
      "textures/carport-stone-foundation-roughness.png",
      "textures/carport-white-panel-normal.png",
      "textures/carport-white-panel-roughness.png"
    ];
    const assetPaths = [
      ...capture.photos.map((photo) => photo.path),
      ...texturePaths
    ];
    await writeTextureFiles(outputDir, texturePaths);
    await writePhotoFiles(outputDir, capture.photos.map((photo) => photo.path));

    const renderPreset = {
      presetId: "carport-site-southwest-surface-mapping-scale-runtime",
      deliveryTier: "premium-sales",
      renderer: "eevee",
      resolution: { width: 128, height: 96 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    } as const;
    const renderManifest = buildDigitalViewingRenderManifest(captureForOnePixelAssets, renderPreset);
    const renderManifestWithInvalidSurfaceMappingScale = {
      ...renderManifest,
      materials: renderManifest.materials.map((material) =>
        material.materialId === "painted-white-wood-panel" && material.surfaceMapping
          ? { ...material, surfaceMapping: { ...material.surfaceMapping, scaleMm: 0 } }
          : material
      )
    };
    const assetBundleManifest = buildDigitalViewingAssetBundleManifest(captureForOnePixelAssets, renderManifest, {
      existingFiles: assetPaths,
      assetFiles: await assetFilesFor(outputDir, assetPaths)
    });
    const job = buildDigitalViewingBlenderRenderJob(captureForOnePixelAssets, renderPreset, sourceBlendPath, DefaultCapabilityManifest, assetBundleManifest);
    const jobWithInvalidSurfaceMappingScale = {
      ...job,
      renderManifest: renderManifestWithInvalidSurfaceMappingScale
    };

    const renderResult = await runBlenderJob(
      { outputDir, timeoutMs: 120_000 },
      jobWithInvalidSurfaceMappingScale,
      "renders/carport-southwest-render.blend"
    );

    expect(renderResult.ok).toBe(false);
    expect(renderResult.stderr).toContain("Digital viewing material surfaceMapping requires positive scaleMm for reproducible physical material placement: painted-white-wood-panel");
  }, 180_000);

  it("refuses digital viewing render when material surface mapping does not declare any physical faces", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "nova-measured-render-surface-mapping-faces-runtime-"));
    const captureRaw: unknown = JSON.parse(await readFile("fixtures/digital-viewing-carport-capture.json", "utf8"));
    const capture = DigitalViewingCaptureSchema.parse(captureRaw);
    const sourceBlendPath = "sources/carport-surface-mapping-faces-runtime.blend";
    const sourceResult = await runBlenderJob(
      { outputDir, timeoutMs: 120_000 },
      {
        mode: "model",
        name: "carport-render-surface-mapping-faces-runtime",
        primitives: [
          { kind: "cube", name: "carport-frame", location: [0, -0.2, 1.7], scale: [3.1, 0.06, 0.08], rotation: [0, 0, 0], color: "#f2f2ee" },
          { kind: "cube", name: "roof", location: [0, 0, 2.6], scale: [3.4, 2.4, 0.08], rotation: [0, 0, 0], color: "#20282b" },
          { kind: "cube", name: "street-stair-run", location: [-0.95, -1.15, 0.18], scale: [0.45, 0.5, 0.18], rotation: [0, 0, 0], color: "#777777" },
          { kind: "cube", name: "outermost-southwest-post", location: [-1.48, -0.68, 1.45], scale: [0.06, 0.06, 1.25], rotation: [0, 0, 0], color: "#f2f2ee" },
          { kind: "cube", name: "cladding-southwest", location: [0, -0.62, 1.35], scale: [2.8, 0.08, 0.55], rotation: [0, 0, 0], color: "#f2f2ee" },
          { kind: "cube", name: "foundation-wall", location: [0, -0.68, 0.42], scale: [2.9, 0.09, 0.32], rotation: [0, 0, 0], color: "#33383a" }
        ],
        camera: { location: [3.5, -4.5, 2.8], target: [0, 0, 0.9] }
      },
      sourceBlendPath
    );
    expect(sourceResult.ok, sourceResult.stderr).toBe(true);
    const captureForOnePixelAssets = withOnePixelPhotoAndTextureEvidence(capture);
    const texturePaths = [
      "textures/carport-stone-foundation-normal.png",
      "textures/carport-stone-foundation-roughness.png",
      "textures/carport-white-panel-normal.png",
      "textures/carport-white-panel-roughness.png"
    ];
    const assetPaths = [
      ...capture.photos.map((photo) => photo.path),
      ...texturePaths
    ];
    await writeTextureFiles(outputDir, texturePaths);
    await writePhotoFiles(outputDir, capture.photos.map((photo) => photo.path));

    const renderPreset = {
      presetId: "carport-site-southwest-surface-mapping-faces-runtime",
      deliveryTier: "premium-sales",
      renderer: "eevee",
      resolution: { width: 128, height: 96 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    } as const;
    const renderManifest = buildDigitalViewingRenderManifest(captureForOnePixelAssets, renderPreset);
    const renderManifestWithMissingSurfaceMappingFaces = {
      ...renderManifest,
      materials: renderManifest.materials.map((material) =>
        material.materialId === "painted-white-wood-panel" && material.surfaceMapping
          ? { ...material, surfaceMapping: { ...material.surfaceMapping, faces: [] } }
          : material
      )
    };
    const assetBundleManifest = buildDigitalViewingAssetBundleManifest(captureForOnePixelAssets, renderManifest, {
      existingFiles: assetPaths,
      assetFiles: await assetFilesFor(outputDir, assetPaths)
    });
    const job = buildDigitalViewingBlenderRenderJob(captureForOnePixelAssets, renderPreset, sourceBlendPath, DefaultCapabilityManifest, assetBundleManifest);
    const jobWithMissingSurfaceMappingFaces = {
      ...job,
      renderManifest: renderManifestWithMissingSurfaceMappingFaces
    };

    const renderResult = await runBlenderJob(
      { outputDir, timeoutMs: 120_000 },
      jobWithMissingSurfaceMappingFaces,
      "renders/carport-southwest-render.blend"
    );

    expect(renderResult.ok).toBe(false);
    expect(renderResult.stderr).toContain("Digital viewing material surfaceMapping requires at least one physical face for reproducible material placement: painted-white-wood-panel");
  }, 180_000);

  it("refuses digital viewing render when material appearance calibration lacks a method", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "nova-measured-render-appearance-calibration-method-runtime-"));
    const captureRaw: unknown = JSON.parse(await readFile("fixtures/digital-viewing-carport-capture.json", "utf8"));
    const capture = DigitalViewingCaptureSchema.parse(captureRaw);
    const sourceBlendPath = "sources/carport-appearance-calibration-method-runtime.blend";
    const sourceResult = await runBlenderJob(
      { outputDir, timeoutMs: 120_000 },
      {
        mode: "model",
        name: "carport-render-appearance-calibration-method-runtime",
        primitives: [
          { kind: "cube", name: "carport-frame", location: [0, -0.2, 1.7], scale: [3.1, 0.06, 0.08], rotation: [0, 0, 0], color: "#f2f2ee" },
          { kind: "cube", name: "roof", location: [0, 0, 2.6], scale: [3.4, 2.4, 0.08], rotation: [0, 0, 0], color: "#20282b" },
          { kind: "cube", name: "street-stair-run", location: [-0.95, -1.15, 0.18], scale: [0.45, 0.5, 0.18], rotation: [0, 0, 0], color: "#777777" },
          { kind: "cube", name: "outermost-southwest-post", location: [-1.48, -0.68, 1.45], scale: [0.06, 0.06, 1.25], rotation: [0, 0, 0], color: "#f2f2ee" },
          { kind: "cube", name: "cladding-southwest", location: [0, -0.62, 1.35], scale: [2.8, 0.08, 0.55], rotation: [0, 0, 0], color: "#f2f2ee" },
          { kind: "cube", name: "foundation-wall", location: [0, -0.68, 0.42], scale: [2.9, 0.09, 0.32], rotation: [0, 0, 0], color: "#33383a" }
        ],
        camera: { location: [3.5, -4.5, 2.8], target: [0, 0, 0.9] }
      },
      sourceBlendPath
    );
    expect(sourceResult.ok, sourceResult.stderr).toBe(true);
    const captureForOnePixelAssets = withOnePixelPhotoAndTextureEvidence(capture);
    const texturePaths = [
      "textures/carport-stone-foundation-normal.png",
      "textures/carport-stone-foundation-roughness.png",
      "textures/carport-white-panel-normal.png",
      "textures/carport-white-panel-roughness.png"
    ];
    const assetPaths = [
      ...capture.photos.map((photo) => photo.path),
      ...texturePaths
    ];
    await writeTextureFiles(outputDir, texturePaths);
    await writePhotoFiles(outputDir, capture.photos.map((photo) => photo.path));

    const renderPreset = {
      presetId: "carport-site-southwest-appearance-calibration-method-runtime",
      deliveryTier: "premium-sales",
      renderer: "eevee",
      resolution: { width: 128, height: 96 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    } as const;
    const renderManifest = buildDigitalViewingRenderManifest(captureForOnePixelAssets, renderPreset);
    const renderManifestWithMissingAppearanceCalibrationMethod = {
      ...renderManifest,
      materials: renderManifest.materials.map((material) => {
        if (material.materialId !== "painted-white-wood-panel" || !material.appearanceCalibration) {
          return material;
        }
        const appearanceCalibrationWithoutMethod = { ...material.appearanceCalibration } as Record<string, unknown>;
        delete appearanceCalibrationWithoutMethod.method;
        return { ...material, appearanceCalibration: appearanceCalibrationWithoutMethod };
      })
    };
    const assetBundleManifest = buildDigitalViewingAssetBundleManifest(captureForOnePixelAssets, renderManifest, {
      existingFiles: assetPaths,
      assetFiles: await assetFilesFor(outputDir, assetPaths)
    });
    const job = buildDigitalViewingBlenderRenderJob(captureForOnePixelAssets, renderPreset, sourceBlendPath, DefaultCapabilityManifest, assetBundleManifest);
    const jobWithMissingAppearanceCalibrationMethod = {
      ...job,
      renderManifest: renderManifestWithMissingAppearanceCalibrationMethod
    };

    const renderResult = await runBlenderJob(
      { outputDir, timeoutMs: 120_000 },
      jobWithMissingAppearanceCalibrationMethod,
      "renders/carport-southwest-render.blend"
    );

    expect(renderResult.ok).toBe(false);
    expect(renderResult.stderr).toContain("Digital viewing material appearanceCalibration requires a supported method for reproducible material color and finish: painted-white-wood-panel");
  }, 180_000);

  it("refuses digital viewing render when photo-based material appearance calibration lacks a source photo", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "nova-measured-render-appearance-calibration-source-runtime-"));
    const captureRaw: unknown = JSON.parse(await readFile("fixtures/digital-viewing-carport-capture.json", "utf8"));
    const capture = DigitalViewingCaptureSchema.parse(captureRaw);
    const sourceBlendPath = "sources/carport-appearance-calibration-source-runtime.blend";
    const sourceResult = await runBlenderJob(
      { outputDir, timeoutMs: 120_000 },
      {
        mode: "model",
        name: "carport-render-appearance-calibration-source-runtime",
        primitives: [
          { kind: "cube", name: "carport-frame", location: [0, -0.2, 1.7], scale: [3.1, 0.06, 0.08], rotation: [0, 0, 0], color: "#f2f2ee" },
          { kind: "cube", name: "roof", location: [0, 0, 2.6], scale: [3.4, 2.4, 0.08], rotation: [0, 0, 0], color: "#20282b" },
          { kind: "cube", name: "street-stair-run", location: [-0.95, -1.15, 0.18], scale: [0.45, 0.5, 0.18], rotation: [0, 0, 0], color: "#777777" },
          { kind: "cube", name: "outermost-southwest-post", location: [-1.48, -0.68, 1.45], scale: [0.06, 0.06, 1.25], rotation: [0, 0, 0], color: "#f2f2ee" },
          { kind: "cube", name: "cladding-southwest", location: [0, -0.62, 1.35], scale: [2.8, 0.08, 0.55], rotation: [0, 0, 0], color: "#f2f2ee" },
          { kind: "cube", name: "foundation-wall", location: [0, -0.68, 0.42], scale: [2.9, 0.09, 0.32], rotation: [0, 0, 0], color: "#33383a" }
        ],
        camera: { location: [3.5, -4.5, 2.8], target: [0, 0, 0.9] }
      },
      sourceBlendPath
    );
    expect(sourceResult.ok, sourceResult.stderr).toBe(true);
    const captureForOnePixelAssets = withOnePixelPhotoAndTextureEvidence(capture);
    const texturePaths = [
      "textures/carport-stone-foundation-normal.png",
      "textures/carport-stone-foundation-roughness.png",
      "textures/carport-white-panel-normal.png",
      "textures/carport-white-panel-roughness.png"
    ];
    const assetPaths = [
      ...capture.photos.map((photo) => photo.path),
      ...texturePaths
    ];
    await writeTextureFiles(outputDir, texturePaths);
    await writePhotoFiles(outputDir, capture.photos.map((photo) => photo.path));

    const renderPreset = {
      presetId: "carport-site-southwest-appearance-calibration-source-runtime",
      deliveryTier: "premium-sales",
      renderer: "eevee",
      resolution: { width: 128, height: 96 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    } as const;
    const renderManifest = buildDigitalViewingRenderManifest(captureForOnePixelAssets, renderPreset);
    const renderManifestWithMissingAppearanceCalibrationSourcePhoto = {
      ...renderManifest,
      materials: renderManifest.materials.map((material) => {
        if (material.materialId !== "painted-white-wood-panel" || !material.appearanceCalibration) {
          return material;
        }
        const appearanceCalibrationWithoutSourcePhoto = { ...material.appearanceCalibration } as Record<string, unknown>;
        delete appearanceCalibrationWithoutSourcePhoto.sourcePhoto;
        return { ...material, appearanceCalibration: appearanceCalibrationWithoutSourcePhoto };
      })
    };
    const assetBundleManifest = buildDigitalViewingAssetBundleManifest(captureForOnePixelAssets, renderManifest, {
      existingFiles: assetPaths,
      assetFiles: await assetFilesFor(outputDir, assetPaths)
    });
    const job = buildDigitalViewingBlenderRenderJob(captureForOnePixelAssets, renderPreset, sourceBlendPath, DefaultCapabilityManifest, assetBundleManifest);
    const jobWithMissingAppearanceCalibrationSourcePhoto = {
      ...job,
      renderManifest: renderManifestWithMissingAppearanceCalibrationSourcePhoto
    };

    const renderResult = await runBlenderJob(
      { outputDir, timeoutMs: 120_000 },
      jobWithMissingAppearanceCalibrationSourcePhoto,
      "renders/carport-southwest-render.blend"
    );

    expect(renderResult.ok).toBe(false);
    expect(renderResult.stderr).toContain("Digital viewing material appearanceCalibration requires sourcePhoto for photo-based calibration: painted-white-wood-panel");
  }, 180_000);

  it("refuses digital viewing render when photo-observed material appearance calibration lacks illuminant", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "nova-measured-render-appearance-calibration-illuminant-runtime-"));
    const captureRaw: unknown = JSON.parse(await readFile("fixtures/digital-viewing-carport-capture.json", "utf8"));
    const capture = DigitalViewingCaptureSchema.parse(captureRaw);
    const sourceBlendPath = "sources/carport-appearance-calibration-illuminant-runtime.blend";
    const sourceResult = await runBlenderJob(
      { outputDir, timeoutMs: 120_000 },
      {
        mode: "model",
        name: "carport-render-appearance-calibration-illuminant-runtime",
        primitives: [
          { kind: "cube", name: "carport-frame", location: [0, -0.2, 1.7], scale: [3.1, 0.06, 0.08], rotation: [0, 0, 0], color: "#f2f2ee" },
          { kind: "cube", name: "roof", location: [0, 0, 2.6], scale: [3.4, 2.4, 0.08], rotation: [0, 0, 0], color: "#20282b" },
          { kind: "cube", name: "street-stair-run", location: [-0.95, -1.15, 0.18], scale: [0.45, 0.5, 0.18], rotation: [0, 0, 0], color: "#777777" },
          { kind: "cube", name: "outermost-southwest-post", location: [-1.48, -0.68, 1.45], scale: [0.06, 0.06, 1.25], rotation: [0, 0, 0], color: "#f2f2ee" },
          { kind: "cube", name: "cladding-southwest", location: [0, -0.62, 1.35], scale: [2.8, 0.08, 0.55], rotation: [0, 0, 0], color: "#f2f2ee" },
          { kind: "cube", name: "foundation-wall", location: [0, -0.68, 0.42], scale: [2.9, 0.09, 0.32], rotation: [0, 0, 0], color: "#33383a" }
        ],
        camera: { location: [3.5, -4.5, 2.8], target: [0, 0, 0.9] }
      },
      sourceBlendPath
    );
    expect(sourceResult.ok, sourceResult.stderr).toBe(true);
    const captureForOnePixelAssets = withOnePixelPhotoAndTextureEvidence(capture);
    const texturePaths = [
      "textures/carport-stone-foundation-normal.png",
      "textures/carport-stone-foundation-roughness.png",
      "textures/carport-white-panel-normal.png",
      "textures/carport-white-panel-roughness.png"
    ];
    const assetPaths = [
      ...capture.photos.map((photo) => photo.path),
      ...texturePaths
    ];
    await writeTextureFiles(outputDir, texturePaths);
    await writePhotoFiles(outputDir, capture.photos.map((photo) => photo.path));

    const renderPreset = {
      presetId: "carport-site-southwest-appearance-calibration-illuminant-runtime",
      deliveryTier: "premium-sales",
      renderer: "eevee",
      resolution: { width: 128, height: 96 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    } as const;
    const renderManifest = buildDigitalViewingRenderManifest(captureForOnePixelAssets, renderPreset);
    const renderManifestWithMissingAppearanceCalibrationIlluminant = {
      ...renderManifest,
      materials: renderManifest.materials.map((material) => {
        if (material.materialId !== "painted-white-wood-panel" || !material.appearanceCalibration) {
          return material;
        }
        const appearanceCalibrationWithoutIlluminant = { ...material.appearanceCalibration } as Record<string, unknown>;
        delete appearanceCalibrationWithoutIlluminant.illuminant;
        return { ...material, appearanceCalibration: appearanceCalibrationWithoutIlluminant };
      })
    };
    const assetBundleManifest = buildDigitalViewingAssetBundleManifest(captureForOnePixelAssets, renderManifest, {
      existingFiles: assetPaths,
      assetFiles: await assetFilesFor(outputDir, assetPaths)
    });
    const job = buildDigitalViewingBlenderRenderJob(captureForOnePixelAssets, renderPreset, sourceBlendPath, DefaultCapabilityManifest, assetBundleManifest);
    const jobWithMissingAppearanceCalibrationIlluminant = {
      ...job,
      renderManifest: renderManifestWithMissingAppearanceCalibrationIlluminant
    };

    const renderResult = await runBlenderJob(
      { outputDir, timeoutMs: 120_000 },
      jobWithMissingAppearanceCalibrationIlluminant,
      "renders/carport-southwest-render.blend"
    );

    expect(renderResult.ok).toBe(false);
    expect(renderResult.stderr).toContain("Digital viewing material appearanceCalibration requires illuminant for photo-observed material color and finish: painted-white-wood-panel");
  }, 180_000);

  it("refuses digital viewing render when material appearance calibration uses a photo outside material evidence", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "nova-measured-render-appearance-calibration-evidence-runtime-"));
    const captureRaw: unknown = JSON.parse(await readFile("fixtures/digital-viewing-carport-capture.json", "utf8"));
    const capture = DigitalViewingCaptureSchema.parse(captureRaw);
    const sourceBlendPath = "sources/carport-appearance-calibration-evidence-runtime.blend";
    const sourceResult = await runBlenderJob(
      { outputDir, timeoutMs: 120_000 },
      {
        mode: "model",
        name: "carport-render-appearance-calibration-evidence-runtime",
        primitives: [
          { kind: "cube", name: "carport-frame", location: [0, -0.2, 1.7], scale: [3.1, 0.06, 0.08], rotation: [0, 0, 0], color: "#f2f2ee" },
          { kind: "cube", name: "roof", location: [0, 0, 2.6], scale: [3.4, 2.4, 0.08], rotation: [0, 0, 0], color: "#20282b" },
          { kind: "cube", name: "street-stair-run", location: [-0.95, -1.15, 0.18], scale: [0.45, 0.5, 0.18], rotation: [0, 0, 0], color: "#777777" },
          { kind: "cube", name: "outermost-southwest-post", location: [-1.48, -0.68, 1.45], scale: [0.06, 0.06, 1.25], rotation: [0, 0, 0], color: "#f2f2ee" },
          { kind: "cube", name: "cladding-southwest", location: [0, -0.62, 1.35], scale: [2.8, 0.08, 0.55], rotation: [0, 0, 0], color: "#f2f2ee" },
          { kind: "cube", name: "foundation-wall", location: [0, -0.68, 0.42], scale: [2.9, 0.09, 0.32], rotation: [0, 0, 0], color: "#33383a" }
        ],
        camera: { location: [3.5, -4.5, 2.8], target: [0, 0, 0.9] }
      },
      sourceBlendPath
    );
    expect(sourceResult.ok, sourceResult.stderr).toBe(true);
    const captureForOnePixelAssets = withOnePixelPhotoAndTextureEvidence(capture);
    const texturePaths = [
      "textures/carport-stone-foundation-normal.png",
      "textures/carport-stone-foundation-roughness.png",
      "textures/carport-white-panel-normal.png",
      "textures/carport-white-panel-roughness.png"
    ];
    const assetPaths = [
      ...capture.photos.map((photo) => photo.path),
      ...texturePaths
    ];
    await writeTextureFiles(outputDir, texturePaths);
    await writePhotoFiles(outputDir, capture.photos.map((photo) => photo.path));

    const renderPreset = {
      presetId: "carport-site-southwest-appearance-calibration-evidence-runtime",
      deliveryTier: "premium-sales",
      renderer: "eevee",
      resolution: { width: 128, height: 96 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    } as const;
    const renderManifest = buildDigitalViewingRenderManifest(captureForOnePixelAssets, renderPreset);
    const renderManifestWithMismatchedAppearanceCalibrationEvidence = {
      ...renderManifest,
      materials: renderManifest.materials.map((material) => {
        if (material.materialId !== "painted-white-wood-panel" || !material.appearanceCalibration) {
          return material;
        }
        return {
          ...material,
          appearanceCalibration: {
            ...material.appearanceCalibration,
            sourcePhoto: "photos/carport-south.jpg"
          }
        };
      })
    };
    const assetBundleManifest = buildDigitalViewingAssetBundleManifest(captureForOnePixelAssets, renderManifest, {
      existingFiles: assetPaths,
      assetFiles: await assetFilesFor(outputDir, assetPaths)
    });
    const job = buildDigitalViewingBlenderRenderJob(captureForOnePixelAssets, renderPreset, sourceBlendPath, DefaultCapabilityManifest, assetBundleManifest);
    const jobWithMismatchedAppearanceCalibrationEvidence = {
      ...job,
      renderManifest: renderManifestWithMismatchedAppearanceCalibrationEvidence
    };

    const renderResult = await runBlenderJob(
      { outputDir, timeoutMs: 120_000 },
      jobWithMismatchedAppearanceCalibrationEvidence,
      "renders/carport-southwest-render.blend"
    );

    expect(renderResult.ok).toBe(false);
    expect(renderResult.stderr).toContain("Digital viewing material appearanceCalibration sourcePhoto must be declared as material evidence: painted-white-wood-panel");
  }, 180_000);

  it("renders the carport exterior-structure capture against matching locked Blender hosts", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "nova-measured-carport-render-"));
    const captureRaw: unknown = JSON.parse(await readFile("fixtures/digital-viewing-carport-capture.json", "utf8"));
    const capture = DigitalViewingCaptureSchema.parse(captureRaw);
    const sourceBlendPath = "sources/carport-locked.blend";
    const sourceResult = await runBlenderJob(
      { outputDir, timeoutMs: 120_000 },
      {
        mode: "model",
        name: "carport-render-smoke",
        primitives: [
          {
            kind: "cube",
            name: "carport-frame",
            location: [0, -0.2, 1.7],
            scale: [3.1, 0.06, 0.08],
            rotation: [0, 0, 0],
            color: "#f2f2ee"
          },
          {
            kind: "cube",
            name: "roof",
            location: [0, 0, 2.6],
            scale: [3.4, 2.4, 0.08],
            rotation: [0, 0, 0],
            color: "#20282b"
          },
          {
            kind: "cube",
            name: "street-stair-run",
            location: [-0.95, -1.15, 0.18],
            scale: [0.45, 0.5, 0.18],
            rotation: [0, 0, 0],
            color: "#777777"
          },
          {
            kind: "cube",
            name: "outermost-southwest-post",
            location: [-1.48, -0.68, 1.45],
            scale: [0.06, 0.06, 1.25],
            rotation: [0, 0, 0],
            color: "#f2f2ee"
          },
          {
            kind: "cube",
            name: "cladding-southwest",
            location: [0, -0.62, 1.35],
            scale: [2.8, 0.08, 0.55],
            rotation: [0, 0, 0],
            color: "#f2f2ee"
          },
          {
            kind: "cube",
            name: "foundation-wall",
            location: [0, -0.68, 0.42],
            scale: [2.9, 0.09, 0.32],
            rotation: [0, 0, 0],
            color: "#33383a"
          }
        ],
        camera: { location: [3.5, -4.5, 2.8], target: [0, 0, 0.9] }
      },
      sourceBlendPath
    );
    expect(sourceResult.ok, sourceResult.stderr).toBe(true);
    const captureForOnePixelAssets = withOnePixelPhotoAndTextureEvidence(capture);
    const texturePaths = [
      "textures/carport-stone-foundation-normal.png",
      "textures/carport-stone-foundation-roughness.png",
      "textures/carport-white-panel-normal.png",
      "textures/carport-white-panel-roughness.png"
    ];
    const assetPaths = [
      ...capture.photos.map((photo) => photo.path),
      ...texturePaths
    ];
    await writeTextureFiles(outputDir, texturePaths);
    await writePhotoFiles(outputDir, capture.photos.map((photo) => photo.path));

    const renderPreset = {
      presetId: "carport-site-southwest-smoke",
      deliveryTier: "premium-sales",
      renderer: "eevee",
      resolution: { width: 128, height: 96 },
      camera: { mode: "perspective", sector: "south", focalLengthMm: 45, referencePhoto: "photos/carport-south.jpg" },
      lighting: { environment: "site-reference", colorTemperatureK: 5600, intensity: 0.75, referencePhoto: "photos/carport-south.jpg" },
      outputPath: "renders/carport-southwest.png"
    } as const;
    const renderManifest = buildDigitalViewingRenderManifest(captureForOnePixelAssets, renderPreset);
    const assetBundleManifest = buildDigitalViewingAssetBundleManifest(captureForOnePixelAssets, renderManifest, {
      existingFiles: assetPaths,
      assetFiles: await assetFilesFor(outputDir, assetPaths)
    });
    const job = buildDigitalViewingBlenderRenderJob(captureForOnePixelAssets, renderPreset, sourceBlendPath, DefaultCapabilityManifest, assetBundleManifest);
    const renderResult = await runBlenderJob(
      { outputDir, timeoutMs: 120_000 },
      job,
      "renders/carport-southwest-render.blend"
    );
    expect(renderResult.ok, renderResult.stderr).toBe(true);

    const manifest = JSON.parse(await readFile(path.join(outputDir, "renders/carport-southwest.manifest.json"), "utf8")) as {
      assetType: string;
      notGeometryAuthority: boolean;
      capabilityManifest: { supportedTemplates: string[] };
      blenderExecution: {
        hostValidation: { declaredRenderableHosts: string[] };
        measurementApplication: {
          applied: Array<{
            measurementId: string;
            hostElementId: string;
            referenceFrame: string;
            value: number;
            unit: string;
            tolerance?: number;
            sourceOfTruth: string;
          }>;
        };
        materialApplication: {
          applied: Array<{
            object: string;
            materialId: string;
            presetId?: string;
            surfaceMapping?: {
              projection: string;
              faces: string[];
              scaleMm: number;
              rotationDeg: number;
              sourcePhoto?: string;
            };
            appearanceCalibration?: {
              method: string;
              sourcePhoto?: string;
              illuminant?: string;
              confidence: string;
            };
          }>;
          missingHosts: string[];
          textures: {
            applied: Array<{ path: string; type: string; scaleMm?: number; pixelWidth?: number; pixelHeight?: number }>;
            missing: Array<{ path: string; type: string; scaleMm?: number; pixelWidth?: number; pixelHeight?: number }>;
          };
        };
        conditionApplication: {
          applied: Array<{
            conditionId: string;
            object: string;
            hostElementId: string;
            face: string;
            surfacePlacement: {
              hostElementId: string;
              face: string;
              u: number;
              v: number;
              widthMm: number;
              heightMm: number;
              rotationDeg: number;
            };
          }>;
        };
        camera: {
          sector: string;
          mode: string;
          referencePhoto?: string;
          appliedDistanceMm?: number;
          appliedDistanceSource?: string;
          appliedFocalLength35mmEquivalent?: number;
          appliedFocalLengthSource?: string;
          cameraLocationM?: [number, number, number];
          cameraTargetM?: [number, number, number];
          sensorWidthMm?: number;
          executedYawDeg?: number;
          executedPitchDeg?: number;
          cameraReference?: {
            sourceOfTruth: string;
            referencePhoto: string;
            sector: string;
            cameraMode: string;
            focalLength35mmEquivalent: number;
            cameraDistanceMm: number;
          };
        };
        lighting: { environment: string; referencePhoto?: string };
      };
    };
    expect(manifest.assetType).toBe("exterior-structure");
    expect(manifest.notGeometryAuthority).toBe(true);
    expect(manifest.capabilityManifest.supportedTemplates).toContain("measured-digital-viewing");
    expect(manifest.blenderExecution.hostValidation.declaredRenderableHosts).toEqual([
      "carport-frame",
      "cladding-southwest",
      "foundation-wall",
      "outermost-southwest-post",
      "roof",
      "street-stair-run"
    ]);
    expect(manifest.blenderExecution.measurementApplication.applied).toEqual(
      capture.measurements
        .slice()
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((measurement) => ({
          measurementId: measurement.id,
          hostElementId: measurement.placement?.hostElementId,
          referenceFrame: measurement.placement?.referenceFrame ?? "asset-local",
          value: measurement.value,
          unit: measurement.unit,
          tolerance: measurement.tolerance,
          sourceOfTruth: "declared-measurement-value-used-by-blender"
        }))
    );
    expect(manifest.blenderExecution.materialApplication.applied).toEqual([
      {
        object: "foundation-wall",
        materialId: "dark-stone-foundation",
        presetId: "stone-masonry",
        pbr: {
          baseColor: "#33383a",
          roughness: 0.88,
          metallic: 0,
          specular: 0.16,
          transmission: 0,
          normalSource: "photo",
          textureScaleMm: 500
        },
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
        sourcePhotoIdentities: [
          onePixelPhotoIdentity("material-source", "photos/carport-south.jpg"),
          onePixelPhotoIdentity("material-source", "photos/carport-west.jpg"),
          onePixelPhotoIdentity("surface-mapping", "photos/carport-south.jpg"),
          onePixelPhotoIdentity("appearance-calibration", "photos/carport-south.jpg")
        ],
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
        presetId: "painted-wood",
        pbr: {
          baseColor: "#f2f2ee",
          roughness: 0.52,
          metallic: 0,
          specular: 0.28,
          transmission: 0,
          normalSource: "photo",
          textureScaleMm: 900
        },
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
        sourcePhotoIdentities: [
          onePixelPhotoIdentity("material-source", "photos/carport-east.jpg"),
          onePixelPhotoIdentity("material-source", "photos/carport-west.jpg"),
          onePixelPhotoIdentity("surface-mapping", "photos/carport-west.jpg"),
          onePixelPhotoIdentity("appearance-calibration", "photos/carport-west.jpg")
        ],
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
    ]);
    expect(manifest.blenderExecution.materialApplication.missingHosts).toEqual([]);
    expect(manifest.blenderExecution.materialApplication.textures.applied).toEqual([
      { path: "textures/carport-stone-foundation-normal.png", type: "normal", colorSpace: "Non-Color", scaleMm: 500, pixelWidth: 1, pixelHeight: 1 },
      { path: "textures/carport-stone-foundation-roughness.png", type: "roughness", colorSpace: "Non-Color", scaleMm: 500, pixelWidth: 1, pixelHeight: 1 },
      { path: "textures/carport-white-panel-normal.png", type: "normal", colorSpace: "Non-Color", scaleMm: 900, pixelWidth: 1, pixelHeight: 1 },
      { path: "textures/carport-white-panel-roughness.png", type: "roughness", colorSpace: "Non-Color", scaleMm: 900, pixelWidth: 1, pixelHeight: 1 }
    ].map(withOnePixelTextureIdentity));
    expect(manifest.blenderExecution.materialApplication.textures.missing).toEqual([]);
    expect(manifest.blenderExecution.conditionApplication.applied).toContainEqual({
      conditionId: "white-panel-weathering",
      object: "condition-white-panel-weathering",
      hostElementId: "cladding-southwest",
      face: "front",
      sourcePhotoIdentities: [
        { usage: "condition-source", path: "photos/carport-detail-panel.jpg", ...ConditionDetailPngIdentity }
      ],
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
    });
    expect(manifest.blenderExecution.camera).toEqual({
      cameraName: "Measured_Render_south",
      sector: "south",
      mode: "perspective",
      referencePhoto: "photos/carport-south.jpg",
      referencePhotoIdentity: {
        path: "photos/carport-south.jpg",
        ...OnePixelPngIdentity
      },
      appliedDistanceMm: 9000,
      appliedDistanceSource: "camera-reference",
      appliedFocalLength35mmEquivalent: 45,
      appliedFocalLengthSource: "camera-reference",
      cameraLocationM: [0, -11.4, 3.73],
      cameraTargetM: [0, 0, 1.35],
      sensorWidthMm: 36,
      executedYawDeg: 0,
      executedPitchDeg: -11.792372,
      cameraReference: {
        sourceOfTruth: "derived-from-verified-capture-photo-camera-metadata",
        referencePhoto: "photos/carport-south.jpg",
        sector: "south",
        cameraMode: "perspective",
        focalLength35mmEquivalent: 45,
        cameraDistanceMm: 9000
      }
    });
    expect(manifest.blenderExecution.lighting).toEqual({
      lights: ["Measured_Render_Key_Area", "Measured_Render_Fill_Area"],
      environment: "site-reference",
      referencePhoto: "photos/carport-south.jpg",
      referencePhotoIdentity: {
        path: "photos/carport-south.jpg",
        ...OnePixelPngIdentity
      },
      lightingReference: "daylight",
      colorReference: "known-white-reference",
      whiteBalanceKelvin: 5600,
      exposureEv: 0
    });
    const carportReferenceComparison = (manifest.blenderExecution as typeof manifest.blenderExecution & {
      referenceComparison: {
        referencePhoto: string;
        renderPath: string;
        method: string;
        score: number;
        threshold: number;
      };
    }).referenceComparison;
    expect(carportReferenceComparison).toEqual({
      referencePhoto: "photos/carport-south.jpg",
      renderPath: "renders/carport-southwest.png",
      method: "luma-grid-rmse",
      score: carportReferenceComparison.score,
      threshold: 0.35
    });
    expect(carportReferenceComparison.score).toBeGreaterThanOrEqual(0);
    expect(carportReferenceComparison.score).toBeLessThanOrEqual(1);
    expect((await stat(path.join(outputDir, "renders/carport-southwest.png"))).isFile()).toBe(true);
    expect((await stat(path.join(outputDir, "renders/carport-southwest.manifest.json"))).isFile()).toBe(true);
    expect((await stat(path.join(outputDir, "renders/carport-southwest-render.blend"))).isFile()).toBe(true);
  }, 180_000);
});
