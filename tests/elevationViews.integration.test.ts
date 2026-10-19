import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { RealCarportCaptureSchema } from "../src/captureToFixture.js";
import { registerMeasurementTools } from "../src/measurementTools.js";

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

describe("orthographic review artifact runtime", () => {
  it("promotes the generated view BLEND as the exact human-review and lock source", async () => {
    if (!process.env.BLENDER_PATH) throw new Error("BLENDER_PATH is required for the elevation-view integration test.");
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "nova-view-review-"));
    const capture = RealCarportCaptureSchema.parse(JSON.parse(await readFile("fixtures/real-capture-carport-minimal.json", "utf8")));
    const tools = new Map<string, (input: unknown) => Promise<ToolResult>>();
    const server = { tool(name: string, _description: string, _shape: unknown, handler: (input: unknown) => Promise<ToolResult>) { tools.set(name, handler); } } as unknown as McpServer;
    registerMeasurementTools(server, { outputDir, timeoutMs: 120_000, blenderPath: process.env.BLENDER_PATH });

    expect((await tools.get("create_project_from_capture")!(capture)).isError).toBe(false);
    const generated = await tools.get("generate_measured_model")!({ projectId: capture.projectId });
    expect(generated.isError, generated.content[0].text).toBe(false);
    const generatedBody = JSON.parse(generated.content[0].text) as { data: { artifacts: { blend: string } } };
    expect(generatedBody.data.artifacts.blend).toBe(`measurement-projects/${capture.projectId}/artifacts/${capture.projectId}.blend`);
    const views = await tools.get("generate_elevation_views")!({ projectId: capture.projectId, views: ["plan", "north", "south", "east", "west", "section_a_a"] });
    expect(views.isError, views.content[0].text).toBe(false);
    const body = JSON.parse(views.content[0].text) as { data: { artifacts: { blend: string }; viewRegistry: { views: Array<{ name: string }> } } };
    expect(body.data.artifacts.blend).toBe(`measurement-projects/${capture.projectId}/artifacts/${capture.projectId}-views.blend`);
    expect(body.data.viewRegistry.views.map((view) => view.name)).toEqual(["plan", "north", "south", "east", "west", "section_a_a"]);
    const project = JSON.parse(await readFile(path.join(outputDir, "measurement-projects", capture.projectId, "project.json"), "utf8")) as { artifacts: { blend: string } };
    expect(project.artifacts.blend).toBe(body.data.artifacts.blend);
    expect((await readFile(path.join(outputDir, project.artifacts.blend))).subarray(0, 7).toString("ascii")).toBe("BLENDER");
  }, 120_000);
});