# Digital Viewing Pipeline

## Purpose

Measured by Nova should become a measured digital viewing pipeline for physical
assets where visual trust and dimensional truth matter at the same time.

The product is not limited to carports or permit-support drawings. The carport
case remains the first hard validation slice because it exposed the most
important system boundary:

```text
measurements are geometry truth
photos are visual and material evidence
Blender is the renderable truth
exports are formatting only
```

## Target Customers

The first commercial domains are:

- car dealerships
- boat dealerships
- real estate brokers
- renovation and property operators
- other high-trust sales domains where quality, wear, surface finish, defects,
  scale, and spatial feeling affect buyer decisions

## Product Promise

Measured creates digital viewing assets from verified physical input.

The intended output is a real-scale, inspectable, photorealistic Blender model
that preserves:

- exact dimensions
- correct object placement
- material quality
- surface finish
- visible wear and damage
- defects and imperfections
- lighting and spatial feeling
- traceability to source measurements and photos

The system must never hide uncertainty. If a scratch, dent, stain, texture,
reflection, opening, panel, fixture, or level is not sufficiently visible or
measured, the output must mark it as missing, low-confidence, or blocked.

## Source-Of-Truth Rules

| Input | Authority |
| --- | --- |
| Measurements | Primary source of truth for geometry, scale, placement, and dimensions. |
| Drawings/contracts | Primary source of truth when explicitly verified. |
| Structured photos | Secondary source for material, texture, wear, context, placement review, and validation. |
| Calibration anchors | Geometry authority only when explicitly measured or calibrated. |
| Blender geometry | Only renderable truth after review and lock. |
| Export templates | Formatting only; no geometry inference or reconstruction. |

Photos may guide material and surface representation, but they must not override
verified dimensions. Measurements may define geometry that photos cannot prove,
but the output must preserve confidence and provenance.

## Capture Flow

```text
intake
  -> capture guide / shot list
  -> measurement contract
  -> structured photo capture
  -> material and defect capture
  -> capture completeness validation
  -> measured base geometry
  -> camera and photo alignment
  -> material classification
  -> texture and defect projection
  -> PBR material authoring
  -> Blender scene generation
  -> human review
  -> model lock
  -> domain-specific export
```

Every stage must be deterministic within declared renderer tolerance. No stage
may infer missing geometry silently.

## Implementation Modules

The TypeScript contract is split by ownership:

- `src/digitalViewingContracts.ts` defines the stable public schema and render
  manifest schema surface, and re-exports the public helper API for backward
  compatibility.
- `src/digitalViewingPresets.ts` owns domain capture presets and preset
  readiness checks for vehicle, boat, and property workflows.
- `src/digitalViewingReadiness.ts` owns capture validation and delivery-tier
  readiness policy.
- `src/digitalViewingRender.ts` owns material presets, deterministic render
  manifest construction, hashing, Blender render-job construction, and the
  final domain capture-preset gate before any render manifest can exist.
- `src/digitalViewingPackage.ts` owns customer delivery packages and pre-render
  asset-bundle readiness manifests for photo, texture, and expected render
  files.
- `src/measurementTools.ts` exposes preset list/get/validate tools, material
  planning/reporting, asset-bundle readiness, and surfaces domain-preset
  blocking reasons before render execution.
- `blender/bridge.py` owns Blender mode/operation dispatch for the local
  background process.
- `blender/digital_viewing.py` owns photorealistic digital-viewing execution:
  PBR material application, texture linking, condition overlays, render camera,
  lighting, and render manifest writeback.

This keeps capture policy, delivery readiness, render-manifest generation, and
Blender execution as separate owners. Presets and render behavior can evolve by
domain without changing geometry generation or export formatting.

## Capture Requirements

Each capture package must define:

- asset type: vehicle, boat, room/property, exterior structure, product, or
  custom profile
- dimensional measurements with unit, confidence, verification state, and
  optional model placement
- declared renderable model elements that measurements, materials, and
  condition overlays may target
- required sides/sectors and photo coverage
- camera metadata where available
- calibration anchors or scale references when geometry alignment is expected
- material records
- defect/wear records
- occlusion notes
- assumptions
- intended output target

Geometry-impacting fields must be verified before model lock. Material-only
fields may remain lower confidence, but must be visible in manifests and review
surfaces.

For premium photoreal perspective renders, the photo used as the render camera
reference must declare `focalLength35mmEquivalent` and `cameraDistanceMm` in
`captureMetadata`. The photo still does not become geometry authority; this
metadata only makes camera matching auditable enough to sell the render as a
high-trust digital viewing artifact.

For `premium-sales`, each geometry-impacting measurement must also declare
machine-readable tolerance in the same unit as the measurement, plus model
placement: target host element, axis, start reference, end reference, and
reference frame. This keeps dimensions attached to the renderable asset instead
of becoming free-text claims beside the model, and prevents customer-facing
dimensions from implying false precision.

Premium captures must also declare a renderable model-element registry. Host
references from measurement placement, PBR materials, and condition overlays
must resolve to this registry. Unknown hosts block premium output instead of
being silently ignored by Blender or treated as approximate text labels.

## Capture Guides

Before a capture package exists, the system can generate a deterministic capture
guide from the selected asset type and delivery tier.

The guide records:

- required measurements
- machine-readable measurement checklist items with geometry-authority,
  verification, placement, unit, and operator instruction flags
- required material categories
- machine-readable material checklist items with required PBR maps,
  texture-evidence, surface-mapping, and appearance-calibration requirements
- whether texture evidence is required
- whether condition evidence is required
- required inspection zones for premium sales capture
- machine-readable inspection checklist items with allowed statuses, source
  photo requirements, defect-evidence requirements, and condition-capture
  quality profiles
- required photo sectors
- required photo roles per sector
- whether anchors or measured endpoints should be visible
- camera mode, angle type, yaw target, yaw tolerance, pitch guidance, lens
  guidance, coverage, and occlusion policy per shot
- shot instructions for material, condition, and texture evidence

Capture guides are instructions only. They do not infer geometry, and they do
not weaken the measurement-first contract. Their purpose is to help operators
collect the right photos before Blender rendering or model review starts.

For example, `vehicle:premium-sales` requires front, rear, left, right,
interior, and detail shots. It also requires separate material evidence for
paint, glass, rubber, metal, and leather so a sales render can preserve body
finish, window reflectivity/transparency, tire texture, wheel finish, and
interior feel instead of collapsing the vehicle into generic surfaces.
The guide now expands each category into domain-critical material surfaces:
vehicle paint means body panels/bumpers, glass means windshield/side/rear
windows, rubber means tires/seals, metal means wheels/trim/badges, and leather
means seats/steering wheel.
For `premium-sales`, those `materialSurfaces` are enforceable capture contract
fields. Each domain-critical surface must be covered by a material record with
verified source photos, otherwise preset readiness blocks with
`required_material_surface_missing` before any Blender render or export can run.
Premium vehicle capture also requires verified inspection zones for body, glass,
wheels/tires, and interior. These inspections can be `clear` or
`defect-found`, but they must be verified and backed by source photos. This
prevents a sales render from implying that a zone was inspected when the capture
only contains a single visible defect.
Inspection source photos must resolve to verified capture photos. If an
inspection zone is marked `defect-found`, it must link to verified condition
evidence; otherwise the pipeline blocks premium output instead of turning an
unbacked note into buyer-facing truth.
When an inspection declares a `materialCategory`, any source photo that also
declares `captureMetadata.materialCategories` must include that category.
Otherwise premium preset readiness blocks with
`inspection_source_photo_material_category_mismatch`, because an inspection of
glass, paint, wood, stone, or another material cannot be backed by a
material-scoped photo from the wrong surface class.
`exterior-structure:premium-sales` requires north, south, east, west, and detail
shots, with wood/stone material evidence and condition evidence for visible
weathering or defects. It also requires cladding, openings, foundation, roof,
and stairs inspection zones when sold as premium exterior visualization.
Boat presets require gelcoat, glass, metal, fabric, and wood evidence so hull
finish, windows, railings/fittings, upholstery/canopy, and deck/cabin materials
remain distinct. Premium boat capture requires hull, deck, fittings,
upholstery/canvas, and cabin inspection zones. Property presets require wood,
glass, stone, and metal evidence so facade/interior surfaces, windows, masonry,
and fittings do not become generic placeholders in broker-facing views. Premium
property capture requires facade, windows/doors, masonry/foundation,
roof/fittings, and interior-finish inspection zones.
Exterior-structure guides do the same for carport-style assets: wood evidence is
split across cladding/posts/fascia/stairs, and stone evidence across foundation,
retaining walls, and steps. These surface lists are capture guidance, not
geometry inference.

