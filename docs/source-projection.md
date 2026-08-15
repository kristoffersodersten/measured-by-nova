# Local Source Projection

`align_and_project_source_photo` is the deterministic local-first boundary for
planar photo alignment and Blender texture projection. It consumes an exact
project model-lock artifact, a content-addressed source image, a measured planar target and
at least four explicit operator anchors.

The operation computes a normalized planar homography from target millimetres
to source-image UV coordinates. It fails closed when anchors are degenerate,
outside their declared domains, above the reprojection RMSE budget or below the
minimum inlier ratio. Anchor uncertainty is preserved in the content-addressed
alignment manifest; it is never converted into geometry confidence.

## Authority boundary

- Measurements and locked Blender geometry remain geometry authority.
- The requested source blend must equal the project's model-lock artifact and pass current source-project and artifact-hash validation.
- The verified source image bytes are packed into the derived blend so later source-file drift cannot change the recorded projection.
- All selected target polygons must occupy one coplanar surface with non-zero bounds.
- Alignment and projection are visual evidence only.
- The source `.blend` is never overwritten.
- Blender duplicates the target mesh, preserves every vertex coordinate and
  applies a dedicated UV layer/material to the copy.
- The derived blend is written only after a temporary save/reopen round trip
  proves that UV, material, source identity and geometry hashes persisted.
- No remote provider, telemetry or implicit fallback is used by the product.
  Heavy verification belongs on the explicitly selected Hetzner/GitHub worker.

## Input example

```json
{
  "schemaVersion": 1,
  "projectId": "facade-proof",
  "sourceBlendPath": "measurement-projects/facade-proof/artifacts/facade-proof.blend",
  "outputBlendPath": "projections/facade-proof.projected.blend",
  "outputReportPath": "projections/facade-proof.report.json",
  "sourcePhoto": {
    "path": "photos/facade.png",
    "sizeBytes": 310,
    "sha256": "<64 lowercase hex characters>",
    "pixelWidth": 100,
    "pixelHeight": 100
  },
  "target": {
    "hostElementId": "Facade",
    "face": "front",
    "widthMm": 1000,
    "heightMm": 500,
    "dimensionToleranceMm": 2
  },
  "anchors": [
    { "id": "bottom-left", "sourcePx": { "x": 10, "y": 90 }, "targetMm": { "x": 0, "y": 0 }, "uncertaintyPx": 0.25 },
    { "id": "bottom-right", "sourcePx": { "x": 90, "y": 90 }, "targetMm": { "x": 1000, "y": 0 }, "uncertaintyPx": 0.25 },
    { "id": "top-right", "sourcePx": { "x": 90, "y": 10 }, "targetMm": { "x": 1000, "y": 500 }, "uncertaintyPx": 0.5 },
    { "id": "top-left", "sourcePx": { "x": 10, "y": 10 }, "targetMm": { "x": 0, "y": 500 }, "uncertaintyPx": 0.5 }
  ],
  "thresholds": { "inlierErrorPx": 0.5, "maxRmsePx": 0.5, "minInlierRatio": 1 }
}
```

Successful output binds the homography, exact photo identity, anchor
uncertainty, quality observations, target host/face, UV range, geometry hashes,
derived blend and Blender execution report. Existing output paths are never
overwritten. Failed execution removes partial final outputs and exposes a
causal machine-readable error.

Validation:

```bash
pnpm exec vitest run tests/sourceProjection.test.ts tests/sourceProjection.integration.test.ts
```
