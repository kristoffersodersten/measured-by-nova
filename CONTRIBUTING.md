# Contributing

Thanks for improving Measured by Nova.

## Development Setup

```bash
pnpm install
pnpm build
pnpm lint
pnpm test
```

## Standards

- Keep TypeScript strict.
- Validate public tool inputs with Zod.
- Keep Blender execution local by default.
- Add tests for new contracts, validation rules, and failure paths.
- Document new public tools in `README.md` and `docs/blender-mcp.md`.
- Keep public wording LLM-agnostic.
- Do not describe outputs as CAD, BIM, DWG/STEP, survey-grade, or approval-guaranteed.
- Prefer structured MCP tools over raw Blender Python.
- Keep export code as formatting only; geometry must come from Blender orthographic views.
- Preserve confidence labels and assumptions in project state.

## Pull Request Checklist

- [ ] `pnpm build` passes.
- [ ] `pnpm lint` passes.
- [ ] `pnpm test` passes.
- [ ] New tool contracts are documented.
- [ ] Security implications are described for new execution paths.
- [ ] Product boundary is preserved: measured visualization, not CAD.
- [ ] New export paths require or respect `modelLock` when permit-support output is involved.
- [ ] Generated local artifacts are not committed unless intentionally added as fixtures.

## Release Notes

Update `CHANGELOG.md` for user-visible changes.
