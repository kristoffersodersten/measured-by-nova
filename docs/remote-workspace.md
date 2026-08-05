# Remote Workspace

This repository's remote metabolic workspace is:

```text
Host: hetzner-server
Workspace: /home/krille/work/Measured by Nova
```

The Mac Mini may open the workspace through VS Code Remote SSH, but heavy
commands must execute on Hetzner or GitHub Actions.

## Valid Heavy Proof

Heavy proof is valid only when:

- the remote workspace branch matches the explicit project state
- the remote workspace is clean
- the command output comes from Hetzner or GitHub Actions
- local dirty work has not been used as completion proof

## Invalid Heavy Proof

The following are invalid:

- local Mac output for full tests, builds, benchmarks, OCR, vectorization,
  indexing, Docker, devcontainers, or persistent services
- clean but stale Hetzner workspaces
- hidden fallback from remote execution to local execution
- proof generated from uncommitted local state unless explicitly packaged and
  named as non-mainline proof

## Standard Commands

Inspect without mutation:

```bash
remote-compute-run --dry-run -- git status --short --branch
```

Provision the remote workspace from a clean local checkout:

```bash
remote-compute-provision
```

Run a remote command:

```bash
remote-compute-run -- pnpm test
```

Audit the contract:

```bash
remote-compute-audit .
```

Run the operator health check:

```bash
remote-compute-doctor --quick .
```