Geometry-alignment shots use `orthographic-reference` guidance with normal
lenses, level pitch, full-object coverage, avoid-occlusion policy, fixed yaw
targets for the named sector, and numeric `pitchDeg` capture metadata. Detail
shots use `macro-detail` guidance and are explicitly prevented from becoming
dimensional evidence. This makes "photos from the right angles" a
machine-readable capture requirement rather than an operator memory note.

Premium captures must also record matching metadata on each verified photo:
angle type, camera mode, yaw when applicable, numeric `pitchDeg` for
orthogonal level reference shots, `focalLength35mmEquivalent` and
`cameraDistanceMm` for orthogonal full-object reference shots, pitch guidance,
lens guidance, coverage, and occlusion state. Material calibration photos must
also declare `whiteBalanceKelvin` and `exposureEv` together with lighting and
color references, so Blender material color can be reproduced rather than
eyeballed. When capture metadata declares `materialCategories`, the category
list becomes binding evidence: premium material source photos, texture-map
source photos, appearance-calibration source photos, and material
surface-mapping source photos must include the material category they evidence,
texture, calibrate, or place. Material source mismatches block premium capture
readiness, premium material authoring, and premium delivery/readiness export with
`material_source_photo_material_category_mismatch`; texture-map mismatches block with
`texture_source_photo_invalid`; appearance calibration mismatches block with
`material_appearance_calibration_material_category_mismatch`; surface-mapping
mismatches block as invalid material placement evidence. Preset readiness fails
when this metadata is missing, mismatched, or contradicts the capture guide. A
sector photo can
therefore be present and still fail the premium gate if it is taken from the
wrong angle, lacks camera calibration for Blender camera matching, or does not
show required measured endpoints.

Premium material checklist items also expose a deterministic
`captureQualityProfile` per asset type and material category. Blocking profile
requirements currently include full-sector-or-surface coverage, verified
non-occluded source photos, `whiteBalanceKelvin`, and `exposureEv`; advisory
entries such as cross-polarization, reflection angle, glare control, and raking
light guide capture operators without silently becoming geometry or hard renderer facts.
If a required material surface is backed by photos that do not satisfy the
blocking profile, preset readiness fails with
`material_capture_quality_missing`.

Capture repair UX must use the shared `repairSummary` contract from
`src/digitalViewingContracts.ts`. The summary groups blocking reasons into
deterministic sections for measurements, photos, materials, inspections,
conditions, and outputs; it never replaces the original failure reason list.

Verified defect and condition claims have an additional premium gate. Each
verified condition must reference at least one verified, unoccluded
`macro-detail` condition photo with `detail` angle type and `condition-detail`
coverage. A scratch, stain, dent, repair, weathering mark, or other visible
condition may not be treated as premium sales evidence from a generic context or
material photo. The detail photo must also declare image dimensions and be at
least `1024 px` on its shortest side; otherwise the condition is blocked with
`condition_detail_photo_resolution_too_low`. This keeps buyer-visible defects
reviewable instead of letting a low-resolution crop become customer-facing
truth.
Medium and high severity condition evidence also requires capture-quality
metadata on at least one detail photo: `cameraDistanceMm` for scale/proximity,
`lightingReference`, `colorReference`, `whiteBalanceKelvin`, and `exposureEv`.
If those fields are missing, premium delivery is blocked with
`condition_detail_photo_quality_missing` so substantial defects cannot be sold
from ambiguous close-up evidence.
Capture guides expose the same requirements as
`inspectionChecklist[].conditionCaptureQualityProfile`, so UI clients can show
defect evidence requirements before capture instead of discovering them only
when premium delivery is blocked.
For `premium-sales`, verified condition evidence must also declare
`materialSurface`, such as `body-panels`, `hull`, or `cladding`. The referenced
surface must exist on a source-backed material record. Missing or unknown
condition material surfaces block premium delivery with
`condition_material_surface_missing` or `condition_material_surface_unknown`,
preventing scratches, fading, oxidation, wear, or other visible defects from
being rendered on a generic or wrong finish. If any condition source photo or
condition detail photo declares `materialCategories`, it must include the
category of the material that owns the declared `materialSurface`; otherwise
premium delivery blocks with
`condition_source_photo_material_category_mismatch` or
`condition_detail_photo_material_category_mismatch`. A verified scratch on paint
cannot therefore be backed by condition evidence declared as glass, rubber,
leather, metal, stone, wood, plastic, fabric, or gelcoat evidence.

## Implemented Contract Slice

The first generalized capture contract is implemented in
`src/digitalViewingContracts.ts`.

It currently validates:

- deliverable preset domains: vehicle, boat, property, exterior structure, and product
- custom is an extension capture type, not a generic deliverable domain; it fails closed until a project-specific preset defines its measurements, sectors, materials, and inspection zones
- declared renderable model elements for host validation
- verified geometry-impacting measurements
- premium measurement placement for traceable dimensions on the renderable asset
- required photo sectors
- material records with PBR-oriented fields
- domain material presets for common asset categories plus domain-critical
  surfaces such as vehicle body panels, boat hull/deck gelcoat, property
  windows/masonry, and exterior cladding/foundation/stairs
- texture-map slots for base color, roughness, metallic, normal, height, alpha,
  and ambient occlusion
- condition evidence for scratches, dents, stains, cracks, fading, oxidation,
  patina, seams, repairs, and wear
- condition inspections that explicitly mark required premium zones as clear,
  defect-found, or not-inspected with source-photo provenance
- optional `surfacePlacement` for condition evidence, including host object,
  surface face, normalized position, measured overlay size, and rotation
- provenance and confidence for material and condition claims
- output targets such as Blender, GLB, USDZ, web viewer, photoreal render,
  technical views, and material/condition reports
- delivery tiers:
  - `draft-preview`
  - `standard-viewing`
  - `premium-sales`
- domain capture presets for vehicles, boats, and properties

The vehicle fixture in `fixtures/digital-viewing-vehicle-capture.json` proves the
sales-grade shape for the car/dealer path: measured body geometry and wheelbase,
locked renderable hosts for body, seats, glass, tires, and wheels, source-backed
PBR materials for paint, glass, rubber, metal, and leather, and verified
condition evidence for visible damage.

The boat fixture in `fixtures/digital-viewing-boat-capture.json` proves the
marine dealer path: verified LOA, beam, and draft define hull geometry while
source-backed gelcoat, glass, metal, fabric, and wood material evidence define
the premium render contract. Marine gelcoat must carry photo-backed
`baseColor`, `normal`, and `roughness` maps, so a white hull cannot degrade into
a flat procedural surface in sales-grade output.

The property fixture in `fixtures/digital-viewing-property-capture.json` proves
the broker-facing path: verified width, depth, and height define building
geometry while photos carry facade, windows, masonry/foundation, roof fitting,
and interior-finish material evidence. Broker output can therefore show
surface quality and condition without letting photos become hidden dimensional
authority.

Vehicle dimensions, boat LOA/beam, and property dimensions declare
`geometryValidation: axis-extent`. This method is restricted to millimetres and
the x/y/z axes. Blender requires the locked host to be unparented and aligned to
the anchor's declared reference frame, then reads its extent on the declared
axis and blocks before rendering when the difference exceeds tolerance. Boat
draft remains a waterline-to-keel anchor and is not misclassified as full hull
height. The runtime integration suite renders all three domains and also proves
that mismatched locked geometry cannot replace or corrupt the previously valid
render artifact.

The carport fixture in `fixtures/digital-viewing-carport-capture.json` proves
the exterior-structure/property-style path. It uses verified dimensions for
width, depth, height, roof slope, step dimensions, and boundary distance while
using photos only for facade orientation, white painted wood, dark stone
foundation, and visible panel weathering. This keeps the original carport case
as a real validation slice without hardcoding carport behavior into the
platform.

The integration suite also runs that capture through Blender against a locked
source scene with matching host objects. The resulting execution manifest must
show that white painted wood, dark stone foundation, texture-map evidence,
condition overlays, camera, lighting, render artifact, output `.blend`, and
manifest are all produced from the same controlled source.

The first render manifest slice is also implemented in
`src/digitalViewingContracts.ts`.

It builds a deterministic manifest from a valid capture and render preset:

- render is explicitly marked as not geometry authority
- geometry hash is derived only from verified measurements
- material/condition hash is separated from geometry
- render preset hash captures camera, renderer, resolution, lighting and output
- manifest records PBR material fields and condition evidence provenance
- manifest records verified inspection zones separately from defect evidence, so
  clear areas and defect-found areas are both traceable
- manifest normalizes preset-backed PBR defaults without overriding explicit
  measured or photo-observed values
