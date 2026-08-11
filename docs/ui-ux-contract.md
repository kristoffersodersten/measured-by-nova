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
