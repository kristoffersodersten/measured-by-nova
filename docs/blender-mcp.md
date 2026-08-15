# Measured by Nova Operation Guide

## Description

Measured by Nova is a local, LLM-agnostic Model Context Protocol server that lets any MCP client create Blender assets through deterministic tool contracts. Its primary production workflow is measurement-driven visualization: drawings, known dimensions, manually measured constraints, and typed parametric profiles become reproducible Blender geometry.

Technical package name: `nova-measured`.
Git repository name: `measured-by-nova`.

The server invokes Blender in background mode and runs a small Python bridge script. Tool inputs are validated in TypeScript before execution, and generated `.blend` files are written to the configured output directory.

Blender execution is split by owner:

- `blender/bridge.py` dispatches validated MCP operations.
- `blender/digital_viewing.py` applies digital-viewing PBR materials, texture
  maps, condition overlays, cameras, lighting, and render manifest writeback.

## Product And Accuracy Boundary

Measured is not CAD, BIM, DWG/STEP export, legal surveying, or a fabrication tolerance system. It is a measured 3D visualization and permit-support documentation engine.

Architecture contract:

- Measurements are the primary source of truth.
- Reference images are secondary and non-authoritative unless calibrated anchors are provided.
- Blender geometry is the only renderable truth.
- Blender orthographic views are the single source of truth for exported facade drawings.
- Export stages are pure formatting: layout, labels, scale bars, metadata, and PDF/SVG/PNG composition only.
- No geometry reconstruction, AI guessing, or missing-geometry inference is allowed during export.
- The LLM is an optional orchestration layer and is never authoritative.

## Architecture

```text
MCP client
  -> stdio transport
  -> TypeScript MCP server
  -> validated tool contract
  -> measurement project JSON
  -> local Blender process
  -> blender/bridge.py
  -> .blend / GLB / OBJ / visualization and permit-support artifacts
```

## Execution Boundary

| Boundary | Value |
| --- | --- |
| Transport | MCP stdio |
| Compute location | Local machine |
| Blender mode | Background process |
| Output | Local project JSON, `.blend`, `.glb`, `.obj`, orthographic image, and PDF artifacts |
| Network usage | None by design |
| Telemetry | None |

## Measurement Project Model

Project state is stored under:

```text
<BLENDER_OUTPUT_DIR>/measurement-projects/<projectId>/project.json
```

Every public measurement tool returns:

```json
{
  "ok": true,
  "requestId": "uuid",
  "data": {},
  "warnings": []
}
```

Confidence values are part of the contract:

| Confidence | Meaning |
| --- | --- |
| `high` | Permit drawings, official PDFs, known plan dimensions. |
| `medium` | Manual site measurements. |
| `low` | Photo-derived or visually inferred reference details. |

Known dimensions override visual estimates. Non-calibrated photos are never treated as exact geometry.

Every new project carries this source-of-truth policy:

```json
{
  "measurementModel": "explicit_measurements_and_constraints",
  "photos": "non_authoritative_reference_only",
  "blenderGeometry": "only_renderable_geometry_truth",
  "exportStage": "formatting_only_no_geometry_reconstruction",
  "llmRole": "optional_orchestration_never_authoritative",
  "nonGoal": "not_cad_not_bim_not_survey"
}
```

## Measurement Tools

| Tool | Purpose |
| --- | --- |
| `create_measurement_project` | Creates an empty measurement project. |
| `import_reference_photos` | Stores photos as low-confidence references or validation inputs. |
| `define_known_dimension` | Adds an authoritative or measured dimension constraint. |
| `define_reference_plane` | Adds a measured or inferred alignment plane. |
| `align_and_project_source_photo` | Computes a deterministic anchor-backed planar homography and applies the exact photo to a geometry-preserving Blender copy. |
| `define_opening` | Adds a door, window, or open bay constraint. |
| `define_step_run` | Adds stair runs using known rise, going, and count. |
| `define_assumption` | Records explicit assumptions with confidence and geometry impact. |
| `create_parametric_profile` | Adds a reusable structure profile such as `carport`. |
| `generate_measured_model` | Builds deterministic Blender visualization geometry from project state. |
| `validate_model` | Checks known dimensions and confidence rules. |
| `lock_model_for_export` | Locks a human-reviewed model before permit-support export. |
| `generate_elevation_views` | Creates plan, elevation, and section cameras/views. |
| `export_model` | Exports validated `.blend`, `.glb`, and/or `.obj` artifacts only from the exact current model-lock source and binds every artifact by size and SHA-256. |
| `export_dimensioned_drawings` | Creates a permit-support visualization PDF artifact. |
| `export_facade_completion_pack` | Exports the MVP facade-completion package from a locked model. |
| `export_project_template` | Creates recipient-specific export packages from unchanged source geometry and unchanged Blender orthographic views. |
| `list_digital_viewing_capture_presets` | Lists domain capture requirements for vehicle, boat, property, and exterior-structure digital viewing. |
| `get_digital_viewing_capture_preset` | Returns the capture contract for one asset type and delivery tier. |
| `get_digital_viewing_capture_guide` | Returns deterministic shot lists plus machine-readable measurement, material, and inspection checklists. |
| `validate_digital_viewing_capture_preset` | Checks capture completeness before Blender rendering or model generation. |
| `list_digital_viewing_delivery_profiles` | Lists customer-surface package profiles such as sales listing, showroom, broker preview, and permit support. |
| `get_digital_viewing_delivery_profile` | Returns the required and optional package targets for one customer-facing delivery surface. |
| `evaluate_digital_viewing_delivery_profile` | Checks whether a capture declares the required output targets for a customer-facing package profile. |
| `render_digital_viewing_preview` | Renders a photorealistic preview from a locked Blender source using a deterministic render manifest. |
| `generate_digital_viewing_material_authoring_plan` | Generates deterministic PBR texture-map requirements per material before Blender rendering. |
| `generate_digital_viewing_material_report` | Generates a deterministic material and condition evidence report from capture data and optional Blender execution metadata. |
| `generate_digital_viewing_asset_bundle_manifest` | Generates a deterministic pre-render file-readiness manifest for required photo, texture, and expected render assets without starting Blender. |
| `generate_digital_viewing_delivery_package` | Generates a deterministic delivery-package manifest that indexes validated render, material authoring, report artifacts, and explicitly requested customer delivery targets. |

