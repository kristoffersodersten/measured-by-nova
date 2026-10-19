import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CarportDemoManifestSchema, identifyDemoArtifact, serializeCarportDemoManifest } from "../src/demoManifest.js";
import { registerMeasurementTools } from "../src/measurementTools.js";
import { RealCarportCaptureSchema } from "../src/captureToFixture.js";

const execFile = promisify(execFileCallback);
const LegalBaseSha = "58e6cc3a349c25af17763ab76f4a1a0c889e3e9f";
const UnauthorizedSignerRootSha = "79067d23e11f7ff979bd7b2c0409b3f72c00dd1c";
const FixturePath = "fixtures/real-capture-carport-minimal.json";
const DefaultOutputDir = "output/carport-premium-demo";
const CheckpointFilename = "carport-review-checkpoint.json";
const RequiredTools = [
  "create_project_from_capture",
  "generate_measured_model",
  "validate_model",
  "generate_elevation_views",
  "lock_model_for_export",
  "export_model",
  "generate_web_viewer",
  "export_dimensioned_drawings"
] as const;

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };
type ToolHandler = (input: unknown) => Promise<ToolResult>;
type ToolBody<T> = { ok: boolean; data?: T; error?: { code: string; message: string; details?: { blocking?: Array<{ id?: string; code: string; message: string }> } }; warnings: string[] };

export type DemoArguments =
  | { outputDir: string; blenderPath?: string; reset: boolean; phase: "prepare"; reviewConfirmed: false }
  | { outputDir: string; blenderPath?: string; reset: false; phase: "deliver"; reviewedBy: string; reviewConfirmed: true };

