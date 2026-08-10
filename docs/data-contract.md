# Measurement Data Contract

## Purpose

The spatial project JSON is the product source of truth. It must be complete enough to regenerate the same real-scale Blender model, material assignments, and export manifests deterministically.

## Authority Order

1. Explicit project dimensions
2. Official drawings or PDFs
3. Manual site measurements
4. Calibrated anchors, when available
5. Structured camera capture metadata
6. Material metadata
7. Reference photos
8. User-declared assumptions

Photos and AI-derived estimates never override measured dimensions.

## Core Project Fields

| Field | Purpose |
| --- | --- |
| `projectId` | Stable project identifier. |
| `unit` | Always `mm` in schema version 1. |
| `photos` | Non-authoritative visual references or validation images. |
| `captureProtocol` | Required camera angles, coverage, lens/focal metadata, and calibration expectations. |
| `materials` | Explicit material, color, PBR, finish, and texture-scale metadata. |
| `dimensions` | Authoritative or manually measured constraints. |
| `planes` | Reference planes for orientation and view generation. |
| `openings` | Doors, windows, and open bays. |
| `steps` | Stair runs with known rise, going, and count. |
| `assumptions` | Explicit assumptions with confidence and geometry impact. |
| `profiles` | Typed parametric project profiles. |
| `elements` | Generated parametric geometry records. |
| `validation` | Deterministic checks and warnings. |
| `modelLock` | Human-review lock required for MVP exports. |
| `sourceOfTruthPolicy` | Non-negotiable accuracy and authority rules. |
| `artifacts` | Generated local output paths. |

## Confidence Semantics

| Confidence | Meaning |
| --- | --- |
| `high` | Permit drawings, official PDFs, known plan dimensions. |
| `medium` | Manual site measurements. |
| `low` | Photo-derived or visually inferred reference details. |

## Assumptions

Assumptions are allowed only when explicit.

```json
{
  "id": "assumption-panel-spacing",
  "text": "Horizontal cladding spacing is visually matched from reference photos.",
  "confidence": "low",
  "source": "photo_reference",
  "affectsGeometry": false
}
```

Rules:

- Low-confidence assumptions may not silently affect measured geometry.
- Geometry-affecting assumptions must be declared before model lock.
- Export packages must include assumption notes when relevant.

## Model Lock

`modelLock` records human approval of the Blender model before export.

```json
{
  "locked": true,
  "lockedAt": "2026-04-30T10:00:00.000Z",
  "lockedBy": "reviewer",
  "reason": "3D model reviewed against measurements and reference photos."
}
```

Exports intended for permit-support use must require `modelLock.locked === true`.

## Capture Contract

Capture contracts define what must be collected before a fixture can become exportable.

Every capture field declares:

| Field | Meaning |
| --- | --- |
| `kind` | `required`, `optional`, or `assumption`. |
| `impact` | `geometry`, `perception`, or `none`. |
| `verification` | `verified`, `missing`, or `assumed`. |

Rule:

```text
impact=geometry requires verification=verified before export.
```

Perception fields may be assumed, but output must label them as reference or assumption.

Validation failures must be machine-readable:

```json
{
  "ok": false,
  "blocking": [
    {
      "id": "width",
      "code": "geometry_not_verified",
      "message": "Geometry-impacting capture fields must be verified before export."
    }
  ],
  "warnings": []
}
```

## Real Capture To Fixture

The minimal real capture pipeline accepts a strict `carport` capture set and converts it into the same `MeasurementProject` contract used by synthetic fixtures.

Rules:

- Geometry-impacting values must be `verified=true`.
- Facade photos are required for `north`, `south`, `east`, and `west`, but remain non-authoritative `low` confidence references.
- The converter must not infer missing geometry.
- The created project remains unlocked; a human review must still run before permit-support export.

Current public fixture:

- `fixtures/real-capture-carport-minimal.json`

## Capability Manifest

Capability manifests define what an export run is allowed to do.

They must declare:

- manifest schema version
- bridge version
- Blender version requirement
- supported templates
- allowed strategies
- prohibited strategies

Prohibited strategies include:

- export-stage geometry reconstruction
- photo-only geometry inference
- CAD claims
- unlocked permit-support export

The capability manifest is an input to each controlled export. Export code must reject unsupported templates, non-allowed strategies, and prohibited strategies before rendering or layout composition.
