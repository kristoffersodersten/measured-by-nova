import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { z } from "zod";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BlenderConfig, BlenderToolResult } from "./contracts.js";
import { runBlenderJob, safeOutputPath } from "./blenderRunner.js";
import { DefaultCapabilityManifest, evaluateCapabilityExecution } from "./capabilityManifest.js";
import { buildExecutionActionEvidence, evaluateExecutionIntent, type ExecutionIntent } from "./executionGate.js";
import { captureToFixture, RealCarportCaptureSchema } from "./captureToFixture.js";
import {
  buildDigitalViewingBlenderRenderJob,
  buildDigitalViewingAssetBundleManifest,
  buildDigitalViewingCaptureGuide,
  buildDigitalViewingCaptureRepairSummary,
  buildDigitalViewingDeliveryPackageManifest,
  buildDigitalViewingMaterialAuthoringPlan,
  buildDigitalViewingMaterialConditionReport,
  EvaluateDigitalViewingDeliveryProfileInputSchema,
  evaluateDigitalViewingCapturePreset,
  evaluateDigitalViewingDeliveryProfileReadiness,
  evaluateDigitalViewingDeliveryReadiness,
  GenerateDigitalViewingAssetBundleManifestInputSchema,
  GenerateDigitalViewingDeliveryPackageInputSchema,
  GenerateDigitalViewingMaterialAuthoringPlanInputSchema,
  GenerateDigitalViewingMaterialReportInputSchema,
  GetDigitalViewingCaptureGuideInputSchema,
  GetDigitalViewingDeliveryProfileInputSchema,
  getDigitalViewingCapturePreset,
  getDigitalViewingDeliveryProfile,
  GetDigitalViewingCapturePresetInputSchema,
  listDigitalViewingCapturePresets,
  listDigitalViewingDeliveryProfiles,
  ListDigitalViewingDeliveryProfilesInputSchema,
  ListDigitalViewingCapturePresetsInputSchema,
  RenderDigitalViewingPreviewInputSchema,
  serializeDigitalViewingAssetBundleManifest,
  serializeDigitalViewingDeliveryPackageManifest,
  serializeDigitalViewingMaterialConditionReport,
  serializeDigitalViewingMaterialAuthoringPlan,
  validateDigitalViewingCapture,
  ValidateDigitalViewingCapturePresetInputSchema
} from "./digitalViewingContracts.js";
import { materializeProfiles } from "./profileGenerator.js";
import { evaluateFacadeQaManifest } from "./facadeQa.js";
import { buildModelLock, hashSourceProject, validateModelLock } from "./modelLock.js";
import { buildOrthographicViewRegistry, validateRequiredViews } from "./viewRegistry.js";
import { appendRequestLog, fail, ok, readProject, requestId, writeProject } from "./projectStore.js";
import { buildSourceProjectionBlenderJob, buildSourceProjectionManifest, SourceProjectionError, SourceProjectionExecutionReportSchema, SourceProjectionInputSchema } from "./sourceProjection.js";
import {
  CarportProfileParametersSchema,
  CreateMeasurementProjectSchema,
  CreateParametricProfileSchema,
  DefineAssumptionSchema,
  DefineKnownDimensionSchema,
  DefineOpeningSchema,
  DefineReferencePlaneInputSchema,
  DefineStepRunSchema,
  ExportDimensionedDrawingsSchema,
  ExportFacadeCompletionPackSchema,
  ExportMeasuredModelSchema,
  ExportProjectTemplateSchema,
  GenerateElevationViewsSchema,
  GenerateMeasuredModelSchema,
  ImportReferencePhotosSchema,
  LockModelForExportSchema,
  MeasurementProjectSchema,
  UnsafeRunPythonSchema,
  ValidateModelSchema,
  type MeasurementProject,
  type ProfileInstance
} from "./measurementContracts.js";

type MachineReason = {
  id?: string;
  code: string;
  message: string;
};

type QualityGateResult = {
  ok: boolean;
  blocking: MachineReason[];
  warnings: MachineReason[];
};

const PermitExportStrategies = [
  "parametric-profile",
  "blender-orthographic-camera",
  "freestyle",
  "manifest",
  "pdf-layout",
  "svg-layout",
  "png-render"
];

