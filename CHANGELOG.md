# Changelog

## Unreleased

- Renamed product positioning to Measured by Nova and package metadata to `nova-measured`.
- Reframed the server as LLM-agnostic measured visualization, not CAD/BIM/DWG/STEP.
- Added measurement-project contracts for source-of-truth policy, assumptions, and model locking.
- Added `define_assumption`, `lock_model_for_export`, and `export_facade_completion_pack`.
- Added MVP, data contract, quality gate, open-core, and template-boundary documentation.
- Added permit-support export warnings and deprecated public use of `cad-simulated`.
- Added tests for facade completion export contracts and source-of-truth defaults.

## 0.1.0

- Initial local MCP server for Blender.
- Added `blender_status`.
- Added `create_2d_sketch`.
- Added `create_3d_model`.
- Added `run_blender_python`.
- Added strict TypeScript contracts and tests.
- Added local output path protection.
