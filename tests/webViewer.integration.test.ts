import { createHash } from "node:crypto";
import { once } from "node:events";
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { runBlenderJob } from "../src/blenderRunner.js";
import { registerMeasurementTools } from "../src/measurementTools.js";
import { MeasurementProjectSchema } from "../src/measurementContracts.js";
import { buildModelLock, hashValidationSourceProject } from "../src/modelLock.js";
import { verifyAndStorePublicationTrust } from "../src/publicationTrustStore.js";
import { startUiServer } from "../src/uiServer.js";

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

describe("locked web viewer Blender runtime", () => {
  it("packages an exact locked GLB and rejects later model drift", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "nova-web-viewer-"));
    const config = { outputDir, timeoutMs: 120_000 };
    const projectId = "viewer-proof";
    const sourceBlendPath = `measurement-projects/${projectId}/artifacts/${projectId}.blend`;
    const projectDir = path.join(outputDir, "measurement-projects", projectId);
    await mkdir(projectDir, { recursive: true });
    const projectBase = MeasurementProjectSchema.parse({ schemaVersion: 1, projectId, unit: "mm", photos: [{ path: "captures/reference.png", role: "reference", confidence: "high" }], dimensions: [{ label: "panel width", valueMm: 1000, confidence: "high", source: "manual_measurement" }], elements: [{ id: "panel", kind: "panel", boundsMm: { x: 0, y: 0, z: 0, width: 1000, depth: 100, height: 500 }, confidence: "high", source: "dimension", metadata: { captureContractV2: true } }], artifacts: { blend: sourceBlendPath } });
    const project = MeasurementProjectSchema.parse({ ...projectBase, validation: { ok: true, checks: [{ name: "capture-complete", ok: true, message: "validated" }], warnings: [], sourceProjectHash: hashValidationSourceProject(projectBase) } });
    const generated = await runBlenderJob(config, { mode: "measurement_project", operation: "generate_model", project }, sourceBlendPath);
    expect(generated.ok, generated.stderr).toBe(true);
    const modelLock = await buildModelLock(config, project, { lockedAt: "2026-08-15T00:00:00.000Z", lockedBy: "reviewer", reason: "Viewer proof" });
    await writeFile(path.join(projectDir, "project.json"), JSON.stringify({ ...project, modelLock }), "utf8");
    const tools = new Map<string, (input: unknown) => Promise<ToolResult>>();
    const server = { tool(name: string, _description: string, _shape: unknown, handler: (input: unknown) => Promise<ToolResult>) { tools.set(name, handler); } } as unknown as McpServer;
    registerMeasurementTools(server, config);
    const result = await tools.get("generate_web_viewer")!({ projectId, executionIntent: viewerIntent() });
    expect(result.isError, result.content[0].text).toBe(false);
    const body = JSON.parse(result.content[0].text) as { data: { viewer: { directory: string; manifest: { projectId: string; artifacts: { model: { path: string; sha256: string } } } } } };
    expect(body.data.viewer.manifest.projectId).toBe(projectId);
    expect((await readFile(path.join(outputDir, body.data.viewer.directory, body.data.viewer.manifest.artifacts.model.path))).subarray(0, 4).toString("ascii")).toBe("glTF");
    await storeManualTrust(outputDir, projectId);
    const uiConfig = { host: "127.0.0.1" as const, port: 0, outputDir, environmentTruth: { provider: "Hetzner", engine: "Blender 5.2.0", endpoint: "exact-sha-runtime", executionGeography: "remote" as const, owner: "project-ci", costClass: "included-remote" as const, latencyClass: "long-running" as const, fallbackUsed: false, dataScope: ["workspace-state", "customer-viewer"], privacyBoundary: "loopback-only; no telemetry", operatorApprovalRequired: true, auditNotes: ["integration proof"] } };
    const uiServer = startUiServer(uiConfig); if (!uiServer.listening) await once(uiServer, "listening");
    const origin = `http://127.0.0.1:${(uiServer.address() as AddressInfo).port}`;
    try {
      const workspace = await (await fetch(`${origin}/api/workspace?projectId=${projectId}`)).json() as { customerViews: { viewerUrl?: string } };
      expect(workspace.customerViews.viewerUrl).toBe(`/viewer/${projectId}/index.html`);
      const page = await (await fetch(`${origin}/?projectId=${projectId}`)).text(); expect(page).toContain("Open interactive locked-model viewer");
      const viewer = await fetch(`${origin}${workspace.customerViews.viewerUrl}`); expect(viewer.status).toBe(200); expect(viewer.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(await viewer.text()).toContain("network forbidden · telemetry off · fallback none");
      const model = await fetch(`${origin}/viewer/${projectId}/model.glb`); expect(model.status).toBe(200); expect(Buffer.from(await model.arrayBuffer()).subarray(0, 4).toString("ascii")).toBe("glTF");
      expect((await fetch(`${origin}/viewer/${projectId}/../project.json`)).status).not.toBe(200);
      await fetch(`${origin}/api/operator-decision`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ decision: "hold", actor: "operator", projectId }) });
      expect(await (await fetch(`${origin}/viewer/${projectId}/model.glb`)).json()).toEqual({ error: "workspace_delivery_held" });
      await fetch(`${origin}/api/operator-decision`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ decision: "release", actor: "operator", projectId }) });
    } finally { await new Promise<void>((resolve) => uiServer.close(() => resolve())); }
    const viewerModel = path.join(outputDir, body.data.viewer.directory, "model.glb"); const originalModel = await readFile(viewerModel);
    const replacement = path.join(outputDir, body.data.viewer.directory, "replacement.glb"); await copyFile(viewerModel, replacement); await rm(viewerModel); await symlink(replacement, viewerModel);
    const secondUi = startUiServer(uiConfig); if (!secondUi.listening) await once(secondUi, "listening"); const secondOrigin = `http://127.0.0.1:${(secondUi.address() as AddressInfo).port}`;
    try { expect((await fetch(`${secondOrigin}/viewer/${projectId}/model.glb`)).status).toBe(409); }
    finally { await new Promise<void>((resolve) => secondUi.close(() => resolve())); await rm(viewerModel); await writeFile(viewerModel, originalModel); }
    const originalSource = await readFile(path.join(outputDir, sourceBlendPath)); await writeFile(path.join(outputDir, sourceBlendPath), "tampered");
    const drift = await tools.get("generate_web_viewer")!({ projectId, outputDir: `measurement-projects/${projectId}/artifacts/second-viewer`, executionIntent: viewerIntent() });
    expect(drift.isError).toBe(true);
    const driftBody = JSON.parse(drift.content[0].text) as { error: { code: string } };
    expect(driftBody.error.code).toBe("model_lock_invalid");
    await writeFile(path.join(outputDir, sourceBlendPath), originalSource);
  }, 120_000);
});