export function registerMeasurementTools(server: McpServer, config: BlenderConfig): void {
  register(server, "create_project_from_capture", "Convert a verified real capture set into a measurement project without inferring or reconstructing geometry.", RealCarportCaptureSchema, async (input) => {
    const req = requestId();
    const result = captureToFixture(input);
    if (!result.ok) {
      return fail(
        req,
        "capture_contract_failed",
        "Capture cannot become a measurement project until blocking requirements are resolved.",
        result.captureValidation.blocking.map((reason) => `${reason.code}: ${reason.message}`),
        { blocking: result.captureValidation.blocking, warnings: result.captureValidation.warnings }
      );
    }
    await writeProject(config, result.project);
    await appendRequestLog(config, result.project.projectId, req, "create_project_from_capture", input);
    return ok(req, { project: result.project, captureValidation: result.captureValidation }, result.captureValidation.warnings.map((reason) => `${reason.code}: ${reason.message}`));
  });

  register(server, "create_measurement_project", "Create an empty measurement-first visualization project stored as JSON under the configured output directory.", CreateMeasurementProjectSchema, async (input) => {
    const req = requestId();
    const payload = CreateMeasurementProjectSchema.parse(input);
    const project: MeasurementProject = MeasurementProjectSchema.parse({ schemaVersion: 1, projectId: payload.projectId, unit: payload.unit });
    await writeProject(config, project);
    await appendRequestLog(config, project.projectId, req, "create_measurement_project", payload);
    return ok(req, { projectPath: safeOutputPath(config.outputDir, path.join("measurement-projects", project.projectId, "project.json")), project });
  });

  register(server, "import_reference_photos", "Import non-calibrated site photos as low-confidence visual references or validation inputs.", ImportReferencePhotosSchema, async (input) => {
    const req = requestId();
    const payload = ImportReferencePhotosSchema.parse(input);
    const project = await readProject(config, payload.projectId);
    const photos = payload.photos.map((photo) => ({ ...photo, confidence: "low" as const }));
    const next = { ...project, photos: [...project.photos, ...photos] };
    await writeProject(config, next);
    await appendRequestLog(config, payload.projectId, req, "import_reference_photos", payload);
    return ok(req, { photos: next.photos }, ["Photos are non-calibrated and must remain low-confidence visual references unless calibration data is added."]);
  });

  register(server, "define_known_dimension", "Add an authoritative or measured dimension constraint to the project.", DefineKnownDimensionSchema, async (input) => {
    const req = requestId();
    const payload = DefineKnownDimensionSchema.parse(input);
    const project = await readProject(config, payload.projectId);
    const dimension = { label: payload.label, valueMm: payload.valueMm, confidence: payload.confidence, endpoints: payload.endpoints, source: payload.source };
    const next = { ...project, dimensions: [...project.dimensions.filter((d) => d.label !== dimension.label), dimension] };
    await writeProject(config, next);
    await appendRequestLog(config, payload.projectId, req, "define_known_dimension", payload);
    return ok(req, { dimension });
  });

  register(server, "define_reference_plane", "Define a measured or inferred plane used for alignment and drawing generation.", DefineReferencePlaneInputSchema, async (input) => {
    const req = requestId();
    const payload = DefineReferencePlaneInputSchema.parse(input);
    const project = await readProject(config, payload.projectId);
    const plane = { id: payload.id, orientation: payload.orientation, confidence: payload.confidence, originMm: payload.originMm, normal: payload.normal };
    const next = { ...project, planes: [...project.planes.filter((p) => p.id !== plane.id), plane] };
    await writeProject(config, next);
    await appendRequestLog(config, payload.projectId, req, "define_reference_plane", payload);
    return ok(req, { plane });
  });

  register(server, "define_opening", "Add a door, window, or open bay constraint on a known host element.", DefineOpeningSchema, async (input) => {
    const req = requestId();
    const payload = DefineOpeningSchema.parse(input);
    const project = await readProject(config, payload.projectId);
    const opening = { hostElementId: payload.hostElementId, boundsMm: payload.boundsMm, openType: payload.openType, confidence: payload.confidence };
    const next = { ...project, openings: [...project.openings, opening] };
    await writeProject(config, next);
    await appendRequestLog(config, payload.projectId, req, "define_opening", payload);
    return ok(req, { opening });
  });

  register(server, "define_step_run", "Add a measured stair run using known rise, going, and count.", DefineStepRunSchema, async (input) => {
    const req = requestId();
    const payload = DefineStepRunSchema.parse(input);
    const project = await readProject(config, payload.projectId);
    const step = { id: payload.id, stepDepthMm: payload.stepDepthMm, stepHeightMm: payload.stepHeightMm, count: payload.count, locationHint: payload.locationHint, confidence: payload.confidence };
    const next = { ...project, steps: [...project.steps.filter((s) => s.id !== step.id), step] };
    await writeProject(config, next);
    await appendRequestLog(config, payload.projectId, req, "define_step_run", payload);
    return ok(req, { step });
  });

  register(server, "define_assumption", "Record an explicit project assumption with confidence and geometry impact.", DefineAssumptionSchema, async (input) => {
    const req = requestId();
    const payload = DefineAssumptionSchema.parse(input);
    const project = await readProject(config, payload.projectId);
    const assumption = { id: payload.id, text: payload.text, confidence: payload.confidence, source: payload.source, affectsGeometry: payload.affectsGeometry };
    const next = { ...project, assumptions: [...project.assumptions.filter((item) => item.id !== assumption.id), assumption] };
    await writeProject(config, next);
    await appendRequestLog(config, payload.projectId, req, "define_assumption", payload);
    return ok(req, { assumption });
  });

  register(server, "create_parametric_profile", "Attach a typed parametric structure profile to the project; carport is the first reusable profile.", CreateParametricProfileSchema, async (input) => {
    const req = requestId();
    const payload = CreateParametricProfileSchema.parse(input);
    const project = await readProject(config, payload.projectId);
    let profile: ProfileInstance;
    if (payload.profile === "carport") {
      profile = { id: "profile-carport", profile: "carport", parameters: CarportProfileParametersSchema.parse(payload.parameters), confidence: "high" };
    } else {
      profile = { id: `profile-${payload.profile}`, profile: payload.profile, parameters: parseRecordParameters(payload.parameters), confidence: "medium" };
    }
    const next = materializeProfiles({ ...project, profiles: [...project.profiles.filter((p) => p.id !== profile.id), profile] });
    await writeProject(config, next);
    await appendRequestLog(config, payload.projectId, req, "create_parametric_profile", payload);
    return ok(req, { profile, elementCount: next.elements.length });
  });

  register(server, "generate_measured_model", "Generate deterministic Blender visualization geometry from explicit measurements, constraints, and parametric elements.", GenerateMeasuredModelSchema, async (input) => {
    const req = requestId();
    const payload = GenerateMeasuredModelSchema.parse(input);
    const project = materializeProfiles(await readProject(config, payload.projectId));
    const outputBlend = payload.outputBlend ?? path.join("measurement-projects", payload.projectId, "artifacts", `${payload.projectId}.blend`);
    const result = await runBlenderJob(config, { mode: "measurement_project", operation: "generate_model", project }, outputBlend);
    const next = { ...project, artifacts: { ...project.artifacts, blend: result.outputPath ?? outputBlend } };
    await writeProject(config, next);
    await appendRequestLog(config, payload.projectId, req, "generate_measured_model", payload);
    return ok(req, { blender: result, artifacts: next.artifacts }, result.ok ? [] : ["Blender generation failed; inspect stderr."]);
  });

  register(server, "validate_model", "Validate generated project geometry against known dimensions and confidence rules.", ValidateModelSchema, async (input) => {
    const req = requestId();
    const payload = ValidateModelSchema.parse(input);
    const project = materializeProfiles(await readProject(config, payload.projectId));
    const validation = validateProject(project, payload.checks);
    const next = { ...project, validation };
    await writeProject(config, next);
    await appendRequestLog(config, payload.projectId, req, "validate_model", payload);
    return ok(req, { validation }, validation.warnings);
  });

  register(server, "lock_model_for_export", "Lock a human-reviewed model so permit-support exports can be generated without geometry changes.", LockModelForExportSchema, async (input) => {
    const req = requestId();
    const payload = LockModelForExportSchema.parse(input);
    const executionGate = evaluateExecutionIntent(payload.executionIntent, "lock-model");
    if (!executionGate.ok) {
      return failExecutionIntent(req, executionGate);
    }
    const project = materializeProfiles(await readProject(config, payload.projectId));
    const gate = qualityGate(project);
    if (!gate.ok) {
      return fail(req, "quality_gate_failed", "Model cannot be locked until quality gates pass.", formatReasons(gate), { blocking: gate.blocking });
    }
    let modelLock;
    try {
      modelLock = await buildModelLock(config, project, { lockedAt: new Date().toISOString(), lockedBy: payload.lockedBy, reason: payload.reason });
    } catch (error) {
      return fail(req, "model_artifact_missing", error instanceof Error ? error.message : String(error));
    }
    const next = { ...project, modelLock };
    await writeProject(config, next);
    await appendRequestLog(config, payload.projectId, req, "lock_model_for_export", payload);
    const executionAction = buildExecutionActionEvidence(payload.executionIntent, {
      changedArtifacts: [path.join("measurement-projects", payload.projectId, "project.json")],
      verificationResults: [
        { check: "schema", ok: true, evidence: "Lock input and execution intent matched strict schemas." },
        { check: "quality-gate", ok: gate.ok, evidence: "Measurement project quality gate passed before model lock." },
        { check: "manifest", ok: true, evidence: "Model-lock manifest hash derived after the project write." }
      ],
      manifest: { projectId: payload.projectId, modelLock: next.modelLock }
    });
    return ok(req, { modelLock: next.modelLock, execution: { intent: payload.executionIntent, action: executionAction } }, formatReasons(gate));
  });

  register(server, "generate_elevation_views", "Create locked orthographic plan, elevation, and section cameras/render targets from Blender geometry.", GenerateElevationViewsSchema, async (input) => {
    const req = requestId();
    const payload = GenerateElevationViewsSchema.parse(input);
    const project = materializeProfiles(await readProject(config, payload.projectId));
    const viewRegistry = buildOrthographicViewRegistry(project.elements, payload.views);
    const next = { ...project, viewRegistry };
    const result = await runBlenderJob(config, { mode: "measurement_project", operation: "elevation_views", project: next, views: payload.views }, path.join("measurement-projects", payload.projectId, "artifacts", `${payload.projectId}-views.blend`));
    if (!result.ok) return fail(req, "view_generation_failed", "Blender failed to generate the declared orthographic view registry.", [result.stderr]);
    await writeProject(config, next);
    await appendRequestLog(config, payload.projectId, req, "generate_elevation_views", payload);
    return ok(req, { blender: result, viewRegistry });
  });

  register(server, "export_model", "Export the measured project model as blend, GLB, and/or OBJ artifacts.", ExportMeasuredModelSchema, async (input) => {
    const req = requestId();
    const payload = ExportMeasuredModelSchema.parse(input);
    const executionGate = evaluateExecutionIntent(payload.executionIntent, "export-model");
    if (!executionGate.ok) {
      return failExecutionIntent(req, executionGate);
    }
    const project = materializeProfiles(await readProject(config, payload.projectId));
    const lockValidation = await validateModelLock(config, project);
    if (!lockValidation.ok || !project.modelLock.modelArtifact) {
      return fail(req, "model_lock_invalid", "Portable model export requires the exact unchanged reviewed Blender model.", lockValidation.blocking.map((reason) => `${reason.code}: ${reason.message}`), { blocking: lockValidation.blocking });
    }
    const outputBlend = path.join("measurement-projects", payload.projectId, "artifacts", `${payload.projectId}-export.blend`);
    const artifactPaths = portableExportPaths(payload.projectId, payload.formats, outputBlend);
    const collisions = (await Promise.all(artifactPaths.map(async (artifact) => ({ artifact, exists: await pathExists(safeOutputPath(config.outputDir, artifact.path)) }))))
      .filter((entry) => entry.exists)
      .map((entry) => entry.artifact.path);
    if (collisions.length > 0) {
      return fail(req, "export_output_exists", `Portable export refuses to overwrite existing artifacts: ${collisions.join(", ")}`);
    }
    let snapshot: LockedModelSnapshot;
    try {
      snapshot = await createLockedModelSnapshot(config, project, req, "portable-export");
    } catch (error) {
      return fail(req, "model_lock_invalid", error instanceof Error ? error.message : String(error));
    }
    let result: BlenderToolResult;
    try {
      result = await runBlenderJob(config, { mode: "measurement_project", operation: "export_model", project, formats: payload.formats, sourceBlendPath: snapshot.path }, outputBlend);
    } catch (error) {
      await Promise.all(artifactPaths.map((artifact) => rm(safeOutputPath(config.outputDir, artifact.path), { force: true })));
      return fail(req, "portable_export_failed", error instanceof Error ? error.message : String(error), ["All partial portable-export artifacts were removed."]);
    } finally {
      await snapshot.remove();
    }
    if (!result.ok) {
      await Promise.all(artifactPaths.map((artifact) => rm(safeOutputPath(config.outputDir, artifact.path), { force: true })));
      return fail(req, "portable_export_failed", "Blender could not export the locked model; partial artifacts were removed.", [result.stderr]);
    }
    let artifacts;
    try {
      artifacts = await Promise.all(artifactPaths.map((artifact) => validatePortableExportArtifact(config.outputDir, artifact)));
    } catch (error) {
      await Promise.all(artifactPaths.map((artifact) => rm(safeOutputPath(config.outputDir, artifact.path), { force: true })));
      return fail(req, "portable_export_artifact_invalid", error instanceof Error ? error.message : String(error), ["All partial portable-export artifacts were removed."]);
    }
    await appendRequestLog(config, payload.projectId, req, "export_model", { ...payload, sourceBlendPath: project.modelLock.modelArtifact, artifacts });
    const executionAction = buildExecutionActionEvidence(payload.executionIntent, {
      changedArtifacts: artifacts.map((artifact) => artifact.path),
      verificationResults: [
        { check: "schema", ok: true, evidence: "Portable export input and execution intent matched strict schemas." },
        { check: "quality-gate", ok: true, evidence: "Exact model-lock source and Blender execution passed without fallback." },
        { check: "manifest", ok: true, evidence: "Every requested artifact passed type, size, and SHA-256 validation." }
      ],
      manifest: { projectId: payload.projectId, sourceBlendPath: project.modelLock.modelArtifact, modelHash: project.modelLock.modelHash, formats: payload.formats, artifacts }
    });
    return ok(req, { blender: result, formats: payload.formats, sourceBlendPath: project.modelLock.modelArtifact, artifacts, execution: { intent: payload.executionIntent, action: executionAction } });
  });

  register(server, "export_dimensioned_drawings", "Generate a permit-oriented visualization PDF with dimension annotations, scale bars, and a confidence legend.", ExportDimensionedDrawingsSchema, async (input) => {
    const req = requestId();
    const payload = ExportDimensionedDrawingsSchema.parse(input);
    const executionGate = evaluateExecutionIntent(payload.executionIntent, "export-drawings");
    if (!executionGate.ok) {
      return failExecutionIntent(req, executionGate);
    }
    const project = materializeProfiles(await readProject(config, payload.projectId));
    const lockValidation = await validateModelLock(config, project);
    if (!lockValidation.ok) return failInvalidModelLock(req, lockValidation);
    const outputBlend = path.join("measurement-projects", payload.projectId, "artifacts", `${payload.projectId}-drawings.blend`);
    const outputs = [payload.outputPath, outputBlend];
    try { await Promise.all(outputs.map((output) => assertOutputParentWithinRoot(config.outputDir, safeOutputPath(config.outputDir, output)))); }
    catch { return fail(req, "export_path_escape", "Drawing output parent resolves outside the configured output root."); }
    const collisions = await existingRelativePaths(config.outputDir, outputs);
    if (collisions.length > 0) return fail(req, "export_output_exists", `Drawing export refuses to overwrite existing artifacts: ${collisions.join(", ")}`);
    let snapshot: LockedModelSnapshot;
    try {
      snapshot = await createLockedModelSnapshot(config, project, req, "dimensioned-drawings");
    } catch (error) {
      return fail(req, "model_lock_invalid", error instanceof Error ? error.message : String(error));
    }
    let result: BlenderToolResult;
    try {
      result = await runBlenderJob(config, { mode: "measurement_project", operation: "dimensioned_drawings", project, sourceBlendPath: snapshot.path, drawingOutputPath: safeOutputPath(config.outputDir, payload.outputPath), scale: payload.scale, includeConfidenceLegend: payload.includeConfidenceLegend }, outputBlend);
    } catch (error) {
      await removeRelativePaths(config.outputDir, outputs);
      return fail(req, "drawing_export_failed", error instanceof Error ? error.message : String(error), ["All partial drawing artifacts were removed."]);
    } finally {
      await snapshot.remove();
    }
    if (!result.ok) {
      await removeRelativePaths(config.outputDir, outputs);
      return fail(req, "drawing_export_failed", "Blender could not export drawings from the locked model; partial artifacts were removed.", [result.stderr]);
    }
    let artifacts;
    try {
      artifacts = await Promise.all([validateArtifact(config.outputDir, payload.outputPath, "pdf"), validateArtifact(config.outputDir, outputBlend, "blend")]);
    } catch (error) {
      await removeRelativePaths(config.outputDir, outputs);
      return fail(req, "drawing_export_artifact_invalid", error instanceof Error ? error.message : String(error));
    }
    await appendRequestLog(config, payload.projectId, req, "export_dimensioned_drawings", payload);
    const executionAction = exportActionEvidence(payload.executionIntent, result, payload.outputPath, { outputPath: payload.outputPath, scale: payload.scale, sourceBlendPath: project.modelLock.modelArtifact, modelHash: project.modelLock.modelHash, artifacts, blender: result });
    return ok(req, { blender: result, sourceBlendPath: project.modelLock.modelArtifact, modelHash: project.modelLock.modelHash, artifacts, outputPath: safeOutputPath(config.outputDir, payload.outputPath), execution: { intent: payload.executionIntent, action: executionAction } });
  });

  register(server, "export_facade_completion_pack", "Export the MVP facade-completion package from a locked measured model using Blender orthographic views.", ExportFacadeCompletionPackSchema, async (input) => {
    const req = requestId();
    const payload = ExportFacadeCompletionPackSchema.parse(input);
    const executionGate = evaluateExecutionIntent(payload.executionIntent, "export-facade-pack");
    if (!executionGate.ok) {
      return failExecutionIntent(req, executionGate);
    }
    const project = materializeProfiles(await readProject(config, payload.projectId));
    const gate = qualityGate(project);
    const capability = evaluateCapabilityExecution(DefaultCapabilityManifest, { template: payload.template, strategies: PermitExportStrategies });
    if (!project.modelLock.locked) {
      return fail(req, "model_not_locked", "Run lock_model_for_export after human review before exporting a facade-completion package.", formatReasons(gate), { blocking: [{ code: "model_not_locked", message: "Human-reviewed model lock is required before permit-support export." }] });
    }
    const lockValidation = await validateModelLock(config, project);
    if (!lockValidation.ok) {
      return fail(req, "model_lock_invalid", "Reviewed model lock no longer matches project and Blender state.", lockValidation.blocking.map((reason) => `${reason.code}: ${reason.message}`), { blocking: lockValidation.blocking });
    }
    const viewValidation = validateRequiredViews(project.viewRegistry, payload.views);
    if (!viewValidation.ok) {
      const blocking = [
        ...viewValidation.missing.map((view) => ({ code: "required_view_missing", message: `Required orthographic view '${view}' is missing.` })),
        ...(!viewValidation.hashValid ? [{ code: "view_registry_hash_mismatch", message: "Orthographic view registry hash does not match its definitions." }] : [])
      ];
      return fail(req, "view_registry_invalid", "Facade-completion export requires a complete unchanged orthographic view registry.", blocking.map((reason) => `${reason.code}: ${reason.message}`), { blocking });
    }
    if (!gate.ok) {
      return fail(req, "quality_gate_failed", "Facade-completion export requires all quality gates to pass.", formatReasons(gate), { blocking: gate.blocking });
    }
    if (!capability.ok) {
      return fail(req, "capability_gate_failed", "Facade-completion export requires an allowed capability strategy set.", capability.blocking.map((reason) => `${reason.code}: ${reason.message}`), { blocking: capability.blocking });
    }
    const outputDir = payload.outputDir ?? path.join("measurement-projects", payload.projectId, "exports", payload.template);
    const outputBlend = path.join(outputDir, `${payload.projectId}-${payload.template}.blend`);
    try { await assertOutputParentWithinRoot(config.outputDir, safeOutputPath(config.outputDir, outputDir)); }
    catch { return fail(req, "export_path_escape", "Facade output parent resolves outside the configured output root."); }
    if (await pathExists(safeOutputPath(config.outputDir, outputDir))) return fail(req, "export_output_exists", `Facade export refuses to overwrite existing output: ${outputDir}`);
    const sourceProjectHashBefore = hashSourceProject(project);
    let snapshot: LockedModelSnapshot;
    try { snapshot = await createLockedModelSnapshot(config, project, req, "facade-pack"); }
    catch (error) { return fail(req, "model_lock_invalid", error instanceof Error ? error.message : String(error)); }
    let result: BlenderToolResult;
    try { result = await runBlenderJob(config, {
      mode: "measurement_project",
      operation: "export_template",
      project,
      sourceBlendPath: snapshot.path,
      template: payload.template,
      templateOutputDir: safeOutputPath(config.outputDir, outputDir),
      options: { scale: payload.scale, views: payload.views, viewRegistry: project.viewRegistry, lockedModel: project.modelLock, capabilityManifest: DefaultCapabilityManifest, strategies: PermitExportStrategies }
    }, outputBlend); }
    catch (error) { await rm(safeOutputPath(config.outputDir, outputDir), { recursive: true, force: true }); return fail(req, "blender_export_failed", error instanceof Error ? error.message : String(error), ["All partial facade artifacts were removed."]); }
    finally { await snapshot.remove(); }
    if (!result.ok) {
      await rm(safeOutputPath(config.outputDir, outputDir), { recursive: true, force: true });
      return fail(req, "blender_export_failed", "Blender did not produce a valid facade-completion export.", [result.stderr], { blender: result });
    }
    const exportOutputDir = safeOutputPath(config.outputDir, outputDir);
    let exportManifest: unknown;
    try {
      exportManifest = JSON.parse(await readFile(path.join(exportOutputDir, "manifest.json"), "utf8")) as unknown;
    } catch {
      await rm(safeOutputPath(config.outputDir, outputDir), { recursive: true, force: true });
      return fail(req, "export_manifest_missing", "Facade export did not produce a readable manifest.", [], { blocking: [{ code: "export_manifest_missing", message: "Expected manifest.json is missing or invalid." }] });
    }
    const qa = await evaluateFacadeQaManifest({ manifest: exportManifest, project, requiredViews: payload.views, exportOutputDir, sourceProjectHashBefore });
    if (!qa.ok) {
      await rm(safeOutputPath(config.outputDir, outputDir), { recursive: true, force: true });
      return fail(req, "facade_qa_failed", "Facade export manifest failed the pixel-perfect contract gates.", qa.blocking.map((reason) => `${reason.code}: ${reason.message}`), { blocking: qa.blocking, visualDiff: qa.visualDiff });
    }
    const artifactKey = `facadeCompletionPack:${payload.template}`;
    const next = { ...project, artifacts: { ...project.artifacts, [artifactKey]: safeOutputPath(config.outputDir, outputDir) } };
    await writeProject(config, next);
    await appendRequestLog(config, payload.projectId, req, "export_facade_completion_pack", payload);
    const executionAction = exportActionEvidence(payload.executionIntent, result, outputDir, { template: payload.template, outputDir, qualityGate: gate, capability, blender: result });
    return ok(req, { blender: result, template: payload.template, outputDir: next.artifacts[artifactKey], qualityGate: gate, capability, facadeQa: qa, execution: { intent: payload.executionIntent, action: executionAction } }, exportTemplateWarnings(payload.template));
  });

  register(server, "export_project_template", "Export a recipient-specific measured visualization package without changing or reconstructing project geometry.", ExportProjectTemplateSchema, async (input) => {
    const req = requestId();
    const payload = ExportProjectTemplateSchema.parse(input);
    const executionGate = evaluateExecutionIntent(payload.executionIntent, "export-template");
    if (!executionGate.ok) {
      return failExecutionIntent(req, executionGate);
    }
    const project = materializeProfiles(await readProject(config, payload.projectId));
    const lockValidation = await validateModelLock(config, project);
    if (!lockValidation.ok) return failInvalidModelLock(req, lockValidation);
    const outputDir = payload.outputDir ?? path.join("measurement-projects", payload.projectId, "exports", payload.template);
    const outputBlend = path.join(outputDir, `${payload.projectId}-${payload.template}.blend`);
    try { await assertOutputParentWithinRoot(config.outputDir, safeOutputPath(config.outputDir, outputDir)); }
    catch { return fail(req, "export_path_escape", "Template output parent resolves outside the configured output root."); }
    if (await pathExists(safeOutputPath(config.outputDir, outputDir))) return fail(req, "export_output_exists", `Template export refuses to overwrite existing output: ${outputDir}`);
    let snapshot: LockedModelSnapshot;
    try { snapshot = await createLockedModelSnapshot(config, project, req, "project-template"); }
    catch (error) { return fail(req, "model_lock_invalid", error instanceof Error ? error.message : String(error)); }
    let result: BlenderToolResult;
    try { result = await runBlenderJob(config, { mode: "measurement_project", operation: "export_template", project, sourceBlendPath: snapshot.path, template: payload.template, templateOutputDir: safeOutputPath(config.outputDir, outputDir), options: { ...payload.options, lockedModel: project.modelLock } }, outputBlend); }
    catch (error) { await rm(safeOutputPath(config.outputDir, outputDir), { recursive: true, force: true }); return fail(req, "template_export_failed", error instanceof Error ? error.message : String(error), ["All partial template artifacts were removed."]); }
    finally { await snapshot.remove(); }
    if (!result.ok) {
      await rm(safeOutputPath(config.outputDir, outputDir), { recursive: true, force: true });
      return fail(req, "template_export_failed", "Blender could not export the template from the locked model; partial artifacts were removed.", [result.stderr]);
    }
    try { await validateArtifact(config.outputDir, outputBlend, "blend"); await validateDeclaredTemplateArtifacts(config.outputDir, outputDir); }
    catch (error) { await rm(safeOutputPath(config.outputDir, outputDir), { recursive: true, force: true }); return fail(req, "template_export_artifact_invalid", error instanceof Error ? error.message : String(error)); }
    const artifactKey = `template:${payload.template}`;
    const next = { ...project, artifacts: { ...project.artifacts, [artifactKey]: safeOutputPath(config.outputDir, outputDir) } };
    await writeProject(config, next);
    await appendRequestLog(config, payload.projectId, req, "export_project_template", payload);
    const executionAction = exportActionEvidence(payload.executionIntent, result, outputDir, { template: payload.template, outputDir, blender: result });
    return ok(req, { blender: result, template: payload.template, outputDir: next.artifacts[artifactKey], execution: { intent: payload.executionIntent, action: executionAction } }, exportTemplateWarnings(payload.template));
  });

  register(server, "list_digital_viewing_capture_presets", "List deterministic domain capture presets that define required photos, measurements, materials, and condition evidence before rendering.", ListDigitalViewingCapturePresetsInputSchema, (input) => {
    const req = requestId();
    ListDigitalViewingCapturePresetsInputSchema.parse(input);
    return ok(req, { presets: listDigitalViewingCapturePresets() });
  });

  register(server, "get_digital_viewing_capture_preset", "Get the deterministic capture requirements for a specific asset type and delivery tier.", GetDigitalViewingCapturePresetInputSchema, (input) => {
    const req = requestId();
    const payload = GetDigitalViewingCapturePresetInputSchema.parse(input);
    try {
      const preset = getDigitalViewingCapturePreset(payload.assetType, payload.deliveryTier);
      return ok(req, { preset });
    } catch (error) {
      return fail(req, "capture_preset_missing", error instanceof Error ? error.message : String(error));
    }
  });

  register(server, "get_digital_viewing_capture_guide", "Get deterministic shot lists and machine-readable measurement, material, and inspection checklists for capture operators.", GetDigitalViewingCaptureGuideInputSchema, (input) => {
    const req = requestId();
    const payload = GetDigitalViewingCaptureGuideInputSchema.parse(input);
    try {
      const guide = buildDigitalViewingCaptureGuide(payload.assetType, payload.deliveryTier);
      return ok(req, { guide }, [
        "Capture guide is not geometry authority.",
        "Measurements remain the primary source of truth; photos are material, condition, context, and validation evidence."
      ]);
    } catch (error) {
      return fail(req, "capture_preset_missing", error instanceof Error ? error.message : String(error));
    }
  });

  register(server, "validate_digital_viewing_capture_preset", "Validate a digital-viewing capture against its domain preset before Blender rendering or model generation.", ValidateDigitalViewingCapturePresetInputSchema, (input) => {
    const req = requestId();
    const payload = ValidateDigitalViewingCapturePresetInputSchema.parse(input);
    let preset;
    try {
      preset = getDigitalViewingCapturePreset(payload.capture.assetType, payload.deliveryTier);
    } catch (error) {
      return fail(req, "capture_preset_missing", error instanceof Error ? error.message : String(error));
    }
    const guide = buildDigitalViewingCaptureGuide(payload.capture.assetType, payload.deliveryTier);
    const captureValidation = validateDigitalViewingCapture(payload.capture);
    const deliveryReadiness = evaluateDigitalViewingDeliveryReadiness(payload.capture, payload.deliveryTier);
    const presetReadiness = evaluateDigitalViewingCapturePreset(payload.capture, preset);
    const blocking = [...captureValidation.blocking, ...deliveryReadiness.blocking, ...presetReadiness.blocking];
    const warnings = [
      ...captureValidation.warnings.map((reason) => `${reason.code}: ${reason.message}`),
      ...deliveryReadiness.warnings.map((reason) => `${reason.code}: ${reason.message}`),
      ...presetReadiness.warnings.map((reason) => `${reason.code}: ${reason.message}`)
    ];
    if (blocking.length > 0) {
      const repairSummary = buildDigitalViewingCaptureRepairSummary(blocking);
      return fail(
        req,
        "digital_viewing_capture_not_ready",
        "Capture does not satisfy the selected domain preset and delivery tier.",
        warnings,
        { preset, guide, repairSummary, captureValidation, deliveryReadiness, presetReadiness, blocking }
      );
    }
    return ok(req, { preset, guide, repairSummary: buildDigitalViewingCaptureRepairSummary([]), captureValidation, deliveryReadiness, presetReadiness }, warnings);
  });

  register(server, "list_digital_viewing_delivery_profiles", "List deterministic customer-surface delivery profiles and their required package targets.", ListDigitalViewingDeliveryProfilesInputSchema, (input) => {
    const req = requestId();
    ListDigitalViewingDeliveryProfilesInputSchema.parse(input);
    return ok(req, { profiles: listDigitalViewingDeliveryProfiles() }, [
      "Delivery profiles are not geometry authority.",
      "Profiles define customer-facing package targets only; they do not render, infer, or mutate geometry."
    ]);
  });

  register(server, "get_digital_viewing_delivery_profile", "Get one deterministic customer-surface delivery profile and its required package targets.", GetDigitalViewingDeliveryProfileInputSchema, (input) => {
    const req = requestId();
    const payload = GetDigitalViewingDeliveryProfileInputSchema.parse(input);
    try {
      return ok(req, { profile: getDigitalViewingDeliveryProfile(payload.customerSurface) }, [
        "Delivery profile is not geometry authority.",
        "Profile defines customer-facing package targets only; it does not render, infer, or mutate geometry."
      ]);
    } catch (error) {
      return fail(req, "delivery_profile_missing", error instanceof Error ? error.message : String(error));
    }
  });

  register(server, "evaluate_digital_viewing_delivery_profile", "Evaluate whether a capture declares the required output targets for a customer-facing delivery profile.", EvaluateDigitalViewingDeliveryProfileInputSchema, (input) => {
    const req = requestId();
    const payload = EvaluateDigitalViewingDeliveryProfileInputSchema.parse(input);
    const readiness = evaluateDigitalViewingDeliveryProfileReadiness(payload.capture, payload.customerSurface);
    if (!readiness.ok) {
      return fail(
        req,
        "digital_viewing_delivery_profile_not_ready",
        "Capture outputTargets do not satisfy the selected customer-surface delivery profile.",
        readiness.warnings.map((reason) => `${reason.code}: ${reason.message}`),
        { readiness, blocking: readiness.blocking }
      );
    }
    return ok(req, { readiness }, readiness.warnings.map((reason) => `${reason.code}: ${reason.message}`));
  });

  register(server, "render_digital_viewing_preview", "Render a photorealistic preview from a locked Blender source using a deterministic digital-viewing manifest.", RenderDigitalViewingPreviewInputSchema, async (input) => {
    const req = requestId();
    const payload = RenderDigitalViewingPreviewInputSchema.parse(input);
    let preset;
    try {
      preset = getDigitalViewingCapturePreset(payload.capture.assetType, payload.renderPreset.deliveryTier);
    } catch (error) {
      return fail(req, "capture_preset_missing", error instanceof Error ? error.message : String(error));
    }
    const presetReadiness = evaluateDigitalViewingCapturePreset(payload.capture, preset);
    if (!presetReadiness.ok) {
      return fail(
        req,
        "digital_viewing_capture_not_ready",
        "Capture must satisfy the selected domain preset before rendering.",
        presetReadiness.warnings.map((reason) => `${reason.code}: ${reason.message}`),
        { preset, presetReadiness }
      );
    }
    const project = materializeProfiles(await readProject(config, payload.capture.projectId));
    if (project.modelLock.modelArtifact !== payload.sourceBlendPath) return fail(req, "model_lock_invalid", "Preview source must be the exact Blender artifact declared by the project model lock.");
    const lockValidation = await validateModelLock(config, project);
    if (!lockValidation.ok) return failInvalidModelLock(req, lockValidation);
    const job = buildDigitalViewingBlenderRenderJob(payload.capture, payload.renderPreset, payload.sourceBlendPath, DefaultCapabilityManifest, payload.assetBundleManifest);
    const outputBlend = payload.outputBlendPath ?? payload.renderPreset.outputPath.replace(/\.[^.]+$/, ".blend");
    const renderOutputs = [outputBlend, job.renderManifest.artifacts.render, job.renderManifest.artifacts.manifest];
    try { await Promise.all(renderOutputs.map((output) => assertOutputParentWithinRoot(config.outputDir, safeOutputPath(config.outputDir, output)))); }
    catch { return fail(req, "render_path_escape", "Preview output parent resolves outside the configured output root."); }
    const renderCollisions = await existingRelativePaths(config.outputDir, renderOutputs);
    if (renderCollisions.length > 0) return fail(req, "render_output_exists", `Preview render refuses to overwrite existing artifacts: ${renderCollisions.join(", ")}`);
    let snapshot: LockedModelSnapshot;
    try { snapshot = await createLockedModelSnapshot(config, project, req, "digital-viewing"); }
    catch (error) { return fail(req, "model_lock_invalid", error instanceof Error ? error.message : String(error)); }
    let result: BlenderToolResult;
    try { result = await runBlenderJob(config, { ...job, sourceBlendPath: snapshot.path, authoritySourceBlendPath: payload.sourceBlendPath }, outputBlend); }
    catch (error) { await removeRelativePaths(config.outputDir, renderOutputs); return fail(req, "digital_viewing_render_failed", error instanceof Error ? error.message : String(error), ["All partial preview artifacts were removed."]); }
    finally { await snapshot.remove(); }
    if (!result.ok) {
      await removeRelativePaths(config.outputDir, renderOutputs);
      return fail(req, "digital_viewing_render_failed", "Blender could not render the preview from the locked model; partial artifacts were removed.", [result.stderr]);
    }
    await appendRequestLog(config, payload.capture.projectId, req, "render_digital_viewing_preview", {
      captureId: payload.capture.captureId,
      projectId: payload.capture.projectId,
      sourceBlendPath: payload.sourceBlendPath,
      renderPreset: payload.renderPreset,
      outputBlendPath: outputBlend,
      renderManifestHash: job.renderManifest.hashes.manifestHash
    });
    return ok(req, {
      blender: result,
      renderManifest: job.renderManifest,
      artifacts: job.renderManifest.artifacts
    }, [
      "Photorealistic preview is not geometry authority.",
      "Render used locked Blender geometry and did not reconstruct geometry in the export stage."
    ]);
  });

  register(server, "align_and_project_source_photo", "Align an exact source photo to a measured planar host using explicit anchors, then apply it to a geometry-preserving Blender copy.", SourceProjectionInputSchema, async (input) => {
    const req = requestId();
    let alignment;
    try {
      alignment = buildSourceProjectionManifest(input);
    } catch (error) {
      if (error instanceof SourceProjectionError) return fail(req, error.code, error.message);
      throw error;
    }
    const sourcePhotoPath = safeOutputPath(config.outputDir, input.sourcePhoto.path);
    const sourceBlendPath = safeOutputPath(config.outputDir, input.sourceBlendPath);
    const outputBlendPath = safeOutputPath(config.outputDir, input.outputBlendPath);
    const outputReportPath = safeOutputPath(config.outputDir, input.outputReportPath);
    if (!(await pathExists(sourcePhotoPath))) return fail(req, "source_projection_photo_missing", `Source photo is missing: ${input.sourcePhoto.path}`);
    if (!(await pathExists(sourceBlendPath))) return fail(req, "source_projection_blend_missing", `Locked source is missing: ${input.sourceBlendPath}`);
    try {
      await Promise.all([
        assertExistingPathWithinRoot(config.outputDir, sourcePhotoPath),
        assertExistingPathWithinRoot(config.outputDir, sourceBlendPath),
        assertOutputParentWithinRoot(config.outputDir, outputBlendPath),
        assertOutputParentWithinRoot(config.outputDir, outputReportPath)
      ]);
    } catch {
      return fail(req, "source_projection_path_escape", "Projection input or output resolves outside the configured output root.");
    }
    let project;
    try {
      project = materializeProfiles(await readProject(config, input.projectId));
    } catch (error) {
      return fail(req, "source_projection_model_lock_invalid", error instanceof Error ? error.message : String(error));
    }
    if (project.modelLock.modelArtifact !== input.sourceBlendPath) {
      return fail(req, "source_projection_model_lock_invalid", "Projection source must be the exact Blender artifact declared by the project model lock.");
    }
    const lockValidation = await validateModelLock(config, project);
    if (!lockValidation.ok) {
      return fail(req, "source_projection_model_lock_invalid", "Projection source no longer matches the reviewed model lock.", lockValidation.blocking.map((reason) => `${reason.code}: ${reason.message}`));
    }
    const sourcePhoto = await readFile(sourcePhotoPath);
    const sourcePhotoStat = await stat(sourcePhotoPath);
    const sourceBlendStat = await stat(sourceBlendPath);
    if (!sourcePhotoStat.isFile()) return fail(req, "source_projection_photo_missing", `Source photo is not a file: ${input.sourcePhoto.path}`);
    if (!sourceBlendStat.isFile()) return fail(req, "source_projection_blend_missing", `Locked source is not a file: ${input.sourceBlendPath}`);
    const actualIdentity = { sizeBytes: sourcePhotoStat.size, sha256: createHash("sha256").update(sourcePhoto).digest("hex") };
    if (actualIdentity.sizeBytes !== input.sourcePhoto.sizeBytes || actualIdentity.sha256 !== input.sourcePhoto.sha256) {
      return fail(req, "source_projection_photo_identity_mismatch", `Source photo no longer matches declared size and SHA-256: ${input.sourcePhoto.path}`);
    }
    const dimensions = imageDimensions(sourcePhoto);
    if (!dimensions || dimensions.width !== input.sourcePhoto.pixelWidth || dimensions.height !== input.sourcePhoto.pixelHeight) {
      return fail(req, "source_projection_photo_dimensions_mismatch", `Source photo dimensions do not match the declared pixel dimensions: ${input.sourcePhoto.path}`);
    }
    if (await pathExists(outputBlendPath) || await pathExists(outputReportPath)) {
      return fail(req, "source_projection_output_exists", "Projection refuses to overwrite an existing blend or execution report.");
    }
    const job = buildSourceProjectionBlenderJob(input, alignment);
    const result = await runBlenderJob(config, job, input.outputBlendPath);
    if (!result.ok) {
      await Promise.all([rm(outputBlendPath, { force: true }), rm(outputReportPath, { force: true })]);
      return fail(req, "source_projection_execution_failed", "Blender could not apply the source-backed projection; partial outputs were removed.", [result.stderr]);
    }
    let report;
    try {
      report = SourceProjectionExecutionReportSchema.parse(JSON.parse(await readFile(outputReportPath, "utf8")));
      if (
        report.alignmentManifestHash !== alignment.manifestHash
        || report.sourcePhotoIdentity.path !== input.sourcePhoto.path
        || report.sourcePhotoIdentity.sizeBytes !== input.sourcePhoto.sizeBytes
        || report.sourcePhotoIdentity.sha256 !== input.sourcePhoto.sha256
        || report.sourceBlendPath !== input.sourceBlendPath
        || report.hostElementId !== input.target.hostElementId
        || report.face !== input.target.face
      ) {
        throw new Error("Projection execution report does not match the alignment or source photo identity.");
      }
    } catch (error) {
      await Promise.all([rm(outputBlendPath, { force: true }), rm(outputReportPath, { force: true })]);
      return fail(req, "source_projection_report_invalid", error instanceof Error ? error.message : String(error), ["Projection outputs were removed during recovery."]);
    }
    await appendRequestLog(config, input.projectId, req, "align_and_project_source_photo", { alignmentManifestHash: alignment.manifestHash, sourceBlendPath: input.sourceBlendPath, outputBlendPath: input.outputBlendPath, outputReportPath: input.outputReportPath });
    return ok(req, { alignment, blender: result, report, artifacts: { blend: input.outputBlendPath, report: input.outputReportPath } }, ["Projection is visual evidence only and did not mutate locked geometry."]);
  });

  register(server, "generate_digital_viewing_material_authoring_plan", "Generate deterministic per-material PBR authoring requirements before Blender rendering without changing geometry.", GenerateDigitalViewingMaterialAuthoringPlanInputSchema, async (input) => {
    const req = requestId();
    const payload = GenerateDigitalViewingMaterialAuthoringPlanInputSchema.parse(input);
    const plan = buildDigitalViewingMaterialAuthoringPlan(payload.capture, payload.deliveryTier);
    const planPath = payload.outputPath ? safeOutputPath(config.outputDir, payload.outputPath) : undefined;
    if (planPath) {
      await mkdir(path.dirname(planPath), { recursive: true });
      await writeFile(planPath, serializeDigitalViewingMaterialAuthoringPlan(plan), "utf8");
      await appendRequestLog(config, payload.capture.projectId, req, "generate_digital_viewing_material_authoring_plan", {
        captureId: payload.capture.captureId,
        projectId: payload.capture.projectId,
        deliveryTier: payload.deliveryTier,
        outputPath: payload.outputPath,
        planHash: plan.hashes.planHash
      });
    }
    if (!plan.summary.ready) {
      return fail(
        req,
        "digital_viewing_material_authoring_incomplete",
        "Material authoring plan found missing PBR evidence required for the selected delivery tier.",
        plan.materials.flatMap((material) => material.warnings.map((reason) => `${reason.code}: ${reason.message}`)),
        { plan, planPath, blocking: plan.materials.flatMap((material) => material.blocking) }
      );
    }
    return ok(req, { plan, planPath }, [
      "Material authoring plan is not geometry authority.",
      "Plan defines PBR evidence requirements only; it does not reconstruct or mutate geometry."
    ]);
  });

  register(server, "generate_digital_viewing_material_report", "Generate a deterministic material and condition evidence report from capture data and optional Blender render execution metadata.", GenerateDigitalViewingMaterialReportInputSchema, async (input) => {
    const req = requestId();
    const payload = GenerateDigitalViewingMaterialReportInputSchema.parse(input);
    const report = buildDigitalViewingMaterialConditionReport(payload.capture, payload.deliveryTier, payload.renderManifest);
    const reportPath = payload.outputPath ? safeOutputPath(config.outputDir, payload.outputPath) : undefined;
    if (reportPath) {
      await mkdir(path.dirname(reportPath), { recursive: true });
      await writeFile(reportPath, serializeDigitalViewingMaterialConditionReport(report), "utf8");
      await appendRequestLog(config, payload.capture.projectId, req, "generate_digital_viewing_material_report", {
        captureId: payload.capture.captureId,
        projectId: payload.capture.projectId,
        deliveryTier: payload.deliveryTier,
        outputPath: payload.outputPath,
        reportHash: report.hashes.reportHash
      });
    }
    if (!report.readiness.ok) {
      return fail(
        req,
        "digital_viewing_report_not_ready",
        "Material and condition report can be generated, but the selected delivery tier is not ready.",
        report.readiness.warnings.map((reason) => `${reason.code}: ${reason.message}`),
        { report, reportPath, blocking: report.readiness.blocking }
      );
    }
    return ok(req, { report, reportPath }, [
      "Material and condition report is not geometry authority.",
      "Report summarizes measured and photo-backed evidence only; it does not reconstruct geometry."
    ]);
  });

  register(server, "generate_digital_viewing_delivery_package", "Generate a deterministic delivery-package manifest with photoreal quality checklist, render evidence, material authoring, and material-condition evidence without changing geometry.", GenerateDigitalViewingDeliveryPackageInputSchema, async (input) => {
    const req = requestId();
    const payload = GenerateDigitalViewingDeliveryPackageInputSchema.parse(input);
    const deliveryPackage = buildDigitalViewingDeliveryPackageManifest(
      payload.capture,
      payload.renderManifest,
      payload.deliveryTargets,
      payload.customerSurface,
      payload.assetBundleManifest,
      payload.assetBundleManifestPath,
      payload.deliveryArtifacts
    );
    const packagePath = payload.outputPath ? safeOutputPath(config.outputDir, payload.outputPath) : undefined;
    if (packagePath) {
      await mkdir(path.dirname(packagePath), { recursive: true });
      await writeFile(packagePath, serializeDigitalViewingDeliveryPackageManifest(deliveryPackage), "utf8");
      await appendRequestLog(config, payload.capture.projectId, req, "generate_digital_viewing_delivery_package", {
        captureId: payload.capture.captureId,
        projectId: payload.capture.projectId,
        deliveryTier: payload.renderManifest.renderPreset.deliveryTier,
        outputPath: payload.outputPath,
        packageHash: deliveryPackage.hashes.packageHash
      });
    }
    if (!deliveryPackage.qualityGates.ready) {
      return fail(
        req,
        "digital_viewing_delivery_package_not_ready",
        "Delivery package manifest found contract mismatches or blocking quality gates.",
        deliveryPackage.qualityGates.warnings.map((reason) => `${reason.code}: ${reason.message}`),
        { deliveryPackage, packagePath, blocking: deliveryPackage.qualityGates.blocking }
      );
    }
    return ok(req, { deliveryPackage, packagePath }, [
      "Delivery package manifest is not geometry authority.",
      "Package indexes validated capture, material, render, and report artifacts only; it does not reconstruct or mutate geometry."
    ]);
  });

  register(server, "generate_digital_viewing_asset_bundle_manifest", "Generate a deterministic pre-render asset-bundle readiness manifest without starting Blender or changing geometry.", GenerateDigitalViewingAssetBundleManifestInputSchema, async (input) => {
    const req = requestId();
    const payload = GenerateDigitalViewingAssetBundleManifestInputSchema.parse(input);
    const scannedFiles = payload.scanOutputDir ? await listOutputDirFiles(config.outputDir) : [];
    const scannedFilePaths = scannedFiles.map((file) => file.path);
    const assetBundle = buildDigitalViewingAssetBundleManifest(payload.capture, payload.renderManifest, {
      existingFiles: Array.from(new Set([...payload.existingFiles, ...scannedFilePaths])).sort((left, right) => left.localeCompare(right)),
      assetFiles: scannedFiles
    });
    const assetBundlePath = payload.outputPath ? safeOutputPath(config.outputDir, payload.outputPath) : undefined;
    if (assetBundlePath) {
      await mkdir(path.dirname(assetBundlePath), { recursive: true });
      await writeFile(assetBundlePath, serializeDigitalViewingAssetBundleManifest(assetBundle), "utf8");
      await appendRequestLog(config, payload.capture.projectId, req, "generate_digital_viewing_asset_bundle_manifest", {
        captureId: payload.capture.captureId,
        projectId: payload.capture.projectId,
        deliveryTier: payload.renderManifest.renderPreset.deliveryTier,
        outputPath: payload.outputPath,
        assetBundleHash: assetBundle.hashes.assetBundleHash
      });
    }
    if (!assetBundle.qualityGates.ready) {
      return fail(
        req,
        "digital_viewing_asset_bundle_not_ready",
        "Asset bundle manifest found missing files required before premium Blender rendering.",
        assetBundle.qualityGates.warnings.map((reason) => `${reason.code}: ${reason.message}`),
        { assetBundle, assetBundlePath, blocking: assetBundle.qualityGates.blocking }
      );
    }
    return ok(req, { assetBundle, assetBundlePath }, [
      "Asset bundle manifest is not geometry authority.",
      "Bundle checks declared evidence and texture files only; it does not start Blender, reconstruct geometry, or mutate geometry."
    ]);
  });

  register(server, "run_blender_python", "UNSAFE fallback only. Runs explicit user-approved Blender Python after opt-in, with restricted builtins/imports and audit logging.", UnsafeRunPythonSchema, async (input) => {
    const req = requestId();
    const payload = UnsafeRunPythonSchema.parse(input);
    const result = await runBlenderJob(config, { mode: "python", ...payload, requestId: req }, payload.outputFile ?? "python-output.blend");
    return ok(req, { blender: result }, ["Unsafe Python execution was explicitly allowed and audited."]);
  });
}