- manifest records texture-map slots and provenance
- condition overlays can be projected onto matching Blender host objects when
  structured `surfacePlacement` exists
- invalid capture blocks manifest creation

This prepares the later Blender execution layer without letting Blender render
quality become a hidden source of truth.

## Delivery Readiness Gates

The same capture can be valid for one delivery tier and invalid for another.
This lets the product sell different outputs without weakening the truth model.

| Tier | Intended Use | Material/Texture Policy |
| --- | --- | --- |
| `draft-preview` | Early review and internal iteration. | Missing texture maps are warnings. |
| `standard-viewing` | Normal customer digital viewing. | Materials must exist and target host objects; missing texture maps are warnings. |
| `premium-sales` | High-trust commercial viewing where quality and defects affect purchase decisions. | Measurements/materials/conditions must target declared renderable model elements; measurements must include model placement; materials must use domain presets, explicit surface mapping, and verified texture evidence; verified defects must have surface placement. |

Delivery gates never change geometry. They only decide whether the requested
output may be produced and what warnings must remain visible in review or
manifest surfaces.

## Material Authoring Plan

Photorealism is blocked unless material evidence is explicit enough for the
selected delivery tier. The material authoring plan is the pre-render contract
between capture and Blender material application.

The plan is deterministic and records, per material:

- target Blender host object
- material category and domain material preset
- surface mapping: projection strategy, target faces, physical scale, rotation,
  and source photo
- appearance calibration: color/finish method, source photo, illuminant, and
  confidence
- required PBR texture maps
- present texture maps
- missing texture maps
- source photos used to author each map
- blocking reasons and warnings
- authoring status

For `premium-sales`, paint and gelcoat require photo-backed `baseColor`,
`normal`, and `roughness` evidence so color variation and finish do not collapse
into a flat procedural material. Other common opaque surfaces such as wood,
leather, stone, plastic, rubber, composite, and fabric require photo-backed
`normal` and `roughness` evidence. Metal also requires `metallic`; glass
requires `alpha` and `roughness`. Missing required maps do not change geometry,
but they block the material from being treated as premium photorealistic output.

Premium texture maps must also reference a verified, unoccluded source photo
that can legitimately support texture evidence. The source may be a
geometry-alignment, material, or condition photo when its coverage is
`full-object`, `full-sector`, or `material-surface`; context and validation
photos cannot be used as premium texture evidence.

Texture map color spaces are part of premium material truth. `baseColor` maps
must use `sRGB`; data maps (`roughness`, `metallic`, `normal`, `height`,
`alpha`, and `ambientOcclusion`) must use `Non-Color`. Violations block with
`texture_color_space_invalid` because Blender would otherwise interpret
material evidence through the wrong color pipeline.
Premium delivery packages also require Blender execution metadata to write back
the exact `sizeBytes` and `sha256` for every applied texture file, matching the
prepared asset bundle. Missing or mismatched texture file identity blocks with
`render_texture_file_identity_missing`; path/type/color-space matches alone are
not enough for buyer-facing photoreal output.

Premium materials must declare `surfaceMapping`. This mapping is not geometry
authority; it is the deterministic Blender placement contract for texture
projection and scale. Missing surface mapping blocks `premium-sales` delivery
because the renderer would otherwise be free to place texture evidence
implicitly.

When `surfaceMapping.sourcePhoto` is declared, it must reference verified,
unoccluded material-placement evidence: a geometry-alignment, material, or
condition photo with `full-object`, `full-sector`, or `material-surface`
coverage. A condition-detail macro photo is valid for defect evidence, but not
for global material placement.

Photo-observed premium materials must also declare `appearanceCalibration`.
This is the color and finish provenance contract: how the base color and
appearance were derived, which photo or source supports it, which illuminant was
assumed, and how confident the system may be. Missing appearance calibration
blocks premium delivery because color accuracy is part of the product promise
for sales-grade digital viewing.
For `premium-sales`, `appearanceCalibration.illuminant` is required. Missing
illuminant blocks readiness with
`material_appearance_calibration_illuminant_missing`, because Blender material
color and finish cannot be reproduced deterministically without an explicit
lighting assumption.

When `appearanceCalibration.sourcePhoto` is declared, it must reference a
verified, unoccluded geometry-alignment or material photo with `full-object`,
`full-sector`, or `material-surface` coverage. Condition-detail photos are
defect evidence, not color/finish calibration evidence.
For `premium-sales`, that source photo must also carry `lightingReference` and
`colorReference` capture metadata. Without both, the material can be observed
but not trusted as reproducible color/finish calibration for Blender rendering.
The declared calibration method must also match the captured color reference:
`color-chart` requires `color-checker`, `white-balance-reference` requires a
gray card, known white reference, or manual white balance, `manufacturer-spec`
requires `manufacturer-spec`, and `manual-specified` requires manual white
balance or manufacturer specification. Incompatible pairs are blocked with
`material_appearance_calibration_reference_incompatible` before render manifest
generation.

The material authoring plan is not render output and not geometry authority. It
only tells the operator what evidence must be authored before Blender can render
the asset honestly.

For premium delivery, render-manifest generation consumes this plan as a hard
gate. If required PBR evidence is missing, the system fails before Blender is
invoked. This keeps "photorealistic" from becoming a styling claim when the
capture package does not contain enough source-backed material evidence.

## Domain Capture Presets

Domain presets define the minimum capture contract before rendering starts. They
are machine-readable and return explicit missing requirements.

| Domain | Preset Sectors | Required Measurements | Premium Material Categories |
| --- | --- | --- | --- |
| Vehicle | front, rear, left, right, interior, detail | overall length, overall width, overall height, wheelbase | paint, glass, rubber, metal, leather |
| Boat | bow, stern, port, starboard, deck, cabin, detail | LOA, beam, draft | gelcoat, glass, metal, fabric, wood |
| Property | north, south, east, west, interior, detail | overall width, overall depth, overall height | wood, glass, stone, metal |
| Exterior structure | north, south, east, west, detail | overall width, overall depth, overall height, roof slope | wood, stone |

Premium presets also require:

- verified condition evidence
- verified macro/detail source photos for verified condition evidence
- texture-map evidence
- domain material presets
- host-targeted materials
- surface placement for verified defects

Capture presets are intake rules. They do not generate geometry, and they do not
permit the system to infer missing measurements or missing visual evidence.
Render-manifest generation also evaluates the capture against the preset derived
from `assetType + deliveryTier`. A client cannot bypass the domain shot list by
under-declaring required sectors in the capture package; missing domain sectors,
roles, material categories, measurements, texture evidence, or condition evidence
block before Blender is invoked.
Successful render manifests include the enforced `capturePreset`, so package
review can prove which domain contract was applied without recomputing it from
the original capture.
Delivery-package assembly rechecks that the render manifest's `capturePreset`
matches the supplied capture asset type and delivery tier. A mismatched preset
fails closed with `capture_preset_mismatch`.

The MCP surface exposes the preset contract directly:

- `list_digital_viewing_capture_presets`
- `get_digital_viewing_capture_preset`
- `validate_digital_viewing_capture_preset`
- `generate_digital_viewing_asset_bundle_manifest`

These tools are UI-facing and LLM-agnostic. They return machine-readable
requirements and blocking reasons before any Blender job is allowed to run.

