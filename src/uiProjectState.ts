import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BlenderConfig } from "./contracts.js";
import { safeOutputPath } from "./blenderRunner.js";
import { hashValidationSourceProject, validateModelLock } from "./modelLock.js";
import { MeasurementProjectSchema } from "./measurementContracts.js";
import { DigitalViewingRenderManifestSchema } from "./digitalViewingContracts.js";
import { buildExecutableWorkspace, type UiRuntimeConfig } from "./uiWorkspace.js";
import { readLivePublicationTrust } from "./publicationTrustStore.js";
import { readLivePortableExportEvidence, readVerifiedPortableExportArtifact, type PortableExportFormat } from "./portableExportEvidence.js";

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
  const trust = await readLivePublicationTrust(asBlenderConfig(config), projectId);
  const lock = await validateModelLock(asBlenderConfig(config), project);
  const captureReady = project.photos.length > 0 && (project.dimensions.length > 0 || project.profiles.length > 0);
  const validationPassed = captureReady && project.validation.ok && project.validation.checks.length > 0 && project.validation.sourceProjectHash === hashValidationSourceProject(project);
  const previewEvidence = await validatedPreviewEvidence(config, project.projectId, project.artifacts.digitalViewingRenderManifest, project.artifacts.digitalViewingPreview);
  const portableExport = await readLivePortableExportEvidence(asBlenderConfig(config), project);
  const captureTrusted = captureReady && trust !== null && trust.classification.category !== "disputed";
  const oversizedDelivery = portableExport.status === "ready" && portableExport.evidence.artifacts.some((artifact) => artifact.sizeBytes > 256 * 1024 * 1024);
  const deliveryBlockingReason = !captureTrusted
    ? trust?.classification.category === "disputed" ? "capture_trust_disputed" : "capture_trust_incomplete"
    : !validationPassed ? "project_validation_not_passing"
    : !lock.ok ? "model_lock_invalid"
    : portableExport.status === "blocked" ? portableExport.code
    : oversizedDelivery ? "workspace_delivery_artifact_too_large"
    : undefined;
  const surface = buildExecutableWorkspace(config);
  surface.panels[0].states = [
    { id: "capture", label: captureReady ? captureTrustLabel(projectId, trust?.classification) : `Capture evidence incomplete for ${projectId}`, topology: "system", status: captureReady && trust !== null && trust.classification.category !== "disputed" ? "ready" : "blocked", provenance: trust ? `measurement-projects/${projectId}/.publication-trust.json` : `measurement-projects/${projectId}/project.json`, ...(captureReady && trust !== null && trust.classification.category !== "disputed" ? {} : { blockingReason: trust?.classification.category === "disputed" ? "Live capture package evidence no longer matches its verified trust record." : captureReady ? "Verify an explicit native or manual capture package before publication." : "At least one photo and one measurement or profile are required." }), operatorApprovalRequired: false },
    { id: "validation", label: validationPassed ? "Project validation passed" : "Project validation not passing", topology: "execution", status: validationPassed ? "ready" : "blocked", provenance: "project.validation", ...(validationPassed ? {} : { blockingReason: "Complete capture evidence, then run and pass declared project validation before delivery." }), operatorApprovalRequired: false }
  ];
  surface.panels[1].states = [
    { id: "portable-delivery", label: portableExport.status === "ready" ? `Blender delivery verified · ${portableExport.evidence.requestedFormats.join(", ")}` : "Blender delivery not verified", topology: "infrastructure", status: deliveryBlockingReason ? "blocked" : portableExport.status === "ready" ? "ready" : "pending", provenance: project.artifacts.portableExportManifest ?? "portable-export-manifest", ...(deliveryBlockingReason ? { blockingReason: deliveryBlockingReason } : {}), operatorApprovalRequired: false },
    { id: "model-lock", label: lock.ok ? "Reviewed model lock verified" : "Reviewed model lock invalid", topology: "human-intervention", status: lock.ok ? "ready" : "blocked", provenance: project.modelLock.modelArtifact ?? "model-lock-contract", ...(lock.ok ? {} : { blockingReason: lock.blocking.map((reason) => reason.code).join(", ") }), operatorApprovalRequired: true }
  ];
  surface.panels[2].states = [{ id: "preview", label: surface.outputTruth.previewLabel, topology: "system", status: previewEvidence ? "ready" : "pending", ...(previewEvidence ? { confidence: "medium" as const } : {}), provenance: previewEvidence ? "validated-render-manifest" : "preview-render-manifest", operatorApprovalRequired: false }];
  const operatorDecision = await readDecision(config, projectId);
  const deliveryReady = !deliveryBlockingReason && portableExport.status === "ready";
  const deliveryArtifacts = deliveryReady && operatorDecision === null ? portableExport.evidence.artifacts.map((artifact) => ({ format: artifact.format, sizeBytes: artifact.sizeBytes, url: `/api/delivery-artifact?projectId=${encodeURIComponent(projectId)}&format=${artifact.format}` })) : [];
  return { surface, operatorDecision, deliveryArtifacts, project: { projectId, modelLockValid: lock.ok, validationPassed, captureReady, publicationTrust: trust?.classification ?? null, portableExport: portableExport.status } };
}