function failExecutionIntent(req: string, gate: ReturnType<typeof evaluateExecutionIntent>) {
  return fail(
    req,
    "execution_intent_rejected",
    "Measured write execution requires an explicit Namaka/Axiome-compatible intent envelope.",
    gate.blocking.map((reason) => `${reason.code}: ${reason.message}`),
    { intentHash: gate.intentHash, blocking: gate.blocking }
  );
}

function exportActionEvidence(
  intent: ExecutionIntent,
  result: BlenderToolResult,
  declaredArtifact: string,
  manifest: unknown
) {
  const changedArtifacts = Array.from(new Set([declaredArtifact, ...(result.outputPath ? [result.outputPath] : [])]));
  return buildExecutionActionEvidence(intent, {
    changedArtifacts,
    verificationResults: [
      { check: "schema", ok: true, evidence: "Export input and execution intent matched strict schemas." },
      { check: "quality-gate", ok: result.ok, evidence: result.ok ? "Blender export completed without fallback." : `Blender export failed causally: ${result.error?.code ?? "unknown_error"}.` },
      { check: "manifest", ok: true, evidence: "Action manifest hash derived from declared export result." }
    ],
    manifest
  });
}

type ScannedAssetFile = {
  path: string;
  sizeBytes: number;
  sha256: string;
  width?: number;
  height?: number;
};

