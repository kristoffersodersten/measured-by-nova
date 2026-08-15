import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BlenderConfig } from "./contracts.js";
import { safeOutputPath } from "./blenderRunner.js";
import { hashValidationSourceProject, validateModelLock } from "./modelLock.js";
import { MeasurementProjectSchema } from "./measurementContracts.js";
import { DigitalViewingRenderManifestSchema } from "./digitalViewingContracts.js";
import { buildExecutableWorkspace, type UiRuntimeConfig } from "./uiWorkspace.js";

export type UiOperatorDecision = { decision: "hold"; actor: "operator"; projectId: string } | null;

export async function listUiProjects(config: UiRuntimeConfig): Promise<string[]> {
  const root = safeOutputPath(config.outputDir, "measurement-projects");
  await assertProjectsRoot(config, root);
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); } catch { return []; }
  const projects: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory()) continue;
    try { await readUiProject(config, entry.name); projects.push(entry.name); } catch { /* Invalid projects are not selectable. */ }
  }
  return projects;
}

export async function loadUiProjectWorkspace(config: UiRuntimeConfig, projectId: string) {
  const project = await readUiProject(config, projectId);
  const lock = await validateModelLock(asBlenderConfig(config), project);
  const captureReady = project.photos.length > 0 && (project.dimensions.length > 0 || project.profiles.length > 0);
  const validationPassed = captureReady && project.validation.ok && project.validation.checks.length > 0 && project.validation.sourceProjectHash === hashValidationSourceProject(project);
  const previewEvidence = await validatedPreviewEvidence(config, project.projectId, project.artifacts.digitalViewingRenderManifest, project.artifacts.digitalViewingPreview);
  const surface = buildExecutableWorkspace(config);
  surface.panels[0].states = [
    { id: "capture", label: captureReady ? `Capture evidence loaded for ${projectId}` : `Capture evidence incomplete for ${projectId}`, topology: "system", status: captureReady ? "ready" : "blocked", provenance: `measurement-projects/${projectId}/project.json`, ...(captureReady ? {} : { blockingReason: "At least one photo and one measurement or profile are required." }), operatorApprovalRequired: false },
    { id: "validation", label: validationPassed ? "Project validation passed" : "Project validation not passing", topology: "execution", status: validationPassed ? "ready" : "blocked", provenance: "project.validation", ...(validationPassed ? {} : { blockingReason: "Complete capture evidence, then run and pass declared project validation before delivery." }), operatorApprovalRequired: false }
  ];
  surface.panels[1].states = [
    { id: "infrastructure", label: `${config.environmentTruth.engine} configured via ${config.environmentTruth.provider}`, topology: "infrastructure", status: "ready", provenance: config.environmentTruth.endpoint, operatorApprovalRequired: false },
    { id: "model-lock", label: lock.ok ? "Reviewed model lock verified" : "Reviewed model lock invalid", topology: "human-intervention", status: lock.ok ? "ready" : "blocked", provenance: project.modelLock.modelArtifact ?? "model-lock-contract", ...(lock.ok ? {} : { blockingReason: lock.blocking.map((reason) => reason.code).join(", ") }), operatorApprovalRequired: true }
  ];
  surface.panels[2].states = [{ id: "preview", label: surface.outputTruth.previewLabel, topology: "execution", status: previewEvidence ? "ready" : "pending", confidence: "medium", provenance: previewEvidence ? "validated-render-manifest" : "preview-render-manifest", operatorApprovalRequired: false }];
  return { surface, operatorDecision: await readDecision(config, projectId), project: { projectId, modelLockValid: lock.ok, validationPassed, captureReady } };
}

