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
| `viewRegistry` | Deterministic named orthographic cameras used by facade exports. |
| `sourceOfTruthPolicy` | Non-negotiable accuracy and authority rules. |
| `artifacts` | Generated local output paths. |

## Material Metadata

Each `materialNotes` entry targets at least one facade or element and records
material identity, provenance, confidence, and verification. `colorReference`
is optional and carries a structured `standard` (`NCS`, `RAL`, `manufacturer`,
or `custom`), `code`, and optional label.

Permit metadata includes only scope, material/color evidence, provenance,
confidence, and verification. Optional `pbrPreview` values are a separate
preview-only namespace with `previewOnly: true` and
`geometryAuthority: false`; permit serialization strips that namespace. PBR
values can therefore drive appearance without changing measured geometry or
becoming permit truth.

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
  "reason": "3D model reviewed against measurements and reference photos.",
  "modelArtifact": "measurement-projects/example/artifacts/example.blend",
  "modelHash": "<sha256 of reviewed Blender file>",
  "sourceProjectHash": "<sha256 of canonical project source state>"
}
```

Permit-support exports require the complete lock and recompute both hashes before
Blender runs. A changed or missing Blender file and any changed project source
state fail closed with machine-readable lock errors. Export manifests include
the complete lock metadata.

## Orthographic View Registry

`viewRegistry` persists each named `plan`, `north`, `south`, `east`, `west`, or
`section_a_a` camera with its transform, target, up vector, orthographic scale,
clipping range, and `MeasuredGeometry` target collection. Definitions are
canonically ordered and bound by `registryHash`. Facade export requires all four
cardinal views and rejects missing or changed registry data before Blender runs.

Facade line extraction is performed only by Blender Freestyle from registry
cameras. PNG files are the rendered line artifacts. The SVG is a layout-only
index referencing those PNGs, and the PDF contains layout/metadata only; neither
may project, reconstruct, or hide geometry. The export manifest records the
strategy, a declared pixel-difference tolerance, and SHA-256 identity for every
created artifact. PNG identity hashes only critical image chunks (`IHDR`,
`PLTE`, `IDAT`, `IEND`) so Blender timestamp metadata cannot create false visual
drift; other artifacts hash the complete file.

Model-lock and export requests also carry the execution contract defined in
`docs/namaka-alignment.md`. Successful results include deterministic
intent/action evidence. This evidence records authorized scope, verification,
and changed artifacts but may not alter measurements, locked geometry, or
capture provenance.

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

The real capture pipeline accepts the strict version-2 `carport` capture set and
converts it into the same `MeasurementProject` contract used by synthetic
fixtures.

Rules:

- Geometry-impacting values, including every supplied foundation level, step run,
  and neighbor-boundary distance, must be `verified=true`.
- Facade photos are required for `north`, `south`, `east`, and `west`; their
  declared confidence is preserved while their role remains non-authoritative.
- At least one material/color note is required. Its facade, confidence,
  provenance, verification state, and optional color note are preserved in the
  project fixture without making it geometry authority.
- Step confidence and assumptions are preserved in the project fixture.
- North/south/east/west base and top levels are explicit measured fields.
- Openings carry measured bounds, host, facade, type, provenance, confidence,
  and verification state.
- Posts and bars carry measured bounds plus an explicit
  `structural`/`decorative` role; directional step runs carry facade and
  direction.
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
