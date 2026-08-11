import path from "node:path";
import { access } from "node:fs/promises";
import type { MeasurementProject } from "./measurementContracts.js";
import { hashSourceProject } from "./modelLock.js";

export type FacadeQaReason = {
  code:
    | "manifest_model_hash_missing"
    | "manifest_model_hash_mismatch"
    | "required_view_missing"
    | "required_view_identity_missing"
    | "export_geometry_strategy_prohibited"
    | "output_path_unsafe"
    | "geometry_mutation_declared"
    | "source_geometry_mutated";
  message: string;
};

export type FacadeQaResult = {
  ok: boolean;
  blocking: FacadeQaReason[];
  visualDiff: { requiredForContract: false; evaluated: false };
};

const ViewArtifactKeys = {
  north: "northPng",
  south: "southPng",
  east: "eastPng",
  west: "westPng"
} as const;

export async function evaluateFacadeQaManifest(input: {
  manifest: unknown;
  project: MeasurementProject;
  requiredViews: Array<keyof typeof ViewArtifactKeys>;
  exportOutputDir: string;
  sourceProjectHashBefore: string;
}): Promise<FacadeQaResult> {
  const manifest = asRecord(input.manifest);
  const modelLock = asRecord(manifest.modelLock);
  const artifacts = asRecord(manifest.artifacts);
  const identities = asRecord(manifest.artifactIdentities);
  const blocking: FacadeQaReason[] = [];
  const lockedHash = input.project.modelLock.modelHash;

  if (typeof modelLock.modelHash !== "string") {
    blocking.push({ code: "manifest_model_hash_missing", message: "Export manifest does not identify the locked Blender model hash." });
  } else if (!lockedHash || modelLock.modelHash !== lockedHash) {
    blocking.push({ code: "manifest_model_hash_mismatch", message: "Export manifest model hash does not match the reviewed model lock." });
  }

  for (const view of input.requiredViews) {
    const artifactKey = ViewArtifactKeys[view];
    const artifactPath = artifacts[artifactKey];
    if (typeof artifactPath !== "string") {
      blocking.push({ code: "required_view_missing", message: `Required facade view '${view}' is missing from the export manifest.` });
      continue;
    }
    if (isInside(path.resolve(input.exportOutputDir), artifactPath)) {
      try {
        await access(path.resolve(input.exportOutputDir, artifactPath));
      } catch {
        blocking.push({ code: "required_view_missing", message: `Required facade view '${view}' does not exist in the export output directory.` });
      }
    }
    const identity = asRecord(identities[artifactKey]);
    if (identity.path !== artifactPath || typeof identity.sha256 !== "string") {
      blocking.push({ code: "required_view_identity_missing", message: `Required facade view '${view}' lacks matching artifact identity evidence.` });
    }
  }

  const strategies = Array.isArray(manifest.strategies) ? manifest.strategies : [];
  if (strategies.includes("export-stage-geometry-reconstruction")) {
    blocking.push({ code: "export_geometry_strategy_prohibited", message: "Export-stage geometry reconstruction is prohibited after model lock." });
  }

  const resolvedOutputDir = path.resolve(input.exportOutputDir);
  for (const [artifactKey, artifactPath] of Object.entries(artifacts)) {
    if (typeof artifactPath !== "string" || !isInside(resolvedOutputDir, artifactPath)) {
      blocking.push({ code: "output_path_unsafe", message: `Artifact '${artifactKey}' resolves outside the declared export output directory.` });
    }
  }
  for (const [identityKey, identityValue] of Object.entries(identities)) {
    const identityPath = asRecord(identityValue).path;
    if (typeof identityPath !== "string" || !isInside(resolvedOutputDir, identityPath)) {
      blocking.push({ code: "output_path_unsafe", message: `Artifact identity '${identityKey}' resolves outside the declared export output directory.` });
    }
  }

  if (manifest.geometryMutationAllowed !== false) {
    blocking.push({ code: "geometry_mutation_declared", message: "Facade export manifest must explicitly prohibit geometry mutation." });
  }
  if (hashSourceProject(input.project) !== input.sourceProjectHashBefore) {
    blocking.push({ code: "source_geometry_mutated", message: "Project source geometry changed during facade export." });
  }

  return {
    ok: blocking.length === 0,
    blocking,
    visualDiff: { requiredForContract: false, evaluated: false }
  };
}

function isInside(outputDir: string, artifactPath: string): boolean {
  const resolved = path.resolve(outputDir, artifactPath);
  return resolved.startsWith(`${outputDir}${path.sep}`);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
