import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BlenderConfig } from "./contracts.js";
import { safeOutputPath } from "./blenderRunner.js";
import { hashValidationSourceProject, validateModelLock } from "./modelLock.js";
import { MeasurementProjectSchema } from "./measurementContracts.js";
import { DigitalViewingRenderManifestSchema } from "./digitalViewingContracts.js";
import { buildExecutableWorkspace, type UiRuntimeConfig } from "./uiWorkspace.js";
import { readLivePublicationTrust } from "./publicationTrustStore.js";
import { readLivePortableExportEvidence, readVerifiedPortableExportArtifact, type PortableExportFormat } from "./portableExportEvidence.js";
import { WebViewerManifestSchema } from "./webViewer.js";

const ViewerFiles = ["index.html", "viewer.js", "viewer-manifest.json", "three.module.js", "three.core.js", "GLTFLoader.js", "BufferGeometryUtils.js", "OrbitControls.js", "model.glb"] as const;

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

export async function loadUiProjectWorkspace(config: UiRuntimeConfig, projectId: string, options: { includeViewerEvidence?: boolean } = {}) {
  const project = await readUiProject(config, projectId);
  const trust = await readLivePublicationTrust(asBlenderConfig(config), projectId);
  const lock = await validateModelLock(asBlenderConfig(config), project);
  const captureReady = project.photos.length > 0 && (project.dimensions.length > 0 || project.profiles.length > 0);
  const validationPassed = captureReady && project.validation.ok && project.validation.checks.length > 0 && project.validation.sourceProjectHash === hashValidationSourceProject(project);
  const previewEvidence = await validatedPreviewEvidence(config, project);
  const viewerEvidence = options.includeViewerEvidence === false ? false : await validatedViewerEvidence(config, project);
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
  const customerViews = captureTrusted && validationPassed && lock.ok && operatorDecision === null ? {
    ...(previewEvidence ? { previewUrl: `/api/preview?projectId=${encodeURIComponent(projectId)}` } : {}),
    ...(viewerEvidence ? { viewerUrl: `/viewer/${encodeURIComponent(projectId)}/index.html` } : {})
  } : {};
  const customerEvidence = captureTrusted && validationPassed && lock.ok && operatorDecision === null && trust ? {
    trustCategory: trust.classification.category,
    measurements: project.dimensions.map((entry, index) => ({ id: `dimension-${index + 1}`, label: entry.label, value: entry.valueMm, unit: "mm" as const, confidence: entry.confidence, source: entry.source })),
    materials: project.materialNotes.map((entry, index) => ({ id: `material-${index + 1}`, label: entry.material, target: entry.elementId ?? entry.facade ?? "unspecified", confidence: entry.confidence, source: entry.source, verified: entry.verified })),
    conditions: trust.evidenceScopes.filter((scope) => scope.kind === "known_deviation").map((scope) => ({ id: scope.id, status: trust.classification.disputedScopeIds.includes(scope.id) ? "disputed" as const : trust.classification.verifiedScopeIds.includes(scope.id) ? "verified" as const : "reference" as const })),
    limitation: "Only declared evidence is shown. Absence of a condition record does not prove absence of defects." as const
  } : null;
  return { surface, operatorDecision, deliveryArtifacts, customerViews, customerEvidence, project: { projectId, modelLockValid: lock.ok, validationPassed, captureReady, publicationTrust: trust?.classification ?? null, portableExport: portableExport.status } };
}

export async function readUiPreviewArtifact(config: UiRuntimeConfig, projectId: string) {
  const workspace = await loadUiProjectWorkspace(config, projectId, { includeViewerEvidence: false });
  if (workspace.operatorDecision !== null) throw new Error("workspace_delivery_held");
  if (!workspace.customerViews.previewUrl) throw new Error("workspace_preview_not_ready");
  const project = await readUiProject(config, projectId);
  const evidence = await readValidatedPreview(config, project);
  if (!evidence) throw new Error("workspace_preview_revalidation_failed");
  const finalWorkspace = await loadUiProjectWorkspace(config, projectId, { includeViewerEvidence: false });
  if (!finalWorkspace.customerViews.previewUrl) throw new Error("workspace_preview_gate_changed");
  return { bytes: evidence.bytes, contentType: "image/png", sha256: evidence.sha256 };
}