`generate_digital_viewing_asset_bundle_manifest` is the file-readiness gate
immediately before render execution. It takes the capture, render manifest, and
known relative files in the prepared bundle, then returns deterministic status
for every required photo, texture, and expected render artifact. Missing required
assets fail closed with `asset_file_missing`; the tool never starts Blender and
never performs geometry logic. Product clients may pass `existingFiles`
explicitly or set `scanOutputDir: true` so the MCP server reads the prepared
asset files currently present under the configured output root. Scanned assets
carry `sizeBytes` and `sha256` fields, which makes the readiness manifest a
reproducible input identity record rather than only a filename checklist.
Customer delivery packages that require a premium `photoreal-render` must carry
this asset-bundle manifest forward. Without it, package assembly fails closed
with `asset_bundle_required`; a sellable photoreal package cannot be shipped
without an auditable photo/texture bundle identity.
The render manifest must also include Blender execution metadata for the same
asset bundle. If `blenderExecution.assetBundle.assetBundleHash` is absent or
does not match the supplied bundle, package assembly fails closed before any
customer-facing delivery index is considered ready.
Customer readiness reports that state as `render-asset-bundle`, keeping "files
are prepared" separate from "Blender proved the render used those files."
For premium photoreal packages, Blender execution metadata must also prove that
all host-targeted materials were applied, all declared texture maps were
applied, every scaled texture map used its declared physical scale, every
material surface mapping was preserved, every material appearance calibration
was preserved, and all verified condition evidence was rendered on its declared
host, face, and surface placement. Declared-only materials, unproven texture
scale, unproven surface mapping, unproven calibration, texture maps, or defects
are not enough for buyer-facing output because the digital viewing promise
includes visible material quality, finish, wear, and defects.
Blender execution must prove that the render camera matches the declared sector,
mode, and verified reference photo for the viewing angle. This keeps
customer-facing renders tied to the source capture rather than allowing a
plausible but untraceable camera composition.
For premium packages, that proof must include `referencePhotoIdentity` under
`blenderExecution.camera`. The identity must match the asset bundle entry for
the declared camera `referencePhoto` by path, byte size, and SHA-256. Package
generation blocks with `render_camera_reference_photo_identity_missing` when
Blender only echoes the photo path or when the reported file identity does not
match the prepared asset bundle.
For premium perspective renders, the same reference photo must also carry
camera calibration metadata: `focalLength35mmEquivalent` and `cameraDistanceMm`.
Premium orthogonal full-object reference photos carry the same calibration
fields at capture readiness so Blender can match the verified source angle
without asking the export layer to reconstruct camera geometry later. If either
field is missing from the package camera reference, package generation reports
`render_camera_reference_calibration_missing` and blocks the photoreal target.
When the metadata is present, the render manifest carries a deterministic
`cameraReference` block. Blender uses `cameraDistanceMm` as the perspective
camera placement distance and `focalLength35mmEquivalent` as the perspective
camera lens with a 36 mm sensor reference for that render. Blender writes
`appliedDistanceMm`, `appliedDistanceSource`,
`appliedFocalLength35mmEquivalent`, `appliedFocalLengthSource`, and the same
calibration block into `blenderExecution.camera`. It also writes the actual
`cameraLocationM`, `cameraTargetM`, `sensorWidthMm`, `executedYawDeg`, and
`executedPitchDeg` used by Blender. This makes the camera match traceable
through capture, render payload, Blender execution, and package review without
letting the export layer recompute camera geometry.
When a verified reference photo declares numeric `yawDeg` or `pitchDeg`,
Blender execution must write back `executedYawDeg` and `executedPitchDeg` for
those declared fields. Premium package readiness blocks when that angle
readback is missing, then compares the values against the verified reference
photo and blocks camera execution if the view angle drifts beyond the allowed
execution tolerance.
When the render preset uses `site-reference` lighting, Blender execution must
also write back the same lighting environment and reference photo. Missing
lighting proof blocks premium photoreal packages because material feel, finish,
and perceived quality depend on the captured light context. Blender execution
must also match the render manifest's declared `lightingReference`,
`colorReference`, `whiteBalanceKelvin`, and `exposureEv`; mismatched values
block with `render_lighting_reference_mismatch`.
For premium photoreal packages, Blender execution must also write back the PBR
values it actually applied per host-targeted material. Package assembly compares
those applied values with the render manifest and blocks with
`render_material_pbr_mismatch` if base color, roughness, metallic/specular,
transmission, normal source, or physical texture scale differ.
Each applied PBR block must also carry Blender material-node readback provenance;
otherwise premium package assembly blocks with
`render_material_pbr_readback_missing`. This prevents a render from claiming
material fidelity by echoing declared manifest values without proving Blender
material execution. Package readiness compares the render manifest against
`pbrReadback.values`, not only the declared `pbr` echo, so material-node drift
blocks even when an execution report repeats the manifest values elsewhere.
Blender execution must also write `sourcePhotoIdentities` for material
`photoSources`, `surfaceMapping.sourcePhoto`, and
`appearanceCalibration.sourcePhoto`. Package assembly compares each material
source identity against the asset bundle and blocks with
`render_material_source_photo_identity_missing` when the exact photo file behind
material appearance or mapping is not proven.
Blender also verifies that every material `photoSources` entry is explicitly
bound to `material:<materialId>` in the prepared asset bundle. A photo that is
present only as condition, camera, lighting, or unrelated material evidence may
not be reused as material truth by a mutated render job.
Blender execution must also write measurement-anchor metadata for every verified
geometry measurement. If those anchors are missing or incomplete, premium
package assembly fails closed because the digital viewing promise includes exact
dimensions, not only visual material fidelity.

The first Blender execution slice now consumes this contract through
`render_digital_viewing_preview`. That tool requires the exact current model-lock
`.blend` source, verifies the project and artifact hashes, executes Blender from a
unique immutable snapshot, and records the authoritative lock path rather than the
ephemeral execution path. Existing outputs, path escapes, model drift and partial
render artifacts fail closed. With a validated capture and render preset, Blender
opens the verified snapshot, applies
manifest-backed PBR material records to matching scene objects, applies texture
maps when source files exist, reports missing texture files instead of silently
inventing them, configures camera and lighting from the preset, writes the
render artifact, and writes the render manifest with Blender execution metadata.
Each generated Blender render job also carries an `executionPlacement` contract:
frontends and Termux are control planes only, Blender render work belongs on the
configured heavy worker with Hetzner/Ubuntu as the preferred geography, remote
execution must be explicitly selected, and neither render execution nor export
may mutate or reconstruct geometry.
If an `assetBundleManifest` is supplied, the render job first verifies that the
bundle is ready and that its capture/render hashes match the current render
manifest, then carries that manifest into the Blender job payload for traceable
execution. Blender writes the bundle readiness summary and `assetBundleHash`
back into the render manifest under `blenderExecution.assetBundle`, so the final
render artifact can be audited against the exact prepared asset bundle.
For premium sales rendering, every present photo and texture asset must also be
content-addressed with `sizeBytes` and `sha256`, and must carry detected image
dimensions. Path-only evidence is accepted for readiness diagnostics but is
rejected before Blender execution; hash-only evidence is still not enough for
premium photoreal rendering because the source must be a measurable image
asset, not just an arbitrary byte stream.
Texture assets must also match the declared `pixelWidth` and `pixelHeight` in
the render manifest's texture evidence. A texture file that exists, hashes
correctly, and has image dimensions is still rejected if its detected dimensions
do not match the material contract, because premium rendering must be traceable
to the exact texture resolution promised by capture evidence.
For `premium-sales`, every verified reference photo must declare `pixelWidth`
and `pixelHeight`. Missing declared photo dimensions block readiness with
`photo_resolution_missing`. The bundled photo asset must then match those
declared dimensions before premium Blender render execution is allowed. This
makes reference-angle, lighting, material, and condition photos auditable as the
exact source images the capture contract describes, instead of loosely named
files with compatible paths.
During Blender execution, the bridge resolves every present photo/texture asset
under the configured output root and rechecks its byte size and SHA-256 before
loading textures or rendering. If the file was changed after bundle creation,
rendering fails closed instead of producing a visually plausible but
untraceable image.
For applied texture maps, Blender also writes the same byte size and SHA-256
back into `blenderExecution.materialApplication.textures.applied`. The delivery
package compares this readback against the asset bundle so the final manifest
proves the renderer used the exact texture content that was prepared.
For verified condition overlays, Blender writes `sourcePhotoIdentities` for the
condition evidence photos it used. The delivery package compares each path,
byte size, SHA-256, and `usage: "condition-source"` against the asset bundle
and blocks with `render_condition_source_photo_identity_missing` when a visible
defect or wear overlay is not tied to its exact condition evidence photo.
After rendering, Blender records the produced image as `renderArtifact` with
its relative path, byte size, SHA-256, and detected pixel dimensions. This makes
the delivered preview traceable to the exact pixels produced by the locked
source scene and verified asset bundle.
Premium delivery packages require this `renderArtifact` identity whenever the
`photoreal-render` target is required; a render manifest without exact output
path, byte size, SHA-256, and pixel dimensions matching the declared render
preset remains blocked even when the renderer settings themselves passed.
If a caller supplies customer-facing `photoreal-render` artifact metadata during
package assembly, its path and hash must match Blender's `renderArtifact`
exactly. The export/package layer may format and index artifacts, but it may not
replace, reinterpret, or relabel a different image as the trusted photoreal
render.
When condition evidence has a structured surface placement, the bridge adds a
visual overlay/decal on the matching host object. These overlays are buyer-trust
evidence, not geometry authority. It does not reconstruct geometry. Rendering
also fails closed when no domain capture preset exists for the capture asset type
and delivery tier.

## Domain Profiles

Domain profiles specialize capture, not the truth model.

| Profile | Geometry Truth | Visual Truth |
| --- | --- | --- |
| Vehicle | wheelbase, length, width, height, tire/wheel sizes, panel dimensions | paint, trim, glass, dents, scratches, upholstery, wear |
| Boat | LOA, beam, draft, cabin/cockpit dimensions, hull planes | gelcoat, teak, canvas, metal fittings, waterline wear, damage |
| Property | room/facade dimensions, openings, levels, fixed objects | flooring, walls, trim, light, defects, materials, condition |
| Exterior structure | width, depth, height, slope, posts, walls, openings, levels | cladding, roof, stone, ground, weathering, visible context |

