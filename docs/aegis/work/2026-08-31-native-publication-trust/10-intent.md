# Native publication trust completion

## Requested outcome

Close SOD-715's full-system boundary from exact capture binding through explicit
macOS consent and Keychain-protected Ed25519 signing to approved-key intake,
Verified UI, revocation/recovery, protected merge, and a new signed release.

## Scope

- A production macOS native signer and explicit Node/MCP adapter.
- Approved signer identity and fingerprint binding.
- Consent, signing, verification, revocation, recovery, UI, and release evidence.
- Reconciliation of SOD-715, SOD-701, GitHub, and exact runtime artifacts.

## Non-goals

- No cloud signing, telemetry, hidden fallback, or export of private material.
- No mutation or withdrawal of the already verified v0.2.0 release.
- No completion claim based on generated in-memory test keys.

## Baseline read set

- `CONTEXT.md`
- `AGENTS.md`
- `src/publicationCaptureSigner.ts`
- `src/publicationTrust.ts`
- `src/publicationTrustStore.ts`
- `src/measurementTools.ts`
- `src/uiProjectState.ts`
- `docs/publication-trust.md`
- SOD-715 and SOD-701 acceptance contracts
- canonical `origin/main` at `58e6cc3a349c25af17763ab76f4a1a0c889e3e9f`

## Baseline usage

All listed repository and Linear sources were read before implementation.
Apple's official CryptoKit and Keychain documentation was checked because the
existing opaque-handle claim conflicted with platform capability. It confirms
that Curve25519/Ed25519 keys have no direct Keychain `SecKey` representation and
must be stored as protected Keychain data.

## Impact statement

This changes a security and release boundary. Compatibility must fail closed:
legacy arbitrary-`KeyObject` signing cannot establish public Verified status.
The native process owns consent and key use; Node owns orchestration only; the
verifier independently binds the approved public identity and exact package.

## Execution readiness

- Intent lock: genuine native trust, not cryptographic plumbing.
- Scope fence: publication signer, verifier, intake, UI, docs, CI, packaging.
- Baseline lock: branch starts exactly at canonical `origin/main`.
- Compatibility boundary: manual uploads remain Reference; old release remains valid as released, not product-complete.
- Test obligations: unit, integration, hostile paths, macOS native build/test, exact package smoke, revocation/recovery.
- Review gate: independent APPROVED review and protected merge.
- Completion evidence: approved fingerprint, consent event, real package digest, exact merge/release SHA, runtime Verified and revoked/disputed proof.
