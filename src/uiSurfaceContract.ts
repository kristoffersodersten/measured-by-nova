import { z } from "zod";
import { ConfidenceSchema } from "./measurementContracts.js";

export const UiTopologyClassSchema = z.enum([
  "system",
  "execution",
  "infrastructure",
  "human-intervention"
]);

export const UiVisibleStateSchema = z.object({
  id: z.string().min(1).max(80),
  label: z.string().min(1).max(120),
  topology: UiTopologyClassSchema,
  status: z.enum(["pending", "running", "ready", "blocked", "review-required"]),
  confidence: ConfidenceSchema.optional(),
  provenance: z.string().min(1).max(240).optional(),
  blockingReason: z.string().min(1).max(240).optional(),
  operatorApprovalRequired: z.boolean().default(false)
}).strict().superRefine((state, ctx) => {
  if (state.status === "blocked" && !state.blockingReason) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["blockingReason"], message: "Blocked UI state requires a causal reason." });
  }
  if (state.status === "review-required" && !state.operatorApprovalRequired) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["operatorApprovalRequired"], message: "Review-required UI state must expose operator approval." });
  }
});

export const UiEnvironmentTruthSchema = z.object({
  provider: z.string().min(1).max(120),
  engine: z.string().min(1).max(120),
  endpoint: z.string().min(1).max(240),
  executionGeography: z.enum(["local", "remote", "hybrid"]),
  owner: z.string().min(1).max(120),
  costClass: z.enum(["local-compute", "metered-remote", "included-remote", "unknown"]),
  latencyClass: z.enum(["interactive", "queued", "long-running", "unknown"]),
  fallbackUsed: z.boolean(),
  fallbackReason: z.string().min(1).max(240).optional(),
  primaryFailure: z.string().min(1).max(240).optional(),
  dataScope: z.array(z.string().min(1).max(120)).min(1),
  privacyBoundary: z.string().min(1).max(240),
  operatorApprovalRequired: z.boolean(),
  auditNotes: z.array(z.string().min(1).max(240)).default([])
}).strict().superRefine((truth, ctx) => {
  if (truth.fallbackUsed && (!truth.fallbackReason || !truth.primaryFailure)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["fallbackReason"], message: "Fallback use must expose its reason and primary failure." });
  }
  if (truth.costClass === "unknown" || truth.latencyClass === "unknown") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["costClass"], message: "Cost and latency may not be hidden or unknown on an executable surface." });
  }
});

const PanelIdSchema = z.enum(["capture-contract", "model-review", "export-delivery"]);

export const UiPanelSchema = z.object({
  id: PanelIdSchema,
  title: z.string().min(1).max(80),
  order: z.number().int().min(1).max(3),
  states: z.array(UiVisibleStateSchema).min(1).max(5)
}).strict();

export const MeasuredUiSurfaceSchema = z.object({
  schemaVersion: z.literal(1),
  designDoctrine: z.object({
    system: z.literal("MUE"),
    nativeFirst: z.literal(true),
    gridBasePx: z.literal(8),
    subgridPx: z.literal(4),
    motionDurationMs: z.number().int().min(100).max(150),
    decorativeStatesAllowed: z.literal(false)
  }).strict(),
  panels: z.array(UiPanelSchema).length(3),
  environmentTruth: UiEnvironmentTruthSchema,
  outputTruth: z.object({
    technicalLabel: z.literal("Verified technical output"),
    previewLabel: z.literal("Photorealistic preview - not verified truth"),
    previewPermitAuthority: z.literal(false),
    previewGeometryAuthority: z.literal(false)
  }).strict(),
  manualOverrideAvailable: z.literal(true)
}).strict().superRefine((surface, ctx) => {
  const expectedPanels = ["capture-contract", "model-review", "export-delivery"];
  if (surface.panels.some((panel, index) => panel.id !== expectedPanels[index] || panel.order !== index + 1)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["panels"], message: "UI must use the ordered three-panel workflow." });
  }
  const visibleStates = surface.panels.flatMap((panel) => panel.states);
  if (visibleStates.length > 5) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["panels"], message: "UI may expose no more than five simultaneous visible states." });
  }
  const topology = new Set(visibleStates.map((state) => state.topology));
  for (const required of UiTopologyClassSchema.options) {
    if (!topology.has(required)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["panels"], message: `UI must expose ${required} state.` });
    }
  }
  if (!visibleStates.some((state) => state.label === surface.outputTruth.previewLabel)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["outputTruth", "previewLabel"], message: "Preview classification must be visible in the workspace state." });
  }
  if (surface.environmentTruth.operatorApprovalRequired && !visibleStates.some((state) => state.operatorApprovalRequired)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["environmentTruth", "operatorApprovalRequired"], message: "Required operator approval must be visible as a workflow state." });
  }
});

export type MeasuredUiSurface = z.infer<typeof MeasuredUiSurfaceSchema>;

export function buildMeasuredUiSurface(input: unknown): MeasuredUiSurface {
  return MeasuredUiSurfaceSchema.parse(input);
}
