import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { runBlenderJob } from "../src/blenderRunner.js";
import { registerMeasurementTools } from "../src/measurementTools.js";
import { MeasurementProjectSchema } from "../src/measurementContracts.js";
import { buildModelLock } from "../src/modelLock.js";

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

describe("locked web viewer Blender runtime", () => {
  it("packages an exact locked GLB and rejects later model drift", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "nova-web-viewer-"));
    const config = { outputDir, timeoutMs: 120_000 };
    const projectId = "viewer-proof";
    const sourceBlendPath = `measurement-projects/${projectId}/artifacts/${projectId}.blend`;
    const projectDir = path.join(outputDir, "measurement-projects", projectId);
    await mkdir(projectDir, { recursive: true });
    const project = MeasurementProjectSchema.parse({ schemaVersion: 1, projectId, unit: "mm", elements: [{ id: "panel", kind: "panel", boundsMm: { x: 0, y: 0, z: 0, width: 1000, depth: 100, height: 500 }, confidence: "high", source: "dimension", metadata: { captureContractV2: true } }], artifacts: { blend: sourceBlendPath } });
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
    await writeFile(path.join(outputDir, sourceBlendPath), "tampered");
    const drift = await tools.get("generate_web_viewer")!({ projectId, outputDir: `measurement-projects/${projectId}/artifacts/second-viewer`, executionIntent: viewerIntent() });
    expect(drift.isError).toBe(true);
    const driftBody = JSON.parse(drift.content[0].text) as { error: { code: string } };
    expect(driftBody.error.code).toBe("model_lock_invalid");
  }, 120_000);
});

function viewerIntent() {
  return { intentId: "web-viewer-proof", operation: "generate-web-viewer", objective: "Generate reviewed offline showroom viewer", writeScope: ["project-state", "blender-output", "manifest"], forbiddenScope: ["source-measurements", "locked-geometry"], selectedToolPath: "mcp:nova-measured", acceptanceChecks: ["schema", "quality-gate", "manifest"], executionPolicy: { locality: "local-only", telemetry: false, fallback: "none", geometryMutation: false } };
}