The digital-viewing preset tools are intake gates. They describe and validate
what photos, measurements, material records, texture evidence, and condition
evidence are required for a delivery tier. Premium presets may also require
verified inspection zones, such as body, glass, wheels/tires, and interior for
vehicle sales output. They do not create geometry or infer missing evidence.
For premium photoreal output, the Blender execution metadata must prove that
every verified geometry measurement was applied with its declared `value`,
`unit`, optional `tolerance`, and `sourceOfTruth:
declared-measurement-value-used-by-blender`. Delivery-package quality gates
block when Blender reports only an anchor id without the declared numeric value.
For premium captures, preset validation also checks the photo capture metadata
against the guide: angle type, camera mode, yaw tolerance, numeric `pitchDeg`
for orthogonal level reference shots, `focalLength35mmEquivalent` and
`cameraDistanceMm` for orthogonal full-object reference shots, coverage,
occlusion, and measured endpoint visibility must match the selected domain
preset before rendering can proceed.
Premium delivery readiness also requires verified condition evidence to bind
visible defects or wear to a declared `materialSurface` from a source-backed
material record. This keeps condition rendering tied to the correct finish
instead of a generic host object.
When validation fails, the response includes the same capture `guide` alongside
blocking reasons. UI clients can therefore show the missing sectors,
measurement requirements, material requirements, and inspection checklist items
without asking an LLM to reinterpret the preset.
Validation failures also include a `repairSummary` that groups blocking reasons
into deterministic UI sections: measurements, photos, materials, inspections,
conditions, and outputs. This is intentionally a routing aid only; it does not
weaken or rewrite the underlying blocking reasons.

`get_digital_viewing_capture_guide` is the operator-facing capture contract. It
turns a preset into a shot list before photos are taken: sectors, roles, anchor
recommendations, material focus, condition focus, and texture-evidence guidance.
Each shot also carries machine-readable capture requirements for camera mode,
angle type, yaw target/tolerance, pitch guidance, lens guidance, coverage,
occlusion policy, endpoint visibility, and texture-evidence needs.
The guide also exposes checklist arrays for UI clients: `measurementChecklist`
for geometry-authoritative measurements, `materialChecklist` for PBR evidence
requirements, and `inspectionChecklist` for required premium inspection zones.
Inspection checklist items include `conditionCaptureQualityProfile`, allowing
clients to show macro/detail, resolution, placement, material-surface binding,
and medium/high severity metadata requirements before photos are taken.
Each material checklist item also includes `materialSurfaces`, a deterministic
domain surface list such as vehicle body panels, boat hull/deck, property
windows/masonry, or exterior cladding/foundation/stairs. These lists tell a
capture operator what to photograph for material feel without letting photos
become geometry authority.
For `premium-sales`, preset readiness treats those surfaces as mandatory
material evidence: every listed surface must be present in a material record and
backed by verified source photos, or rendering is blocked with
`required_material_surface_missing`.
When a premium material source photo, texture-map source photo, or material
surface-mapping source photo declares `materialCategories`, the declared
categories must include the material category it evidences, textures, or maps;
otherwise the photo is treated as invalid material evidence and material
authoring/rendering are blocked before Blender can trust or place that material.
Each material checklist item also declares a `captureQualityProfile`. Premium
capture blocks with `material_capture_quality_missing` when verified material
surface evidence lacks blocking profile metadata such as suitable coverage,
non-occlusion, `whiteBalanceKelvin`, or `exposureEv`. Advisory profile entries
such as reflection angle or raking light guide capture operators without mutating
geometry or creating hidden renderer assumptions.
It exists so capture quality is designed up front instead of repaired later in
Blender.
Premium `site-reference` lighting follows the same rule. The render manifest
requires the declared lighting reference photo to include `lightingReference`,
`colorReference`, `whiteBalanceKelvin`, and `exposureEv`; otherwise Blender
rendering is blocked instead of guessing illumination from a generic preset.

`generate_digital_viewing_material_authoring_plan` is the pre-render material
contract. It lists required, present, and missing PBR texture maps per material
for the selected delivery tier. For premium delivery, missing required maps are
blocking because the result should not be sold as photorealistic when texture,
roughness, normal, alpha, or metallic evidence is absent. The plan can be
written as deterministic JSON with `outputPath`. It is not geometry authority
and must not alter the model.

`generate_digital_viewing_material_report` is a trust and QA surface. It
summarizes measurements including declared tolerance, source photos, PBR material records, texture-map status,
visible defects/wear, and delivery readiness. Photo evidence entries preserve
declared `materialCategories` so review surfaces can show which material class a
photo is allowed to evidence. Condition entries and visibility checklist entries
also preserve `sourcePhotoEvidence`, binding visible defects/wear to each source
photo's verification state and declared material categories. If a Blender render manifest is
provided, the report also records whether texture maps and condition overlays
were applied, missing, or skipped during execution. When `outputPath` is
provided, the report is written as deterministic JSON under the configured
output root. The report is not geometry authority and must not alter or
reconstruct the model.

