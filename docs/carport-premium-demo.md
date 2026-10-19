# Carport Premium Demo

This is the reproducible SOD-1687 demonstration path for the public MCP core. It
uses the supported MCP tools and the repository Blender bridge. Experimental
scripts under `scripts/` are not geometry or export authority.

## Authorized source boundary

The demo branch starts at exact legal base:

```text
58e6cc3a349c25af17763ab76f4a1a0c889e3e9f
```

That commit is `v0.2.0`, immediately before PR #39's native-publication-signer
series. The demo runner fails closed if the signer series root is an ancestor of
the running commit or if `sign_publication_capture_package` is exposed. This
keeps the unapproved signer change outside the demo rather than merely leaving
it unused.

## Prerequisites

- Node.js 20.11 or newer
- pnpm installed and available on `PATH`
- Blender installed locally to the execution workspace
- dependencies installed from `pnpm-lock.yaml`
- a clean tracked worktree for the exact demo commit

Heavy proof must run on Hetzner or GitHub Actions according to
`docs/compute-distribution.md`. The same command can later be rehearsed on the
operator-owned local Blender workstation; no telemetry, network fallback, or
remote geometry service is used by the workflow.

## Clean start

Default output directory:

```text
output/carport-premium-demo
```

Prepare a clean review candidate with the default `blender` executable:

```bash
pnpm demo:carport -- --prepare --reset
```

Run with an explicit Blender binary:

```bash
pnpm demo:carport -- --prepare --reset \
  --blender /snap/blender/current/blender \
  --output-dir output/carport-premium-demo
```

The prepare phase stops after model and orthographic-view generation. Open and
inspect the BLEND path printed by the command. Only after that inspection, run:

```bash
pnpm demo:carport -- --deliver \
  --blender /snap/blender/current/blender \
  --output-dir output/carport-premium-demo \
  --reviewed-by "Operator name" \
  --confirm-reviewed-generated-blend
```

Prepare without `--reset` rejects an existing output directory. Deliver requires
that exact existing directory and its hash-bound review checkpoint. This prevents
a rehearsal from silently mixing artifacts from different commits or model locks.

## Demonstrated sequence

1. Record exact git, Node, pnpm, Blender, platform, fixture, and path truth.
2. Submit an intentionally unverified width measurement.
3. Prove `capture_contract_failed` with blocker `width / geometry_not_verified`.
4. Recover by submitting the unchanged verified fixture.
5. Generate the deterministic Blender model.
6. Validate known dimensions and photo orientation.
7. Generate the complete orthographic view registry.
8. Stop at a hash-bound checkpoint for real human review of the generated BLEND.
9. Resume only with the named operator's explicit confirmation, rehash the
   reviewed BLEND, then create the model lock under that reviewer identity.
10. Export BLEND and GLB from the immutable model-lock snapshot.
11. Generate the offline integrity-bound viewer from the same model lock.
12. Generate the dimensioned facade PDF from the same model lock.
13. Hash the delivery artifacts and write `carport-demo-manifest.json`.

The fixture measurements are 7,676 x 6,240 mm, high/low heights 3,455/3,174
mm, and roof slope 3.7 percent. Photos remain non-authoritative references for
appearance and validation.

## Expected outputs

The final manifest indexes at least:

- reviewed source `.blend`
- exported `.blend`
- exported GLB
- portable-export manifest
- offline viewer HTML, GLB, and viewer manifest
- dimensioned facade PDF
- final measurement project JSON

Every indexed file has a byte size and SHA-256. The manifest also records the
source SHA, legal base SHA, fixture/capture identity, model-lock hashes, runtime
versions, fail-closed recovery proof, per-step elapsed times, and the no-fallback
execution policy.

## Viewer

Serve the output root through a loopback-only static HTTP server and open the
viewer directory declared in the manifest. Do not open `index.html` directly as
a `file:` URL because browser module and fetch security rules may block it.

## Reset

The supported reset is explicit and destructive only inside the selected demo
output directory:

```bash
pnpm demo:carport -- --prepare --reset \
  --output-dir output/carport-premium-demo
```

The runner never deletes source fixtures or repository files.

## Known limitations

- This is a measured Blender visualization, not CAD, BIM, a legal survey, or a
  structural-engineering approval.
- The fixture is the approved public demo input; customer captures and premium
  commercial templates remain outside this public workflow.
- The runner records an explicit reviewer identity and rejects execution without
  a human-review confirmation. The recording operator remains responsible for
  actually inspecting the generated model before supplying that confirmation.
- The viewer is preview-only and is not independent geometry authority.