import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { BlenderConfig } from "./contracts.js";
import { safeOutputPath } from "./blenderRunner.js";
import type { MeasurementProject, ModelLock } from "./measurementContracts.js";

export type ModelLockValidation = {
  ok: boolean;
  blocking: Array<{ code: "model_lock_incomplete" | "source_project_mutated" | "locked_model_mutated" | "locked_model_missing"; message: string }>;
};

export async function buildModelLock(
  config: BlenderConfig,
  project: MeasurementProject,
  review: { lockedAt: string; lockedBy: string; reason: string }
): Promise<ModelLock> {
  const modelArtifact = requireModelArtifact(project);
  return {
    locked: true,
    ...review,
    modelArtifact,
    modelHash: await hashFile(safeOutputPath(config.outputDir, modelArtifact)),
    sourceProjectHash: hashSourceProject(project)
  };
}

export async function validateModelLock(config: BlenderConfig, project: MeasurementProject): Promise<ModelLockValidation> {
  const lock = project.modelLock;
  const blocking: ModelLockValidation["blocking"] = [];
  if (!lock.locked || !lock.modelArtifact || !lock.modelHash || !lock.sourceProjectHash) {
    return { ok: false, blocking: [{ code: "model_lock_incomplete", message: "Model lock must include the reviewed model artifact, model hash, and source project hash." }] };
  }
  if (hashSourceProject(project) !== lock.sourceProjectHash) {
    blocking.push({ code: "source_project_mutated", message: "Project source state no longer matches the reviewed model lock." });
  }
  try {
    if (await hashFile(safeOutputPath(config.outputDir, lock.modelArtifact)) !== lock.modelHash) {
      blocking.push({ code: "locked_model_mutated", message: "Reviewed Blender model content no longer matches the model lock." });
    }
  } catch {
    blocking.push({ code: "locked_model_missing", message: "Reviewed Blender model artifact is missing or unreadable." });
  }
  return { ok: blocking.length === 0, blocking };
}

export function hashSourceProject(project: MeasurementProject): string {
  const source = Object.fromEntries(
    Object.entries(project).filter(([key]) => key !== "modelLock" && key !== "artifacts")
  );
  return hashValue(source);
}

export function hashValidationSourceProject(project: MeasurementProject): string {
  const source = Object.fromEntries(
    Object.entries(project).filter(([key]) => key !== "validation" && key !== "modelLock" && key !== "artifacts")
  );
  return hashValue(source);
}

function requireModelArtifact(project: MeasurementProject): string {
  const artifact = project.artifacts.blend;
  if (!artifact) {
    throw new Error("A generated Blender artifact is required before model lock.");
  }
  return artifact;
}

async function hashFile(filePath: string): Promise<string> {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

function hashValue(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