async function listOutputDirFiles(outputDir: string): Promise<ScannedAssetFile[]> {
  const root = path.resolve(outputDir);
  const files: ScannedAssetFile[] = [];
  await collectRelativeFiles(root, root, files);
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

async function collectRelativeFiles(root: string, directory: string, files: ScannedAssetFile[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectRelativeFiles(root, absolute, files);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const [metadata, contents] = await Promise.all([stat(absolute), readFile(absolute)]);
    const dimensions = imageDimensions(contents);
    files.push({
      path: path.relative(root, absolute).split(path.sep).join("/"),
      sizeBytes: metadata.size,
      sha256: createHash("sha256").update(contents).digest("hex"),
      ...dimensions
    });
  }
}

function imageDimensions(contents: Buffer): { width: number; height: number } | undefined {
  if (contents.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) && contents.length >= 24) {
    return {
      width: contents.readUInt32BE(16),
      height: contents.readUInt32BE(20)
    };
  }
  if (contents[0] === 0xff && contents[1] === 0xd8) {
    let cursor = 2;
    while (cursor + 9 < contents.length) {
      if (contents[cursor] !== 0xff) {
        cursor += 1;
        continue;
      }
      const marker = contents[cursor + 1];
      cursor += 2;
      if (marker === 0xd8 || marker === 0xd9) {
        continue;
      }
      if (cursor + 2 > contents.length) {
        break;
      }
      const segmentLength = contents.readUInt16BE(cursor);
      if (segmentLength < 2 || cursor + segmentLength > contents.length) {
        break;
      }
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return {
          height: contents.readUInt16BE(cursor + 3),
          width: contents.readUInt16BE(cursor + 5)
        };
      }
      cursor += segmentLength;
    }
  }
  return undefined;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

