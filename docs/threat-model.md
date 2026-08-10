# Threat Model

## Scope

This threat model covers the local MCP server, TypeScript tool layer, Blender bridge, project JSON, and local artifact generation.

Out of scope:

- Hosted SaaS deployments
- User interface authentication
- Cloud storage
- Municipal submission portals

## Assets

| Asset | Risk |
| --- | --- |
| Local photos and measurements | Private property/project data exposure. |
| Project JSON | Source-of-truth corruption or leakage. |
| Generated Blender files | Misleading geometry if mutated silently. |
| Permit-support PDFs | Overclaiming accuracy or hiding assumptions. |
| Local machine | Arbitrary code execution through Blender Python. |

## Trust Boundaries

| Boundary | Control |
| --- | --- |
| MCP tool input | Zod schema validation and strict unknown-field rejection. |
| File output | `safeOutputPath` blocks output escaping. |
| Blender execution | Local subprocess with timeout. |
| Raw Python fallback | Explicit opt-in plus restricted bridge checks. |
| Export stage | Formatting only; no geometry reconstruction. |

## Key Threats And Mitigations

| Threat | Mitigation |
| --- | --- |
| Path traversal | Reject absolute paths and `..`; constrain to output dir. |
| Silent geometry inference | Quality gates and product contract forbid export-stage inference. |
| Overclaiming CAD precision | Docs and export warnings state not CAD/BIM/DWG/STEP/survey. |
| Photo-derived hallucination | Photos remain low confidence unless calibrated. |
| Unsafe Python execution | `unsafeAllowExecution: true`, restricted tokens, audit logging. |
| Stale or unreviewed model export | `lock_model_for_export` required for facade completion package. |
| Low-confidence geometry assumptions | Quality gate blocks low-confidence assumptions that affect geometry. |
| Long-running Blender process | Configurable timeout. |

## Required Security Tests

- Unsafe Python requires opt-in.
- Path traversal is rejected.
- Unknown schema fields are rejected.
- Permit-support export fails when model is not locked.
- Low-confidence geometry assumptions block export.
- Export templates cannot alter project geometry.

## Disclosure

Report vulnerabilities through GitHub Security Advisories when the repository is public. Avoid posting exploit details in public issues.

