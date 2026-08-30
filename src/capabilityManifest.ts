import { z } from "zod";
import { ProductMetadata } from "./productMetadata.js";

export const CapabilityManifestSchema = z.object({
  schemaVersion: z.literal(1),
  bridgeVersion: z.string().min(1),
  blender: z.object({
    minVersion: z.string().min(1),
    actualVersion: z.string().min(1).optional()
  }).strict(),
  supportedTemplates: z.array(z.enum([
    "permit-facade-pack",
    "swedish-municipality",
    "gothenburg-permit",
    "measured-visualization",
    "cad-simulated",
    "measured-digital-viewing"
  ])).min(1),
  allowedStrategies: z.object({
    geometryGeneration: z.array(z.enum(["parametric-profile", "structured-elements"])).min(1),
    viewGeneration: z.array(z.enum(["blender-orthographic-camera"])).min(1),
    lineRendering: z.array(z.enum(["freestyle", "line-art", "none"])).min(1),
    exportComposition: z.array(z.enum(["manifest", "pdf-layout", "svg-layout", "png-render"])).min(1),
    digitalViewingRender: z.array(z.enum([
      "locked-blender-source",
      "pbr-materials",
      "texture-map-application",
      "condition-overlays",
      "blender-camera",
      "blender-lighting",
      "render-manifest"
    ])).min(1)
  }).strict(),
  prohibitedStrategies: z.array(z.enum([
    "export-stage-geometry-reconstruction",
    "photo-only-geometry-inference",
    "cad-claim",
    "unlocked-permit-export",
    "render-stage-geometry-reconstruction",
    "photoreal-geometry-inference",
    "unlocked-digital-viewing-render"
  ])).min(1)
}).strict();
export type CapabilityManifest = z.infer<typeof CapabilityManifestSchema>;

export const CapabilityExecutionRequestSchema = z.object({
  template: z.string().min(1),
  strategies: z.array(z.string().min(1)).min(1)
}).strict();
export type CapabilityExecutionRequest = z.infer<typeof CapabilityExecutionRequestSchema>;

export const CapabilityDecisionSchema = z.object({
  ok: z.boolean(),
  blocking: z.array(z.object({
    code: z.enum(["template_not_supported", "strategy_not_allowed", "strategy_prohibited"]),
    message: z.string(),
    template: z.string().optional(),
    strategy: z.string().optional()
  }).strict()),
  warnings: z.array(z.object({
    code: z.string(),
    message: z.string()
  }).strict())
}).strict();
export type CapabilityDecision = z.infer<typeof CapabilityDecisionSchema>;

export const DefaultCapabilityManifest = CapabilityManifestSchema.parse({
  schemaVersion: 1,
  bridgeVersion: ProductMetadata.version,
  blender: {
    minVersion: "4.0.0"
  },
  supportedTemplates: [
    "permit-facade-pack",
    "swedish-municipality",
    "gothenburg-permit",
    "measured-visualization",
    "cad-simulated",
    "measured-digital-viewing"
  ],
  allowedStrategies: {
    geometryGeneration: ["parametric-profile", "structured-elements"],
    viewGeneration: ["blender-orthographic-camera"],
    lineRendering: ["freestyle", "line-art", "none"],
    exportComposition: ["manifest", "pdf-layout", "svg-layout", "png-render"],
    digitalViewingRender: [
      "locked-blender-source",
      "pbr-materials",
      "texture-map-application",
      "condition-overlays",
      "blender-camera",
      "blender-lighting",
      "render-manifest"
    ]
  },
  prohibitedStrategies: [
    "export-stage-geometry-reconstruction",
    "photo-only-geometry-inference",
    "cad-claim",
    "unlocked-permit-export",
    "render-stage-geometry-reconstruction",
    "photoreal-geometry-inference",
    "unlocked-digital-viewing-render"
  ]
});

export function assertTemplateSupported(manifest: CapabilityManifest, template: string): void {
  if (!manifest.supportedTemplates.includes(template as CapabilityManifest["supportedTemplates"][number])) {
    throw new Error(`Unsupported export template for capability manifest: ${template}`);
  }
}

export function assertNoProhibitedStrategy(manifest: CapabilityManifest, strategies: string[]): void {
  const blocked = strategies.filter((strategy) => manifest.prohibitedStrategies.includes(strategy as CapabilityManifest["prohibitedStrategies"][number]));
  if (blocked.length > 0) {
    throw new Error(`Prohibited export strategies requested: ${blocked.join(", ")}`);
  }
}

export function evaluateCapabilityExecution(manifest: CapabilityManifest, request: CapabilityExecutionRequest): CapabilityDecision {
  const payload = CapabilityExecutionRequestSchema.parse(request);
  const allowed = new Set([
    ...manifest.allowedStrategies.geometryGeneration,
    ...manifest.allowedStrategies.viewGeneration,
    ...manifest.allowedStrategies.lineRendering,
    ...manifest.allowedStrategies.exportComposition,
    ...manifest.allowedStrategies.digitalViewingRender
  ]);
  const blocking: CapabilityDecision["blocking"] = [];

  if (!manifest.supportedTemplates.includes(payload.template as CapabilityManifest["supportedTemplates"][number])) {
    blocking.push({
      code: "template_not_supported",
      message: "Export template is not supported by this capability manifest.",
      template: payload.template
    });
  }

  for (const strategy of payload.strategies) {
    if (manifest.prohibitedStrategies.includes(strategy as CapabilityManifest["prohibitedStrategies"][number])) {
      blocking.push({
        code: "strategy_prohibited",
        message: "Requested export strategy is explicitly prohibited by this capability manifest.",
        strategy
      });
    } else if (!allowed.has(strategy as never)) {
      blocking.push({
        code: "strategy_not_allowed",
        message: "Requested export strategy is not allowed by this capability manifest.",
        strategy
      });
    }
  }

  return CapabilityDecisionSchema.parse({ ok: blocking.length === 0, blocking, warnings: [] });
}
