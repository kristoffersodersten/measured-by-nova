import { createHash } from "node:crypto";
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

describe("locked drawing and template delivery runtime", () => {
  it("delivers only from an immutable verified model snapshot and rejects later drift", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "nova-locked-delivery-"));
    const config = { outputDir, timeoutMs: 120_000 };
    const projectId = "locked-delivery";
    const sourceBlendPath = `measurement-projects/${projectId}/artifacts/${projectId}.blend`;
    const projectDir = path.join(outputDir, "measurement-projects", projectId);
    await mkdir(projectDir, { recursive: true });
    const project = MeasurementProjectSchema.parse({
      schemaVersion: 1,
      projectId,
      unit: "mm",
      elements: [{ id: "measured-panel", kind: "panel", boundsMm: { x: 0, y: 0, z: 0, width: 1000, depth: 100, height: 500 }, confidence: "high", source: "dimension", metadata: { captureContractV2: true } }],
      artifacts: { blend: sourceBlendPath }
    });
    const generated = await runBlenderJob(config, { mode: "measurement_project", operation: "generate_model", project }, sourceBlendPath);
    expect(generated.ok, generated.stderr).toBe(true);
    const modelLock = await buildModelLock(config, project, { lockedAt: "2026-08-16T00:00:00.000Z", lockedBy: "reviewer", reason: "Delivery runtime proof" });
    await writeFile(path.join(projectDir, "project.json"), JSON.stringify({ ...project, modelLock }), "utf8");
    const sourceHashBefore = createHash("sha256").update(await readFile(path.join(outputDir, sourceBlendPath))).digest("hex");

    const tools = new Map<string, (input: unknown) => Promise<ToolResult>>();
    const server = { tool(name: string, _description: string, _shape: unknown, handler: (input: unknown) => Promise<ToolResult>) { tools.set(name, handler); } } as unknown as McpServer;
    registerMeasurementTools(server, config);
    const drawings = await tools.get("export_dimensioned_drawings")!({
      projectId,
      executionIntent: intent("export-drawings"),
      outputPath: `measurement-projects/${projectId}/exports/drawings.pdf`,
      scale: "1:100",
      includeConfidenceLegend: true
    });
    const template = await tools.get("export_project_template")!({
      projectId,
      executionIntent: intent("export-template"),
      template: "permit",
      outputDir: `measurement-projects/${projectId}/exports/permit`,
      options: { scale: "1:100" }
    });
    expect(drawings.isError, drawings.content[0].text).toBe(false);
    expect(template.isError, template.content[0].text).toBe(false);
    expect((await readFile(path.join(outputDir, `measurement-projects/${projectId}/exports/drawings.pdf`))).subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect((await stat(path.join(outputDir, `measurement-projects/${projectId}/exports/permit/manifest.json`))).isFile()).toBe(true);
    expect(createHash("sha256").update(await readFile(path.join(outputDir, sourceBlendPath))).digest("hex")).toBe(sourceHashBefore);

    await writeFile(path.join(outputDir, sourceBlendPath), "tampered");
    const drifted = await tools.get("export_project_template")!({
      projectId,
      executionIntent: intent("export-template"),
      template: "archive",
      outputDir: `measurement-projects/${projectId}/exports/archive`,
      options: {}
    });
    expect(drifted.isError).toBe(true);
    expect((JSON.parse(drifted.content[0].text) as { error: { code: string } }).error.code).toBe("model_lock_invalid");
  }, 120_000);
});

function intent(operation: "export-drawings" | "export-template") {
  return {
    intentId: `locked-${operation}`,
    operation,
    objective: "Deliver reviewed locked geometry",
    writeScope: ["project-state", "blender-output", "manifest"],
    forbiddenScope: ["source-measurements", "locked-geometry"],
    selectedToolPath: "mcp:nova-measured",
    acceptanceChecks: ["schema", "quality-gate", "manifest"],
    executionPolicy: { locality: "local-only", telemetry: false, fallback: "none", geometryMutation: false }
  };
}