type LockedModelSnapshot = { path: string; remove: () => Promise<void> };

async function createLockedModelSnapshot(
  config: BlenderConfig,
  project: MeasurementProject,
  req: string,
  purpose: string
): Promise<LockedModelSnapshot> {
  const source = project.modelLock.modelArtifact;
  const expectedHash = project.modelLock.modelHash;
  if (!source || !expectedHash) throw new Error("Reviewed model lock is incomplete.");
  const sourceAbsolute = safeOutputPath(config.outputDir, source);
  await assertExistingPathWithinRoot(config.outputDir, sourceAbsolute);
  const snapshotPath = path.join("measurement-projects", project.projectId, "artifacts", `.${purpose}-${req}.blend`);
  const snapshotAbsolute = safeOutputPath(config.outputDir, snapshotPath);
  try {
    await mkdir(path.dirname(snapshotAbsolute), { recursive: true });
    await assertOutputParentWithinRoot(config.outputDir, snapshotAbsolute);
    await copyFile(sourceAbsolute, snapshotAbsolute);
    await assertExistingPathWithinRoot(config.outputDir, snapshotAbsolute);
    const actualHash = createHash("sha256").update(await readFile(snapshotAbsolute)).digest("hex");
    if (actualHash !== expectedHash) throw new Error("Locked Blender source changed while its immutable execution snapshot was created.");
    return { path: snapshotPath, remove: () => rm(snapshotAbsolute, { force: true }) };
  } catch (error) {
    await rm(snapshotAbsolute, { force: true });
    throw error;
  }
}

