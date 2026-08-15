# Performance evidence

Measured by Nova treats performance as a fail-closed runtime contract. The
benchmark runs only after a build and records exact commit, runtime identity,
sample counts, p95 latency, RSS growth, serialized package size, and the full
Blender integration duration in `evidence/performance.json`.

The declared budgets are:

| Metric | Budget |
| --- | ---: |
| Capture validation p95 | 25 ms |
| Render-manifest generation p95 | 50 ms |
| Delivery-package generation p95 | 100 ms |
| RSS growth | 64 MiB |
| Serialized package | 2 MiB |
| Full Blender runtime and negative-path matrix | 7 minutes |

GitHub and Hetzner are valid benchmark surfaces. The Mac Mini is not. Run:

```sh
pnpm build
MEASURED_COMMIT=$(git rev-parse HEAD) \
MEASURED_BLENDER_RUNTIME_MS=<observed-full-matrix-ms> \
pnpm benchmark:xray
```

`MEASURED_COMMIT` must equal the clean checkout's full `HEAD` SHA, and the full
Blender runtime observation is mandatory. Output paths are restricted to the
repository's `evidence/` directory. Evidence is schema-validated and written by
temporary-file rename; failed validation or writing removes the temporary file
and cannot leave a partial report at the declared path. A failed budget exits
non-zero with every exceeded metric listed in the machine-readable report. The
CPU profile is `evidence/performance.cpuprofile` and is an X-Ray diagnostic,
not a substitute for the budget decision.

`pnpm test:coverage` records V8 coverage in `evidence/coverage/` and fails below
70 percent for lines, functions, branches, or statements. GitHub uploads the
summary under an artifact named for the exact tested SHA.
