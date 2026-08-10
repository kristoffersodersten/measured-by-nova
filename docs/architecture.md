# Architecture

## System Purpose

Measured by Nova reconstructs physical objects into deterministic, real-scale Blender geometry from exact measurements, structured multi-angle photography, spatial constraints, and material metadata.

It is not a CAD kernel. It is a spatial reconstruction framework with measurement-driven geometry, photogrammetry-assisted alignment, PBR material capture, and export pipelines for visualization, real-time engines, AR/spatial computing, and permit-support documentation.

## Layer Contract

| Layer | Responsibility | Authority |
| --- | --- | --- |
| MCP client | User interaction and orchestration. | Never authoritative. |
| TypeScript MCP server | Input validation, project state, tool contracts, quality gates. | Contract authority. |
| Spatial project JSON | Measurements, capture metadata, materials, constraints, validation state. | Data authority. |
| Measurement engine | Dimension constraints to base parametric mesh. | Geometry constraint authority. |
| Photo alignment engine | Camera pose and visual evidence alignment. | Evidence authority, never dimensional authority. |
| Blender bridge | Geometry generation, mesh refinement, material assignment, rendering. | Renderable geometry authority. |
| Export pipelines | Blender, glTF/USD/WebGL/Unreal/AR outputs, layout, labels, metadata. | Packaging authority. |

## Pipeline

```text
capture_protocol
  -> input_validation
  -> measurement_modeling
  -> base_parametric_geometry
  -> camera_pose_alignment
  -> geometry_constraint_solving
  -> mesh_refinement
  -> pbr_material_assignment
  -> texture_projection
  -> human_review
  -> model_lock
  -> render_and_export
```

## Non-Negotiable Rules

- Measurements are the primary source of truth.
- Reference photos are secondary evidence for alignment, texture, material, and validation unless calibrated.
- Blender geometry is the only renderable truth.
- Export pipelines must not reconstruct, infer, or mutate geometry after model lock.
- The LLM may orchestrate, but it may not decide geometry truth.
- Missing data must create warnings or failures, not guesses.

## Determinism

The same project JSON plus the same reconstruction engine and Blender bridge version should produce the same geometry, material assignments, and artifact manifest within declared renderer tolerances.

Deterministic behavior depends on:

- Strict Zod schemas
- Relative output paths constrained to `BLENDER_OUTPUT_DIR`
- Explicit confidence semantics
- Explicit assumptions
- Explicit capture protocol and camera metadata
- Explicit material metadata
- Model lock before permit-support export
- No hidden remote service calls

## Extension Points

Open-core extension points:

- New typed profiles
- New validation checks
- New generic export templates
- New reference photo metadata
- New capture protocols
- New PBR material profiles
- New real-time export targets

Commercial/private extension points:

- Municipality-specific templates
- Guided UX
- Checklist flows
- Paid QA automation
- Batch/customer workflows

## Capability-Gated Export

Export behavior is constrained by a capability manifest.

The capability manifest defines:

- supported templates
- allowed generation/render/export strategies
- prohibited strategies
- manifest schema version
- bridge version
- Blender minimum version

Permit-support exports must not run strategies that conflict with the manifest. In particular, export-stage geometry reconstruction and CAD claims are prohibited.

## Fixture Matrix

The fixture matrix verifies product behavior across expected pass/fail cases.

Capture contract defines what is required. Fixture matrix verifies that requirements are enforced. Capability manifest defines what the runtime may do.