`generate_digital_viewing_asset_bundle_manifest` is the pre-render file gate. It
accepts a validated capture, a render manifest, and the relative file paths that
are already present in the prepared asset bundle. It returns a deterministic
manifest of required photo evidence, texture evidence, and expected render
output. Missing required files are blocking for premium renders. The tool does
not start Blender, does not inspect geometry, and does not reconstruct or mutate
the model. When `outputPath` is provided, it writes the manifest under the
configured output root. Callers may either pass `existingFiles` explicitly or set
`scanOutputDir: true` to scan the configured output root for prepared photo and
texture assets before rendering. Scanned files include deterministic `sizeBytes`
and `sha256` metadata in the manifest so a render can be traced to the exact
input files that were present before Blender execution.
Delivery-package customer readiness also reports incomplete asset bundles as a
concrete missing/required file ratio, keeping photo and texture upload failures
separate from Blender render-execution failures.

`generate_digital_viewing_delivery_package` is the customer-delivery index. It
does not render, model, or infer anything. It verifies that the provided capture
and render manifest agree, that the render manifest's enforced capture preset
matches the provided capture asset type and delivery tier, that the material
authoring plan hash matches the render manifest, that the material/condition
report is ready, and that the package artifacts are deterministic. Callers may also pass an
`assetBundleManifest`; when present, the package validates bundle readiness and
hash alignment, then includes it as an `asset-bundle-manifest` artifact so the
customer package can prove which photo/texture bundle backed the render. If the
bundle has been written to disk, callers should also pass
`assetBundleManifestPath` so the package includes both the bundle hash and the
relative manifest path. Premium packages that include a required
`photoreal-render` target fail closed unless an asset-bundle manifest is
provided; buyer-facing photoreal output must prove the exact prepared photo and
texture files used before Blender execution. They also require the render
manifest to carry Blender execution metadata with the same `assetBundleHash`, so
the package proves that the render was produced from that bundle rather than
attaching evidence after the fact. For premium photoreal packages, the same
render manifest must also show that every host-targeted material was applied,
every material surface mapping was preserved, every material appearance
calibration was preserved, every declared texture map was applied, and every
scaled texture map used its declared physical scale and the exact texture file
identity from the asset bundle. Blender must write back `sizeBytes` and
`sha256` for each applied texture map; otherwise the package blocks with
`render_texture_file_identity_missing`. It must also prove that
every verified condition evidence item was rendered on the declared host, face,
and surface placement. The material/condition report's
`conditionVisibilityChecklist` is also enforced: every buyer-visible condition
item must be rendered as visible evidence, and Blender must write back
`visibilityProof.sourceOfTruth =
"created-visible-blender-overlay-object"` with the overlay object name, render
visibility, physical overlay dimensions, and
`materialReadback.sourceOfTruth =
"read-from-blender-condition-material-after-application"` with base color,
alpha, roughness, metallic, condition type, and severity. Blender must also
write back `sourcePhotoIdentities` for each verified condition source photo,
including `usage: "condition-source"`, `path`, `sizeBytes`, and `sha256`
matching the asset bundle. Missing source photo identity or missing condition
usage blocks with
`render_condition_source_photo_identity_missing`, so visible defects cannot be
sold from an overlay that is detached from its exact evidence photo.
Material source photos are likewise execution-bound to their bundle usage:
each `photoSources` path must be declared with `material:<materialId>`. Merely
having the same file present elsewhere in the bundle is insufficient evidence
for that material.
Declared-but-unapplied material or defect evidence blocks customer delivery.
Ready delivery packages include a `photorealQualityChecklist` that summarizes
the proof for asset bundle, measurement anchors, material application with
calibrated appearance and surface mapping, texture scale, matched texture color
space, visible conditions, camera reference, and lighting reference. The package also includes
`customerViewingChecklist`, a deterministic buyer/operator
checklist for reference photos, dimension overlays, material fidelity, condition
disclosures, photoreal render quality, requested model artifacts (`blend`,
`glb`, or `usdz`), and optional web-model delivery. It only summarizes existing
evidence and must not infer geometry or defects. Its material-fidelity item uses
`materialRenderCoverage` together with calibration and PBR completeness, so it
blocks when Blender did not apply declared material hosts, texture maps, texture
color spaces, surface mappings, or appearance calibration. When `web-viewer` is requested,
the checklist blocks web-model readiness until a ready `blend`, `glb`, or
`usdz` model artifact is indexed in the same package manifest. Each checklist
item also carries `sourceCoverage`, pointing back to the package evidence
section that determined its status, plus `sourceIds` for the concrete shots,
measurements, materials, conditions, or delivery targets that UI clients should
open from that row. The
photoreal checklist is a review surface only; it does not add geometry logic.
The package-level `sourceTraceIndex` is the lookup table for these IDs. It
labels each source and carries its coverage section, status, and optional
relative path. Material and condition trace entries also carry `evidencePaths`,
preserving every source photo behind material fidelity and visible defect or
wear items for customer UI deep-links. `evidencePaths` are only allowed on those
material and condition trace entries, and they are required to be unique and
sorted so customer-facing evidence navigation remains deterministic. The
optional `path` is the primary evidence link that must match the first
`evidencePaths` item. The trace entries themselves are sorted by `sourceType`
and `sourceId` so lightweight viewers can consume the manifest without local
reordering,
and every `sourceCoverage` must match its `sourceType` so clients cannot route a
material, condition, measurement, capture, or delivery target row to the wrong
evidence section,
with status values scoped by that same source type so capture matching,
measurement readiness, material fidelity, condition disclosure, and delivery
target readiness cannot collapse into one ambiguous enum,
and `ready` file delivery targets must carry an artifact path so package
consumers never need to infer where customer-facing external exports live,
while the embedded `material-condition-report` target remains hash-identified
inside the package unless supplied as a separate artifact,
while preserving the rule that package/export layers format and index evidence
only. Manifest validation
rejects any viewer/checklist
`sourceIds` that cannot resolve in this index, mismatched `entryCount` values,
duplicate source IDs, source coverage/status mismatches, unsorted trace entries,
evidence-path ownership drift, primary-path mismatches, and nondeterministic
evidence path lists.
The UI-facing `evidenceHealthSummary` derives ready, blocked, missing, and
`evidencePathCount` values from the same source trace index, so lightweight
frontends can display evidence health and link density without recomputing
material or condition provenance.
Every item includes trace hashes for the capture and render manifest plus the
relevant material-condition report or asset bundle where applicable.
The package-level `sourceTraceIndex` also treats material IDs as combined
render-and-PBR evidence: material entries are blocked when Blender did not apply
the declared material, texture maps, texture color spaces, surface mapping, or
appearance calibration, even if the PBR definition itself is complete.
Blender execution must prove that the render camera matches the declared sector,
mode, and verified reference photo used for the viewing angle, so a
customer-facing render cannot drift away from the captured source angle. Blender
also writes `referencePhotoIdentity` for that camera reference photo, including
path, byte size, SHA-256, and image dimensions when available. Premium package
generation compares that readback with the prepared asset bundle and blocks with
`render_camera_reference_photo_identity_missing` when the exact reference file
used by Blender is not proven.
package generation also requires premium perspective camera reference photos to
declare `focalLength35mmEquivalent` and `cameraDistanceMm`; premium orthogonal
full-object reference photos are gated on the same calibration fields during
capture preset validation. Missing package camera calibration metadata blocks
photoreal delivery with
`render_camera_reference_calibration_missing`. When present, the render manifest
includes `cameraReference`, Blender uses `cameraDistanceMm` as the perspective
camera placement distance and `focalLength35mmEquivalent` as the perspective
camera lens with a 36 mm sensor reference, and Blender writes
`appliedDistanceMm`, `appliedDistanceSource`,
`appliedFocalLength35mmEquivalent`, `appliedFocalLengthSource`, plus the same
calibration block into `blenderExecution.camera`. Blender also writes
`cameraLocationM`, `cameraTargetM`, `sensorWidthMm`, `executedYawDeg`, and
`executedPitchDeg`, so camera matching remains traceable without export-stage
geometry reconstruction. When a verified reference photo declares numeric
`yawDeg` or `pitchDeg`, Blender must write back `executedYawDeg` and
`executedPitchDeg` for those declared fields. Premium package readiness blocks
when that angle readback is missing, then compares the values with the verified
reference photo and blocks camera execution if the view angle drifts beyond the
allowed execution tolerance. Blender
execution must also prove that `site-reference` lighting used the declared
reference photo, so photorealistic material feel is tied to captured lighting
evidence instead of an untraceable studio approximation. Premium package
readiness also compares the Blender execution metadata against the manifest's
declared `lightingReference`, `colorReference`, `whiteBalanceKelvin`, and
`exposureEv`, blocking mismatches with `render_lighting_reference_mismatch`.
Blender execution must also report the PBR values it applied for every
host-targeted material. Premium package readiness compares those applied values
with the render manifest and blocks with `render_material_pbr_mismatch` if a
material's base color, roughness, metallic/specular, transmission, normal source,
or physical texture scale drift from the declared contract. The applied PBR block
must include Blender material-node readback provenance; otherwise package
readiness blocks with `render_material_pbr_readback_missing`. The readiness gate
compares the manifest against `pbrReadback.values`, so repeating the declared
PBR block is not enough when the material-node readback differs. Blender
execution must also write back `sourcePhotoIdentities` for every material
source photo, surface-mapping source photo, and appearance-calibration source
photo. Premium package readiness compares `path`, `sizeBytes`, and `sha256`
against the asset bundle and blocks with
`render_material_source_photo_identity_missing` when a material is detached from
its exact visual evidence.
execution must also report measurement anchors for every verified geometry
measurement, keeping customer-facing dimensions traceable through the render
manifest instead of relying only on pre-render capture data.

