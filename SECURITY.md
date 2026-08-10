# Security Policy

## Supported Versions

The current supported version is the latest commit on `main`.

## Local Execution Model

Measured by Nova is local-first:

- It starts Blender on the local machine.
- It does not send prompts, files, metadata, or generated assets to remote services.
- It does not include telemetry.
- It does not include cloud fallback.

## Reporting A Vulnerability

Please report vulnerabilities through GitHub Security Advisories or by opening a minimal issue that does not disclose exploit details publicly.

Include:

- affected version or commit
- operating system
- Blender version
- reproduction steps
- expected and actual behavior

## High-Risk Surface

`run_blender_python` executes local Blender Python. Treat it as a trusted-code fallback only. MCP clients should expose it only when the user explicitly intends to run local Blender Python.

Structured tools must be preferred over raw Python. New features should add typed, validated tools instead of expanding arbitrary code execution.

## Path Safety

Generated output filenames are constrained to `BLENDER_OUTPUT_DIR`. Path traversal outside that directory is rejected.

## Product Safety Boundary

Measured by Nova produces measured visualization and permit-support documentation. It does not produce CAD, BIM, DWG/STEP, legal survey output, structural calculations, or approval guarantees.

Security-sensitive product rules:

- Photos are reference data unless calibrated.
- Missing geometry must produce warnings, not guesses.
- Permit-support export requires a locked, human-reviewed model.
- Export code must not reconstruct or mutate geometry.
- Output must identify assumptions and low-confidence details.

## Supply Chain

- Keep dependencies minimal.
- Run `pnpm audit:security` before release; critical and high-severity advisories block release.
- Run `pnpm lint`, `pnpm test`, and `pnpm build` before release.
- Security overrides in `pnpm-workspace.yaml` pin patched transitive versions until their direct parents adopt them. Review and remove each override when upstream constraints make it redundant.
- Keep the minimum-release-age policy enabled. Do not bypass it to consume a newly published security fix; select the oldest compatible patched release that satisfies both gates.
- Do not commit generated `.blend`, PDF, PNG, cache, or local output artifacts unless they are intentional fixtures.
