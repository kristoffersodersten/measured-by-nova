# Spatial Reconstruction Pipeline

## Goal

Measured by Nova should reconstruct a physically accurate 3D object from:

- exact dimensional measurements with millimeter-level intent
- structured multi-angle photography with full object coverage
- material metadata suitable for PBR rendering
- spatial constraints such as planes, edges, anchors, openings, levels, radii, and relationships

The output is a real-scale 1:1 model that can be edited, rendered, validated,
and exported to downstream visualization and spatial computing runtimes.

The commercial target is high-trust digital viewing: a buyer, broker, dealer,
operator, or reviewer should be able to inspect scale, material quality, visible
wear, defects, and spatial feeling without the system hiding uncertainty or
inventing flattering detail.

## Target Outputs

| Target | Purpose |
| --- | --- |
| Blender | Authoritative local geometry, refinement, rendering, and review. |
| glTF / GLB | Web and real-time portable asset. |
| USD / USDZ | Apple spatial and AR-oriented delivery path. |
| Unreal Engine | High-fidelity real-time visualization. |
| WebGL | Browser preview, spatial commerce, and lightweight inspection. |
| PDF / image package | Documentation, permit-support, comparison, and review artifacts. |
| Material/condition report | Evidence-backed quality, wear, and defect description. |

## Pipeline

```text
capture_protocol
  -> measurement_ingestion
  -> material_ingestion
  -> base_parametric_mesh
  -> camera_pose_estimation
  -> measurement_constraint_solving
  -> photo_alignment
  -> mesh_refinement
  -> texture_projection
  -> pbr_material_authoring
  -> lighting_and_render_setup
  -> human_review
  -> model_lock
  -> target_export
```

## Components

### Measurement Engine

Converts exact dimensions into base geometry.

Inputs include:

- length, width, height
- angles, slopes, offsets
- radii and thicknesses
- known anchor points
- tolerances and confidence levels

Rules:

- Exact measurements override photos.
- Missing geometry blocks export or becomes an explicit assumption.
- Geometry-affecting assumptions must be visible before model lock.

### Photo Alignment Engine

Aligns structured photos to the measured geometry.

Inputs include:

- required 360-degree coverage
- camera position labels
- focal length/lens metadata when available
- calibration markers or known anchors when available
- image quality and occlusion metadata

Responsibilities:

- camera pose estimation
- feature matching
- anchor alignment
- visual residual reporting
- texture projection evidence

Photos provide evidence. They do not silently change measured dimensions.

### Geometry Constraint Layer

Forces generated geometry to remain metrically correct.

Responsibilities:

- solve dimensional constraints
- detect contradictions between measurements and photo alignment
- keep parametric geometry editable
- produce machine-readable blocking errors and warnings

### Texture Projection Layer

Projects visual evidence onto measured geometry.

Responsibilities:

- map calibrated photos to surfaces
- preserve source image references
- flag low-confidence or occluded regions
- avoid creating false geometry from texture cues

### Condition Evidence Layer

Captures visible quality, wear, damage, repairs, and imperfections.

Responsibilities:

- store scratch, dent, stain, crack, fading, oxidation, patina, seam, and repair
  annotations
- preserve source photo references
- distinguish visible evidence from user notes
- prevent condition claims without provenance
- surface occluded or unverified areas before model lock

### PBR Material System

Stores physically meaningful material metadata.

Material records should support:

- base color or color system reference
- roughness
- metallic
- specular/reflectance
- transparency
- normal/bump source
- texture scale
- provenance and confidence

Materials must support both truthful rendering and trust reporting. A render may
look photorealistic only when the material and texture sources explain why.

### Render Pipeline

Produces review and delivery artifacts.

Responsibilities:

- scene lighting
- calibrated camera views
- photorealistic render presets
- orthographic technical views
- turntable/orbit previews
- export manifests

Photorealistic renders are review and sales artifacts generated from the locked
model. They are not allowed to alter geometry or upgrade low-confidence material
or condition claims.

## Capture Protocol

Minimum generalized capture protocol:

- front, back, left, right
- four diagonal views
- top/down or elevated views when possible
- close-ups for material, edges, seams, handles, joints, damage, and texture
- close-ups for defects, wear, repairs, patina, paint/gelcoat/fabric/leather,
  trim, fittings, and high-value inspection points
- at least one known scale object or measured anchor per capture set when calibration is needed
- stable lighting, low motion blur, no heavy lens distortion

Capture records must declare:

- camera/view label
- object side or sector
- distance band
- focal metadata when known
- whether calibration anchors are visible
- whether the photo is used for geometry, material, validation, or context
- whether the photo is used for condition evidence or defect documentation

## Error Correction

Contradictions must be explicit.

Examples:

- photo alignment suggests a width that conflicts with measured width
- material photo lacks scale reference
- 360 coverage is incomplete
- required geometry-affecting field is missing
- texture projection covers only part of a surface
- condition or damage is claimed but not visible in any source
- photorealistic preview appears to hide a known defect

Resolution paths:

- accept measured value
- add corrected measurement
- add calibration anchor
- mark area as low-confidence visual reference
- block export until resolved

## Domain Targets

The same source-of-truth model supports multiple commercial domains.

| Domain | Required Truth Focus |
| --- | --- |
| Car dealer | exact dimensions, paint, trim, glass, wheels, dents, scratches, interior wear |
| Boat dealer | LOA, beam, draft, hull, deck, cabin, gelcoat, teak, fittings, waterline wear |
| Real estate | room/facade dimensions, openings, fixed features, surfaces, light, defects |
| Exterior structures | facades, levels, openings, stairs, cladding, roof, foundation, ground context |

Domain profiles add capture requirements. They do not change the global
measurement-first rule.

## MVP Slice

The current public MVP is a facade/carport reconstruction slice.

It proves:

- measurement-to-base-mesh generation
- structured photo reference handling
- material and facade metadata
- locked Blender geometry
- orthographic and permit-support export

It is not the full product boundary. The full product direction is object-agnostic spatial reconstruction for properties, vehicles, boats, consumer products, spatial commerce, and virtual walkthroughs.

The next product slice should prove the broader digital viewing pipeline on one
vehicle, boat, or property capture package while preserving the same quality
gates learned from the carport case.

## Automation

Automation runs locally by default:

- TypeScript MCP server validates contracts and state.
- Python/Blender bridge generates, refines, renders, and exports geometry.
- Future OpenCV/COLMAP integration may provide local feature matching, camera pose estimation, and texture projection.
- Export steps produce deterministic manifests and never mutate locked geometry.