For captures that declare `geometryValidation: axis-extent`, traceability is
not a declaration-only claim: Blender reads the locked host extent on the
declared axis and compares it with the verified value and tolerance. Rendering
fails before artifact mutation when the readback is outside tolerance. The
method accepts only millimetre x/y/z measurements and rejects parented or
rotated hosts whose axes are not aligned with the declared reference frame.

Callers may pass a `customerSurface` such as `sales-listing`, `showroom`, or
`broker-preview`; if no explicit `deliveryTargets` list is supplied, the package
derives required customer-facing outputs from that surface. Additional targets
such as `glb`, `usdz`, `web-viewer`, and `technical-views` must be supplied as
explicit `deliveryArtifacts` metadata with a relative path and optional hash.
The package indexes those already generated outputs only; it does not create,
project, mutate, or reconstruct geometry for them. Caller-provided customer
artifacts without a content hash fail with `delivery_artifact_hash_missing`
because remote outputs must remain traceable.
`web-viewer` also requires a ready `glb`, `usdz`, or `blend` model artifact in
the same package manifest; otherwise the package fails with
`web_viewer_model_artifact_missing` so a customer-facing viewer cannot ship as a
shell without renderable model truth.
The returned manifest includes `customerReadinessSummary`, a deterministic
operator-facing summary of ready targets, failed photoreal checks, blocking
gates, warnings, photo-evidence readiness, capture-angle readiness,
material-category readiness, Blender material-render proof, condition-overlay
readiness, inspection-zone readiness, dimension-overlay readiness, Blender
render-quality readiness, and next actions. It is derived from package evidence
only and does not validate or create geometry. Customer readiness reports the
verified referenced-photo evidence count when camera, lighting, material,
texture, or condition evidence is missing or unverified. It also reports the
exact matched-shot count when required capture angles are missing or mismatched,
so wrong or incomplete photo references cannot silently proceed to customer
viewing. Missing domain-required material categories report their
covered/required count, so a customer render cannot be trusted while a required
surface class is absent. Missing or unverified inspection zones report their
verified/required count, so clear areas and defects are both explicit before
customer condition disclosure. Customer readiness is blocked unless
render-quality coverage is ready, and material-fidelity next actions identify
the exact Blender proof class that failed before a customer view can be trusted.
Condition-disclosure next actions also report the visible overlay readiness
count, so buyer-visible defects or wear cannot be hidden behind a generic
readiness failure.
It also includes `viewerLayerCoverage`, which maps package evidence to the
customer-visible layers a viewer may show: photoreal scene, material fidelity,
condition disclosure, dimension overlays, and web delivery. A viewer can use
this to hide or block layers that are not requested or lack required evidence.
Each layer carries deterministic `sourceIds`, pointing to the concrete render
target, material IDs, condition IDs, measurement IDs, or web/model delivery
targets behind that layer.
The `photoreal-scene` layer requires both passed photoreal checklist evidence
and ready Blender render-quality coverage.
It also includes `renderQualityCoverage`, which compares the declared render
preset with Blender execution settings such as renderer, samples, denoising,
resolution, color management, transparent film, and world color. The declared
profile includes the asset type, so high-trust customer domains can require
stricter render settings than simpler exterior-structure previews; for example,
vehicle and boat premium-sales Cycles renders require at least 128 samples with
denoising and at least `2560x1440` output. Property premium-sales renders
require at least `1920x1080`, exterior-structure premium-sales renders require
at least `1600x1000`, and product/custom or non-premium fallback renders require
at least `1280x720`.
Delivery-package quality gates fail with `render_quality_not_ready` when a
required photoreal customer render lacks Blender render-quality execution or
does not satisfy the declared render profile.
It also includes `materialCategoryCoverage`, which compares the domain capture
preset's required material categories with the render manifest. Customer-facing
material fidelity is blocked when a required category such as vehicle glass,
rubber, metal, paint, or leather is missing from the renderable material set.
Delivery-package quality gates also fail with `material_categories_not_ready`
until every required domain material category is present.
It also includes `photoEvidenceCoverage`, which lists the exact capture photos
used for camera reference, lighting, material sources, texture sources, surface
mapping, appearance calibration, condition evidence, and inspection-zone source
evidence.
For `site-reference` lighting, Blender writes
`blenderExecution.lighting.referencePhotoIdentity` with path, byte size, SHA-256,
and image dimensions when available. Premium delivery blocks with
`render_lighting_reference_photo_identity_missing` unless that readback matches
the prepared asset bundle.
Delivery-package quality gates fail with `photo_evidence_not_ready` when any
referenced photo evidence item is missing from capture or is not verified.
It also includes `captureAngleCoverage`, which lists every required preset shot,
the selected verified photo, expected camera/angle/yaw/coverage/occlusion and
endpoint-visibility rules, actual capture metadata, and matched/missing/
mismatched status.
Delivery-package quality gates also fail with `capture_angles_not_ready` until
every domain-required capture angle is matched by verified photo metadata.
It also includes `measurementEvidenceCoverage`, which lists verified dimensions,
their tolerance, placement, confidence/source, reference frame, and whether
Blender execution preserved each one as an applied measurement anchor.
It also includes `dimensionOverlayCoverage`, which derives customer-visible
dimension overlay readiness from the same verified placements and Blender
anchor application. Entries are marked ready, missing placement, or missing
anchor; the package never invents overlay endpoints after rendering.
Delivery-package quality gates fail with `dimension_overlays_not_ready` until
every verified geometry measurement has placement and Blender anchor evidence.
Ready entries also include a renderable annotation with text, value, tolerance, unit, axis,
host element, endpoints, source, and confidence for UI/export display only.
It also includes `conditionInspectionCoverage`, which compares the domain
capture preset's required inspection zones with verified condition-inspection
evidence. Customer-facing condition disclosure is blocked when a required zone
is missing or unverified, even if the render itself exists. Delivery-package
quality gates also fail with `condition_inspection_zones_not_ready` until all
required zones are verified. Premium preset validation also blocks inspection
source photos with `inspection_source_photo_material_category_mismatch` when
the inspection declares a material category and the source photo declares a
different `captureMetadata.materialCategories` set.
It also includes `conditionOverlayCoverage`, which derives customer-visible
defect overlay readiness from visible condition evidence, source photos,
inspection zones, declared surface placement, and Blender condition application.
Entries are marked ready, missing placement, missing render, or insufficient
visibility. Severity controls a deterministic disclosure profile with minimum
physical overlay area and longest dimension, so medium/high defects cannot be
made customer-ready with a marker that is too small to disclose the defect.
Premium verified condition evidence is also gated before rendering: the source
detail photo must be a verified, unoccluded macro/detail condition photo with
declared dimensions and at least `1024 px` on the shortest side.
Medium and high severity condition evidence also requires a detail photo with
scale/proximity, lighting, color-reference, white-balance, and exposure metadata;
otherwise premium output blocks with `condition_detail_photo_quality_missing`.
If any condition source photo or detail photo declares `materialCategories`,
those categories must include the PBR category of the material surface that owns
the defect; otherwise premium output blocks with
`condition_source_photo_material_category_mismatch` or
`condition_detail_photo_material_category_mismatch` before Blender can render
the condition overlay.
Delivery-package quality gates fail with `condition_overlays_not_ready` when
any buyer-visible condition lacks placement or a matching Blender-rendered
overlay before customer condition disclosure.
Ready entries also include a renderable disclosure with title, condition type,
severity, verification state, host element, inspection zones, source photos, and
source photo evidence with declared material categories, and surface placement
for UI/export display only.
It also includes `materialRenderCoverage`, which lists each PBR material, its
Blender host, preset/provenance, texture-map counts, mapping/calibration status,
source photos, per-material source-photo evidence count/status, and whether
Blender reported the material, texture maps, texture color spaces, surface
mapping, and appearance calibration as applied. It also carries per-material
`materialFidelityStatus` and `materialFidelityIssues`, giving lightweight UI
clients a ready/blocked material-fidelity verdict without duplicating package
rules. Aggregate material, texture-map, mapping, calibration, and ready/blocked
material-fidelity counts are included for package headers and low-compute
viewers; delivery-package validation recomputes those counts from the entries
and rejects mismatches before any viewer/export surface may trust them. It also
recomputes per-material source-photo evidence from unique, sorted `sourcePhotos`
and rejects material entries whose ready/blocked status does not match their
issue list, so material defects in Blender proof cannot be hidden behind a ready
verdict.
Per-material `surfaceMappingExecutionStatus` and
`appearanceCalibrationExecutionStatus` tell operators which material matched,
mismatched, lacked execution metadata, or did not require the specific proof.
It also includes `materialCalibrationCoverage`, which lists every photo-observed
material, its appearance-calibration method and source photo, and whether that
source resolves to verified, non-occluded capture evidence. Ready entries also
carry the source photo's `lightingReference`, `colorReference`,
`whiteBalanceKelvin`, and `exposureEv` so customer packages can prove the
material appearance calibration is reproducible. Premium calibration source
photos must include these metadata fields and the declared method must match
the source photo's `colorReference`. If source photo metadata declares
`materialCategories`, it must also include the calibrated material category.
Texture-map source photos follow the same category binding: a photo declared as
glass evidence cannot author a paint, wood, stone, metal, rubber, leather,
plastic, or gelcoat texture map. Otherwise the material authoring and delivery
readiness gates block before Blender rendering.
Premium material `photoSources` are also category-bound before material
authoring and delivery/export: if the source photo declares
`materialCategories`, those categories must include the PBR material category or
the plan/readiness gates block with
`material_source_photo_material_category_mismatch`.
Delivery-package quality gates fail with
`material_calibration_not_ready` until customer-facing material fidelity is
backed by verified appearance calibration.
Customer readiness next actions also expose the calibration completion ratio, so
photo-observed material appearance gaps remain separate from PBR definition and
Blender execution failures.
When Blender execution does not match declared appearance calibration, customer
readiness also reports `material-character`, so photo-calibrated material feel
is treated as its own customer-facing readiness gate.
The customer `material-fidelity` viewer layer also blocks when Blender execution
does not match declared texture color spaces, surface mapping, or appearance
calibration, so an operator cannot ship a photoreal surface whose material maps,
placement, or color/finish proof were not actually applied.
It also includes `pbrMaterialCompletenessCoverage`, which records whether each
material has complete renderable PBR fields, normal source, physical texture
scale, premium-required texture-map types for its material category, and the
texture evidence paths/source photos that support photoreal material authoring.
For `premium-sales`, this coverage also includes deterministic finish profiles:
vehicle paint, marine gelcoat, glass, metal, rubber, leather, stone, wood, and
plastic must keep roughness/metallic values inside domain ranges before the
surface can be trusted for customer material feel.
Delivery-package quality gates fail with `pbr_materials_not_ready` until every
material is complete enough for photoreal customer rendering.
Customer readiness next actions also expose the PBR completion ratio, so a
package blocked by incomplete material authoring is not confused with a Blender
projection, asset-bundle, or render-execution failure.
It also includes `renderExecutionCoverage`, which compares declared render
camera, lighting, render paths, and asset-bundle binding with Blender execution
metadata.
It also includes `conditionRenderCoverage`, which lists visible condition
evidence, inspection zones, source photos, surface placement, and whether
Blender rendered each condition on the declared host and face.
Customer readiness reports missing condition rendering as `condition-render`
before overlay placement, so buyer-visible defects must be rendered by Blender
before disclosure overlays can make the package sellable.
When `outputPath` is provided, it writes a package manifest JSON under the
configured output root.

