import { once } from "node:events";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { startUiServer } from "../src/uiServer.js";
import { buildExecutableWorkspace, renderWorkspaceHtml, type UiRuntimeConfig } from "../src/uiWorkspace.js";

const openServers: ReturnType<typeof startUiServer>[] = [];
const config = (): UiRuntimeConfig => ({
  host: "127.0.0.1", port: 0, environmentTruth: { provider: "Hetzner", engine: "Blender 4.0.2", endpoint: "remote-ci-runner",
  executionGeography: "remote", owner: "project-ci", costClass: "included-remote", latencyClass: "long-running",
  fallbackUsed: false, dataScope: ["workspace-state", "operator-decision"], privacyBoundary: "loopback-only; no telemetry",
  operatorApprovalRequired: true, auditNotes: ["test runtime"] }
});

afterEach(async () => { await Promise.all(openServers.splice(0).map((server) => new Promise<void>((resolve) => {
  if (!server.listening) return resolve();
  server.close(() => resolve());
}))); });

async function runningServer() {
  const server = startUiServer(config()); openServers.push(server); if (!server.listening) await once(server, "listening");
  const port = (server.address() as AddressInfo).port; return { server, origin: `http://127.0.0.1:${port}` };
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
    expect(await page.text()).toContain("Capture Contract"); expect((await state.json()) as object).toMatchObject({ operatorDecision: null });
  });

  it("records only an explicit hold decision and rejects unsafe or malformed mutations", async () => {
    const { origin } = await runningServer();
    const forbidden = await fetch(`${origin}/api/operator-decision`, { method: "POST", headers: { origin: "https://attacker.invalid", "content-type": "application/json" }, body: "{}" });
    const forbiddenHost = await statusWithHost(`${origin}/api/workspace`, "attacker.invalid");
    const missingOrigin = await fetch(`${origin}/api/operator-decision`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const mutationHeaders = { origin, "content-type": "application/json" };
    const invalid = await fetch(`${origin}/api/operator-decision`, { method: "POST", headers: mutationHeaders, body: JSON.stringify({ decision: "approve", actor: "operator" }) });
    const malformed = await fetch(`${origin}/api/operator-decision`, { method: "POST", headers: mutationHeaders, body: "{" });
    const held = await fetch(`${origin}/api/operator-decision`, { method: "POST", headers: mutationHeaders, body: JSON.stringify({ decision: "hold", actor: "operator" }) });
    expect([forbidden.status, forbiddenHost, missingOrigin.status, invalid.status, malformed.status, held.status]).toEqual([403, 421, 403, 422, 400, 200]);
    expect((await (await fetch(`${origin}/api/workspace`)).json()) as object).toMatchObject({ operatorDecision: { decision: "hold", actor: "operator" } });
    expect(await (await fetch(origin)).text()).toContain("Delivery held by operator.");
  });

  it("recovers with no residual decision after a controlled restart", async () => {
    const first = await runningServer();
    await fetch(`${first.origin}/api/operator-decision`, { method: "POST", headers: { origin: first.origin, "content-type": "application/json" }, body: JSON.stringify({ decision: "hold", actor: "operator" }) });
    await new Promise<void>((resolve) => first.server.close(() => resolve())); openServers.splice(openServers.indexOf(first.server), 1);
    const second = await runningServer();
    expect((await (await fetch(`${second.origin}/api/workspace`)).json()) as object).toMatchObject({ operatorDecision: null });
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