export async function readUiViewerArtifact(config: UiRuntimeConfig, projectId: string, filename: string) {
  if (!(ViewerFiles as readonly string[]).includes(filename)) throw new Error("workspace_viewer_file_invalid");
  const workspace = await loadUiProjectWorkspace(config, projectId, { includeViewerEvidence: false });
  if (workspace.operatorDecision !== null) throw new Error("workspace_delivery_held");
  assertCustomerBaseGate(workspace);
  const project = await readUiProject(config, projectId);
  const snapshot = await readValidatedViewerSnapshot(config, project);
  const bytes = snapshot.files.get(filename);
  if (!bytes) throw new Error("workspace_viewer_artifact_missing");
  const finalWorkspace = await loadUiProjectWorkspace(config, projectId, { includeViewerEvidence: false });
  assertCustomerBaseGate(finalWorkspace);
  return { bytes, contentType: viewerContentType(filename) };
}

function assertCustomerBaseGate(workspace: { operatorDecision: UiOperatorDecision; project: { captureReady: boolean; validationPassed: boolean; modelLockValid: boolean; publicationTrust: { category: string } | null } }): void {
  if (workspace.operatorDecision !== null) throw new Error("workspace_delivery_held");
  if (!workspace.project.captureReady || !workspace.project.validationPassed || !workspace.project.modelLockValid || !workspace.project.publicationTrust || workspace.project.publicationTrust.category === "disputed") throw new Error("workspace_customer_gate_not_ready");
}