`list_digital_viewing_delivery_profiles` and
`get_digital_viewing_delivery_profile` expose the product packaging layer. They
describe customer-facing surfaces such as `sales-listing`, `showroom`,
`broker-preview`, and `permit-support`, including required and optional package
targets. These tools do not inspect or alter Blender scenes.

`evaluate_digital_viewing_delivery_profile` is the pre-package gate. It verifies
that a capture explicitly declares the outputs required by the selected
customer surface before rendering or package assembly is treated as sellable.
Missing required targets fail closed; missing optional targets remain warnings.

`render_digital_viewing_preview` is not a geometry-generation tool. It consumes
a validated digital-viewing capture, a render preset, and a locked `.blend`
source path. The render manifest embeds the active capability manifest, requires
the `measured-digital-viewing` strategy set, revalidates the domain capture
preset for the capture asset type and delivery tier, records that enforced
`capturePreset` in the manifest, and consumes the material authoring plan before
Blender is invoked. Premium renders fail before execution when required domain
views or PBR evidence are missing. The generated render job exposes
`executionPlacement`, which declares frontends and Termux as control planes
only, Blender rendering as heavy-worker execution, Hetzner/Ubuntu as the
preferred execution geography, local workstation as the fallback geography,
explicit remote selection as mandatory, and geometry mutation/export
reconstruction as forbidden. Callers may also pass the
`assetBundleManifest` produced by
`generate_digital_viewing_asset_bundle_manifest`; when provided, the render job
requires the bundle to be ready and verifies that its capture and render-manifest
hashes match the current render job before Blender starts. Blender then writes
the bundle readiness summary and `assetBundleHash` into `blenderExecution` in
the render manifest, preserving traceability from output back to exact prepared
files. Delivery-package customer readiness reports missing or mismatched
Blender asset-bundle execution proof as `render-asset-bundle`, separately from
pre-render bundle file readiness.
photo/texture inputs.
The bridge opens that source, applies source-backed PBR material records where
`hostElementId` matches scene objects, links texture maps when the files exist
under the configured output root, reports applied/missing/skipped texture files
with physical scale, pixel-resolution metadata, byte size, and SHA-256 in the execution manifest,
configures camera/lighting, projects condition overlays where evidence has
structured `surfacePlacement`, writes condition source photo identities for the
exact evidence files used, renders the image, and writes the manifest.
The resulting render is explicitly not geometry authority; condition overlays
are visual evidence for review and buyer trust, not measured geometry. The tool
fails closed when the capture does not satisfy the selected domain preset, when
no preset exists for that asset type and delivery tier, or when the capability
manifest does not allow the render strategy.

