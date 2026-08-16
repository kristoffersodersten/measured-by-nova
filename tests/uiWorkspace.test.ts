import { once } from "node:events";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startUiServer } from "../src/uiServer.js";
import { buildExecutableWorkspace, renderWorkspaceHtml, type UiRuntimeConfig } from "../src/uiWorkspace.js";
import { loadUiProjectWorkspace } from "../src/uiProjectState.js";
import { MeasurementProjectSchema } from "../src/measurementContracts.js";
import { hashValidationSourceProject } from "../src/modelLock.js";

const openServers: ReturnType<typeof startUiServer>[] = [];
const fetchForbiddenPorts = new Set([1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 992, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697, 10080]);
const config = (outputDir = path.join(os.tmpdir(), "nova-ui-empty")): UiRuntimeConfig => ({
  host: "127.0.0.1", port: 0, outputDir, environmentTruth: { provider: "Hetzner", engine: "Blender 4.0.2", endpoint: "remote-ci-runner",
  executionGeography: "remote", owner: "project-ci", costClass: "included-remote", latencyClass: "long-running",
  fallbackUsed: false, dataScope: ["workspace-state", "operator-decision"], privacyBoundary: "loopback-only; no telemetry",
  operatorApprovalRequired: true, auditNotes: ["test runtime"] }
});

afterEach(async () => { await Promise.all(openServers.splice(0).map((server) => new Promise<void>((resolve) => {
  if (!server.listening) return resolve();
  server.close(() => resolve());
}))); });

async function runningServer(runtimeConfig = config()) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const server = startUiServer(runtimeConfig); openServers.push(server); if (!server.listening) await once(server, "listening");
    const port = (server.address() as AddressInfo).port;
    if (!fetchForbiddenPorts.has(port)) return { server, origin: `http://127.0.0.1:${port}` };
    await new Promise<void>((resolve) => server.close(() => resolve()));
    openServers.splice(openServers.indexOf(server), 1);
  }
  throw new Error("ui_test_safe_ephemeral_port_unavailable");
}

async function statusWithHost(url: string, host: string): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const client = request(url, { headers: { host } }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode ?? 0));
    });
    client.on("error", reject);
    client.end();
  });
}