function failInvalidModelLock(req: string, validation: Awaited<ReturnType<typeof validateModelLock>>) {
  return fail(req, "model_lock_invalid", "Delivery requires the exact unchanged reviewed Blender model.", validation.blocking.map((reason) => `${reason.code}: ${reason.message}`), { blocking: validation.blocking });
}

async function existingRelativePaths(outputDir: string, paths: string[]): Promise<string[]> {
  const checked = await Promise.all(paths.map(async (relativePath) => ({ relativePath, exists: await pathExists(safeOutputPath(outputDir, relativePath)) })));
  return checked.filter((entry) => entry.exists).map((entry) => entry.relativePath);
}

async function removeRelativePaths(outputDir: string, paths: string[]): Promise<void> {
  await Promise.all(paths.map((relativePath) => rm(safeOutputPath(outputDir, relativePath), { force: true })));
}

async function validateArtifact(outputDir: string, relativePath: string, format: "blend" | "pdf" | "json") {
  const contents = await readFile(safeOutputPath(outputDir, relativePath));
  if (contents.byteLength === 0) throw new Error(`${format.toUpperCase()} artifact is empty: ${relativePath}`);
  if (format === "blend" && contents.subarray(0, 7).toString("ascii") !== "BLENDER" && !contents.subarray(0, 4).equals(Buffer.from([0x28, 0xb5, 0x2f, 0xfd]))) {
    throw new Error(`Blend artifact has an invalid Blender header: ${relativePath}`);
  }
  if (format === "pdf" && (contents.subarray(0, 5).toString("ascii") !== "%PDF-" || !contents.subarray(Math.max(0, contents.length - 64)).includes(Buffer.from("%%EOF")))) {
    throw new Error(`PDF artifact has an invalid header or trailer: ${relativePath}`);
  }
  if (format === "json") {
    try { JSON.parse(contents.toString("utf8")); } catch { throw new Error(`JSON artifact is invalid: ${relativePath}`); }
  }
  return { format, path: relativePath, sizeBytes: contents.byteLength, sha256: createHash("sha256").update(contents).digest("hex") };
}