## Example: Carport Fixture

```json
{
  "projectId": "carport-demo",
  "profile": "carport",
  "parameters": {
    "widthMm": 7676,
    "depthMm": 6240,
    "roofSlopePercent": 3.7,
    "westHighSideHeightMm": 3455,
    "eastLowSideHeightMm": 3174,
    "foundationHeights": {
      "southwest": { "roadSideMm": 0, "middleMm": 685, "innerMm": 695 },
      "northeast": { "outerTowardRoadMm": 530, "middleMm": 500, "innerMm": 630 }
    },
    "steps": [
      { "stepDepthMm": 295, "stepHeightMm": 140, "count": 3, "locationHint": "entrance/platform" }
    ],
    "neighborBoundary": {
      "from": "outermost_southwest_post",
      "distanceMm": 7692
    }
  }
}
```

The carport profile is a fixture on top of generic primitives. Future profiles should reuse the same project state, confidence model, validation layer, and export pipeline.

## Output Templates

The current bridge can produce measured Blender artifacts, orthographic view images, and technical PDF packages. Templates must never alter geometry.

| Output Template | Expected Artifacts |
| --- | --- |
| `permit` | Plan, elevations, section, scale bars, dimensions, confidence legend. |
| `permit-facade-pack` | Standard facade package from Blender orthographic views. |
| `swedish-municipality` | Swedish municipal layout conventions and title block metadata. |
| `gothenburg-permit` | Göteborg-oriented permit-support facade package. |
| `measured-visualization` | Generic measured visualization package for review. |
| `client-preview` | Textured GLB, perspective renders, simplified dimensions. |
| `fabrication` | Component list, exact element bounds, OBJ/GLB, tolerance notes. |
| `qa-validation` | Validation report, confidence map, reprojection warnings. |
| `site-context` | Situation/context package with boundary distances and reference context. |
| `photo-alignment` | Photo-reference review package with approximation warnings. |
| `measurement-book` | Complete measurement and confidence source book. |
| `web-viewer` | GLB and manifest for web delivery. |
| `archive` | Reproducible project export package. |

