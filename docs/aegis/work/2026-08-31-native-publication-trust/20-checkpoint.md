# Checkpoint

## Current state

- SOD-715: In Progress.
- SOD-701: In Progress.
- Linear project: In Progress.
- v0.2.0 remains verified but is not full-product completion evidence.
- Isolated branch `codex/sod-715-native-trust` starts at canonical SHA `58e6cc3a349c25af17763ab76f4a1a0c889e3e9f`.

## Active slice

Implement the native macOS identity enrollment/signing boundary and its strict
Node adapter without permitting arbitrary private-key input.

## Todo

- [in progress] Native Keychain identity, explicit consent, signature, public identity export.
- [pending] Strict adapter and MCP production consumer.
- [pending] Fingerprint/consent evidence enforced by verifier and UI.
- [pending] Revocation and recovery runtime proof.
- [pending] Gap, blind-spot, negative-space and hostile-reality suites.
- [pending] Remote/full CI and macOS native CI.
- [pending] Independent review, protected merge, signed release, artifact and production smoke.
- [pending] Exact Linear/GitHub evidence and full-system DoD judgment.

## Resume state

Read `10-intent.md`, this checkpoint, SOD-715, and current worktree diff. Resume
at the first unfinished todo. Never substitute generated test keys for the native
runtime proof.

## Drift check

Decision: continue. No fallback, alternate signer, release mutation, or scope
expansion has been introduced.
