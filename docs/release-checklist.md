# Release Checklist

## Pre-Release

- [ ] Product name is `Measured by Nova`.
- [ ] Package name is `nova-measured`.
- [ ] Productization plan is current.
- [ ] README does not claim CAD, BIM, DWG/STEP, legal survey, structural engineering, or approval guarantees.
- [ ] README does not claim AI beautification, hidden condition repair, or unverified photorealistic truth.
- [ ] Namaka/Axiome alignment boundary is documented.
- [ ] NovaChat UI/UX and Environment Truth inheritance is documented.
- [ ] `SECURITY.md`, `CONTRIBUTING.md`, and `CHANGELOG.md` are current.
- [ ] Public docs link to architecture, data contract, quality gates, and threat model.
- [ ] Generated local artifacts are removed or ignored.
- [ ] Experimental scripts are clearly labeled and not part of the supported public API.
- [ ] `cad-simulated` is documented only as a deprecated legacy alias.

## Verification

Run:

```bash
pnpm lint
pnpm test
pnpm build
```

Required result:

- all lint checks pass
- all tests pass
- TypeScript build succeeds
- `blender/bridge.py` is copied into `dist/blender`

## GitHub Rename

When ready to rename the repository:

```bash
gh repo rename measured-by-nova
git remote set-url origin git@github.com:kristoffersodersten/measured-by-nova.git
```

GitHub redirects the old URL, but local remotes should still be updated.

## Public Core Boundary

Before publishing:

- [ ] Keep core MCP, measurement schema, and generic Blender bridge public.
- [ ] Keep municipality-specific premium templates out of the open-core repo unless intentionally released.
- [ ] Keep private customer examples and real permit materials out of public fixtures.
- [ ] Keep generated renders, private photos, and customer delivery outputs out of public git.

## First Paid Pilot

Before selling the first assisted delivery:

- [ ] Capture-to-fixture works on a private real project.
- [ ] Missing geometry-impacting capture fields produce machine-readable blockers.
- [ ] Material, defect, and condition evidence is provenance-tagged.
- [ ] Photorealistic renders are separated from geometry truth and permit truth.
- [ ] Blender model is reviewed and locked before export.
- [ ] Export package includes measurement list, material notes, confidence legend, and limitations.
- [ ] Customer delivery folder is outside the public repository.

## Release Notes

Every release should state:

- added tools
- changed contracts
- migration notes
- known limitations
- security-relevant changes
