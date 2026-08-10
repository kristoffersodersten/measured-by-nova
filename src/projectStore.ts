import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { BlenderConfig } from "./contracts.js";
import { MeasurementProjectSchema, type MeasurementProject } from "./measurementContracts.js";
import { safeOutputPath } from "./blenderRunner.js";

export type ToolResponse<T> = {
  ok: boolean;
  requestId: string;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
  warnings: string[];
};

export function requestId(): string {
  return randomUUID();
}

export function ok<T>(requestIdValue: string, data: T, warnings: string[] = []): ToolResponse<T> {
  return { ok: true, requestId: requestIdValue, data, warnings };
}

export function fail(requestIdValue: string, code: string, message: string, warnings: string[] = [], details?: unknown): ToolResponse<never> {
  return { ok: false, requestId: requestIdValue, error: { code, message, details }, warnings };
}

export function projectsRoot(config: BlenderConfig): string {
  return safeOutputPath(config.outputDir, "measurement-projects");
}

export function projectDir(config: BlenderConfig, projectId: string): string {
  return safeOutputPath(config.outputDir, path.join("measurement-projects", projectId));
}

export function projectJsonPath(config: BlenderConfig, projectId: string): string {
  return safeOutputPath(config.outputDir, path.join("measurement-projects", projectId, "project.json"));
}

export async function readProject(config: BlenderConfig, projectId: string): Promise<MeasurementProject> {
  const raw = await readFile(projectJsonPath(config, projectId), "utf8");
  return MeasurementProjectSchema.parse(JSON.parse(raw));
}

export async function writeProject(config: BlenderConfig, project: MeasurementProject): Promise<void> {
  const dir = projectDir(config, project.projectId);
  await mkdir(dir, { recursive: true });
  await writeFile(projectJsonPath(config, project.projectId), `${JSON.stringify(project, null, 2)}\n`, "utf8");
}

export async function appendRequestLog(config: BlenderConfig, projectId: string, requestIdValue: string, tool: string, payload: unknown): Promise<void> {
  const dir = projectDir(config, projectId);
  await mkdir(dir, { recursive: true });
  const logPath = safeOutputPath(config.outputDir, path.join("measurement-projects", projectId, "requests.log"));
  await writeFile(logPath, `${JSON.stringify({ time: new Date().toISOString(), requestId: requestIdValue, tool, payload })}\n`, { encoding: "utf8", flag: "a" });
}
