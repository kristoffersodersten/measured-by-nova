# Measured by Nova

LLM-agnostic, local-first Model Context Protocol server for spatial reconstruction: physically accurate Blender models from exact measurements, structured multi-angle photography, and material metadata.

## Description

Measured by Nova connects any MCP-capable client to a local Blender installation over stdio. Its primary workflow is a spatial reconstruction project: verified dimensions, calibrated or structured photos, spatial constraints, and material metadata become deterministic 1:1 Blender geometry, photorealistic material/render outputs, and optimized downstream assets.

Measured is intended for high-trust digital viewing workflows where exact scale,
material quality, surface defects, wear, and spatial feeling must be preserved:
vehicles, boats, real estate, exterior structures, products, and other physical
assets where buyers need inspectable representation rather than flattering
imagery.

Technical package name: `nova-measured`.
Git repository name: `measured-by-nova`.

The server is designed for sovereign local creative workflows: Blender runs on the user's machine, generated `.blend` files are written to a local output directory, and no telemetry or cloud fallback is included.

## Product Boundary

Measured is not CAD, BIM, DWG/STEP export, legal surveying, or fabrication-grade tolerance software. It is a spatial reconstruction and physically measured visualization pipeline.

Measured is also not an image-generation or beautification product. Photorealistic
renders are delivery artifacts generated from locked Blender geometry and
source-backed material evidence; they are not allowed to invent condition,
damage, material quality, or geometry.

Source-of-truth rules:

- Exact measurements, drawings, explicit constraints, and calibrated anchors are authoritative for model construction.
- Structured photos provide camera-pose, texture, material, and validation evidence; they are not allowed to override measured dimensions.
- Blender geometry is the only renderable truth.
- Blender geometry, USD/glTF exports, and orthographic views are generated from the same locked 1:1 model.
- Export templates may add layout, labels, scale bars, metadata, and notes only; they must not infer or reconstruct geometry.
- The LLM is optional orchestration and is never authoritative.

Governance rules:

- Measured is subordinate to the Namaka constitution and Axiome Core execution
  model.
- Any future UI must follow NovaChat's Minimalistic Utilitarian Elegance and
  Environment Truth contracts.
- Capture, validation, rendering, export, and UI must expose locality,
  confidence, provenance, and required human intervention.

## Product Scope

Measured by Nova is a Spatial Reconstruction Framework.

It is intended to reconstruct physical objects into accurate, editable, photorealistic 3D models from:

- exact geometric measurements such as length, width, height, angles, radii, thicknesses, offsets, and tolerances
- standardized 360-degree photo capture with defined camera positions
- material metadata such as finish, color, reflectance, roughness, transparency, and texture scale
- spatial structure such as planes, openings, edges, anchors, levels, and object relationships

Target domains include car dealers, boat dealers, real estate brokers, renovation
operators, consumer products, public environments, spatial commerce, virtual
walkthroughs, and permit-support documentation.

## MVP Focus

The first narrow vertical slice remains a facade-completion package for small building projects. It is a validation slice for the broader reconstruction architecture: measure, verify, generate a reviewed 3D representation, then export permit-support facade documentation.

The broader product direction is a measured digital viewing pipeline: structured
photos provide material, condition, and place evidence; exact measurements remain
the source of truth for geometry and placement; Blender is the reviewed
renderable truth; domain-specific exports package the locked result.

See [MVP product contract](docs/mvp.md).

## Features

- Create spatial reconstruction projects with confidence-tagged dimensions, camera captures, material metadata, planes, openings, steps, and profiles.
- Validate digital viewing capture packages for vehicles, boats, properties, exterior structures, and products. Custom captures are extension contracts and fail closed until a project-specific preset is supplied.
- Generate deterministic 1:1 Blender models from typed parametric profiles and measured constraints.
- Align geometry with structured photographic evidence without letting photos override exact measurements.
- Support photogrammetry-assisted texture projection and PBR material workflows as the pipeline matures.
- Export `.blend`, `.glb`, `.obj`, orthographic elevation views, permit-support PDFs, and future real-time engine targets.
- Keep legacy 2D sketch and primitive 3D tools for low-level utility work.
- Run explicit Blender Python only as an unsafe opt-in fallback.
- Validate all tool inputs with typed Zod contracts.
- Keep output paths constrained to `BLENDER_OUTPUT_DIR`.
- Use local Blender execution only.

## Requirements

- Node.js `>=20.11.0`
- pnpm
- Blender installed locally

On macOS, the default Blender path is:

```bash
/Applications/Blender.app/Contents/MacOS/Blender
```

If Blender is elsewhere, set `BLENDER_PATH`.

## Installation

```bash
pnpm install
pnpm build
```

## Configuration

```bash
export BLENDER_PATH="/Applications/Blender.app/Contents/MacOS/Blender"
export BLENDER_OUTPUT_DIR="$PWD/outputs"
export BLENDER_TIMEOUT_MS=120000
```

If `BLENDER_PATH` is unset, the server tries `/Applications/Blender.app/Contents/MacOS/Blender`, then `blender` from `PATH`.

## MCP Client Config

After building the project, register the server with your MCP client:

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

## Tools

