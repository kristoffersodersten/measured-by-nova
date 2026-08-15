import { z } from "zod";

export const PerformanceBudgetSchema = z.object({
  captureValidationP95Ms: z.number().positive(),
  renderManifestP95Ms: z.number().positive(),
  packageManifestP95Ms: z.number().positive(),
  sourceProjectionAlignmentP95Ms: z.number().positive(),
  maxRssDeltaBytes: z.number().int().positive(),
  maxPackageBytes: z.number().int().positive(),
  blenderRuntimeMaxMs: z.number().int().positive()
}).strict();

export const DefaultPerformanceBudget = PerformanceBudgetSchema.parse({
  captureValidationP95Ms: 25,
  renderManifestP95Ms: 50,
  packageManifestP95Ms: 100,
  sourceProjectionAlignmentP95Ms: 25,
  maxRssDeltaBytes: 64 * 1024 * 1024,
  maxPackageBytes: 2 * 1024 * 1024,
  blenderRuntimeMaxMs: 7 * 60 * 1000
});

const MetricSchema = z.object({
  samples: z.number().int().positive(),
  p95Ms: z.number().nonnegative()
}).strict();

export const PerformanceObservationSchema = z.object({
  captureValidation: MetricSchema,
  renderManifest: MetricSchema,
  packageManifest: MetricSchema,
  sourceProjectionAlignment: MetricSchema,
  rssDeltaBytes: z.number().int().nonnegative(),
  packageBytes: z.number().int().nonnegative(),
  blenderRuntimeMs: z.number().int().nonnegative()
}).strict();

const PerformanceMetricSchema = z.enum([
  "captureValidationP95Ms",
  "renderManifestP95Ms",
  "packageManifestP95Ms",
  "sourceProjectionAlignmentP95Ms",
  "rssDeltaBytes",
  "packageBytes",
  "blenderRuntimeMs"
]);

export const PerformanceEvidenceSchema = z.object({
  schemaVersion: z.literal(1),
  commit: z.string().regex(/^[0-9a-f]{40}$/),
  runtime: z.object({ node: z.string().min(1), platform: z.string().min(1), arch: z.string().min(1) }).strict(),
  budget: PerformanceBudgetSchema,
  observation: PerformanceObservationSchema,
  ok: z.boolean(),
  failures: z.array(z.object({ metric: PerformanceMetricSchema, observed: z.number(), limit: z.number() }).strict())
}).strict().superRefine((value, context) => {
  if (value.ok !== (value.failures.length === 0)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "ok must equal failures.length === 0" });
  }
});

export type PerformanceObservation = z.infer<typeof PerformanceObservationSchema>;
export type PerformanceEvidence = z.infer<typeof PerformanceEvidenceSchema>;

export function evaluatePerformanceEvidence(
  commit: string,
  observation: PerformanceObservation,
  budget = DefaultPerformanceBudget
): PerformanceEvidence {
  const parsedObservation = PerformanceObservationSchema.parse(observation);
  const parsedBudget = PerformanceBudgetSchema.parse(budget);
  const failures: PerformanceEvidence["failures"] = [];
  const check = (metric: z.infer<typeof PerformanceMetricSchema>, observed: number, limit: number): void => {
    if (observed > limit) failures.push({ metric, observed, limit });
  };

  check("captureValidationP95Ms", parsedObservation.captureValidation.p95Ms, parsedBudget.captureValidationP95Ms);
  check("renderManifestP95Ms", parsedObservation.renderManifest.p95Ms, parsedBudget.renderManifestP95Ms);
  check("packageManifestP95Ms", parsedObservation.packageManifest.p95Ms, parsedBudget.packageManifestP95Ms);
  check("sourceProjectionAlignmentP95Ms", parsedObservation.sourceProjectionAlignment.p95Ms, parsedBudget.sourceProjectionAlignmentP95Ms);
  check("rssDeltaBytes", parsedObservation.rssDeltaBytes, parsedBudget.maxRssDeltaBytes);
  check("packageBytes", parsedObservation.packageBytes, parsedBudget.maxPackageBytes);
  check("blenderRuntimeMs", parsedObservation.blenderRuntimeMs, parsedBudget.blenderRuntimeMaxMs);

  return PerformanceEvidenceSchema.parse({
    schemaVersion: 1,
    commit,
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    budget: parsedBudget,
    observation: parsedObservation,
    ok: failures.length === 0,
    failures
  });
}
