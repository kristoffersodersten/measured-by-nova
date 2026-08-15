import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { runBlenderJob } from "../src/blenderRunner.js";
import { registerMeasurementTools } from "../src/measurementTools.js";
import { MeasurementProjectSchema } from "../src/measurementContracts.js";
import { buildModelLock } from "../src/modelLock.js";

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

describe("locked portable export Blender runtime", () => {
  it("exports validated GLB and OBJ from the exact model lock and rejects later drift", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "nova-portable-export-"));
    const config = { outputDir, timeoutMs: 120_000 };
    const projectId = "portable-proof";
    const sourceBlendPath = `measurement-projects/${projectId}/artifacts/${projectId}.blend`;
    const projectDir = path.join(outputDir, "measurement-projects", projectId);
    await mkdir(projectDir, { recursive: true });
    const project = MeasurementProjectSchema.parse({
      schemaVersion: 1,
      projectId,
      unit: "mm",
      elements: [{ id: "measured-panel", kind: "panel", boundsMm: { x: 0, y: 0, z: 0, width: 1000, depth: 100, height: 500 }, confidence: "high", source: "measurement" }],
      artifacts: { blend: sourceBlendPath }
    });
    const generated = await runBlenderJob(config, { mode: "measurement_project", operation: "generate_model", project }, sourceBlendPath);
    expect(generated.ok, generated.stderr).toBe(true);
    const modelLock = await buildModelLock(config, project, { lockedAt: "2026-08-15T00:00:00.000Z", lockedBy: "reviewer", reason: "Runtime proof" });
    await writeFile(path.join(projectDir, "project.json"), JSON.stringify({ ...project, modelLock }), "utf8");

    const tools = new Map<string, (input: unknown) => Promise<ToolResult>>();
    const server = { tool(name: string, _description: string, _shape: unknown, handler: (input: unknown) => Promise<ToolResult>) { tools.set(name, handler); } } as unknown as McpServer;
    registerMeasurementTools(server, config);
    const result = await tools.get("export_model")!({ projectId, formats: ["glb", "obj"], executionIntent: exportIntent() });
    const body = JSON.parse(result.content[0].text) as { data: { sourceBlendPath: string; artifacts: Array<{ format: string; path: string; sizeBytes: number; sha256: string }> } };
    expect(result.isError).toBe(false);
    expect(body.data.sourceBlendPath).toBe(sourceBlendPath);
    expect(body.data.artifacts.map((artifact) => artifact.format)).toEqual(["blend", "glb", "obj"]);
    expect(body.data.artifacts.every((artifact) => artifact.sizeBytes > 0 && artifact.sha256.length === 64)).toBe(true);
    expect((await readFile(path.join(outputDir, body.data.artifacts.find((artifact) => artifact.format === "glb")!.path))).subarray(0, 4).toString("ascii")).toBe("glTF");

    await writeFile(path.join(outputDir, sourceBlendPath), "tampered");
    const drifted = await tools.get("export_model")!({ projectId, formats: ["glb"], executionIntent: exportIntent() });
    const driftBody = JSON.parse(drifted.content[0].text) as { error: { code: string } };
    expect(drifted.isError).toBe(true);
    expect(driftBody.error.code).toBe("model_lock_invalid");
    expect((await stat(path.join(outputDir, body.data.artifacts[0].path))).isFile()).toBe(true);
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
