# Publication trust contract

Measured by Nova derives public trust categories from signed capture evidence.
Neither an administrator nor an LLM may assign or upgrade a category directly.

## Capture-package boundary

`Measured Verified` requires a native-app package with an Ed25519 signature. The
signed payload binds the package to its project, object, capture protocol, kit,
commissioning party, capture time, and complete artifact manifest. Verification
fails closed for missing or unexpected artifacts, changed bytes, unknown signing
keys, payload drift, or an invalid signature.

Manual uploads have no path to `Measured Verified`; they are always
`Measured Reference`.

## Public categories

- `Verified`: the native package and every required evidence scope verify.
- `Partially Verified`: the native package verifies, but named required scopes do
  not. The response carries both verified and unverified scope identifiers.
- `Reference`: the source is manual or the native package does not verify.
- `Disputed`: one or more named scopes have an active dispute. Provenance and
  underlying verification remain visible.

The customer surface may show verified measurements, material sources, and known
deviations. It must not expose a composite seller score.

## Internal-only signals

Risk and fidelity scores are constrained to `internal_only`. They may prioritize
review or automation but are not inputs to public classification. Customer
ratings remain separate and become visible only when their configured minimum
sample count is reached.
