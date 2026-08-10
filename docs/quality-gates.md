# Quality Gates

## Purpose

Quality gates prevent Measured by Nova from exporting permit-support documents that imply more certainty than the project data supports.

## Required MVP Gates

| Gate | Requirement |
| --- | --- |
| Measurement authority | At least one known dimension or typed profile exists. |
| Reference coverage | Facade references exist for north, south, east, and west. |
| Assumption safety | Low-confidence assumptions must not affect geometry. |
| Validation | `validation.ok` must be true. |
| Model lock | A human-reviewed `modelLock` is required before facade export. |
| Export source | Exports must use Blender orthographic views as geometry source. |
| PDF stage | PDF/layout code must not reconstruct or mutate geometry. |
| Boundary statement | Output must state that it is not CAD/BIM/DWG/STEP. |

## Export Rules

`export_facade_completion_pack` is the primary MVP export path.

It must fail if:

- The model is not locked.
- Project validation is failing.
- Required facade references are missing.
- Any low-confidence assumption affects geometry.

Every failure must include a machine-readable blocking reason:

```json
{
  "code": "facade_reference_missing",
  "message": "Missing facade reference labels for: west."
}
```

Public tools may also expose these reasons under `error.details.blocking` so UI and capture workflows can show the exact missing input.

Legacy exports may remain for development, but public product flows should use `export_facade_completion_pack`.

## Test Strategy

Minimum tests:

- Contract tests for required fields and unknown-field rejection.
- Export schema tests for four required facade views.
- Model-lock tests for default unlocked state.
- Golden fixture test for deterministic project JSON and quality gate behavior.
- Golden manifest test across repeated Blender exports with identical input and capability manifest.
- Bridge tests for orthographic view artifact names.

Current public fixture:

- `fixtures/synthetic-carport-project.json`
- `fixtures/real-capture-carport-minimal.json`

Current fixture matrix:

- `fixtures/fixture-matrix.json`

The matrix covers valid and invalid cases. Each case declares `expected.ok` and a human-readable reason so tests verify behavior, not only structure.