const ReviewCheckpointSchema = z.object({
  schemaVersion: z.literal(1),
  sourceSha: z.string().regex(/^[a-f0-9]{40}$/),
  fixtureSha256: z.string().regex(/^[a-f0-9]{64}$/),
  captureId: z.string().min(1),
  projectId: z.string().min(1),
  reviewArtifact: z.object({ path: z.string().min(1), sizeBytes: z.number().int().positive(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  failClosedProof: z.object({ observedErrorCode: z.literal("capture_contract_failed"), blockerId: z.literal("width"), recoverySucceeded: z.literal(true) }).strict(),
  timingsMs: z.record(z.number().int().nonnegative())
}).strict();

export function parseDemoArguments(argv: string[]): DemoArguments {
  let outputDir = DefaultOutputDir;
  let blenderPath: string | undefined;
  let reset = false;
  let phase: "prepare" | "deliver" | undefined;
  let reviewedBy = "";
  let reviewConfirmed = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue;
    if (argument === "--reset") reset = true;
    else if (argument === "--prepare") phase = phase ? duplicatePhase() : "prepare";
    else if (argument === "--deliver") phase = phase ? duplicatePhase() : "deliver";
    else if (argument === "--output-dir") outputDir = requireArgumentValue(argv, ++index, argument);
    else if (argument === "--blender") blenderPath = requireArgumentValue(argv, ++index, argument);
    else if (argument === "--reviewed-by") reviewedBy = requireArgumentValue(argv, ++index, argument);
    else if (argument === "--confirm-reviewed-generated-blend") reviewConfirmed = true;
    else throw new Error(`unknown_argument:${argument}`);
  }
  if (!phase) throw new Error("demo_phase_required");
  if (phase === "prepare" && (reviewedBy || reviewConfirmed)) throw new Error("review_attestation_not_allowed_during_prepare");
  if (phase === "deliver" && !reviewedBy) throw new Error("reviewer_required");
  if (phase === "deliver" && !reviewConfirmed) throw new Error("human_review_confirmation_required");
  if (phase === "deliver" && reset) throw new Error("deliver_reset_forbidden");
  const common = { outputDir: path.resolve(outputDir), ...(blenderPath ? { blenderPath: path.resolve(blenderPath) } : {}) };
  return phase === "prepare"
    ? { ...common, reset, phase, reviewConfirmed: false }
    : { ...common, reset: false, phase, reviewedBy, reviewConfirmed: true };
}

export function buildMissingWidthCapture(input: unknown): unknown {
  const capture = RealCarportCaptureSchema.parse(input);
  return { ...capture, dimensions: { ...capture.dimensions, width: { ...capture.dimensions.width, verified: false } } };
}

async function main(): Promise<void> {
  const startedAt = performance.now();
  const args = parseDemoArguments(process.argv.slice(2));
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const sourceSha = await git(repoRoot, ["rev-parse", "HEAD"]);
  await verifyLegalCommitBoundary(repoRoot);
  const captureBytes = await readFile(path.join(repoRoot, FixturePath));
  const capture = RealCarportCaptureSchema.parse(JSON.parse(captureBytes.toString("utf8")));
  const runtime = await runtimeIdentity(repoRoot, args.blenderPath);
  const tools = toolHarness({ outputDir: args.outputDir, timeoutMs: 300_000, ...(args.blenderPath ? { blenderPath: args.blenderPath } : {}) });
  for (const tool of RequiredTools) if (!tools.has(tool)) throw new Error(`required_demo_tool_missing:${tool}`);
  if (tools.has("sign_publication_capture_package")) throw new Error("unauthorized_signer_tool_exposed");

  if (args.phase === "prepare") {
    await prepareReview(args, sourceSha, captureBytes, capture, tools);
    return;
  }
  await deliverReviewedModel(args, startedAt, sourceSha, captureBytes, capture, runtime, tools);
}

async function prepareReview(args: Extract<DemoArguments, { phase: "prepare" }>, sourceSha: string, captureBytes: Buffer, capture: ReturnType<typeof RealCarportCaptureSchema.parse>, tools: Map<string, ToolHandler>): Promise<void> {
  if (args.reset) await rm(args.outputDir, { recursive: true, force: true });
  await mkdir(path.dirname(args.outputDir), { recursive: true });
  await mkdir(args.outputDir, { recursive: false });
  const timingsMs: Record<string, number> = {};

  const negative = await timed(timingsMs, "failClosedCapture", () => invoke(tools, "create_project_from_capture", buildMissingWidthCapture(capture), true));
  if (negative.error?.code !== "capture_contract_failed") throw new Error(`fail_closed_error_mismatch:${negative.error?.code ?? "missing"}`);
  const blockers = negative.error.details?.blocking ?? [];
  if (!blockers.some((blocker) => blocker.id === "width" && blocker.code === "geometry_not_verified")) throw new Error("fail_closed_width_blocker_missing");

  await timed(timingsMs, "captureRecovery", () => invoke(tools, "create_project_from_capture", capture));
  await timed(timingsMs, "generateModel", () => invoke(tools, "generate_measured_model", { projectId: capture.projectId }));
  await timed(timingsMs, "validateModel", () => invoke(tools, "validate_model", { projectId: capture.projectId, checks: ["known_dimensions", "photo_orientation"] }));
  await timed(timingsMs, "generateViews", () => invoke(tools, "generate_elevation_views", { projectId: capture.projectId, views: ["plan", "north", "south", "east", "west", "section_a_a"] }));
  const reviewArtifact = await identifyDemoArtifact(args.outputDir, "reviewed-blender-model", `measurement-projects/${capture.projectId}/artifacts/${capture.projectId}.blend`);
  const checkpoint = ReviewCheckpointSchema.parse({
    schemaVersion: 1,
    sourceSha,
    fixtureSha256: createHash("sha256").update(captureBytes).digest("hex"),
    captureId: capture.captureId,
    projectId: capture.projectId,
    reviewArtifact: { path: reviewArtifact.path, sizeBytes: reviewArtifact.sizeBytes, sha256: reviewArtifact.sha256 },
    failClosedProof: { observedErrorCode: "capture_contract_failed", blockerId: "width", recoverySucceeded: true },
    timingsMs
  });
  const checkpointPath = path.join(args.outputDir, CheckpointFilename);
  await writeFile(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ ok: true, phase: "prepare", outputDir: args.outputDir, checkpointPath, reviewArtifact }, null, 2)}\n`);
}

async function deliverReviewedModel(
  args: Extract<DemoArguments, { phase: "deliver" }>,
  startedAt: number,
  sourceSha: string,
  captureBytes: Buffer,
  capture: ReturnType<typeof RealCarportCaptureSchema.parse>,
  runtime: Awaited<ReturnType<typeof runtimeIdentity>>,
  tools: Map<string, ToolHandler>
): Promise<void> {
  const checkpointPath = path.join(args.outputDir, CheckpointFilename);
  const checkpoint = ReviewCheckpointSchema.parse(JSON.parse(await readFile(checkpointPath, "utf8")));
  const fixtureSha256 = createHash("sha256").update(captureBytes).digest("hex");
  if (checkpoint.schemaVersion !== 1 || checkpoint.sourceSha !== sourceSha || checkpoint.fixtureSha256 !== fixtureSha256 || checkpoint.captureId !== capture.captureId || checkpoint.projectId !== capture.projectId) throw new Error("review_checkpoint_identity_mismatch");
  const currentReviewArtifact = await identifyDemoArtifact(args.outputDir, "reviewed-blender-model", checkpoint.reviewArtifact.path);
  if (currentReviewArtifact.sizeBytes !== checkpoint.reviewArtifact.sizeBytes || currentReviewArtifact.sha256 !== checkpoint.reviewArtifact.sha256) throw new Error("review_artifact_changed_after_prepare");
  const timingsMs = { ...checkpoint.timingsMs };

  const locked = await timed(timingsMs, "modelLock", () => invoke<{
    modelLock: { modelArtifact: string; modelHash: string; sourceProjectHash: string };
  }>(tools, "lock_model_for_export", {
    projectId: capture.projectId,
    executionIntent: intent("lock-model", ["project-state", "manifest"]),
    lockedBy: args.reviewedBy,
    reason: "Human-reviewed SOD-1687 carport demo model"
  }));
  if (!locked.data?.modelLock.modelArtifact) throw new Error("model_lock_missing");

  const exported = await timed(timingsMs, "portableExport", () => invoke<{
    portableExportManifest: string;
    artifacts: Array<{ format: string; path: string }>;
  }>(tools, "export_model", {
    projectId: capture.projectId,
    formats: ["blend", "glb"],
    executionIntent: intent("export-model", ["blender-output", "manifest"])
  }));
  const viewer = await timed(timingsMs, "offlineViewer", () => invoke<{
    viewer: { directory: string; manifestPath: string };
  }>(tools, "generate_web_viewer", {
    projectId: capture.projectId,
    executionIntent: intent("generate-web-viewer", ["project-state", "blender-output", "manifest"])
  }));
  const drawingPath = `measurement-projects/${capture.projectId}/exports/${capture.projectId}-facades.pdf`;
  await timed(timingsMs, "dimensionedPdf", () => invoke(tools, "export_dimensioned_drawings", {
    projectId: capture.projectId,
    outputPath: drawingPath,
    scale: "1:100",
    includeConfidenceLegend: true,
    executionIntent: intent("export-drawings", ["blender-output", "manifest"])
  }));

  const artifactInputs = [
    { role: "reviewed-blender-model", path: locked.data.modelLock.modelArtifact },
    ...(exported.data?.artifacts ?? []).map((artifact) => ({ role: `portable-${artifact.format}`, path: artifact.path })),
    { role: "portable-export-manifest", path: exported.data?.portableExportManifest ?? "" },
    { role: "offline-viewer-manifest", path: viewer.data?.viewer.manifestPath ?? "" },
    { role: "offline-viewer-html", path: `${viewer.data?.viewer.directory ?? ""}/index.html` },
    { role: "offline-viewer-glb", path: `${viewer.data?.viewer.directory ?? ""}/model.glb` },
    { role: "dimensioned-facade-pdf", path: drawingPath },
    { role: "measurement-project", path: `measurement-projects/${capture.projectId}/project.json` }
  ];
  if (artifactInputs.some((artifact) => artifact.path.length === 0)) throw new Error("demo_artifact_path_missing");
  const artifacts = await Promise.all(artifactInputs.map((artifact) => identifyDemoArtifact(args.outputDir, artifact.role, artifact.path)));
  timingsMs.total = Math.round(performance.now() - startedAt);
  const manifest = CarportDemoManifestSchema.parse({
    schemaVersion: 1,
    manifestType: "measured-carport-premium-demo",
    createdAt: new Date().toISOString(),
    source: { sourceSha, legalBaseSha: LegalBaseSha, legalBaseIncluded: true, unauthorizedSignerCommitIncluded: false, unauthorizedSignerToolExposed: false },
    fixture: { path: FixturePath, sha256: fixtureSha256, captureId: capture.captureId, projectId: capture.projectId },
    failClosedProof: { attemptedField: "dimensions.width", expectedErrorCode: "capture_contract_failed", observedErrorCode: "capture_contract_failed", blockerId: "width", recoverySucceeded: true },
    humanReview: { reviewer: args.reviewedBy, confirmation: "reviewed-generated-blend-before-lock" },
    modelLock: { artifact: locked.data.modelLock.modelArtifact, modelHash: locked.data.modelLock.modelHash, sourceProjectHash: locked.data.modelLock.sourceProjectHash },
    runtime,
    execution: { locality: "local-only", telemetry: false, fallback: "none", geometryMutation: false },
    timingsMs,
    artifacts
  });
  const manifestPath = path.join(args.outputDir, "carport-demo-manifest.json");
  await writeFile(manifestPath, serializeCarportDemoManifest(manifest), { encoding: "utf8", flag: "wx", mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ ok: true, phase: "deliver", outputDir: args.outputDir, manifestPath, sourceSha, modelHash: manifest.modelLock.modelHash, timingsMs }, null, 2)}\n`);
}