Profiles may add required fields, but may not weaken the global source-of-truth
rules.

## Material Pipeline

Material records must be structured enough for Blender PBR rendering.

Required material fields:

- `materialId`
- `hostElementId`
- `category`
- `baseColor`
- `roughness`
- `metallic`
- `specular`
- `transmission` or transparency where relevant
- `normalSource`
- `textureScale`
- `presetId` when a domain material preset is used
- `textureMaps`
- `photoSources`
- `confidence`
- `provenance`

Optional fields:

- paint code, NCS, RAL, manufacturer color, wood species, fabric/leather type
- scratch, dent, stain, crack, fading, oxidation, patina, seam, and repair
  annotations
- measured texture repeat or grain direction
- condition placement for render overlays:
  - `hostElementId`
  - surface face
  - normalized `u`/`v` position
  - overlay width/height in millimeters
  - rotation in degrees
- verified macro/detail source photos for premium condition claims

Current domain material presets:

- `automotive-white-paint`
- `automotive-metallic-paint`
- `marine-gelcoat`
- `clear-glass`
- `dark-rubber`
- `brushed-metal`
- `black-leather`
- `natural-wood`
- `painted-wood`
- `stone-masonry`
- `matte-plastic`

Premium material authoring treats texture-map quality as blocking evidence, not
decoration. Required PBR maps must declare:

- source photo
- physical `scaleMm`
- `pixelWidth`
- `pixelHeight`
- correct color space (`sRGB` for `baseColor`, `Non-Color` for data maps)

Without physical scale, Blender texture mapping is not reproducible. Without
pixel dimensions, render quality is implicit and cannot be sold as verified
photorealistic material evidence.

Material outputs must distinguish:

- measured or specified material
- photo-observed material
- inferred approximate material
- unknown material

## Photorealistic Rendering Rules

Photorealistic rendering is a delivery target, not a geometry authority.

Rendering must use:

- locked Blender geometry
- structured PBR materials
- photo-derived texture evidence with provenance
- visible uncertainty for missing or occluded areas
- domain-appropriate lighting presets
- deterministic render manifests

Photorealistic outputs must never be used to claim that unverified geometry,
condition, damage, or quality is known.

## Render Manifest Contract

Every photorealistic render must be accompanied by a deterministic render
manifest. The manifest is the product contract for render delivery.

The render manifest must record:

- capture, project, and asset identity
- explicit `notGeometryAuthority: true`
- source-of-truth rules for geometry, visual evidence, Blender, and export
- hash of the validated capture input
- geometry hash derived only from verified measurements
- separate material and condition hash
- material authoring plan hash
- render preset hash for camera, renderer, resolution, lighting, and output path
- manifest hash
- declared renderable model element registry used for host binding
- measurement anchors with declared value, unit, tolerance, source-of-truth,
  and an explicit geometry-validation method when Blender readback is required
- source-backed PBR material records
- enforced domain capture preset identity and requirements
- material surface mapping for deterministic Blender texture placement
- material appearance calibration for reproducible color and finish
- site-reference lighting evidence with lighting, color, white-balance, and
  exposure metadata
- material preset identity and texture-map slots
- condition evidence with verification and photo provenance
- warnings that must remain visible in review surfaces
- deterministic artifact paths

The render manifest must block when either the base capture contract or the
domain capture preset is invalid. This keeps photorealistic quality from
becoming a hidden fallback for missing measurements, missing photos, missing
domain-specific views, or unverified condition claims.

The render camera sector must also be backed by a verified photo in the capture
package. A render preset may not request a customer-facing view from a sector
that was never captured or verified, because the resulting image would no
longer be traceable to the source photos used for place, material, and visual
review.

For perspective renders using `site-reference` lighting, the camera must also
declare `camera.referencePhoto`. The photo must be verified, unoccluded, from
the same sector as the requested camera, and captured as a full-object or
full-sector view. This prevents Blender perspective framing from becoming a
hidden approximation layer.
The delivery package also verifies the exact camera reference photo file used
by Blender against the asset bundle. This keeps a reused filename, replaced
photo, or stale local file from silently changing the render alignment evidence.

When a render preset uses `site-reference` lighting, the preset must include a
`referencePhoto` from the capture package. That photo must be verified,
unoccluded, and captured as a full-object or full-sector view with a role of
`geometry_alignment`, `material`, or `context`. Detail-only condition photos may
not drive site lighting, because lighting affects perceived material quality and
must remain traceable to place-level visual evidence. The same photo must also
include `lightingReference`, `colorReference`, `whiteBalanceKelvin`, and
`exposureEv`; otherwise premium photoreal rendering is blocked instead of
guessing the scene illumination. Studio, neutral, and overcast presets do not
require a reference photo.
For `site-reference` lighting, Blender must also write
`blenderExecution.lighting.referencePhotoIdentity`. The package compares that
identity with the asset bundle by path, byte size, and SHA-256, and blocks with
`render_lighting_reference_photo_identity_missing` when the exact lighting
reference file is not proven.

The render manifest also carries the declared renderable model element registry.
This registry binds measurements, materials, and condition evidence to actual
host objects in the locked Blender scene. Changing that registry changes the
material/condition render-binding hash, while the geometry hash remains derived
only from verified measurements.

Blender execution must validate that every declared renderable model element
exists in the locked source scene before applying materials, condition overlays,
lighting, cameras, or rendering. Missing hosts are blocking errors, not warnings,
because otherwise the render could silently diverge from the measured capture
contract.

Blender execution must also write back every verified geometry measurement it
used as an applied measurement anchor. An `axis-extent` anchor additionally
records axis, actual locked-host extent, difference, tolerance, and
`withinTolerance: true`; an out-of-tolerance extent is a blocking pre-render
error. Premium delivery-package generation
compares those Blender execution values against the capture measurements and
blocks when any value is missing or mismatched. This keeps measurements as the
single source of truth through photorealistic rendering.

Premium digital-viewing render jobs must also validate that every declared
texture-map file exists under the controlled output root before Blender starts.
Missing texture files are blocking input failures for premium sales output, not
post-render warnings, because a photorealistic render without its declared
material evidence would misrepresent finish, quality, and visible defects. Draft
preview output may still render with missing texture files, but the resulting
material report must keep those maps visible as missing evidence.

Premium render jobs must likewise validate every declared reference photo path
used by camera framing, site lighting, material photo sources, material surface
mapping, appearance calibration, texture-map provenance, and condition evidence.
A manifest path is not sufficient proof of evidence: the referenced image file
must exist under the controlled output root before Blender starts. This keeps
the chain `photo evidence -> material/context interpretation -> Blender render`
observable and fail-closed.

The same file requirements are exposed before Blender through a deterministic
asset-bundle manifest. The bundle manifest lists every required photo, texture,
and expected render output, records which part of the pipeline uses each file,
and marks each asset as `present`, `missing`, or `expected`. This is the API/UI
readiness surface for capture upload and customer review: it can show exactly
which reference image or texture file is missing before execution reaches the
renderer.

Delivery package manifests may include the asset-bundle manifest as a required
`asset-bundle-manifest` artifact. When supplied, the package validates that the
bundle is ready and that its capture/render hashes match the render manifest.
When `assetBundleManifestPath` is supplied, the package includes both the bundle
hash and the relative manifest path. This preserves the customer-facing
traceability chain from delivered render back to the exact prepared photo and
texture bundle.
The `customerReadinessSummary.nextActions` surface reports incomplete bundle
file readiness as a concrete ratio, for example `4/9 required photo, texture,
or render assets missing from the prepared bundle`, so missing capture or
texture files are repaired before Blender execution rather than hidden inside a
generic photoreal failure.

## Material And Condition Report

Digital viewing deliveries can include a deterministic material and condition
report. The report summarizes evidence; it does not reconstruct geometry.

The report records:

- geometry-impacting measurements and their confidence/source
- verified photo sectors and roles
- PBR material records, host elements, presets, provenance, and photo sources
- texture-map slots and whether Blender reported them as declared, applied,
  missing, or skipped
- visible condition evidence such as scratches, wear, stains, repairs, or
  weathering
- verified inspection zones, including clear and defect-found areas
- condition overlay status from Blender execution when a render manifest is
  provided
- delivery readiness blocking reasons and warnings
- optional deterministic JSON artifact output under the configured output root

This report is intended for buyer trust, internal review, and QA. It makes
material realism and visible defects auditable without letting photorealism
hide missing evidence.

