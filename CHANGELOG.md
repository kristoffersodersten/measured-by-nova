# Changelog

## Unreleased

No unreleased changes.

## 0.2.0 - 2026-08-30

### Added

- Added the executable three-panel truth workspace with live capture, validation,
  Blender execution, model-lock, delivery, locality, confidence, provenance and
  human-intervention states.
- Added real capture-to-Blender delivery verticals for supported asset domains,
  source-backed planar projection, locked GLB/OBJ/USDZ export, photoreal preview,
  offline web viewing and customer-downloadable evidence packages.
- Added signed Ed25519 capture intake, immutable verification evidence, explicit
  `Verified`, `Partially Verified`, `Reference` and `Disputed` states, and a
  local native signing boundary that does not read or serialize private keys.

### Changed

- Renamed the product and package to Measured by Nova / `nova-measured` and
  clarified the local-first measured-visualization boundary: it is not CAD,
  BIM, surveying, structural approval or fabrication-authority software.
- Bound every customer render and export to reviewed Blender model-lock truth;
  export stages no longer reconstruct or silently mutate geometry.
- Upgraded release admission to exact-SHA protected CI, dependency audit,
  coverage, full Blender E2E and negative paths, and reproducible clean-install
  package verification.

### Security

- Added canonical filesystem containment, bounded streaming metadata, atomic
  crash recovery, cross-process write serialization, signing-key revocation,
  hostile signature rejection and live artifact-drift detection.
- Manual uploads remain `Reference`; administrator, caller or model output
  cannot upgrade trust without a valid native signature and unchanged evidence.

### Migration

- Consumers using the legacy `codex-blender-mcp` binary may continue to do so;
  new integrations should use `nova-measured`.
- Existing capture data is not implicitly upgraded to signed native evidence and
  must be re-intaken under the publication-trust contract when verified status
  is required.

### Known limitations

- A native host adapter remains responsible for consent and unlocking an
  approved local Ed25519 private key; the package never discovers or exports it.
- Custom asset types require an explicit project-specific capture preset.

## 0.1.0

- Initial local MCP server for Blender.
- Added `blender_status`.
- Added `create_2d_sketch`.
- Added `create_3d_model`.
- Added `run_blender_python`.
- Added strict TypeScript contracts and tests.
- Added local output path protection.
