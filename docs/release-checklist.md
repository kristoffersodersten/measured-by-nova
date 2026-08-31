# Release Checklist

## GitHub admission

- `quality` must pass frozen install, dependency audit, lint, build, and all
  non-Blender tests on the pull-request SHA.
- `blender-runtime` must pass the full Blender integration and negative-path
  suite on the same SHA using Ubuntu 24.04's declared APT package source.
- Both jobs use commit-pinned GitHub Actions and emit no write credentials.
- `main` requires both checks after this workflow has completed successfully.
- The runtime job uploads commit-, run-, Node-, pnpm-, runner-, and
  exact Blender package/version identity evidence for auditability.

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

The protected CI runtime also runs `pnpm release:verify`. It packs twice and
requires identical SHA-256 hashes, rejects forbidden build/governance content,
installs the tarball into a fresh temporary project, performs an MCP initialize
and tools/list handshake, discovers the declared Blender executable, proves a
corrupted payload changes the integrity hash, removes the temporary install,
and writes exact-commit evidence plus the verified tarball under `release/`.

## Native publication signer

The npm package and native signer are separate artifacts from the same protected
source SHA. GitHub's macOS job builds, tests, bundles and records the CI
candidate. Production distribution additionally requires:

- Developer ID Application signing with hardened runtime and the repository
  entitlements;
- a Developer ID Installer signed component package targeting /Applications;
- Apple notarization, stapling, Gatekeeper assessment, installer signature
  verification and a clean-machine launch smoke.

```bash
codesign --force --timestamp --options runtime \
  --entitlements native/macos-signer/MeasuredPublicationSigner.entitlements \
  --sign "Developer ID Application: <approved identity>" \
  "Measured Publication Signer.app"
codesign --verify --deep --strict --verbose=2 "Measured Publication Signer.app"

pkgbuild --component "Measured Publication Signer.app" \
  --install-location /Applications \
  --sign "Developer ID Installer: <approved identity>" \
  measured-publication-signer.pkg

xcrun notarytool submit measured-publication-signer.pkg \
  --keychain-profile measured-publication-notary --wait
xcrun stapler staple measured-publication-signer.pkg
xcrun stapler validate measured-publication-signer.pkg
spctl --assess --type install --verbose=4 measured-publication-signer.pkg
pkgutil --check-signature measured-publication-signer.pkg
```

After installation, MEASURED_NATIVE_SIGNER_PATH identifies the exact executable
inside the app bundle and MEASURED_NATIVE_SIGNER_SHA256 pins its published
digest. Completion evidence includes app and installer SHA-256,
Developer ID authorities, notarization submission ID, staple validation,
installed designated requirement, enrolled public fingerprint, explicit
consent event, signed package digest, intake result, Verified UI, and
revocation/recovery state.

The release artifact must contain product runtime only. Compiled tests,
benchmark scripts, Python bytecode, Vitest configuration, and internal
compute/operator governance documents are forbidden.

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