The report also exposes a deterministic `conditionVisibilityChecklist`. Every
verified condition evidence item is listed with source photos, linked inspection
zones, host element, material surface, surface placement, and Blender render
status. Condition rows and checklist rows also carry `sourcePhotoEvidence`,
preserving each condition photo's verification state and declared material
categories beside the defect itself. For premium sales output, this checklist is
the buyer-facing contract that visible wear, damage, repairs, weathering, and
other quality-affecting details were not hidden by the photorealistic render or
detached from their material-specific source photos.

## Blender Render Execution Gates

The Blender execution report is part of the render contract. A render is not
considered valid only because an image file exists.

The capability manifest must allow the `measured-digital-viewing` pipeline and
the exact render strategies used by the job:

- `locked-blender-source`
- `pbr-materials`
- `texture-map-application`
- `condition-overlays`
- `blender-camera`
- `blender-lighting`
- `render-manifest`

Render manifest creation fails closed when any required strategy is unsupported
or prohibited. This makes photorealistic rendering capability-driven in the same
way permit exports are template-driven.

The integration test suite verifies that Blender writeback records:

- the locked source `.blend` and generated output `.blend`
- deterministic render and manifest artifact paths
- render-manifest hashes
- material application per host object
- material surface mapping per applied host
- material appearance calibration per applied host
- missing material hosts instead of silent ignore
- applied, missing, and skipped texture maps with declared physical scale
- condition overlays, their exact host, face, surface placement, Blender
  visibility proof for the created overlay object, and material readback from
  the applied condition material
- camera mode, sector, reference photo, lighting strategy, and site-reference lighting photo
- all generated artifacts under the controlled output root

This keeps material quality, texture evidence, and condition visibility
observable without allowing the renderer to mutate or infer geometry.
Premium delivery packaging also checks the material/condition report's
`conditionVisibilityChecklist`. A buyer-visible condition item is not considered
delivered until Blender execution metadata proves it was rendered as visible
evidence. That proof must come from the created Blender overlay object and
include the object name, `visibleInRender: true`, and physical overlay
dimensions matching the verified surface placement. It must also include
`materialReadback` from the applied Blender condition material: base color,
alpha, roughness, metallic, condition type, and severity.
The delivery package also exposes a deterministic
`photorealQualityChecklist` for UI and customer review. It summarizes the
passing/failing evidence for the asset bundle, measurement anchors, material
application with calibrated appearance and surface mapping, texture application,
texture-scale application, matched Blender color-space execution, visible
conditions, camera reference, and lighting reference without adding new geometry
logic. Each checklist item also carries
trace hashes back to the capture, render manifest, and relevant
material-condition or asset-bundle artifact, so the UI can show why a package is
ready without turning the checklist into a new source of truth.

## Output Targets

| Output | Purpose |
| --- | --- |
| Blender `.blend` | Authoritative local renderable asset. |
| GLB/glTF | Web, viewer, and commerce preview. |
| USD/USDZ | Apple spatial and AR delivery. |
| Unreal/real-time package | High-fidelity showroom or walkthrough. |
| Technical PDF/images | Documentation and measured review. |
| Material/condition report | Buyer trust and inspection support. |
| Manifest | Reproducibility, provenance, confidence, and audit. |

## Delivery Package Manifest

Sales-grade digital viewing should ship as a package, not a loose set of files.
The delivery package manifest is the deterministic index for that package.

Delivery profiles define the commercial surface before the package is built.
They are product contracts, not renderers:

- `internal-review`: QA package for geometry, material, and condition review
- `sales-listing`: buyer-facing digital viewing package
- `showroom`: guided interactive presentation package
- `broker-preview`: listing review with measured technical context
- `permit-support`: measured visualization and technical review package

Before package assembly, profile readiness is evaluated against the capture's
declared `outputTargets`. Required profile targets must be declared or the
delivery blocks with `profile_target_not_declared`. Optional profile targets can
warn, but they do not block. This keeps the product promise explicit: a sales
listing, showroom package, broker preview, or permit-support pack must not imply
outputs that were never requested and produced.

It records:

- capture, project, asset type, and delivery tier
- customer surface: `internal-review`, `sales-listing`, `showroom`,
  `broker-preview`, or `permit-support`
- explicit `notGeometryAuthority: true`
- source-of-truth rules for measurements, photos, Blender, and package layout
- required package artifacts
- requested delivery targets and their readiness
- customer readiness summary derived from targets, quality checks, and gates
- photo evidence coverage for camera, lighting, material, texture, and
  condition evidence
- capture angle coverage for required sectors, shot roles, camera mode, yaw,
  coverage, occlusion, and endpoint visibility
- measurement evidence coverage for verified dimensions and Blender anchor
  application
- material render coverage for PBR hosts, texture maps, calibration, and
  Blender application status
- PBR material completeness coverage for renderable PBR fields, normal source,
  texture scale, and premium texture-map requirements
- render execution coverage for camera, lighting, render paths, and asset
  bundle binding from Blender execution metadata
- condition render coverage for visible condition evidence, placement matching,
  and verified inspection zones
- render artifact path
- render-manifest hash
- material authoring plan hash
- material/condition report hash
- capture hash
- package hash
- quality gates and warnings
- dimension overlay coverage for verified measurements that are ready to be
  shown in customer digital viewings

