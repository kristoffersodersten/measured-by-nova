# Namaka Alignment Contract

## Purpose

Measured by Nova is a Namaka-aligned product surface. It must remain subordinate
to the Namaka constitutional model and to the Axiome Core execution contract.

This document defines the governing boundary for Measured as it evolves from a
carport validation slice into a measured photorealistic digital viewing service.

## Governing Sources

Measured must follow these sources in order:

1. Namaka constitution and machine-readable policy.
2. Axiome Core intent/action and agency contract.
3. NovaChat UI/UX constitution and environment truth model.
4. Measured project contracts, schemas, quality gates, and manifests.
5. Domain-specific templates and rendering presets.

Lower layers may specialize behavior, but may not weaken higher-layer rules.

## Constitutional Invariants

Measured must preserve:

- no hidden remote execution
- no telemetry
- no PII or metadata leakage
- local-first execution by default
- explicit user intent before write-capable action
- visible execution truth
- causal errors
- deterministic output contracts
- no silent fallback
- no hidden geometry inference
- no output claim without provenance

## Axiome Core Boundary

Axiome Core is the constitutional enforcement layer for intent, action, agency,
and evidence.

Measured should treat these concepts as product requirements:

- signed or explicit intent before mutation
- declared write scope
- declared forbidden scope
- action evidence after execution
- intent/action delta analysis
- agency decay or blocking when unauthorized deltas occur
- tutorial events for non-intentional errors
- deterministic takeover or escalation only through declared rules

Measured does not import `axiome-core` as a runtime dependency. The current
local enforcement boundary mirrors the contract in `src/executionGate.ts`,
write-capable input schemas, quality gates, action evidence, manifests, and
tests. A future shared dependency may replace this local owner only when it
preserves the same fail-closed contract.

## Measured Execution Contract

Every write-capable operation should be representable as:

```json
{
  "intent": {
    "objective": "string",
    "writeScope": ["project-state", "blender-output", "manifest"],
    "forbiddenScope": ["source-measurements", "locked-geometry"],
    "selectedToolPath": "mcp:nova-measured",
    "acceptanceChecks": ["schema", "quality-gate", "manifest"]
  },
  "action": {
    "changedArtifacts": [],
    "verificationResults": [],
    "manifestHash": "string"
  }
}
```

This is a product-level contract even before cryptographic signing is added.

## Runtime Enforcement

Model lock and export operations require an `executionIntent` before any
project read, Blender invocation, or artifact write. The intent binds:

- the exact operation and non-ambiguous objective
- required write scopes
- forbidden `source-measurements` and `locked-geometry` scopes
- the selected `mcp:nova-measured` tool path
- schema, quality-gate, and manifest acceptance checks
- `local-only`, no-telemetry, no-fallback, and no-geometry-mutation policy

Rejected intents return `execution_intent_rejected` with deterministic causal
blocking codes. Successful operations emit the accepted intent and action
evidence containing sorted changed artifacts, verification results, an intent
hash, and a manifest hash. Action evidence is execution provenance; it never
becomes geometry or capture authority.

## Data Sovereignty

Measured handles high-trust capture data: vehicles, boats, homes, customer
assets, defects, wear, location context, and potentially private interiors.

Rules:

- raw photos stay local unless the user explicitly exports them
- customer examples stay out of public git
- generated renders stay out of public git by default
- manifests should use stable references, not unnecessary PII
- logs must not contain raw private metadata when a hash or local reference is
  sufficient
- remote or cloud processing is forbidden unless explicitly permitted for that
  project

## Truth Boundary

Measured must never confuse these layers:

| Layer | Authority |
| --- | --- |
| Capture | Provides measured facts and visual evidence. |
| Contract | Determines what is verified, blocked, or assumed. |
| Blender | Holds reviewed renderable geometry. |
| Export | Packages locked artifacts. |
| UI | Reveals state, confidence, locality, and required intervention. |
| LLM | Optional orchestrator, never authority. |

## Failure Behavior

Measured should fail closed when:

- intent is ambiguous
- write scope is unclear
- geometry-impacting input is unverified
- material/condition claim lacks evidence
- Blender output is unlocked
- export tries to mutate geometry
- fallback would cross locality or privacy boundaries
- output confidence cannot be explained

Failure must return machine-readable codes and human-readable causal messages.

## Product Consequence

Measured can become commercially useful only if trust is architectural:

- buyers must trust that defects are not hidden
- sellers must trust that outputs do not overclaim
- operators must trust that private capture data stays sovereign
- downstream viewers must trust that dimensions trace to measurements

The product should feel premium because it is exact, calm, inspectable, and
truthful.