This keeps local geometry stable while letting each recipient receive only the representation they need.

### Gothenburg facade pack contract

The governed facade templates produce an A3 landscape layout only after Blender
has rendered the locked north, south, east, and west orthographic artifacts. The
layout step verifies and records each PNG's critical-chunk SHA-256 identity; it
does not project, reconstruct, or mutate geometry. Its manifest records the
included views, scale and scale bar, title block, material/color metadata,
measurements, assumptions, confidence legend, mark-line role, and the explicit
source statement `Measured Blender visualization - not CAD, BIM or survey
output`. A missing required view fails the export instead of producing a partial
permit-support pack.

`cad-simulated` remains only as a deprecated legacy alias for older clients. New public templates must avoid CAD wording and use `permit-facade-pack`, `swedish-municipality`, `gothenburg-permit`, or `measured-visualization`.

## Open Core Boundary

Recommended packaging:

| Layer | Suggested Visibility |
| --- | --- |
| MCP core, measurement model, validation, Blender integration | Public/open core |
| Municipality-specific PDF templates, styling presets, UX layer, hosted workflow integrations | Private or commercial |

## Environment Variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `BLENDER_PATH` | No | macOS app path, then `blender` from `PATH` | Blender executable path. |
| `BLENDER_OUTPUT_DIR` | No | `outputs` under the current working directory | Directory for generated `.blend` files. |
| `BLENDER_TIMEOUT_MS` | No | `120000` | Maximum Blender process runtime per tool call. |

## MCP Config

