#!/usr/bin/env node
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildExecutableWorkspace, renderWorkspaceHtml, UiRuntimeConfigSchema, type UiRuntimeConfig } from "./uiWorkspace.js";
import { listUiProjects, loadUiProjectWorkspace, readUiDeliveryArtifact, readUiPreviewArtifact, readUiViewerArtifact, writeUiDecision } from "./uiProjectState.js";

export function startUiServer(config: UiRuntimeConfig) {
  const parsed = UiRuntimeConfigSchema.parse(config);
  const server = createServer((request, response) => {
    void handleRequest(request, response, parsed).catch(() => {
      if (!response.headersSent) send(response, 500, "application/json", JSON.stringify({ error: "workspace_request_failed" }));
      else response.destroy();
    });
  });
  server.listen(parsed.port, parsed.host);
  return server;
}

async function handleRequest(request: IncomingMessage, response: ServerResponse, config: UiRuntimeConfig): Promise<void> {
  setSecurityHeaders(response);
  if (!validLoopbackHost(request)) return send(response, 421, "application/json", JSON.stringify({ error: "workspace_host_forbidden" }));
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
  if (request.method === "GET" && url.pathname === "/") {
    const projectId = url.searchParams.get("projectId");
    if (!projectId) return send(response, 200, "text/html; charset=utf-8", renderWorkspaceHtml(buildExecutableWorkspace(config)));
    try { const workspace = await loadUiProjectWorkspace(config, projectId); return send(response, 200, "text/html; charset=utf-8", renderWorkspaceHtml(workspace.surface, workspace.operatorDecision?.actor ?? null, workspace.deliveryArtifacts, workspace.customerViews)); }
    catch (error) { return send(response, 404, "application/json", JSON.stringify({ error: workspaceError(error) })); }
  }
  if (request.method === "GET" && request.url === "/workspace.js") return send(response, 200, "text/javascript; charset=utf-8", workspaceScript);
  if (request.method === "GET" && url.pathname === "/api/projects") {
    try { return send(response, 200, "application/json", JSON.stringify({ projects: await listUiProjects(config) })); }
    catch (error) { return send(response, 409, "application/json", JSON.stringify({ error: workspaceError(error) })); }
  }
  if (request.method === "GET" && url.pathname === "/api/workspace") {
    const projectId = url.searchParams.get("projectId");
    if (!projectId) return send(response, 400, "application/json", JSON.stringify({ error: "workspace_project_required" }));
    try { return send(response, 200, "application/json", JSON.stringify(await loadUiProjectWorkspace(config, projectId))); }
    catch (error) { return send(response, 404, "application/json", JSON.stringify({ error: workspaceError(error) })); }
  }
  if (request.method === "GET" && url.pathname === "/api/delivery-artifact") {
    const projectId = url.searchParams.get("projectId"); const format = url.searchParams.get("format");
    if (!projectId || !format) return send(response, 400, "application/json", JSON.stringify({ error: "workspace_delivery_parameters_required" }));
    try {
      const artifact = await readUiDeliveryArtifact(config, projectId, format);
      response.statusCode = 200; response.setHeader("content-type", artifact.contentType); response.setHeader("content-length", artifact.bytes.byteLength);
      response.setHeader("content-disposition", `attachment; filename="${artifact.filename}"`); response.setHeader("etag", `"sha256-${artifact.sha256}"`); response.end(artifact.bytes); return;
    } catch (error) { return send(response, 409, "application/json", JSON.stringify({ error: workspaceError(error) })); }
  }
  if (request.method === "GET" && url.pathname === "/api/preview") {
    const projectId = url.searchParams.get("projectId");
    if (!projectId) return send(response, 400, "application/json", JSON.stringify({ error: "workspace_project_required" }));
    try { const preview = await readUiPreviewArtifact(config, projectId); response.statusCode = 200; response.setHeader("content-type", preview.contentType); response.setHeader("etag", `"sha256-${preview.sha256}"`); response.end(preview.bytes); return; }
    catch (error) { return send(response, 409, "application/json", JSON.stringify({ error: workspaceError(error) })); }
  }
  if (request.method === "GET" && url.pathname.startsWith("/viewer/")) {
    const match = /^\/viewer\/([^/]+)\/([^/]+)$/.exec(url.pathname);
    if (!match) return send(response, 404, "application/json", JSON.stringify({ error: "workspace_viewer_route_invalid" }));
    try {
      const artifact = await readUiViewerArtifact(config, decodeURIComponent(match[1]), match[2]);
      response.statusCode = 200; response.setHeader("content-type", artifact.contentType); response.end(artifact.bytes); return;
    } catch (error) { return send(response, 409, "application/json", JSON.stringify({ error: workspaceError(error) })); }
  }
  if (request.method === "POST" && request.url === "/api/operator-decision") {
    if (!sameOrigin(request)) return send(response, 403, "application/json", JSON.stringify({ error: "operator_decision_origin_forbidden" }));
    try {
      const body = await readJson(request);
      if ((body.decision !== "hold" && body.decision !== "release") || body.actor !== "operator" || typeof body.projectId !== "string") return send(response, 422, "application/json", JSON.stringify({ error: "operator_decision_invalid" }));
      const decision = await writeUiDecision(config, body.projectId, body.decision);
      return send(response, 200, "application/json", JSON.stringify({ ok: true, operatorDecision: decision }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "operator_decision_invalid_json";
      return send(response, message === "operator_decision_body_too_large" ? 413 : 400, "application/json", JSON.stringify({ error: message }));
    }
  }
  return send(response, 404, "application/json", JSON.stringify({ error: "workspace_route_not_found" }));
}

function setSecurityHeaders(response: ServerResponse): void {
  response.setHeader("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; img-src 'self' blob: data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  response.setHeader("referrer-policy", "no-referrer"); response.setHeader("x-content-type-options", "nosniff"); response.setHeader("cache-control", "no-store");
}

const workspaceScript = `"use strict";document.getElementById("manual-override").addEventListener("click",async()=>{const output=document.getElementById("decision");const projectId=new URLSearchParams(location.search).get("projectId");if(!projectId){output.textContent="Select an explicit project before holding delivery.";return;}try{const response=await fetch("/api/operator-decision",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({decision:"hold",actor:"operator",projectId})});const result=await response.json();if(response.ok){output.textContent="Delivery held by operator.";document.getElementById("delivery-artifacts")?.remove();document.getElementById("customer-viewing")?.remove();const state=document.getElementById("technical-output-state");if(state)state.textContent="Delivery held · verified artifacts unavailable";}else output.textContent=result.error;}catch{output.textContent="Decision failed; delivery state unchanged."}});`;
function send(response: ServerResponse, status: number, type: string, body: string): void { response.statusCode = status; response.setHeader("content-type", type); response.end(body); }
function workspaceError(error: unknown): string { return error instanceof Error && /^workspace_[a-z_]+$/.test(error.message) ? error.message : "workspace_project_unavailable"; }
function validLoopbackHost(request: IncomingMessage): boolean {
  const localPort = request.socket.localPort;
  return localPort !== undefined && request.headers.host === `127.0.0.1:${localPort}`;
}
function sameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  return origin === `http://${request.headers.host}`;
}
async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await new Promise<string>((resolve, reject) => {
    const chunks: Uint8Array[] = []; let size = 0; let tooLarge = false;
    request.on("data", (chunk: unknown) => {
      if (tooLarge) return;
      const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk instanceof Uint8Array ? Buffer.from(chunk) : null;
      if (!buffer) { tooLarge = true; return; }
      size += buffer.byteLength; if (size > 4096) { tooLarge = true; return; } chunks.push(buffer);
    });
    request.on("end", () => { if (tooLarge) reject(new Error(size > 4096 ? "operator_decision_body_too_large" : "operator_decision_invalid_json")); else resolve(Buffer.concat(chunks).toString("utf8")); });
    request.on("error", () => reject(new Error("operator_decision_read_failed")));
  });
  try { const value: unknown = JSON.parse(raw); if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(); return value as Record<string, unknown>; } catch { throw new Error("operator_decision_invalid_json"); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const server = startUiServer({ host: "127.0.0.1", port: Number(process.env.MEASURED_UI_PORT ?? "4173"), outputDir: path.resolve(process.env.NOVA_MEASURED_OUTPUT_DIR ?? "output"), environmentTruth: { provider: process.env.MEASURED_UI_PROVIDER ?? "user-owned runtime", engine: process.env.MEASURED_UI_ENGINE ?? "Blender", endpoint: process.env.MEASURED_UI_ENDPOINT ?? "local-process", executionGeography: (process.env.MEASURED_UI_GEOGRAPHY ?? "local") as UiRuntimeConfig["environmentTruth"]["executionGeography"], owner: process.env.MEASURED_UI_OWNER ?? "user-local-runtime", costClass: (process.env.MEASURED_UI_COST ?? "local-compute") as UiRuntimeConfig["environmentTruth"]["costClass"], latencyClass: (process.env.MEASURED_UI_LATENCY ?? "interactive") as UiRuntimeConfig["environmentTruth"]["latencyClass"], fallbackUsed: false, dataScope: ["workspace-state", "operator-decision"], privacyBoundary: process.env.MEASURED_UI_PRIVACY ?? "loopback-only; no telemetry", operatorApprovalRequired: true, auditNotes: ["Execution truth is supplied explicitly at process start."] } });
    server.once("error", (error: NodeJS.ErrnoException) => {
      process.stderr.write(`${JSON.stringify({ error: "workspace_start_failed", code: error.code ?? "UNKNOWN" })}\n`);
      process.exitCode = 1;
    });
  } catch {
    process.stderr.write(`${JSON.stringify({ error: "workspace_config_invalid" })}\n`);
    process.exitCode = 1;
  }
}
