# Gap, blind-spot and negative-space analysis

## Closed in the candidate

- Arbitrary in-memory Node private keys can no longer create native packages.
- A configured executable is mandatory; no cloud, Linux or implicit fallback exists.
- Exact signer binary SHA-256, root ownership, non-writable installation,
  executable type/size, symlink and pre-execution file state are enforced.
- Native source requires macOS, Keychain-protected device-only key material and
  explicit device-owner authentication.
- Binding, key ID, approved public fingerprint, adapter identity and consent
  method/event/time share one domain-separated signed envelope.
- Fingerprint drift, consent mutation, binding mutation, unknown/revoked key,
  invalid signature, missing/unexpected/mutated artifact, package race, symlink,
  path escape, oversized package, malformed registry and stale trust evidence
  fail closed.
- Accepted signer identity and consent evidence persist into executable
  workspace state.
- Main admission requires native macOS build/test and one independent approval.
- Obsolete draft PR #36 is closed without merge.

## Hostile-reality cases represented by automated proof

- Duplicate scope and artifact identities.
- Invalid key class and public/private-key confusion.
- Mutation after signature and during artifact hashing.
- Key replacement, fingerprint substitution and consent-event substitution.
- Missing signer configuration and non-macOS signing attempt.
- Manual evidence attempting to upgrade into Verified.
- Revoked identity and malformed or escaped revocation registry.
- Interrupted/concurrent trust writes and stale evidence revalidation.
- Corrupted release payload and clean-install MCP contract drift.

## Open production boundaries

- No Measured by Nova Developer ID Application or Developer ID Installer
  identity is installed.
- No matching macOS App ID/provisioning profile exists for
  com.namaka.measured-publication-signer and its Keychain group.
- The current GitHub candidate is ad-hoc signed and is not production-admissible.
- Real enrollment, approved PEM fingerprint installation, consent-bound package,
  intake, Verified UI, public revocation and recovery are not yet captured.
- PR #39 has no independent APPROVED review.
- Protected merge, new version, Developer ID signing, installer signing,
  notarization, stapling, release publication and clean production smoke remain.

## Decision

Continue. The product and SOD-715 remain In Progress. The next human-only action
is Apple Developer issuance of the Measured signer App ID/profile and Developer
ID Application/Installer identities; it does not authorize bypass or a
development-signature completion claim.
