# Measured by Nova MVP

## Product Promise

Measured by Nova turns verified real-world measurements, structured photos, spatial constraints, and material metadata into traceable, physically accurate 3D models and render/export packages.

It does not promise CAD, BIM, legal survey accuracy, construction engineering, or guaranteed municipal approval.

## MVP Positioning

Measured by Nova is a spatial reconstruction framework. The first MVP is a deliberately narrow validation slice for small exterior building projects.

Primary message:

```text
Measure. Capture. Reconstruct. Render.
```

Public wording:

```text
Measured by Nova reconstructs real physical objects from exact measurements,
structured photo capture, spatial constraints, and material metadata. The system
builds a traceable 1:1 Blender model, applies verified visual/material evidence,
and exports photorealistic or documentation-oriented artifacts without CAD claims
or AI guessing.
```

## First Narrow Use Case

The MVP targets facade-completion packages for small exterior projects because they provide a constrained way to prove the wider spatial reconstruction architecture.

Initial project types:

- Carport
- Shed
- Deck or terrace
- Small extension-like structures with simple facades

First production template:

- `gothenburg-permit`

Generalized template family:

- `swedish-municipality`
- `permit-facade-pack`

## Source-Of-Truth Contract

| Layer | Authority |
| --- | --- |
| Measurements | Primary source of truth for geometry. |
| Drawings / official PDFs | High-confidence measurement input. |
| Manual site measurements | Medium-confidence measurement input. |
| Structured photos | Camera-pose, texture, material, and validation evidence; dimensional only when calibrated. |
| Material metadata | PBR/material source of truth when explicitly provided. |
| Blender geometry | Only renderable geometry truth. |
| Blender orthographic views | Only geometry source for permit-support exports. |
| Render/export engines | Formatting, rendering, optimization, packaging; no geometry inference after lock. |
| LLM | Optional orchestration only; never authoritative. |

Hard rules:

- Do not infer missing geometry during export.
- Do not reconstruct geometry from PDF/layout code.
- Do not claim CAD output.
- Do not claim approval guarantee.
- Every exported line should be traceable to measurement input, modeled geometry, or explicitly labeled low-confidence reference context.

## User Responsibility

The user is responsible for:

- Supplying correct measurements.
- Supplying representative photos.
- Reviewing the 3D model before export.
- Submitting and validating material against local municipal requirements.

Measured by Nova is responsible for:

- Preserving measurement confidence.
- Generating deterministic geometry from explicit inputs.
- Rendering locked orthographic views from Blender geometry.
- Producing traceable permit-support documentation.
- Declaring assumptions and low-confidence details.

## MVP Workflow

1. Create project
2. Import structured multi-angle photos
3. Enter measurements and confidence levels
4. Add material metadata
5. Select project profile
6. Generate base parametric model
7. Align photo evidence to geometry
8. Apply material/texture evidence where available
9. Human review and correction of 3D model
10. Lock approved model
11. Generate photorealistic renders and/or orthographic views in Blender
12. Export target package and confidence report

## MVP Inputs

Required:

- Project type
- Width, depth, and key heights
- Ground/foundation heights where visible
- Openings and facade side labels
- Material and color notes
- At least one reference photo per relevant facade

Optional:

- Existing permit drawing or PDF
- Boundary distances
- Stairs and level changes
- NCS color codes
- Property and applicant metadata

## MVP Outputs

Minimum export package:

- A3 PDF facade pack
- North, south, east, and west facade views
- Scale label
- Title block
- Material and color notes
- Measurement list
- Confidence legend
- Assumption and limitation notes

Optional export package:

- `.blend`
- `.glb`
- `.obj`
- future USD/WebGL/real-time engine package
- PNG/SVG orthographic views
- Project JSON
- Validation report

## Acceptance Criteria

The MVP is acceptable only when all are true:

- The 3D model is approved before drawing export.
- `lock_model_for_export` has been run after human review.
- All facade drawings are generated from Blender orthographic views.
- The PDF layer does not reconstruct or alter geometry.
- The output states that it is not CAD/BIM/DWG/STEP.
- Photos are labeled as reference unless calibrated.
- Known dimensions override visual estimates.
- Missing measurements produce warnings, not guesses.
- Low-confidence assumptions do not affect geometry unless resolved before lock.
- `pnpm lint`, `pnpm test`, and `pnpm build` pass.

## Non-Goals

- CAD-kernel modeling
- DWG/STEP output
- Structural calculations
- Automated municipal approval
- AI-based geometry guessing
- Photogrammetry without calibration
- Full BIM object modeling

## Commercial Boundary

Suggested open-core split:

| Public/Open Core | Private/Paid Product |
| --- | --- |
| MCP core | Municipality-specific templates |
| Measurement project schema | PDF styling and QA workflows |
| Blender bridge basics | User-facing UX |
| Generic profiles | Guided intake/checklist flows |
| Example fixtures | Batch export and customer workflow |

First paid package:

```text
Facade Completion Pack
Input: measurements, photos, project metadata.
Output: four facade views, title block, material notes, measurement list, and confidence report.
```
