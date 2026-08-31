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
