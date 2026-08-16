# UI/UX Contract

## Purpose

Measured by Nova must inherit the NovaChat interaction doctrine: Minimalistic
Utilitarian Elegance, Environment Truth, native-first interfaces, and calm
professional state visibility.

The product may later expose a UI for capture intake, validation, Blender model
review, render preview, and export delivery. That UI must be perceptually
consistent with NovaChat and constitutionally subordinate to Namaka.

## Design Sources

Measured UI must follow:

1. NovaChat MUE whitepaper.
2. NovaChat Environment Truth contract.
3. NovaChat design token semantics.
4. Measured pipeline state and quality gates.

Measured should not invent a separate consumer-style visual language.

## Interface Doctrine

Measured is an instrument-grade professional workspace, not a marketing canvas.

The UI must:

- show capture state
- show validation state
- show Blender execution state
- show model lock state
- show render/export state
- show confidence and provenance
- show local/remote execution truth
- show blockers before visual polish

The UI must not:

- hide uncertainty
- flatten warnings into success
- present preview renders as verified truth
- imply CAD/legal/fabrication authority
- use decorative motion, badges, or attention capture
- let a beautiful render outrank measured evidence

## Information Topology

Measured UI must separate:

| Class | Examples |
| --- | --- |
| System State | project schema, capability manifest, profile type, lock state |
| Execution State | Blender running, render queued, export completed, validation failed |
| Infrastructure State | local Blender path, output directory, local/remote processing, cost class |
| Human Intervention State | missing measurements, review required, lock required, conflict resolution |

No screen should merge these classes without explicit reason.

## Environment Truth Fields

Every execution envelope should be able to expose:

- state
- provider
- model or engine
- endpoint
- execution geography
- owner
- cost class
- latency class
- fallback used
- fallback reason
- primary failure
- data scope
- privacy boundary
- operator approval required
- audit notes

For Measured this usually means:

- `provider`: local Blender, local pipeline, local validation engine
- `executionGeography`: local unless explicitly overridden
- `owner`: user/local runtime
- `costClass`: local compute unless remote processing is explicitly selected
- `dataScope`: project JSON, photos, textures, Blender file, export artifacts

## Visual System

Measured should reuse NovaChat's calm material system where applicable:

- native controls first
- restrained panels
- neutral surfaces
- low-noise depth
- deliberate 100-150 ms motion only for state/spatial transitions
- 8px/4px layout grid
- no more than three visible panels
- no more than five simultaneous visible states

Use visual emphasis only for:

- blocking errors
- required human review
- locality/privacy boundary changes
- model lock state
- export provenance

## Core Workspace Model

The first UI should be a workflow instrument, not a landing page.

Recommended panels:

1. Capture Contract
   - measurements
   - photos
   - materials
   - defects/wear
   - blockers

2. Model Review
   - Blender preview
   - measured overlays
   - confidence and provenance
   - lock action

3. Export / Delivery
   - target outputs
   - manifest
   - technical views
   - photorealistic previews

## Domain UX

Different customer domains may change language and capture checklists, but not
the truth model.

| Domain | UI Focus |
| --- | --- |
| Car dealer | paint, trim, dents, wheels, interior wear, exact dimensions |
| Boat dealer | hull, deck, cabin, fittings, waterline, gelcoat, teak, canvas |
| Real estate | rooms, openings, surfaces, fixed features, light, defects |
| Exterior structure | facades, openings, levels, materials, ground/context |

## Feature Adoption Test

No new visible UI feature may be added unless it passes:

- Functional Worth
- Cognitive Worth
- Sovereignty Worth
- Economic Worth

If it does not help the operator understand truth, act safely, or reduce review
friction, it should not exist.

## UI Definition Of Done

A Measured UI surface is acceptable only when:

- required truth fields are inspectable
- blockers are causal and visible
- preview and verified states are distinct
- local/remote execution is visible
- source measurements and photo evidence remain traceable
- no output can be mistaken for more certain than it is
- visual design remains consistent with NovaChat and MUE

## Executable Surface Contract

`src/uiSurfaceContract.ts` is the machine-readable boundary for the first UI.
It requires exactly three ordered panels and at most five simultaneous visible
states. Every visible state maps to exactly one topology class: system,
execution, infrastructure, or human intervention.

The contract fails closed when blocker causality, operator approval, execution
geography, cost, latency, fallback reason, primary failure, data scope, or
privacy boundary is hidden. If fallback occurred, both its reason and the
primary failure are mandatory.

