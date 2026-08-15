#!/usr/bin/env node
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildExecutableWorkspace, renderWorkspaceHtml, UiRuntimeConfigSchema, type UiRuntimeConfig } from "./uiWorkspace.js";

export function startUiServer(config: UiRuntimeConfig) {
  const parsed = UiRuntimeConfigSchema.parse(config);
  const surface = buildExecutableWorkspace(parsed);
  let heldBy: string | null = null;
  const server = createServer((request, response) => {
    void handleRequest(request, response, surface, () => heldBy, (actor) => { heldBy = actor; }).catch(() => {
      if (!response.headersSent) send(response, 500, "application/json", JSON.stringify({ error: "workspace_request_failed" }));
      else response.destroy();
    });
  });
  server.listen(parsed.port, parsed.host);
  return server;
}

async function handleRequest(request: IncomingMessage, response: ServerResponse, surface: ReturnType<typeof buildExecutableWorkspace>, getHeldBy: () => string | null, setHeldBy: (actor: string) => void): Promise<void> {
  setSecurityHeaders(response);
  if (!validLoopbackHost(request)) return send(response, 421, "application/json", JSON.stringify({ error: "workspace_host_forbidden" }));
  if (request.method === "GET" && request.url === "/") return send(response, 200, "text/html; charset=utf-8", renderWorkspaceHtml(surface, getHeldBy()));
  if (request.method === "GET" && request.url === "/workspace.js") return send(response, 200, "text/javascript; charset=utf-8", workspaceScript);
  if (request.method === "GET" && request.url === "/api/workspace") { const heldBy = getHeldBy(); return send(response, 200, "application/json", JSON.stringify({ surface, operatorDecision: heldBy ? { decision: "hold", actor: heldBy } : null })); }
  if (request.method === "POST" && request.url === "/api/operator-decision") {
    if (!sameOrigin(request)) return send(response, 403, "application/json", JSON.stringify({ error: "operator_decision_origin_forbidden" }));
    try {
      const body = await readJson(request);
      if (body.decision !== "hold" || body.actor !== "operator") return send(response, 422, "application/json", JSON.stringify({ error: "operator_decision_invalid" }));
      setHeldBy(body.actor);
      return send(response, 200, "application/json", JSON.stringify({ ok: true, decision: "hold", actor: body.actor }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "operator_decision_invalid_json";
      return send(response, message === "operator_decision_body_too_large" ? 413 : 400, "application/json", JSON.stringify({ error: message }));
    }
  }
  return send(response, 404, "application/json", JSON.stringify({ error: "workspace_route_not_found" }));
}

function setSecurityHeaders(response: ServerResponse): void {
  response.setHeader("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  response.setHeader("referrer-policy", "no-referrer"); response.setHeader("x-content-type-options", "nosniff"); response.setHeader("cache-control", "no-store");
}

const workspaceScript = `"use strict";document.getElementById("manual-override").addEventListener("click",async()=>{const output=document.getElementById("decision");try{const response=await fetch("/api/operator-decision",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({decision:"hold",actor:"operator"})});const result=await response.json();output.textContent=response.ok?"Delivery held by operator.":result.error;}catch{output.textContent="Decision failed; delivery state unchanged."}});`;
function send(response: ServerResponse, status: number, type: string, body: string): void { response.statusCode = status; response.setHeader("content-type", type); response.end(body); }
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
    const server = startUiServer({ host: "127.0.0.1", port: Number(process.env.MEASURED_UI_PORT ?? "4173"), environmentTruth: { provider: process.env.MEASURED_UI_PROVIDER ?? "user-owned runtime", engine: process.env.MEASURED_UI_ENGINE ?? "Blender", endpoint: process.env.MEASURED_UI_ENDPOINT ?? "local-process", executionGeography: (process.env.MEASURED_UI_GEOGRAPHY ?? "local") as UiRuntimeConfig["environmentTruth"]["executionGeography"], owner: process.env.MEASURED_UI_OWNER ?? "user-local-runtime", costClass: (process.env.MEASURED_UI_COST ?? "local-compute") as UiRuntimeConfig["environmentTruth"]["costClass"], latencyClass: (process.env.MEASURED_UI_LATENCY ?? "interactive") as UiRuntimeConfig["environmentTruth"]["latencyClass"], fallbackUsed: false, dataScope: ["workspace-state", "operator-decision"], privacyBoundary: process.env.MEASURED_UI_PRIVACY ?? "loopback-only; no telemetry", operatorApprovalRequired: true, auditNotes: ["Execution truth is supplied explicitly at process start."] } });
    server.once("error", (error: NodeJS.ErrnoException) => {
      process.stderr.write(`${JSON.stringify({ error: "workspace_start_failed", code: error.code ?? "UNKNOWN" })}\n`);
      process.exitCode = 1;
    });
  } catch {
    process.stderr.write(`${JSON.stringify({ error: "workspace_config_invalid" })}\n`);
    process.exitCode = 1;
  }
}
