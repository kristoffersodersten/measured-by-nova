# Public Core Policy

## Recommended Strategy

Measured by Nova should use an open-core model.

The public repository should build trust by exposing the deterministic engine, data contracts, and local Blender integration. The commercial product should capture value in templates, UX, QA workflows, and customer delivery.

## Public Core

Suitable for the public repository:

- MCP server
- Measurement project schema
- Confidence semantics
- Source-of-truth policy
- Generic profiles
- Blender bridge basics
- Generic orthographic view generation
- Generic permit-support package contracts
- Example fixtures with synthetic data
- Contract and validation tests

## Private Or Commercial

Keep private unless intentionally released:

- Municipality-specific PDF templates
- Premium styling presets
- Guided intake UX
- Customer project data
- Real permit documents
- Batch export workflows
- Paid QA/checklist automation
- Hosted product integrations

## Fixture Policy

Fixtures must be synthetic or explicitly approved for publication.

Do not commit:

- private property photos
- real addresses
- personal names
- customer documents
- real permit case numbers
- generated PDFs from private projects

## Naming

Product:

```text
Measured by Nova
```

Repository:

```text
measured-by-nova
```

Package:

```text
nova-measured
```

Legacy binary alias:

```text
codex-blender-mcp
```

The legacy alias exists only for compatibility and should not be used in public positioning.
