import { z } from "zod";
import { buildMeasuredUiSurface, type MeasuredUiSurface, UiEnvironmentTruthSchema } from "./uiSurfaceContract.js";

export const UiRuntimeConfigSchema = z.object({
  host: z.literal("127.0.0.1"),
  port: z.number().int().min(0).max(65535),
  outputDir: z.string().min(1),
  environmentTruth: UiEnvironmentTruthSchema
}).strict();

export type UiRuntimeConfig = z.infer<typeof UiRuntimeConfigSchema>;

export function buildExecutableWorkspace(config: UiRuntimeConfig): MeasuredUiSurface {
  const runtime = UiRuntimeConfigSchema.parse(config);
  return buildMeasuredUiSurface({
    schemaVersion: 1,
    designDoctrine: { system: "MUE", nativeFirst: true, gridBasePx: 8, subgridPx: 4, motionDurationMs: 120, decorativeStatesAllowed: false },
    panels: [
      { id: "capture-contract", title: "Capture Contract", order: 1, states: [
        { id: "capture", label: "No capture package selected", topology: "system", status: "blocked", provenance: "measured-ui-surface-v1", blockingReason: "Select an explicit signed or reference capture package before validation.", operatorApprovalRequired: false },
        { id: "validation", label: "Contract validation not started", topology: "execution", status: "pending", provenance: "capture-package-required", operatorApprovalRequired: false }
      ] },
      { id: "model-review", title: "Model Review", order: 2, states: [
        { id: "infrastructure", label: `${runtime.environmentTruth.engine} configured via ${runtime.environmentTruth.provider}`, topology: "infrastructure", status: "pending", provenance: runtime.environmentTruth.endpoint, operatorApprovalRequired: false },
        { id: "model-lock", label: "Model lock unavailable", topology: "human-intervention", status: "blocked", provenance: "model-lock-contract", blockingReason: "A validated capture and reviewed model are required before lock.", operatorApprovalRequired: true }
      ] },
      { id: "export-delivery", title: "Export / Delivery", order: 3, states: [
        { id: "preview", label: "Photorealistic preview - not verified truth", topology: "execution", status: "pending", provenance: "preview-render-manifest", operatorApprovalRequired: false }
      ] }
    ],
    environmentTruth: runtime.environmentTruth,
    outputTruth: {
      technicalLabel: "Verified technical output",
      previewLabel: "Photorealistic preview - not verified truth",
      previewPermitAuthority: false,
      previewGeometryAuthority: false
    },
    manualOverrideAvailable: true
  });
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

const UiDeliveryArtifactSchema = z.object({
  format: z.enum(["glb", "obj", "mtl", "usdz", "blend"]),
  sizeBytes: z.number().int().positive().max(256 * 1024 * 1024),
  url: z.string().min(1)
}).strict().superRefine((artifact, context) => {
  const parsed = new URL(artifact.url, "http://127.0.0.1");
  const projectId = parsed.searchParams.get("projectId");
  const queryKeys = [...parsed.searchParams.keys()];
  if (parsed.origin !== "http://127.0.0.1" || parsed.pathname !== "/api/delivery-artifact" || parsed.hash !== "" ||
      !projectId || parsed.searchParams.get("format") !== artifact.format || queryKeys.length !== 2 ||
      queryKeys[0] !== "projectId" || queryKeys[1] !== "format" ||
      artifact.url !== `/api/delivery-artifact?projectId=${encodeURIComponent(projectId)}&format=${artifact.format}`) {
    context.addIssue({ code: "custom", message: "delivery_artifact_url_invalid", path: ["url"] });
  }
});

export function renderWorkspaceHtml(surface: MeasuredUiSurface, heldBy: string | null = null, deliveryArtifacts: Array<{ format: string; sizeBytes: number; url: string }> = []): string {
  const validated = buildMeasuredUiSurface(surface);
  const validatedArtifacts = z.array(UiDeliveryArtifactSchema).max(5).parse(deliveryArtifacts);
  const panels = validated.panels.map((panel) => `<section class="panel" aria-labelledby="${panel.id}-title">
    <header><span class="step">0${panel.order}</span><h2 id="${panel.id}-title">${escapeHtml(panel.title)}</h2></header>
    <ul>${panel.states.map((state) => `<li class="state state-${state.status}"><span class="state-label">${escapeHtml(state.label)}</span><span class="state-meta">${escapeHtml(state.topology)} · ${escapeHtml(state.status)}</span>${state.provenance ? `<small>Source: ${escapeHtml(state.provenance)}</small>` : ""}${state.blockingReason ? `<strong>${escapeHtml(state.blockingReason)}</strong>` : ""}</li>`).join("")}</ul>
  </section>`).join("");
  const truth = validated.environmentTruth;
  const fallback = truth.fallbackUsed
    ? `<div><dt>Fallback</dt><dd>Used: ${escapeHtml(truth.fallbackReason ?? "Undeclared")}</dd></div><div><dt>Primary failure</dt><dd>${escapeHtml(truth.primaryFailure ?? "Undeclared")}</dd></div>`
    : "<div><dt>Fallback</dt><dd>Not used</dd></div>";
  const auditNotes = truth.auditNotes.length > 0 ? truth.auditNotes.join("; ") : "None";
  const technicalOutput = heldBy ? "Delivery held · verified artifacts unavailable" : validatedArtifacts.length > 0 ? `${validated.outputTruth.technicalLabel} · ${validatedArtifacts.length} artifacts` : "No technical output loaded";
  const deliveryLinks = !heldBy && validatedArtifacts.length > 0 ? `<nav id="delivery-artifacts" class="delivery" aria-label="Verified technical output">${validatedArtifacts.map((artifact) => `<a href="${escapeHtml(artifact.url)}" download>${escapeHtml(artifact.format.toUpperCase())} · ${artifact.sizeBytes} bytes</a>`).join("")}</nav>` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Measured by Nova — Workspace</title><style>
  :root{color-scheme:light dark;font:15px/1.45 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;--space:8px;--surface:#f5f5f3;--ink:#20211f;--muted:#676b65;--line:#d8d9d5;--ok:#2e6544;--review:#8a5b11}*{box-sizing:border-box}body{margin:0;background:var(--surface);color:var(--ink)}main{max-width:1280px;margin:auto;padding:calc(var(--space)*4)}.masthead{display:flex;justify-content:space-between;gap:24px;align-items:end;border-bottom:1px solid var(--line);padding-bottom:24px}.eyebrow,.state-meta,dt,.step{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}h1,h2,p{margin:0}h1{font-size:30px;font-weight:570}.truth{display:grid;grid-template-columns:repeat(4,minmax(120px,1fr));gap:16px;margin:24px 0}.truth div{border-left:2px solid var(--line);padding-left:12px}dd{margin:4px 0 0}.panels{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.panel{background:color-mix(in srgb,var(--surface),white 50%);border:1px solid var(--line);border-radius:8px;padding:24px;min-height:320px}.panel header{display:flex;gap:12px;align-items:baseline}.panel h2{font-size:18px}ul{list-style:none;padding:0;margin:24px 0 0;display:grid;gap:12px}.state{display:grid;gap:4px;border-top:1px solid var(--line);padding-top:12px}.state-label{font-weight:600}.state-ready{border-color:var(--ok)}.state-review-required{border-color:var(--review)}small{color:var(--muted)}.truth-warning{margin-top:24px;padding:16px;border:1px solid var(--review);border-radius:8px}.override{margin-top:16px;font:inherit;padding:8px 12px;border:1px solid currentColor;border-radius:6px;background:transparent;color:inherit;cursor:pointer}.override:focus-visible{outline:3px solid #4d78cc;outline-offset:2px}@media(max-width:880px){.panels{grid-template-columns:1fr}.truth{grid-template-columns:repeat(2,1fr)}}@media(max-width:520px){main{padding:16px}.truth{grid-template-columns:1fr}.masthead{align-items:start;flex-direction:column}}@media(prefers-color-scheme:dark){:root{--surface:#171816;--ink:#eceee9;--muted:#a9ada5;--line:#3a3d38;--ok:#71b98b;--review:#d7a14d}.panel{background:#1d1f1c}}
  .delivery{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}.delivery a{color:inherit;border:1px solid var(--line);border-radius:6px;padding:8px 12px;text-decoration:none}.delivery a:focus-visible{outline:3px solid #4d78cc;outline-offset:2px}</style></head><body><main><header class="masthead"><div><p class="eyebrow">Instrument workspace</p><h1>Measured by Nova</h1></div><p id="technical-output-state">${escapeHtml(technicalOutput)}</p></header>
  <dl class="truth" aria-label="Environment truth"><div><dt>Provider</dt><dd>${escapeHtml(truth.provider)}</dd></div><div><dt>Engine</dt><dd>${escapeHtml(truth.engine)}</dd></div><div><dt>Endpoint</dt><dd>${escapeHtml(truth.endpoint)}</dd></div><div><dt>Execution</dt><dd>${escapeHtml(truth.executionGeography)} · ${escapeHtml(truth.latencyClass)}</dd></div><div><dt>Owner</dt><dd>${escapeHtml(truth.owner)}</dd></div><div><dt>Cost</dt><dd>${escapeHtml(truth.costClass)}</dd></div>${fallback}<div><dt>Data scope</dt><dd>${escapeHtml(truth.dataScope.join(", "))}</dd></div><div><dt>Privacy</dt><dd>${escapeHtml(truth.privacyBoundary)}</dd></div><div><dt>Operator approval</dt><dd>${truth.operatorApprovalRequired ? "Required" : "Not required"}</dd></div><div><dt>Audit notes</dt><dd>${escapeHtml(auditNotes)}</dd></div></dl>
  <div class="panels">${panels}</div>${deliveryLinks}<aside class="truth-warning"><strong>${escapeHtml(validated.outputTruth.previewLabel)}</strong><p>Preview has no permit or geometry authority. ${escapeHtml(validated.outputTruth.technicalLabel)} is a classification available only after artifact validation.</p><button class="override" type="button" id="manual-override">Manual override: hold delivery</button><output id="decision" aria-live="polite">${heldBy ? `Delivery held by ${escapeHtml(heldBy)}.` : ""}</output></aside>
  </main><script src="/workspace.js" defer></script></body></html>`;
}