| Tool | Purpose |
| --- | --- |
| `blender_status` | Verifies that the local Blender executable is reachable. |
| `create_measurement_project` | Creates a measurement-driven project JSON workspace. |
| `import_reference_photos` | Imports non-calibrated photos as low-confidence reference or validation inputs. |
| `define_known_dimension` | Adds permit, drawing, or manually measured dimension constraints. |
| `define_reference_plane` | Adds measured or inferred reference planes. |
| `define_opening` | Adds door, window, or open bay constraints. |
| `define_step_run` | Adds measured stair runs. |
| `define_assumption` | Records explicit assumptions with confidence and geometry impact. |
| `create_parametric_profile` | Attaches a typed profile such as `carport`. |
| `generate_measured_model` | Generates deterministic Blender visualization geometry from project state. |
| `validate_model` | Validates geometry and confidence rules. |
| `lock_model_for_export` | Locks a human-reviewed model before permit-support export. |
| `generate_elevation_views` | Creates orthographic plan, elevation, and section views. |
| `export_model` | Exports measured artifacts as `.blend`, `.glb`, and/or `.obj`. |
| `export_dimensioned_drawings` | Generates a permit-support visualization PDF artifact. |
| `export_facade_completion_pack` | Exports the MVP facade-completion package from a locked model. |
| `export_project_template` | Exports recipient-specific packages such as `permit-facade-pack`, `gothenburg-permit`, or `client-preview`. |
| `create_2d_sketch` | Creates curve-based 2D strokes and saves a `.blend` file. |
| `create_3d_model` | Creates a primitive-based 3D scene and saves a `.blend` file. |
| `run_blender_python` | Unsafe fallback only; requires explicit opt-in. |

## Measurement Workflow

```json
{ "projectId": "carport-demo", "unit": "mm" }
```

Then import structured reference photos, define known dimensions, attach a profile, validate, generate the 1:1 model, review it, lock it, and export the requested output profile. The carport profile is the first fixture and uses width, depth, roof slope, high/low side heights, foundation heights, step runs, openings, material references, and context references as structured inputs.

Output is intentionally profile-oriented: the same measured project can later target permit-support drawings, customer previews, fabrication packages, web viewers, or internal QA without changing the source geometry.

## Digital Viewing Capture

Public trust classification is governed by the signed capture-package contract
in [`docs/publication-trust.md`](docs/publication-trust.md). Manual uploads remain
reference evidence and internal scores cannot upgrade public verification.

Compute routing and remote verification follow
[`docs/compute-distribution.md`](docs/compute-distribution.md), with operator and
workspace rules in [`docs/operator-tooling.md`](docs/operator-tooling.md) and
[`docs/remote-workspace.md`](docs/remote-workspace.md).

The broader digital viewing pipeline starts with a strict capture contract. A
capture package declares asset type, measured dimensions, required photo sectors,
PBR material evidence, condition/wear evidence, assumptions, and output targets.

Example fixtures:

```bash
fixtures/digital-viewing-vehicle-capture.json
fixtures/digital-viewing-carport-capture.json
```

Validation rules are fail-closed:

- unverified geometry-impacting measurements block model lock/export
- missing required photo sectors block capture acceptance
- photo-observed materials must reference source photos
- verified scratches, dents, stains, repairs, or wear must reference source evidence
- photos remain non-authoritative for geometry even when they are used for
  material and condition evidence

Supported export templates are `permit`, `permit-facade-pack`, `swedish-municipality`, `gothenburg-permit`, `measured-visualization`, `client-preview`, `fabrication`, `qa-validation`, `site-context`, `photo-alignment`, `measurement-book`, `web-viewer`, and `archive`.

`cad-simulated` remains as a deprecated legacy alias for old clients. New integrations should not use CAD wording because the export is a measured Blender visualization, not a CAD-kernel result.

## Example: 2D Sketch

```json
{
  "strokes": [
    {
      "points": [[0, 0], [1, 1], [2, 0]],
      "color": "#111111",
      "width": 4
    }
  ],
  "outputFile": "line-sketch.blend"
}
```

## Example: 3D Model

```json
{
  "primitives": [
    {
      "kind": "cube",
      "location": [0, 0, 1],
      "scale": [1, 1, 1],
      "color": "#8fb3ff"
    },
    {
      "kind": "sphere",
      "location": [2, 0, 1],
      "scale": [0.75, 0.75, 0.75],
      "color": "#f28c8c"
    }
  ],
  "outputFile": "primitive-scene.blend"
}
```

## Development

```bash
pnpm install
pnpm build
pnpm lint
pnpm test
```

Run the server directly:

```bash
pnpm start
```

## Security And Locality

- No telemetry.
- No cloud fallback.
- No external provider calls.
- Blender execution stays on the local machine.
- Generated files are constrained to the configured output directory.
- `run_blender_python` executes arbitrary Blender Python and should only be used with trusted, explicit user intent.

## Documentation

- [Tool contracts and operation guide](docs/blender-mcp.md)
- [Architecture](docs/architecture.md)
- [Spatial reconstruction pipeline](docs/spatial-reconstruction.md)
- [Digital viewing pipeline](docs/digital-viewing-pipeline.md)
- [Namaka alignment contract](docs/namaka-alignment.md)
- [UI/UX contract](docs/ui-ux-contract.md)
- [MVP product contract](docs/mvp.md)
- [Productization plan](docs/productization.md)
- [Measurement data contract](docs/data-contract.md)
- [Quality gates](docs/quality-gates.md)
- [Threat model](docs/threat-model.md)
- [Public core policy](docs/public-core.md)
- [Release checklist](docs/release-checklist.md)
- [Security policy](SECURITY.md)
- [Contributing guide](CONTRIBUTING.md)
- [Changelog](CHANGELOG.md)

## License

MIT
