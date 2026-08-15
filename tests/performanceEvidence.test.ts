import { describe, expect, it } from "vitest";
import { DefaultPerformanceBudget, evaluatePerformanceEvidence, PerformanceEvidenceSchema, PerformanceObservationSchema } from "../src/performanceEvidence.js";

const commit = "a".repeat(40);
const passingObservation = {
  captureValidation: { samples: 50, p95Ms: 2 },
  renderManifest: { samples: 50, p95Ms: 4 },
  packageManifest: { samples: 50, p95Ms: 8 },
  sourceProjectionAlignment: { samples: 50, p95Ms: 3 },
  rssDeltaBytes: 1024,
  packageBytes: 4096,
  blenderRuntimeMs: 120_000
};

describe("performance evidence", () => {
  it("accepts observations within every declared budget", () => {
    const evidence = evaluatePerformanceEvidence(commit, passingObservation);
    expect(evidence.ok).toBe(true);
    expect(evidence.failures).toEqual([]);
    expect(PerformanceEvidenceSchema.parse(evidence)).toEqual(evidence);
  });

  it("reports every exceeded budget causally", () => {
    const evidence = evaluatePerformanceEvidence(commit, {
      ...passingObservation,
      captureValidation: { samples: 50, p95Ms: DefaultPerformanceBudget.captureValidationP95Ms + 1 },
      packageBytes: DefaultPerformanceBudget.maxPackageBytes + 1,
      sourceProjectionAlignment: { samples: 50, p95Ms: DefaultPerformanceBudget.sourceProjectionAlignmentP95Ms + 1 },
      blenderRuntimeMs: DefaultPerformanceBudget.blenderRuntimeMaxMs + 1
    });
    expect(evidence.ok).toBe(false);
    expect(evidence.failures.map((failure) => failure.metric)).toEqual([
      "captureValidationP95Ms",
      "sourceProjectionAlignmentP95Ms",
      "packageBytes",
      "blenderRuntimeMs"
    ]);
  });

  it("rejects invalid commit identity and negative observations", () => {
    expect(() => evaluatePerformanceEvidence("main", passingObservation)).toThrow();
    expect(() => evaluatePerformanceEvidence(commit, { ...passingObservation, rssDeltaBytes: -1 })).toThrow();
    expect(() => PerformanceObservationSchema.parse({
      captureValidation: passingObservation.captureValidation,
      renderManifest: passingObservation.renderManifest,
      packageManifest: passingObservation.packageManifest,
      sourceProjectionAlignment: passingObservation.sourceProjectionAlignment,
      rssDeltaBytes: passingObservation.rssDeltaBytes,
      packageBytes: passingObservation.packageBytes
    })).toThrow();
  });
});