function toolHarness(config: { outputDir: string; timeoutMs: number; blenderPath?: string }): Map<string, ToolHandler> {
  const tools = new Map<string, ToolHandler>();
  const server = { tool(name: string, _description: string, _shape: unknown, handler: ToolHandler) { tools.set(name, handler); } } as unknown as McpServer;
  registerMeasurementTools(server, config);
  return tools;
}

async function invoke<T>(tools: Map<string, ToolHandler>, name: string, input: unknown, expectError = false): Promise<ToolBody<T>> {
  const handler = tools.get(name);
  if (!handler) throw new Error(`demo_tool_missing:${name}`);
  const result = await handler(input);
  const body = JSON.parse(result.content[0]?.text ?? "{}") as ToolBody<T>;
  if (expectError ? !result.isError || body.ok : result.isError || !body.ok) throw new Error(`demo_tool_${expectError ? "unexpected_success" : "failed"}:${name}:${body.error?.code ?? "unknown"}:${body.error?.message ?? ""}`);
  return body;
}

function intent(operation: "lock-model" | "export-model" | "generate-web-viewer" | "export-drawings", writeScope: Array<"project-state" | "blender-output" | "manifest">) {
  return {
    intentId: `sod-1687-${operation}`,
    operation,
    objective: `Execute the reviewed SOD-1687 carport demo ${operation} step`,
    writeScope,
    forbiddenScope: ["source-measurements", "locked-geometry"],
    selectedToolPath: "mcp:nova-measured",
    acceptanceChecks: ["schema", "quality-gate", "manifest"],
    executionPolicy: { locality: "local-only", telemetry: false, fallback: "none", geometryMutation: false }
  };
}