export async function readUiDeliveryArtifact(config: UiRuntimeConfig, projectId: string, format: string) {
  if (!(["blend", "glb", "obj", "mtl", "usdz"] as const).includes(format as PortableExportFormat)) throw new Error("workspace_delivery_format_invalid");
  const workspace = await loadUiProjectWorkspace(config, projectId);
  if (workspace.operatorDecision !== null) throw new Error("workspace_delivery_held");
  const deliveryState = workspace.surface.panels[1].states.find((state) => state.id === "portable-delivery");
  if (deliveryState?.status !== "ready") throw new Error(`workspace_delivery_not_ready_${deliveryState?.blockingReason?.replace(/[^a-z_]/g, "_") ?? "pending"}`);
  const project = await readUiProject(config, projectId);
  let artifact;
  try { artifact = await readVerifiedPortableExportArtifact(asBlenderConfig(config), project, format as PortableExportFormat); }
  catch (error) {
    const code = error instanceof Error ? error.message.replace(/[^a-z_]/g, "_") : "revalidation_failed";
    throw new Error(code.startsWith("workspace_") ? code : `workspace_delivery_not_ready_${code}`);
  }
  const finalWorkspace = await loadUiProjectWorkspace(config, projectId);
  if (finalWorkspace.operatorDecision !== null) throw new Error("workspace_delivery_held");
  if (!finalWorkspace.deliveryArtifacts.some((entry) => entry.format === format)) {
    const finalState = finalWorkspace.surface.panels[1].states.find((state) => state.id === "portable-delivery");
    throw new Error(`workspace_delivery_not_ready_${finalState?.blockingReason?.replace(/[^a-z_]/g, "_") ?? "gate_changed"}`);
  }
  return artifact;
}

function displayTrustCategory(category: string): string { return category.split("_").map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" "); }
function captureTrustLabel(projectId: string, classification: { category: string; verifiedScopeIds: string[]; unverifiedRequiredScopeIds: string[]; disputedScopeIds: string[] } | undefined): string {
  if (!classification) return `Capture Reference for ${projectId} · no signed trust record`;
  const details = classification.category === "reference"
    ? "manual or unsigned reference evidence"
    : classification.category === "disputed"
    ? `disputed: ${classification.disputedScopeIds.join(", ") || "package integrity"}`
    : classification.unverifiedRequiredScopeIds.length > 0
      ? `unverified: ${classification.unverifiedRequiredScopeIds.join(", ")}`
      : `verified: ${classification.verifiedScopeIds.join(", ") || "package bindings"}`;
  return `Capture ${displayTrustCategory(classification.category)} for ${projectId} · ${details}`;
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