The package manifest does not create geometry, render images, or infer missing
evidence. It only proves that the final customer-facing delivery is assembled
from a capture, render manifest, material authoring plan, and
material/condition report that all agree.
The `customerReadinessSummary` is the operator-facing sellability surface: it
declares ready vs blocked, counts required targets and photoreal quality checks,
includes photo-evidence readiness, capture-angle readiness, Blender
material-category readiness, Blender material-render evidence,
inspection-zone readiness, condition-overlay readiness, dimension-overlay
readiness, and Blender render-quality readiness, and lists deterministic next
actions without becoming a new validation or geometry source.
When referenced photo evidence is missing or unverified, `nextActions` must
report the verified evidence count, for example `33/38 referenced photo evidence
items verified for customer trust`, so material, lighting, camera, texture, and
condition claims cannot lean on untrusted images.
When required capture angles are missing or mismatched, `nextActions` must
report the exact matched-shot count, for example `4/5 required capture angles
matched for customer visual reference`, so wrong or incomplete photo references
cannot silently proceed to customer viewing.
When domain-required material categories are missing, `nextActions` must report
the covered category count, for example `4/5 domain-required material categories
present in the render manifest`, so a car, boat, property, or structure cannot
be sold as photorealistic while a required surface class is absent.
When domain-required inspection zones are missing or unverified, `nextActions`
must report the verified zone count, for example `4/5 domain-required inspection
zones verified before customer condition disclosure`, so "no visible defect" is
also a verified state rather than an untracked absence.
It blocks customer readiness when render-quality coverage is missing or below
the customer-ready profile. When material fidelity is blocked by Blender
execution, `nextActions` must identify the exact proof class that failed, such
as host material application, texture-map application, texture color space,
surface mapping, or appearance calibration.
When condition disclosure is blocked by missing or mismatched Blender execution,
`nextActions` must report the exact visible-overlay readiness count, for example
`0/1 visible condition overlays ready for customer disclosure`, so defects,
wear, stains, repairs, and other buyer-visible conditions cannot disappear into
a generic failure.
The `evidenceHealthSummary` is the UI-facing evidence health surface. It is
derived from `sourceTraceIndex`, `qualityGates`, and
`customerReadinessSummary`; it counts indexed, ready, blocked, and missing
evidence by capture shots, measurements, materials, conditions, and delivery
targets. It also carries `evidencePathCount` totals per section and overall,
derived only from `sourceTraceIndex.path` and `sourceTraceIndex.evidencePaths`,
so weak clients can show source-photo/link density without traversing material
or condition internals. It exists so sales, broker, showroom, and review
interfaces can show evidence health without reinterpreting gates or creating
new truth. Manifest validation rejects health summaries whose totals, path
counts, or section counts do not match the source trace index. The summary
status must also match derived readiness from quality gates, customer readiness,
and blocked or missing evidence counts. Evidence health sections are also
unique; duplicate section names are rejected
instead of being merged or interpreted by clients. `warningCount` must match
quality-gate warnings, and each section status must match its blocked or missing
evidence counts.
The `viewerLayerCoverage` section is the customer-viewer layer audit surface.
It reduces the package into the layers a sales or broker viewer may expose:
photoreal scene, material fidelity, condition disclosure, dimension overlays,
and web delivery. Each layer is ready, blocked, or not requested, with evidence
derived from existing delivery targets, render evidence, overlays, and the
condition report only. The `photoreal-scene` layer is ready only when the
photoreal checklist passes and Blender render-quality coverage is ready. Each
layer also includes deterministic `sourceIds`, so the viewer UI can open the
exact delivery target, material, condition, or measurement source behind a
visible layer.
The `customerViewingChecklist` section is the buyer/operator checklist for the
same package. It summarizes whether reference photos, dimension overlays,
material fidelity, condition disclosures, photoreal render quality, requested
model artifacts (`blend`, `glb`, or `usdz`), and optional web-model delivery are
ready. It is derived only from existing coverage sections and delivery targets;
it must never become a new geometry, material, or defect source.
The `material-fidelity` row is derived from `materialRenderCoverage`,
`materialCalibrationCoverage`, and `pbrMaterialCompletenessCoverage` together:
complete PBR definitions and ready calibration are not enough unless Blender
also reports the declared material hosts, texture maps, texture color spaces,
surface mappings, and appearance calibration as applied.
When `web-viewer` is requested, the checklist treats a ready model artifact as
an implicit requirement and blocks the web-model item until a ready `blend`,
`glb`, or `usdz` artifact exists in the same package manifest.
Each checklist item includes `sourceCoverage`, so UI clients can deep-link the
operator from a buyer-facing readiness item to the exact package evidence
section that made it ready or blocked. Each item also includes deterministic
`sourceIds`, pointing to the concrete shot IDs, measurement IDs, material IDs,
condition IDs, or delivery target IDs behind that readiness row.
The `sourceTraceIndex` section is the manifest-level lookup table for those
IDs. It maps each ID to its source type, coverage section, label, status, and
optional relative path. Material and condition entries also carry
`evidencePaths` so a customer UI can open every photo behind material fidelity,
visible defects, or wear items instead of only the first source photo.
Each `sourceCoverage` must match its `sourceType`: capture shots map to
`captureAngleCoverage`, measurements to `dimensionOverlayCoverage`, materials to
combined material/PBR coverage, conditions to `conditionOverlayCoverage`, and
delivery targets to `deliveryTargets`.
Status values are also source-type scoped: capture shots use
`matched`/`missing`/`mismatched`, measurements and conditions use
`ready`/`blocked`, materials use `ready`/`blocked`/`incomplete`, and delivery
targets use `ready`/`missing`/`not-requested`.
Ready file delivery target trace entries must include an artifact `path`; a
package cannot claim a customer-facing external export is ready without a
deterministic file link. The embedded `material-condition-report` target is
identified by hash inside the package unless callers also provide it as a
separate delivery artifact.
`evidencePaths` are only allowed on material and condition entries. They must be
unique and sorted; manifest validation rejects duplicates or nondeterministic
ordering so viewer deep-links remain stable across repeated exports. When an
entry has `evidencePaths`, its optional `path` is the primary evidence link and
must equal the first `evidencePaths` item. The trace entries themselves must
also be sorted by `sourceType` and `sourceId`, giving lightweight viewers a
deterministic lookup order without recomputing package provenance. The index is
derived from existing package coverage only and must not become a new authority
for geometry, material, or condition truth.
Material entries use combined `materialRenderCoverage` and
`pbrMaterialCompletenessCoverage`: a complete PBR definition is indexed as
ready only when Blender execution also proves the material, texture maps,
texture color spaces, surface mapping, and appearance calibration.
Manifest validation rejects any viewer/checklist `sourceIds` that cannot
resolve in this index. It also rejects mismatched `entryCount` values and
duplicate source IDs, so the index cannot overstate, understate, or alias the
evidence it represents.
Asset-bundle manifests are checked for self-integrity at schema level and again
before Blender render-job binding. Required asset counts, missing counts, and
ready flags must match the actual photo and texture asset list; a forged ready
bundle with a missing texture is rejected before Blender execution. When an
`assetBundleHash` is present, it must match the canonical manifest contents so
asset evidence cannot be changed without changing the bundle identity.
The `renderQualityCoverage` section is the Blender render-quality audit surface.
It compares declared render preset settings with Blender execution metadata:
renderer, samples, denoising, resolution, color management, transparent film,
world color, exposure, and gamma. Blender execution writes back Filmic view
transform, look, neutral exposure, and neutral gamma so color and finish review
can be audited from the actual render settings rather than inferred from a
preview image. Premium photoreal package readiness fails when color management
is not Filmic / Medium High Contrast / exposure 0 / gamma 1. This separates
"the material is defined" from "the render was
executed with a customer-ready photoreal profile." Render-quality requirements
are domain-aware: the declared profile includes the asset type, and premium
vehicle/boat renders require stricter sampling and resolution than
exterior-structure previews before `photoreal-scene` can be exposed as ready.
Premium-sales render minimums are currently:

- vehicle and boat: `2560x1440`, Cycles `128` samples with denoise
- property: `1920x1080`, Cycles `96` samples with denoise
- exterior-structure: `1600x1000`, Cycles `64` samples with denoise
- product/custom or non-premium fallback: `1280x720` minimum resolution

