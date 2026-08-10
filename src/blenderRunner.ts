import { spawn } from "node:child_process";
import { constants, mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BlenderConfig, BlenderToolResult } from "./contracts.js";

const MACOS_APP_PATH = "/Applications/Blender.app/Contents/MacOS/Blender";

export async function resolveBlenderPath(configuredPath?: string): Promise<string> {
  const explicitPath = configuredPath ?? process.env.BLENDER_PATH;
  if (explicitPath) {
    await ensureExecutable(explicitPath);
    return explicitPath;
  }

  if (await canExecute(MACOS_APP_PATH)) {
    return MACOS_APP_PATH;
  }

  return "blender";
}

export function safeOutputPath(outputDir: string, outputFile: string): string {
  const resolvedDir = path.resolve(outputDir);
  const resolvedFile = path.resolve(resolvedDir, outputFile);
  if (!resolvedFile.startsWith(`${resolvedDir}${path.sep}`)) {
    throw new Error(`Invalid outputFile outside outputDir: ${outputFile}`);
  }
  return resolvedFile;
}

export async function runBlenderJob(
  config: BlenderConfig,
  payload: unknown,
  outputFile: string
): Promise<BlenderToolResult> {
  await mkdir(config.outputDir, { recursive: true });
  const outputPath = safeOutputPath(config.outputDir, outputFile);
  const blenderPath = await resolveBlenderPath(config.blenderPath);
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "nova-measured-"));
  const payloadPath = path.join(tempDir, "payload.json");
  const bridgePath = await resolveBridgePath();

  await validateBlenderJobInputFiles(config.outputDir, payload);
  await writeFile(payloadPath, JSON.stringify({ ...asRecord(payload), outputPath, outputRoot: path.resolve(config.outputDir) }), "utf8");

  const result = await runProcess(
    blenderPath,
    ["--background", "--python", bridgePath, "--", payloadPath],
    config.timeoutMs
  );

  if (!(await fileExists(outputPath))) {
    return {
      ok: false,
      stdout: result.stdout,
      stderr: `${result.stderr}\nExpected Blender output was not created: ${outputPath}`.trim(),
      outputPath
    };
  }

  return {
    ...result,
    outputPath
  };
}

export async function validateBlenderJobInputFiles(outputDir: string, payload: unknown): Promise<void> {
  const job = asRecord(payload);
  if (job.operation !== "digital_viewing_render") {
    return;
  }

  const renderManifest = asOptionalRecord(job.renderManifest);
  const renderPreset = asOptionalRecord(renderManifest?.renderPreset);
  if (renderPreset?.deliveryTier !== "premium-sales") {
    return;
  }

  const missingTexturePaths: string[] = [];
  for (const texturePath of uniqueSorted(textureMapPaths(renderManifest?.materials))) {
    if (!(await fileExists(safeOutputPath(outputDir, texturePath)))) {
      missingTexturePaths.push(texturePath);
    }
  }
  if (missingTexturePaths.length > 0) {
    throw new Error(`Missing required digital viewing texture files: ${missingTexturePaths.join(", ")}`);
  }

  const missingPhotoPaths: string[] = [];
  for (const photoPath of uniqueSorted(referencePhotoPaths(renderManifest))) {
    if (!(await fileExists(safeOutputPath(outputDir, photoPath)))) {
      missingPhotoPaths.push(photoPath);
    }
  }
  if (missingPhotoPaths.length > 0) {
    throw new Error(`Missing required digital viewing reference photos: ${missingPhotoPaths.join(", ")}`);
  }
}

async function runProcess(command: string, args: string[], timeoutMs: number): Promise<Omit<BlenderToolResult, "outputPath">> {
  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PYTHONUNBUFFERED: "1" }
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      stderr += `\nBlender timed out after ${timeoutMs}ms.`;
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error: Error) => {
      clearTimeout(timer);
      resolve({ ok: false, stdout, stderr: `${stderr}\n${error.message}`.trim() });
    });
    child.on("close", (code: number | null) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, stdout, stderr });
    });
  });
}

async function canExecute(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const fileStat = await stat(filePath);
    return fileStat.isFile();
  } catch {
    return false;
  }
}

async function resolveBridgePath(): Promise<string> {
  const candidates = [
    path.resolve(process.cwd(), "blender/bridge.py"),
    fileURLToPath(new URL("../blender/bridge.py", import.meta.url)),
    fileURLToPath(new URL("../../blender/bridge.py", import.meta.url))
  ];

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Blender bridge script was not found. Checked: ${candidates.join(", ")}`);
}

async function ensureExecutable(filePath: string): Promise<void> {
  if (!(await canExecute(filePath))) {
    throw new Error(`Blender executable is not available or executable: ${filePath}`);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Payload must be an object.");
  }
  return value as Record<string, unknown>;
}

function asOptionalRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function textureMapPaths(materials: unknown): string[] {
  if (!Array.isArray(materials)) {
    return [];
  }

  return materials.flatMap((material) => {
    const materialRecord = asOptionalRecord(material);
    if (!Array.isArray(materialRecord?.textureMaps)) {
      return [];
    }

    return materialRecord.textureMaps.flatMap((textureMap) => {
      const textureMapRecord = asOptionalRecord(textureMap);
      return typeof textureMapRecord?.path === "string" ? [textureMapRecord.path] : [];
    });
  });
}

function referencePhotoPaths(renderManifest: Record<string, unknown> | undefined): string[] {
  if (!renderManifest) {
    return [];
  }

  const renderPreset = asOptionalRecord(renderManifest.renderPreset);
  const camera = asOptionalRecord(renderPreset?.camera);
  const lighting = asOptionalRecord(renderPreset?.lighting);
  const materials = Array.isArray(renderManifest.materials) ? renderManifest.materials : [];
  const conditions = Array.isArray(renderManifest.conditions) ? renderManifest.conditions : [];

  return [
    ...stringValues([camera?.referencePhoto, lighting?.referencePhoto]),
    ...materials.flatMap(materialReferencePhotoPaths),
    ...conditions.flatMap((condition) => arrayStringValues(asOptionalRecord(condition)?.photoSources))
  ];
}

function materialReferencePhotoPaths(material: unknown): string[] {
  const materialRecord = asOptionalRecord(material);
  if (!materialRecord) {
    return [];
  }

  const surfaceMapping = asOptionalRecord(materialRecord.surfaceMapping);
  const appearanceCalibration = asOptionalRecord(materialRecord.appearanceCalibration);
  const textureMaps = Array.isArray(materialRecord.textureMaps) ? materialRecord.textureMaps : [];
  return [
    ...arrayStringValues(materialRecord.photoSources),
    ...stringValues([surfaceMapping?.sourcePhoto, appearanceCalibration?.sourcePhoto]),
    ...textureMaps.flatMap((textureMap) => stringValues([asOptionalRecord(textureMap)?.sourcePhoto]))
  ];
}

function stringValues(values: unknown[]): string[] {
  return values.filter((value): value is string => typeof value === "string");
}

function arrayStringValues(value: unknown): string[] {
  return Array.isArray(value) ? stringValues(value) : [];
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}
