import { describe, expect, it } from "vitest";
import { buildExecutionActionEvidence, evaluateExecutionIntent, type ExecutionIntent } from "../src/executionGate.js";

function intent(overrides: Partial<ExecutionIntent> = {}): ExecutionIntent {
  return {
    intentId: "intent-export-001",
    operation: "export-model",
    objective: "Export the reviewed model as declared local artifacts",
    writeScope: ["blender-output", "manifest"],
    forbiddenScope: ["source-measurements", "locked-geometry"],
    selectedToolPath: "mcp:nova-measured",
    acceptanceChecks: ["schema", "quality-gate", "manifest"],
    executionPolicy: { locality: "local-only", telemetry: false, fallback: "none", geometryMutation: false },
    ...overrides
  };
}

describe("Namaka/Axiome execution gate", () => {
  it("accepts an explicit local-only export intent", () => {
    const result = evaluateExecutionIntent(intent(), "export-model");

    expect(result.ok).toBe(true);
    expect(result.blocking).toEqual([]);
    expect(result.intentHash).toHaveLength(64);
  });

  it("fails causally when operation and scope do not authorize the action", () => {
    const result = evaluateExecutionIntent(intent({ operation: "lock-model", writeScope: ["project-state"] }), "export-model");

    expect(result.ok).toBe(false);
    expect(result.blocking.map((reason) => reason.code)).toEqual([
      "intent_operation_mismatch",
      "intent_write_scope_missing",
      "intent_write_scope_missing"
    ]);
  });

  it("fails closed on ambiguous intent and incomplete acceptance checks", () => {
    const result = evaluateExecutionIntent(intent({ objective: "TBD", acceptanceChecks: ["schema"] }), "export-model");

    expect(result.blocking.map((reason) => reason.code)).toEqual([
      "intent_objective_ambiguous",
      "intent_acceptance_check_missing",
      "intent_acceptance_check_missing"
    ]);
  });

  it("rejects write/forbidden overlap", () => {
    const result = evaluateExecutionIntent(intent({ forbiddenScope: ["source-measurements", "locked-geometry", "manifest"] }), "export-model");

    expect(result.blocking).toContainEqual({
      code: "intent_scope_conflict",
      message: "Scope 'manifest' cannot be both writable and forbidden."
    });
  });

  it("rejects remote execution, telemetry, fallback, and geometry mutation", () => {
    const result = evaluateExecutionIntent(intent({
      executionPolicy: { locality: "remote", telemetry: true, fallback: "implicit", geometryMutation: true }
    }), "export-model");

    expect(result.blocking.map((reason) => reason.code)).toEqual([
      "intent_locality_violation",
      "intent_telemetry_forbidden",
      "intent_fallback_forbidden",
      "intent_geometry_mutation_forbidden"
    ]);
  });

  it("builds deterministic action evidence with manifest and intent hashes", () => {
    const executionIntent = intent();
    const first = buildExecutionActionEvidence(executionIntent, {
      changedArtifacts: ["exports/model.glb", "exports/manifest.json"],
      verificationResults: [
        { check: "manifest", ok: true, evidence: "Manifest validated." },
        { check: "schema", ok: true, evidence: "Schema validated." }
      ],
      manifest: { outputs: ["exports/model.glb"], geometryMutation: false }
    });
    const second = buildExecutionActionEvidence(executionIntent, {
      changedArtifacts: ["exports/manifest.json", "exports/model.glb"],
      verificationResults: [
        { check: "schema", ok: true, evidence: "Schema validated." },
        { check: "manifest", ok: true, evidence: "Manifest validated." }
      ],
      manifest: { geometryMutation: false, outputs: ["exports/model.glb"] }
    });

    expect(first).toEqual(second);
    expect(first.manifestHash).toHaveLength(64);
    expect(first.executionPolicy).toEqual({ locality: "local-only", telemetry: false, fallback: "none", geometryMutation: false });
  });
});
