import { createHash } from "node:crypto";
import { once } from "node:events";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { runBlenderJob } from "../src/blenderRunner.js";
import { registerMeasurementTools } from "../src/measurementTools.js";
import { MeasurementProjectSchema } from "../src/measurementContracts.js";
import { buildModelLock, hashValidationSourceProject } from "../src/modelLock.js";
import { readLivePortableExportEvidence } from "../src/portableExportEvidence.js";
import { verifyAndStorePublicationTrust } from "../src/publicationTrustStore.js";
import { startUiServer } from "../src/uiServer.js";
import { readUiDeliveryArtifact } from "../src/uiProjectState.js";

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

describe("locked portable export Blender runtime", () => {
  it("exports validated GLB, OBJ and USDZ from the exact model lock and rejects later drift", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "nova-portable-export-"));
    const config = { outputDir, timeoutMs: 120_000 };
    const projectId = "portable-proof";
    const sourceBlendPath = `measurement-projects/${projectId}/artifacts/${projectId}.blend`;
    const projectDir = path.join(outputDir, "measurement-projects", projectId);
    await mkdir(projectDir, { recursive: true });
    const projectBase = MeasurementProjectSchema.parse({
      schemaVersion: 1,
      projectId,
      unit: "mm",
      photos: [{ path: "captures/reference.jpg", role: "reference", confidence: "high" }],
      dimensions: [{ label: "panel width", valueMm: 1000, confidence: "high", source: "manual_measurement" }],
      elements: [{ id: "measured-panel", kind: "panel", boundsMm: { x: 0, y: 0, z: 0, width: 1000, depth: 100, height: 500 }, confidence: "high", source: "dimension", metadata: { captureContractV2: true } }],
      artifacts: { blend: sourceBlendPath }
    });
    const project = MeasurementProjectSchema.parse({ ...projectBase, validation: { ok: true, checks: [{ name: "capture-complete", ok: true, message: "validated" }], warnings: [], sourceProjectHash: hashValidationSourceProject(projectBase) } });
    const generated = await runBlenderJob(config, { mode: "measurement_project", operation: "generate_model", project }, sourceBlendPath);
    expect(generated.ok, generated.stderr).toBe(true);
    const modelLock = await buildModelLock(config, project, { lockedAt: "2026-08-15T00:00:00.000Z", lockedBy: "reviewer", reason: "Runtime proof" });
    await writeFile(path.join(projectDir, "project.json"), JSON.stringify({ ...project, modelLock }), "utf8");

    const tools = new Map<string, (input: unknown) => Promise<ToolResult>>();
    const server = { tool(name: string, _description: string, _shape: unknown, handler: (input: unknown) => Promise<ToolResult>) { tools.set(name, handler); } } as unknown as McpServer;
    registerMeasurementTools(server, config);
    const result = await tools.get("export_model")!({ projectId, formats: ["glb", "obj", "usdz"], executionIntent: exportIntent() });
    const body = JSON.parse(result.content[0].text) as { data: { sourceBlendPath: string; portableExportManifest: string; artifacts: Array<{ format: string; path: string; sizeBytes: number; sha256: string }> } };
    expect(result.isError, result.content[0].text).toBe(false);
    expect(body.data.sourceBlendPath).toBe(sourceBlendPath);
    expect(body.data.artifacts.map((artifact) => artifact.format)).toEqual(["blend", "glb", "obj", "usdz", "mtl"]);
    expect(body.data.artifacts.every((artifact) => artifact.sizeBytes > 0 && artifact.sha256.length === 64)).toBe(true);
    expect(await readFile(path.join(outputDir, body.data.artifacts.find((artifact) => artifact.format === "blend")!.path))).toEqual(await readFile(path.join(outputDir, sourceBlendPath)));
    expect((await readFile(path.join(outputDir, body.data.artifacts.find((artifact) => artifact.format === "glb")!.path))).subarray(0, 4).toString("ascii")).toBe("glTF");
    const usdz = await readFile(path.join(outputDir, body.data.artifacts.find((artifact) => artifact.format === "usdz")!.path));
    expect(usdz.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    expect(usdz.includes(Buffer.from("PXR-USDC")) || usdz.includes(Buffer.from("#usda"))).toBe(true);
    const persisted = MeasurementProjectSchema.parse(JSON.parse(await readFile(path.join(projectDir, "project.json"), "utf8")) as unknown);
    expect(persisted.artifacts.portableExportManifest).toBe(body.data.portableExportManifest);
    expect(await readLivePortableExportEvidence(config, persisted)).toMatchObject({ status: "ready", evidence: { projectId, modelHash: modelLock.modelHash } });
    await storeManualTrust(outputDir, projectId);
    const uiConfig = { host: "127.0.0.1" as const, port: 0, outputDir, environmentTruth: { provider: "Hetzner", engine: "Blender 5.2.0", endpoint: "exact-sha-runtime", executionGeography: "remote" as const, owner: "project-ci", costClass: "included-remote" as const, latencyClass: "long-running" as const, fallbackUsed: false, dataScope: ["workspace-state", "verified-delivery"], privacyBoundary: "loopback-only; no telemetry", operatorApprovalRequired: true, auditNotes: ["integration proof"] } };
    const uiServer = startUiServer(uiConfig); if (!uiServer.listening) await once(uiServer, "listening");
    const origin = `http://127.0.0.1:${(uiServer.address() as AddressInfo).port}`;
    try {
      const workspace = await (await fetch(`${origin}/api/workspace?projectId=${projectId}`)).json() as { deliveryArtifacts: Array<{ format: string; url: string }> };
      expect(workspace.deliveryArtifacts.map((artifact) => artifact.format)).toEqual(["blend", "glb", "obj", "usdz", "mtl"]);
      const page = await (await fetch(`${origin}/?projectId=${projectId}`)).text();
      expect(page).toContain("Verified technical output · 5 artifacts"); expect(page).toContain("/api/delivery-artifact?projectId=portable-proof&amp;format=usdz");
      const glbResponse = await fetch(`${origin}/api/delivery-artifact?projectId=${projectId}&format=glb`);
      expect(glbResponse.status).toBe(200); expect(glbResponse.headers.get("content-type")).toBe("model/gltf-binary");
      expect(glbResponse.headers.get("content-disposition")).toBe(`attachment; filename="${projectId}.glb"`);
      expect(Buffer.from(await glbResponse.arrayBuffer())).toEqual(await readFile(path.join(outputDir, body.data.artifacts.find((artifact) => artifact.format === "glb")!.path)));
      expect((await fetch(`${origin}/api/delivery-artifact?projectId=${projectId}&format=pdf`)).status).toBe(409);
      await fetch(`${origin}/api/operator-decision`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ decision: "hold", actor: "operator", projectId }) });
      expect(await (await fetch(`${origin}/api/delivery-artifact?projectId=${projectId}&format=glb`)).json()).toEqual({ error: "workspace_delivery_held" });
      expect(await (await fetch(`${origin}/?projectId=${projectId}`)).text()).not.toContain("/api/delivery-artifact?");
      await fetch(`${origin}/api/operator-decision`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ decision: "release", actor: "operator", projectId }) });
      expect((await fetch(`${origin}/api/delivery-artifact?projectId=${projectId}&format=glb`)).status).toBe(200);
    } finally { await new Promise<void>((resolve) => uiServer.close(() => resolve())); }
    const manifestPath = path.join(outputDir, body.data.portableExportManifest);
    const originalManifest = await readFile(manifestPath);
    const exportedBlendPath = path.join(outputDir, body.data.artifacts.find((artifact) => artifact.format === "blend")!.path);
    const originalExportedBlend = await readFile(exportedBlendPath);
    const forgedBlend = Buffer.from("forged-but-self-consistent-export");
    const forgedManifest = JSON.parse(originalManifest.toString("utf8")) as { artifacts: Array<{ format: string; sizeBytes: number; sha256: string }> };
    const forgedBlendEntry = forgedManifest.artifacts.find((artifact) => artifact.format === "blend")!;
    forgedBlendEntry.sizeBytes = forgedBlend.byteLength; forgedBlendEntry.sha256 = createHash("sha256").update(forgedBlend).digest("hex");
    await writeFile(exportedBlendPath, forgedBlend); await writeFile(manifestPath, JSON.stringify(forgedManifest));
    expect(await readLivePortableExportEvidence(config, persisted)).toEqual({ status: "blocked", code: "portable_export_blend_model_lock_mismatch" });
    await expect(readUiDeliveryArtifact(uiConfig, projectId, "blend")).rejects.toThrow("workspace_delivery_not_ready_portable_export_blend_model_lock_mismatch");
    await writeFile(exportedBlendPath, originalExportedBlend); await writeFile(manifestPath, originalManifest);
    const glbPath = path.join(outputDir, body.data.artifacts.find((artifact) => artifact.format === "glb")!.path);
    const replacement = path.join(projectDir, "artifacts", "replacement.glb");
    await copyFile(glbPath, replacement); await rm(glbPath); await symlink(replacement, glbPath);
    expect(await readLivePortableExportEvidence(config, persisted)).toEqual({ status: "blocked", code: "portable_export_artifact_path_invalid" });
    await expect(readUiDeliveryArtifact(uiConfig, projectId, "glb")).rejects.toThrow("workspace_delivery_not_ready_portable_export_artifact_path_invalid");

    await writeFile(path.join(outputDir, sourceBlendPath), "tampered");
    const drifted = await tools.get("export_model")!({ projectId, formats: ["glb"], executionIntent: exportIntent() });
    const driftBody = JSON.parse(drifted.content[0].text) as { error: { code: string } };
    expect(drifted.isError).toBe(true);
    expect(driftBody.error.code).toBe("model_lock_invalid");
    expect((await stat(path.join(outputDir, body.data.artifacts[0].path))).isFile()).toBe(true);
  }, 120_000);

  it("rejects an empty USDZ stage and removes every partial export artifact", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "nova-usdz-empty-"));
    const config = { outputDir, timeoutMs: 120_000 };
    const projectId = "empty-usdz-proof";
    const sourceBlendPath = `measurement-projects/${projectId}/artifacts/${projectId}.blend`;
    const projectDir = path.join(outputDir, "measurement-projects", projectId);
    await mkdir(projectDir, { recursive: true });
    const project = MeasurementProjectSchema.parse({ schemaVersion: 1, projectId, unit: "mm", artifacts: { blend: sourceBlendPath } });
    const generated = await runBlenderJob(config, { mode: "measurement_project", operation: "generate_model", project }, sourceBlendPath);
    expect(generated.ok, generated.stderr).toBe(true);
    const modelLock = await buildModelLock(config, project, { lockedAt: "2026-08-15T00:00:00.000Z", lockedBy: "reviewer", reason: "Negative runtime proof" });
    await writeFile(path.join(projectDir, "project.json"), JSON.stringify({ ...project, modelLock }), "utf8");
    const tools = new Map<string, (input: unknown) => Promise<ToolResult>>();
    const server = { tool(name: string, _description: string, _shape: unknown, handler: (input: unknown) => Promise<ToolResult>) { tools.set(name, handler); } } as unknown as McpServer;
    registerMeasurementTools(server, config);
    const result = await tools.get("export_model")!({ projectId, formats: ["usdz"], executionIntent: exportIntent() });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toMatchObject({ error: { code: "portable_export_failed" } });
    await expect(stat(path.join(projectDir, "artifacts", `${projectId}.usdz`))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(path.join(projectDir, "artifacts", `${projectId}-export.blend`))).rejects.toMatchObject({ code: "ENOENT" });
  }, 120_000);
});

