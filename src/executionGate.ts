import { createHash } from "node:crypto";
import { z } from "zod";

export const ExecutionOperationSchema = z.enum([
  "lock-model",
  "export-model",
  "export-drawings",
  "export-facade-pack",
  "export-template"
]);
export type ExecutionOperation = z.infer<typeof ExecutionOperationSchema>;

export const ExecutionScopeSchema = z.enum([
  "project-state",
  "blender-output",
  "manifest",
  "source-measurements",
  "locked-geometry"
]);
export type ExecutionScope = z.infer<typeof ExecutionScopeSchema>;

export const ExecutionIntentSchema = z.object({
  intentId: z.string().min(1).max(120).regex(/^[a-zA-Z0-9_.-]+$/),
  operation: ExecutionOperationSchema,
  objective: z.string().min(3).max(500),
  writeScope: z.array(ExecutionScopeSchema).min(1),
  forbiddenScope: z.array(ExecutionScopeSchema).min(1),
  selectedToolPath: z.literal("mcp:nova-measured"),
  acceptanceChecks: z.array(z.enum(["schema", "quality-gate", "manifest"])).min(1),
  executionPolicy: z.object({
    locality: z.enum(["local-only", "remote", "hybrid"]),
    telemetry: z.boolean(),
    fallback: z.enum(["none", "local", "remote", "implicit"]),
    geometryMutation: z.boolean()
  }).strict()
}).strict();
export type ExecutionIntent = z.infer<typeof ExecutionIntentSchema>;

export const ExecutionGateResultSchema = z.object({
  ok: z.boolean(),
  intentHash: z.string().length(64),
  blocking: z.array(z.object({
    code: z.enum([
      "intent_operation_mismatch",
      "intent_objective_ambiguous",
      "intent_write_scope_missing",
      "intent_forbidden_scope_missing",
      "intent_scope_conflict",
      "intent_acceptance_check_missing",
      "intent_locality_violation",
      "intent_telemetry_forbidden",
      "intent_fallback_forbidden",
      "intent_geometry_mutation_forbidden"
    ]),
    message: z.string()
  }).strict())
}).strict();
export type ExecutionGateResult = z.infer<typeof ExecutionGateResultSchema>;

export const ExecutionActionEvidenceSchema = z.object({
  intentId: z.string().min(1),
  intentHash: z.string().length(64),
  operation: ExecutionOperationSchema,
  changedArtifacts: z.array(z.string().min(1)).min(1),
  verificationResults: z.array(z.object({
    check: z.string().min(1),
    ok: z.boolean(),
    evidence: z.string().min(1)
  }).strict()).min(1),
  manifestHash: z.string().length(64),
  executionPolicy: z.object({
    locality: z.literal("local-only"),
    telemetry: z.literal(false),
    fallback: z.literal("none"),
    geometryMutation: z.literal(false)
  }).strict()
}).strict();
export type ExecutionActionEvidence = z.infer<typeof ExecutionActionEvidenceSchema>;

const OperationWriteScopes: Record<ExecutionOperation, ExecutionScope[]> = {
  "lock-model": ["project-state", "manifest"],
  "export-model": ["blender-output", "manifest"],
  "export-drawings": ["blender-output", "manifest"],
  "export-facade-pack": ["project-state", "blender-output", "manifest"],
  "export-template": ["project-state", "blender-output", "manifest"]
};
const RequiredForbiddenScopes: ExecutionScope[] = ["source-measurements", "locked-geometry"];
const RequiredAcceptanceChecks = ["schema", "quality-gate", "manifest"] as const;

export function evaluateExecutionIntent(input: unknown, expectedOperation: ExecutionOperation): ExecutionGateResult {
  const intent = ExecutionIntentSchema.parse(input);
  const blocking: ExecutionGateResult["blocking"] = [];
  const writeScope = new Set(intent.writeScope);
  const forbiddenScope = new Set(intent.forbiddenScope);
  const acceptanceChecks = new Set(intent.acceptanceChecks);

  if (intent.operation !== expectedOperation) {
    blocking.push({ code: "intent_operation_mismatch", message: `Intent operation '${intent.operation}' does not authorize '${expectedOperation}'.` });
  }
  if (/^(unknown|unspecified|tbd|ambiguous)$/i.test(intent.objective.trim())) {
    blocking.push({ code: "intent_objective_ambiguous", message: "Execution objective must be explicit and non-ambiguous." });
  }
  for (const scope of OperationWriteScopes[expectedOperation]) {
    if (!writeScope.has(scope)) {
      blocking.push({ code: "intent_write_scope_missing", message: `Execution intent must authorize write scope '${scope}'.` });
    }
  }
  for (const scope of RequiredForbiddenScopes) {
    if (!forbiddenScope.has(scope)) {
      blocking.push({ code: "intent_forbidden_scope_missing", message: `Execution intent must explicitly forbid scope '${scope}'.` });
    }
  }
  for (const scope of writeScope) {
    if (forbiddenScope.has(scope)) {
      blocking.push({ code: "intent_scope_conflict", message: `Scope '${scope}' cannot be both writable and forbidden.` });
    }
  }
  for (const check of RequiredAcceptanceChecks) {
    if (!acceptanceChecks.has(check)) {
      blocking.push({ code: "intent_acceptance_check_missing", message: `Execution intent must require acceptance check '${check}'.` });
    }
  }
  if (intent.executionPolicy.locality !== "local-only") {
    blocking.push({ code: "intent_locality_violation", message: "Measured write execution must remain local-only." });
  }
  if (intent.executionPolicy.telemetry !== false) {
    blocking.push({ code: "intent_telemetry_forbidden", message: "Measured write execution forbids telemetry." });
  }
  if (intent.executionPolicy.fallback !== "none") {
    blocking.push({ code: "intent_fallback_forbidden", message: "Measured write execution forbids hidden fallback." });
  }
  if (intent.executionPolicy.geometryMutation !== false) {
    blocking.push({ code: "intent_geometry_mutation_forbidden", message: "Model-lock and export execution may not mutate geometry." });
  }

  return ExecutionGateResultSchema.parse({
    ok: blocking.length === 0,
    intentHash: hashContract(intent),
    blocking
  });
}

export function buildExecutionActionEvidence(
  intentInput: unknown,
  action: {
    changedArtifacts: string[];
    verificationResults: Array<{ check: string; ok: boolean; evidence: string }>;
    manifest: unknown;
  }
): ExecutionActionEvidence {
  const intent = ExecutionIntentSchema.parse(intentInput);
  return ExecutionActionEvidenceSchema.parse({
    intentId: intent.intentId,
    intentHash: hashContract(intent),
    operation: intent.operation,
    changedArtifacts: [...action.changedArtifacts].sort(),
    verificationResults: [...action.verificationResults].sort((left, right) => left.check.localeCompare(right.check)),
    manifestHash: hashContract(action.manifest),
    executionPolicy: intent.executionPolicy
  });
}

function hashContract(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