describe("executable Measured workspace", () => {
  it("renders all three panels and visible Environment Truth without external assets", () => {
    const surface = buildExecutableWorkspace(config());
    const html = renderWorkspaceHtml(surface);
    expect(surface.panels.map((panel) => panel.id)).toEqual(["capture-contract", "model-review", "export-delivery"]);
    expect(html).toContain("Hetzner"); expect(html).toContain("remote · long-running"); expect(html).toContain("Photorealistic preview - not verified truth");
    expect(html).toContain("No capture package selected"); expect(html).toContain("Select an explicit signed or reference capture package before validation.");
    expect(html).toContain("No technical output loaded"); expect(html).toContain("Blender 4.0.2 configured via Hetzner"); expect(html).toContain("Not used");
    expect(html).not.toMatch(/https?:\/\/(?!127\.0\.0\.1)/);
  });

  it("serves loopback HTML and explicit workspace state with security headers", async () => {
    const { origin } = await runningServer();
    const page = await fetch(origin); const state = await fetch(`${origin}/api/workspace`);
    expect(page.status).toBe(200); expect(page.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(await page.text()).toContain("Capture Contract"); expect(state.status).toBe(400);
    expect((await state.json()) as object).toEqual({ error: "workspace_project_required" });
  });

  it("discovers only valid in-root projects and derives causal live state", async () => {
    const outputDir = await projectFixture("observed-project");
    const outside = await mkdtemp(path.join(os.tmpdir(), "nova-ui-outside-"));
    await writeFile(path.join(outside, "project.json"), JSON.stringify({ schemaVersion: 1, projectId: "escaped", unit: "mm" }), "utf8");
    await symlink(outside, path.join(outputDir, "measurement-projects", "escaped"));
    await mkdir(path.join(outputDir, "measurement-projects", "malformed"));
    await writeFile(path.join(outputDir, "measurement-projects", "malformed", "project.json"), "{", "utf8");
    const { origin } = await runningServer(config(outputDir));
    expect(await (await fetch(`${origin}/api/projects`)).json()).toEqual({ projects: ["observed-project"] });
    const workspace = await (await fetch(`${origin}/api/workspace?projectId=observed-project`)).json() as { project: object; surface: { panels: Array<{ states: Array<{ status: string; blockingReason?: string }> }> } };
    expect(workspace.project).toMatchObject({ projectId: "observed-project", captureReady: false, validationPassed: false, modelLockValid: false });
    expect(workspace.surface.panels[0]?.states[0]).toMatchObject({ status: "blocked", blockingReason: "At least one photo and one measurement or profile are required." });
    expect(workspace.surface.panels.flatMap((panel) => panel.states)).toHaveLength(5);
    expect(workspace.surface.panels[1]?.states[0]).toMatchObject({ id: "blender-execution", topology: "infrastructure", status: "pending" });
    expect(workspace.surface.panels[2]?.states[0]).toMatchObject({ id: "delivery", label: "Photorealistic preview - not verified truth", status: "blocked", blockingReason: "capture_trust_incomplete" });
    expect((await fetch(`${origin}/api/workspace?projectId=escaped`)).status).toBe(404);
  });

  it("rejects a measurement-projects root that escapes through a symlink", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "nova-ui-root-"));
    const outside = await mkdtemp(path.join(os.tmpdir(), "nova-ui-external-root-"));
    await symlink(outside, path.join(outputDir, "measurement-projects"));
    const { origin } = await runningServer(config(outputDir));
    const response = await fetch(`${origin}/api/projects`);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "workspace_projects_root_escape" });
  });

  it("accepts only completed validation bound to the current project state", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "nova-ui-validation-"));
    const fixture = MeasurementProjectSchema.parse(JSON.parse(await readFile("fixtures/synthetic-carport-project.json", "utf8")) as unknown);
    const validation = { ok: true, checks: [{ name: "known_dimensions:profile", ok: true, message: "validated" }], warnings: [], sourceProjectHash: hashValidationSourceProject(fixture) };
    const validated = { ...fixture, validation };
    const projectDir = path.join(outputDir, "measurement-projects", fixture.projectId);
    await mkdir(projectDir, { recursive: true });
    await writeFile(path.join(projectDir, "project.json"), JSON.stringify(validated), "utf8");
    const trustedWorkspace = await loadUiProjectWorkspace(config(outputDir), fixture.projectId);
    expect(trustedWorkspace.project.validationPassed).toBe(true);
    expect(trustedWorkspace.surface.panels[0]?.states[0]).toMatchObject({ status: "blocked", blockingReason: "Verify an explicit native or manual capture package before publication." });
    const mutated = { ...validated, assumptions: [...validated.assumptions, { id: "late-change", text: "Changed after validation", confidence: "medium" as const, source: "user_declared" as const, affectsGeometry: false }] };
    await writeFile(path.join(projectDir, "project.json"), JSON.stringify(mutated), "utf8");
    expect((await loadUiProjectWorkspace(config(outputDir), fixture.projectId)).project.validationPassed).toBe(false);
  });

  it("records only an explicit hold decision and rejects unsafe or malformed mutations", async () => {
    const outputDir = await projectFixture("runtime-project");
    const { origin } = await runningServer(config(outputDir));
    const forbidden = await fetch(`${origin}/api/operator-decision`, { method: "POST", headers: { origin: "https://attacker.invalid", "content-type": "application/json" }, body: "{}" });
    const forbiddenHost = await statusWithHost(`${origin}/api/workspace`, "attacker.invalid");
    const missingOrigin = await fetch(`${origin}/api/operator-decision`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const mutationHeaders = { origin, "content-type": "application/json" };
    const invalid = await fetch(`${origin}/api/operator-decision`, { method: "POST", headers: mutationHeaders, body: JSON.stringify({ decision: "approve", actor: "operator", projectId: "runtime-project" }) });
    const malformed = await fetch(`${origin}/api/operator-decision`, { method: "POST", headers: mutationHeaders, body: "{" });
    const held = await fetch(`${origin}/api/operator-decision`, { method: "POST", headers: mutationHeaders, body: JSON.stringify({ decision: "hold", actor: "operator", projectId: "runtime-project" }) });
    expect([forbidden.status, forbiddenHost, missingOrigin.status, invalid.status, malformed.status, held.status]).toEqual([403, 421, 403, 422, 400, 200]);
    expect((await (await fetch(`${origin}/api/workspace?projectId=runtime-project`)).json()) as object).toMatchObject({ operatorDecision: { decision: "hold", actor: "operator", projectId: "runtime-project" } });
    expect(await (await fetch(`${origin}/?projectId=runtime-project`)).text()).toContain("Delivery held by operator.");
  });

  it("persists a project hold across restart and revokes it explicitly", async () => {
    const outputDir = await projectFixture("persistent-project");
    const first = await runningServer(config(outputDir));
    await fetch(`${first.origin}/api/operator-decision`, { method: "POST", headers: { origin: first.origin, "content-type": "application/json" }, body: JSON.stringify({ decision: "hold", actor: "operator", projectId: "persistent-project" }) });
    await new Promise<void>((resolve) => first.server.close(() => resolve())); openServers.splice(openServers.indexOf(first.server), 1);
    const second = await runningServer(config(outputDir));
    expect((await (await fetch(`${second.origin}/api/workspace?projectId=persistent-project`)).json()) as object).toMatchObject({ operatorDecision: { decision: "hold" } });
    await fetch(`${second.origin}/api/operator-decision`, { method: "POST", headers: { origin: second.origin, "content-type": "application/json" }, body: JSON.stringify({ decision: "release", actor: "operator", projectId: "persistent-project" }) });
    expect((await (await fetch(`${second.origin}/api/workspace?projectId=persistent-project`)).json()) as object).toMatchObject({ operatorDecision: null });
    await writeFile(path.join(outputDir, "measurement-projects", "persistent-project", ".ui-decision.json"), "{", "utf8");
    const corrupted = await fetch(`${second.origin}/api/workspace?projectId=persistent-project`);
    expect(corrupted.status).toBe(404);
    expect(await corrupted.json()).toEqual({ error: "workspace_decision_invalid" });
  });

  it("exposes a causal startup error when the loopback port is occupied", async () => {
    const first = await runningServer();
    const port = (first.server.address() as AddressInfo).port;
    const conflicting = startUiServer({ ...config(), port });
    openServers.push(conflicting);
    const [error] = await once(conflicting, "error") as [NodeJS.ErrnoException];
    expect(error.code).toBe("EADDRINUSE");
  });

  it("renders fallback cause and complete accepted data scope when fallback is declared", () => {
    const fallback = config();
    fallback.environmentTruth = { ...fallback.environmentTruth, fallbackUsed: true, fallbackReason: "primary unavailable", primaryFailure: "endpoint timeout", dataScope: ["project-json", "photos"] };
    const html = renderWorkspaceHtml(buildExecutableWorkspace(fallback));
    expect(html).toContain("Used: primary unavailable"); expect(html).toContain("endpoint timeout"); expect(html).toContain("project-json, photos");
  });
});

async function projectFixture(projectId: string): Promise<string> {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "nova-ui-project-"));
  const projectDir = path.join(outputDir, "measurement-projects", projectId);
  await mkdir(projectDir, { recursive: true });
  await writeFile(path.join(projectDir, "project.json"), JSON.stringify({ schemaVersion: 1, projectId, unit: "mm" }), "utf8");
  return outputDir;
}