function viewerIntent() {
  return { intentId: "web-viewer-proof", operation: "generate-web-viewer", objective: "Generate reviewed offline showroom viewer", writeScope: ["project-state", "blender-output", "manifest"], forbiddenScope: ["source-measurements", "locked-geometry"], selectedToolPath: "mcp:nova-measured", acceptanceChecks: ["schema", "quality-gate", "manifest"], executionPolicy: { locality: "local-only", telemetry: false, fallback: "none", geometryMutation: false } };
}

async function storeManualTrust(outputDir: string, projectId: string): Promise<void> {
  const packageDir = path.join(outputDir, "captures", `${projectId}-manual`); await mkdir(packageDir, { recursive: true });
  const evidence = Buffer.from("manual capture reference"); await writeFile(path.join(packageDir, "evidence.json"), evidence);
  const binding = { schemaVersion: 1, packageId: `${projectId}-manual`, projectId, objectId: "object-1", captureProtocolId: "protocol-1", kitId: "kit-1", commissioningPartyId: "party-1", capturedAt: "2026-08-16T00:00:00.000Z", evidenceScopes: [{ id: "dimensions", kind: "measurement", required: true, verified: true }], manifest: [{ path: "evidence.json", sha256: createHash("sha256").update(evidence).digest("hex"), sizeBytes: evidence.byteLength }] };
  await writeFile(path.join(packageDir, "capture-package.json"), JSON.stringify({ source: "manual_upload", binding }));
  await verifyAndStorePublicationTrust({ outputDir, timeoutMs: 1 }, { projectId, executionIntent: { ...viewerIntent(), operation: "verify-publication-capture" }, packageManifestPath: `captures/${projectId}-manual/capture-package.json` });
}