function exportIntent() {
  return {
    intentId: "portable-export-proof",
    operation: "export-model",
    objective: "Export reviewed locked geometry",
    writeScope: ["project-state", "blender-output", "manifest"],
    forbiddenScope: ["source-measurements", "locked-geometry"],
    selectedToolPath: "mcp:nova-measured",
    acceptanceChecks: ["schema", "quality-gate", "manifest"],
    executionPolicy: { locality: "local-only", telemetry: false, fallback: "none", geometryMutation: false }
  };
}

async function storeManualTrust(outputDir: string, projectId: string): Promise<void> {
  const packageDir = path.join(outputDir, "captures", `${projectId}-manual`); await mkdir(packageDir, { recursive: true });
  const evidence = Buffer.from("manual capture reference"); await writeFile(path.join(packageDir, "evidence.json"), evidence);
  const binding = { schemaVersion: 1, packageId: `${projectId}-manual`, projectId, objectId: "object-1", captureProtocolId: "protocol-1", kitId: "kit-1", commissioningPartyId: "party-1", capturedAt: "2026-08-16T00:00:00.000Z", evidenceScopes: [{ id: "dimensions", kind: "measurement", required: true, verified: true }], manifest: [{ path: "evidence.json", sha256: createHash("sha256").update(evidence).digest("hex"), sizeBytes: evidence.byteLength }] };
  await writeFile(path.join(packageDir, "capture-package.json"), JSON.stringify({ source: "manual_upload", binding }));
  await verifyAndStorePublicationTrust({ outputDir, timeoutMs: 1 }, { projectId, executionIntent: { ...exportIntent(), operation: "verify-publication-capture" }, packageManifestPath: `captures/${projectId}-manual/capture-package.json` });
}