Delivery-package quality gates fail with `render_quality_not_ready` whenever a
required photoreal customer render lacks Blender render-quality execution or
falls below the declared customer-ready profile.
The `materialCategoryCoverage` section is the domain-material audit surface. It
compares the capture preset's required material categories with the render
manifest material set, so a vehicle package can explicitly block material
fidelity when glass, rubber, metal, paint, or leather is missing instead of
hiding that gap inside generic PBR completeness counts. Delivery-package
quality gates fail with `material_categories_not_ready` until every required
category is present in the render manifest.
The `photoEvidenceCoverage` section is the visual-evidence audit surface. It
lists the exact capture photos used for render camera reference, site lighting,
material sources, surface mapping, appearance calibration, texture sources, and
condition evidence. It also includes inspection-zone source photos, so clear
zones and defect-found zones are both traceable to capture evidence. This keeps
"right photos from the right angles" visible in the package without letting
photos override measured geometry.
The material/condition report mirrors each capture photo's declared
`materialCategories`, allowing UI and QA surfaces to explain which material class
each photo can evidence before Blender authoring or customer delivery.
Delivery-package quality gates fail with `photo_evidence_not_ready` when any
referenced visual evidence item does not resolve to a verified capture photo.
The `captureAngleCoverage` section is the capture-preset audit surface. It
lists every required shot from the domain preset, the selected verified photo,
expected camera/angle/yaw/coverage/occlusion/endpoint rules, actual capture
metadata, and whether the shot matched. This proves that reference photos came
from the right angles before they are used for material, condition, context, or
placement review.
Delivery-package quality gates fail with `capture_angles_not_ready` when any
domain-required capture angle is missing or mismatched, so customer-facing
visual reference use cannot proceed from incomplete photo evidence.
The `measurementEvidenceCoverage` section is the geometry-truth audit surface.
It lists each verified geometry-affecting measurement with value, tolerance, unit,
confidence, source, model placement, reference frame, and whether Blender
execution preserved it as a measurement anchor. This is the customer-facing
bridge from measured truth to the rendered asset.
The `dimensionOverlayCoverage` section is the customer dimension-readiness
surface. It derives only from verified measurement placement and Blender anchor
application, then marks each measurement as ready, missing placement, or missing
anchor before a UI can draw dimension overlays in a digital viewing. It never
creates a new dimension or infers missing endpoints. Delivery-package quality
gates fail with `dimension_overlays_not_ready` until every verified geometry
measurement has placement and Blender anchor evidence.
Ready entries also include a renderable `annotation` object with display text,
value, tolerance, unit, axis, host element, reference frame, endpoints, source,
and confidence. UI and export layers may render this annotation, but must not derive
or alter measurement geometry from it.
The `conditionInspectionCoverage` section is the inspection-readiness audit
surface. It compares each required inspection zone in the domain capture preset
with verified condition-inspection evidence, including linked condition IDs and
source photos. The condition-disclosure viewer layer is blocked until every
required zone is verified; this makes "no visible defect" an explicit inspected
state rather than an untracked absence. Delivery-package quality gates also
fail with `condition_inspection_zones_not_ready` when any required zone is
missing or unverified. Inspection source photos are also material-category
checked when the photo declares `captureMetadata.materialCategories`, so a
material-scoped inspection cannot silently reuse evidence from a different
surface class.
The `conditionOverlayCoverage` section is the customer defect-readiness surface.
It derives from buyer-visible condition evidence, source photos, declared
surface placement, inspection zones, and Blender condition application. Each
scratch, wear mark, stain, crack, repair, or other condition is ready, missing
placement, missing render, or insufficiently visible before a viewer may expose
it as an overlay. Severity controls a deterministic disclosure profile:
`low-condition-disclosure`, `medium-condition-disclosure`,
`high-condition-disclosure`, or `unknown-condition-disclosure`. The profile
sets minimum physical overlay area and longest dimension in millimeters, so a
customer-visible defect cannot be hidden behind a marker that is too small for
its declared severity.
Delivery-package quality gates fail with `condition_overlays_not_ready` when
any buyer-visible condition lacks placement or a matching Blender-rendered
overlay before customer condition disclosure.
Ready entries also include a renderable `disclosure` object with title,
condition id, type, severity, verification state, host element, inspection
zones, source photos, source photo evidence with declared material categories,
and surface placement. UI and export layers may display this disclosure, but
must not derive geometry or invent unverified defects from it.
The `materialRenderCoverage` section is the material-truth audit surface. It
lists each PBR material, target host, preset, provenance, texture-map count,
surface-mapping status, declared appearance-calibration status, source photos,
per-material `sourcePhotoEvidenceCount`/`sourcePhotoEvidenceStatus`, and whether
Blender applied the material, its texture maps, declared texture color spaces,
surface mapping, and appearance calibration. It also includes per-material
`materialFidelityStatus` plus machine-readable `materialFidelityIssues`, so
customer and operator surfaces can show exactly why a material is not ready for
photoreal viewing without recomputing the rule set. Aggregate
material, host-target, applied/missing material, texture-map, surface-mapping,
and appearance-calibration counts are derived from the entries and rejected when
they drift, so package headers cannot become a second source of material truth.
Per-material source-photo evidence count/status is likewise derived from
unique, sorted `sourcePhotos`, so photo evidence for material feel cannot be
overreported or made nondeterministic through duplicate photo paths.
`materialFidelityReadyCount` and `materialFidelityBlockedCount` fields let
lightweight frontends show overall material readiness without scanning every
entry. Package-manifest validation derives those counts from
`entries[].materialFidelityStatus` and rejects mismatches, so an export cannot
claim more ready material surfaces than the underlying Blender/material evidence
proves. It also rejects any material entry whose ready/blocked status does not
match its `materialFidelityIssues`, keeping issue disclosure and material
readiness inseparable. The coverage also
reports matched and mismatched texture color-space, surface-mapping, and
appearance-calibration counts so operator/UI surfaces can identify which
material failed Blender execution proof. This keeps photorealistic output tied
to auditable material evidence instead of visual guesswork.
The `materialCalibrationCoverage` section is the customer material-fidelity
surface. It lists every photo-observed material, its appearance-calibration
method and source photo, whether that source resolves to verified,
non-occluded capture evidence, and the `lightingReference`/`colorReference`,
`whiteBalanceKelvin`, and `exposureEv` metadata that made the calibration
reproducible. Delivery-package quality gates fail with
`material_calibration_not_ready` when any photo-observed material lacks verified
appearance calibration before customer material-fidelity delivery.
The `customerReadinessSummary.nextActions` surface reports the calibration
completion ratio, for example `1/2 photo-observed material calibrations
verified`, so material appearance gaps are repaired as capture/calibration
evidence instead of being mistaken for Blender execution or PBR field problems.
When declared appearance calibration exists but Blender execution does not match
it, customer readiness reports `material-character` separately. This keeps
photo-calibrated color/finish/feel failures distinct from generic material
application or texture-map failures.
The `pbrMaterialCompletenessCoverage` section is the material-definition audit
surface. It records whether each material has renderable PBR fields, photo/none
normal source, physical texture scale, and all premium-required texture-map
types for its category. It also indexes each declared texture evidence item:
type, path, provenance, confidence, color space, physical scale, pixel size, and
source photo. This distinguishes "a material exists" from "the material is
sufficiently defined for photorealistic Blender rendering."
For `premium-sales`, it also applies deterministic material finish profiles to
customer-critical surfaces. Vehicle paint must satisfy the
`automotive-paint-finish` roughness/metallic range, marine gelcoat must satisfy
`marine-gelcoat-finish`, and common glass, metal, rubber, leather, stone, wood,
and plastic surfaces receive category profiles. A material with complete fields
and textures is still incomplete when its roughness or metallic value is outside
the profile, because customer-visible feel/quality would be misleading.
Delivery-package quality gates fail with `pbr_materials_not_ready` when any
material lacks complete PBR fields, premium-required texture evidence, or
domain-appropriate finish values.
The `customerReadinessSummary.nextActions` surface reports the concrete PBR
completion ratio, for example `4/5 renderable PBR material definitions
complete`, so operators know whether photoreal delivery is blocked by material
authoring rather than Blender execution.
The `renderExecutionCoverage` section is the render-truth audit surface. It
compares declared camera, lighting, render paths, and asset-bundle hash against
Blender execution metadata. This lets operators see whether the delivery came
from the locked render contract or from incomplete/mismatched execution.
The `conditionRenderCoverage` section is the condition-truth audit surface. It
lists buyer-visible condition evidence, source photos, inspection zones, surface
placement, and whether Blender rendered the condition on the declared host and
face. It also lists clear and defect-found inspection zones, so missing defects
and verified absence are both explicit.
Customer readiness reports missing Blender condition proof as
`condition-render`, separately from `condition-disclosure`, so a missing
rendered defect is not confused with an overlay-placement problem.

Delivery targets are explicit customer-facing outputs. If no target list is
provided, targets are derived from the selected customer surface:

| Customer surface | Required targets |
| --- | --- |
| `internal-review` | `photoreal-render`, `material-condition-report` |
| `sales-listing` | `photoreal-render`, `material-condition-report`, `glb` |
| `showroom` | `photoreal-render`, `material-condition-report`, `glb`, `web-viewer` |
| `broker-preview` | `photoreal-render`, `material-condition-report`, `technical-views` |
| `permit-support` | `technical-views`, `material-condition-report` |

The default customer surface is `internal-review`, which requires only:

- `photoreal-render`
- `material-condition-report`

If a caller requests additional targets such as `glb`, `usdz`, `web-viewer`,
or `technical-views`, the package must index those artifacts from explicit
`deliveryArtifacts` metadata (`target`, relative `path`, optional `hash`) or
fail with a blocking `delivery_target_missing` gate. This prevents a sales,
broker, showroom, or internal-review package from silently implying that a
delivery surface exists when it has not been produced. `deliveryArtifacts` are
an index of already generated outputs; they must not mutate geometry or trigger
new projection logic. Caller-provided customer artifacts must include a content
hash before the package can trust them; otherwise delivery fails with
`delivery_artifact_hash_missing`.

`web-viewer` is a composed customer surface. It may be indexed as an HTML or
viewer shell artifact, but the package blocks delivery unless a ready `glb`,
`usdz`, or `blend` model artifact is also indexed in the same manifest. This
keeps the web viewer from becoming a decorative shell without renderable model
truth.

The `viewerLayerCoverage.material-fidelity` layer is blocked when material
categories, PBR definitions, declared photo calibration, Blender material/texture
application, Blender texture color-space execution proof, Blender surface-
mapping execution proof, or Blender appearance-calibration execution proof is
incomplete. If Blender execution mismatches declared texture color spaces,
surface mapping, or appearance calibration, the layer reports the
matched/required execution count instead of presenting the material surface as
customer-ready.

If a render manifest was built from a different capture, or if the material
authoring plan no longer matches the render manifest, the package is not ready.
If the render manifest carries a capture preset from a different domain or tier,
the package is also not ready. This prevents hand-edited or stale manifests from
misrepresenting which capture contract was enforced.
This is the last contract layer before a digital viewing pack is handed to a
car dealer, boat dealer, broker, or property operator.

## Sellable Digital Viewing Package

The broader commercial package is:

```text
Measured Digital Viewing Pack
```

Customer provides:

- measurements
- structured photos
- material and condition notes
- asset metadata

Measured delivers:

- reviewed real-scale Blender model
- photorealistic preview renders
- web/spatial asset where applicable
- material and condition report
- output manifest
- optional technical dimension sheets

Every PBR render manifest is classified as `photorealistic-preview` with
`authority: preview-only`, `permitSourceOfTruth: false`, and
`geometryAuthority: false`. The current rendering path also declares
`validationStatus: not-separately-validated`; a preview cannot be promoted by
an administrator or caller field. A future validated render category requires
a separate, hash-bound validation contract and implementation.

Technical permit sheets are produced by the separate facade export path from
locked orthographic Blender line artifacts. They may show sourced material
notes, but neither material photos nor photorealistic renders become geometry
authority.

## Quality Gates

The pipeline must block when:

- geometry-impacting measurements are missing or unverified
- required photo coverage is incomplete
- material/defect claims lack source evidence
- photo alignment contradicts measured dimensions without resolution
- model is not reviewed and locked
- export attempts to reconstruct geometry outside Blender
- output manifest cannot trace assets back to source inputs

The result should be commercially useful because it is truthful, not because it
is visually flattering.