async function validateDeclaredTemplateArtifacts(outputRoot: string, outputDir: string): Promise<void> {
  const manifestPath = path.join(outputDir, "manifest.json");
  const manifestContents = await readFile(safeOutputPath(outputRoot, manifestPath));
  let manifest: unknown;
  try { manifest = JSON.parse(manifestContents.toString("utf8")); }
  catch { throw new Error(`JSON artifact is invalid: ${manifestPath}`); }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("Template manifest must be an object.");
  const record = manifest as Record<string, unknown>;
  if (!record.artifacts || typeof record.artifacts !== "object" || Array.isArray(record.artifacts)) throw new Error("Template manifest must declare its complete artifact set.");
  if (!record.artifactIdentities || typeof record.artifactIdentities !== "object" || Array.isArray(record.artifactIdentities)) throw new Error("Template manifest must bind every artifact identity.");
  const artifacts = record.artifacts as Record<string, unknown>;
  const identities = record.artifactIdentities as Record<string, unknown>;
  const artifactKeys = Object.keys(artifacts).sort();
  if (artifactKeys.length === 0 || artifactKeys.join("\0") !== Object.keys(identities).sort().join("\0")) throw new Error("Template artifact identities do not exactly match the declared artifact set.");
  for (const key of artifactKeys) {
    const declaredPath = artifacts[key];
    const identity = identities[key];
    if (typeof declaredPath !== "string" || path.basename(declaredPath) !== declaredPath) throw new Error(`Template artifact path is invalid: ${String(declaredPath)}`);
    if (!identity || typeof identity !== "object" || Array.isArray(identity)) throw new Error(`Template artifact identity is invalid: ${key}`);
    const identityRecord = identity as Record<string, unknown>;
    const contents = await readFile(safeOutputPath(outputRoot, path.join(outputDir, declaredPath)));
    if (contents.byteLength === 0 || identityRecord.path !== declaredPath || identityRecord.sizeBytes !== contents.byteLength) throw new Error(`Template artifact identity does not match: ${declaredPath}`);
    const extension = path.extname(declaredPath).toLowerCase();
    validateTemplateArtifactType(declaredPath, extension, contents);
    const actualHash = extension === ".png" ? pngSemanticHash(contents) : createHash("sha256").update(contents).digest("hex");
    if (identityRecord.sha256 !== actualHash || identityRecord.hashScope !== (extension === ".png" ? "png-critical-chunks" : "complete-file")) throw new Error(`Template artifact hash does not match: ${declaredPath}`);
  }
}

function validateTemplateArtifactType(relativePath: string, extension: string, contents: Buffer): void {
  if (extension === ".pdf" && (contents.subarray(0, 5).toString("ascii") !== "%PDF-" || !contents.subarray(Math.max(0, contents.length - 64)).includes(Buffer.from("%%EOF")))) throw new Error(`Template PDF is invalid: ${relativePath}`);
  if (extension === ".png" && !contents.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) throw new Error(`Template PNG is invalid: ${relativePath}`);
  if (extension === ".glb" && contents.subarray(0, 4).toString("ascii") !== "glTF") throw new Error(`Template GLB is invalid: ${relativePath}`);
  if (extension === ".obj" && !bufferHasObjVertex(contents)) throw new Error(`Template OBJ contains no vertices: ${relativePath}`);
  if (extension === ".svg" && !contents.subarray(0, 1024).includes(Buffer.from("<svg"))) throw new Error(`Template SVG is invalid: ${relativePath}`);
  if (extension === ".json") { try { JSON.parse(contents.toString("utf8")); } catch { throw new Error(`Template JSON is invalid: ${relativePath}`); } }
  if (![".pdf", ".png", ".glb", ".obj", ".svg", ".json"].includes(extension)) throw new Error(`Unsupported template artifact type: ${relativePath}`);
}

