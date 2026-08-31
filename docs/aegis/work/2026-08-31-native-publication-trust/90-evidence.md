# Evidence bundle

## Baseline

- Canonical implementation base: `58e6cc3a349c25af17763ab76f4a1a0c889e3e9f`.
- Existing signer accepts arbitrary unlocked Node `KeyObject` and has no production consumer.
- Existing signer tests use generated ephemeral Ed25519 keys.
- No approved native identity, consent event, native build, or genuine package digest exists.

## Platform fact

Apple documents that `Curve25519.Signing.PrivateKey` has no direct Keychain
corollary. The production design therefore uses Keychain-protected data with
user-presence control and confines raw key reconstruction to the native process.

## Pending evidence

Native build/test, genuine enrolled identity fingerprint, consent event, signed
package digest, intake result, UI result, revocation/recovery result, CI runs,
independent approval, merge SHA, release artifacts, and production smoke.

## Candidate evidence

- PR #39 candidate before the latest hardening slice: 0359398c7778d8746d1f48b25986a019205e34ae.
- Hetzner lint/build: PASS.
- Focused signer, verifier, trust-store, MCP and UI tests: 40/40 PASS.
- GitHub quality and native-signer jobs: PASS on predecessor candidate heads;
  fresh exact-head CI is required after each hardening push.
- Downloaded macOS arm64 app artifact passed strict code-signature and bundle
  verification; its CI signature is ad-hoc and therefore non-production.
- Local identities: one Apple Development identity only. Developer ID
  Application and Installer are absent.
- Runtime attempt failed closed before enrollment because the Keychain
  access-group requires a matching Measured by Nova provisioning profile.
