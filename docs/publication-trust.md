# Publication trust contract

Measured by Nova derives public trust categories from signed capture evidence.
Neither an administrator nor an LLM may assign or upgrade a category directly.

## Capture-package boundary

`Measured Verified` requires a native-app package with an Ed25519 signature. The
signed payload binds the package to its project, object, capture protocol, kit,
commissioning party, capture time, and complete artifact manifest. Verification
also binds every measurement, material-source, and known-deviation scope and its
verified/required state; intake callers cannot supply or upgrade these claims.
Verification fails closed for missing or unexpected artifacts, changed bytes,
unknown or revoked signing keys, payload drift, or an invalid signature.

The executable intake is `verify_publication_capture_package`. It accepts only
an explicit execution intent, a project-bound package manifest, declared
evidence scopes, and—only for native packages—a public key below
`publication-keys/`. The key filename must equal the signed `keyId`; private key
material is neither accepted nor read. Successful evaluation is persisted
atomically at `measurement-projects/<projectId>/.publication-trust.json` and the
customer workspace revalidates the package, artifacts, key, and signature on
every read. Later byte drift is therefore rendered as `Disputed`, not as stale
verified evidence.

Intake and live revalidation stream artifact hashes with bounded traversal and
reject packages whose declared or observed aggregate artifact size exceeds
2 GiB. This is an explicit synchronous customer-workspace I/O budget, not a
fallback; larger evidence sets require a separately scoped ingestion contract.

Approved public keys are rotated by installing a new
`publication-keys/<keyId>.pem` and having the native app sign new packages with
that identity. To revoke a key, atomically write
`publication-keys/revoked-key-ids.json` as
`{"schemaVersion":1,"revokedKeyIds":["key-id"]}`. A missing registry means no
keys are revoked; a malformed registry fails closed. Existing evidence signed
by a revoked key cannot be revalidated or upgraded.

Manual uploads have no path to `Measured Verified`; they are always
`Measured Reference`.

## Public categories

- `Verified`: the native package and every required evidence scope verify.
- `Partially Verified`: the native package verifies, but named required scopes do
  not. The response carries both verified and unverified scope identifiers.
- `Reference`: the source is manual. A native package that does not verify is
  `Disputed`; it never degrades into a less explicit reference label.
- `Disputed`: one or more named scopes have an active dispute. Provenance and
  underlying verification remain visible.

The customer surface may show verified measurements, material sources, and known
deviations. It must not expose a composite seller score.

## Internal-only signals

Risk and fidelity scores are constrained to `internal_only`. They may prioritize
review or automation but are not inputs to public classification. Customer
ratings remain separate and become visible only when their configured minimum
sample count is reached.