export async function readUiDeliveryArtifact(config: UiRuntimeConfig, projectId: string, format: string) {
  if (!(["blend", "glb", "obj", "mtl", "usdz"] as const).includes(format as PortableExportFormat)) throw new Error("workspace_delivery_format_invalid");
  const workspace = await loadUiProjectWorkspace(config, projectId, { includeViewerEvidence: false });
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
  const finalWorkspace = await loadUiProjectWorkspace(config, projectId, { includeViewerEvidence: false });
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

async function validatedPreviewEvidence(config: UiRuntimeConfig, project: Awaited<ReturnType<typeof readUiProject>>): Promise<boolean> {
  return (await readValidatedPreview(config, project)) !== null;
}

async function readValidatedPreview(config: UiRuntimeConfig, project: Awaited<ReturnType<typeof readUiProject>>): Promise<{ bytes: Buffer; sha256: string } | null> {
  const manifestRelative = project.artifacts.digitalViewingRenderManifest; const renderRelative = project.artifacts.digitalViewingPreview;
  if (!manifestRelative || !renderRelative || !renderRelative.toLowerCase().endsWith(".png")) return null;
  try {
    const manifestPath = safeOutputPath(config.outputDir, manifestRelative);
    const renderPath = safeOutputPath(config.outputDir, renderRelative);
    const manifestBytes = await readCanonicalStableFile(config.outputDir, manifestPath, 1024 * 1024);
    const renderContents = await readCanonicalStableFile(config.outputDir, renderPath, 256 * 1024 * 1024);
    const manifest = DigitalViewingRenderManifestSchema.parse(JSON.parse(manifestBytes.toString("utf8")));
    const sha256 = createHash("sha256").update(renderContents).digest("hex");
    const valid = manifest.projectId === project.projectId
      && manifest.artifacts.manifest === manifestRelative
      && manifest.artifacts.render === renderRelative
      && manifest.blenderExecution?.sourceBlendPath === project.modelLock.modelArtifact
      && project.artifacts.digitalViewingPreviewModelHash === project.modelLock.modelHash
      && project.artifacts.digitalViewingPreviewSourceProjectHash === project.modelLock.sourceProjectHash
      && renderContents.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      && manifest.blenderExecution?.renderArtifact?.sha256 === sha256;
    return valid ? { bytes: renderContents, sha256 } : null;
  } catch { return null; }
}

async function validatedViewerEvidence(config: UiRuntimeConfig, project: Awaited<ReturnType<typeof readUiProject>>): Promise<boolean> {
  try { await readValidatedViewerSnapshot(config, project); return true; }
  catch { return false; }
}

async function readValidatedViewerSnapshot(config: UiRuntimeConfig, project: Awaited<ReturnType<typeof readUiProject>>) {
  const directory = viewerDirectory(config, project); const files = new Map<string, Buffer>(); let aggregate = 0;
  for (const filename of ViewerFiles) {
    const bytes = await readCanonicalStableFile(config.outputDir, path.join(directory, filename), 256 * 1024 * 1024);
    aggregate += bytes.byteLength; if (aggregate > 512 * 1024 * 1024) throw new Error("workspace_viewer_package_too_large"); files.set(filename, bytes);
  }
  const manifestBytes = files.get("viewer-manifest.json"); if (!manifestBytes) throw new Error("workspace_viewer_manifest_missing");
  const manifest = WebViewerManifestSchema.parse(JSON.parse(manifestBytes.toString("utf8")));
  if (manifest.projectId !== project.projectId || stableJson(manifest.modelLock) !== stableJson(requiredModelLock(project))) throw new Error("workspace_viewer_identity_mismatch");
  const { packageHash, ...unsigned } = manifest;
  if (createHash("sha256").update(Buffer.from(stableJson(unsigned))).digest("hex") !== packageHash) throw new Error("workspace_viewer_manifest_hash_mismatch");
  for (const artifact of Object.values(manifest.artifacts)) {
    const bytes = files.get(artifact.path); if (!bytes || bytes.byteLength !== artifact.sizeBytes || createHash("sha256").update(bytes).digest("hex") !== artifact.sha256) throw new Error("workspace_viewer_artifact_drift");
    if (artifact.path === "model.glb" && bytes.subarray(0, 4).toString("ascii") !== "glTF") throw new Error("workspace_viewer_model_invalid");
  }
  return { manifest, files };
}

function requiredModelLock(project: Awaited<ReturnType<typeof readUiProject>>) {
  const { modelArtifact: artifact, modelHash, sourceProjectHash } = project.modelLock;
  if (!artifact || !modelHash || !sourceProjectHash) throw new Error("workspace_model_lock_incomplete");
  return { artifact, modelHash, sourceProjectHash };
}

function viewerDirectory(config: UiRuntimeConfig, project: Awaited<ReturnType<typeof readUiProject>>): string {
  const directory = project.artifacts.webViewer; const manifest = project.artifacts.webViewerManifest;
  if (!directory || !manifest || manifest !== path.join(directory, "viewer-manifest.json")) throw new Error("workspace_viewer_manifest_path_invalid");
  return safeOutputPath(config.outputDir, directory);
}

async function readCanonicalStableFile(root: string, file: string, maxBytes: number): Promise<Buffer> {
  const relative = path.relative(path.resolve(root), path.resolve(file));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("workspace_artifact_path_invalid");
  let cursor = path.resolve(root);
  for (const component of relative.split(path.sep)) { cursor = path.join(cursor, component); if ((await lstat(cursor)).isSymbolicLink()) throw new Error("workspace_artifact_path_invalid"); }
  const [canonicalRoot, canonicalFile] = await Promise.all([realpath(root), realpath(file)]);
  if (!canonicalFile.startsWith(`${canonicalRoot}${path.sep}`)) throw new Error("workspace_artifact_path_invalid");
  const before = await stat(canonicalFile, { bigint: true });
  if (!before.isFile() || before.size > BigInt(maxBytes)) throw new Error("workspace_artifact_size_invalid");
  const handle = await open(canonicalFile, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const during = await handle.stat({ bigint: true });
    if (before.dev !== during.dev || before.ino !== during.ino || before.size !== during.size || before.mtimeNs !== during.mtimeNs) throw new Error("workspace_artifact_unstable");
    const bytes = await handle.readFile(); const after = await handle.stat({ bigint: true });
    if (during.size !== after.size || during.mtimeNs !== after.mtimeNs || bytes.byteLength !== Number(after.size)) throw new Error("workspace_artifact_unstable");
    return bytes;
  } finally { await handle.close(); }
}

function viewerContentType(filename: string): string {
  if (filename.endsWith(".html")) return "text/html; charset=utf-8";
  if (filename.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filename.endsWith(".json")) return "application/json";
  return "model/gltf-binary";
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
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