Technical output is labeled `Verified technical output`. Preview output is
always visibly labeled `Photorealistic preview - not verified truth`, with no
permit or geometry authority. The preview label must appear in a visible
workspace state; it cannot exist only in hidden metadata.

Validation:

```bash
pnpm exec vitest run tests/uiSurfaceContract.test.ts
```

## Executable loopback workspace

`pnpm ui:start` launches the governed surface on `127.0.0.1:4173`. It renders
the three contract panels, visible Environment Truth, output-authority warning,
and an explicit manual hold action. It has no external assets or telemetry,
sets a deny-by-default content security policy, limits mutation bodies, checks
browser origin, exposes discovery at `/api/projects`, and exposes live state at
`/api/workspace?projectId=...`.

Startup without an explicit project is an honest empty state. There is no
implicit project fallback. The configured output root is the only project
authority; discovery lists only schema-valid projects whose real paths remain
inside that root. Each selected workspace re-reads project, validation,
model-lock and render-manifest evidence. Missing, malformed,
identity-mismatched or symlink-escaped state is unavailable rather than
approximated. Preview readiness requires a validated Blender render manifest
bound to the declared render path and remains visibly non-authoritative.

Blender execution and portable delivery readiness are derived from the live
`portable-export-manifest.json` referenced by `project.json`, never from an
earlier tool response. The manifest is bound to the current project id,
model-lock artifact and model hash. Every declared BLEND, GLB, OBJ/MTL, or USDZ
artifact is re-opened, streamed, size-checked and SHA-256 checked before the UI
may show delivery as ready. Missing, malformed, duplicate, unexpected,
symlinked, replaced, or changed-during-validation artifacts fail closed. The
project and manifest writes are atomic; failed evidence persistence removes all
new export artifacts so a retry cannot inherit a partial delivery.
Portable delivery and preview remain independent states: a valid preview never
implies a portable export, and a valid portable export never claims that a
preview exists. The exported BLEND must itself retain the exact model-lock hash.

When the complete delivery chain is ready and no operator hold exists, the
loopback workspace exposes format-scoped download links. The endpoint accepts
only project id plus a declared format, revalidates the entire live evidence
chain, and then re-opens the selected artifact without following symlinks. It
buffers at most 256 MiB, rechecks size and SHA-256, uses a safe attachment
filename/content type, and never accepts a filesystem path from the client.
Unknown, held, oversized, drifted, malformed, or upstream-blocked delivery
requests return a causal machine-readable error without partial bytes.

The same customer surface exposes a source-backed PNG preview and an interactive
offline WebGL viewer only while capture trust, project validation, the current
model lock, and each artifact-specific manifest remain live-valid. Preview UI is
always labelled `Photorealistic preview - not verified truth`; it never inherits
technical, permit, or geometry authority. Viewer requests are restricted to the
fixed manifest-declared package filenames under `/viewer/<projectId>/`, with
network forbidden, telemetry off, fallback none, canonical no-symlink reads,
bounded bytes, content hashes, and a complete gate recheck after every read.
Operator hold removes all customer-viewing links and blocks their endpoints.

The customer surface also exposes a separate public-evidence section only while
the same capture-trust, current-validation, current-model-lock and operator-hold
gates pass. It displays the public category (`Verified`, `Partially Verified`,
`Reference`, or `Disputed`), declared dimensions with unit/source/confidence,
declared material provenance, and explicitly typed known-deviation scopes with
their verified, reference, or disputed status. It does not
publish a combined numeric seller score. Preview pixels never upgrade a
measurement or material claim, and an empty condition list is explicitly not
represented as proof that defects are absent. All displayed values pass strict
bounded schemas and HTML escaping; a disputed live package or operator hold
removes the entire evidence section.

All accepted Environment Truth fields, including data scope and any fallback
cause/primary failure, remain visible. Operator holds are explicit,
project-scoped, atomically persisted with mode `0600`, survive restart, and are
removed only by an explicit `release` decision. Invalid runtime configuration
and occupied-port startup failures terminate with explicit machine-readable
errors; no alternate bind address or port is chosen.

Runtime identity is explicit through `MEASURED_UI_PROVIDER`,
`MEASURED_UI_ENGINE`, `MEASURED_UI_ENDPOINT`, `MEASURED_UI_GEOGRAPHY`,
`MEASURED_UI_OWNER`, `MEASURED_UI_COST`, `MEASURED_UI_LATENCY`, and
`MEASURED_UI_PRIVACY`. Invalid or unknown truth values fail process startup.
`NOVA_MEASURED_OUTPUT_DIR` selects the explicit project root.
The manual override can hold delivery only; it cannot silently approve, lock,
or upgrade an output.