```json
{
  "mcpServers": {
    "blender": {
      "command": "node",
      "args": ["/absolute/path/to/nova-measured/dist/src/server.js"],
      "env": {
        "BLENDER_PATH": "/Applications/Blender.app/Contents/MacOS/Blender",
        "BLENDER_OUTPUT_DIR": "/absolute/path/to/outputs",
        "BLENDER_TIMEOUT_MS": "120000"
      }
    }
  }
}
```

## Tool: `blender_status`

### Description

Checks whether the server can resolve a usable local Blender executable.

### Input

No input.

### Output

```json
{
  "ok": true,
  "stdout": "Blender command resolved: /Applications/Blender.app/Contents/MacOS/Blender",
  "stderr": ""
}
```

## Tool: `create_2d_sketch`

### Description

Creates a Blender scene containing curve strokes from 2D point coordinates. Each stroke becomes a beveled Blender curve with a material.

### Input Schema

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | string | No | Scene name. Defaults to `measured-sketch`. |
| `strokes` | array | Yes | One or more stroke definitions. |
| `backgroundColor` | hex color | No | World background color. Defaults to `#ffffff`. |
| `outputFile` | string | No | Output `.blend` filename. Defaults to `sketch.blend`. |

Stroke fields:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `points` | `[number, number][]` | Yes | At least two 2D points. |
| `color` | hex color | No | Stroke color. Defaults to `#111111`. |
| `width` | number | No | Stroke width. Defaults to `3`. |

### Example

```json
{
  "name": "line-study",
  "strokes": [
    {
      "points": [[0, 0], [1, 1], [2, 0]],
      "color": "#111111",
      "width": 4
    }
  ],
  "backgroundColor": "#ffffff",
  "outputFile": "line-study.blend"
}
```

## Tool: `create_3d_model`

### Description

Creates a Blender scene from primitive geometry. Supported primitives are `cube`, `sphere`, `cylinder`, `cone`, and `torus`.

### Input Schema

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | string | No | Scene name. Defaults to `measured-model`. |
| `primitives` | array | Yes | One or more primitive definitions. |
| `camera` | object | No | Camera location and target. |
| `outputFile` | string | No | Output `.blend` filename. Defaults to `model.blend`. |

Primitive fields:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `kind` | enum | Yes | `cube`, `sphere`, `cylinder`, `cone`, or `torus`. |
| `name` | string | No | Blender object name. |
| `location` | `[number, number, number]` | No | Object location. Defaults to `[0, 0, 0]`. |
| `scale` | `[number, number, number]` | No | Object scale. Defaults to `[1, 1, 1]`. |
| `rotation` | `[number, number, number]` | No | Euler rotation in degrees. Defaults to `[0, 0, 0]`. |
| `color` | hex color | No | Material color. Defaults to `#8fb3ff`. |

Camera fields:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `location` | `[number, number, number]` | No | Camera location. Defaults to `[5, -7, 5]`. |
| `target` | `[number, number, number]` | No | Camera target. Defaults to `[0, 0, 0]`. |

### Example

```json
{
  "name": "primitive-study",
  "primitives": [
    {
      "kind": "cube",
      "name": "base",
      "location": [0, 0, 1],
      "scale": [1, 1, 1],
      "color": "#8fb3ff"
    },
    {
      "kind": "sphere",
      "name": "marker",
      "location": [2, 0, 1],
      "scale": [0.75, 0.75, 0.75],
      "color": "#f28c8c"
    }
  ],
  "camera": {
    "location": [5, -7, 5],
    "target": [0, 0, 0]
  },
  "outputFile": "primitive-study.blend"
}
```

## Tool: `run_blender_python`

### Description

Runs explicit Blender Python in a clean scene. This tool is an unsafe fallback for advanced operations that exceed structured contracts.

### Input Schema

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `code` | string | Yes | Blender Python source code. |
| `outputFile` | string | No | Output `.blend` filename. Defaults to `python-output.blend`. |
| `unsafeAllowExecution` | `true` | Yes | Explicit opt-in gate for unsafe execution. |

### Execution Context

The Python bridge exposes:

- `bpy`
- `math`
- `Vector` from `mathutils`

### Safety Note

`run_blender_python` can execute local Python inside Blender. It requires explicit opt-in, blocks common file-system/process escape tokens, exposes restricted builtins, and should only be used for trusted user-approved code.

## Failure Semantics

Failures are returned as MCP tool errors with a JSON body:

```json
{
  "ok": false,
  "outputPath": "/absolute/path/to/output.blend",
  "stdout": "",
  "stderr": "Causal error message"
}
```

The server treats missing output files as failure even if Blender exits with code `0`.

## Validation

### Technical permit versus preview authority

Permit-support exports declare `outputClassification.purpose` as
`technical-permit-support` and accept only locked Blender orthographic line
artifacts as authority. Photorealistic output is explicitly non-authoritative
and cannot be accepted as a permit source of truth. The same manifest carries
`materialEvidence` separately, including the material note, provenance,
confidence, and verification state; photo-derived appearance never changes
measured geometry.

Run:

```bash
pnpm build
pnpm lint
pnpm test
```

Optional local smoke test:

```bash
node --input-type=module -e "import { runBlenderJob } from './dist/src/blenderRunner.js'; const result = await runBlenderJob({ outputDir: 'outputs', timeoutMs: 120000 }, { mode: 'model', name: 'smoke', primitives: [{ kind: 'cube', location: [0,0,1], scale: [1,1,1], rotation: [0,0,0], color: '#8fb3ff' }], camera: { location: [5,-7,5], target: [0,0,0] } }, 'smoke-model.blend'); console.log(JSON.stringify(result, null, 2)); process.exit(result.ok ? 0 : 1);"
```