export async function writeUiDecision(config: UiRuntimeConfig, projectId: string, decision: "hold" | "release"): Promise<UiOperatorDecision> {
  await readUiProject(config, projectId);
  const decisionPath = uiDecisionPath(config, projectId);
  if (decision === "release") { await rm(decisionPath, { force: true }); return null; }
  const value = { decision: "hold" as const, actor: "operator" as const, projectId };
  const temporary = `${decisionPath}.tmp-${randomUUID()}`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  await rename(temporary, decisionPath);
  return value;
}

async function readUiProject(config: UiRuntimeConfig, projectId: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(projectId)) throw new Error("workspace_project_id_invalid");
  const root = safeOutputPath(config.outputDir, "measurement-projects");
  const projectPath = safeOutputPath(config.outputDir, path.join("measurement-projects", projectId, "project.json"));
  let realOutputRoot: string;
  let realRoot: string;
  let realProject: string;
  try { [realOutputRoot, realRoot, realProject] = await Promise.all([realpath(config.outputDir), realpath(root), realpath(projectPath)]); }
  catch { throw new Error("workspace_project_missing"); }
  if (realRoot !== path.join(realOutputRoot, "measurement-projects")) throw new Error("workspace_projects_root_escape");
  if (!realProject.startsWith(`${realRoot}${path.sep}`) || !(await stat(realProject)).isFile()) throw new Error("workspace_project_path_escape");
  let project;
  try { project = MeasurementProjectSchema.parse(JSON.parse(await readFile(realProject, "utf8"))); }
  catch { throw new Error("workspace_project_invalid"); }
  if (project.projectId !== projectId) throw new Error("workspace_project_identity_mismatch");
  return project;
}

async function readDecision(config: UiRuntimeConfig, projectId: string): Promise<UiOperatorDecision> {
  try {
    const value = JSON.parse(await readFile(uiDecisionPath(config, projectId), "utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("workspace_decision_invalid");
    const record = value as Record<string, unknown>;
    if (record.decision !== "hold" || record.actor !== "operator" || record.projectId !== projectId) throw new Error("workspace_decision_invalid");
    return { decision: "hold", actor: "operator", projectId };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error instanceof Error && error.message === "workspace_decision_invalid" ? error : new Error("workspace_decision_invalid");
  }
}

function uiDecisionPath(config: UiRuntimeConfig, projectId: string): string {
  return safeOutputPath(config.outputDir, path.join("measurement-projects", projectId, ".ui-decision.json"));
}

function asBlenderConfig(config: UiRuntimeConfig): BlenderConfig { return { outputDir: config.outputDir, timeoutMs: 1 }; }

async function validatedPreviewEvidence(config: UiRuntimeConfig, projectId: string, manifestRelative: string | undefined, renderRelative: string | undefined): Promise<boolean> {
  if (!manifestRelative || !renderRelative) return false;
  try {
    const manifestPath = safeOutputPath(config.outputDir, manifestRelative);
    const renderPath = safeOutputPath(config.outputDir, renderRelative);
    const [realRoot, realManifest, realRender] = await Promise.all([realpath(config.outputDir), realpath(manifestPath), realpath(renderPath)]);
    if (![realManifest, realRender].every((entry) => entry.startsWith(`${realRoot}${path.sep}`))) return false;
    const manifest = DigitalViewingRenderManifestSchema.parse(JSON.parse(await readFile(realManifest, "utf8")));
    const renderContents = await readFile(realRender);
    return manifest.projectId === projectId
      && manifest.artifacts.manifest === manifestRelative
      && manifest.artifacts.render === renderRelative
      && (await stat(realRender)).isFile()
      && manifest.blenderExecution?.renderArtifact?.sha256 === createHash("sha256").update(renderContents).digest("hex");
  } catch { return false; }
}

async function assertProjectsRoot(config: UiRuntimeConfig, root: string): Promise<void> {
  try {
    const [realOutputRoot, realProjectsRoot] = await Promise.all([realpath(config.outputDir), realpath(root)]);
    if (realProjectsRoot !== path.join(realOutputRoot, "measurement-projects")) throw new Error("workspace_projects_root_escape");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}