function pngSemanticHash(contents: Buffer): string {
  const hash = createHash("sha256");
  let offset = 8;
  while (offset + 12 <= contents.length) {
    const length = contents.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > contents.length) throw new Error("PNG chunk exceeds artifact bounds.");
    const chunkType = contents.subarray(offset + 4, offset + 8);
    if (["IHDR", "PLTE", "IDAT", "IEND"].includes(chunkType.toString("ascii"))) {
      hash.update(chunkType);
      hash.update(contents.subarray(offset + 8, offset + 8 + length));
    }
    offset = end;
  }
  return hash.digest("hex");
}

type PortableExportArtifact = { format: "blend" | "glb" | "obj" | "mtl"; path: string };

function portableExportPaths(projectId: string, formats: Array<"blend" | "glb" | "obj">, outputBlend: string): PortableExportArtifact[] {
  const base = path.dirname(outputBlend);
  const requested = new Set(formats);
  requested.add("blend");
  const artifacts: PortableExportArtifact[] = (["blend", "glb", "obj"] as const)
    .filter((format) => requested.has(format))
    .map((format) => ({ format, path: format === "blend" ? outputBlend : path.join(base, `${projectId}.${format}`) }));
  if (requested.has("obj")) artifacts.push({ format: "mtl", path: path.join(base, `${projectId}.mtl`) });
  return artifacts;
}

async function validatePortableExportArtifact(outputDir: string, artifact: PortableExportArtifact) {
  const artifactPath = safeOutputPath(outputDir, artifact.path);
  const contents = await readFile(artifactPath);
  if (contents.byteLength === 0) throw new Error(`Portable ${artifact.format} artifact is empty: ${artifact.path}`);
  const blendHeaderValid = contents.subarray(0, 7).toString("ascii") === "BLENDER"
    || contents.subarray(0, 4).equals(Buffer.from([0x28, 0xb5, 0x2f, 0xfd]));
  if (artifact.format === "blend" && !blendHeaderValid) {
    throw new Error(`Portable blend artifact has an invalid Blender header: ${artifact.path}`);
  }
  if (artifact.format === "glb" && contents.subarray(0, 4).toString("ascii") !== "glTF") {
    throw new Error(`Portable GLB artifact has an invalid binary glTF header: ${artifact.path}`);
  }
  if (artifact.format === "obj" && !bufferHasObjVertex(contents)) {
    throw new Error(`Portable OBJ artifact contains no vertex records: ${artifact.path}`);
  }
  if (artifact.format === "mtl" && !contents.includes(Buffer.from("newmtl "))) throw new Error(`Portable MTL artifact contains no material records: ${artifact.path}`);
  return { ...artifact, sizeBytes: contents.byteLength, sha256: createHash("sha256").update(contents).digest("hex") };
}

function bufferHasObjVertex(contents: Buffer): boolean {
  if (contents.subarray(0, 2).equals(Buffer.from("v "))) return true;
  return contents.includes(Buffer.from("\nv ")) || contents.includes(Buffer.from("\rv "));
}

async function assertExistingPathWithinRoot(root: string, filePath: string): Promise<void> {
  const [realRoot, realFile] = await Promise.all([realpath(root), realpath(filePath)]);
  if (realFile !== realRoot && !realFile.startsWith(`${realRoot}${path.sep}`)) throw new Error("path_escape");
}

async function assertOutputParentWithinRoot(root: string, filePath: string): Promise<void> {
  const realRoot = await realpath(root);
  let ancestor = path.dirname(filePath);
  while (!(await pathExists(ancestor))) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) throw new Error("path_escape");
    ancestor = parent;
  }
  const realAncestor = await realpath(ancestor);
  if (realAncestor !== realRoot && !realAncestor.startsWith(`${realRoot}${path.sep}`)) throw new Error("path_escape");
}

function exportTemplateWarnings(template: string): string[] {
  const warnings = [
    "This server produces measured 3D visualization and permit-support artifacts, not CAD, BIM, DWG/STEP, or survey-grade output.",
    "Export templates must format Blender orthographic views only; they must not reconstruct, infer, or mutate geometry."
  ];
  if (template === "cad-simulated") {
    warnings.unshift("Template 'cad-simulated' is a deprecated legacy alias; use 'permit-facade-pack', 'swedish-municipality', or 'gothenburg-permit' for public workflows.");
  }
  return warnings;
}

export function qualityGate(project: MeasurementProject): QualityGateResult {
  const blocking: MachineReason[] = [];
  const warnings: MachineReason[] = [];
  if (project.photos.length === 0) {
    blocking.push({
      code: "reference_photos_missing",
      message: "At least one reference photo should be imported before facade export."
    });
  }
  if (project.dimensions.length === 0 && project.profiles.length === 0) {
    blocking.push({
      code: "measurement_source_missing",
      message: "At least one known dimension or typed profile is required."
    });
  }
  if (project.assumptions.some((assumption) => assumption.affectsGeometry && assumption.confidence === "low")) {
    blocking.push({
      code: "low_confidence_geometry_assumption",
      message: "Low-confidence assumptions affecting geometry must be resolved or explicitly upgraded before export."
    });
  }
  if (!project.validation.ok) {
    blocking.push({
      code: "validation_failed",
      message: "Project validation is not passing."
    });
  }
  const requiredViews = ["north", "south", "east", "west"];
  const availableViewLabels = new Set([
    ...project.photos.map((photo) => photo.view?.toLowerCase()).filter((value): value is string => Boolean(value)),
    ...project.planes.map((plane) => plane.id.toLowerCase())
  ]);
  const missingViewReferences = requiredViews.filter((view) => !availableViewLabels.has(view));
  if (missingViewReferences.length > 0) {
    blocking.push({
      code: "facade_reference_missing",
      message: `Missing facade reference labels for: ${missingViewReferences.join(", ")}.`
    });
  }
  return { ok: blocking.length === 0, blocking, warnings };
}

function formatReasons(gate: QualityGateResult): string[] {
  return [...gate.blocking, ...gate.warnings].map((reason) => `${reason.code}: ${reason.message}`);
}

function register<T extends z.ZodObject<z.ZodRawShape>>(server: McpServer, name: string, description: string, schema: T, handler: (input: z.infer<T>) => Promise<unknown> | object): void {
  server.tool(name, description, schema.shape, async (input) => {
    try {
      const body = await handler(input);
      const text = JSON.stringify(body, null, 2);
      return { content: [{ type: "text" as const, text }], isError: isErrorBody(body) };
    } catch (error) {
      const body = fail(requestId(), "tool_error", error instanceof Error ? error.message : String(error));
      return { content: [{ type: "text" as const, text: JSON.stringify(body, null, 2) }], isError: true };
    }
  });
}

function isErrorBody(value: unknown): boolean {
  return typeof value === "object" && value !== null && "ok" in value && value.ok === false;
}

function parseRecordParameters(parameters: unknown): Record<string, unknown> {
  if (typeof parameters !== "object" || parameters === null || Array.isArray(parameters)) {
    throw new Error("Generic profile parameters must be an object.");
  }
  return parameters as Record<string, unknown>;
}

function validateProject(project: MeasurementProject, checks: string[]) {
  const result = { ok: true, checks: [] as Array<{ name: string; ok: boolean; message: string; confidence?: "high" | "medium" | "low" }>, warnings: [] as string[] };
  if (checks.includes("known_dimensions")) {
    const carport = project.profiles.find((profile): profile is Extract<ProfileInstance, { profile: "carport" }> => profile.profile === "carport");
    if (carport) {
      const expected = [
        ["width", carport.parameters.widthMm],
        ["depth", carport.parameters.depthMm],
        ["westHighSideHeight", carport.parameters.westHighSideHeightMm],
        ["eastLowSideHeight", carport.parameters.eastLowSideHeightMm]
      ] as const;
      for (const [name, value] of expected) {
        result.checks.push({ name: `known_dimensions:${name}`, ok: value > 0, message: `${name}=${value}mm`, confidence: "high" });
      }
      const roofDelta = carport.parameters.westHighSideHeightMm - carport.parameters.eastLowSideHeightMm;
      const impliedSlope = (roofDelta / carport.parameters.depthMm) * 100;
      const okSlope = Math.abs(impliedSlope - carport.parameters.roofSlopePercent) <= 1;
      result.checks.push({ name: "known_dimensions:roof_slope", ok: okSlope, message: `implied=${impliedSlope.toFixed(2)}%, declared=${carport.parameters.roofSlopePercent}%`, confidence: "high" });
      result.ok &&= okSlope;
    } else {
      result.ok = false;
      result.checks.push({ name: "known_dimensions:profile", ok: false, message: "No carport profile present." });
    }
  }
  if (checks.includes("photo_orientation") && project.photos.length > 0) {
    result.warnings.push("Photos are non-calibrated; orientation checks are advisory only.");
  }
  if (checks.includes("reprojection_error")) {
    result.warnings.push("Reprojection validation requires calibrated anchors; current photo-only details remain low confidence.");
  }
  return result;
}

export function textResult(result: BlenderToolResult) {
  const body = JSON.stringify(result, null, 2);
  return { content: [{ type: "text" as const, text: body }], isError: !result.ok };
}