async function verifyLegalCommitBoundary(repoRoot: string): Promise<void> {
  await git(repoRoot, ["cat-file", "-e", `${LegalBaseSha}^{commit}`]);
  await git(repoRoot, ["cat-file", "-e", `${UnauthorizedSignerRootSha}^{commit}`]);
  await git(repoRoot, ["merge-base", "--is-ancestor", LegalBaseSha, "HEAD"]);
  try {
    await git(repoRoot, ["merge-base", "--is-ancestor", UnauthorizedSignerRootSha, "HEAD"]);
    throw new Error("unauthorized_signer_commit_included");
  } catch (error) {
    if (error instanceof Error && error.message === "unauthorized_signer_commit_included") throw error;
  }
}

async function runtimeIdentity(repoRoot: string, blenderPath?: string) {
  const pnpm = await commandVersion(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["--version"]);
  const blender = await commandVersion(blenderPath ?? "blender", ["--version"]);
  const status = await git(repoRoot, ["status", "--porcelain=v1", "--untracked-files=all"]);
  const unexpected = status.split(/\r?\n/).filter(Boolean).filter((line) => !line.slice(3).replaceAll("\\", "/").startsWith("artifacts/"));
  if (unexpected.length > 0) throw new Error(`tracked_worktree_not_clean:${unexpected.join(",")}`);
  return { node: process.version, pnpm, blender: blender.split(/\r?\n/, 1)[0] ?? blender, platform: process.platform, arch: process.arch };
}

async function commandVersion(command: string, args: string[]): Promise<string> {
  try { return (await execFile(command, args, { windowsHide: true })).stdout.trim(); }
  catch (error) { throw new Error(`runtime_unavailable:${command}:${error instanceof Error ? error.message : String(error)}`); }
}

async function git(repoRoot: string, args: string[]): Promise<string> {
  try { return (await execFile("git", ["-C", repoRoot, ...args], { windowsHide: true })).stdout.trim(); }
  catch (error) { throw new Error(`git_preflight_failed:${args.join(" ")}:${error instanceof Error ? error.message : String(error)}`); }
}

async function timed<T>(timings: Record<string, number>, name: string, action: () => Promise<T>): Promise<T> {
  const started = performance.now();
  try { return await action(); }
  finally { timings[name] = Math.round(performance.now() - started); }
}

function requireArgumentValue(argv: string[], index: number, argument: string): string {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`argument_value_missing:${argument}`);
  return value;
}

function duplicatePhase(): never { throw new Error("demo_phase_conflict"); }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`);
    process.exitCode = 1;
  });
}